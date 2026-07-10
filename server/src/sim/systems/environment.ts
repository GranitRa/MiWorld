import type { System } from "../engine";

// Environment system (runs first each tick): drifts atmospheric dust as a slow random walk.
// Dust dims solar output, so it feeds the resource cascade. Storms (WP-10) will push dust
// far higher in bursts; here it just wanders in a calm band.
export const environmentSystem: System = (world, _dt, ctx) => {
  const drift = (ctx.rng.next("dust") - 0.5) * 0.012;
  world.dust = Math.max(0.02, Math.min(0.6, world.dust + drift));
};
