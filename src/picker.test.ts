/** Picker steps and the circle shorthand, without a terminal. */
import assert from "node:assert/strict";
import test from "node:test";
import {
	formatSelection,
	languageChoices,
	modelLabel,
	pickLanguage,
	pickSelection,
	ratingCircles,
	type PickerUi,
} from "./picker.ts";
import { DEFAULT_SELECTION, presetById } from "./presets.ts";

function fakeUi(...answers: (string | undefined)[]): PickerUi & { calls: { title: string; options: string[] }[] } {
	const calls: { title: string; options: string[] }[] = [];
	return {
		calls,
		select: async (title, options) => {
			calls.push({ title, options });
			return answers.shift();
		},
	};
}

function preset(id: string) {
	const found = presetById(id);
	if (!found) throw new Error(`missing preset ${id}`);
	return found;
}

test("ratings use filled and empty circles, and an em dash when unrated", () => {
	assert.equal(ratingCircles(5), "●●●●●");
	assert.equal(ratingCircles(3), "●●●○○");
	assert.equal(ratingCircles(0), "○○○○○");
	assert.equal(ratingCircles(undefined), "—");
	assert.equal(ratingCircles(9), "●●●●●");
});

test("a model label carries both ratings, size, and the current marker", () => {
	const label = modelLabel(preset("whisper-base"), true);
	assert.match(label, /Whisper Base/);
	assert.match(label, /acc ●●●○○/);
	assert.match(label, /spd ●●●○○/);
	assert.match(label, /154 MB/);
	assert.match(label, /current$/);
});

test("language choices start with the current or default language and filter by model", () => {
	const whisper = preset("whisper-small");
	const choices = languageChoices(whisper);
	assert.equal(choices[0]?.code, "en");
	assert.ok(choices.some((choice) => choice.code === "auto"));
	assert.ok(choices.some((choice) => choice.code === "fr"));
	assert.ok(choices.some((choice) => choice.code === "yue"));

	const voice = preset("sensevoice-small");
	const voiceChoices = languageChoices(voice);
	assert.equal(voiceChoices[0]?.code, "auto");
	assert.ok(voiceChoices.some((choice) => choice.code === "yue"));
	assert.equal(voiceChoices.some((choice) => choice.code === "fr"), false);

	const current = languageChoices(whisper, "fr");
	assert.equal(current[0]?.label, "French (fr) (current)");
});

test("fixed and auto-only models skip the language dialog", async () => {
	const fixed = fakeUi();
	assert.equal(await pickLanguage(fixed, preset("whisper-base")), "en");
	assert.equal(await pickLanguage(fixed, preset("parakeet-v3")), "auto");
	assert.equal(fixed.calls.length, 0);
});

test("selection asks for section, model, then language", async () => {
	const whisper = preset("whisper-base");
	const ui = fakeUi("English", modelLabel(whisper, true));
	const selection = await pickSelection(ui, DEFAULT_SELECTION);
	assert.deepEqual(selection, { presetId: "whisper-base", language: "en" });
	assert.equal(ui.calls.length, 2);
	assert.match(ui.calls[0]?.title ?? "", /language group/);
	assert.match(ui.calls[1]?.title ?? "", /accuracy \/ speed/);
});

test("an auto-only model stays on two steps", async () => {
	const parakeet = preset("parakeet-v3");
	const ui = fakeUi("Multilingual", modelLabel(parakeet, false));
	const selection = await pickSelection(ui, DEFAULT_SELECTION);
	assert.deepEqual(selection, { presetId: "parakeet-v3", language: "auto" });
	assert.equal(ui.calls.length, 2);
});

test("a multilingual choice asks for language", async () => {
	const small = preset("whisper-small");
	const ui = fakeUi("Multilingual", modelLabel(small, false), "French (fr)");
	const selection = await pickSelection(ui, DEFAULT_SELECTION);
	assert.deepEqual(selection, { presetId: "whisper-small", language: "fr" });
	assert.equal(ui.calls.length, 3);
	assert.match(ui.calls[2]?.title ?? "", /Whisper Small — language/);
});

test("cancelling any step leaves the selection unchanged", async () => {
	assert.equal(await pickSelection(fakeUi(undefined), DEFAULT_SELECTION), undefined);
	assert.equal(await pickSelection(fakeUi("English", undefined), DEFAULT_SELECTION), undefined);

	const small = preset("whisper-small");
	assert.equal(await pickSelection(fakeUi("Multilingual", modelLabel(small, false), undefined), DEFAULT_SELECTION), undefined);
});

test("selection text names the language", () => {
	assert.equal(formatSelection(preset("whisper-small"), "fr"), "Whisper Small (French)");
	assert.equal(formatSelection(preset("parakeet-v3"), "auto"), "Parakeet TDT v3 (auto)");
});
