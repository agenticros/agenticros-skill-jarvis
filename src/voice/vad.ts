/**
 * RMS energy VAD over 16-bit PCM chunks.
 */

export interface VadConfig {
  threshold: number;
  silenceMs: number;
  minSpeechMs: number;
  sampleRate: number;
}

export class RmsVad {
  private speaking = false;
  private speech: Buffer[] = [];
  private silenceMs = 0;
  private speechMs = 0;
  private readonly cfg: VadConfig;

  constructor(cfg: VadConfig) {
    this.cfg = cfg;
  }

  reset(): void {
    this.speaking = false;
    this.speech = [];
    this.silenceMs = 0;
    this.speechMs = 0;
  }

  /**
   * Feed a PCM16 chunk. Returns a complete utterance buffer when speech ends.
   */
  process(chunk: Buffer): Buffer | null {
    const rms = rmsPcm16(chunk);
    const durationMs = (chunk.length / 2 / this.cfg.sampleRate) * 1000;
    const loud = rms >= this.cfg.threshold;

    if (!this.speaking) {
      if (loud) {
        this.speaking = true;
        this.speech = [chunk];
        this.speechMs = durationMs;
        this.silenceMs = 0;
      }
      return null;
    }

    this.speech.push(chunk);
    if (loud) {
      this.speechMs += durationMs;
      this.silenceMs = 0;
      return null;
    }
    this.silenceMs += durationMs;
    if (this.silenceMs >= this.cfg.silenceMs) {
      const utterance = Buffer.concat(this.speech);
      const ok = this.speechMs >= this.cfg.minSpeechMs;
      this.reset();
      return ok ? utterance : null;
    }
    return null;
  }
}

export function rmsPcm16(chunk: Buffer): number {
  const samples = Math.floor(chunk.length / 2);
  if (samples <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = chunk.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}
