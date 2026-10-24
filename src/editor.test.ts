/**
 * The editor is shared across prompts in one pi session, so a write must be
 * compared with the live buffer. A cached state skipped the second dictation
 * of an identical phrase once the buffer had been cleared.
 */
import assert from "node:assert/strict";
import test from "node:test";

type PiTui = typeof import("@earendil-works/pi-tui");

let tui: PiTui | undefined;
try {
	tui = await import("@earendil-works/pi-tui");
} catch {
	// The pi packages come from the host; skip when they are not installed.
}

const { DictationEditor } = (await import("./editor.ts").catch(() => ({}))) as {
	DictationEditor?: typeof import("./editor.ts").DictationEditor;
};

if (tui) tui.setKeybindings(new tui.KeybindingsManager(tui.TUI_KEYBINDINGS));

function makeEditor(): InstanceType<typeof import("./editor.ts").DictationEditor> {
	const fakeTui = { requestRender: () => {}, invalidate: () => {}, setFocus: () => {} };
	const theme = { borderColor: (text: string) => text, selectList: {} };
	return new DictationEditor!(fakeTui as never, theme as never, new tui!.KeybindingsManager(tui!.TUI_KEYBINDINGS));
}

test("the same phrase dictated into a cleared prompt is written again", { skip: !DictationEditor }, () => {
	const editor = makeEditor();
	editor.writeAtCursor("hello.", 6, 0);
	assert.equal(editor.getText(), "hello.");

	editor.setText(""); // a submit clears the same editor instance
	editor.writeAtCursor("hello.", 6, 0);
	assert.equal(editor.getText(), "hello.");
});

test("a write is not skipped when the buffer changed outside dictation", { skip: !DictationEditor }, () => {
	const editor = makeEditor();
	editor.writeAtCursor("hello.", 6, 0);

	editor.setText("replaced");
	editor.writeAtCursor("hello.", 6, 0);
	assert.equal(editor.getText(), "hello.");
});
