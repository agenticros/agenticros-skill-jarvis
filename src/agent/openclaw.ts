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
  // The HTTP path hits the already-running Gateway directly — no per-call
  // process spin-up — and, given a stable `user` value, lets the provider
  // cache the (large) system prompt across turns. Measured ~7s on a warm
  // session vs. ~20-35s for spawning `openclaw agent` fresh each time, so
  // prefer it and only fall back to the CLI if the HTTP endpoint is
  // unavailable (e.g. disabled in config).
  try {
    return await runOpenClawHttp(message, signal);
  } catch (firstErr) {
    logger.warn(`Jarvis: openclaw HTTP failed (${String(firstErr).slice(0, 160)}); retrying once`);
    try {
      return await runOpenClawHttp(message, signal);
    } catch (secondErr) {
      logger.warn(
        `Jarvis: openclaw HTTP retry failed (${String(secondErr).slice(0, 160)}); trying CLI`,
      );
      return await runOpenClawCli(message, jarvis, signal);
    }
  }
}

function runOpenClawCli(message: string, jarvis: JarvisConfig, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // A fixed session key lets OpenClaw reuse the same session across
    // utterances instead of spinning up a fresh one each time — this is what
    // lets the provider cache the (large) system prompt, and it also gives
    // Jarvis real multi-turn memory via OpenClaw's own session state.
    const child = spawn(
      "openclaw",
      [
        "agent",
        "--agent",
        jarvis.openclawAgent || "main",
        "--session-key",
        "jarvis-voice",
        "--message",
        message,
        "--json",
      ],
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
      // A nonzero exit isn't the only failure shape — the CLI can also exit 0
      // with a JSON body whose `status` reports the turn itself failed. Speaking
      // that failure text aloud as if it were a real answer is worse than
      // erroring out and falling back to the retry/HTTP path.
      const status = readStatus(out);
      if (status && status !== "ok") {
        reject(new Error(`openclaw agent status: ${status}`));
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
  const timeoutSignal = AbortSignal.timeout(60_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "openclaw/default",
      // Stable per-conversation session key — see the comment in
      // askOpenClaw() for why this matters for latency.
      user: "jarvis-voice",
      messages: [{ role: "user", content: message }],
    }),
    signal: combinedSignal,
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

function readStatus(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout.trim()) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : "";
  } catch {
    return "";
  }
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
    // `openclaw agent --json` nests the real reply at result.payloads[].text,
    // with unrelated string fields (runId, status, summary) as siblings —
    // traverse explicit known shapes only, never fall back to blindly
    // scanning every object value, or an id/status string can win first.
    if (rec.result && typeof rec.result === "object") {
      const found = findText(rec.result, depth + 1);
      if (found) return found;
    }
    if (Array.isArray(rec.payloads)) {
      const found = findText(rec.payloads, depth + 1);
      if (found) return found;
    }
    if (rec.choices) {
      const found = findText(rec.choices, depth + 1);
      if (found) return found;
    }
  }
  return "";
}
