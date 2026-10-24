/**
 * One dictation stretch: mic -> segmenter -> recognizer -> editor region.
 *
 * The region is created on key press and frozen on release. Nothing outside it
 * is ever rewritten, so the rest of the buffer stays the user's.
 */
import { openMicrophone, type Microphone } from "./capture.ts";
import { MIN_PHRASE_MS, MIN_PHRASE_RMS, PARTIAL_INTERVAL_MS, msToSamples } from "./config.ts";
import { trace } from "./debug.ts";
import { commitPartial, joinText, regionCursorOffset, renderRegion, withPartial, type Region } from "./region.ts";
import { Segmenter, rmsOf } from "./segmenter.ts";
import type { Stt } from "./stt.ts";
import { cleanTranscript } from "./transcript.ts";

export type SessionUi = {
	/** Replace the editor text, place the cursor at `cursorOffset`, dim `partialLength` before it. */
	write(text: string, cursorOffset: number, partialLength: number): void;
	status(text: string | undefined): void;
	notify(message: string, level: "info" | "warning" | "error"): void;
};

const MIN_PHRASE_SAMPLES = msToSamples(MIN_PHRASE_MS);

/** Whisper ends a decode with a full stop; mid-session that is not the sentence end. */
const TRAILING_PERIOD = /\.\s*$/;

export class DictationSession {
	private readonly stt: Stt;
	private readonly ui: SessionUi;
	private readonly openMic: typeof openMicrophone;
	private region: Region | undefined;
	private mic: Microphone | undefined;
	private segmenter = new Segmenter();
	private timer: ReturnType<typeof setInterval> | undefined;
	private pending = 0;
	private stopped = true;
	/** Characters committed during this session, to tell a real result from silence. */
	private committedChars = 0;

	constructor(stt: Stt, ui: SessionUi, openMic: typeof openMicrophone = openMicrophone) {
		this.stt = stt;
		this.ui = ui;
		this.openMic = openMic;
	}

	async start(region: Region): Promise<void> {
		if (!this.stopped) return;
		this.stopped = false;
		this.region = region;
		this.segmenter = new Segmenter();
		this.committedChars = 0;
		this.ui.status("MIC listening");

		try {
			this.mic = await this.openMic(
				(samples) => this.onSamples(samples),
				(error) => this.fail(error),
			);
		} catch (error) {
			this.stopped = true;
			this.ui.status(undefined);
			this.ui.notify(`Dictation: microphone unavailable (${String(error)})`, "error");
			return;
		}

		// Released while the device was still opening.
		if (this.stopped) {
			this.mic.stop();
			this.mic = undefined;
			return;
		}

		this.timer = setInterval(() => void this.preview(), PARTIAL_INTERVAL_MS);
	}

	isActive(): boolean {
		return !this.stopped;
	}

	/** Decode what is still open, commit it, and close the session. Returns whether anything was transcribed. */
	async stop(): Promise<boolean> {
		if (this.stopped) return false;
		this.stopped = true;
		this.clearTimer();
		this.mic?.stop();
		this.mic = undefined;

		const tail = this.segmenter.open();
		this.segmenter.reset();
		if (tail.length >= MIN_PHRASE_SAMPLES && rmsOf(tail) >= MIN_PHRASE_RMS) {
			await this.decodePhrase(tail, true);
		}

		// A preview of audio that was never committed must not stay in the buffer.
		if (this.region && this.region.partial.length > 0) {
			this.region = { ...this.region, partial: "" };
			this.write();
		}

		const committed = this.committedChars > 0;
		this.ui.status(undefined);
		this.region = undefined;
		return committed;
	}

	/** Abandon the session and remove whatever it wrote. */
	cancel(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.clearTimer();
		this.mic?.stop();
		this.mic = undefined;
		this.segmenter.reset();

		if (this.region && (this.region.committed.length > 0 || this.region.partial.length > 0)) {
			const cleaned = joinText(this.region.before, this.region.after);
			this.ui.write(cleaned, this.region.before.length, 0);
		}
		this.ui.status(undefined);
		this.region = undefined;
	}

	private onSamples(samples: Float32Array): void {
		if (this.stopped) return;
		const closed = this.segmenter.add(samples);
		if (!closed) return;
		if (rmsOf(closed.samples) < MIN_PHRASE_RMS) return;
		// A phrase closing while the session is open is not the end of the thought:
		// its trailing full stop is Whisper's, not the speaker's.
		void this.decodePhrase(closed.samples, false);
	}

	private async decodePhrase(samples: Float32Array, final: boolean): Promise<void> {
		this.pending++;
		try {
			const raw = await this.stt.recognize(samples);
			trace(`phrase ${samples.length} samples final=${String(final)} -> ${JSON.stringify(raw)}`);
			const text = cleanTranscript(raw);
			this.commitText(final ? text : text.replace(TRAILING_PERIOD, ""));
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		} finally {
			this.pending--;
		}
	}

	private async preview(): Promise<void> {
		// Let queued phrases land first so the preview never rewrites newer text.
		if (this.pending > 0 || this.stopped || !this.region) return;
		const open = this.segmenter.open();
		if (open.length < MIN_PHRASE_SAMPLES || rmsOf(open) < MIN_PHRASE_RMS) return;

		this.pending++;
		try {
			const text = cleanTranscript(await this.stt.recognize(open));
			if (this.stopped || !this.region) return;
			this.region = withPartial(this.region, text);
			this.write();
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		} finally {
			this.pending--;
		}
	}

	private commitText(text: string): void {
		const clean = text.trim();
		if (!this.region || clean.length === 0) return;
		this.region = commitPartial(withPartial(this.region, clean));
		this.committedChars += clean.length;
		this.write();
	}

	private write(): void {
		if (!this.region) return;
		this.ui.write(renderRegion(this.region), regionCursorOffset(this.region), this.region.partial.length);
	}

	private fail(error: Error): void {
		this.ui.notify(`Dictation: ${error.message}`, "error");
		this.cancel();
	}

	private clearTimer(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}
}
