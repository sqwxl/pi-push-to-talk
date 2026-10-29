/** Checks the generated setup script before a user pastes it into a shell. */
import assert from "node:assert/strict";
import test from "node:test";
import { copyCommand, parseHost, setupScript } from "./setup.ts";

const HELPER = "#!/bin/sh\necho 'quoted' \"double\"\nexit 0\n";

test("only host names are accepted", () => {
	assert.equal(parseHost(" bluefin.local\n"), "bluefin.local");
	assert.equal(parseHost("sqwxl@bluefin.local extra"), undefined);
	assert.equal(parseHost("host;rm -rf /"), undefined);
	assert.equal(parseHost(""), undefined);
});

test("the script installs the helper and the ssh entry", () => {
	const script = setupScript("bluefin.local", HELPER);
	assert.match(script, /^#!\/bin\/sh\n/);
	assert.ok(script.includes(HELPER.trimEnd()), "helper body is embedded verbatim");
	assert.ok(script.includes("\n  RemoteForward 127.0.0.1:$port 127.0.0.1:17777\n"));
	assert.ok(script.includes("\n  LogLevel ERROR\n"), "later connections would warn about the busy port");
	assert.ok(script.includes("while [ \"$candidate\" -le 47792 ]"), "picks a port the host is not using");
	assert.ok(script.includes("pi-mic-stream\" >/dev/null"), "the helper serves its own local port");
	assert.ok(script.includes('chmod +x "$HOME/.local/bin/pi-mic-stream"'));
	assert.ok(script.includes("Include ~/.ssh/config.d/*"));
	assert.ok(script.includes('host="bluefin.local"'), "the host is written once");
	assert.equal(script.split("\nHost $host\n").length, 2, "one ssh entry");
});

test("the helper heredoc cannot end early", () => {
	const script = setupScript("h", HELPER);
	const markers = script.match(/HELPER_EOF/g) ?? [];
	assert.equal(markers.length, 2, "one opening and one closing marker");
});

test("the copy command names the host and the script", () => {
	assert.equal(copyCommand("bluefin.local"), "scp bluefin.local:/tmp/pi-dictation-setup.sh /tmp/ && sh /tmp/pi-dictation-setup.sh");
});
