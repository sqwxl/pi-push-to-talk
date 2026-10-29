/**
 * Picks the stream from the machine the user is actually at.
 *
 * Both machines can be connected, and the server cannot see which one types.
 * Absolute loudness is a poor guide: a desktop microphone with a hum is louder
 * than a quiet laptop in the next room, and it stays louder while the user
 * speaks at the laptop. So each stream is compared against its own noise floor,
 * and the one where speech *rises above its floor* wins. Audio from every
 * candidate is buffered meanwhile and the winner's is replayed, so nothing
 * spoken during the decision is lost.
 */
import type { Microphone } from "./capture.ts";
import { rmsOf } from "./segmenter.ts";

/** Long enough to contain a syllable on any machine. */
export const PICK_MS = 700;
/** Nobody spoke within PICK_MS; wait this long in total before guessing. */
export const MAX_PICK_MS = 2500;
/** A stream this much further above its own floor wins immediately. */
const MARGIN = 4;
/** Below this level nobody is speaking, whatever the floor. */
const SPEECH_RMS = 0.02;
/** Ratios against a digitally silent stream are meaningless, so cap the floor. */
const MIN_FLOOR = 0.004;

type Open = (
	target: string,
	onSamples: (samples: Float32Array) => void,
	onError: (error: Error) => void,
) => Promise<Microphone>;

type Entry = {
	target: string;
	mic?: Microphone;
	/** Buffering until this stream is chosen, then samples go straight out. */
	buffering: boolean;
	/** Loudest chunk so far, which carries the speech. */
	peak: number;
	/** Quietest chunk so far: this stream's own noise floor. */
	floor: number;
	heard: Float32Array[];
};

/** How far this stream rose above its own floor. */
const score = (entry: Entry): number => entry.peak / Math.max(entry.floor, MIN_FLOOR);

/**
 * Opens every target, waits for one stream to rise above its floor, and
 * returns it with the audio it produced meanwhile. `undefined` means nothing
 * answered.
 *
 * If nobody spoke within `softMs`, the window stays open until `hardMs`, so a
 * late first syllable still decides instead of a guess made in silence.
 */
export async function pickStream(
	targets: string[],
	open: Open,
	onSamples: (samples: Float32Array) => void,
	onError: (error: Error) => void,
	failures: Error[] = [],
	softMs = PICK_MS,
	hardMs = MAX_PICK_MS,
): Promise<Microphone | undefined> {
	const entries: Entry[] = [];
	let settle = (): void => {};

	await Promise.all(
		targets.map(async (target) => {
			const entry: Entry = { target, buffering: true, peak: 0, floor: Number.POSITIVE_INFINITY, heard: [] };
			try {
				entry.mic = await open(
					target,
					(samples) => {
						if (!entry.buffering) {
							onSamples(samples);
							return;
						}
						entry.heard.push(samples);
						const level = rmsOf(samples);
						entry.peak = Math.max(entry.peak, level);
						entry.floor = Math.min(entry.floor, level);
						settle();
					},
					// A stream that fails later is the caller's problem only once it
					// is the chosen one; before that it is just another candidate.
					(error) => {
						if (!entry.buffering) onError(error);
						else entry.mic?.stop();
					},
				);
				entries.push(entry);
			} catch (error) {
				// Not a microphone; another target may be.
				failures.push(error instanceof Error ? error : new Error(String(error)));
			}
		}),
	);

	if (entries.length === 0) return undefined;
	if (entries.length === 1) {
		const only = entries[0]!;
		only.buffering = false;
		return only.mic;
	}

	await new Promise<void>((resolve) => {
		const best = (): Entry | undefined => rank(entries)[0];
		const clearLeader = (): boolean => {
			const [first, second] = rank(entries);
			return Boolean(
				first && first.peak >= SPEECH_RMS && (!second || score(first) >= score(second) * MARGIN),
			);
		};
		const done = (): void => {
			clearTimeout(soft);
			clearTimeout(hard);
			resolve();
		};
		const hard = setTimeout(done, hardMs);
		// After the soft window, only a stream that actually heard speech settles it.
		const soft = setTimeout(() => {
			const leader = best();
			if (leader && leader.peak >= SPEECH_RMS) done();
		}, softMs);
		settle = () => {
			if (clearLeader()) done();
		};
		settle();
	});

	const winner = rank(entries)[0];
	for (const entry of entries) {
		if (entry === winner) continue;
		entry.buffering = false;
		entry.mic?.stop();
	}
	if (!winner) return undefined;
	winner.buffering = false;
	for (const chunk of winner.heard) onSamples(chunk);
	return winner.mic;
}

const rank = (entries: Entry[]): Entry[] => [...entries].sort((a, b) => score(b) - score(a));
