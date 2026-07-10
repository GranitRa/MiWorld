// Fixed pixel-art palette for the Mars colony — named ramps (dark → light). Every
// generator must pick only from these so the whole world reads as one painted set.

export const RAMPS = {
  regolith: ["#3a1e12", "#7a3e22", "#a8562e", "#c47a44"],
  rust: ["#5b2a15", "#8c3d1c", "#b5561f", "#d97a34"],
  ice: ["#8fb8cf", "#bcd7e8", "#e6f2f8"],
  steel: ["#3a3d44", "#5a5f68", "#878d98", "#b7bec8"],
  fabric: ["#c9c4b8", "#e4e0d6", "#f5f2ea"],
  solar: ["#12294a", "#1f4a86", "#3f79c0"],
  glow: ["#7a3a10", "#d98a2a", "#ffd27a"],
  accent: ["#6b3f27", "#a8482f", "#c98f2a", "#2a6f5a", "#7a4a52", "#4a5578", "#2b2320", "#e9dcc3"],
} as const;

export type RampName = keyof typeof RAMPS;

/** Pick a ramp entry by 0..1 fraction (0 = darkest). */
export function ramp(name: RampName, t: number): string {
  const r = RAMPS[name];
  const i = Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)));
  return r[i]!;
}
