/**
 * Transcript cleanup.
 *
 * Whisper captions non-speech instead of returning nothing: `[Music]`,
 * `(footsteps)`, `♪`. Those come from near-silent audio, which the level gate
 * is supposed to reject — it cannot on a stream with a DC offset, so the
 * artifacts are removed after decoding as well.
 */

/** Bracketed annotations, musical notes, and repeated punctuation. */
const CAPTION = /[\[(][^\])]*[\])]/g;
const MUSIC = /[♪♫♬♩]/g;
/** Stray brackets left behind by a caption or by decoded noise. */
const STRAY_BRACKET = /[\[\]]/g;

export function cleanTranscript(text: string): string {
	return text
		.replace(CAPTION, " ")
		.replace(MUSIC, " ")
		.replace(STRAY_BRACKET, " ")
		.replace(/\s+/g, " ")
		.replace(/\s+([,.!?;:])/g, "$1")
		.trim();
}
