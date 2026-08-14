/**
 * TTS: Kokoro (default), OpenAI tts-1, espeak fallback.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { JarvisConfig } from "../config.js";
import { openaiBaseUrl, resolveOpenAiKey } from "../keys.js";
import type { SkillLogger } from "../types.js";
import { float32ToPcm16, pcm16Wav } from "./mic.js";

type KokoroAudio = {
  save?: (path: string) => Promise<void> | void;
  audio?: Float32Array | Int16Array | number[];
  sampling_rate?: number;
  toWav?: () => ArrayBuffer | Uint8Array;
};

type KokoroTts = {
  generate: (text: string, opts: { voice?: string }) => Promise<KokoroAudio>;
};

let kokoroPromise: Promise<KokoroTts | null> | null = null;
let kokoroFailed = false;

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = `${dir}/${cmd}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadKokoro(logger: SkillLogger): Promise<KokoroTts | null> {
  if (kokoroFailed) return null;
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      try {
        const mod = (await import("kokoro-js")) as {
          KokoroTTS: {
            from_pretrained: (
              id: string,
              opts: { dtype?: string; device?: string },
            ) => Promise<KokoroTts>;
          };
        };
        logger.info("Jarvis: loading Kokoro TTS model (first run may download ~80MB)");
        return await mod.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
          dtype: "q8",
          device: "cpu",
        });
      } catch (err) {
        kokoroFailed = true;
        logger.warn(`Jarvis: Kokoro TTS unavailable, using espeak (${String(err).slice(0, 200)})`);
        return null;
      }
    })();
  }
  return kokoroPromise;
}

export async function speak(
  text: string,
  jarvis: JarvisConfig,
  logger: SkillLogger,
  signal?: AbortSignal,
): Promise<void> {
  const clean = speakable(text);
  if (!clean) return;
  const provider = jarvis.ttsProvider;
  try {
    if (provider === "openai") {
      await speakOpenAi(clean, jarvis, signal);
      return;
    }
    if (provider === "espeak") {
      await speakEspeak(clean, jarvis, signal);
      return;
    }
    const kokoro = await loadKokoro(logger);
    if (kokoro) {
      await speakKokoro(kokoro, clean, jarvis, signal);
      return;
    }
    await speakEspeak(clean, jarvis, signal);
  } catch (err) {
    logger.warn(`Jarvis TTS (${provider}) failed: ${String(err).slice(0, 200)}`);
    if (provider !== "espeak") {
      await speakEspeak(clean, jarvis, signal);
    } else {
      throw err;
    }
  }
}

async function speakKokoro(
  tts: KokoroTts,
  text: string,
  jarvis: JarvisConfig,
  signal?: AbortSignal,
): Promise<void> {
  const audio = await tts.generate(text, { voice: jarvis.ttsVoice || "am_fenrir" });
  const dir = await mkdtemp(join(tmpdir(), "jarvis-tts-"));
  const wavPath = join(dir, "out.wav");
  try {
    if (typeof audio.save === "function") {
      await audio.save(wavPath);
    } else if (typeof audio.toWav === "function") {
      const buf = audio.toWav();
      await writeFile(wavPath, Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf));
    } else if (audio.audio) {
      const samples = audio.audio;
      const pcm =
        samples instanceof Int16Array
          ? Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
          : float32ToPcm16(samples);
      await writeFile(wavPath, pcm16Wav(pcm, audio.sampling_rate ?? 24000));
    } else {
      throw new Error("Kokoro returned no audio");
    }
    await playWav(wavPath, signal);
  } finally {
    await unlink(wavPath).catch(() => undefined);
  }
}

async function speakOpenAi(text: string, jarvis: JarvisConfig, signal?: AbortSignal): Promise<void> {
  const key = resolveOpenAiKey(jarvis);
  if (!key) throw new Error("No OpenAI API key for TTS");
  const res = await fetch(`${openaiBaseUrl(jarvis)}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: jarvis.ttsVoice === "am_fenrir" ? "alloy" : jarvis.ttsVoice || "alloy",
      input: text,
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI TTS ${res.status}: ${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "jarvis-tts-"));
  const path = join(dir, "out.mp3");
  await writeFile(path, buf);
  try {
    await playWav(path, signal);
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

function speakEspeak(text: string, jarvis: JarvisConfig, signal?: AbortSignal): Promise<void> {
  const bin = which(jarvis.ttsCommand) ?? which("espeak-ng") ?? which("espeak");
  if (!bin) throw new Error("espeak/espeak-ng not found");
  return run(bin, ["-v", "en", text], signal);
}

function playWav(path: string, signal?: AbortSignal): Promise<void> {
  const afplay = which("afplay");
  if (afplay) return run(afplay, [path], signal);
  const paplay = which("paplay");
  if (paplay) return run(paplay, [path], signal);
  const pwplay = which("pw-play");
  if (pwplay) return run(pwplay, [path], signal);
  const aplay = which("aplay");
  if (aplay) return run(aplay, ["-q", path], signal);
  throw new Error("No audio player found (afplay, paplay, pw-play, or aplay)");
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        resolve();
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}
