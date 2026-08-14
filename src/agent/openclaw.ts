/**
 * Invoke the OpenClaw gateway agent (same tools as web chat).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JarvisConfig } from "../config.js";
import type { SkillLogger } from "../types.js";

const VOICE_HINT =
  "The user is speaking to you through a robot microphone. Reply in one or two short spoken sentences. No markdown, lists, URLs, or code.";

export async function askOpenClaw(
  utterance: string,
  jarvis: JarvisConfig,
  logger: SkillLogger,
  signal?: AbortSignal,
): Promise<string> {
  const message = `${VOICE_HINT}\n\nUser said: ${utterance}`;
  try {
    return await runOpenClawCli(message, jarvis, signal);
  } catch (cliErr) {
    logger.warn(`Jarvis: openclaw CLI failed (${String(cliErr).slice(0, 160)}); trying HTTP`);
    return await runOpenClawHttp(message, signal);
  }
}

function runOpenClawCli(message: string, jarvis: JarvisConfig, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "openclaw",
      ["agent", "--agent", jarvis.openclawAgent || "main", "--message", message, "--json"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("openclaw agent timed out"));
    }, 120_000);
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error("openclaw agent aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(err.trim() || `openclaw exited ${code}`));
        return;
      }
      const text = extractReply(out) || out.trim();
      if (!text) reject(new Error("openclaw returned empty reply"));
      else resolve(text);
    });
  });
}

async function runOpenClawHttp(message: string, signal?: AbortSignal): Promise<string> {
  const { url, token } = readGateway();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "openclaw/default",
      messages: [{ role: "user", content: message }],
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenClaw HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("OpenClaw HTTP returned empty reply");
  return text;
}

function readGateway(): { url: string; token: string } {
  const path = join(homedir(), ".openclaw", "openclaw.json");
  let port = 18789;
  let token = "";
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8")) as {
        gateway?: { port?: number; auth?: { token?: string } };
      };
      if (typeof cfg.gateway?.port === "number") port = cfg.gateway.port;
      token = cfg.gateway?.auth?.token ?? "";
    } catch {
      // defaults
    }
  }
  return { url: `http://127.0.0.1:${port}`, token };
}

function extractReply(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const found = findText(parsed);
    if (found) return found;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const found = findText(JSON.parse(trimmed.slice(start, end + 1)) as unknown);
        if (found) return found;
      } catch {
        // fall through
      }
    }
  }
  return trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("{") && !l.startsWith("["))
    .join(" ")
    .trim();
}

function findText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findText(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["text", "reply", "message", "content", "output"]) {
      if (typeof rec[key] === "string" && rec[key].trim()) return rec[key].trim();
    }
    if (Array.isArray(rec.payloads)) {
      const found = findText(rec.payloads, depth + 1);
      if (found) return found;
    }
    if (rec.choices) {
      const found = findText(rec.choices, depth + 1);
      if (found) return found;
    }
    for (const v of Object.values(rec)) {
      const found = findText(v, depth + 1);
      if (found) return found;
    }
  }
  return "";
}
