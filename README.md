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
| Hold space until the key repeats | Recording starts; text appears at the cursor every second and updates in place |
| Release | That phrase is transcribed and committed |
| Pause 2.5 s while holding | The open phrase is committed and dictation continues |
| Tap space | An ordinary space, as usual |

While you speak, the open phrase is drawn dim; committed text is normal. The footer alternates a red `●` with `○` every 600 ms: `● listening` while the microphone is live, or `● loading model` until the model is ready.

## Models

Choose a model with `/dictation-model`. It asks for a language group first, then a model; a model that offers a language choice then asks for one. `/dictation-language fr` changes the language without reopening the model picker.

| Section | Model | Size | Accuracy | Speed |
|---|---|---|---|---|
| Multilingual | Parakeet TDT v3 | 671 MB | ●●●●● | ●●●●○ |
| Multilingual | Whisper Small | 375 MB | ●●●●○ | ●●○○○ |
| Multilingual | SenseVoice Small | 228 MB | ●●●●○ | ●●●●● |
| English | Whisper Base (default) | 154 MB | ●●●○○ | ●●●○○ |
| English | Moonshine Base | 287 MB | ●●○○○ | ●●●●● |
| English | Parakeet TDT v2 | 661 MB | ●●●●● | ●●●●● |
| Arabic | Moonshine v2 Arabic * | 135 MB | ●●●○○ | ●●●●● |
| Chinese | Moonshine v2 Chinese * | 135 MB | ●●●○○ | ●●●●● |
| Japanese | Moonshine v2 Japanese * | 135 MB | ●●●○○ | ●●●●● |
| Korean | Moonshine v2 Korean * | 69 MB | ●●○○○ | ●●●●● |
| Spanish | Moonshine v2 Spanish * | 63 MB | ●●●○○ | ●●●●● |

The circles are a relative guide, not a benchmark. Accuracy comes from published WER or CER figures, or an estimate for the language-specific models; speed is a rough CPU estimate. They are coarse on purpose. Whisper Small and Parakeet TDT v3 cover many languages; the English models and the language sections are more specific. `*` marks estimates.

Models download when you select them. Existing files are reused, and an interrupted file leaves nothing that looks complete. The selection is stored in `push-to-talk.json` in Pi's agent directory.

## First run

The default model, Whisper Base, downloads once into `~/.pi/models/whisper-base/`, about 154 MB. Choosing another model downloads that model instead. Files are fetched directly from Hugging Face; no system `tar` is needed. After that, dictation is fully offline.

## Remote machine

pi can run on a host with no usable audio input. Dictation can then record on the machine running the terminal and send the audio over SSH.

On the host running pi:

```
/dictation-setup bluefin.local
```

The argument is the host that runs pi, the name you SSH to for it. Without it the command asks.

It writes a setup script there and shows the one line to run on the machine with the microphone:

```sh
scp bluefin.local:/tmp/pi-dictation-setup.sh /tmp/ && sh /tmp/pi-dictation-setup.sh
```

That script installs `~/.local/bin/pi-mic-stream`, picks a port on that host which is still free, and adds one SSH entry for it. Every later connection then starts a recorder on loopback and forwards it. pi probes `47777`-`47792` when a hold starts and opens every port whose helper greets. With one machine connected it uses that stream at once. With several, it buffers a short window and keeps the stream where speech rose furthest above its own noise floor — a quiet laptop wins over a humming desktop, because the comparison is relative. The chosen machine is shown as `● listening via t14`. When no port answers, pi records from the host's own microphone.

The entry the script writes, with the port it chose:

```sshconfig
Host bluefin.local
  RemoteForward 127.0.0.1:47778 127.0.0.1:17777
  PermitLocalCommand yes
  LocalCommand sh -c 'nohup "$HOME/.local/bin/pi-mic-stream" %h >/dev/null 2>&1 &'
  # Successful connections need no forwarding log; every later one would warn.
  LogLevel ERROR
```

`LogLevel ERROR` hides the `remote port forwarding failed` warning that every later connection to that host would otherwise print, because the port is already served.

If the client config lives elsewhere, or you set machines up by hand, copy `scripts/pi-mic-stream` from this package and add the entry yourself. The script is safe to run again, and it keeps any SSH config already on that machine.

Requirements on the machine with the microphone:

- `socat`
- `parec` (Linux) or `ffmpeg` (macOS), plus microphone permission for the terminal

The setup script stops and names whichever of these is missing, then starts the helper and checks that it answers on `17777`. A helper that cannot greet fails the setup instead of leaving a port that accepts connections with no audio behind it.

Notes:

- The helper listens on loopback only, and the forward binds loopback on the remote host. Nothing is exposed to the network.
- One recorder starts per hold, so the microphone is open only while you speak. With two machines connected, both record for the first moments of a hold until one is dropped.
- The stream is 16 kHz mono, about 32 KB/s. SSH compression does not help it.
- Each connection to a helper starts with one `pi-mic <host>` line: it names the machine, and it lets pi skip ports that a stale session or another machine answers.
- A refused forward is not fatal: the helper asks the connection that started it for the first free port in the range, so a port held by a stale session only costs one candidate. This needs a multiplexed connection (a control socket); a plain one-off `ssh` keeps the single configured port.
- On the host that runs pi, sshd should reap dead sessions. Without this, a client that sleeps or loses its network can leave a port bound for hours:

  ```sshconfig
  # /etc/ssh/sshd_config on the host that runs pi
  ClientAliveInterval 15
  ClientAliveCountMax 3
  ```

  Those sessions then end about 45 seconds after the client stops answering, and their ports free.
- `PI_DICTATION_AUDIO=host:port` overrides the search and warns, instead of falling back silently, when the stream is missing.
- `/dictation-source` lists the machines whose microphones answer, and `/dictation-source t14` records from one of them, skipping the energy comparison. Without it, pi decides from the audio itself, so a single connected machine needs nothing.
- Any local user on the remote host can connect to the forwarded port and record the client microphone. Use a host you trust.

Ports:

- The range `47777`-`47792` is reserved for this. Each client takes a free one when it sets up, so two machines never claim the same port on the same host.
- On Fedora, SELinux lets sshd listen only on 32768-60999, which the range is inside.

## How it works

- Capture: the local device through `decibri`, or 16 kHz mono PCM from `127.0.0.1:47777` when SSH forwards a microphone there.
- Recognition: `sherpa-onnx-node` runs the selected int8 model on the CPU, four threads.
- Segmentation: a phrase closes after 2.5 s of silence or 12 s of unbroken speech; the cut lands in the quietest part of the last 800 ms, not mid-syllable.
- Editor: the extension owns the prompt editor, but only to write text. Keys are handled on the raw terminal path and only while the main editor has focus, so dialogs and nested editors keep working.

## Requirements

- pi with extension support
- A terminal with key repeat turned on. Every terminal repeats a held key; kitty, Ghostty, foot, WezTerm, and tmux with extended keys also name the repeat event.
- A microphone the terminal may use, or a remote audio stream
- `socat` and `parec` or `ffmpeg` on the machine with the microphone, for remote use
- macOS, Linux, or Windows, x64 or arm64

## Known limits

- Undo history records each preview rewrite; `Ctrl+Z` after a dictation steps back through them. The editor API offers no way to write without an undo entry.
- Model coverage and quality vary. Whisper Small, Parakeet TDT v3, and SenseVoice Small are multilingual; the English and language-specific presets are narrower. The circles are guidance, not a guarantee.
- Language auto-detection can change on short phrases. Pin a language with `/dictation-language <code>` when the model offers one.
- Phrase boundaries are joined with a space, so Chinese and Japanese dictation can contain spaces at pauses.
- Brackets are stripped from transcripts, since some models emit them as sound captions. Dictating code with brackets is not supported.
- The cursor is restored with simulated left-arrow presses, capped at 4,000 characters. Inserting near the start of a very long prompt can leave the cursor short of the dictation point.
- Nested editors (dialogs) do not accept dictation, only normal typing.
- Hold-to-talk starts on the first key repeat, so dictation begins after the OS repeat delay, about 0.2 to 0.7 s. A terminal with key repeat turned off never starts a session; the space stays.
- Key releases are optional. A terminal that sends none, such as the Linux console, stops dictation on the next key instead. A re-press is recognised as a new key after 250 ms without a space event, so a keyboard whose auto-repeat is slower than that would stop early.

## Diagnostics

Both are off unless the environment variable is set; both write only to `/tmp`.

| Variable | File | Content |
|---|---|---|
| `PI_DICTATION_DEBUG=1` | `/tmp/pi-dictation.log` | Space events, phrase decodes, cancels, and session commits |
| `PI_DICTATION_PROBE=1` | `/tmp/pi-dictation-probe.log` | Every terminal key sequence, for diagnosing key encoding. Dictation is disabled in this mode. |

## Uninstall

```bash
pi remove npm:pi-push-to-talk
rm -rf ~/.pi/models/whisper-base   # optional; remove the model folders you downloaded
rm -f ~/.pi/agent/push-to-talk.json   # optional, forgets the selected model
```

## License

MIT
