// The colony economy catalog: what each building kind produces/consumes and what each
// colonist needs. Rates are per sol; the sim scales them by tick dt. Legibility over
// realism — a handful of coupled goods so a viewer can read cause from effect.

import type { Good } from "./constants";
import type { BuildingKind, BuildingTier } from "./types";

export interface GoodRate {
  good: Good;
  perSol: number;
}

export interface BuildingEconomy {
  produces: GoodRate[];
  consumes: GoodRate[];
}

/** Output/upkeep multiplier by build tier. */
export const TIER_MULT: Record<BuildingTier, number> = {
  inflatable: 0.7,
  printed: 1.0,
  hardened: 1.3,
  ruin: 0,
};

// Power is the keystone: solar makes it (scaled by sun + dust elsewhere); most producers
// need it, so a power shortfall cascades into oxygen/water/food shortfalls — the core
// legible chain (dust storm → less solar → brownout → life-support strain).
export const BUILDING_ECONOMY: Record<BuildingKind, BuildingEconomy> = {
  landing_pad: { produces: [], consumes: [] },
  tunnel: { produces: [], consumes: [] },
  monument: { produces: [], consumes: [] },
  dome: { produces: [], consumes: [{ good: "power", perSol: 3 }] },
  habitat: { produces: [], consumes: [{ good: "power", perSol: 5 }] },
  solar_field: { produces: [{ good: "power", perSol: 50 }], consumes: [] },
  isru_plant: {
    produces: [{ good: "oxygen", perSol: 22 }],
    consumes: [{ good: "power", perSol: 12 }],
  },
  water_extractor: {
    produces: [{ good: "water", perSol: 20 }],
    consumes: [{ good: "power", perSol: 8 }],
  },
  greenhouse: {
    produces: [{ good: "food", perSol: 18 }],
    consumes: [
      { good: "power", perSol: 6 },
      { good: "water", perSol: 4 },
    ],
  },
  workshop: {
    produces: [
      { good: "spares", perSol: 4 },
      { good: "science", perSol: 3 },
    ],
    consumes: [{ good: "power", perSol: 5 }],
  },
};

/** Per-colonist life support draw, per sol. */
export const COLONIST_CONSUMPTION: GoodRate[] = [
  { good: "oxygen", perSol: 0.8 },
  { good: "water", perSol: 1.0 },
  { good: "food", perSol: 0.9 },
];

/** Stockpile caps (also the colony's "battery"/reservoir sizes). */
export const GOOD_CAP: Record<Good, number> = {
  power: 220,
  oxygen: 320,
  water: 320,
  food: 320,
  feedstock: 240,
  spares: 120,
  science: 160,
};

/** Life-critical goods whose depletion drives mortality/rescue in later WPs. */
export const LIFE_CRITICAL: Good[] = ["power", "oxygen", "water", "food"];
