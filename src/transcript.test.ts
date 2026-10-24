import assert from "node:assert/strict";
import test from "node:test";
import { cleanTranscript } from "./transcript.ts";

test("bracketed captions are removed", () => {
	assert.equal(cleanTranscript("(footsteps) [Music]"), "");
	assert.equal(cleanTranscript("Hello there. [Music]"), "Hello there.");
	assert.equal(cleanTranscript("[BLANK_AUDIO] thanks"), "thanks");
});

test("musical notes and whitespace collapse", () => {
	assert.equal(cleanTranscript("♪ ♪  hello   world ♪"), "hello world");
});

test("ordinary text and punctuation survive", () => {
	assert.equal(cleanTranscript("Done, ready to send."), "Done, ready to send.");
});

test("stray brackets are removed", () => {
	assert.equal(cleanTranscript("[ hello there"), "hello there");
	assert.equal(cleanTranscript("and then ] it stopped"), "and then it stopped");
});
