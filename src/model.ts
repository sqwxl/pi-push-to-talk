/**
 * Model bootstrap.
 *
 * A preset names its files and URLs; this module fetches the missing ones on
 * first use. Downloads land under a temporary name and are renamed only after
 * the bytes are complete, so a killed process never leaves a file that looks
 * ready. No archive, no system `tar`.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODEL_ROOT } from "./config.ts";
import { MODEL_ROLES, type ModelRole, type Preset } from "./presets.ts";

export type Progress = (message: string) => void;

export type EnsureOptions = {
	root?: string;
	signal?: AbortSignal;
	onProgress?: Progress;
};

type FileJob = { role: ModelRole; file: string; url: string };

/** Directory a preset owns; the folder name is the preset id. */
export function presetDir(preset: Preset, root: string = MODEL_ROOT): string {
	return path.join(root, preset.id);
}

function fileReady(dir: string, file: string): boolean {
	try {
		return fs.statSync(path.join(dir, file)).size > 0;
	} catch {
		return false;
	}
}

/** True when every file the preset needs is on disk and non-empty. */
export function presetReady(preset: Preset, dir: string = presetDir(preset)): boolean {
	for (const role of MODEL_ROLES) {
		const file = preset.files[role];
		if (file && !fileReady(dir, file)) return false;
	}
	return true;
}

/**
 * Fetch one file to `destination`. The response length is checked when the
 * server provides it, so a truncated transfer cannot become a ready model.
 */
async function download(
	url: string,
	destination: string,
	label: string,
	onProgress: Progress | undefined,
	signal: AbortSignal | undefined,
): Promise<void> {
	const temp = `${destination}.part`;
	try {
		const response = await fetch(url, { redirect: "follow", signal });
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
				onProgress(`${label} ${percent}%`);
			}
		});

		await pipeline(source, fs.createWriteStream(temp), { signal });
		if (total > 0 && received !== total) {
			throw new Error(`model download incomplete: ${received} of ${total} bytes`);
		}
		fs.renameSync(temp, destination);
	} finally {
		fs.rmSync(temp, { force: true });
	}
}

/**
 * Ensure every file for a preset is on disk. Existing files are left alone, so
 * a model download interrupted between files resumes at file granularity.
 */
export async function ensurePreset(preset: Preset, options: EnsureOptions = {}): Promise<string> {
	const dir = presetDir(preset, options.root);
	if (presetReady(preset, dir)) return dir;

	const jobs: FileJob[] = [];
	for (const role of MODEL_ROLES) {
		const file = preset.files[role];
		if (!file || fileReady(dir, file)) continue;
		const url = preset.urls[role];
		if (!url) throw new Error(`model ${preset.id} has no download URL for ${role}`);
		jobs.push({ role, file, url });
	}

	fs.mkdirSync(dir, { recursive: true });
	options.onProgress?.(`Downloading ${preset.label} (${preset.size}, once)`);

	for (const [index, job] of jobs.entries()) {
		if (options.signal?.aborted) throw new Error("model download cancelled");
		const label = `${preset.label} ${index + 1}/${jobs.length}`;
		await download(job.url, path.join(dir, job.file), label, options.onProgress, options.signal);
	}

	if (!presetReady(preset, dir)) {
		throw new Error(`model files missing after download in ${dir}`);
	}
	return dir;
}
