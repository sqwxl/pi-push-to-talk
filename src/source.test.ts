/** Verifies which capture source runs, and what happens when the stream is missing. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Microphone } from "./capture.ts";
import { AUDIO_ENV, openAudioSource } from "./source.ts";

const mic: Microphone = { stop: () => {} };

function handlers(notices: string[]) {
	return {
		onSamples: () => {},
		onError: () => {},
		notify: (message: string) => notices.push(message),
	};
}

function openers(used: string[], fail = false) {
	return {
		openDevice: async () => {
			used.push("device");
			return mic;
		},
		openRemote: async (target: string) => {
			used.push(`remote:${target}`);
			if (fail) throw new Error("connect ECONNREFUSED");
			return mic;
		},
	};
}

async function withTarget(value: string | undefined, run: () => Promise<void>): Promise<void> {
	const previous = process.env[AUDIO_ENV];
	if (value === undefined) delete process.env[AUDIO_ENV];
	else process.env[AUDIO_ENV] = value;
	try {
		await run();
	} finally {
		if (previous === undefined) delete process.env[AUDIO_ENV];
		else process.env[AUDIO_ENV] = previous;
	}
}

test("no setting tries the forward, then the device, without a warning", async () => {
	const used: string[] = [];
	const notices: string[] = [];
	await withTarget(undefined, async () => {
		await openAudioSource(handlers(notices), openers(used, true));
	});
	assert.deepEqual(used, ["remote:127.0.0.1:47777", "device"]);
	assert.deepEqual(notices, []);
});

test("a setting opens the stream", async () => {
	const used: string[] = [];
	const notices: string[] = [];
	await withTarget("127.0.0.1:47777", async () => {
		assert.equal(await openAudioSource(handlers(notices), openers(used)), mic);
	});
	assert.deepEqual(used, ["remote:127.0.0.1:47777"]);
	assert.deepEqual(notices, []);
});

test("no setting prefers the forward when it answers", async () => {
	const used: string[] = [];
	await withTarget(undefined, async () => {
		assert.equal(await openAudioSource(handlers([]), openers(used)), mic);
	});
	assert.deepEqual(used, ["remote:127.0.0.1:47777"]);
});

test("a host with no microphone points at the setup command", async () => {
	const used: string[] = [];
	const failing = {
		openDevice: async () => {
			used.push("device");
			throw new Error("ALSA function failed.");
		},
		openRemote: async () => {
			used.push("remote");
			throw new Error("connect ECONNREFUSED");
		},
	};
	await withTarget(undefined, async () => {
		await assert.rejects(openAudioSource(handlers([]), failing), /^Error: No microphone on this host\. Run \/dictation-setup/);
	});
	assert.deepEqual(used, ["remote", "device"]);
});

test("a device that fails after opening still points at the setup command", async () => {
	const errors: string[] = [];
	const late = {
		openDevice: async (_samples: unknown, onError: (error: Error) => void) => {
			onError(new Error("ALSA function failed."));
			onError(new Error("microphone stream ended"));
			return mic;
		},
		openRemote: async () => {
			throw new Error("connect ECONNREFUSED");
		},
	};
	await withTarget(undefined, async () => {
		await openAudioSource(
			{
				onSamples: () => {},
				onError: (error) => errors.push(error.message),
				notify: () => {},
			},
			late,
		);
	});
	assert.equal(errors.length, 1, "the failure is reported once");
	assert.match(errors[0] ?? "", /No microphone on this host\. Run \/dictation-setup/);
});

test("an unreachable stream falls back to the device and says so", async () => {
	const used: string[] = [];
	const notices: string[] = [];
	await withTarget("127.0.0.1:47777", async () => {
		assert.equal(await openAudioSource(handlers(notices), openers(used, true)), mic);
	});
	assert.deepEqual(used, ["remote:127.0.0.1:47777", "device"]);
	assert.equal(notices.length, 1);
	assert.match(notices[0] ?? "", /using the local microphone/);
});
