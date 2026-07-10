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
}
