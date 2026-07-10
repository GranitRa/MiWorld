import { Color } from "three";

// Mars surface palette. Colour comes from elevation and slope: dusty ochre plains,
// lighter wind-blown tops, dark exposed rock on steep faces, deep rust in the hollows.
const DEEP = new Color("#5b3120");
const LOW = new Color("#9c5836");
const MID = new Color("#b67243");
const HIGH = new Color("#caa06e");
const ROCK = new Color("#6a4530");

const tmp = new Color();

/** Vertex colour for a point at world height `y` (metres) and terrain `slope` (rise/run). */
export function surfaceColor(y: number, slope: number, out = new Color()): Color {
  // Normalise height into ~[0,1] across the world's vertical range.
  const h = Math.max(0, Math.min(1, (y + 160) / 620));

  if (h < 0.25) out.copy(DEEP).lerp(LOW, h / 0.25);
  else if (h < 0.6) out.copy(LOW).lerp(MID, (h - 0.25) / 0.35);
  else out.copy(MID).lerp(HIGH, (h - 0.6) / 0.4);

  // Steep faces expose darker rock.
  const rockiness = Math.min(1, slope * 1.6);
  out.lerp(tmp.copy(ROCK), rockiness * 0.7);
  return out;
}

// Sky / atmosphere key colours, lerped by time of sol in sky.ts.
export const SKY_DAY_TOP = new Color("#3a4a6b");
export const SKY_DAY_HORIZON = new Color("#c98f5a");
export const SKY_NIGHT_TOP = new Color("#05060d");
export const SKY_NIGHT_HORIZON = new Color("#15121f");
export const SUN_COLOR = new Color("#ffd9a8");
export const DUST_FOG = new Color("#c58a5b");
