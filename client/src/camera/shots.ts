// The shot grammar: each chronicle category maps to a camera "shot" — a framing pose plus a
// motion over its lifetime. The director (director.ts) plays these against the CameraRig.
//
//   establish  wide, slow orbit of the whole colony (the idle/resources default)
//   pushIn     start wide, ease in close — construction & the reveal of a finished module
//   orbit      slow circle around a subject — ceremonies, milestones, foundings
//   track      hold mid-distance toward the landing site — ships from Earth
//   two-shot   medium, near-horizon — colonists (births, pairings)
//   handheld   close, low, with a nervous jitter — crises

export type ShotMotion = "establish" | "pushIn" | "orbit" | "track" | "twoShot" | "handheld";

export interface ShotSpec {
  motion: ShotMotion;
  /** Camera-to-subject distance in metres: [start, end] (eased over the shot for pushIn). */
  distance: [number, number];
  /** Polar angle from vertical (small = top-down, large = horizon-level). */
  polar: number;
  /** Radians/second the camera orbits the subject (0 = static framing). */
  orbitRate: number;
  /** Positional jitter amplitude in metres (handheld crises only). */
  jitter: number;
  /** How long the shot holds before the director is free to move on (seconds). */
  duration: number;
}

const SHOTS: Record<ShotMotion, ShotSpec> = {
  establish: { motion: "establish", distance: [820, 700], polar: 0.62, orbitRate: 0.05, jitter: 0, duration: 20 },
  pushIn: { motion: "pushIn", distance: [460, 130], polar: 1.02, orbitRate: 0.04, jitter: 0, duration: 13 },
  orbit: { motion: "orbit", distance: [210, 190], polar: 0.86, orbitRate: 0.22, jitter: 0, duration: 16 },
  track: { motion: "track", distance: [340, 240], polar: 1.06, orbitRate: 0.03, jitter: 0, duration: 12 },
  twoShot: { motion: "twoShot", distance: [95, 78], polar: 1.16, orbitRate: 0.08, jitter: 0, duration: 10 },
  handheld: { motion: "handheld", distance: [140, 110], polar: 1.2, orbitRate: 0.06, jitter: 1.1, duration: 11 },
};

/** Pick the shot motion for a chronicle category. */
export function shotForCategory(category: string): ShotSpec {
  switch (category) {
    case "crisis":
      return SHOTS.handheld;
    case "milestone":
    case "founding":
      return SHOTS.orbit;
    case "construction":
      return SHOTS.pushIn;
    case "earth":
      return SHOTS.track;
    case "population":
      return SHOTS.twoShot;
    case "resources":
    default:
      return SHOTS.establish;
  }
}

export const IDLE_SHOT = SHOTS.establish;
