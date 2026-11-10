/**
 * Built-in dictation models.
 *
 * This file is data: a preset names its files, download URLs, recognizer
 * family, and spoken languages. Adding a model that fits an existing family is
 * an entry here, not new decoding code.
 */

export type ModelFamily = "whisper" | "transducer" | "moonshine" | "sensevoice";

export type ModelSection =
	| "multilingual"
	| "english"
	| "arabic"
	| "chinese"
	| "japanese"
	| "korean"
	| "spanish";

export type ModelRole =
	| "encoder"
	| "decoder"
	| "joiner"
	| "preprocessor"
	| "uncachedDecoder"
	| "cachedDecoder"
	| "mergedDecoder"
	| "model"
	| "tokens";

/** Every role a family may need; a preset fills only the roles it uses. */
export const MODEL_ROLES: ModelRole[] = [
	"encoder",
	"decoder",
	"joiner",
	"preprocessor",
	"uncachedDecoder",
	"cachedDecoder",
	"mergedDecoder",
	"model",
	"tokens",
];

export type ModelFiles = Partial<Record<ModelRole, string>>;
export type ModelUrls = Partial<Record<ModelRole, string>>;

export type Rating = 1 | 2 | 3 | 4 | 5;
export type RatingBasis = "reported" | "estimated";

/**
 * How a model gets its spoken language.
 *
 * `fixed` pins one code. `auto` lets the model detect it. `choice` offers the
 * model's codes plus optional auto-detection.
 */
export type LanguageMode =
	| { kind: "fixed"; code: string }
	| { kind: "auto" }
	| { kind: "choice"; codes: string[]; allowAuto: boolean; default: string };

export type Preset = {
	id: string;
	label: string;
	section: ModelSection;
	size: string;
	family: ModelFamily;
	files: ModelFiles;
	urls: ModelUrls;
	language: LanguageMode;
	accuracy: Rating;
	speed: Rating;
	ratingBasis: RatingBasis;
};

export type Selection = { presetId: string; language: string };

export const DEFAULT_SELECTION: Selection = { presetId: "whisper-base", language: "en" };

export const SECTIONS: { id: ModelSection; label: string }[] = [
	{ id: "multilingual", label: "Multilingual" },
	{ id: "english", label: "English" },
	{ id: "arabic", label: "Arabic" },
	{ id: "chinese", label: "Chinese" },
	{ id: "japanese", label: "Japanese" },
	{ id: "korean", label: "Korean" },
	{ id: "spanish", label: "Spanish" },
];

/** Labels for the short picker; the command accepts any code the model lists. */
export const COMMON_LANGUAGES: { code: string; label: string }[] = [
	{ code: "en", label: "English" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "it", label: "Italian" },
	{ code: "pt", label: "Portuguese" },
	{ code: "nl", label: "Dutch" },
	{ code: "pl", label: "Polish" },
	{ code: "ru", label: "Russian" },
	{ code: "uk", label: "Ukrainian" },
	{ code: "tr", label: "Turkish" },
	{ code: "ar", label: "Arabic" },
	{ code: "hi", label: "Hindi" },
	{ code: "zh", label: "Chinese" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "yue", label: "Cantonese" },
];

/** Whisper's language tokens; used to validate `/dictation-language <code>`. */
export const WHISPER_LANGUAGE_CODES = [
	"en",
	"zh",
	"de",
	"es",
	"ru",
	"ko",
	"fr",
	"ja",
	"pt",
	"tr",
	"pl",
	"ca",
	"nl",
	"ar",
	"sv",
	"it",
	"id",
	"hi",
	"fi",
	"vi",
	"he",
	"uk",
	"el",
	"ms",
	"cs",
	"ro",
	"da",
	"hu",
	"ta",
	"no",
	"th",
	"ur",
	"hr",
	"bg",
	"lt",
	"la",
	"mi",
	"ml",
	"cy",
	"sk",
	"te",
	"fa",
	"lv",
	"bn",
	"sr",
	"az",
	"sl",
	"kn",
	"et",
	"mk",
	"br",
	"eu",
	"is",
	"hy",
	"ne",
	"mn",
	"bs",
	"kk",
	"sq",
	"sw",
	"gl",
	"mr",
	"pa",
	"si",
	"km",
	"sn",
	"yo",
	"so",
	"af",
	"oc",
	"ka",
	"be",
	"tg",
	"sd",
	"gu",
	"am",
	"yi",
	"lo",
	"uz",
	"fo",
	"ht",
	"ps",
	"tk",
	"nn",
	"mt",
	"sa",
	"lb",
	"my",
	"bo",
	"tl",
	"mg",
	"as",
	"tt",
	"haw",
	"ln",
	"ha",
	"ba",
	"jw",
	"su",
	"yue",
];

export const SENSEVOICE_LANGUAGE_CODES = ["zh", "en", "ja", "ko", "yue"];

const HF1 = "https://huggingface.co/csukuangfj";
const HF2 = "https://huggingface.co/csukuangfj2";

const hf1 = (repo: string, file: string): string => `${HF1}/${repo}/resolve/main/${file}`;
const hf2 = (repo: string, file: string): string => `${HF2}/${repo}/resolve/main/${file}`;

const languages: Record<string, string> = Object.fromEntries(
	COMMON_LANGUAGES.map((language) => [language.code, language.label]),
);

export const BUILTIN_PRESETS: Preset[] = [
	// Multilingual
	{
		id: "parakeet-v3",
		label: "Parakeet TDT v3",
		section: "multilingual",
		size: "671 MB",
		family: "transducer",
		files: { encoder: "encoder.int8.onnx", decoder: "decoder.int8.onnx", joiner: "joiner.int8.onnx", tokens: "tokens.txt" },
		urls: {
			encoder: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "encoder.int8.onnx"),
			decoder: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "decoder.int8.onnx"),
			joiner: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "joiner.int8.onnx"),
			tokens: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "tokens.txt"),
		},
		language: { kind: "auto" },
		accuracy: 5,
		speed: 4,
		ratingBasis: "reported",
	},
	{
		id: "whisper-small",
		label: "Whisper Small",
		section: "multilingual",
		size: "375 MB",
		family: "whisper",
		files: { encoder: "small-encoder.int8.onnx", decoder: "small-decoder.int8.onnx", tokens: "small-tokens.txt" },
		urls: {
			encoder: hf1("sherpa-onnx-whisper-small", "small-encoder.int8.onnx"),
			decoder: hf1("sherpa-onnx-whisper-small", "small-decoder.int8.onnx"),
			tokens: hf1("sherpa-onnx-whisper-small", "small-tokens.txt"),
		},
		language: { kind: "choice", codes: WHISPER_LANGUAGE_CODES, allowAuto: true, default: "en" },
		accuracy: 4,
		speed: 2,
		ratingBasis: "reported",
	},
	{
		id: "sensevoice-small",
		label: "SenseVoice Small",
		section: "multilingual",
		size: "228 MB",
		family: "sensevoice",
		files: { model: "model.int8.onnx", tokens: "tokens.txt" },
		urls: {
			model: hf1("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", "model.int8.onnx"),
			tokens: hf1("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", "tokens.txt"),
		},
		language: { kind: "choice", codes: SENSEVOICE_LANGUAGE_CODES, allowAuto: true, default: "auto" },
		accuracy: 4,
		speed: 5,
		ratingBasis: "reported",
	},

	// English
	{
		id: "whisper-base",
		label: "Whisper Base",
		section: "english",
		size: "154 MB",
		family: "whisper",
		files: { encoder: "base-encoder.int8.onnx", decoder: "base-decoder.int8.onnx", tokens: "base-tokens.txt" },
		urls: {
			encoder: hf1("sherpa-onnx-whisper-base", "base-encoder.int8.onnx"),
			decoder: hf1("sherpa-onnx-whisper-base", "base-decoder.int8.onnx"),
			tokens: hf1("sherpa-onnx-whisper-base", "base-tokens.txt"),
		},
		language: { kind: "fixed", code: "en" },
		accuracy: 3,
		speed: 3,
		ratingBasis: "reported",
	},
	{
		id: "moonshine-base",
		label: "Moonshine Base",
		section: "english",
		size: "287 MB",
		family: "moonshine",
		files: {
			preprocessor: "preprocess.onnx",
			encoder: "encode.int8.onnx",
			uncachedDecoder: "uncached_decode.int8.onnx",
			cachedDecoder: "cached_decode.int8.onnx",
			tokens: "tokens.txt",
		},
		urls: {
			preprocessor: hf1("sherpa-onnx-moonshine-base-en-int8", "preprocess.onnx"),
			encoder: hf1("sherpa-onnx-moonshine-base-en-int8", "encode.int8.onnx"),
			uncachedDecoder: hf1("sherpa-onnx-moonshine-base-en-int8", "uncached_decode.int8.onnx"),
			cachedDecoder: hf1("sherpa-onnx-moonshine-base-en-int8", "cached_decode.int8.onnx"),
			tokens: hf1("sherpa-onnx-moonshine-base-en-int8", "tokens.txt"),
		},
		language: { kind: "fixed", code: "en" },
		accuracy: 2,
		speed: 5,
		ratingBasis: "reported",
	},
	{
		id: "parakeet-v2",
		label: "Parakeet TDT v2",
		section: "english",
		size: "661 MB",
		family: "transducer",
		files: { encoder: "encoder.int8.onnx", decoder: "decoder.int8.onnx", joiner: "joiner.int8.onnx", tokens: "tokens.txt" },
		urls: {
			encoder: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "encoder.int8.onnx"),
			decoder: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "decoder.int8.onnx"),
			joiner: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "joiner.int8.onnx"),
			tokens: hf1("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "tokens.txt"),
		},
		language: { kind: "fixed", code: "en" },
		accuracy: 5,
		speed: 5,
		ratingBasis: "reported",
	},

	// Dedicated language models
	{
		id: "moonshine-v2-ar",
		label: "Moonshine v2 Arabic",
		section: "arabic",
		size: "135 MB",
		family: "moonshine",
		files: { encoder: "encoder_model.ort", mergedDecoder: "decoder_model_merged.ort", tokens: "tokens.txt" },
		urls: {
			encoder: hf2("sherpa-onnx-moonshine-base-ar-quantized-2026-02-27", "encoder_model.ort"),
			mergedDecoder: hf2("sherpa-onnx-moonshine-base-ar-quantized-2026-02-27", "decoder_model_merged.ort"),
			tokens: hf2("sherpa-onnx-moonshine-base-ar-quantized-2026-02-27", "tokens.txt"),
		},
		language: { kind: "fixed", code: "ar" },
		accuracy: 3,
		speed: 5,
		ratingBasis: "estimated",
	},
	{
		id: "moonshine-v2-zh",
		label: "Moonshine v2 Chinese",
		section: "chinese",
		size: "135 MB",
		family: "moonshine",
		files: { encoder: "encoder_model.ort", mergedDecoder: "decoder_model_merged.ort", tokens: "tokens.txt" },
		urls: {
			encoder: hf2("sherpa-onnx-moonshine-base-zh-quantized-2026-02-27", "encoder_model.ort"),
			mergedDecoder: hf2("sherpa-onnx-moonshine-base-zh-quantized-2026-02-27", "decoder_model_merged.ort"),
			tokens: hf2("sherpa-onnx-moonshine-base-zh-quantized-2026-02-27", "tokens.txt"),
		},
		language: { kind: "fixed", code: "zh" },
		accuracy: 3,
		speed: 5,
		ratingBasis: "estimated",
	},
	{
		id: "moonshine-v2-ja",
		label: "Moonshine v2 Japanese",
		section: "japanese",
		size: "135 MB",
		family: "moonshine",
		files: { encoder: "encoder_model.ort", mergedDecoder: "decoder_model_merged.ort", tokens: "tokens.txt" },
		urls: {
			encoder: hf2("sherpa-onnx-moonshine-base-ja-quantized-2026-02-27", "encoder_model.ort"),
			mergedDecoder: hf2("sherpa-onnx-moonshine-base-ja-quantized-2026-02-27", "decoder_model_merged.ort"),
			tokens: hf2("sherpa-onnx-moonshine-base-ja-quantized-2026-02-27", "tokens.txt"),
		},
		language: { kind: "fixed", code: "ja" },
		accuracy: 3,
		speed: 5,
		ratingBasis: "estimated",
	},
	{
		id: "moonshine-v2-ko",
		label: "Moonshine v2 Korean",
		section: "korean",
		size: "69 MB",
		family: "moonshine",
		files: { encoder: "encoder_model.ort", mergedDecoder: "decoder_model_merged.ort", tokens: "tokens.txt" },
		urls: {
			encoder: hf2("sherpa-onnx-moonshine-tiny-ko-quantized-2026-02-27", "encoder_model.ort"),
			mergedDecoder: hf2("sherpa-onnx-moonshine-tiny-ko-quantized-2026-02-27", "decoder_model_merged.ort"),
			tokens: hf2("sherpa-onnx-moonshine-tiny-ko-quantized-2026-02-27", "tokens.txt"),
		},
		language: { kind: "fixed", code: "ko" },
		accuracy: 2,
		speed: 5,
		ratingBasis: "estimated",
	},
	{
		id: "moonshine-v2-es",
		label: "Moonshine v2 Spanish",
		section: "spanish",
		size: "63 MB",
		family: "moonshine",
		files: { encoder: "encoder_model.ort", mergedDecoder: "decoder_model_merged.ort", tokens: "tokens.txt" },
		urls: {
			encoder: hf2("sherpa-onnx-moonshine-base-es-quantized-2026-02-27", "encoder_model.ort"),
			mergedDecoder: hf2("sherpa-onnx-moonshine-base-es-quantized-2026-02-27", "decoder_model_merged.ort"),
			tokens: hf2("sherpa-onnx-moonshine-base-es-quantized-2026-02-27", "tokens.txt"),
		},
		language: { kind: "fixed", code: "es" },
		accuracy: 3,
		speed: 5,
		ratingBasis: "estimated",
	},
];

export function presetById(id: string): Preset | undefined {
	return BUILTIN_PRESETS.find((preset) => preset.id === id);
}

export function defaultPreset(): Preset {
	const preset = presetById(DEFAULT_SELECTION.presetId);
	if (!preset) throw new Error(`default preset ${DEFAULT_SELECTION.presetId} is missing`);
	return preset;
}

export function presetsInSection(section: ModelSection): Preset[] {
	return BUILTIN_PRESETS.filter((preset) => preset.section === section);
}

export function labelForLanguage(code: string): string {
	return languages[code] ?? code;
}

/**
 * Keep a stored language valid for the preset. A fixed or auto-only model
 * ignores whatever was stored, and an unsupported choice falls back to the
 * model's default.
 */
export function normalizeLanguage(preset: Preset, language: string | undefined): string {
	const mode = preset.language;
	if (mode.kind === "fixed") return mode.code;
	if (mode.kind === "auto") return "auto";
	if (!language) return mode.default;
	if (language === "auto") return mode.allowAuto ? "auto" : mode.default;
	return mode.codes.includes(language) ? language : mode.default;
}

export function isLanguageSupported(preset: Preset, code: string): boolean {
	const mode = preset.language;
	if (mode.kind === "fixed") return code === mode.code;
	if (mode.kind === "auto") return code === "auto";
	return code === "auto" ? mode.allowAuto : mode.codes.includes(code);
}
