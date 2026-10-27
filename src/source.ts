/**
 * Chooses where audio comes from.
 *
 * `PI_DICTATION_AUDIO=host:port` reads the stream a helper serves over SSH.
 * When that stream is unreachable the local device is used instead, so a stray
 * setting never makes dictation unusable.
 */
import { openMicrophone, type Microphone } from "./capture.ts";
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

export async function openAudioSource(
	source: AudioSource,
	openers: Openers = defaultOpeners,
): Promise<Microphone> {
	const target = process.env[AUDIO_ENV]?.trim();
	if (target) {
		try {
			return await openers.openRemote(target, source.onSamples, source.onError);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			source.notify(
				`Dictation: audio stream ${target} unavailable (${reason}); using the local microphone`,
				"warning",
			);
		}
	}
	return openers.openDevice(source.onSamples, source.onError);
}
