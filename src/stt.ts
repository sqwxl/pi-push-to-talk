/**
 * Local recognition through sherpa-onnx-node.
 *
 * Decodes are FIFO-queued: the native handle tolerates one decode at a time and
 * the preview can overlap a phrase commit.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { SAMPLE_RATE } from "./config.ts";
import { trace } from "./debug.ts";
import { ensurePreset, type EnsureOptions } from "./model.ts";
import type { ModelRole, Preset } from "./presets.ts";

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

function fileFor(preset: Preset, modelDir: string, role: ModelRole): string {
	const file = preset.files[role];
	if (!file) throw new Error(`model ${preset.id} has no ${role} file`);
	return path.join(modelDir, file);
}

function moonshineConfig(preset: Preset, modelDir: string): Record<string, string> {
	if (preset.files.mergedDecoder) {
		// Moonshine v2: encoder plus one merged decoder. The npm type comments
		// list only the v1 fields, but the native addon reads mergedDecoder.
		return {
			encoder: fileFor(preset, modelDir, "encoder"),
			mergedDecoder: fileFor(preset, modelDir, "mergedDecoder"),
		};
	}
	return {
		preprocessor: fileFor(preset, modelDir, "preprocessor"),
		encoder: fileFor(preset, modelDir, "encoder"),
		uncachedDecoder: fileFor(preset, modelDir, "uncachedDecoder"),
		cachedDecoder: fileFor(preset, modelDir, "cachedDecoder"),
	};
}

/** Build the sherpa config for one preset and language. Exported for tests. */
export function recognizerConfig(preset: Preset, modelDir: string, language: string): unknown {
	const tokens = fileFor(preset, modelDir, "tokens");
	let model: Record<string, unknown>;

	switch (preset.family) {
		case "whisper":
			model = {
				whisper: {
					encoder: fileFor(preset, modelDir, "encoder"),
					decoder: fileFor(preset, modelDir, "decoder"),
					// Whisper reads an empty language as auto-detect.
					language: language === "auto" ? "" : language,
					task: "transcribe",
					// Trailing padding keeps Whisper from missing EOS and inventing a
					// closing phrase on short buffers (sherpa-onnx#2787).
					tailPaddings: 1000,
				},
			};
			break;
		case "transducer":
			model = {
				transducer: {
					encoder: fileFor(preset, modelDir, "encoder"),
					decoder: fileFor(preset, modelDir, "decoder"),
					joiner: fileFor(preset, modelDir, "joiner"),
				},
			};
			break;
		case "moonshine":
			model = { moonshine: moonshineConfig(preset, modelDir) };
			break;
		case "sensevoice":
			model = {
				senseVoice: {
					model: fileFor(preset, modelDir, "model"),
					language: language || "auto",
					useInverseTextNormalization: 1,
				},
			};
			break;
		default:
			throw new Error(`unsupported model family: ${String(preset.family)}`);
	}

	return {
		featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
		modelConfig: {
			...model,
			tokens,
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
	static async create(preset: Preset, language: string, options: EnsureOptions = {}): Promise<Stt> {
		const modelDir = await ensurePreset(preset, options);
		const sherpa = require("sherpa-onnx-node");
		const RecognizerClass = sherpa.OfflineRecognizer as RecognizerCtor;
		const config = recognizerConfig(preset, modelDir, language);
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
