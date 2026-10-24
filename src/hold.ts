/**
 * Hold SPACE to dictate.
 *
 * Hooks `ctx.ui.onTerminalInput`, the raw terminal path, because that is where
 * kitty key releases arrive. The press is left to the editor, so typing a space
 * never depends on this state machine: if the key stays down past HOLD_MS the
 * space the editor just typed is taken back and dictation starts.
 */
import { isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";
import { HOLD_MS } from "./config.ts";
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
	createSession?: (stt: Stt | Promise<Stt>, ui: SessionUi) => DictationSession;
};

/** A hold with no release event for this long is treated as stale. */
const STALE_HOLD_MS = 5000;

export class SpaceHold {
	private readonly deps: HoldDeps;
	private session: DictationSession | undefined;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private holding = false;
	private holdingSince = 0;
	private starting = false;
	private beginQueued = false;
	/** Bumped by each new press and by cancel; an older begin must not claim it. */
	private holdId = 0;
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
		return false;
	}

	/** Abandon any open session without committing, e.g. when the prompt is submitted. */
	cancel(): void {
		trace("cancel");
		this.holding = false;
		this.holdId++;
		this.beginQueued = false;
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
			// A session that failed by itself is already stopping; keep that
			// shutdown visible to the next begin before the key is pressed again.
			this.finish();
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

		this.holding = true;
		this.holdingSince = Date.now();
		this.holdId++;
		const id = this.holdId;
		this.holdTimer = setTimeout(() => {
			this.holdTimer = undefined;
			this.requestBegin(id);
		}, HOLD_MS);
		return false;
	}

	private finish(): void {
		this.holding = false;
		this.clearHoldTimer();
		if (!this.session) return;
		this.stopping = this.session.stop().catch((error: unknown) => {
			this.deps.notify(`Dictation: ${String(error)}`, "error");
		});
	}

	/** Start against the given press; queue it when an older begin is still unwinding. */
	private requestBegin(id: number): void {
		if (id !== this.holdId) return;
		if (this.starting) {
			this.beginQueued = true;
			return;
		}
		void this.begin(id);
	}

	private async begin(id: number): Promise<void> {
		if (this.starting) {
			this.beginQueued = true;
			return;
		}
		this.starting = true;
		try {
			const editor = this.deps.getEditor();
			if (!editor) return;

			// Take back the space the editor typed when the key went down.
			editor.deleteBackward();

			// A previous stop may still be decoding its tail; its write would land
			// on top of the text this session is about to produce.
			await this.stopping;
			// A newer press now owns the buffer and will start its own session.
			if (id !== this.holdId) return;

			// Released before capture began: the tap must not vanish.
			if (!this.holding) {
				trace("begin: released while the previous stop finished, space restored");
				editor.typeSpace();
				return;
			}

			const stt = this.deps.getStt();
			// Capture starts now; the session waits for the model on its first
			// decode. Keep a load failure handled until that decode reports it.
			void stt.catch(() => {});
			const ui: SessionUi = {
				write: (text, cursorOffset, partialLength) => editor.writeAtCursor(text, cursorOffset, partialLength),
				status: (text) => this.deps.status(text),
				notify: (message, level) => this.deps.notify(message, level),
			};
			const create = this.deps.createSession ?? ((engine, sessionUi) => new DictationSession(engine, sessionUi));
			const session = create(stt, ui);
			this.session = session;
			await session.start(createRegion(editor.getText(), editor.insertionOffset()));

			// Cancelled while the device was opening: leave the buffer alone.
			if (id !== this.holdId) return;

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
			if (this.beginQueued) {
				this.beginQueued = false;
				if (this.holding && !this.session?.isActive()) this.requestBegin(this.holdId);
			}
		}
	}

	private clearHoldTimer(): void {
		if (this.holdTimer) {
			clearTimeout(this.holdTimer);
			this.holdTimer = undefined;
		}
	}
}
