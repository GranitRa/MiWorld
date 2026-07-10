// Deterministic Mars worldgen. Produces the PLANET only (terrain, resource deposits,
// landing site) — the colony builds itself during the sim. `height(x,z)` is analytic and
// resolution-independent, so the client mesh and any server-side sampling agree exactly.
// Uses ONLY +-*/ , sqrt (Math.hypot) and integer-hash noise — no sin/cos/exp/pow — so it
// is byte-stable across JS engines (a Chrome and a Firefox viewer see the same hills).

import { TERRAIN_SIZE_METERS } from "../constants";
import { fbm, warpedFbm } from "./fbm";

export interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export interface Canyon {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  halfWidth: number;
  depth: number;
}

export type DepositKind = "ice" | "metal" | "regolith";

export interface Deposit {
  kind: DepositKind;
  x: number;
  z: number;
  radius: number;
}

export interface Planet {
  seed: number;
  size: number;
  landingSite: { x: number; z: number };
  craters: Crater[];
  canyon: Canyon;
  deposits: Deposit[];
  height: (x: number, z: number) => number;
  slopeAt: (x: number, z: number) => number;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A unit vector from two random draws (no trig → engine-stable). */
function unitVec(rnd: () => number): { x: number; z: number } {
  let x = rnd() * 2 - 1;
  let z = rnd() * 2 - 1;
  const len = Math.hypot(x, z) || 1;
  x /= len;
  z /= len;
  return { x, z };
}

function distToSegment(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - x1) * dx + (pz - z1) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

export function generatePlanet(seed: number): Planet {
  const size = TERRAIN_SIZE_METERS;
  const half = size / 2;
  const rnd = mulberry32(seed ^ 0x9e37);

  // Mountain spine: a ridge line defined by a unit normal + offset.
  const spineNormal = unitVec(rnd);
  const spineOffset = (rnd() - 0.5) * size * 0.4;
  const spineAmp = 380 + rnd() * 260;
  const spineWidth = 650 + rnd() * 500;

  // Craters.
  const craters: Crater[] = [];
  const craterCount = 8 + Math.floor(rnd() * 7);
  for (let i = 0; i < craterCount; i++) {
    craters.push({
      x: (rnd() - 0.5) * size * 0.92,
      z: (rnd() - 0.5) * size * 0.92,
      r: 110 + rnd() * 420,
      depth: 35 + rnd() * 95,
    });
  }

  // One canyon carved across the map along a random direction.
  const cDir = unitVec(rnd);
  const canyon: Canyon = {
    x1: -cDir.x * half * 1.1,
    z1: -cDir.z * half * 1.1,
    x2: cDir.x * half * 1.1,
    z2: cDir.z * half * 1.1,
    halfWidth: 55 + rnd() * 110,
    depth: 80 + rnd() * 90,
  };

  // Resource deposits (used by later sim WPs; landing prefers to sit near ice).
  const deposits: Deposit[] = [];
  const addDeposits = (kind: DepositKind, n: number, rMin: number, rMax: number) => {
    for (let i = 0; i < n; i++) {
      deposits.push({
        kind,
        x: (rnd() - 0.5) * size * 0.85,
        z: (rnd() - 0.5) * size * 0.85,
        radius: rMin + rnd() * (rMax - rMin),
      });
    }
  };
  addDeposits("ice", 3, 180, 360);
  addDeposits("metal", 4, 120, 280);
  addDeposits("regolith", 5, 200, 450);

  const spineContribution = (x: number, z: number): number => {
    const dist = Math.abs(x * spineNormal.x + z * spineNormal.z - spineOffset);
    const r = dist / spineWidth;
    const f = clamp01(1 - r * r);
    const falloff = f * f; // smoother shoulders
    if (falloff <= 0) return 0;
    const rough = fbm(x / 240, z / 240, seed ^ 0x51a3, { octaves: 4 }) - 0.5;
    return falloff * spineAmp * (1 + rough * 0.5);
  };

  const craterContribution = (x: number, z: number): number => {
    let delta = 0;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= c.r) continue;
      const t = d / c.r; // 0 center → 1 rim
      const bowl = -(1 - t * t) * c.depth;
      const rimPulse = clamp01(1 - Math.abs(t - 0.9) / 0.12);
      delta += bowl + rimPulse * rimPulse * c.depth * 0.28;
    }
    return delta;
  };

  const canyonContribution = (x: number, z: number): number => {
    const d = distToSegment(x, z, canyon.x1, canyon.z1, canyon.x2, canyon.z2);
    if (d >= canyon.halfWidth) return 0;
    const t = d / canyon.halfWidth;
    return -(1 - t * t) * canyon.depth;
  };

  const height = (x: number, z: number): number => {
    const base = (warpedFbm(x / 1700, z / 1700, seed, { octaves: 5 }) - 0.45) * 300;
    return base + spineContribution(x, z) + craterContribution(x, z) + canyonContribution(x, z);
  };

  const slopeAt = (x: number, z: number): number => {
    const e = 8;
    const hx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    return Math.hypot(hx, hz);
  };

  // Landing site: flattest of many candidates near an ice deposit, away from the edges.
  const ice = deposits.filter((d) => d.kind === "ice");
  let landingSite = { x: 0, z: 0 };
  let bestScore = Infinity;
  for (let i = 0; i < 400; i++) {
    const anchor = ice.length ? ice[Math.floor(rnd() * ice.length)]! : { x: 0, z: 0 };
    const x = anchor.x + (rnd() - 0.5) * 900;
    const z = anchor.z + (rnd() - 0.5) * 900;
    if (Math.abs(x) > half * 0.8 || Math.abs(z) > half * 0.8) continue;
    const score = slopeAt(x, z);
    if (score < bestScore) {
      bestScore = score;
      landingSite = { x, z };
    }
  }

  return { seed, size, landingSite, craters, canyon, deposits, height, slopeAt };
}
