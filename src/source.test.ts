/** Verifies which capture source runs, and what happens when the stream is missing. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Microphone } from "./capture.ts";
import { AUDIO_PORTS } from "./config.ts";
import { AUDIO_ENV, listAudioSources, openAudioSource, pinAudioSource, resetAudioSearch } from "./source.ts";

const mic: Microphone = { stop: () => {}, client: "squishy" };

/** Only these ports answer; everything else refuses. */
function openers(answering: number[] = [], device: "ok" | "throw" | "fail-late" = "ok") {
	const attempted: string[] = [];
	return {
		attempted,
		openDevice: async (_samples: unknown, onError: (error: Error) => void) => {
			if (device === "throw") throw new Error("ALSA function failed.");
			if (device === "fail-late") onError(new Error("ALSA function failed."));
			return mic;
		},
		openRemote: async (target: string) => {
			attempted.push(target);
			if (!answering.includes(Number(target.split(":")[1]))) throw new Error(`connect ECONNREFUSED ${target}`);
			return mic;
		},
	};
}

function handlers(notices: string[] = []) {
	return {
		onSamples: () => {},
		onError: () => {},
		notify: (message: string) => notices.push(message),
	};
}

async function withTarget(value: string | undefined, run: () => Promise<void>): Promise<void> {
	const previous = process.env[AUDIO_ENV];
	resetAudioSearch();
	if (value === undefined) delete process.env[AUDIO_ENV];
	else process.env[AUDIO_ENV] = value;
	try {
		await run();
	} finally {
		resetAudioSearch();
		if (previous === undefined) delete process.env[AUDIO_ENV];
		else process.env[AUDIO_ENV] = previous;
	}
}

test("the whole range is probed, then the device, silently", async () => {
	const fake = openers([], "ok");
	await withTarget(undefined, async () => {
		assert.equal(await openAudioSource(handlers(), fake), mic);
	});
	const ports = fake.attempted.map((target) => Number(target.split(":")[1])).sort((a, b) => a - b);
	assert.deepEqual(ports, [...AUDIO_PORTS].sort((a, b) => a - b));
});

test("one answering stream is used", async () => {
	const fake = openers([47785]);
	await withTarget(undefined, async () => {
		assert.equal(await openAudioSource(handlers(), fake), mic);
	});
	assert.deepEqual(fake.attempted, AUDIO_PORTS.map((port) => `127.0.0.1:${port}`));
});

test("a setting opens exactly that stream", async () => {
	const fake = openers([50001]);
	await withTarget("127.0.0.1:50001", async () => {
		assert.equal(await openAudioSource(handlers(), fake), mic);
	});
	assert.deepEqual(fake.attempted, ["127.0.0.1:50001"]);
});

test("a failing setting falls back to the device and says so", async () => {
	const notices: string[] = [];
	const fake = openers([]);
	await withTarget("127.0.0.1:50001", async () => {
		assert.equal(await openAudioSource(handlers(notices), fake), mic);
	});
	assert.deepEqual(fake.attempted, ["127.0.0.1:50001"]);
	assert.equal(notices.length, 1);
	assert.match(notices[0] ?? "", /using the local microphone/);
});

test("a pinned stream is the only one tried", async () => {
	const fake = openers([47785]);
	await withTarget(undefined, async () => {
		pinAudioSource("127.0.0.1:47785");
		assert.equal(await openAudioSource(handlers(), fake), mic);
	});
	assert.deepEqual(fake.attempted, ["127.0.0.1:47785"]);
});

test("a host with no microphone points at the setup command", async () => {
	const fake = openers([], "throw");
	await withTarget(undefined, async () => {
		await assert.rejects(openAudioSource(handlers(), fake), /^Error: No microphone on this host\. Run \/dictation-setup/);
	});
});

test("a forward with nothing behind it asks for a reconnect", async () => {
	const fake = {
		openDevice: async () => {
			throw new Error("ALSA function failed.");
		},
		openRemote: async () => {
			throw new Error("audio stream sent no helper greeting");
		},
	};
	await withTarget(undefined, async () => {
		await assert.rejects(openAudioSource(handlers(), fake), /forwarded microphone port answered but no helper/);
	});
});

test("a device that fails after opening still carries the message once", async () => {
	const errors: string[] = [];
	const fake = openers([], "fail-late");
	await withTarget(undefined, async () => {
		await openAudioSource(
			{ onSamples: () => {}, onError: (error) => errors.push(error.message), notify: () => {} },
			fake,
		);
	});
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? "", /No microphone on this host\. Run \/dictation-setup <pi-host>/);
});

test("only streams that greet are listed", async () => {
	const streams = await listAudioSources({
		openRemote: async (target: string) => {
			if (target !== "127.0.0.1:47779") throw new Error("audio stream did not identify itself");
			return mic;
		},
	});
	assert.deepEqual(streams, [{ target: "127.0.0.1:47779", client: "squishy" }]);
});
