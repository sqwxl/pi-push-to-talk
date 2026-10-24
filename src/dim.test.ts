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
	// Dim opens on the previous line and closes after the last character.
	assert.match(out[0] ?? "", /\x1b\[2m/);
	assert.equal(plain(out[1] ?? "").trimEnd(), "second");
	assert.match(out[1] ?? "", /second\x1b\[22m/);
});

test("returns the input when there is no cursor or nothing to dim", () => {
	assert.deepEqual(dimBeforeCursor(["plain text"], 4), ["plain text"]);
	const withCursor = [`abc${CURSOR(" ")}`];
	assert.deepEqual(dimBeforeCursor(withCursor, 0), withCursor);
});
