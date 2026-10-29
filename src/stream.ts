/**
 * Audio from a socket instead of a device.
 *
 * The machine with the microphone runs a helper that records it, starts each
 * stream with a `pi-mic <host>` line, and then sends 16 kHz mono signed 16-bit
 * little-endian PCM. SSH forwards the helper's port to this process, so
 * dictation works on a host whose own microphone is unusable, including one
 * with none at all. The greeting lets a caller skip ports that a stale SSH
 * session or another machine answers, and it names the machine that records.
 */
import net from "node:net";
import type { Microphone } from "./capture.ts";
import { int16ToFloat32 } from "./pcm.ts";

/** Every failure a connected socket reports starts with this. */
export const STREAM_FAILED = "audio stream ";

/** How long a listener has to identify itself before it counts as absent. */
const HELLO_MS = 1000;

/** A greeting is one short line; anything longer is not a helper. */
const HELLO_MAX = 128;

/** Parses the `host:port` form accepted by `PI_DICTATION_AUDIO`. */
export function parseTarget(target: string): { host: string; port: number } {
	const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(target.trim());
	if (!match) throw new Error(`expected host:port, got "${target}"`);
	const port = Number(match[2]);
	if (port < 1 || port > 65535) throw new Error(`port out of range: ${port}`);
	return { host: (match[1] ?? "").replace(/^\[|\]$/g, ""), port };
}

export function openStream(
	target: string,
	onSamples: (samples: Float32Array) => void,
	onError: (error: Error) => void,
	helloMs = HELLO_MS,
): Promise<Microphone> {
	const { host, port } = parseTarget(target);
	const socket = net.connect({ host, port });
	let opened = false;
	let stopped = false;
	let reported = false;
	/** Before the greeting: the line so far. After it: a sample split across chunks. */
	let buffer = Buffer.alloc(0);

	return new Promise((resolve, reject) => {
		let timer: NodeJS.Timeout | undefined;
		const report = (error: Error): void => {
			if (stopped || reported) return;
			reported = true;
			onError(error);
		};

		const fail = (message: string): void => {
			clearTimeout(timer);
			socket.destroy();
			reject(new Error(`${STREAM_FAILED}${message}`));
		};

		const greet = (line: string): void => {
			const match = /^pi-mic (\S+)$/.exec(line.trim());
			if (!match) {
				fail("sent no helper greeting");
				return;
			}
			opened = true;
			clearTimeout(timer);
			resolve({
				client: match[1],
				stop: () => {
					stopped = true;
					socket.destroy();
				},
			});
		};

		const samples = (chunk: Buffer): void => {
			const joined = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
			const even = joined.length - (joined.length % 2);
			buffer = joined.subarray(even);
			if (even > 0) onSamples(int16ToFloat32(joined.subarray(0, even)));
		};

		socket.once("connect", () => {
			timer = setTimeout(() => fail("did not identify itself"), helloMs);
		});

		socket.on("data", (chunk: Buffer) => {
			if (opened) {
				samples(chunk);
				return;
			}
			buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
			const end = buffer.indexOf(0x0a);
			if (end === -1) {
				if (buffer.length > HELLO_MAX) fail("sent no helper greeting");
				return;
			}
			const line = buffer.subarray(0, end).toString("utf8");
			const rest = buffer.subarray(end + 1);
			buffer = Buffer.alloc(0);
			greet(line);
			if (opened && rest.length > 0) samples(rest);
		});
		socket.once("error", (error: Error) => {
			clearTimeout(timer);
			if (!opened) {
				// A refusal never connected; anything else failed after connecting.
				reject(new Error(error.message.startsWith("connect ") ? error.message : `${STREAM_FAILED}failed: ${error.message}`));
				return;
			}
			report(error);
		});

		// A helper that exits mid-dictation must not leave a silent session.
		for (const event of ["end", "close"] as const) {
			socket.once(event, () => {
				if (!opened) {
					fail("closed before its greeting");
					return;
				}
				report(new Error("audio stream ended"));
			});
		}
	});
}
