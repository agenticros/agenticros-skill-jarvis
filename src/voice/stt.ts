/**
 * Speech-to-text: OpenAI Whisper, OpenAI-compatible /audio/transcriptions, or whisper.cpp CLI.
 */

import { spawn } from "node:child_process";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JarvisConfig } from "../config.js";
import { openaiBaseUrl, resolveOpenAiKey } from "../keys.js";
import { pcm16Wav } from "./mic.js";

export async function transcribe(
  pcm: Buffer,
  jarvis: JarvisConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (jarvis.sttProvider === "whisper.cpp") {
    return transcribeWhisperCpp(pcm, jarvis, signal);
  }
  return transcribeOpenAi(pcm, jarvis, signal);
}

async function transcribeOpenAi(
  pcm: Buffer,
  jarvis: JarvisConfig,
  signal?: AbortSignal,
): Promise<string> {
  const key = resolveOpenAiKey(jarvis);
  if (!key && jarvis.sttProvider === "openai") {
    throw new Error("No OpenAI API key for Whisper STT");
  }
  const wav = pcm16Wav(pcm);
  const blob = new Blob([new Uint8Array(wav)], { type: "audio/wav" });
  const form = new FormData();
  form.append("file", blob, "speech.wav");
  form.append("model", jarvis.sttModel || "whisper-1");
  form.append("language", "en");
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${openaiBaseUrl(jarvis)}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`STT ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

async function transcribeWhisperCpp(
  pcm: Buffer,
  jarvis: JarvisConfig,
  signal?: AbortSignal,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-stt-"));
  const wavPath = join(dir, "speech.wav");
  await writeFile(wavPath, pcm16Wav(pcm));
  const bin = jarvis.sttCommand || "whisper-cli";
  try {
    const text = await runCapture(bin, ["-f", wavPath, "-nt", "-np"], signal);
    return text.replace(/\[.*?\]/g, "").trim();
  } finally {
    await unlink(wavPath).catch(() => undefined);
  }
}

function runCapture(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error("STT aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve(out.trim() || err.trim());
      else reject(new Error(`whisper.cpp exited ${code}: ${err.slice(0, 200)}`));
    });
  });
}
