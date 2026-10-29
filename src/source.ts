/**
 * Chooses where audio comes from.
 *
 * The machine that runs the terminal can own the microphone, and pi then runs
 * elsewhere. SSH forwards that machine's helper to a loopback port on this
 * host. Each client picks its own port, so two machines never fight over one,
 * and the caller probes the range: a port that refuses, stays silent, or sends
 * no helper greeting is skipped. `PI_DICTATION_AUDIO=host:port` overrides the
 * whole search.
 */
import { openMicrophone, type Microphone } from "./capture.ts";
import { AUDIO_PORTS } from "./config.ts";
import { trace } from "./debug.ts";
import { openStream, STREAM_FAILED } from "./stream.ts";

export const AUDIO_ENV = "PI_DICTATION_AUDIO";

/** A failed search is not repeated on every hold. */
const RESCAN_MS = 5000;

export type AudioSource = {
	onSamples: (samples: Float32Array) => void;
	onError: (error: Error) => void;
	notify: (message: string, level: "info" | "warning" | "error") => void;
};

export type Openers = {
	openDevice: typeof openMicrophone;
	openRemote: typeof openStream;
};

/** Opens a capture source; tests inject a fake. */
export type OpenMic = (source: AudioSource, openers?: Openers) => Promise<Microphone>;

const defaultOpeners: Openers = { openDevice: openMicrophone, openRemote: openStream };

/** Nothing answered, so this host has to record by itself. */
const NO_MICROPHONE =
	"No microphone on this host. Run /dictation-setup <ssh-host> to generate the command you will need to run on the machine you are connecting from";

/**
 * A forward exists but nothing usable answers behind it: a stale SSH session,
 * a sleeping client, or a helper that is not running. Setup is not the answer.
 */
const DEAD_FORWARD =
	"A forwarded microphone port answered but no helper was there. Reconnect this host, or start ~/.local/bin/pi-mic-stream on the machine you connect from";

/** Port of the last successful stream, tried first on the next hold. */
let cached: string | undefined;
/** Port the user picked by hand; wins over discovery. */
let pinned: string | undefined;
/** Nothing answered until this time; skip the probe until then. */
let silentUntil = 0;

/** Test seam: forget the cached port and the backoff window. */
export function resetAudioSearch(): void {
	cached = undefined;
	pinned = undefined;
	silentUntil = 0;
}

/** Pins one stream until the process exits; `undefined` returns to discovery. */
export function pinAudioSource(target: string | undefined): void {
	pinned = target;
	cached = undefined;
}

/** Every stream that greets, so the user can see and pick one. */
export async function listAudioSources(
	openers: Pick<Openers, "openRemote"> = defaultOpeners,
): Promise<{ target: string; client: string }[]> {
	const found: { target: string; client: string }[] = [];
	for (const port of AUDIO_PORTS) {
		const target = `127.0.0.1:${port}`;
		try {
			// A greeting arrives in milliseconds; this only identifies streams.
			const mic = await openers.openRemote(target, () => {}, () => {}, 300);
			mic.stop();
			found.push({ target, client: mic.client ?? "unknown" });
		} catch {
			// Not a microphone helper.
		}
	}
	return found;
}

export async function openAudioSource(
	source: AudioSource,
	openers: Openers = defaultOpeners,
): Promise<Microphone> {
	const configured = process.env[AUDIO_ENV]?.trim();
	const all = configured ? [configured] : AUDIO_PORTS.map((port) => `127.0.0.1:${port}`);
	const order = pinned && all.includes(pinned) ? [pinned, ...all.filter((t) => t !== pinned)] : all;
	const targets = cached && order.includes(cached) ? [cached, ...order.filter((t) => t !== cached)] : order;
	let answered = false;

	if (!configured && Date.now() < silentUntil) {
		trace("audio search skipped after a recent miss");
	} else {
		for (const target of targets) {
			try {
				const mic = await openers.openRemote(target, source.onSamples, source.onError);
				cached = target;
				trace(`audio from ${target} (${mic.client ?? "unknown client"})`);
				return mic;
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				// A refusal never connected; anything after that reached a listener.
				if (reason.startsWith(STREAM_FAILED)) answered = true;
				if (cached === target) cached = undefined;
				trace(`audio stream ${target} unavailable (${reason})`);
				if (configured) {
					source.notify(
						`Dictation: audio stream ${target} unavailable (${reason}); using the local microphone`,
						"warning",
					);
				}
			}
		}
		if (!configured) silentUntil = Date.now() + RESCAN_MS;
	}

	const hint = answered ? DEAD_FORWARD : NO_MICROPHONE;
	try {
		// A host with no audio input resolves the device and then reports the
		// failure asynchronously, so the hint belongs on its error, not on throw.
		let reported = false;
		return await openers.openDevice(source.onSamples, (error) => {
			if (reported) return;
			reported = true;
			source.onError(fail(hint, error));
		});
	} catch (error) {
		throw fail(hint, error instanceof Error ? error : new Error(String(error)));
	}
}

const fail = (message: string, error: Error): Error => {
	// The backend error names ALSA or CoreAudio internals; keep it in the trace
	// and show the one thing the user can act on.
	trace(`audio source failed: ${error.message}`);
	return new Error(message);
};
