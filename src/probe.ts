/**
 * Temporary key probe.
 *
 * Hold-to-talk needs a key whose press *and* release both reach the app. This
 * editor logs every sequence the terminal sends, so the binding can be chosen
 * from evidence instead of guessed. Enabled with PI_DICTATION_PROBE=1.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CustomEditor } from "@earendil-works/pi-coding-agent";

export const PROBE_LOG = path.join(os.tmpdir(), "pi-dictation-probe.log");

export class ProbeEditor extends CustomEditor {
	override handleInput(data: string): void {
		try {
			const hex = Buffer.from(data, "utf8").toString("hex");
			const printable = /^[\x20-\x7e]+$/.test(data) ? JSON.stringify(data) : "-";
			fs.appendFileSync(PROBE_LOG, `${new Date().toISOString()} hex=${hex} text=${printable}\n`);
		} catch {
			// A diagnostic must never break typing.
		}
		super.handleInput(data);
	}
}
