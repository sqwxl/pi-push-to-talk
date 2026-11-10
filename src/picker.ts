/**
 * Model picker.
 *
 * Groups come first so the list stays short, then the model. A model that can
 * choose its language asks once more. All of this is pure UI stepping over the
 * catalogue, which keeps it testable without a terminal.
 */
import {
	COMMON_LANGUAGES,
	isLanguageSupported,
	labelForLanguage,
	normalizeLanguage,
	presetsInSection,
	SECTIONS,
	type Preset,
	type Selection,
} from "./presets.ts";

export type PickerUi = {
	select(title: string, options: string[]): Promise<string | undefined>;
};

export type LanguageChoice = { code: string; label: string };

/** Five filled/empty circles; `undefined` means the model is unrated. */
export function ratingCircles(value: number | undefined): string {
	if (value == null) return "—";
	const filled = Math.max(0, Math.min(5, Math.round(value)));
	return "●".repeat(filled) + "○".repeat(5 - filled);
}

export function modelLabel(preset: Preset, current: boolean): string {
	const parts = [
		preset.label,
		`acc ${ratingCircles(preset.accuracy)}`,
		`spd ${ratingCircles(preset.speed)}`,
		preset.size,
	];
	if (current) parts.push("current");
	return parts.join(" · ");
}

export function formatSelection(preset: Preset, language: string): string {
	return `${preset.label} (${language === "auto" ? "auto" : labelForLanguage(language)})`;
}

function languageLabel(code: string): string {
	return `${labelForLanguage(code)} (${code})`;
}

/**
 * Languages shown for a model: the current or default language first, then
 * auto when allowed, then the common list filtered to the model's codes.
 */
export function languageChoices(preset: Preset, current?: string): LanguageChoice[] {
	const mode = preset.language;
	if (mode.kind === "fixed") return [{ code: mode.code, label: languageLabel(mode.code) }];
	if (mode.kind === "auto") return [{ code: "auto", label: "Auto-detect" }];

	const choices: LanguageChoice[] = [];
	const seen = new Set<string>();
	const add = (code: string, label: string): void => {
		if (seen.has(code)) return;
		seen.add(code);
		choices.push({ code, label: code === current ? `${label} (current)` : label });
	};

	const preferred = current && isLanguageSupported(preset, current) ? current : mode.default;
	if (preferred !== "auto") add(preferred, languageLabel(preferred));
	if (mode.allowAuto) add("auto", "Auto-detect");
	for (const language of COMMON_LANGUAGES) {
		if (mode.codes.includes(language.code)) add(language.code, languageLabel(language.code));
	}
	if (current && isLanguageSupported(preset, current)) add(current, languageLabel(current));
	return choices;
}

/** Ask for the model's language. Fixed and auto-only models skip the dialog. */
export async function pickLanguage(
	ui: PickerUi,
	preset: Preset,
	current?: string,
): Promise<string | undefined> {
	const mode = preset.language;
	if (mode.kind === "fixed") return mode.code;
	if (mode.kind === "auto") return "auto";

	const choices = languageChoices(preset, current);
	const choice = await ui.select(`${preset.label} — language`, choices.map((item) => item.label));
	if (!choice) return undefined;
	return choices.find((item) => item.label === choice)?.code;
}

/** Section, model, then language when the model needs one. */
export async function pickSelection(ui: PickerUi, current: Selection): Promise<Selection | undefined> {
	const sectionLabel = await ui.select(
		"Dictation model — choose a language group",
		SECTIONS.map((section) => section.label),
	);
	if (!sectionLabel) return undefined;

	const section = SECTIONS.find((item) => item.label === sectionLabel);
	if (!section) return undefined;

	const presets = presetsInSection(section.id);
	const options = presets.map((preset) => ({
		label: modelLabel(preset, preset.id === current.presetId),
		preset,
	}));
	const modelChoice = await ui.select(
		`${section.label} models — accuracy / speed`,
		options.map((option) => option.label),
	);
	if (!modelChoice) return undefined;

	const chosen = options.find((option) => option.label === modelChoice)?.preset;
	if (!chosen) return undefined;

	const language = await pickLanguage(ui, chosen, chosen.id === current.presetId ? current.language : undefined);
	if (!language) return undefined;
	return { presetId: chosen.id, language: normalizeLanguage(chosen, language) };
}
