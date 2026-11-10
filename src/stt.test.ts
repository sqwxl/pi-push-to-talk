/**
 * End-to-end check of the recognizer against a shipped test wav.
 * Skips when the model is not on disk.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { presetDir } from "./model.ts";
import { defaultPreset, presetById } from "./presets.ts";
import { recognizerConfig, Stt } from "./stt.ts";

const preset = defaultPreset();
const wavPath = path.join(presetDir(preset), "test_wavs", "0.wav");

function readWav(file: string): Float32Array {
	const buffer = fs.readFileSync(file);
	let at = 12;
	while (at + 8 <= buffer.length) {
		const id = buffer.toString("ascii", at, at + 4);
		const size = buffer.readUInt32LE(at + 4);
		if (id === "data") {
			const count = Math.floor(size / 2);
			const out = new Float32Array(count);
			for (let i = 0; i < count; i++) out[i] = buffer.readInt16LE(at + 8 + i * 2) / 32768;
			return out;
		}
		at += 8 + size + (size % 2);
	}
	throw new Error("no data chunk");
}

test("whisper-base transcribes the shipped test wav", { skip: !fs.existsSync(wavPath) }, async () => {
	const stt = await Stt.create(preset, "en");
	const text = await stt.recognize(readWav(wavPath));
	const normalized = text.toUpperCase().replace(/[^A-Z ]/g, "");
	assert.match(normalized, /YELLOW LAMPS/, `unexpected transcript: ${text}`);
});

/** Configs are data; these snapshots catch a wrong field without loading the native addon. */
type ConfigShape = {
	featConfig: { featureDim: number };
	modelConfig: {
		tokens: string;
		whisper?: { language: string; tailPaddings: number };
		transducer?: { encoder: string; decoder: string; joiner: string };
		moonshine?: Record<string, string>;
		senseVoice?: { language: string; useInverseTextNormalization: number };
	};
};

function configOf(id: string, language: string): ConfigShape {
	const found = presetById(id);
	if (!found) throw new Error(`missing preset ${id}`);
	return JSON.parse(JSON.stringify(recognizerConfig(found, "/models/x", language))) as ConfigShape;
}

test("whisper passes the chosen language and keeps the EOS padding", () => {
	const config = configOf("whisper-small", "fr");
	assert.equal(config.featConfig.featureDim, 80);
	assert.equal(config.modelConfig.whisper?.language, "fr");
	assert.equal(config.modelConfig.whisper?.tailPaddings, 1000);
	assert.match(config.modelConfig.tokens, /small-tokens\.txt$/);
	assert.equal(configOf("whisper-base", "auto").modelConfig.whisper?.language, "");
});

test("parakeet uses the transducer block", () => {
	const config = configOf("parakeet-v3", "auto");
	assert.ok(config.modelConfig.transducer?.encoder.endsWith("encoder.int8.onnx"));
	assert.ok(config.modelConfig.transducer?.joiner.endsWith("joiner.int8.onnx"));
	assert.equal(config.modelConfig.whisper, undefined);
});

test("both moonshine layouts build the right block", () => {
	const v1 = configOf("moonshine-base", "en").modelConfig.moonshine;
	assert.ok(v1?.preprocessor.endsWith("preprocess.onnx"));
	assert.ok(v1?.uncachedDecoder.endsWith("uncached_decode.int8.onnx"));
	assert.equal(v1?.mergedDecoder, undefined);

	const v2 = configOf("moonshine-v2-ko", "ko").modelConfig.moonshine;
	assert.ok(v2?.encoder.endsWith("encoder_model.ort"));
	assert.ok(v2?.mergedDecoder.endsWith("decoder_model_merged.ort"));
	assert.equal(v2?.preprocessor, undefined);
});

test("sensevoice passes auto or a code and enables number normalization", () => {
	const config = configOf("sensevoice-small", "auto");
	assert.equal(config.modelConfig.senseVoice?.language, "auto");
	assert.equal(config.modelConfig.senseVoice?.useInverseTextNormalization, 1);
	assert.equal(configOf("sensevoice-small", "zh").modelConfig.senseVoice?.language, "zh");
});
