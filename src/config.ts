/**
 * Jarvis skill config: config.skills.jarvis merged over soul.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgenticROSConfig } from "@agenticros/core";

export type AgentBackend = "openclaw" | "openai" | "ollama";
export type SttProvider = "openai" | "whisper.cpp" | "openai-compat";
export type TtsProvider = "kokoro" | "openai" | "espeak";
export type CameraMessageType = "CompressedImage" | "Image";

export interface JarvisConfig {
  name: string;
  wakePhrase: string;
  wakeAliases: string[];
  wakeWords: string[];
  operatorName: string;
  character: string;
  persona: string;
  personality: string;
  conversationWindowSec: number;
  autoStart: boolean;
  agentBackend: AgentBackend;
  openclawAgent: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiVisionModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaVisionModel: string;
  sttProvider: SttProvider;
  sttModel: string;
  sttCommand: string;
  ttsProvider: TtsProvider;
  ttsVoice: string;
  ttsCommand: string;
  micDevice: string;
  vadThreshold: number;
  greetOnPresence: boolean;
  presenceIntervalMs: number;
  initiative: number;
  cameraTopic: string;
  cameraMessageType: CameraMessageType;
  cameraSnapshotTimeoutMs: number;
  depthTopic: string;
  cmdVelTopic: string;
  muteWords: string[];
  unmuteWords: string[];
  nevermindWords: string[];
}

const REALSENSE_COLOR = "/camera/camera/color/image_raw/compressed";

const DEFAULTS: Omit<JarvisConfig, "wakeWords"> = {
  name: "Jarvis",
  wakePhrase: "",
  wakeAliases: [],
  operatorName: "friend",
  character: "A concise, helpful robot assistant.",
  persona: "Direct and brief; answers out loud in one or two sentences.",
  personality: "Helpful, observant, lightly playful.",
  conversationWindowSec: 60,
  autoStart: true,
  agentBackend: "openclaw",
  openclawAgent: "main",
  openaiApiKey: "",
  openaiBaseUrl: "",
  openaiModel: "gpt-4o-mini",
  openaiVisionModel: "gpt-4o-mini",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  ollamaVisionModel: "qwen3-vl:2b",
  sttProvider: "openai",
  sttModel: "whisper-1",
  sttCommand: "whisper-cli",
  ttsProvider: "kokoro",
  ttsVoice: "am_fenrir",
  ttsCommand: "espeak",
  micDevice: "",
  vadThreshold: 700,
  greetOnPresence: true,
  presenceIntervalMs: 15_000,
  initiative: 0.4,
  cameraTopic: "",
  cameraMessageType: "CompressedImage",
  cameraSnapshotTimeoutMs: 4000,
  depthTopic: "",
  cmdVelTopic: "",
  muteWords: ["go to sleep", "stop listening", "that's all", "thats all", "be quiet", "mute"],
  unmuteWords: ["wake up", "wakeup", "start listening", "unmute"],
  nevermindWords: ["nevermind", "never mind", "forget it"],
};

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function parseSoul(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_]+)\s*:\s*(.+)$/);
    if (!match) continue;
    out[match[1].toLowerCase()] = match[2].trim();
  }
  return out;
}

function loadSoul(): Record<string, string> {
  const pkg = parseSoul(join(packageRoot(), "soul.md"));
  const user = parseSoul(join(homedir(), ".agenticros", "jarvis", "soul.md"));
  return { ...pkg, ...user };
}

export function buildWakeWords(name: string, wakePhrase?: string, aliases: string[] = []): string[] {
  const base = name.trim().toLowerCase();
  const words = [base, `hey ${base}`, `hi ${base}`, `ok ${base}`, `okay ${base}`];
  if (wakePhrase?.trim()) words.push(wakePhrase.trim().toLowerCase());
  for (const alias of aliases) {
    const a = alias.trim().toLowerCase();
    if (a) words.push(a);
  }
  if (base === "jarvis") {
    words.push("jarvus", "hey jarvus", "jarvish", "hey jarvish");
  }
  return [...new Set(words.filter(Boolean))];
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function strList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const items = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return items.length ? items : fallback;
}

export function getJarvisConfig(config: AgenticROSConfig): JarvisConfig {
  const soul = loadSoul();
  const slice =
    config.skills && typeof config.skills === "object"
      ? ((config.skills as Record<string, unknown>)["jarvis"] as Record<string, unknown> | undefined)
      : undefined;
  const c = slice && typeof slice === "object" ? slice : {};

  const name = str(c.name, soul.name || DEFAULTS.name);
  const wakePhrase = str(c.wakePhrase, "");
  const wakeAliases = strList(c.wakeAliases, DEFAULTS.wakeAliases);
  const agentBackendRaw = str(c.agentBackend, DEFAULTS.agentBackend);
  const agentBackend: AgentBackend =
    agentBackendRaw === "openai" || agentBackendRaw === "ollama" ? agentBackendRaw : "openclaw";
  const sttRaw = str(c.sttProvider, DEFAULTS.sttProvider);
  const sttProvider: SttProvider =
    sttRaw === "whisper.cpp" || sttRaw === "openai-compat" ? sttRaw : "openai";
  const ttsRaw = str(c.ttsProvider, DEFAULTS.ttsProvider);
  const ttsProvider: TtsProvider =
    ttsRaw === "openai" || ttsRaw === "espeak" ? ttsRaw : "kokoro";

  return {
    name,
    wakePhrase,
    wakeAliases,
    wakeWords: buildWakeWords(name, wakePhrase, wakeAliases),
    operatorName: str(c.operatorName, soul.operator || DEFAULTS.operatorName),
    character: str(c.character, soul.character || DEFAULTS.character),
    persona: str(c.persona, soul.persona || DEFAULTS.persona),
    personality: str(c.personality, soul.personality || DEFAULTS.personality),
    conversationWindowSec: num(c.conversationWindowSec, DEFAULTS.conversationWindowSec),
    autoStart: bool(c.autoStart, DEFAULTS.autoStart),
    agentBackend,
    openclawAgent: str(c.openclawAgent, DEFAULTS.openclawAgent),
    openaiApiKey: str(c.openaiApiKey, DEFAULTS.openaiApiKey),
    openaiBaseUrl: str(c.openaiBaseUrl, DEFAULTS.openaiBaseUrl),
    openaiModel: str(c.openaiModel, DEFAULTS.openaiModel),
    openaiVisionModel: str(c.openaiVisionModel, DEFAULTS.openaiVisionModel),
    ollamaUrl: str(c.ollamaUrl, DEFAULTS.ollamaUrl),
    ollamaModel: str(c.ollamaModel, DEFAULTS.ollamaModel),
    ollamaVisionModel: str(c.ollamaVisionModel, DEFAULTS.ollamaVisionModel),
    sttProvider,
    sttModel: str(c.sttModel, DEFAULTS.sttModel),
    sttCommand: str(c.sttCommand, DEFAULTS.sttCommand),
    ttsProvider,
    ttsVoice: str(c.ttsVoice, DEFAULTS.ttsVoice),
    ttsCommand: str(c.ttsCommand, DEFAULTS.ttsCommand),
    micDevice: str(c.micDevice, DEFAULTS.micDevice),
    vadThreshold: num(c.vadThreshold, DEFAULTS.vadThreshold),
    greetOnPresence: bool(c.greetOnPresence, DEFAULTS.greetOnPresence),
    presenceIntervalMs: num(c.presenceIntervalMs, DEFAULTS.presenceIntervalMs),
    initiative: num(c.initiative, DEFAULTS.initiative),
    cameraTopic: str(c.cameraTopic, DEFAULTS.cameraTopic),
    cameraMessageType: c.cameraMessageType === "Image" ? "Image" : "CompressedImage",
    cameraSnapshotTimeoutMs: num(c.cameraSnapshotTimeoutMs, DEFAULTS.cameraSnapshotTimeoutMs),
    depthTopic: str(c.depthTopic, DEFAULTS.depthTopic),
    cmdVelTopic: str(c.cmdVelTopic, DEFAULTS.cmdVelTopic),
    muteWords: strList(c.muteWords, DEFAULTS.muteWords).map((w) => w.toLowerCase()),
    unmuteWords: strList(c.unmuteWords, DEFAULTS.unmuteWords).map((w) => w.toLowerCase()),
    nevermindWords: strList(c.nevermindWords, DEFAULTS.nevermindWords).map((w) => w.toLowerCase()),
  };
}

export function resolveCameraTopic(config: AgenticROSConfig, jarvis: JarvisConfig): string {
  const fromSkill = jarvis.cameraTopic.trim();
  if (fromSkill) return fromSkill;
  const fromRobot = (config.robot?.cameraTopic ?? "").trim();
  if (fromRobot) return fromRobot;
  return REALSENSE_COLOR;
}

export function resolveCmdVelTopic(config: AgenticROSConfig, jarvis: JarvisConfig): string {
  const override = jarvis.cmdVelTopic.trim();
  if (override) return override;
  const teleop = (config.teleop as { cmdVelTopic?: string } | undefined)?.cmdVelTopic?.trim();
  if (teleop) return teleop;
  return "/cmd_vel";
}
