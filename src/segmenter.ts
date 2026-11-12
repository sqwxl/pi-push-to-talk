/**
 * Phrase boundaries.
 *
 * A phrase closes on SILENCE_COMMIT_MS of quiet, or when the session stops.
 * The trailing silence is trimmed except TAIL_PAD_MS so the last word is not
 * clipped. A long uninterrupted phrase stays open: there is no speech-length
 * cap, so the recognizer only sees a boundary the speaker actually made.
 */
import { MIN_PHRASE_RMS, SILENCE_COMMIT_MS, TAIL_PAD_MS, msToSamples } from "./config.ts";

/**
 * Level of a buffer, with its mean removed.
 *
 * Centring matters: a capture stream with a constant offset reads as loud even
 * in silence, which would defeat the silence gate entirely.
 */
export function rmsOf(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < samples.length; i++) sum += samples[i] ?? 0;
	const mean = sum / samples.length;

	let energy = 0;
	for (let i = 0; i < samples.length; i++) {
		const centred = (samples[i] ?? 0) - mean;
		energy += centred * centred;
	}
	return Math.sqrt(energy / samples.length);
}

function concat(chunks: readonly Float32Array[]): Float32Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Float32Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

export class Segmenter {
	private chunks: Float32Array[] = [];
	private total = 0;
	private silent = 0;
	private hasSpeech = false;

	/** Feed captured audio; returns a phrase when silence closes one. */
	add(samples: Float32Array): Float32Array | undefined {
		if (samples.length === 0) return undefined;
		this.chunks.push(samples);
		this.total += samples.length;

		const quiet = rmsOf(samples) < MIN_PHRASE_RMS;
		if (quiet) {
			this.silent += samples.length;
		} else {
			this.silent = 0;
			this.hasSpeech = true;
		}

		const silenceLimit = msToSamples(SILENCE_COMMIT_MS);
		if (this.silent >= silenceLimit) {
			// Nothing was ever said: drop the buffer instead of closing on it,
			// otherwise every quiet stretch would ask the recognizer to caption
			// silence.
			if (!this.hasSpeech) {
				this.reset();
				return undefined;
			}
			return this.closeAt(
				Math.min(this.total, Math.max(0, this.total - this.silent + msToSamples(TAIL_PAD_MS))),
			);
		}

		return undefined;
	}

	/** The still-open buffer, for the live preview decode. */
	open(): Float32Array {
		return concat(this.chunks);
	}

	/** Drop everything buffered, e.g. on cancel. */
	reset(): void {
		this.chunks = [];
		this.total = 0;
		this.silent = 0;
		this.hasSpeech = false;
	}

	private closeAt(cut: number): Float32Array {
		const phrase = concat(this.chunks).slice(0, cut);
		this.reset();
		return phrase;
	}
}
