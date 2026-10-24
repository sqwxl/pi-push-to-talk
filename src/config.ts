import os from "node:os";
import path from "node:path";

export const SAMPLE_RATE = 16000;

/** How often the still-open phrase is re-decoded for the live preview. */
export const PARTIAL_INTERVAL_MS = 1000;

/**
 * Silence that closes a phrase.
 *
 * Long on purpose: a pause mid-sentence is the speaker thinking, not the end of
 * a thought. Cutting there splits words across two decodes, which is where lost
 * and reordered words come from. The 12 s cap still bounds a non-stop stretch.
 */
export const SILENCE_COMMIT_MS = 2500;

/** Trailing silence kept with a phrase so its last word is not clipped. */
export const TAIL_PAD_MS = 300;

/** Shorter buffers are not worth a decode. */
export const MIN_PHRASE_MS = 400;

/** Longest phrase sent to the recognizer in one piece. */
export const MAX_PHRASE_MS = 12000;

/** Window scanned for the quietest point when the cap fires. */
export const CAP_CUT_SCAN_MS = 800;

/** Mean level below which a buffer counts as silence, not speech. */
export const MIN_PHRASE_RMS = 0.005;

/** SPACE held this long starts dictating. */
export const HOLD_MS = 350;

/** A space this soon after typing stays a space (pi-voicekit's value). */
export const TYPING_COOLDOWN_MS = 400;

export const MODEL_DIR = path.join(os.homedir(), ".pi", "models", "whisper-base");

export const msToSamples = (ms: number): number => Math.round((SAMPLE_RATE * ms) / 1000);
