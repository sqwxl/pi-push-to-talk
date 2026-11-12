import assert from "node:assert/strict";
import test from "node:test";
import { dimBeforeCursor } from "./dim.ts";

const CURSOR = (ch: string) => `\x1b_pi:fc\x07${ch}\x1b_pi:/fc\x07`;
const plain = (line: string) =>
	line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b_pi:[^\x07]*\x07/g, "");

test("dims exactly the characters before the cursor", () => {
	const line = `hello world${CURSOR(" ")}`;
	const [out] = dimBeforeCursor([line], 5);
	assert.ok(out, "expected output");
	assert.equal(plain(out), "hello world ");
	assert.match(out, /hello \x1b\[2mworld\x1b\[22m/);
});

test("stops at the start of the buffer instead of dimming everything", () => {
	const [out] = dimBeforeCursor([`hi${CURSOR("x")}`], 40);
	assert.ok(out);
	assert.equal(plain(out), "hix");
	// Dim covers the two real characters, not the cursor cell.
	assert.match(out, /\x1b\[2mhi\x1b\[22m/);
});

test("spans line breaks and ignores colour codes when counting", () => {
	const lines = ["\x1b[31mfirst line\x1b[0m", `second${CURSOR(" ")}`];
	const out = dimBeforeCursor(lines, 8);
	assert.equal(out.length, 2);
	assert.equal(plain(out[0] ?? ""), "first line");
	assert.equal(plain(out[1] ?? "").trimEnd(), "second");
	// Each line carries its own pair: a single pair would be erased by the
	// TUI's per-line reset.
	assert.match(out[0] ?? "", /\x1b\[2mne\x1b\[22m/);
	assert.match(out[1] ?? "", /\x1b\[2msecond\x1b\[22m/);
});

test("each wrapped line reopens dim after the line reset", () => {
	const lines = ["one\x1b[0m", "two\x1b[0m", `three${CURSOR(" ")}\x1b[0m`];
	const out = dimBeforeCursor(lines, 8);
	assert.equal(out[0], lines[0], "text outside the dim span is untouched");
	for (const line of out.slice(1)) {
		assert.match(line, /\x1b\[2m/);
		assert.match(line, /\x1b\[22m/);
	}
});

test("dims the previous line when the cursor starts a new one", () => {
	const lines = ["hello", CURSOR("x")];
	const out = dimBeforeCursor(lines, 5);
	assert.match(out[0] ?? "", /\x1b\[2mhello\x1b\[22m/);
	assert.equal(out[1]?.includes("\x1b[2m"), false);
});

test("returns the input when there is no cursor or nothing to dim", () => {
	assert.deepEqual(dimBeforeCursor(["plain text"], 4), ["plain text"]);
	const withCursor = [`abc${CURSOR(" ")}`];
	assert.deepEqual(dimBeforeCursor(withCursor, 0), withCursor);
});
