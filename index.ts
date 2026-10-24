import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DictationEditor } from "./src/editor.ts";
import { SpaceHold } from "./src/hold.ts";
import { ProbeEditor } from "./src/probe.ts";
import { Stt } from "./src/stt.ts";

type Ui = {
	notify: (message: string, level: "info" | "warning" | "error") => void;
	setStatus: (key: string, text: string | undefined) => void;
	onTerminalInput: (handler: (data: string) => { consume?: boolean } | undefined) => () => void;
};

export default function dictationExtension(pi: ExtensionAPI): void {
	let ui: Ui | undefined;
	let editor: DictationEditor | undefined;
	let sttPromise: Promise<Stt> | undefined;
	let unsubscribe: (() => void) | undefined;

	const getStt = (): Promise<Stt> => {
		if (!sttPromise) {
			sttPromise = Stt.create(undefined, (message) => ui?.setStatus("dictation", message)).then(
				(stt) => {
					ui?.setStatus("dictation", undefined);
					return stt;
				},
				(error: unknown) => {
					// Do not cache a failure: the next hold retries.
					sttPromise = undefined;
					ui?.setStatus("dictation", undefined);
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
