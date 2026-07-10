import { PLAYBACK_WINDOW_REAL_MS, REAL_MS_PER_TICK, type TickMessage } from "@miworld/shared";

export type PlaybackSpeed = 0 | 1 | 4;

/**
 * A RAM-only ring buffer of recent live ticks. It lets a viewer pause, rewind, and run
 * at 4× purely locally — the server keeps ticking regardless (this never touches it).
 * Playing forward past the newest buffered tick clamps back to LIVE. Deep history is the
 * chronicle (Postgres), not this buffer.
 */
export class PlaybackBuffer {
  private readonly buf: TickMessage[] = [];
  private playPos = -1;
  private live = true;
  private speed: PlaybackSpeed = 1;
  private acc = 0; // fractional-tick accumulator
  private readonly maxTicks: number;

  constructor(maxTicks = Math.ceil(PLAYBACK_WINDOW_REAL_MS / REAL_MS_PER_TICK)) {
    this.maxTicks = Math.max(1, maxTicks);
  }

  /** Ingest a freshly arrived live tick. */
  ingest(tick: TickMessage): void {
    this.buf.push(tick);
    if (this.buf.length > this.maxTicks) {
      const dropped = this.buf.length - this.maxTicks;
      this.buf.splice(0, dropped);
      if (!this.live) this.playPos = Math.max(0, this.playPos - dropped);
    }
    if (this.live) this.playPos = this.buf.length - 1;
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed;
  }

  getSpeed(): PlaybackSpeed {
    return this.speed;
  }

  /** Jump back n ticks (leaves LIVE). */
  rewind(nTicks: number): void {
    if (this.buf.length === 0) return;
    this.live = false;
    this.playPos = Math.max(0, this.playPos - nTicks);
  }

  goLive(): void {
    this.live = true;
    this.playPos = this.buf.length - 1;
  }

  isLive(): boolean {
    return this.live;
  }

  /** Advance the playhead by real elapsed time. No-op while LIVE or paused. */
  step(realDtMs: number): void {
    if (this.live) {
      this.playPos = this.buf.length - 1;
      return;
    }
    if (this.speed === 0) return;

    this.acc += (this.speed * realDtMs) / REAL_MS_PER_TICK;
    const advance = Math.floor(this.acc);
    if (advance <= 0) return;
    this.acc -= advance;
    this.playPos += advance;

    if (this.playPos >= this.buf.length - 1) {
      this.playPos = this.buf.length - 1;
      this.live = true;
      this.acc = 0;
    }
  }

  /** The tick the viewer is currently seeing, or null if nothing buffered yet. */
  current(): TickMessage | null {
    return this.buf[this.playPos] ?? null;
  }

  get size(): number {
    return this.buf.length;
  }
}
