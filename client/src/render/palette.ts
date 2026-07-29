import { Color } from "three";

// Mars surface palette — illuminated-manuscript storybook: saturated ochres and rust with
// painterly variation, pale wind-blown highlights, dark umber in the hollows, exposed rock
// on steep faces. Colour comes from elevation, slope, and a low-frequency painterly tint.
const DEEP = new Color("#47210f"); // hollows / crater floors
const LOW = new Color("#a8481f"); // rust plains
const MID = new Color("#c86a2c"); // ochre
const HIGH = new Color("#e0ab6a"); // pale dust tops
const ROCK = new Color("#6b3f27"); // exposed rock on steep faces
const WARM = new Color("#e2762a"); // painterly warm patch
const COOL = new Color("#8a4640"); // painterly cool (dusty rose) patch

const tmpRock = new Color();
const tmpTint = new Color();

/**
 * Vertex colour for a point at world height `y` (m), terrain `slope` (rise/run), and a
 * painterly `variation` in [-1,1] (low-frequency noise) that mottles warm/cool patches so
 * the surface reads as painted, not uniform.
 */
export function surfaceColor(y: number, slope: number, variation = 0, out = new Color()): Color {
  const h = Math.max(0, Math.min(1, (y + 160) / 620));

  if (h < 0.28) out.copy(DEEP).lerp(LOW, h / 0.28);
  else if (h < 0.62) out.copy(LOW).lerp(MID, (h - 0.28) / 0.34);
  else out.copy(MID).lerp(HIGH, (h - 0.62) / 0.38);

  // Painterly warm/cool mottling.
  if (variation >= 0) out.lerp(tmpTint.copy(WARM), variation * 0.3);
  else out.lerp(tmpTint.copy(COOL), -variation * 0.28);

  // Steep faces expose darker rock.
  const rockiness = Math.min(1, slope * 1.7);
  out.lerp(tmpRock.copy(ROCK), rockiness * 0.72);
  return out;
}

// Sky / atmosphere key colours, lerped by time of sol in sky.ts.
export const SKY_DAY_TOP = new Color("#4a5580");
export const SKY_DAY_HORIZON = new Color("#e6a659");
export const SKY_NIGHT_TOP = new Color("#05060d");
export const SKY_NIGHT_HORIZON = new Color("#1a1424");
export const SUN_COLOR = new Color("#ffdca6");
export const DUST_FOG = new Color("#cf9059");
// Mars sunsets are blue near the sun (fine dust scatters red forward) — the signature twilight.
export const SKY_TWILIGHT = new Color("#4d6bb0");
// Warm interior light the settlement gives off after dark.
export const CITY_GLOW = new Color("#ffb15a");
