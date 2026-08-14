/**
 * Resolve an OpenAI API key from skill config, env, OpenClaw auth-profiles, or AgenticROS config.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JarvisConfig } from "./config.js";

function home(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function fromAuthProfiles(): string {
  const path = join(home(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
  if (!existsSync(path)) return "";
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return findKey(raw);
  } catch {
    return "";
  }
}

function fromAgenticrosConfig(): string {
  const path = join(home(), ".agenticros", "config.json");
  if (!existsSync(path)) return "";
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8")) as { openai?: { apiKey?: string } };
    return typeof cfg.openai?.apiKey === "string" ? cfg.openai.apiKey.trim() : "";
  } catch {
    return "";
  }
}

function findKey(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    return s.startsWith("sk-") ? s : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["key", "apiKey", "api_key", "token"]) {
      if (typeof rec[key] === "string") {
        const s = String(rec[key]).trim();
        if (s.startsWith("sk-") || s.length > 20) return s;
      }
    }
    for (const v of Object.values(rec)) {
      const found = findKey(v, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

export function resolveOpenAiKey(jarvis: JarvisConfig): string {
  const fromSkill = jarvis.openaiApiKey.trim();
  if (fromSkill) return fromSkill;
  const fromEnv = (process.env.OPENAI_API_KEY ?? "").trim();
  if (fromEnv) return fromEnv;
  const fromProfiles = fromAuthProfiles();
  if (fromProfiles) return fromProfiles;
  return fromAgenticrosConfig();
}

export function openaiBaseUrl(jarvis: JarvisConfig): string {
  return (jarvis.openaiBaseUrl.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}
