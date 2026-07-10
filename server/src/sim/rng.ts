// Deterministic RNG gateway. All stochastic draws in the sim go through this so a run
// is reproducible and, crucially, RESUMABLE: per-stream state is serialized into every
// snapshot, so after a restart each stream continues its exact sequence.
//
// Named streams keep unrelated subsystems independent (drawing from "weather" never
// shifts "births"). The `planet` stream is derived purely from the world seed, so
// worldgen is identical on server and client.

function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export class RngGateway {
  private readonly states = new Map<string, number>();

  constructor(
    private readonly seed: number,
    saved?: Record<string, number>,
  ) {
    if (saved) {
      for (const [k, v] of Object.entries(saved)) this.states.set(k, v >>> 0);
    }
  }

  private stateFor(name: string): number {
    let s = this.states.get(name);
    if (s === undefined) {
      s = xmur3(`${this.seed}:${name}`);
      this.states.set(name, s);
    }
    return s;
  }

  /** Next float in [0, 1) for the named stream (mulberry32). */
  next(name: string): number {
    let a = this.stateFor(name);
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.states.set(name, a >>> 0);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(name: string, maxExclusive: number): number {
    return Math.floor(this.next(name) * maxExclusive);
  }

  /** Float in [min, max). */
  range(name: string, min: number, max: number): number {
    return min + this.next(name) * (max - min);
  }

  /** Snapshot of every stream's state, to persist and later restore exactly. */
  serialize(): Record<string, number> {
    return Object.fromEntries(this.states);
  }
}
