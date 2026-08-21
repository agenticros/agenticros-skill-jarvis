/**
 * AgenticROS Jarvis skill.
 * Registers tools: jarvis_control, jarvis_speak.
 * Starts the voice + presence service when autoStart is true.
 */

import type { AgenticROSConfig } from "@agenticros/core";
import type { SkillPluginApi, SkillContext } from "./types.js";
import { getJarvisConfig } from "./config.js";
import { initRuntime, tryGetRuntime } from "./runtime.js";
import { registerJarvisControlTool, registerJarvisSpeakTool } from "./tools/jarvis-control.js";
import { startJarvis, stopJarvis } from "./lifecycle.js";

export function registerSkill(
  api: SkillPluginApi,
  config: AgenticROSConfig,
  context: SkillContext,
): void {
  const jarvis = getJarvisConfig(config);

  // If the gateway re-registers this plugin within the same process (e.g. a
  // config reload) without restarting, initRuntime() below replaces the
  // module-level runtime singleton. Anything still running against the old
  // one (mic capture, presence timer) would become unreachable and leak
  // forever, since getRuntime()/tryGetRuntime() only ever see the newest
  // instance. Stop the previous instance first so its resources are freed.
  const previous = tryGetRuntime();
  if (previous) {
    void stopJarvis(previous).catch((e) =>
      api.logger.warn(`Jarvis: failed to stop previous runtime on re-register: ${String(e)}`),
    );
  }

  const runtime = initRuntime(config, jarvis, context);
  api.logger.info(
    `Jarvis skill loaded (name=${jarvis.name}, wake=${jarvis.wakeWords[1] ?? `hey ${jarvis.name.toLowerCase()}`}, backend=${jarvis.agentBackend}, chat=${jarvis.chatBackend})`,
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
