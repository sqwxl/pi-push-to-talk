/**
 * Opt-in trace for the space state machine. `PI_DICTATION_DEBUG=1 pi` writes
 * one line per space event to /tmp/pi-dictation.log — the only way to tell a
 * missing release from an unmatched one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENABLED = !!process.env.PI_DICTATION_DEBUG;
export const LOG_FILE = path.join(os.tmpdir(), "pi-dictation.log");

export function trace(message: string): void {
	if (!ENABLED) return;
	try {
		fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
	} catch {
		// Diagnostics must never break input handling.
	}
}
