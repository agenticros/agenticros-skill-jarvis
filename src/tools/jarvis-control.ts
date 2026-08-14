import { Type } from "@sinclair/typebox";
import { getRuntime, tryGetRuntime } from "../runtime.js";
import type { SkillPluginApi } from "../types.js";
import { startJarvis, stopJarvis } from "../lifecycle.js";
import { isVoiceLoopRunning, say } from "../voice/loop.js";

export function registerJarvisControlTool(api: SkillPluginApi): void {
  api.registerTool({
    name: "jarvis_control",
    label: "Jarvis control",
    description:
      "Start, stop, or check the Jarvis voice loop (microphone, wake word, TTS, presence greetings).",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], {
        description: "start, stop, or status",
      }),
    }),
    async execute(_id, params) {
      const action = (params["action"] as string) ?? "status";
      const rt = tryGetRuntime();
      if (!rt) {
        return {
          content: [{ type: "text" as const, text: "Jarvis runtime is not initialized." }],
          details: { ok: false },
        };
      }
      if (action === "start") {
        await startJarvis(rt);
        return {
          content: [{ type: "text" as const, text: "Jarvis is listening." }],
          details: { running: true },
        };
      }
      if (action === "stop") {
        await stopJarvis(rt);
        return {
          content: [{ type: "text" as const, text: "Jarvis stopped listening." }],
          details: { running: false },
        };
      }
      const running = isVoiceLoopRunning(rt);
      return {
        content: [
          {
            type: "text" as const,
            text: running
              ? `Jarvis is listening as ${rt.jarvis.name}. Say hey ${rt.jarvis.name.toLowerCase()}.`
              : "Jarvis is not listening. Use action start.",
          },
        ],
        details: { running, muted: rt.muted, name: rt.jarvis.name },
      };
    },
  });
}

export function registerJarvisSpeakTool(api: SkillPluginApi): void {
  api.registerTool({
    name: "jarvis_speak",
    label: "Jarvis speak",
    description: "Speak a line of text through Jarvis TTS (Kokoro, with espeak fallback).",
    parameters: Type.Object({
      text: Type.String({ description: "Text to speak out loud." }),
    }),
    async execute(_id, params) {
      const text = String(params["text"] ?? "").trim();
      if (!text) {
        return {
          content: [{ type: "text" as const, text: "Missing text." }],
          details: { ok: false },
        };
      }
      const rt = getRuntime();
      await say(rt, text);
      return {
        content: [{ type: "text" as const, text: `Spoke: ${text}` }],
        details: { ok: true },
      };
    },
  });
}
