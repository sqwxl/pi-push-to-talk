/** Installer behavior, driven by a local HTTP server instead of Hugging Face. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensurePreset, presetDir, presetReady } from "./model.ts";
import type { Preset } from "./presets.ts";

type Server = { base: string; requests: string[]; close: () => Promise<void> };

async function serve(files: Record<string, string>): Promise<Server> {
	const requests: string[] = [];
	const server = http.createServer((request, response) => {
		const name = (request.url ?? "/").slice(1);
		requests.push(name);
		const body = files[name];
		if (body === undefined) {
			response.statusCode = 404;
			response.end("missing");
			return;
		}
		response.setHeader("content-length", Buffer.byteLength(body));
		response.end(body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no server address");
	return {
		base: `http://127.0.0.1:${address.port}`,
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

function testPreset(base: string): Preset {
	return {
		id: "test-model",
		label: "Test Model",
		section: "english",
		size: "1 KB",
		family: "whisper",
		files: { encoder: "encoder.onnx", tokens: "tokens.txt" },
		urls: { encoder: `${base}/encoder`, tokens: `${base}/tokens` },
		language: { kind: "fixed", code: "en" },
		accuracy: 3,
		speed: 3,
		ratingBasis: "estimated",
	};
}

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-ptt-"));
}

test("readiness requires every file, non-empty", () => {
	const dir = tempDir();
	try {
		const preset = testPreset("http://127.0.0.1:1");
		assert.equal(presetReady(preset, presetDir(preset, dir)), false, "nothing on disk");
		fs.mkdirSync(presetDir(preset, dir), { recursive: true });
		fs.writeFileSync(path.join(presetDir(preset, dir), "encoder.onnx"), "x");
		assert.equal(presetReady(preset, presetDir(preset, dir)), false, "tokens still missing");
		fs.writeFileSync(path.join(presetDir(preset, dir), "tokens.txt"), "");
		assert.equal(presetReady(preset, presetDir(preset, dir)), false, "empty file is not ready");
		fs.writeFileSync(path.join(presetDir(preset, dir), "tokens.txt"), "tokens");
		assert.equal(presetReady(preset, presetDir(preset, dir)), true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("missing files are downloaded, existing files are skipped", async () => {
	const server = await serve({ tokens: "tokens" });
	const dir = tempDir();
	try {
		const preset = testPreset(server.base);
		const modelDir = presetDir(preset, dir);
		fs.mkdirSync(modelDir, { recursive: true });
		fs.writeFileSync(path.join(modelDir, "encoder.onnx"), "already here");

		const progress: string[] = [];
		const result = await ensurePreset(preset, { root: dir, onProgress: (message) => progress.push(message) });
		assert.equal(result, modelDir);
		assert.equal(fs.readFileSync(path.join(modelDir, "tokens.txt"), "utf8"), "tokens");
		assert.equal(fs.readFileSync(path.join(modelDir, "encoder.onnx"), "utf8"), "already here");
		assert.deepEqual(server.requests, ["tokens"]);
		assert.equal(fs.existsSync(path.join(modelDir, "tokens.txt.part")), false);
		assert.ok(progress.some((message) => message.includes("Test Model")), progress.join("\n"));
	} finally {
		await server.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("an HTTP failure rejects and leaves no partial file", async () => {
	const server = await serve({ encoder: "encoder" });
	const dir = tempDir();
	try {
		const preset = testPreset(server.base);
		await assert.rejects(() => ensurePreset(preset, { root: dir }), /HTTP 404/);
		const modelDir = presetDir(preset, dir);
		assert.equal(fs.existsSync(path.join(modelDir, "encoder.onnx.part")), false);
		assert.equal(fs.existsSync(path.join(modelDir, "tokens.txt")), false);
	} finally {
		await server.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("aborting stops the download and removes the partial file", async () => {
	const server = http.createServer(() => {
		// Never answer: the fetch stays in flight until the signal aborts it.
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no server address");
	const base = `http://127.0.0.1:${address.port}`;
	const dir = tempDir();
	try {
		const preset = testPreset(base);
		const controller = new AbortController();
		const run = ensurePreset(preset, { root: dir, signal: controller.signal });
		controller.abort();
		await assert.rejects(() => run);
		const modelDir = presetDir(preset, dir);
		assert.equal(fs.existsSync(path.join(modelDir, "encoder.onnx.part")), false);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
