/**
 * Shared runtime state for the voice loop, presence loop, and tools.
 */

import type { AgenticROSConfig } from "@agenticros/core";
import type { BackoffState } from "./backoff.js";
import type { JarvisConfig } from "./config.js";
import type { SkillContext, SkillLogger } from "./types.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface JarvisRuntime {
  config: AgenticROSConfig;
  jarvis: JarvisConfig;
  context: SkillContext;
  logger: SkillLogger;
  muted: boolean;
  speaking: boolean;
  running: boolean;
  lastResponseAt: number;
  voiceAbort: AbortController | null;
  presenceTimer: ReturnType<typeof setInterval> | null;
  startupGreeted: boolean;
  greetedToday: boolean;
  greetingDate: string;
  lastSeenAt: number;
  lastLostAt: number;
  personPresent: boolean;
  presenceBackoff: BackoffState;
  sttBackoff: BackoffState;
  chatHistory: ChatTurn[];
}

let runtime: JarvisRuntime | null = null;

export function initRuntime(
  config: AgenticROSConfig,
  jarvis: JarvisConfig,
  context: SkillContext,
): JarvisRuntime {
  runtime = {
    config,
    jarvis,
    context,
    logger: context.logger,
    muted: false,
    speaking: false,
    running: false,
    lastResponseAt: 0,
    voiceAbort: null,
    presenceTimer: null,
    startupGreeted: false,
    greetedToday: false,
    greetingDate: "",
    lastSeenAt: 0,
    lastLostAt: 0,
    personPresent: false,
    presenceBackoff: { failures: 0, backoffUntil: 0 },
    sttBackoff: { failures: 0, backoffUntil: 0 },
    chatHistory: [],
  };
  return runtime;
}

export function getRuntime(): JarvisRuntime {
  if (!runtime) throw new Error("Jarvis runtime is not initialized");
  return runtime;
}

export function tryGetRuntime(): JarvisRuntime | null {
  return runtime;
}

export function inConversationWindow(rt: JarvisRuntime): boolean {
  if (rt.lastResponseAt <= 0) return false;
  return Date.now() - rt.lastResponseAt < rt.jarvis.conversationWindowSec * 1000;
}

const MAX_CHAT_HISTORY = 10;

export function rememberTurn(rt: JarvisRuntime, user: string, assistant: string): string {
  const userText = user.trim();
  const assistantText = assistant.trim();
  if (!userText || !assistantText) return assistant;
  rt.chatHistory.push({ role: "user", content: userText });
  rt.chatHistory.push({ role: "assistant", content: assistantText });
  if (rt.chatHistory.length > MAX_CHAT_HISTORY) {
    rt.chatHistory.splice(0, rt.chatHistory.length - MAX_CHAT_HISTORY);
  }
  return assistant;
}
