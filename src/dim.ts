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
 *
 * Pi appends an ANSI reset to every rendered line, so a single dim pair cannot
 * span a line break. Each line reopens and closes dim around its own segment.
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

	const ranges = new Map<number, { start: number; end: number }>();
	for (const target of targets) {
		const range = ranges.get(target.line);
		if (!range) {
			ranges.set(target.line, { start: target.at, end: target.at + target.length });
			continue;
		}
		range.start = Math.min(range.start, target.at);
		range.end = Math.max(range.end, target.at + target.length);
	}

	const out = [...lines];
	for (const [lineIndex, range] of ranges) {
		let line = out[lineIndex] ?? "";
		// Close first, then open: the start index is still valid after the first
		// insertion because it is earlier in the line.
		line = line.slice(0, range.end) + DIM_OFF + line.slice(range.end);
		line = line.slice(0, range.start) + DIM_ON + line.slice(range.start);
		out[lineIndex] = line;
	}
	return out;
}
