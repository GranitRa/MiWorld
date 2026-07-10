import { generatePlanet, type Planet } from "@miworld/shared";

// Memoized server-side planet. Deterministic from the seed, so it matches the client's
// terrain exactly; the construction planner queries it for slope/deposits when siting.
let cached: Planet | null = null;

export function getPlanet(seed: number): Planet {
  if (!cached || cached.seed !== seed) cached = generatePlanet(seed);
  return cached;
}
