/**
 * Robot actions used by the direct LLM backend: see, scan_for, follow hint.
 */

import type { RosTransport } from "@agenticros/core";
import { resolveCameraSubscribeTopic, toNamespacedTopicFull } from "@agenticros/core";
import { resolveCameraTopic, resolveCmdVelTopic } from "./config.js";
import { openaiBaseUrl, resolveOpenAiKey } from "./keys.js";
import type { JarvisRuntime } from "./runtime.js";
import {
  COMPRESSED_IMAGE_TYPE,
  IMAGE_TYPE,
  callOllamaVision,
  callOpenAIVision,
  grabCameraSnapshot,
} from "./vision.js";

const TWIST_TYPE = "geometry_msgs/msg/Twist";

export async function describeScene(rt: JarvisRuntime): Promise<string> {
  const snapshot = await snapshotColor(rt);
  const prompt =
    "Describe this robot camera view in one short spoken sentence. Name people, objects, and layout. No lists.";
  return visionText(rt, snapshot, prompt);
}

export async function scanForObject(
  rt: JarvisRuntime,
  target: string,
  signal?: AbortSignal,
): Promise<string> {
  const transport = rt.context.getTransport();
  const topic = toNamespacedTopicFull(rt.config, resolveCmdVelTopic(rt.config, rt.jarvis));
  const deadline = Date.now() + 25_000;
  const speed = 0.35;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) break;
      await publishTwist(transport, topic, speed);
      await sleep(800);
      await publishTwist(transport, topic, 0);
      const snapshot = await snapshotColor(rt);
      const prompt = `Is there a ${target} clearly visible in this robot camera image? Answer YES or NO on the first line, then one short sentence.`;
      const text = await visionText(rt, snapshot, prompt);
      if (/^\s*yes\b/i.test(text)) {
        return `I found a ${target}. ${text.replace(/^\s*yes[.,]?\s*/i, "")}`.trim();
      }
    }
    return `I scanned around but did not find a ${target}.`;
  } finally {
    await publishTwist(transport, topic, 0).catch(() => undefined);
  }
}

export function followMeHint(): string {
  return "I cannot start Follow Me from this chat backend. Install @agenticros/followme and set agentBackend to openclaw, then say follow me.";
}

async function snapshotColor(rt: JarvisRuntime) {
  const transport = rt.context.getTransport();
  const topic = resolveCameraSubscribeTopic(rt.config, resolveCameraTopic(rt.config, rt.jarvis));
  const messageType = rt.jarvis.cameraMessageType === "Image" ? IMAGE_TYPE : COMPRESSED_IMAGE_TYPE;
  return grabCameraSnapshot(transport, topic, messageType, rt.jarvis.cameraSnapshotTimeoutMs);
}

async function visionText(
  rt: JarvisRuntime,
  snapshot: { base64: string; mimeType: string },
  prompt: string,
): Promise<string> {
  if (rt.jarvis.agentBackend === "ollama") {
    return callOllamaVision(
      rt.jarvis.ollamaUrl,
      rt.jarvis.ollamaVisionModel,
      snapshot.base64,
      prompt,
      12_000,
    );
  }
  const key = resolveOpenAiKey(rt.jarvis);
  if (!key) throw new Error("No OpenAI API key for vision");
  return callOpenAIVision(
    key,
    rt.jarvis.openaiVisionModel,
    snapshot,
    prompt,
    12_000,
    openaiBaseUrl(rt.jarvis),
  );
}

async function publishTwist(transport: RosTransport, topic: string, angularZ: number): Promise<void> {
  await transport.publish({
    topic,
    type: TWIST_TYPE,
    msg: {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angularZ },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
