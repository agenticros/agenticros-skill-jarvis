/**
 * Wake-word and mute-phrase matching on normalized transcripts.
 */

import type { JarvisConfig } from "../config.js";

export function normalizeHeard(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function heardContainsPhrase(heard: string, phrase: string): boolean {
  const h = ` ${normalizeHeard(heard)} `;
  const p = ` ${normalizeHeard(phrase)} `;
  return p.trim().length > 0 && h.includes(p);
}

export function matchingPhrase(heard: string, phrases: string[]): string | null {
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    if (heardContainsPhrase(heard, phrase)) return phrase;
  }
  return null;
}

export function stripWakePhrase(heard: string, jarvis: JarvisConfig): string {
  let text = normalizeHeard(heard);
  const sorted = [...jarvis.wakeWords].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    const p = normalizeHeard(phrase);
    if (text.startsWith(p)) {
      text = text.slice(p.length).trim();
      break;
    }
    const idx = text.indexOf(` ${p} `);
    if (idx >= 0) {
      text = (text.slice(0, idx) + " " + text.slice(idx + p.length + 1)).trim();
      break;
    }
  }
  return text.replace(/^(hey|hi|ok|okay)\s+/i, "").trim();
}

export function isMuteCommand(heard: string, jarvis: JarvisConfig): boolean {
  return matchingPhrase(heard, jarvis.muteWords) != null;
}

export function isUnmuteCommand(heard: string, jarvis: JarvisConfig): boolean {
  return (
    matchingPhrase(heard, jarvis.unmuteWords) != null ||
    matchingPhrase(heard, jarvis.wakeWords) != null
  );
}

export function isNevermind(heard: string, jarvis: JarvisConfig): boolean {
  return matchingPhrase(heard, jarvis.nevermindWords) != null;
}

export function isWake(heard: string, jarvis: JarvisConfig): boolean {
  return matchingPhrase(heard, jarvis.wakeWords) != null;
}
