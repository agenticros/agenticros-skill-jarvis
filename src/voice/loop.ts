/**
 * Always-on listen loop: mic → VAD → STT → wake gate → fast chat or OpenClaw → TTS.
 */

import type { ChildProcess } from "node:child_process";
import { askOpenClaw } from "../agent/openclaw.js";
import { askDirectLlm, askFastChat } from "../agent/llm.js";
import { looksLikeRobotRequest } from "../agent/route.js";
import { isBackingOff, recordFailure, recordSuccess } from "../backoff.js";
import { inConversationWindow, rememberTurn, type JarvisRuntime } from "../runtime.js";
import { MIC_SAMPLE_RATE, startMic } from "./mic.js";
import { speak } from "./tts.js";
import { RmsVad } from "./vad.js";
import { isMuteCommand, isNevermind, isUnmuteCommand, isWake, stripWakePhrase } from "./wake.js";

let micProc: ChildProcess | null = null;
let handling = false;

export function isVoiceLoopRunning(rt: JarvisRuntime): boolean {
  return rt.running;
}

export async function startVoiceLoop(rt: JarvisRuntime): Promise<void> {
  if (rt.running) return;
  if (micProc) {
    // Defensive: a mic process from a runtime we no longer hold a reference
    // to (e.g. a previous instance that wasn't stopped cleanly) would
    // otherwise be silently replaced here and leak forever.
    micProc.kill("SIGTERM");
    micProc = null;
  }
  rt.voiceAbort = new AbortController();
  rt.running = true;
  const vad = new RmsVad({
    threshold: rt.jarvis.vadThreshold,
    silenceMs: rt.jarvis.vadSilenceMs,
    minSpeechMs: 280,
    sampleRate: MIC_SAMPLE_RATE,
  });

  try {
    micProc = startMic(
      (chunk) => {
        if (!rt.running || rt.speaking) return;
        const utterance = vad.process(chunk);
        if (utterance && !handling) {
          handling = true;
          void handleUtterance(rt, utterance).finally(() => {
            handling = false;
          });
        }
      },
      (err) => rt.logger.warn(`Jarvis mic: ${err.message}`),
      rt.jarvis.micDevice || undefined,
    );
    rt.logger.info("Jarvis voice loop started");
  } catch (err) {
    rt.running = false;
    rt.logger.error(`Jarvis: could not start microphone: ${String(err)}`);
    throw err;
  }
}

export async function stopVoiceLoop(rt: JarvisRuntime): Promise<void> {
  rt.running = false;
  rt.voiceAbort?.abort();
  rt.voiceAbort = null;
  if (micProc) {
    micProc.kill("SIGTERM");
    micProc = null;
  }
  rt.logger.info("Jarvis voice loop stopped");
}

async function handleUtterance(rt: JarvisRuntime, pcm: Buffer): Promise<void> {
  if (isBackingOff(rt.sttBackoff)) return;
  let heard = "";
  try {
    heard = await transcribeSafe(rt, pcm);
    recordSuccess(rt.sttBackoff);
  } catch (err) {
    const backoffMs = recordFailure(rt.sttBackoff);
    if (backoffMs > 0) {
      rt.logger.warn(
        `Jarvis STT: ${String(err).slice(0, 200)} — backing off ${Math.round(backoffMs / 1000)}s after ${rt.sttBackoff.failures} consecutive failures`,
      );
    } else {
      rt.logger.warn(`Jarvis STT: ${String(err).slice(0, 200)}`);
    }
    return;
  }
  if (!heard) return;
  rt.logger.info(`Jarvis heard: ${heard}`);

  if (rt.muted) {
    if (isUnmuteCommand(heard, rt.jarvis)) {
      rt.muted = false;
      rt.logger.info("Jarvis unmuted");
    }
    return;
  }

  if (isMuteCommand(heard, rt.jarvis)) {
    rt.muted = true;
    await say(rt, "Going quiet.");
    return;
  }
  if (isNevermind(heard, rt.jarvis)) {
    rt.lastResponseAt = 0;
    return;
  }

  const awake = isWake(heard, rt.jarvis) || inConversationWindow(rt);
  if (!awake) return;

  const utterance = stripWakePhrase(heard, rt.jarvis) || heard;
  if (!utterance || utterance.length < 2) {
    await say(rt, "Yes?");
    return;
  }

  try {
    const reply = await think(rt, utterance);
    await say(rt, reply);
  } catch (err) {
    rt.logger.error(`Jarvis think: ${String(err).slice(0, 240)}`);
    await say(rt, "Sorry, I had trouble with that.");
  }
}

async function transcribeSafe(rt: JarvisRuntime, pcm: Buffer): Promise<string> {
  const { transcribe } = await import("./stt.js");
  return transcribe(pcm, rt.jarvis, rt.voiceAbort?.signal);
}

async function think(rt: JarvisRuntime, utterance: string): Promise<string> {
  const signal = rt.voiceAbort?.signal;
  if (rt.jarvis.agentBackend !== "openclaw") {
    return rememberTurn(rt, utterance, await askDirectLlm(utterance, rt, signal));
  }
  if (rt.jarvis.chatBackend === "off") {
    return rememberTurn(rt, utterance, await askOpenClaw(utterance, rt.jarvis, rt.logger, signal));
  }
  return rememberTurn(rt, utterance, await answerHybrid(rt, utterance, signal));
}

async function answerHybrid(
  rt: JarvisRuntime,
  utterance: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (looksLikeRobotRequest(utterance)) {
    rt.logger.info("Jarvis route: robot (keyword)");
    return askOpenClaw(utterance, rt.jarvis, rt.logger, signal);
  }
  try {
    return await askFastChat(utterance, rt, signal);
  } catch (err) {
    rt.logger.warn(
      `Jarvis fast chat failed (${String(err).slice(0, 160)}); using OpenClaw`,
    );
    return askOpenClaw(utterance, rt.jarvis, rt.logger, signal);
  }
}

export async function say(rt: JarvisRuntime, text: string): Promise<void> {
  if (!text.trim()) return;
  rt.speaking = true;
  try {
    await speak(text, rt.jarvis, rt.logger, rt.voiceAbort?.signal);
    rt.lastResponseAt = Date.now();
  } finally {
    rt.speaking = false;
  }
}
