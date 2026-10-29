import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DictationEditor } from "./src/editor.ts";
import { SpaceHold } from "./src/hold.ts";
import { ProbeEditor } from "./src/probe.ts";
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
	let sttPromise: Promise<Stt> | undefined;
	let unsubscribe: (() => void) | undefined;

	const getStt = (): Promise<Stt> => {
		if (!sttPromise) {
			// Model progress has its own key: the listening indicator blinks on the
			// dictation key and must not overwrite a first-run download.
			sttPromise = Stt.create(undefined, (message) => ui?.setStatus("dictation-model", message)).then(
				(stt) => {
					ui?.setStatus("dictation-model", undefined);
					return stt;
				},
				(error: unknown) => {
					// Do not cache a failure: the next hold retries.
					sttPromise = undefined;
					ui?.setStatus("dictation-model", undefined);
					throw error;
				},
			);
		}
		return sttPromise;
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
			const typed = args.trim() || (await ctx.ui.input("SSH host for this machine", "bluefin.local")) || "";
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
		unsubscribe?.();
		unsubscribe = undefined;
	});
}
