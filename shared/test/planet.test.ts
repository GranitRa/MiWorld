import { describe, it, expect } from "vitest";
import { generatePlanet } from "../src/worldgen/planet";
import { TERRAIN_SIZE_METERS } from "../src/constants";

function heightfieldHash(seed: number, n = 48): number {
  const planet = generatePlanet(seed);
  const half = TERRAIN_SIZE_METERS / 2;
  let h = 2166136261;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -half + (ix / (n - 1)) * TERRAIN_SIZE_METERS;
      const z = -half + (iz / (n - 1)) * TERRAIN_SIZE_METERS;
      // Fold the rounded height into an FNV-style hash.
      const v = Math.round(planet.height(x, z) * 100) | 0;
      h = Math.imul(h ^ (v & 0xffff), 16777619);
      h = Math.imul(h ^ ((v >>> 16) & 0xffff), 16777619);
    }
  }
  return h >>> 0;
}

describe("worldgen determinism", () => {
  it("same seed → identical heightfield", () => {
    expect(heightfieldHash(12345)).toBe(heightfieldHash(12345));
  });

  it("different seeds → different heightfield", () => {
    expect(heightfieldHash(1)).not.toBe(heightfieldHash(2));
  });

  it("landing site is flat and inside the map", () => {
    const p = generatePlanet(777);
    const half = TERRAIN_SIZE_METERS / 2;
    expect(Math.abs(p.landingSite.x)).toBeLessThan(half * 0.8 + 1);
    expect(Math.abs(p.landingSite.z)).toBeLessThan(half * 0.8 + 1);
    // "Flat" = gentle slope (rise/run well under 1).
    expect(p.slopeAt(p.landingSite.x, p.landingSite.z)).toBeLessThan(0.25);
  });

  it("produces craters, a canyon and deposits", () => {
    const p = generatePlanet(42);
    expect(p.craters.length).toBeGreaterThanOrEqual(8);
    expect(p.deposits.some((d) => d.kind === "ice")).toBe(true);
    expect(p.canyon.depth).toBeGreaterThan(0);
  });
});
