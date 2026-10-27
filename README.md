# pi-push-to-talk

Hold space in pi's prompt to dictate. Your words appear where the cursor is, and speech recognition runs on your machine.

```
hold space  →  speak  →  release
```

No overlay, no separate window, no API key. The transcript is ordinary text in the editor, so you can keep typing, move the cursor, and dictate again wherever you are.

## Install

```bash
pi install npm:pi-push-to-talk
```

Remove any other voice extension first. Several of them also bind space or replace the editor, and two handlers on one key produce dropped spaces.

## Use

| Action | Result |
|---|---|
| Hold space (> 350 ms) | Recording starts; text appears at the cursor every second and updates in place |
| Release | That phrase is transcribed and committed |
| Pause 2.5 s while holding | The open phrase is committed and dictation continues |
| Tap space | An ordinary space, as usual |

While you speak, the open phrase is drawn dim; committed text is normal. The footer alternates a red `●` with `○` every 600 ms: `● listening` while the microphone is live, or `● loading model` until Whisper is ready.

## First run

Whisper base is downloaded once, about 198 MB, into `~/.pi/models/whisper-base/`. Only the int8 files are kept. After that, dictation is fully offline.

Extraction uses the system `tar` with bzip2 support, which is present on macOS, Linux, and Windows 10+.

## Remote machine

pi can run on a host with no usable audio input. Dictation can then record on the machine running the terminal and send the audio over SSH.

On the host running pi:

```
/dictation-setup bluefin.local
```

Without an argument it asks for the host.

It writes a setup script there and shows the one line to run on the machine with the microphone:

```sh
scp bluefin.local:/tmp/pi-dictation-setup.sh /tmp/ && sh /tmp/pi-dictation-setup.sh
```

That script installs `~/.local/bin/pi-mic-stream` and adds one SSH entry. Every later connection to that host then starts a recorder on loopback and forwards it to `127.0.0.1:47777`, where pi looks on each hold. Nothing runs in the background between holds, and nothing needs a setting: when the port is closed, pi records from the host's own microphone.

The entry the script writes:

```sshconfig
Host bluefin.local
  RemoteForward 127.0.0.1:47777 127.0.0.1:17777
  PermitLocalCommand yes
  LocalCommand sh -c 'nohup "$HOME/.local/bin/pi-mic-stream" >/dev/null 2>&1 &'
  # Successful connections need no forwarding log; every later one would warn.
  LogLevel ERROR
```

`LogLevel ERROR` hides the `remote port forwarding failed` warning that every later connection to that host would otherwise print, because the port is already served.

If the client config lives elsewhere, or you set machines up by hand, copy `scripts/pi-mic-stream` from this package and add the entry yourself. The script is safe to run again, and it keeps any SSH config already on that machine.

Requirements on the machine with the microphone:

- `socat`
- `parec` (Linux) or `ffmpeg` (macOS), plus microphone permission for the terminal

Notes:

- The helper listens on loopback only, and the forward binds loopback on the remote host. Nothing is exposed to the network.
- One recorder starts per hold, so the microphone is open only while you speak.
- The stream is 16 kHz mono, about 32 KB/s. SSH compression does not help it.
- `PI_DICTATION_AUDIO=host:port` overrides the address and warns, instead of falling back silently, when the stream is missing.
- Any local user on the remote host can connect to the forwarded port and record the client microphone. Use a host you trust.

Port choices:

- 47777 must be free on the remote host, and its sshd must allow forwarding to it. On Fedora, SELinux lets sshd listen only on 32768-60999.
- Two clients connected to the same host cannot both forward 47777. The second connection prints `remote port forwarding failed` and keeps working; pi records from the first client.

## How it works

- Capture: the local device through `decibri`, or 16 kHz mono PCM from `127.0.0.1:47777` when SSH forwards a microphone there.
- Recognition: `sherpa-onnx-node` runs Whisper base int8 on the CPU, four threads.
- Segmentation: a phrase closes after 2.5 s of silence or 12 s of unbroken speech; the cut lands in the quietest part of the last 800 ms, not mid-syllable.
- Editor: the extension owns the prompt editor, but only to write text. Keys are handled on the raw terminal path and only while the main editor has focus, so dialogs and nested editors keep working.

## Requirements

- pi with extension support
- A microphone the terminal may use, or a remote audio stream
- `socat` and `parec` or `ffmpeg` on the machine with the microphone, for remote use
- macOS, Linux, or Windows, x64 or arm64

## Known limits

- Undo history records each preview rewrite; `Ctrl+Z` after a dictation steps back through them. The editor API offers no way to write without an undo entry.
- English only.
- Brackets are stripped from transcripts, since Whisper emits them as sound captions. Dictating code with brackets is not supported.
- The cursor is restored with simulated left-arrow presses, capped at 4,000 characters. Inserting near the start of a very long prompt can leave the cursor short of the dictation point.
- Nested editors (dialogs) do not accept dictation, only normal typing.
- If the terminal drops key releases, a second press stops dictation instead of the release. A re-press is recognised as a new key after 250 ms without a space event, so a keyboard whose auto-repeat is slower than that would stop early.

## Diagnostics

Both are off unless the environment variable is set; both write only to `/tmp`.

| Variable | File | Content |
|---|---|---|
| `PI_DICTATION_DEBUG=1` | `/tmp/pi-dictation.log` | Space events, phrase decodes, cancels, and session commits |
| `PI_DICTATION_PROBE=1` | `/tmp/pi-dictation-probe.log` | Every terminal key sequence, for diagnosing key encoding. Dictation is disabled in this mode. |

## Uninstall

```bash
pi remove npm:pi-push-to-talk
rm -rf ~/.pi/models/whisper-base   # optional, frees 154 MB
```

## License

MIT
