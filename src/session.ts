/**
 * One dictation stretch: mic -> segmenter -> recognizer -> editor region.
 *
 * The region is created on key press and frozen on release. Nothing outside it
 * is ever rewritten, so the rest of the buffer stays the user's.
 */
import { openMicrophone, type Microphone } from "./capture.ts";
import { LISTENING_BLINK_MS, MIN_PHRASE_MS, MIN_PHRASE_RMS, PARTIAL_INTERVAL_MS, msToSamples } from "./config.ts";
import { trace } from "./debug.ts";
import { commitPartial, joinText, regionCursorOffset, renderRegion, withPartial, type Region } from "./region.ts";
import { Segmenter, rmsOf } from "./segmenter.ts";
import type { Stt } from "./stt.ts";
import { cleanTranscript } from "./transcript.ts";

export type SessionUi = {
	/** Replace the editor text, place the cursor at `cursorOffset`, dim `partialLength` before it. */
	write(text: string, cursorOffset: number, partialLength: number): void;
	status(text: string | undefined): void;
	/** Indicator text for a blink phase, already coloured. */
	indicator(state: "loading" | "listening", filled: boolean): string;
	notify(message: string, level: "info" | "warning" | "error"): void;
};

const MIN_PHRASE_SAMPLES = msToSamples(MIN_PHRASE_MS);

/** Whisper ends a decode with a full stop; mid-session that is not the sentence end. */
const TRAILING_PERIOD = /\.\s*$/;

export class DictationSession {
	private readonly stt: Promise<Stt>;
	private readonly ui: SessionUi;
	private readonly openMic: typeof openMicrophone;
	private region: Region | undefined;
	private mic: Microphone | undefined;
	private segmenter = new Segmenter();
	private timer: ReturnType<typeof setInterval> | undefined;
	private listeningTimer: ReturnType<typeof setInterval> | undefined;
	private listeningFilled = true;
	/** The recognizer is still loading until this flips; the indicator says so. */
	private modelReady = false;
	private pending = 0;
	private inFlight = new Set<Promise<void>>();
	private stopPromise: Promise<boolean> | undefined;
	private stopped = true;
	/** Characters committed during this session, to tell a real result from silence. */
	private committedChars = 0;

	constructor(stt: Stt | Promise<Stt>, ui: SessionUi, openMic: typeof openMicrophone = openMicrophone) {
		this.stt = Promise.resolve(stt);
		this.ui = ui;
		this.openMic = openMic;

		void this.stt.then(
			() => {
				this.modelReady = true;
				if (!this.stopped) this.writeListening();
			},
			// The first decode or stop reports a load failure; keep it handled.
			() => {},
		);
	}

	async start(region: Region): Promise<void> {
		if (!this.stopped) return;
		this.stopped = false;
		this.region = region;
		this.segmenter = new Segmenter();
		this.committedChars = 0;
		this.startListening();

		try {
			this.mic = await this.openMic(
				(samples) => this.onSamples(samples),
				(error) => this.fail(error),
			);
		} catch (error) {
			this.stopped = true;
			this.stopListening();
			this.ui.notify(`Dictation: microphone unavailable (${String(error)})`, "error");
			return;
		}

		// Released while the device was still opening.
		if (this.stopped) {
			this.mic.stop();
			this.mic = undefined;
			return;
		}

		this.timer = setInterval(() => this.track(this.preview()), PARTIAL_INTERVAL_MS);
	}

	isActive(): boolean {
		return !this.stopped;
	}

	/** Decode what is still open, commit it, and close the session. Returns whether anything was transcribed. */
	stop(): Promise<boolean> {
		// Callers can race (a failure and a release); they must share one shutdown
		// so the final write cannot land in a newer session's buffer.
		this.stopPromise ??= this.finish();
		return this.stopPromise;
	}

	private async finish(): Promise<boolean> {
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

		// A phrase that closed just before the release may still be decoding. Its
		// samples left the segmenter, so dropping the result loses that speech.
		while (this.inFlight.size > 0) {
			await Promise.allSettled([...this.inFlight]);
		}

		// If the tail was too short to decode, or its decode returned nothing, the
		// preview is the only transcript of that audio. Commit it, do not wipe it.
		if (this.region && this.region.partial.length > 0) {
			this.commitText(this.region.partial);
			if (this.region.partial.length > 0) {
				this.region = { ...this.region, partial: "" };
				this.write();
			}
		}

		const committed = this.committedChars > 0;
		trace(`stop committed=${String(committed)} chars=${this.committedChars}`);
		this.stopListening();
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
		this.stopListening();
		this.region = undefined;
	}

	private onSamples(samples: Float32Array): void {
		if (this.stopped) return;
		const closed = this.segmenter.add(samples);
		if (!closed) return;
		if (rmsOf(closed.samples) < MIN_PHRASE_RMS) return;
		// A phrase closing while the session is open is not the end of the thought:
		// its trailing full stop is Whisper's, not the speaker's.
		this.track(this.decodePhrase(closed.samples, false));
	}

	private async decodePhrase(samples: Float32Array, final: boolean): Promise<void> {
		this.pending++;
		try {
			const stt = await this.stt;
			const raw = await stt.recognize(samples);
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
			const stt = await this.stt;
			const text = cleanTranscript(await stt.recognize(open));
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

	/** Alternate a filled red circle with an empty one while the session is live. */
	private startListening(): void {
		this.stopListening();
		this.listeningFilled = true;
		this.writeListening();
		this.listeningTimer = setInterval(() => {
			this.listeningFilled = !this.listeningFilled;
			this.writeListening();
		}, LISTENING_BLINK_MS);
	}

	private writeListening(): void {
		this.ui.status(this.ui.indicator(this.modelReady ? "listening" : "loading", this.listeningFilled));
	}

	private stopListening(): void {
		if (this.listeningTimer) {
			clearInterval(this.listeningTimer);
			this.listeningTimer = undefined;
		}
		this.ui.status(undefined);
	}

	/** Keep the speech already captured; a failed stream must not eat the transcript. */
	private fail(error: Error): void {
		this.ui.notify(`Dictation: ${error.message}`, "error");
		void this.stop().catch((stopError: unknown) => {
			trace(`stop after failure failed: ${String(stopError)}`);
		});
	}

	/** Keep the decode visible to `stop` so it can wait for the commit. */
	private track(work: Promise<void>): void {
		const settled = work.then(
			() => {},
			() => {},
		);
		this.inFlight.add(settled);
		void settled.finally(() => this.inFlight.delete(settled));
	}

	private clearTimer(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}
}
