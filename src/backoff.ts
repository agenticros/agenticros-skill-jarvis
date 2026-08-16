/**
 * Shared exponential-backoff gate for loops that poll a paid API on a fixed
 * timer (presence vision, STT). Tolerates isolated blips, then backs off
 * instead of retrying every tick straight through an outage.
 */

const FAILURE_THRESHOLD = 3;
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface BackoffState {
  failures: number;
  backoffUntil: number;
}

export function isBackingOff(state: BackoffState): boolean {
  return state.backoffUntil > Date.now();
}

export function recordSuccess(state: BackoffState): void {
  state.failures = 0;
  state.backoffUntil = 0;
}

/** Returns the applied backoff in ms, or 0 if still under the tolerance threshold. */
export function recordFailure(state: BackoffState): number {
  state.failures += 1;
  if (state.failures < FAILURE_THRESHOLD) return 0;
  const backoffMs = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** (state.failures - FAILURE_THRESHOLD),
  );
  state.backoffUntil = Date.now() + backoffMs;
  return backoffMs;
}
