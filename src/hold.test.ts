/**
 * Drives the space state machine with a fake editor and fake sessions. The pi
 * packages come from the host, so these tests skip when they are not installed.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { HOLD_MS, RELEASE_GAP_MS } from "./config.ts";

type PiTui = typeof import("@earendil-works/pi-tui");

let tui: PiTui | undefined;
try {
	tui = await import("@earendil-works/pi-tui");
} catch {
	// The pi packages come from the host; skip when they are not installed.
}

const { SpaceHold } = (await import("./hold.ts").catch(() => ({}))) as {
	SpaceHold?: typeof import("./hold.ts").SpaceHold;
};

const PRESS = "\x1b[32u";
const RELEASE = "\x1b[32;1:3u";
const skip = !tui || !SpaceHold;

type FakeEditor = {
	focused: boolean;
	text: string;
	cursor: number;
	getText(): string;
	insertionOffset(): number;
	deleteBackward(): void;
	typeSpace(): void;
	writeAtCursor(text: string, cursorOffset: number, partialLength: number): void;
};

function makeEditor(): FakeEditor {
	return {
		focused: true,
		text: "",
		cursor: 0,
		getText() {
			return this.text;
		},
		insertionOffset() {
			return this.cursor;
		},
		deleteBackward() {
			this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
			this.cursor = Math.max(0, this.cursor - 1);
		},
		typeSpace() {
			this.text = this.text.slice(0, this.cursor) + " " + this.text.slice(this.cursor);
			this.cursor++;
		},
		writeAtCursor(text, cursorOffset) {
			this.text = text;
			this.cursor = cursorOffset;
		},
	};
}

type FakeSession = {
	active: boolean;
	started: boolean;
	stopped: boolean;
	start(): Promise<void>;
	stop(): Promise<boolean>;
	isActive(): boolean;
	cancel(): void;
};

function harness(getStt: () => Promise<unknown> = async () => ({})) {
	mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const editor = makeEditor();
	const sessions: FakeSession[] = [];
	const hold = new SpaceHold!({
		getEditor: () => editor as never,
		getStt: getStt as never,
		notify: () => {},
		status: () => {},
		indicator: (state, filled) => `${filled ? "●" : "○"} ${state === "loading" ? "loading model" : "listening"}`,
		createSession: () => {
			const session: FakeSession = {
				active: false,
				started: false,
				stopped: false,
				async start() {
					session.started = true;
					session.active = true;
				},
				async stop() {
					session.stopped = true;
					session.active = false;
					return true;
				},
				isActive: () => session.active,
				cancel: () => {
					session.stopped = true;
					session.active = false;
				},
			};
			sessions.push(session);
			return session as never;
		},
	});
	return { editor, hold, sessions };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Simulate the editor receiving a space the hold handler did not consume. */
function press(hold: InstanceType<typeof import("./hold.ts").SpaceHold>, editor: FakeEditor): void {
	hold.handle(PRESS);
	editor.typeSpace();
}

test("a hold right after typing dictates", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		hold.handle("a"); // typing no longer blocks a hold
		editor.text = "a";
		editor.cursor = 1;

		press(hold, editor);
		mock.timers.tick(HOLD_MS + 10);
		await flush();

		assert.equal(sessions.length, 1, `session started; buffer=${JSON.stringify(editor.text)}`);
		hold.handle(RELEASE);
		assert.equal(sessions[0]?.stopped, true);
	} finally {
		mock.timers.reset();
	}
});

test("a tap below the hold threshold leaves the space", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(HOLD_MS - 10);
		hold.handle(RELEASE);
		await flush();

		assert.equal(sessions.length, 0);
		assert.equal(editor.text, " ");
	} finally {
		mock.timers.reset();
	}
});

test("cancel while the model loads leaves no stray space", { skip }, async () => {
	let releaseStt!: () => void;
	const stt = new Promise<void>((resolve) => (releaseStt = resolve));
	const { editor, hold, sessions } = harness(async () => {
		await stt;
		return {};
	});
	try {
		press(hold, editor);
		mock.timers.tick(HOLD_MS + 10); // begin takes back the space, then waits
		hold.cancel(); // e.g. the prompt was submitted
		releaseStt();
		await flush();

		assert.equal(sessions.length, 0);
		assert.equal(editor.text, "");
	} finally {
		mock.timers.reset();
	}
});

test("a lost release does not leave the microphone open", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(HOLD_MS + 10);
		await flush();
		assert.equal(sessions.length, 1);

		// The terminal dropped the release; the next press is a new key.
		mock.timers.tick(RELEASE_GAP_MS + 50);
		hold.handle(PRESS);
		await flush();

		assert.equal(sessions[0]?.stopped, true, "the lost release must close the session");
		assert.equal(editor.text, "", "the stopping press is not typed");
	} finally {
		mock.timers.reset();
	}
});

test("held-key repeats keep dictating", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		for (let i = 0; i < 40; i++) {
			mock.timers.tick(30);
			hold.handle(PRESS);
		}
		await flush();

		assert.equal(sessions.length, 1);
		assert.equal(sessions[0]?.stopped, false, "repeats are not a new press");
		hold.handle(RELEASE);
		assert.equal(sessions[0]?.stopped, true);
	} finally {
		mock.timers.reset();
	}
});

test("a slow first repeat is not a new press", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		// Some keyboards wait 250-660 ms before the first repeat.
		mock.timers.tick(RELEASE_GAP_MS + 60);
		hold.handle(PRESS);
		mock.timers.tick(HOLD_MS);
		await flush();

		assert.equal(sessions.length, 1, "the hold still starts");
		assert.equal(editor.text, "", "no stray space from the repeat");
		hold.handle(RELEASE);
	} finally {
		mock.timers.reset();
	}
});
