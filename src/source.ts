/**
 * Chooses where audio comes from.
 *
 * The machine that runs the terminal usually owns the microphone, and pi often
 * runs elsewhere. SSH can forward that machine's helper to a fixed loopback
 * port on this host, so the default source tries the port first and falls back
 * to the local device when nothing answers. `PI_DICTATION_AUDIO=host:port`
 * overrides the address and warns instead of falling back silently.
 */
import { openMicrophone, type Microphone } from "./capture.ts";
import { AUDIO_TARGET } from "./config.ts";
import { trace } from "./debug.ts";
import { openStream } from "./stream.ts";

export const AUDIO_ENV = "PI_DICTATION_AUDIO";

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

/** Shown when neither the stream nor the local device can record. */
const NO_MICROPHONE =
	"No microphone on this host. Run /dictation-setup to dictate with the computer you type on";

const withHint = (error: Error): Error => {
	// The backend error names ALSA or CoreAudio internals; keep it in the trace
	// and show the one thing the user can act on.
	trace(`audio source failed: ${error.message}`);
	return new Error(NO_MICROPHONE);
};

export async function openAudioSource(
	source: AudioSource,
	openers: Openers = defaultOpeners,
): Promise<Microphone> {
	const configured = process.env[AUDIO_ENV]?.trim();
	const target = configured || AUDIO_TARGET;
	try {
		return await openers.openRemote(target, source.onSamples, source.onError);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		trace(`audio stream ${target} unavailable (${reason}); using the local microphone`);
		// With no setting, a closed port is the normal case on a local machine.
		if (configured) {
			source.notify(
				`Dictation: audio stream ${target} unavailable (${reason}); using the local microphone`,
				"warning",
			);
		}
	}
	try {
		// A host with no audio input resolves the device and then reports the
		// failure asynchronously, so the hint belongs on its error, not on throw.
		let reported = false;
		return await openers.openDevice(source.onSamples, (error) => {
			if (reported) return;
			reported = true;
			source.onError(withHint(error));
		});
	} catch (error) {
		throw withHint(error instanceof Error ? error : new Error(String(error)));
	}
}
