/** The selection between two live machines, driven by sample energy alone. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Microphone } from "./capture.ts";
import { pickStream } from "./select.ts";

type Pusher = (samples: Float32Array) => void;

/** Streams that answer and can be fed by hand, one target per client. */
function harness(clients: Record<string, string>) {
	const pushers = new Map<string, Pusher>();
	const stopped: string[] = [];
	const open = async (target: string, onSamples: Pusher): Promise<Microphone> => {
		const client = clients[target];
		if (!client) throw new Error(`connect ECONNREFUSED ${target}`);
		pushers.set(client, onSamples);
		return { stop: () => stopped.push(client), client };
	};
	return { open, pushers, stopped };
}

/** Alternating samples, so the DC-free RMS matches the given amplitude. */
const loud = (value: number, count = 160): Float32Array => {
	const samples = new Float32Array(count);
	for (let i = 0; i < count; i++) samples[i] = i % 2 === 0 ? value : -value;
	return samples;
};

test("a single stream is used without waiting", async () => {
	const { open } = harness({ "127.0.0.1:47777": "t14" });
	const sink: Float32Array[] = [];
	const started = Date.now();
	const mic = await pickStream(["127.0.0.1:47777"], open, (chunk) => sink.push(chunk), () => {}, [], 500);
	assert.equal(mic?.client, "t14");
	assert.ok(Date.now() - started < 100, "no decision window for one machine");
});

test("the stream with speech wins and its buffered audio is replayed", async () => {
	const { open, pushers, stopped } = harness({
		"127.0.0.1:47777": "t14",
		"127.0.0.1:47778": "squishy",
	});
	const sink: Float32Array[] = [];
	const picking = pickStream(["127.0.0.1:47777", "127.0.0.1:47778"], open, (chunk) => sink.push(chunk), () => {}, [], 200);
	await new Promise((resolve) => setTimeout(resolve, 10));

	// Each stream first shows its own noise floor, then speech.
	pushers.get("t14")?.(loud(0.002));
	pushers.get("squishy")?.(loud(0.0005));
	pushers.get("t14")?.(loud(0.003));
	pushers.get("squishy")?.(loud(0.3));

	const mic = await picking;
	assert.equal(mic?.client, "squishy");
	assert.deepEqual(stopped, ["t14"], "the losing stream is closed");
	assert.equal(sink.length, 2, "the winner's audio was replayed");
	assert.ok(Math.abs((sink.at(-1)?.[0] ?? 0) - 0.3) < 0.001);
});

test("a clearly louder stream wins before the deadline", async () => {
	const { open, pushers } = harness({
		"127.0.0.1:47777": "t14",
		"127.0.0.1:47778": "squishy",
	});
	const started = Date.now();
	const picking = pickStream(["127.0.0.1:47777", "127.0.0.1:47778"], open, () => {}, () => {}, [], 1000);
	await new Promise((resolve) => setTimeout(resolve, 10));
	pushers.get("t14")?.(loud(0.002));
	pushers.get("squishy")?.(loud(0.0005));
	pushers.get("t14")?.(loud(0.002));
	pushers.get("squishy")?.(loud(0.25));
	const mic = await picking;
	assert.equal(mic?.client, "squishy");
	assert.ok(Date.now() - started < 500, "no need to wait out the window");
});

test("silent streams settle on the first one after the deadline", async () => {
	const { open } = harness({ "127.0.0.1:47777": "t14", "127.0.0.1:47778": "squishy" });
	const mic = await pickStream(["127.0.0.1:47777", "127.0.0.1:47778"], open, () => {}, () => {}, [], 50, 80);
	assert.equal(mic?.client, "t14");
});

test("dead ports do not disturb the choice", async () => {
	const { open } = harness({ "127.0.0.1:47779": "squishy" });
	const failures: Error[] = [];
	const mic = await pickStream(
		["127.0.0.1:47777", "127.0.0.1:47778", "127.0.0.1:47779"],
		open,
		() => {},
		() => {},
		failures,
		100,
	);
	assert.equal(mic?.client, "squishy");
	assert.equal(failures.length, 2);
});

test("nothing answering reports no stream", async () => {
	const failures: Error[] = [];
	const mic = await pickStream(["127.0.0.1:47777"], async () => {
		throw new Error("connect ECONNREFUSED");
	}, () => {}, () => {}, failures, 50);
	assert.equal(mic, undefined);
	assert.equal(failures.length, 1);
});
