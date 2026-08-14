/**
 * Merlin-style presence greeting lines. No head gestures.
 */

export function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export function arrivalGreeting(operator: string, hour: number): string {
  if (hour < 12) {
    return pick([
      `Good morning, ${operator}. There you are.`,
      `Morning, ${operator}. Nice to see you.`,
      `Good morning, ${operator}. Ready when you are.`,
    ]);
  }
  if (hour < 18) {
    return pick([
      `Good afternoon, ${operator}. There you are.`,
      `Hey ${operator}. Afternoon mode, engaged.`,
      `Welcome back, ${operator}. Good afternoon.`,
    ]);
  }
  return pick([
    `Good evening, ${operator}. There you are.`,
    `Evening, ${operator}. Glad you're back.`,
    `Good evening, ${operator}. I was keeping watch.`,
  ]);
}

export function startupGreeting(operator: string, hour: number): string {
  if (hour < 12) {
    return pick([
      `Good morning again, ${operator}. There you are.`,
      `Morning, ${operator}. Eyes on.`,
    ]);
  }
  if (hour < 18) {
    return pick([
      `Good afternoon, ${operator}. There you are.`,
      `Afternoon, ${operator}. I can see you now.`,
    ]);
  }
  return pick([
    `Good evening, ${operator}. There you are.`,
    `Evening, ${operator}. I see you now.`,
  ]);
}

export function returnGreeting(operator: string, absenceSec: number): string {
  if (absenceSec < 300) {
    return pick([
      `There you are, ${operator}.`,
      `Welcome back, ${operator}.`,
      `Found you again, ${operator}.`,
    ]);
  }
  if (absenceSec < 900) return `Welcome back.`;
  if (absenceSec < 2700) {
    const minutes = Math.floor(absenceSec / 60);
    return `Welcome back. ${minutes} minutes.`;
  }
  return `Been a while. Still on it?`;
}

export function maybeNudge(initiative: number): string {
  if (Math.random() > initiative) return "";
  return pick(["Need anything?", "Want me to look around?", "I'm here if you need me."]);
}
