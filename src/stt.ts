/**
 * whisper-base int8 through sherpa-onnx-node.
 *
 * Decodes are FIFO-queued: the native handle tolerates one decode at a time and
 * the preview can overlap a phrase commit.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { MODEL_DIR, SAMPLE_RATE } from "./config.ts";
import { trace } from "./debug.ts";
import { ensureModel } from "./model.ts";

const require = createRequire(import.meta.url);

type Recognizer = {
	createStream(): unknown;
	getResult(stream: unknown): { text?: string } | undefined;
	decodeAsync?(stream: unknown): Promise<void>;
	decode?(stream: unknown): void;
};

type RecognizerCtor = {
	new (config: unknown): Recognizer;
	createAsync?(config: unknown): Promise<Recognizer>;
};

/** Four threads is the sweet spot for these int8 models; do not starve the app. */
const THREADS = Math.max(1, Math.min(4, os.cpus().length - 1));

function recognizerConfig(modelDir: string): unknown {
	return {
		featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
		modelConfig: {
			whisper: {
				encoder: path.join(modelDir, "base-encoder.int8.onnx"),
				decoder: path.join(modelDir, "base-decoder.int8.onnx"),
				language: "en",
				task: "transcribe",
				// Trailing padding keeps Whisper from missing EOS and inventing a
				// closing phrase on short buffers (sherpa-onnx#2787).
				tailPaddings: 1000,
			},
			tokens: path.join(modelDir, "base-tokens.txt"),
			numThreads: THREADS,
			provider: "cpu",
		},
	};
}

export class Stt {
	private readonly recognizer: Recognizer;
	private queue: Promise<unknown> = Promise.resolve();

	private constructor(recognizer: Recognizer) {
		this.recognizer = recognizer;
	}

	/** Async so loading the model does not block the UI on first dictation. */
	static async create(modelDir: string = MODEL_DIR, onProgress?: (message: string) => void): Promise<Stt> {
		await ensureModel(modelDir, onProgress);
		const sherpa = require("sherpa-onnx-node");
		const RecognizerClass = sherpa.OfflineRecognizer as RecognizerCtor;
		const config = recognizerConfig(modelDir);
		const recognizer =
			typeof RecognizerClass.createAsync === "function"
				? await RecognizerClass.createAsync(config)
				: new RecognizerClass(config);
		return new Stt(recognizer);
	}

	/** Transcribe 16 kHz mono samples. Never rejects; returns "" on failure. */
	recognize(samples: Float32Array): Promise<string> {
		const run = this.queue
			.then(() => this.decode(samples))
			.catch((error: unknown) => {
				trace(`recognize failed: ${String(error)}`);
				return "";
			});
		this.queue = run;
		return run;
	}

	private async decode(samples: Float32Array): Promise<string> {
		if (samples.length === 0) return "";
		const stream = this.recognizer.createStream();
		(stream as { acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void }).acceptWaveform({
			sampleRate: SAMPLE_RATE,
			samples,
		});
		if (typeof this.recognizer.decodeAsync === "function") {
			await this.recognizer.decodeAsync(stream);
		} else if (typeof this.recognizer.decode === "function") {
			this.recognizer.decode(stream);
		}
		return String(this.recognizer.getResult(stream)?.text ?? "").trim();
	}
}
