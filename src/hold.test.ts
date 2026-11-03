/**
 * Drives the space state machine with a fake editor and fake sessions. The pi
 * packages come from the host, so these tests skip when they are not installed.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { REPEAT_GAP_MS, RELEASE_GAP_MS } from "./config.ts";

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
const REPEAT = "\x1b[32;1:2u";
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

/** Simulate a terminal without the kitty protocol: a bare space press. */
function plainPress(hold: InstanceType<typeof import("./hold.ts").SpaceHold>, editor: FakeEditor): void {
	hold.handle(" ");
	editor.typeSpace();
}

test("the first hold after startup dictates", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(40);
		assert.equal(hold.handle(REPEAT), true, "the repeat is consumed");

		await flush();
		assert.equal(sessions.length, 1, `session started; buffer=${JSON.stringify(editor.text)}`);
		assert.equal(editor.text, "", "the space the press typed is taken back");

		hold.handle(RELEASE);
		assert.equal(sessions[0]?.stopped, true);
	} finally {
		mock.timers.reset();
	}
});

test("a tap below the repeat leaves the space", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(120);
		hold.handle(RELEASE);
		await flush();

		assert.equal(sessions.length, 0);
		assert.equal(editor.text, " ");
	} finally {
		mock.timers.reset();
	}
});

test("held-key repeats keep dictating and type nothing", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(40);
		hold.handle(REPEAT);
		await flush();

		assert.equal(sessions.length, 1);
		for (let i = 0; i < 5; i++) {
			mock.timers.tick(30);
			assert.equal(hold.handle(REPEAT), true);
		}
		assert.equal(sessions[0]?.stopped, false, "repeats are not a new press");
		assert.equal(editor.text, "");
	} finally {
		mock.timers.reset();
	}
});

test("a plain-space repeat holds without key releases", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		// The Linux console sends presses only: no release ever tells a tap from
		// a hold, but the auto-repeat does.
		plainPress(hold, editor);
		mock.timers.tick(40);
		assert.equal(hold.handle(" "), true, "the repeat is consumed");

		await flush();
		assert.equal(sessions.length, 1);
		assert.equal(editor.text, "");
	} finally {
		mock.timers.reset();
	}
});

test("a slow second press is a new tap, not a hold", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(REPEAT_GAP_MS + 10);
		press(hold, editor);
		await flush();

		assert.equal(sessions.length, 0);
		assert.equal(editor.text, "  ", "both spaces stay");
	} finally {
		mock.timers.reset();
	}
});

test("a slow first repeat leaves one space before dictating", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		plainPress(hold, editor);
		// The first repeat waits for the keyboard's repeat delay.
		mock.timers.tick(400);
		plainPress(hold, editor);
		mock.timers.tick(40);
		assert.equal(hold.handle(" "), true);

		await flush();
		assert.equal(sessions.length, 1);
		assert.equal(editor.text, " ", "the slow first repeat's space stays");
	} finally {
		mock.timers.reset();
	}
});

test("a release ends the session", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(40);
		hold.handle(REPEAT);
		await flush();
		hold.handle(RELEASE);

		assert.equal(sessions[0]?.stopped, true);
		assert.equal(editor.text, "");
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
		mock.timers.tick(40);
		hold.handle(REPEAT); // begin takes the space back, then waits for the model
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
		mock.timers.tick(40);
		hold.handle(REPEAT);
		await flush();
		assert.equal(sessions.length, 1);

		// The terminal dropped the release; the next press is a new key.
		mock.timers.tick(RELEASE_GAP_MS + 50);
		assert.equal(hold.handle(PRESS), true);
		await flush();

		assert.equal(sessions[0]?.stopped, true, "the lost release must close the session");
		assert.equal(editor.text, "", "the stopping press is not typed");
	} finally {
		mock.timers.reset();
	}
});

test("a space typed after dictation stays", { skip }, async () => {
	const { editor, hold, sessions } = harness();
	try {
		press(hold, editor);
		mock.timers.tick(40);
		hold.handle(REPEAT);
		await flush();
		hold.handle(RELEASE);
		mock.timers.tick(RELEASE_GAP_MS);

		press(hold, editor);
		assert.equal(sessions.length, 1, "a new session needs a repeat");
		assert.equal(editor.text, " ");
	} finally {
		mock.timers.reset();
	}
});
