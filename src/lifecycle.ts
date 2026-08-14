import type { JarvisRuntime } from "./runtime.js";
import { startPresenceLoop, stopPresenceLoop } from "./presence/presence.js";
import { startVoiceLoop, stopVoiceLoop } from "./voice/loop.js";

export async function startJarvis(rt: JarvisRuntime): Promise<void> {
  await startVoiceLoop(rt);
  startPresenceLoop(rt);
}

export async function stopJarvis(rt: JarvisRuntime): Promise<void> {
  stopPresenceLoop(rt);
  await stopVoiceLoop(rt);
}
