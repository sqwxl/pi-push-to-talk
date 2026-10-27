#!/usr/bin/env node
/**
 * Serves this machine's microphone to a remote pi over a loopback TCP port.
 *
 * Start it here, forward the port with SSH, and point the remote pi at it:
 *
 *   node scripts/mic-stream.mjs --port 47777
 *   ssh -N -R 127.0.0.1:47777:127.0.0.1:47777 user@remote
 *   PI_DICTATION_AUDIO=127.0.0.1:47777 pi     # on the remote host
 *
 * One recorder runs per connection, so the microphone is open only while a hold
 * is in progress. The stream is 16 kHz mono signed 16-bit little-endian PCM.
 */
import { spawn } from "node:child_process";
import net from "node:net";

const HELP = `Usage: node mic-stream.mjs [--port N] [--device NAME]

  --port N       loopback port to serve on (default 47777)
  --device NAME  recorder input: ffmpeg avfoundation input on macOS ("0", ":1"),
                 parec source name on Linux

Remote:    ssh -N -R 127.0.0.1:<port>:127.0.0.1:<port> user@host
Then run: PI_DICTATION_AUDIO=127.0.0.1:<port> pi`;

function parseArgs(argv) {
	const options = { port: 47777, device: undefined, help: false };
	for (let i = 0; i < argv.length; i++) {
		const [name, inline] = argv[i].split("=", 2);
		const value = () => inline ?? argv[++i];
		if (name === "--port") options.port = Number(value());
		else if (name === "--device") options.device = value();
		else if (name === "--help" || name === "-h") options.help = true;
		else throw new Error(`unknown argument: ${argv[i]}`);
	}
	if (options.help) return options;
	if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
		throw new Error(`invalid port: ${options.port}`);
	}
	return options;
}

function startRecorder(device) {
	const stdio = ["ignore", "pipe", "inherit"];
	if (process.platform === "darwin") {
		const input = device?.includes(":") ? device : `:${device ?? "0"}`;
		return spawn(
			"ffmpeg",
			["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", input, "-ar", "16000", "-ac", "1", "-f", "s16le", "-"],
			{ stdio },
		);
	}
	if (process.platform === "linux") {
		const args = ["--raw", "--rate=16000", "--channels=1", "--format=s16le", "--latency-msec=20"];
		if (device) args.push(`--device=${device}`);
		return spawn("parec", args, { stdio });
	}
	throw new Error(`unsupported platform: ${process.platform}`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
	console.log(HELP);
	process.exit(0);
}

const log = (message) => console.error(`${new Date().toISOString()} ${message}`);

const server = net.createServer((socket) => {
	log("remote connected, recording");
	const recorder = startRecorder(options.device);
	const stop = () => {
		if (recorder.exitCode === null && !recorder.killed) recorder.kill("SIGTERM");
	};

	recorder.stdout.pipe(socket);
	recorder.on("error", (error) => {
		log(`recorder failed: ${error.message}`);
		socket.destroy();
	});
	recorder.on("exit", (code, signal) => {
		if (code) log(`recorder exited with ${signal ?? code}`);
		socket.destroy();
	});

	socket.on("close", () => {
		log("remote disconnected");
		stop();
	});
	socket.on("error", stop);
});

server.on("error", (error) => {
	console.error(`cannot listen on 127.0.0.1:${options.port}: ${error.message}`);
	process.exit(1);
});

server.listen(options.port, "127.0.0.1", () => {
	console.log(`microphone stream on 127.0.0.1:${options.port}`);
	console.log(`forward it:  ssh -N -R 127.0.0.1:${options.port}:127.0.0.1:${options.port} user@host`);
	console.log(`use it:      PI_DICTATION_AUDIO=127.0.0.1:${options.port} pi`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
