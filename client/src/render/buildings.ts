import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import type { Building, Planet } from "@miworld/shared";
import type { SpriteSource } from "../pixelart/source";

interface Entry {
  record: Building;
  group: Group;
  mats: MeshStandardMaterial[];
}

// Geometry helpers whose BASE sits at group-local y=0, so scaling y grows the module up out
// of the ground during construction.
const cyl = (rt: number, rb: number, h: number, seg = 12): BufferGeometry => {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  return g;
};
const box = (w: number, h: number, d: number): BufferGeometry => {
  const g = new BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
};
const halfDome = (r: number): BufferGeometry =>
  new SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); // base already at y=0

function makeBuilding(b: Building, source: SpriteSource): { group: Group; mats: MeshStandardMaterial[] } {
  const tex = source.building(b.kind, b.tier);
  const mats: MeshStandardMaterial[] = [];
  const mat = (metalness = 0.1): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ map: tex, roughness: 0.9, metalness });
    mats.push(m);
    return m;
  };
  const g = new Group();
  const add = (geo: BufferGeometry, m: MeshStandardMaterial): Mesh => {
    const mesh = new Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  switch (b.kind) {
    case "habitat": {
      add(cyl(5, 5, 6), mat());
      const cap = halfDome(5);
      cap.translate(0, 6, 0);
      add(cap, mat(0.05));
      break;
    }
    case "dome":
      add(halfDome(9), mat(0.05));
      break;
    case "greenhouse": {
      add(box(15, 3.5, 6), mat(0.05));
      const roof = box(15, 2, 6);
      roof.translate(0, 3.5, 0);
      add(roof, mat(0.05));
      break;
    }
    case "solar_field": {
      for (let i = 0; i < 3; i++) {
        const panel = add(box(7, 0.4, 5), mat(0.5));
        panel.position.set((i - 1) * 8, 2, 0);
        panel.rotation.x = -0.5;
      }
      break;
    }
    case "isru_plant": {
      add(box(7, 2, 7), mat());
      const tank = cyl(2.6, 2.6, 7);
      tank.translate(0, 2, 0);
      add(tank, mat(0.3));
      break;
    }
    case "water_extractor": {
      add(box(6, 5, 6), mat());
      const drill = cyl(1, 1, 7);
      drill.translate(0, 5, 0);
      add(drill, mat(0.4));
      break;
    }
    case "workshop":
      add(box(9, 5, 7), mat());
      break;
    case "landing_pad":
      add(cyl(8, 8, 1, 20), mat(0.3));
      break;
    case "tunnel":
      add(box(2.4, 2, 8), mat());
      break;
    case "monument":
      add(cyl(0.6, 2.2, 12, 6), mat(0.2));
      break;
    default:
      add(box(5, 5, 5), mat());
  }
  return { group: g, mats };
}

/**
 * Renders colony buildings from world state. `syncAll` seeds from the hello snapshot;
 * `applyDelta` upserts from the "b:"-prefixed tick deltas (new module or progress change).
 * A building scales up out of the ground as its progress climbs, glowing while under
 * construction — construction is the show.
 */
export class BuildingLayer {
  readonly group = new Group();
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly planet: Planet,
    private readonly source: SpriteSource,
  ) {}

  syncAll(buildings: Building[]): void {
    for (const b of buildings) this.upsert(b);
  }

  applyDelta(id: string, changes: Record<string, unknown>): void {
    const existing = this.entries.get(id);
    if (existing) {
      this.upsert({ ...existing.record, ...(changes as Partial<Building>) });
    } else if (changes.kind != null && changes.pos != null) {
      this.upsert({ id, progress: 0.001, rot: 0, tier: "printed", ...(changes as object) } as Building);
    }
  }

  private upsert(b: Building): void {
    let e = this.entries.get(b.id);
    if (!e || e.record.kind !== b.kind || e.record.tier !== b.tier) {
      if (e) this.dispose(e);
      const { group, mats } = makeBuilding(b, this.source);
      group.position.set(b.pos.x, this.planet.height(b.pos.x, b.pos.z), b.pos.z);
      group.rotation.y = b.rot;
      this.group.add(group);
      e = { record: { ...b }, group, mats };
      this.entries.set(b.id, e);
    }
    e.record = { ...b };
    e.group.scale.set(1, MathUtils.clamp(b.progress, 0.06, 1), 1);
    const building = b.progress < 1;
    for (const m of e.mats) {
      m.transparent = building;
      m.opacity = building ? 0.72 : 1;
      m.emissive.setHex(building ? 0x3a2a10 : 0x000000);
    }
  }

  private dispose(e: Entry): void {
    this.group.remove(e.group);
    e.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of e.mats) m.dispose();
    this.entries.delete(e.record.id);
  }
}
