/**
 * Audio from a socket instead of a device.
 *
 * The machine with the microphone runs a helper that records it and serves
 * 16 kHz mono signed 16-bit little-endian PCM. SSH forwards the helper's port
 * to this process, so dictation works on a host whose own microphone is
 * unusable, including one with none at all.
 */
import net from "node:net";
import type { Microphone } from "./capture.ts";
import { int16ToFloat32 } from "./pcm.ts";

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
): Promise<Microphone> {
	const { host, port } = parseTarget(target);
	const socket = net.connect({ host, port });
	let opened = false;
	let stopped = false;
	let reported = false;
	/** TCP may split a sample across chunks; the odd byte waits for the next one. */
	let carry = Buffer.alloc(0);

	return new Promise((resolve, reject) => {
		const report = (error: Error): void => {
			if (stopped || reported) return;
			reported = true;
			onError(error);
		};

		socket.once("connect", () => {
			opened = true;
			resolve({
				stop: () => {
					stopped = true;
					socket.destroy();
				},
			});
		});

		socket.on("data", (chunk: Buffer) => {
			const buffer = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
			const even = buffer.length - (buffer.length % 2);
			carry = buffer.subarray(even);
			if (even > 0) onSamples(int16ToFloat32(buffer.subarray(0, even)));
		});

		socket.once("error", (error: Error) => {
			if (!opened) {
				reject(error);
				return;
			}
			report(error);
		});

		// A helper that exits mid-dictation must not leave a silent session.
		for (const event of ["end", "close"] as const) {
			socket.once(event, () => {
				if (!opened) return;
				report(new Error("audio stream ended"));
			});
		}
	});
}
