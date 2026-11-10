/** Catalogue integrity: the picker and installer trust this data. */
import assert from "node:assert/strict";
import test from "node:test";
import {
	BUILTIN_PRESETS,
	DEFAULT_SELECTION,
	MODEL_ROLES,
	SECTIONS,
	WHISPER_LANGUAGE_CODES,
	defaultPreset,
	isLanguageSupported,
	labelForLanguage,
	normalizeLanguage,
	presetById,
	presetsInSection,
} from "./presets.ts";

test("preset ids and labels are unique", () => {
	const ids = BUILTIN_PRESETS.map((preset) => preset.id);
	const labels = BUILTIN_PRESETS.map((preset) => preset.label);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(new Set(labels).size, labels.length);
});

test("the default preset exists and every section has a model", () => {
	assert.equal(defaultPreset().id, DEFAULT_SELECTION.presetId);
	for (const section of SECTIONS) {
		assert.ok(presetsInSection(section.id).length > 0, section.id);
	}
});

test("every preset has matching files and URLs", () => {
	for (const preset of BUILTIN_PRESETS) {
		const files = Object.entries(preset.files);
		const urls = Object.entries(preset.urls);
		assert.ok(files.length > 0, preset.id);
		assert.equal(files.length, urls.length, preset.id);
		for (const [role, file] of files) {
			assert.ok(file && file.length > 0, `${preset.id} ${role}`);
			assert.ok(MODEL_ROLES.includes(role as (typeof MODEL_ROLES)[number]), `${preset.id} ${role}`);
			const url = preset.urls[role as keyof typeof preset.urls] ?? "";
			assert.match(url, /^https:\/\//, `${preset.id} ${role}`);
			assert.ok(url.endsWith(`/${file}`), `${preset.id} ${role} URL does not end with the file`);
		}
		assert.ok(preset.size.length > 0, preset.id);
	}
});

test("ratings are 1-5 and carry a basis", () => {
	for (const preset of BUILTIN_PRESETS) {
		assert.ok(preset.accuracy >= 1 && preset.accuracy <= 5, preset.id);
		assert.ok(preset.speed >= 1 && preset.speed <= 5, preset.id);
		assert.ok(preset.ratingBasis === "reported" || preset.ratingBasis === "estimated", preset.id);
	}
});

test("language modes keep their defaults valid", () => {
	for (const preset of BUILTIN_PRESETS) {
		const mode = preset.language;
		if (mode.kind === "fixed") {
			assert.ok(mode.code.length > 0, preset.id);
		} else if (mode.kind === "choice") {
			assert.ok(mode.codes.length > 0, preset.id);
			assert.ok(mode.codes.includes(mode.default) || (mode.default === "auto" && mode.allowAuto), preset.id);
		}
	}
});

test("language normalization respects fixed, auto, and choice models", () => {
	const base = presetById("whisper-base")!;
	const auto = presetById("parakeet-v3")!;
	const choice = presetById("whisper-small")!;

	assert.equal(normalizeLanguage(base, "fr"), "en");
	assert.equal(normalizeLanguage(auto, "fr"), "auto");
	assert.equal(normalizeLanguage(choice, "fr"), "fr");
	assert.equal(normalizeLanguage(choice, "auto"), "auto");
	assert.equal(normalizeLanguage(choice, "not-a-language"), "en");
	assert.equal(isLanguageSupported(choice, "fr"), true);
	assert.equal(isLanguageSupported(choice, "not-a-language"), false);
	assert.equal(isLanguageSupported(auto, "auto"), true);
	assert.equal(isLanguageSupported(auto, "en"), false);
	assert.equal(labelForLanguage("fr"), "French");
	assert.equal(labelForLanguage("zz"), "zz");
});

test("Whisper codes include the common picker languages and no duplicates", () => {
	assert.equal(new Set(WHISPER_LANGUAGE_CODES).size, WHISPER_LANGUAGE_CODES.length);
	for (const code of ["en", "es", "fr", "de", "zh", "ja", "ko", "ar"]) {
		assert.ok(WHISPER_LANGUAGE_CODES.includes(code), code);
	}
});
