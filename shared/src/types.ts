// Core world-state shapes. These are plain data (no classes); the server owns the
// authoritative instance and systems are pure-ish functions over it. Interfaces will
// grow work-package by work-package — this is the WP-1 seed, deliberately minimal.

import type { Good } from "./constants";

export type Vec2 = { x: number; z: number };

/** A stockpile ledger: current amount + cap per good. */
export type ResourceLedger = Record<Good, { amount: number; cap: number }>;

export type BuildingTier = "inflatable" | "printed" | "hardened" | "ruin";

export type BuildingKind =
  | "landing_pad"
  | "habitat"
  | "dome"
  | "greenhouse"
  | "solar_field"
  | "isru_plant"
  | "water_extractor"
  | "workshop"
  | "tunnel"
  | "monument";

export interface Building {
  id: string;
  kind: BuildingKind;
  tier: BuildingTier;
  pos: Vec2;
  rot: number;
  /** 0..1 construction progress; 1 = complete. */
  progress: number;
}

export type Sex = "f" | "m";

export interface Colonist {
  id: string;
  name: string;
  role: string;
  sex: Sex;
  ageDays: number;
  traits: string[];
  /** ids of related colonists → relationship valence (-1..1). */
  bonds: Record<string, number>;
  alive: boolean;
  /** Current leg of movement: start pos, destination, and sim-times; client interpolates. */
  pos: Vec2;
  dest: Vec2 | null;
  departSec: number;
  arriveSec: number;
  /** Partner colonist id (pairing), or null. */
  partner: string | null;
}

export type ChronicleCategory =
  | "founding"
  | "construction"
  | "population"
  | "resources"
  | "earth"
  | "crisis"
  | "milestone";

export interface ChronicleEvent {
  id: number;
  epoch: number;
  worldTimeSec: number;
  category: ChronicleCategory;
  priority: number;
  title: string;
  body: string;
  subjectRefs: string[];
  cameraHint: Vec2 | null;
}

export type WorldStatus = "alive" | "fallen";

export type CrisisKind = "dust_storm" | "equipment_failure" | "solar_storm";

/** A crisis runs a warning → onset → peak → recovery state machine, emitting a beat at each
 * stage so the causal chain (forecast → panels dim → rationing → resolution) is watchable. */
export type CrisisStage = "warning" | "onset" | "peak" | "recovery";

export interface Crisis {
  id: string;
  kind: CrisisKind;
  stage: CrisisStage;
  /** Sim-time the current stage began and is scheduled to end (drives progress + transitions). */
  stageStartSec: number;
  stageEndsSec: number;
  /** 0..1 intensity: peak dust for a storm, casualty risk for a solar storm. */
  severity: number;
  /** Atmospheric dust at spawn — a dust storm eases its warning haze up from here, not from a
   * fixed calm value, so it never snaps the sky downward on an already-hazy sol. */
  startDust: number;
  /** Building knocked offline (equipment_failure), else null. */
  targetId: string | null;
}

export type FlightKind = "supply" | "rescue" | "colonists";

/** A ship in transit from Earth; delivers feedstock + immigrants on arrival. */
export interface Flight {
  id: string;
  kind: FlightKind;
  arriveSec: number;
  feedstock: number;
  colonists: number;
}

/** The complete authoritative world state, snapshotted to Postgres as JSONB. */
export interface World {
  seed: number;
  epoch: number;
  worldTimeSec: number;
  status: WorldStatus;
  settlementName: string | null;
  /** Colony landing site (from deterministic worldgen), origin of the settlement. */
  landingSite: { x: number; z: number };
  /** Atmospheric dust opacity 0..1; dims solar output (storms push it high in WP-10). */
  dust: number;
  treasury: ResourceLedger;
  /** Current unmet demand per good (0/absent = supplied). Drives later mortality/rescue. */
  shortages: Partial<Record<Good, number>>;
  buildings: Building[];
  colonists: Colonist[];
  /** Pooled (unnamed) population per district id. */
  pools: Record<string, number>;
  /** Ships inbound from Earth (resupply / rescue / immigration). */
  flights: Flight[];
  /** Sim-time of the last regular flight launch (cadence gate). */
  lastFlightSec: number;
  /** Sim-time the colony collapsed to zero, or null; drives the reseed timer. */
  fallenSec: number | null;
  /** Active threats (dust storms, failures, …) running their state machines (WP-10). */
  crises: Crisis[];
  /** Sim-time the last crisis ended; the drama thermostat enforces a calm window after it. */
  lastCrisisEndSec: number;
  /** Ids of milestones already fired this epoch (reset on reseed) — each fires once (WP-11). */
  milestones: string[];
  /** Sim-time the current epoch began; time-based milestones measure from here. */
  epochStartSec: number;
}
