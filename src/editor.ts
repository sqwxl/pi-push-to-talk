/**
 * The prompt editor, extended with cursor-preserving writes and dim rendering
 * of the uncommitted transcript.
 *
 * Key handling lives in SpaceHold, which sits on the raw terminal input path.
 * Nothing here can swallow a keystroke.
 */
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { dimBeforeCursor } from "./dim.ts";

/** Guard against pathological cursor rewinds on very long buffers. */
const MAX_CURSOR_REWIND = 4000;

export class DictationEditor extends CustomEditor {
	/** Characters before the cursor that are not committed yet. */
	private partialLength = 0;
	/** Last buffer state written, so identical rewrites are skipped. */
	private lastWrite = "";

	override render(width: number): string[] {
		const lines = super.render(width);
		return dimBeforeCursor(lines, this.partialLength);
	}

	/** Absolute offset of the cursor in the buffer. */
	insertionOffset(): number {
		const { line, col } = this.getCursor();
		const lines = this.getLines();
		let offset = 0;
		for (let i = 0; i < line && i < lines.length; i++) offset += (lines[i] ?? "").length + 1;
		return offset + col;
	}

	/** Replace the buffer, keep the cursor at `cursorOffset`, dim `partialLength` before it. */
	writeAtCursor(text: string, cursorOffset: number, partialLength: number): void {
		const state = `${cursorOffset}:${partialLength}:${text}`;
		if (state === this.lastWrite) return;
		this.lastWrite = state;

		this.setText(text);
		let rewind = Math.min(MAX_CURSOR_REWIND, Math.max(0, text.length - cursorOffset));
		while (rewind > 0) {
			super.handleInput("\x1b[D");
			rewind--;
		}
		// UTF-16 length; identical to the visible count for the scripts this is
		// used with, and an off-by-one only trims one cell from the dim span.
		this.partialLength = Math.max(0, partialLength);
		// setText does not repaint on its own, so timer-driven writes would stay
		// invisible until the next keystroke.
		this.tui.requestRender(true);
	}

	/** Insert a literal space at the cursor. */
	typeSpace(): void {
		super.handleInput(" ");
		this.tui.requestRender(true);
	}

	/** Remove one character before the cursor (the space typed by the key press). */
	deleteBackward(): void {
		super.handleInput("\x7f");
		this.tui.requestRender(true);
	}
}
