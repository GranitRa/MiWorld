// Deterministic noise using ONLY integer hashing (no Math.sin/trig tricks), so the
// server and client compute byte-identical terrain from the same seed. All maths here is
// pure and resolution-independent.

function hash2(xi: number, yi: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ xi, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h ^ yi, 0x165667b1);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0, 1)
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const n00 = hash2(xi, yi, seed);
  const n10 = hash2(xi + 1, yi, seed);
  const n01 = hash2(xi, yi + 1, seed);
  const n11 = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  frequency?: number;
}

/** Fractal Brownian motion in [0, 1). */
export function fbm(x: number, y: number, seed: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 5;
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  let freq = opts.frequency ?? 1;
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/** Domain-warped fBm — richer, less grid-aligned ridges. */
export function warpedFbm(x: number, y: number, seed: number, opts: FbmOptions = {}): number {
  const wx = fbm(x + 5.2, y + 1.3, seed ^ 0x1234, opts) - 0.5;
  const wy = fbm(x + 8.3, y + 2.8, seed ^ 0x5678, opts) - 0.5;
  return fbm(x + 2 * wx, y + 2 * wy, seed, opts);
}
