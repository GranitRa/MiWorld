import type { BuildingKind } from "./types";

// Construction catalog: what each module costs (feedstock) and how long it takes to build
// (sols at nominal labour). Housing capacity feeds the planner's crowding signal.

export interface BuildSpec {
  feedstock: number;
  sols: number;
}

export const BUILD_SPEC: Record<BuildingKind, BuildSpec> = {
  landing_pad: { feedstock: 0, sols: 0 },
  tunnel: { feedstock: 10, sols: 0.6 },
  solar_field: { feedstock: 22, sols: 1.4 },
  habitat: { feedstock: 36, sols: 2.4 },
  greenhouse: { feedstock: 30, sols: 2.2 },
  water_extractor: { feedstock: 30, sols: 2.3 },
  isru_plant: { feedstock: 34, sols: 2.6 },
  workshop: { feedstock: 40, sols: 3.0 },
  dome: { feedstock: 60, sols: 4.0 },
  monument: { feedstock: 80, sols: 5.0 },
};

/** Colonists housed per completed building of this kind. */
export const HOUSING_PER: Partial<Record<BuildingKind, number>> = {
  habitat: 6,
  dome: 12,
};

/** Kinds the planner may choose to build (landing_pad/tunnel/monument are special). */
export const PLANNABLE: BuildingKind[] = [
  "habitat",
  "solar_field",
  "greenhouse",
  "isru_plant",
  "water_extractor",
  "workshop",
  "dome",
];
