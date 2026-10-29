/**
 * Microphone capture.
 *
 * Asks the device for 16 kHz mono directly; falls back to a native rate with a
 * linear resampler when the device refuses, which is what built-in mics do on
 * some Linux setups.
 */
import { createRequire } from "node:module";
import { SAMPLE_RATE, msToSamples } from "./config.ts";
import { int16ToFloat32 } from "./pcm.ts";

const require = createRequire(import.meta.url);

export interface Microphone {
	stop(): void;
	/** Machine that records, set when the audio arrives over a forwarded socket. */
	client?: string;
}

const FALLBACK_RATES = [SAMPLE_RATE, 48000, 44100];

/** Linear resampler with phase carried across chunks. */
function makeResampler(fromRate: number): (input: Float32Array) => Float32Array {
	if (fromRate === SAMPLE_RATE) return (input) => input;
	const step = fromRate / SAMPLE_RATE;
	let position = 0;
	let last = 0;

	return (input) => {
		const out: number[] = [];
		for (;;) {
			const index = Math.floor(position);
			if (index + 1 >= input.length) break;
			const frac = position - index;
			const a = index < 0 ? last : (input[index] ?? 0);
			const b = input[index + 1] ?? 0;
			out.push(a + (b - a) * frac);
			position += step;
		}
		position -= input.length;
		last = input[input.length - 1] ?? last;
		return Float32Array.from(out);
	};
}

export async function openMicrophone(
	onSamples: (samples: Float32Array) => void,
	onError: (error: Error) => void,
): Promise<Microphone> {
	const Decibri = require("decibri");
	let failure: Error = new Error("no capture device");

	for (const rate of FALLBACK_RATES) {
		try {
			const mic = new Decibri({
				sampleRate: rate,
				channels: 1,
				framesPerBuffer: Math.round((msToSamples(100) * rate) / SAMPLE_RATE),
				format: "int16",
			});
			const resample = makeResampler(rate);
			let stopped = false;
			mic.on("data", (chunk: Buffer) => {
				const samples = resample(int16ToFloat32(chunk));
				if (samples.length > 0) onSamples(samples);
			});
			mic.on("error", (error: Error) => {
				if (!stopped) onError(error);
			});
			// A device that disappears mid-recording must not leave a silent session.
			for (const event of ["end", "close"] as const) {
				mic.once(event, () => {
					if (!stopped) onError(new Error("microphone stream ended"));
				});
			}
			return {
				stop: () => {
					stopped = true;
					mic.stop();
				},
			};
		} catch (error) {
			failure = error instanceof Error ? error : new Error(String(error));
		}
	}

	throw failure;
}
