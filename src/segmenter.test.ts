import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PHRASE_MS, SILENCE_COMMIT_MS, TAIL_PAD_MS, msToSamples } from "./config.ts";
import { Segmenter, rmsOf } from "./segmenter.ts";

const speech = (ms: number): Float32Array => {
	const samples = new Float32Array(msToSamples(ms));
	for (let i = 0; i < samples.length; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / 16000);
	return samples;
};
const silence = (ms: number): Float32Array => new Float32Array(msToSamples(ms));

test("rms of silence is zero, rms of a sine is near its amplitude over root two", () => {
	assert.equal(rmsOf(silence(100)), 0);
	const level = rmsOf(speech(100));
	assert.ok(level > 0.13 && level < 0.15, `unexpected rms ${level}`);
});

test("a phrase closes only after enough silence", () => {
	const segmenter = new Segmenter();
	assert.equal(segmenter.add(speech(1000)), undefined);
	assert.equal(segmenter.add(silence(SILENCE_COMMIT_MS - 100)), undefined);

	const closed = segmenter.add(silence(200));
	assert.ok(closed, "expected a closed phrase");
	assert.equal(closed?.reason, "silence");
	// The phrase keeps a little trailing silence so its last word is not clipped.
	assert.equal(closed?.samples.length, msToSamples(1000 + TAIL_PAD_MS));
	assert.equal(segmenter.open().length, 0);
});

test("the cap fires at MAX_PHRASE_MS and keeps the tail open", () => {
	const segmenter = new Segmenter();
	let closed;
	for (let sent = 0; sent < Math.ceil((MAX_PHRASE_MS + 1000) / 100) && !closed; sent++) {
		closed = segmenter.add(speech(100));
	}
	assert.ok(closed, "expected the cap to fire");
	assert.equal(closed?.reason, "cap");
	assert.ok(closed.samples.length <= msToSamples(MAX_PHRASE_MS), "cut past the cap");
	assert.ok(segmenter.open().length > 0, "tail should stay buffered");
});

test("reset drops the open buffer", () => {
	const segmenter = new Segmenter();
	segmenter.add(speech(500));
	segmenter.reset();
	assert.equal(segmenter.open().length, 0);
});

test("a stream with a constant offset still reads as silence", () => {
	const lifted = new Float32Array(msToSamples(200)).fill(0.22);
	assert.ok(rmsOf(lifted) < 0.001, `offset leaked into the level: ${rmsOf(lifted)}`);

	const segmenter = new Segmenter();
	assert.equal(segmenter.add(lifted), undefined);
	const closed = segmenter.add(new Float32Array(msToSamples(SILENCE_COMMIT_MS)));
	assert.equal(closed, undefined, "silence must not close a phrase that never had speech");
});
