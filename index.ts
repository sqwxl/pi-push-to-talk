import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DictationEditor } from "./src/editor.ts";
import { SpaceHold } from "./src/hold.ts";
import { formatSelection, pickLanguage, pickSelection } from "./src/picker.ts";
import {
	defaultPreset,
	isLanguageSupported,
	labelForLanguage,
	normalizeLanguage,
	presetById,
	type Preset,
	type Selection,
} from "./src/presets.ts";
import { ProbeEditor } from "./src/probe.ts";
import { loadSettings, saveSettings, type DictationSettings } from "./src/settings.ts";
import { listAudioSources, pinAudioSource } from "./src/source.ts";
import { parseHost, writeSetup } from "./src/setup.ts";
import { Stt } from "./src/stt.ts";

type Ui = {
	notify: (message: string, level: "info" | "warning" | "error") => void;
	setStatus: (key: string, text: string | undefined) => void;
	theme: { fg: (color: "error", text: string) => string };
	onTerminalInput: (handler: (data: string) => { consume?: boolean } | undefined) => () => void;
};

export default function dictationExtension(pi: ExtensionAPI): void {
	let ui: Ui | undefined;
	let editor: DictationEditor | undefined;
	let settings: DictationSettings = loadSettings();
	let sttPromise: Promise<Stt> | undefined;
	let sttKey: string | undefined;
	let sttAbort: AbortController | undefined;
	let sttGeneration = 0;
	let unsubscribe: (() => void) | undefined;

	const selectedPreset = (): Preset => presetById(settings.selection.presetId) ?? defaultPreset();

	/** Drop the cached recognizer and stop any load that is still running. */
	const resetStt = (): void => {
		sttGeneration++;
		sttAbort?.abort();
		sttAbort = undefined;
		sttPromise = undefined;
		sttKey = undefined;
	};

	const applySelection = (selection: Selection): boolean => {
		const next: DictationSettings = { ...settings, selection };
		try {
			saveSettings(next);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ui?.notify(`Dictation: could not save the model choice: ${message}`, "error");
			return false;
		}
		settings = next;
		resetStt();
		return true;
	};

	const getStt = (notifyOnError = false): Promise<Stt> => {
		const preset = selectedPreset();
		const language = normalizeLanguage(preset, settings.selection.language);
		const key = `${preset.id}:${language}`;
		if (sttPromise && sttKey === key) return sttPromise;

		resetStt();
		const controller = new AbortController();
		const generation = sttGeneration;
		sttAbort = controller;
		sttKey = key;

		const promise = Stt.create(preset, language, {
			signal: controller.signal,
			// Model progress has its own key: the listening indicator blinks on the
			// dictation key and must not overwrite a first-run download.
			onProgress: (message) => ui?.setStatus("dictation-model", message),
		}).then(
			(stt) => {
				if (sttGeneration === generation) ui?.setStatus("dictation-model", undefined);
				return stt;
			},
			(error: unknown) => {
				// Do not cache a failure: the next hold retries.
				if (sttGeneration === generation) {
					sttPromise = undefined;
					sttKey = undefined;
					sttAbort = undefined;
					ui?.setStatus("dictation-model", undefined);
				}
				if (notifyOnError && !controller.signal.aborted) {
					const message = error instanceof Error ? error.message : String(error);
					ui?.notify(`Dictation: ${message}`, "error");
				}
				throw error;
			},
		);
		sttPromise = promise;
		return promise;
	};

	const hold = new SpaceHold({
		getEditor: () => editor,
		getStt,
		notify: (message, level) => ui?.notify(message, level),
		status: (text) => ui?.setStatus("dictation", text),
		indicator: (state, filled, client) => {
			const circle = filled ? (ui?.theme.fg("error", "●") ?? "●") : "○";
			if (state === "loading") return `${circle} loading model`;
			return client ? `${circle} listening via ${client}` : `${circle} listening`;
		},
	});

	// The microphone can be on the machine running the terminal instead of this
	// host. This prepares the command that sets that up from the other side.
	pi.registerCommand("dictation-setup", {
		description: "Generate the command that sets up dictation with your own microphone",
		handler: async (args, ctx) => {
			// Both the notice and the command offer the host, so the missing
			// argument never turns into a usage error the user cannot act on.
			const typed =
				args.trim() ||
				(await ctx.ui.input("SSH host that runs pi, e.g. the name you SSH to for this machine", "bluefin.local")) ||
				"";
			const host = parseHost(typed);
			if (!host) {
				ctx.ui.notify(`Dictation: "${typed.trim()}" is not an SSH host name`, "error");
				return;
			}
			try {
				const line = await writeSetup(host);
				pi.sendMessage({
					customType: "dictation-setup",
					content: `Run this once on the machine with the microphone, then reconnect to ${host}:\n\n\`\`\`sh\n${line}\n\`\`\`\n`,
					display: true,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Dictation: setup failed: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("dictation-model", {
		description: "Choose the dictation model and language",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Dictation: choosing a model needs interactive mode", "warning");
				return;
			}
			const choice = await pickSelection(ctx.ui, settings.selection);
			if (!choice) return;
			if (!applySelection(choice)) return;
			const preset = presetById(choice.presetId) ?? defaultPreset();
			ctx.ui.notify(`Dictation: ${formatSelection(preset, choice.language)}`, "info");
			void getStt(true).catch(() => {});
		},
	});

	pi.registerCommand("dictation-language", {
		description: "Set the language for the current dictation model, e.g. /dictation-language fr",
		handler: async (args, ctx) => {
			const preset = selectedPreset();
			const mode = preset.language;
			if (mode.kind === "fixed") {
				ctx.ui.notify(`Dictation: ${preset.label} uses ${labelForLanguage(mode.code)} only`, "info");
				return;
			}
			if (mode.kind === "auto") {
				ctx.ui.notify(`Dictation: ${preset.label} detects the language automatically`, "info");
				return;
			}

			const typed = args.trim().toLowerCase();
			let language: string | undefined;
			if (typed) {
				if (!isLanguageSupported(preset, typed)) {
					ctx.ui.notify(
						`Dictation: ${preset.label} does not list "${typed}". Run /dictation-language without a code to pick one.`,
						"warning",
					);
					return;
				}
				language = typed;
			} else {
				if (!ctx.hasUI) {
					ctx.ui.notify("Dictation: pass a language code, e.g. /dictation-language fr", "warning");
					return;
				}
				language = await pickLanguage(ctx.ui, preset, settings.selection.language);
				if (!language) return;
			}

			if (!applySelection({ presetId: preset.id, language })) return;
			ctx.ui.notify(`Dictation: ${formatSelection(preset, language)}`, "info");
			void getStt(true).catch(() => {});
		},
	});

	pi.registerCommand("dictation-source", {
		description: "List reachable microphones, or record from one of them",
		handler: async (args, ctx) => {
			const wanted = args.trim();
			const streams = await listAudioSources();
			if (!wanted) {
				if (streams.length === 0) {
					ctx.ui.notify("Dictation: no microphone stream is reachable", "warning");
					return;
				}
				const names = streams.map((stream) => stream.client).join(", ");
				ctx.ui.notify(`Dictation: recording from the first of ${names}; pick with /dictation-source <name>`, "info");
				return;
			}
			const match =
				streams.find((stream) => stream.client === wanted) ??
				streams.find((stream) => stream.target === wanted) ??
				streams.find((stream) => stream.target.endsWith(`:${wanted}`));
			if (!match) {
				ctx.ui.notify(`Dictation: no microphone stream named ${wanted}`, "warning");
				return;
			}
			pinAudioSource(match.target);
			ctx.ui.notify(`Dictation: recording from ${match.client}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ui = ctx.ui;

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			if (process.env.PI_DICTATION_PROBE) return new ProbeEditor(tui, theme, keybindings);
			editor = new DictationEditor(tui, theme, keybindings);
			return editor;
		});

		unsubscribe?.();
		// Probe mode replaces the editor purely to log keys; it must not consume
		// space or start sessions.
		unsubscribe = process.env.PI_DICTATION_PROBE
			? undefined
			: ctx.ui.onTerminalInput((data) => (hold.handle(data) ? { consume: true } : undefined));
	});

	// A submitted prompt clears the editor; an open session must not refill it
	// with a transcript written against the old buffer.
	pi.on("input", () => {
		hold.cancel();
	});

	pi.on("session_shutdown", () => {
		hold.cancel();
		resetStt();
		unsubscribe?.();
		unsubscribe = undefined;
	});
}
