/**
 * Dim the uncommitted transcript: the N characters just before the cursor.
 *
 * The editor renders the cursor as zero-width APC markers around one character,
 * so the end of the open text is unambiguous. Everything else here is ANSI
 * bookkeeping: escape sequences are zero-width, so they must not be counted.
 */
const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
const ANSI = /\x1b(?:\[[0-9;?]*[A-Za-z]|_pi:[^\x07]*\x07)/y;

const DIM_ON = "\x1b[2m";
const DIM_OFF = "\x1b[22m";

/** Visible characters of a line, with the string index where each starts. */
function visibleChars(line: string): Array<{ text: string; at: number }> {
	const out: Array<{ text: string; at: number }> = [];
	let at = 0;
	while (at < line.length) {
		ANSI.lastIndex = at;
		const escape = ANSI.exec(line);
		if (escape) {
			at += escape[0].length;
			continue;
		}
		const char = String.fromCodePoint(line.codePointAt(at) ?? 0);
		out.push({ text: char, at });
		at += char.length;
	}
	return out;
}

/**
 * Wrap the `count` visible characters before the cursor in dim, per line.
 * Returns the input untouched when the cursor cannot be found or `count` is 0.
 */
export function dimBeforeCursor(lines: readonly string[], count: number): string[] {
	if (count <= 0) return lines as string[];

	const cursorLine = lines.findIndex((line) => line.includes(FAKE_CURSOR_START));
	if (cursorLine === -1) return lines as string[];

	// Characters before the cursor, walking back from the cursor line.
	const targets: Array<{ line: number; at: number; length: number }> = [];
	let remaining = count;

	for (let lineIndex = cursorLine; lineIndex >= 0 && remaining > 0; lineIndex--) {
		const chars = visibleChars(lines[lineIndex] ?? "");
		let limit = chars.length;
		if (lineIndex === cursorLine) {
			const markerAt = (lines[lineIndex] ?? "").indexOf(FAKE_CURSOR_START);
			limit = chars.filter((char) => char.at < markerAt).length;
		}
		for (let i = limit - 1; i >= 0 && remaining > 0; i--) {
			const char = chars[i];
			if (!char) continue;
			targets.push({ line: lineIndex, at: char.at, length: char.text.length });
			remaining--;
		}
	}
	if (targets.length === 0) return [...lines];

	const first = targets[targets.length - 1];
	const last = targets[0];
	if (!first || !last) return [...lines];

	const byLine = new Map<number, Array<{ at: number; text: string }>>();
	const push = (line: number, at: number, text: string) => {
		const list = byLine.get(line) ?? [];
		list.push({ at, text });
		byLine.set(line, list);
	};
	push(first.line, first.at, DIM_ON);
	push(last.line, last.at + last.length, DIM_OFF);

	const out = [...lines];
	for (const [lineIndex, insertions] of byLine) {
		let line = out[lineIndex] ?? "";
		// Right to left so earlier indices stay valid.
		for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) {
			line = line.slice(0, insertion.at) + insertion.text + line.slice(insertion.at);
		}
		out[lineIndex] = line;
	}
	return out;
}
