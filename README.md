# Jarvis

```bash
npx agenticros skills install @agenticros/jarvis
```

Voice front-end for [AgenticROS](https://github.com/agenticros/agenticros) robots. Jarvis listens on the microphone, waits for **Hey Jarvis**, sends what you said to the OpenClaw agent (the same brain as web chat), and speaks the reply. It can also greet you when the RealSense camera sees a person.

This is a **Node.js / TypeScript** skill (`registerSkill`), not a Python port of merlin-bot. Merlin is a behavior reference only.

## What it does

- Always-on listen loop: mic → energy VAD → Whisper STT → wake-word gate → fast chat or OpenClaw agent → Kokoro TTS
- Wake word defaults to **Hey Jarvis** (also `jarvis`, `hi jarvis`, `ok jarvis`)
- 60-second conversation window after Jarvis speaks — no wake word needed for follow-ups
- Mute with “go to sleep” / “that’s all”; unmute with the wake phrase or “wake up”
- Presence greetings from the **RealSense ROS color topic** (not a USB webcam)
- Ordinary questions (“what time is it?”, “what is the capital of Arizona?”) go through a fast chat model. Robot skills (“what do you see?”, “scan for a cup”, “follow me”) go through OpenClaw, so installed skills such as `@agenticros/followme` work the same as in chat

Head nods and shakes are omitted — most robots do not have a pivoting head.

## Hardware

- Microphone (ALSA `arecord` on Linux, or `sox`/`rec` on macOS)
- Speakers plus `aplay`, `paplay`, `pw-play`, or `afplay` to play WAV
- Intel RealSense color topic (default `/camera/camera/color/image_raw/compressed`)
- Optional: `espeak` or `espeak-ng` as TTS fallback if Kokoro cannot load

## Install and run

1. Install the skill where the OpenClaw gateway can load it:

   ```bash
   npx agenticros skills install @agenticros/jarvis
   ```

   Or clone this repo, `npm install && npm run build`, and add the directory to `skillPaths`.

2. Restart the OpenClaw gateway. Jarvis auto-starts the voice loop unless `autoStart` is `false`.

3. Say **Hey Jarvis, what time is it?**

From chat you can also call:

- `jarvis_control` with `start` / `stop` / `status`
- `jarvis_speak` with `text`

## Spoken examples

See [demo.md](./demo.md).

## Changing the name

Default spoken name is **Jarvis**. Override with OpenClaw config or `soul.md`.

`~/.openclaw/openclaw.json` (under `plugins.entries.agenticros.config`):

```jsonc
{
  "skills": {
    "jarvis": {
      "name": "Merlin",
      "operatorName": "Chris"
    }
  }
}
```

Or edit `soul.md` (Merlin-compatible `key: value` file) in this package, or a user copy at `~/.agenticros/jarvis/soul.md`:

```markdown
name: Jarvis
operator: Chris
character: A concise, helpful robot assistant.
```

Wake phrases are derived from `name`: `{name}`, `hey {name}`, `hi {name}`, `ok {name}`. Optional `wakePhrase` and `wakeAliases` add extra matches.

Resolution order: `config.skills.jarvis` fields, then `~/.agenticros/jarvis/soul.md`, then the packaged `soul.md`, then built-in defaults.

## OpenAI key (no extra setup)

Jarvis reuses the key OpenClaw already has. Lookup order:

1. `config.skills.jarvis.openaiApiKey`
2. `OPENAI_API_KEY`
3. `~/.openclaw/agents/main/agent/auth-profiles.json`
4. `~/.agenticros/config.json` → `openai.apiKey`

Used for Whisper STT (default), optional OpenAI TTS, and presence/see vision when not using Ollama.

## Other LLMs

Default `agentBackend` is `openclaw`. Robot turns go through the OpenClaw agent so the gateway’s configured model and **all robot tools** are used. Everyday questions skip that agent and hit a fast chat model (`chatBackend`, default `openai` / `gpt-4o-mini`) so trivia answers in about a second instead of waiting on the full skill stack. Change the OpenClaw model in gateway config — Jarvis does not need a second OpenClaw model setting.

Set `chatBackend` to `off` to send every voice turn through OpenClaw (the old behavior). Set it to `ollama` if you want the fast path local.

### Direct OpenAI

```jsonc
"skills": {
  "jarvis": {
    "agentBackend": "openai",
    "openaiModel": "gpt-4o-mini",
    "openaiBaseUrl": "https://api.openai.com/v1"
  }
}
```

`openaiBaseUrl` can point at Azure or any OpenAI-compatible server. Direct mode has built-in `see` and `scan_for` tools only. “Follow me” needs OpenClaw plus `@agenticros/followme`.

### Local Ollama (Qwen, etc.)

```jsonc
"skills": {
  "jarvis": {
    "agentBackend": "ollama",
    "ollamaUrl": "http://localhost:11434",
    "ollamaModel": "qwen2.5:7b",
    "ollamaVisionModel": "qwen3-vl:2b"
  }
}
```

Pull models first:

```bash
ollama pull qwen2.5:7b
ollama pull qwen3-vl:2b
```

Same limited robot tools as direct OpenAI (`see`, `scan_for`). For full AgenticROS skills, keep `agentBackend` as `openclaw` and point the **gateway** at Ollama instead. Set `chatBackend` to `ollama` if you also want the fast trivia path to stay local.

## TTS

| `ttsProvider` | Engine | Notes |
|---|---|---|
| `kokoro` (default) | [`kokoro-js`](https://www.npmjs.com/package/kokoro-js) | Local Kokoro-82M ONNX. First run downloads ~80MB. Voice `am_fenrir`. |
| `openai` | OpenAI `tts-1` | Uses the existing API key. |
| `espeak` | `espeak` / `espeak-ng` | Robotic fallback; also used automatically if Kokoro fails to load. |

## STT

| `sttProvider` | Engine |
|---|---|
| `openai` (default) | Whisper `whisper-1` |
| `openai-compat` | Same HTTP API at `openaiBaseUrl` (local Whisper server) |
| `whisper.cpp` | Local `whisper-cli` (`sttCommand`) |

Ollama is not used for STT.

## RealSense camera

Vision is ROS-only. Topic order:

1. `config.skills.jarvis.cameraTopic`
2. `config.robot.cameraTopic`
3. `/camera/camera/color/image_raw/compressed`

Use `cameraMessageType: "Image"` for uncompressed `sensor_msgs/Image`. Depth is optional and not required for greetings.

## Config (`config.skills.jarvis`)

| Option | Default | Description |
|---|---|---|
| `name` | `Jarvis` | Spoken name / wake-word base |
| `wakePhrase` | (derived) | Extra wake phrase |
| `wakeAliases` | `[]` | Extra Whisper mishears |
| `operatorName` | from `soul.md` / `friend` | Who greetings address |
| `conversationWindowSec` | `60` | Seconds after speech when wake word is optional |
| `autoStart` | `true` | Start listening when the gateway loads |
| `agentBackend` | `openclaw` | `openclaw` \| `openai` \| `ollama` |
| `chatBackend` | `openai` | Fast path for chitchat when `agentBackend` is `openclaw`. `openai` \| `ollama` \| `off` |
| `openclawAgent` | `main` | OpenClaw agent id |
| `sttProvider` / `sttModel` | `openai` / `whisper-1` | Speech-to-text |
| `ttsProvider` / `ttsVoice` | `kokoro` / `am_fenrir` | Text-to-speech |
| `ttsCommand` | `espeak` | Fallback binary |
| `greetOnPresence` | `true` | Greet when a person appears in RealSense |
| `presenceIntervalMs` | `4000` | How often to sample the camera |
| `initiative` | `0.4` | Chance to add “Need anything?” after a greeting |
| `cameraTopic` | robot / RealSense default | Color image topic |
| `cameraMessageType` | `CompressedImage` | `CompressedImage` or `Image` |
| `micDevice` | system default | ALSA device for `arecord` (`JARVIS_MIC_DEVICE` also works) |
| `vadSilenceMs` | `800` | Silence after speech before STT starts |
| `muteWords` | go to sleep, that’s all, … | Sleep phrases |
| `openaiApiKey` | (resolved) | Optional override |

## Project structure

| Path | Purpose |
|---|---|
| `src/index.ts` | `registerSkill` — tools + voice service |
| `src/config.ts` | `skills.jarvis` + `soul.md` |
| `src/keys.ts` | OpenAI / OpenClaw key resolution |
| `src/voice/` | Mic, VAD, STT, TTS, wake word, listen loop |
| `src/presence/` | RealSense person detect + greetings |
| `src/agent/` | OpenClaw CLI/HTTP, fast chat, robot-intent routing, and direct LLM backends |
| `soul.md` | Identity (`name`, `operator`, `character`) |

## Troubleshooting

- **No mic** — install `alsa-utils` (`arecord`) or `sox`. Set `JARVIS_MIC_DEVICE` or `micDevice` if the default ALSA device is wrong.
- **Jarvis hears itself** — the mic is muted while TTS plays. If echo remains, lower speaker volume or move the mic.
- **Wake word missed** — Whisper often hears “Jarvus”; that alias is built in. Add `wakeAliases` for other mishears.
- **Kokoro download fails** — first run needs network. Jarvis falls back to `espeak`. Set `ttsProvider: "espeak"` to skip Kokoro.
- **No speech out** — install `aplay` / `paplay` (Linux) or use macOS `afplay`.
- **Presence never greets** — confirm `config.robot.cameraTopic` matches RealSense (`.../color/image_raw/compressed` vs raw `Image`). Check OpenAI key or Ollama VLM.
- **“Follow me” does nothing** — install `@agenticros/followme` and keep `agentBackend: "openclaw"`.
- **Trivia is still slow** — everyday questions should log `Jarvis route: chat`. If you see `OpenClaw` on “capital of Arizona”, check that `chatBackend` is not `off` and that an OpenAI (or Ollama) key is available for the fast path.
- **OpenClaw agent fails** — `openclaw` must be on `PATH`. HTTP fallback needs gateway `/v1/chat/completions` enabled, plus the gateway token in `~/.openclaw/openclaw.json`.

## License

Apache-2.0
