/**
 * Extension-owned dictation settings.
 *
 * Pi exposes its merged settings read-only to extensions, so the selected model
 * lives in a small file of its own. The write is atomic: a crash cannot leave a
 * half-written selection behind.
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_SELECTION,
	defaultPreset,
	normalizeLanguage,
	presetById,
	type Selection,
} from "./presets.ts";

export const SETTINGS_VERSION = 1;

export type DictationSettings = {
	version: number;
	selection: Selection;
};

export function defaultSettings(): DictationSettings {
	return { version: SETTINGS_VERSION, selection: { ...DEFAULT_SELECTION } };
}

export function settingsPath(baseDir: string = getAgentDir()): string {
	return path.join(baseDir, "push-to-talk.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Missing, unreadable, or invalid settings fall back to the default model. */
export function loadSettings(baseDir?: string): DictationSettings {
	let text: string;
	try {
		text = fs.readFileSync(settingsPath(baseDir), "utf8");
	} catch {
		return defaultSettings();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return defaultSettings();
	}

	if (!isRecord(parsed) || !isRecord(parsed.selection)) return defaultSettings();

	const id = typeof parsed.selection.presetId === "string" ? parsed.selection.presetId : DEFAULT_SELECTION.presetId;
	const preset = presetById(id) ?? defaultPreset();
	const language = normalizeLanguage(
		preset,
		typeof parsed.selection.language === "string" ? parsed.selection.language : undefined,
	);

	return { version: SETTINGS_VERSION, selection: { presetId: preset.id, language } };
}

/** Write the settings file and return its path. */
export function saveSettings(settings: DictationSettings, baseDir?: string): string {
	const file = settingsPath(baseDir);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temp, file);
	} finally {
		fs.rmSync(temp, { force: true });
	}
	return file;
}
