/**
 * AgenticROS Jarvis skill.
 * Registers tools: jarvis_control, jarvis_speak.
 * Starts the voice + presence service when autoStart is true.
 */

import type { AgenticROSConfig } from "@agenticros/core";
import type { SkillPluginApi, SkillContext } from "./types.js";
import { getJarvisConfig } from "./config.js";
import { initRuntime } from "./runtime.js";
import { registerJarvisControlTool, registerJarvisSpeakTool } from "./tools/jarvis-control.js";
import { startJarvis, stopJarvis } from "./lifecycle.js";

export function registerSkill(
  api: SkillPluginApi,
  config: AgenticROSConfig,
  context: SkillContext,
): void {
  const jarvis = getJarvisConfig(config);
  const runtime = initRuntime(config, jarvis, context);
  api.logger.info(
    `Jarvis skill loaded (name=${jarvis.name}, wake=${jarvis.wakeWords[1] ?? `hey ${jarvis.name.toLowerCase()}`}, backend=${jarvis.agentBackend})`,
  );

  registerJarvisControlTool(api);
  registerJarvisSpeakTool(api);

  if (typeof api.registerService === "function") {
    api.registerService({
      id: "jarvis-voice",
      async start() {
        if (jarvis.autoStart) await startJarvis(runtime);
      },
      async stop() {
        await stopJarvis(runtime);
      },
    });
  } else if (jarvis.autoStart) {
    api.logger.warn(
      "Jarvis: OpenClaw registerService is unavailable; start with jarvis_control action start",
    );
  }
}
