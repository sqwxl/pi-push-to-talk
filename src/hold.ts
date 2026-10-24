/**
 * Hold SPACE to dictate.
 *
 * Hooks `ctx.ui.onTerminalInput`, the raw terminal path, because that is where
 * kitty key releases arrive. The press is left to the editor, so typing a space
 * never depends on this state machine: if the key stays down past HOLD_MS the
 * space the editor just typed is taken back and dictation starts.
 */
import { isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";
import { HOLD_MS, TYPING_COOLDOWN_MS } from "./config.ts";
import { trace } from "./debug.ts";
import type { DictationEditor } from "./editor.ts";
import { createRegion } from "./region.ts";
import { DictationSession, type SessionUi } from "./session.ts";
import type { Stt } from "./stt.ts";

export type HoldDeps = {
	getEditor: () => DictationEditor | undefined;
	getStt: () => Promise<Stt>;
	notify: (message: string, level: "info" | "warning" | "error") => void;
	status: (text: string | undefined) => void;
	/** Test seam; production uses DictationSession. */
	createSession?: (stt: Stt, ui: SessionUi) => DictationSession;
};

/** A hold with no release event for this long is treated as stale. */
const STALE_HOLD_MS = 5000;

export class SpaceHold {
	private readonly deps: HoldDeps;
	private session: DictationSession | undefined;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private holding = false;
	private holdingSince = 0;
	private lastTypingAt = 0;
	private starting = false;
	/** Resolves when the previous session finished its final decode. */
	private stopping: Promise<unknown> = Promise.resolve();

	constructor(deps: HoldDeps) {
		this.deps = deps;
	}

	/** Returns true when the event belongs to dictation and must be consumed. */
	handle(data: string): boolean {
		const editor = this.deps.getEditor();

		// Raw terminal input is global: dialogs and nested editors receive it too.
		// Without this guard a space typed into a permission prompt would start
		// dictation instead of reaching that editor.
		if (editor && editor.focused === false) {
			if (this.session?.isActive()) this.cancel();
			return false;
		}

		if (matchesKey(data, "space")) return this.handleSpace(isKeyRelease(data), isKeyRepeat(data));

		if (!isKeyRelease(data) && !isKeyRepeat(data) && data.length === 1 && data.charCodeAt(0) >= 32) {
			this.lastTypingAt = Date.now();
		}
		return false;
	}

	/** Abandon any open session without committing, e.g. when the prompt is submitted. */
	cancel(): void {
		this.holding = false;
		this.clearHoldTimer();
		this.session?.cancel();
		this.session = undefined;
	}

	private handleSpace(released: boolean, repeated: boolean): boolean {
		trace(
			`space release=${String(released)} repeat=${String(repeated)} holding=${String(this.holding)} active=${String(this.session?.isActive())}`,
		);

		if (this.session?.isActive()) {
			if (released) this.finish();
			return true; // space events are meaningless while dictating
		}

		if (released) {
			this.holding = false;
			this.clearHoldTimer();
			return false; // the space the editor typed stays
		}

		// Repeats of a held key must not type more spaces; the first one is the
		// space we take back when the hold threshold is reached.
		if (this.holding) {
			if (Date.now() - this.holdingSince > STALE_HOLD_MS) {
				this.holding = false; // release was lost; recover typing
				return false;
			}
			return true;
		}

		if (repeated) return false;
		if (Date.now() - this.lastTypingAt < TYPING_COOLDOWN_MS) return false;

		this.holding = true;
		this.holdingSince = Date.now();
		this.holdTimer = setTimeout(() => {
			this.holdTimer = undefined;
			void this.begin();
		}, HOLD_MS);
		return false;
	}

	private finish(): void {
		this.holding = false;
		this.clearHoldTimer();
		if (this.session) this.stopping = this.session.stop();
		void this.stopping;
	}

	private async begin(): Promise<void> {
		if (this.starting) return;
		this.starting = true;
		try {
			const editor = this.deps.getEditor();
			if (!editor) return;

			// Take back the space the editor typed when the key went down.
			editor.deleteBackward();

			// A previous stop may still be decoding its tail; its write would land
			// on top of the text this session is about to produce.
			await this.stopping;

			// Released before capture began: the tap must not vanish.
			if (!this.holding) {
				editor.typeSpace();
				return;
			}

			const stt = await this.deps.getStt();
			if (!this.holding) {
				editor.typeSpace();
				return;
			}

			const ui: SessionUi = {
				write: (text, cursorOffset, partialLength) => editor.writeAtCursor(text, cursorOffset, partialLength),
				status: (text) => this.deps.status(text),
				notify: (message, level) => this.deps.notify(message, level),
			};
			const create = this.deps.createSession ?? ((engine, sessionUi) => new DictationSession(engine, sessionUi));
			const session = create(stt, ui);
			this.session = session;
			await session.start(createRegion(editor.getText(), editor.insertionOffset()));

			// Released while the capture device was opening: close it, and give the
			// space back if nothing was transcribed.
			if (!this.holding) {
				const committed = await session.stop();
				if (!committed) editor.typeSpace();
			}
		} catch (error) {
			this.deps.notify(`Dictation: ${String(error)}`, "error");
			// Nothing was transcribed, so the deleted space comes back.
			if (!this.session?.isActive()) this.deps.getEditor()?.typeSpace();
		} finally {
			this.starting = false;
		}
	}

	private clearHoldTimer(): void {
		if (this.holdTimer) {
			clearTimeout(this.holdTimer);
			this.holdTimer = undefined;
		}
	}
}
