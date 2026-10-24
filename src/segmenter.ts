/**
 * Phrase boundaries.
 *
 * A phrase closes on SILENCE_COMMIT_MS of quiet, or at MAX_PHRASE_MS. The cap
 * cuts at the quietest point of the trailing CAP_CUT_SCAN_MS so it lands in a
 * breath rather than mid-syllable; the tail carries into the next phrase.
 */
import {
	CAP_CUT_SCAN_MS,
	MAX_PHRASE_MS,
	MIN_PHRASE_RMS,
	SILENCE_COMMIT_MS,
	TAIL_PAD_MS,
	msToSamples,
} from "./config.ts";

export type ClosedPhrase = {
	samples: Float32Array;
	reason: "silence" | "cap";
};

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

	/** Feed captured audio; returns a phrase when one closes. */
	add(samples: Float32Array): ClosedPhrase | undefined {
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
			return this.closeAt(Math.min(this.total, Math.max(0, this.total - this.silent + msToSamples(TAIL_PAD_MS))), "silence");
		}

		if (this.total >= msToSamples(MAX_PHRASE_MS)) {
			return this.closeAt(this.quietestCut(), "cap");
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

	private closeAt(cut: number, reason: ClosedPhrase["reason"]): ClosedPhrase {
		const all = concat(this.chunks);
		const head = all.slice(0, cut);
		// Silence that closed a phrase is not carried into the next one; only a
		// cap cut keeps its tail, because that tail is still speech.
		const tail = reason === "cap" ? all.slice(cut) : new Float32Array(0);
		this.chunks = tail.length > 0 ? [tail] : [];
		this.total = tail.length;
		this.silent = 0;
		// A cap cut keeps speech in the tail; a tail of pure silence must not
		// look like speech, or the next phrase would decode silence.
		this.hasSpeech = tail.length > 0 && rmsOf(tail) >= MIN_PHRASE_RMS;
		return { samples: head, reason };
	}

	/** Start of the quietest 10 ms window in the trailing scan range. */
	private quietestCut(): number {
		const all = concat(this.chunks);
		const scan = Math.min(all.length, msToSamples(CAP_CUT_SCAN_MS));
		const step = msToSamples(10);
		const from = Math.max(0, all.length - scan);
		let bestAt = from;
		let bestRms = Number.POSITIVE_INFINITY;
		for (let at = from; at < all.length; at += step) {
			const rms = rmsOf(all.subarray(at, Math.min(at + step, all.length)));
			if (rms < bestRms) {
				bestRms = rms;
				bestAt = at;
			}
		}
		return bestAt;
	}
}
