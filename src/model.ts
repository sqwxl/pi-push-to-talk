/**
 * Model bootstrap.
 *
 * The recognizer needs whisper-base int8 on disk. Fetching it is part of first
 * use, not an install step, so a fresh `pi install` works without instructions.
 * System `tar` does the extraction because the archive is bzip2.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { MODEL_DIR } from "./config.ts";

const execFileAsync = promisify(execFile);

const ARCHIVE_URL =
	"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2";

/** Files the recognizer loads, all int8. */
export const REQUIRED_FILES = ["base-encoder.int8.onnx", "base-decoder.int8.onnx", "base-tokens.txt"] as const;

/** Full-precision duplicates in the archive; not used on CPU. */
const FP32_FILES = ["base-encoder.onnx", "base-decoder.onnx"];

export type Progress = (message: string) => void;

export function modelReady(dir: string = MODEL_DIR): boolean {
	return REQUIRED_FILES.every((file) => fs.existsSync(path.join(dir, file)));
}

async function download(url: string, destination: string, onProgress?: Progress): Promise<void> {
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok || !response.body) {
		throw new Error(`model download failed: HTTP ${response.status}`);
	}

	const total = Number(response.headers.get("content-length") ?? 0);
	let received = 0;
	let reported = -1;

	const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
	source.on("data", (chunk: Buffer) => {
		received += chunk.length;
		if (!onProgress || total === 0) return;
		const percent = Math.floor((received / total) * 100);
		if (percent >= reported + 10) {
			reported = percent;
			onProgress(`Downloading Whisper base ${percent}%`);
		}
	});

	await pipeline(source, fs.createWriteStream(destination));
}

/** Ensure the model directory holds every required file; download it once if not. */
export async function ensureModel(dir: string = MODEL_DIR, onProgress?: Progress): Promise<string> {
	if (modelReady(dir)) return dir;

	fs.mkdirSync(dir, { recursive: true });
	const archive = path.join(os.tmpdir(), `pi-dictation-${process.pid}.tar.bz2`);

	try {
		onProgress?.("Downloading Whisper base (198 MB, once)");
		await download(ARCHIVE_URL, archive, onProgress);

		onProgress?.("Extracting model files");
		// --strip-components drops the archive's wrapper directory.
		await execFileAsync("tar", ["-xjf", archive, "--strip-components=1", "-C", dir]);

		for (const file of FP32_FILES) fs.rmSync(path.join(dir, file), { force: true });
		// Sample clips from the archive; not used by the recognizer.
		fs.rmSync(path.join(dir, "test_wavs"), { recursive: true, force: true });
	} finally {
		fs.rmSync(archive, { force: true });
	}

	if (!modelReady(dir)) {
		throw new Error(`model files missing after extraction in ${dir}`);
	}
	return dir;
}
