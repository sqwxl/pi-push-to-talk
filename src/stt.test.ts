/**
 * End-to-end check of the recognizer against a shipped test wav.
 * Skips when the model is not on disk.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MODEL_DIR } from "./config.ts";
import { Stt } from "./stt.ts";

const wavPath = path.join(MODEL_DIR, "test_wavs", "0.wav");

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
	const stt = await Stt.create();
	const text = await stt.recognize(readWav(wavPath));
	const normalized = text.toUpperCase().replace(/[^A-Z ]/g, "");
	assert.match(normalized, /YELLOW LAMPS/, `unexpected transcript: ${text}`);
});
