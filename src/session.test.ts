/**
 * Drives the session with a fake microphone and recognizer, which is the only
 * way to exercise the preview and commit paths without a real device.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { PARTIAL_INTERVAL_MS, msToSamples } from "./config.ts";
import { createRegion } from "./region.ts";
import { DictationSession, type SessionUi } from "./session.ts";
import type { Stt } from "./stt.ts";

const speech = (ms: number): Float32Array => {
	const samples = new Float32Array(msToSamples(ms));
	for (let i = 0; i < samples.length; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / 16000);
	return samples;
};

function harness(transcript: string) {
	const writes: string[] = [];
	const ui: SessionUi = {
		write: (text) => writes.push(text),
		status: () => {},
		notify: () => {},
	};
	let feed: ((samples: Float32Array) => void) | undefined;
	const stt = { recognize: async () => transcript } as unknown as Stt;
	const session = new DictationSession(stt, ui, async (onSamples) => {
		feed = onSamples;
		return { stop: () => {} };
	});
	return { session, writes, send: (samples: Float32Array) => feed?.(samples) };
}

test("the preview writes cleaned text into the region", async () => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
	try {
		const { session, writes, send } = harness("(footsteps) hello there");
		await session.start(createRegion("", 0));
		send(speech(400));

		mock.timers.tick(1000);
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(writes.at(-1), "hello there");
		session.cancel();
	} finally {
		mock.timers.reset();
	}
});

test("a mid-session commit drops Whisper's trailing full stop", async () => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
	try {
		const { session, writes } = harness("the sentence continues.");
		await session.start(createRegion("", 0));

		const decode = (session as unknown as { decodePhrase(s: Float32Array, f: boolean): Promise<void> }).decodePhrase.bind(session);
		await decode(speech(400), false);
		assert.equal(writes.at(-1), "the sentence continues");

		await decode(speech(400), true);
		assert.equal(writes.at(-1), "the sentence continues the sentence continues.");
		session.cancel();
	} finally {
		mock.timers.reset();
	}
});

test("a session without speech never writes", async () => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
	try {
		const { session, writes, send } = harness("should not appear");
		await session.start(createRegion("", 0));
		send(new Float32Array(msToSamples(400)).fill(0.22)); // DC-only "silence"

		mock.timers.tick(1000);
		await new Promise((resolve) => setImmediate(resolve));

		assert.deepEqual(writes, []);
		session.cancel();
	} finally {
		mock.timers.reset();
	}
});

test("stopping commits the tail exactly once", async () => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
	try {
		const { session, writes, send } = harness("last words");
		await session.start(createRegion("", 0));
		send(speech(400));

		await session.stop();
		assert.equal(session.isActive(), false);
		assert.equal(writes.at(-1), "last words");
	} finally {
		mock.timers.reset();
	}
});

test("a phrase that closed just before the release is still committed", async () => {
	const writes: string[] = [];
	const ui: SessionUi = { write: (text) => writes.push(text), status: () => {}, notify: () => {} };
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	let started = false;
	const stt = {
		recognize: async () => {
			started = true;
			await gate;
			return "hello world";
		},
	} as unknown as Stt;
	let feed: ((samples: Float32Array) => void) | undefined;
	const session = new DictationSession(stt, ui, async (onSamples) => {
		feed = onSamples;
		return { stop: () => {} };
	});

	await session.start(createRegion("", 0));
	feed?.(speech(500));
	feed?.(new Float32Array(msToSamples(2500))); // closes the phrase on silence
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(started, true, "the phrase decode is in flight");

	try {
		const stopping = session.stop(); // its samples are no longer in the segmenter
		release();
		await stopping;

		assert.equal(writes.at(-1), "hello world");
	} finally {
		release(); // never leave the decode hanging when an assertion fails
	}
});

test("a preview survives a final decode that returns nothing", async () => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
	try {
		const writes: string[] = [];
		const ui: SessionUi = { write: (text) => writes.push(text), status: () => {}, notify: () => {} };
		let calls = 0;
		const stt = { recognize: async () => (++calls === 1 ? "hello there" : "") } as unknown as Stt;
		let feed: ((samples: Float32Array) => void) | undefined;
		const session = new DictationSession(stt, ui, async (onSamples) => {
			feed = onSamples;
			return { stop: () => {} };
		});

		await session.start(createRegion("", 0));
		feed?.(speech(500));
		mock.timers.tick(PARTIAL_INTERVAL_MS);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(writes.at(-1), "hello there");

		await session.stop();
		assert.equal(writes.at(-1), "hello there", "the transcript the user saw must not be wiped");
	} finally {
		mock.timers.reset();
	}
});

test("speech captured while the model loads is transcribed", async () => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
	try {
		const writes: string[] = [];
		const ui: SessionUi = { write: (text) => writes.push(text), status: () => {}, notify: () => {} };
		let loaded!: (stt: Stt) => void;
		const ready = new Promise<Stt>((resolve) => (loaded = resolve));
		let feed: ((samples: Float32Array) => void) | undefined;
		const session = new DictationSession(ready, ui, async (onSamples) => {
			feed = onSamples;
			return { stop: () => {} };
		});

		await session.start(createRegion("", 0));
		feed?.(speech(500)); // the user speaks before the model is ready

		const stopping = session.stop();
		loaded({ recognize: async () => "first words" } as unknown as Stt);
		await stopping;

		assert.equal(writes.at(-1), "first words");
	} finally {
		mock.timers.reset();
	}
});
