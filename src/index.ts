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
  // config reload / agent pre-warm) without restarting, initRuntime() below
  // replaces the module-level runtime singleton. Stop the previous instance
  // first so mic/presence don't leak — and await that stop before autoStart
  // so we don't race two arecord processes on the same Pulse source.
  const previous = tryGetRuntime();

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
  } else if (!jarvis.autoStart) {
    api.logger.warn(
      "Jarvis: OpenClaw registerService is unavailable; start with jarvis_control action start",
    );
  }

  // OpenClaw may re-register skills during agent runtime pre-warm without
  // calling service.start() again. Restart only when we replaced a live
  // runtime — never on first register (that is service.start()'s job), and
  // never during contract discovery (`sync-skill-tools.mjs` / AGENTICROS_SKILL_DISCOVERY),
  // which would otherwise spawn arecord and hang the install forever.
  const discovery =
    process.env.AGENTICROS_SKILL_DISCOVERY === "1" ||
    process.env.AGENTICROS_SKILL_DISCOVERY === "true";
  const hasServiceApi = typeof api.registerService === "function";

  const boot = async () => {
    if (discovery) return;
    if (previous) {
      try {
        await stopJarvis(previous);
      } catch (e) {
        api.logger.warn(`Jarvis: failed to stop previous runtime on re-register: ${String(e)}`);
      }
      if (jarvis.autoStart) await startJarvis(runtime);
      return;
    }
    // First load with no registerService: start ourselves. Otherwise wait for service.start().
    if (jarvis.autoStart && !hasServiceApi) {
      await startJarvis(runtime);
    }
  };
  void boot().catch((e) => api.logger.warn(`Jarvis: autoStart failed: ${String(e)}`));
}
