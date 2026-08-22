import type { JarvisRuntime } from "./runtime.js";
import { startPresenceLoop, stopPresenceLoop } from "./presence/presence.js";
import { startupGreeting } from "./presence/greetings.js";
import { say, startVoiceLoop, stopVoiceLoop } from "./voice/loop.js";

/** One spoken boot greeting per gateway process (survives skill re-register). */
let spokeBootGreeting = false;

export async function startJarvis(rt: JarvisRuntime): Promise<void> {
  await startVoiceLoop(rt);
  startPresenceLoop(rt);
  // Presence greetings need camera + vision API. Speak a short boot line locally
  // so "loop started" is audible even when OpenAI/camera presence is down.
  if (!spokeBootGreeting && !rt.startupGreeted) {
    spokeBootGreeting = true;
    const hour = new Date().getHours();
    const operator = rt.jarvis.operatorName || "friend";
    const line = startupGreeting(operator, hour);
    rt.startupGreeted = true;
    rt.greetedToday = true;
    rt.greetingDate = new Date().toISOString().slice(0, 10);
    rt.logger.info(`Jarvis greeting: ${line}`);
    await say(rt, line);
  }
}

export async function stopJarvis(rt: JarvisRuntime): Promise<void> {
  stopPresenceLoop(rt);
  await stopVoiceLoop(rt);
}
