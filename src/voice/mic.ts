/**
 * PCM 16 kHz microphone capture via arecord (Linux) or sox/rec (macOS).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";

export const MIC_SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = `${dir}/${cmd}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function findMicCommand(device?: string): { cmd: string; args: string[] } | null {
  const arecord = which("arecord");
  if (arecord) {
    const resolvedDevice = device || process.env.JARVIS_MIC_DEVICE;
    const args = ["-f", "S16_LE", "-r", String(MIC_SAMPLE_RATE), "-c", "1", "-t", "raw"];
    if (resolvedDevice) args.push("-D", resolvedDevice);
    args.push("-");
    return { cmd: arecord, args };
  }
  const rec = which("rec") ?? which("sox");
  if (rec) {
    const bin = rec.endsWith("/sox") ? rec : rec;
    if (bin.endsWith("sox")) {
      return {
        cmd: bin,
        args: ["-d", "-t", "raw", "-r", String(MIC_SAMPLE_RATE), "-e", "signed", "-b", "16", "-c", "1", "-"],
      };
    }
    return {
      cmd: bin,
      args: ["-t", "raw", "-r", String(MIC_SAMPLE_RATE), "-e", "signed", "-b", "16", "-c", "1", "-"],
    };
  }
  return null;
}

export function startMic(
  onChunk: (pcm: Buffer) => void,
  onError: (err: Error) => void,
  device?: string,
): ChildProcess {
  const spec = findMicCommand(device);
  if (!spec) {
    throw new Error("No microphone capture command found (install arecord or sox)");
  }
  const child = spawn(spec.cmd, spec.args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk: Buffer) => {
    if (chunk.length) onChunk(chunk);
  });
  child.stderr?.on("data", (_chunk: Buffer) => {
    // arecord prints "Recording WAVE" — ignore
  });
  child.on("error", (err) => onError(err));
  child.on("exit", (code, signal) => {
    if (code && code !== 0) onError(new Error(`Mic process exited ${code}/${signal ?? ""}`));
  });
  return child;
}

export function pcm16Wav(pcm: Buffer, sampleRate = MIC_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

export function float32ToPcm16(samples: ArrayLike<number>): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buf;
}
