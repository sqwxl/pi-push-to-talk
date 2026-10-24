/**
 * The text region the current dictation owns.
 *
 * `before` and `after` are frozen when the key is pressed, so the rest of the
 * buffer is never rewritten. Only `committed` + `partial` change while the key
 * is held.
 */
export type Region = {
	before: string;
	committed: string;
	partial: string;
	after: string;
};

/** True when two pieces would glue together without a space. */
const needsSpace = (left: string, right: string): boolean =>
	left.length > 0 && right.length > 0 && !/\s$/.test(left) && !/^\s/.test(right);

/** Join two pieces with a space unless the seam is already whitespace. */
export function joinText(left: string, right: string): string {
	return needsSpace(left, right) ? `${left} ${right}` : left + right;
}

export function createRegion(text: string, offset: number): Region {
	const at = Math.max(0, Math.min(offset, text.length));
	return { before: text.slice(0, at), committed: "", partial: "", after: text.slice(at) };
}

export function withPartial(region: Region, partial: string): Region {
	return { ...region, partial };
}

export function commitPartial(region: Region): Region {
	if (region.partial.trim().length === 0) return { ...region, partial: "" };
	return { ...region, committed: joinText(region.committed, region.partial.trim()), partial: "" };
}

const renderHead = (region: Region): string => joinText(joinText(region.before, region.committed), region.partial);

export function renderRegion(region: Region): string {
	return joinText(renderHead(region), region.after);
}

/** Where the cursor belongs: right after the text this session owns. */
export function regionCursorOffset(region: Region): number {
	return renderHead(region).length;
}
