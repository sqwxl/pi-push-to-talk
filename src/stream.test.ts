/**
 * Drives the socket capture source against a real loopback server, which is
 * the only way to see how chunk boundaries, greetings, and disconnects behave.
 */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { openStream, parseTarget } from "./stream.ts";

const HELLO = "pi-mic t14\n";

const pcm = (...values: number[]): Buffer => {
	const buffer = Buffer.alloc(values.length * 2);
	values.forEach((value, index) => buffer.writeInt16LE(Math.round(value * 32767), index * 2));
	return buffer;
};

async function listen(onSocket: (socket: net.Socket) => void): Promise<net.Server> {
	const server = net.createServer(onSocket);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return server;
}

function port(server: net.Server): number {
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return address.port;
}

const close = (server: net.Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

test("host:port targets are parsed and bad ones rejected", () => {
	assert.deepEqual(parseTarget("127.0.0.1:47777"), { host: "127.0.0.1", port: 47777 });
	assert.deepEqual(parseTarget(" [::1]:47777 "), { host: "::1", port: 47777 });
	assert.throws(() => parseTarget("127.0.0.1"), /expected host:port/);
	assert.throws(() => parseTarget("127.0.0.1:99999"), /port out of range/);
});

test("samples arrive as floats and the client is named", async () => {
	const server = await listen((socket) => socket.write(Buffer.concat([Buffer.from(HELLO), pcm(0.5, -0.5, 0.25)])));
	const samples: number[] = [];
	try {
		const mic = await openStream(`127.0.0.1:${port(server)}`, (chunk) => samples.push(...chunk), () => {});
		assert.equal(mic.client, "t14");
		await settle();
		mic.stop();
		assert.equal(samples.length, 3);
		assert.ok(Math.abs((samples[0] ?? 0) - 0.5) < 0.01, `first=${samples[0]}`);
		assert.ok(Math.abs((samples[1] ?? 0) + 0.5) < 0.01, `second=${samples[1]}`);
	} finally {
		await close(server);
	}
});

test("a greeting split across chunks still opens the stream", async () => {
	const server = await listen((socket) => {
		socket.write(Buffer.from("pi-m"));
		setTimeout(() => socket.write(Buffer.from("ic t14\n")), 20);
		setTimeout(() => socket.write(pcm(0.1)), 40);
	});
	const samples: number[] = [];
	try {
		const mic = await openStream(`127.0.0.1:${port(server)}`, (chunk) => samples.push(...chunk), () => {});
		assert.equal(mic.client, "t14");
		await settle();
		mic.stop();
		assert.equal(samples.length, 1);
	} finally {
		await close(server);
	}
});

test("a sample split across chunks is kept whole", async () => {
	const buffer = pcm(0.5, -0.5);
	const server = await listen((socket) => {
		socket.write(Buffer.from(HELLO));
		setTimeout(() => socket.write(buffer.subarray(0, 3)), 20);
		setTimeout(() => socket.write(buffer.subarray(3)), 40);
	});
	const samples: number[] = [];
	try {
		const mic = await openStream(`127.0.0.1:${port(server)}`, (chunk) => samples.push(...chunk), () => {});
		await settle();
		mic.stop();
		assert.equal(samples.length, 2);
	} finally {
		await close(server);
	}
});

test("a refused connection rejects instead of resolving", async () => {
	const server = await listen(() => {});
	const free = port(server);
	await close(server);
	await assert.rejects(openStream(`127.0.0.1:${free}`, () => {}, () => {}));
});

test("a listener that sends no greeting is not a microphone", async () => {
	const noise = Buffer.alloc(200, 7);
	const server = await listen((socket) => socket.write(noise));
	try {
		await assert.rejects(openStream(`127.0.0.1:${port(server)}`, () => {}, () => {}), /sent no helper greeting/);
	} finally {
		await close(server);
	}
});

test("a forward that closes without a greeting rejects", async () => {
	const server = await listen((socket) => socket.end());
	try {
		await assert.rejects(openStream(`127.0.0.1:${port(server)}`, () => {}, () => {}), /closed before its greeting/);
	} finally {
		await close(server);
	}
});

test("a silent connection rejects instead of pretending to record", async () => {
	const server = await listen(() => {});
	try {
		await assert.rejects(
			openStream(`127.0.0.1:${port(server)}`, () => {}, () => {}, 50),
			/did not identify itself/,
		);
	} finally {
		await close(server);
	}
});

test("a stream that ends mid-dictation reports an error", async () => {
	const server = await listen((socket) => socket.end(Buffer.concat([Buffer.from(HELLO), pcm(0.5)])));
	const errors: string[] = [];
	try {
		const mic = await openStream(`127.0.0.1:${port(server)}`, () => {}, (error) => errors.push(error.message));
		await settle();
		mic.stop();
		assert.deepEqual(errors, ["audio stream ended"]);
	} finally {
		await close(server);
	}
});

test("stopping does not report the closed stream as a failure", async () => {
	const server = await listen((socket) => socket.write(Buffer.concat([Buffer.from(HELLO), pcm(0.1)])));
	const errors: string[] = [];
	try {
		const mic = await openStream(`127.0.0.1:${port(server)}`, () => {}, (error) => errors.push(error.message));
		mic.stop();
		await settle();
		assert.deepEqual(errors, []);
	} finally {
		await close(server);
	}
});
