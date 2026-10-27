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

pi can run on a host with no microphone. Capture then happens on the machine where your terminal runs, and the audio travels over SSH.

On the machine with the microphone:

```bash
node scripts/mic-stream.mjs --port 47777
ssh -N -R 127.0.0.1:47777:127.0.0.1:47777 user@remote
```

On the remote host:

```bash
PI_DICTATION_AUDIO=127.0.0.1:47777 pi
```

- The helper listens on loopback only, and the SSH forward binds loopback on the remote. Nothing is exposed to the network.
- Only the SSH connection carries the audio. One recorder starts per hold and stops when the hold ends.
- If the stream is unreachable, dictation falls back to the remote host's own microphone and shows a warning.
- SSH compression is unnecessary; the stream is about 32 KB/s.

Port rules:

- Pick a port free on both ends.
- On Fedora, SELinux lets `sshd` listen only on 32768-60999. A lower port fails with `remote port forwarding failed`.
- Forward to the same port on both ends to keep the command easy to read.

Recorder requirements:

- macOS: `ffmpeg` (`brew install ffmpeg`), plus microphone permission for the terminal.
- Linux: `parec` from PipeWire or PulseAudio.
- Any local user on the remote host can connect to the forwarded port and record the client microphone. Use a host you trust.

## How it works

- Capture: `decibri` reads the microphone in process, resampling to 16 kHz mono. With `PI_DICTATION_AUDIO` set, the same pipeline reads 16 kHz mono PCM from a socket instead.
- Recognition: `sherpa-onnx-node` runs Whisper base int8 on the CPU, four threads.
- Segmentation: a phrase closes after 2.5 s of silence or 12 s of unbroken speech; the cut lands in the quietest part of the last 800 ms, not mid-syllable.
- Editor: the extension owns the prompt editor, but only to write text. Keys are handled on the raw terminal path and only while the main editor has focus, so dialogs and nested editors keep working.

## Requirements

- pi with extension support
- A microphone the terminal may use, or a remote audio stream
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
