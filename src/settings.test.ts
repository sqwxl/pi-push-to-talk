/** Selection persistence: missing or damaged files must never crash dictation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SELECTION } from "./presets.ts";
import { defaultSettings, loadSettings, saveSettings, settingsPath } from "./settings.ts";

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-ptt-settings-"));
}

test("missing and corrupt settings fall back to the default", () => {
	const dir = tempDir();
	try {
		assert.deepEqual(loadSettings(dir), defaultSettings());
		fs.writeFileSync(settingsPath(dir), "{not json");
		assert.deepEqual(loadSettings(dir), defaultSettings());
		fs.writeFileSync(settingsPath(dir), JSON.stringify({ selection: "nope" }));
		assert.deepEqual(loadSettings(dir), defaultSettings());
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a valid selection survives a round trip", () => {
	const dir = tempDir();
	try {
		const settings = { version: 1, selection: { presetId: "parakeet-v3", language: "auto" } };
		const file = saveSettings(settings, dir);
		assert.equal(file, settingsPath(dir));
		assert.deepEqual(loadSettings(dir), settings);
		assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("unknown ids and unsupported languages are normalized", () => {
	const dir = tempDir();
	try {
		fs.writeFileSync(
			settingsPath(dir),
			JSON.stringify({ version: 1, selection: { presetId: "gone", language: "fr" } }),
		);
		assert.deepEqual(loadSettings(dir), defaultSettings());

		fs.writeFileSync(
			settingsPath(dir),
			JSON.stringify({ version: 1, selection: { presetId: "whisper-base", language: "fr" } }),
		);
		assert.deepEqual(loadSettings(dir), { version: 1, selection: { ...DEFAULT_SELECTION } });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("saving creates a missing agent directory", () => {
	const dir = tempDir();
	try {
		const nested = path.join(dir, "agent");
		saveSettings({ version: 1, selection: { presetId: "whisper-small", language: "fr" } }, nested);
		assert.equal(fs.existsSync(settingsPath(nested)), true);
		assert.deepEqual(loadSettings(nested).selection, { presetId: "whisper-small", language: "fr" });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
