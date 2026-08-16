/**
 * RealSense color-topic presence loop. Greets when a person arrives.
 */

import { resolveCameraSubscribeTopic } from "@agenticros/core";
import { isBackingOff, recordFailure, recordSuccess } from "../backoff.js";
import { resolveCameraTopic } from "../config.js";
import { openaiBaseUrl, resolveOpenAiKey } from "../keys.js";
import type { JarvisRuntime } from "../runtime.js";
import { speak } from "../voice/tts.js";
import {
  COMPRESSED_IMAGE_TYPE,
  HUMAN_DETECTION_PROMPT,
  IMAGE_TYPE,
  callOllamaVision,
  callOpenAIVision,
  grabCameraSnapshot,
  parseHumanDetectionResponse,
} from "../vision.js";
import { arrivalGreeting, maybeNudge, returnGreeting, startupGreeting } from "./greetings.js";

export function startPresenceLoop(rt: JarvisRuntime): void {
  if (!rt.jarvis.greetOnPresence) return;
  if (rt.presenceTimer) return;
  const tick = () => {
    void presenceTick(rt);
  };
  rt.presenceTimer = setInterval(tick, rt.jarvis.presenceIntervalMs);
  setTimeout(tick, 1500);
}

export function stopPresenceLoop(rt: JarvisRuntime): void {
  if (rt.presenceTimer) {
    clearInterval(rt.presenceTimer);
    rt.presenceTimer = null;
  }
}

async function presenceTick(rt: JarvisRuntime): Promise<void> {
  if (rt.muted || rt.speaking) return;
  if (isBackingOff(rt.presenceBackoff)) return;
  let human = false;
  try {
    human = await detectPerson(rt);
    recordSuccess(rt.presenceBackoff);
  } catch (err) {
    const backoffMs = recordFailure(rt.presenceBackoff);
    if (backoffMs > 0) {
      rt.logger.warn(
        `Jarvis presence: ${String(err).slice(0, 160)} — backing off ${Math.round(backoffMs / 1000)}s after ${rt.presenceBackoff.failures} consecutive failures`,
      );
    } else {
      rt.logger.warn(`Jarvis presence: ${String(err).slice(0, 160)}`);
    }
    return;
  }
  const now = Date.now();
  if (human) {
    if (!rt.personPresent) await onPersonArrived(rt, now);
    rt.personPresent = true;
    rt.lastSeenAt = now;
  } else if (rt.personPresent) {
    rt.personPresent = false;
    rt.lastLostAt = now;
  }
}

async function detectPerson(rt: JarvisRuntime): Promise<boolean> {
  const transport = rt.context.getTransport();
  const topic = resolveCameraSubscribeTopic(rt.config, resolveCameraTopic(rt.config, rt.jarvis));
  const messageType = rt.jarvis.cameraMessageType === "Image" ? IMAGE_TYPE : COMPRESSED_IMAGE_TYPE;
  const snapshot = await grabCameraSnapshot(
    transport,
    topic,
    messageType,
    rt.jarvis.cameraSnapshotTimeoutMs,
  );

  let text: string;
  if (rt.jarvis.agentBackend === "ollama") {
    text = await callOllamaVision(
      rt.jarvis.ollamaUrl,
      rt.jarvis.ollamaVisionModel,
      snapshot.base64,
      HUMAN_DETECTION_PROMPT,
      12_000,
    );
  } else {
    const key = resolveOpenAiKey(rt.jarvis);
    if (!key) {
      rt.logger.warn("Jarvis presence: no OpenAI key; skipping person detect");
      return false;
    }
    text = await callOpenAIVision(
      key,
      rt.jarvis.openaiVisionModel,
      snapshot,
      HUMAN_DETECTION_PROMPT,
      12_000,
      openaiBaseUrl(rt.jarvis),
      "low",
    );
  }
  return parseHumanDetectionResponse(text).human;
}

async function onPersonArrived(rt: JarvisRuntime, now: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();
  const operator = rt.jarvis.operatorName || "friend";

  if (rt.greetingDate !== today) {
    rt.greetedToday = false;
    rt.greetingDate = today;
  }

  let line = "";
  if (!rt.startupGreeted) {
    line = rt.greetedToday ? startupGreeting(operator, hour) : arrivalGreeting(operator, hour);
    rt.startupGreeted = true;
    rt.greetedToday = true;
  } else if (!rt.greetedToday) {
    line = arrivalGreeting(operator, hour);
    rt.greetedToday = true;
  } else if (rt.lastLostAt > 0 && now - rt.lastSeenAt > 10_000) {
    const absence = (now - rt.lastLostAt) / 1000;
    if (absence >= 10) line = returnGreeting(operator, absence);
  }

  if (!line) return;
  const nudge = maybeNudge(rt.jarvis.initiative);
  if (nudge) line = `${line} ${nudge}`;
  rt.logger.info(`Jarvis greeting: ${line}`);
  rt.speaking = true;
  try {
    await speak(line, rt.jarvis, rt.logger);
    rt.lastResponseAt = Date.now();
  } finally {
    rt.speaking = false;
  }
}
