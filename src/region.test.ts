import assert from "node:assert/strict";
import test from "node:test";
import { commitPartial, createRegion, joinText, regionCursorOffset, renderRegion, withPartial } from "./region.ts";

test("region splits the buffer at the cursor and leaves both sides alone", () => {
	const region = createRegion("hello world", 5);
	assert.equal(region.before, "hello");
	assert.equal(region.after, " world");
	assert.equal(renderRegion(region), "hello world");
});

test("a partial replaces the previous partial, not the buffer", () => {
	let region = createRegion("left right", 5);
	region = withPartial(region, "dear");
	region = withPartial(region, "dear friend");
	assert.equal(renderRegion(region), "left dear friend right");
});

test("committing moves the partial into committed text", () => {
	let region = createRegion("", 0);
	region = commitPartial(withPartial(region, "first phrase"));
	region = commitPartial(withPartial(region, "second phrase"));
	assert.equal(renderRegion(region), "first phrase second phrase");
	assert.equal(regionCursorOffset(region), "first phrase second phrase".length);
});

test("joining never doubles a space and never glues words", () => {
	assert.equal(joinText("", "x"), "x");
	assert.equal(joinText("a ", "b"), "a b");
	assert.equal(joinText("a", " b"), "a b");
	assert.equal(joinText("a", "b"), "a b");
});

test("empty partials commit nothing", () => {
	const region = commitPartial(withPartial(createRegion("x", 1), "   "));
	assert.equal(renderRegion(region), "x");
});
