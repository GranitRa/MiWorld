import { Box3, Group, MathUtils, Mesh, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Colonist, Planet } from "@miworld/shared";

// CC0 Quaternius astronaut models (spacesuits). Colonists render as walking 3D astronauts,
// their positions interpolated from the server's movement legs (pos → dest over
// depart/arrive sim-times), matching the 3D-building look (Octopath-style 3D world).
const FILES = ["astronaut", "astronaut2", "astronaut3"];
const HEIGHT_M = 2.8; // slightly exaggerated so colonists read at diorama zoom (bubble LOD later)

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Entry {
  record: Colonist;
  obj: Object3D;
}

export class ColonistLayer {
  readonly group = new Group();
  private readonly protos: Object3D[] = [];
  private readonly records = new Map<string, Colonist>();
  private readonly entries = new Map<string, Entry>();
  private ready = false;

  constructor(private readonly planet: Planet) {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      await this.loadInner();
    } catch (err) {
      console.error("ColonistLayer.load failed:", err);
    }
  }

  private async loadInner(): Promise<void> {
    const loader = new GLTFLoader();
    const scenes = await Promise.all(
      FILES.map((f) => loader.loadAsync(`/models/spacekit/${f}.glb`).then((g) => g.scene)),
    );
    const h0 = new Box3().setFromObject(scenes[0]!).getSize(new Vector3()).y || 1;
    const scale = HEIGHT_M / h0;
    for (const s of scenes) {
      s.scale.setScalar(scale);
      s.updateMatrixWorld(true);
      const box = new Box3().setFromObject(s);
      s.position.y -= box.min.y;
      s.traverse((o) => {
        if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
      });
      this.protos.push(s);
    }
    this.ready = true;
    for (const c of this.records.values()) this.spawn(c);
  }

  syncAll(colonists: Colonist[]): void {
    for (const c of colonists) this.set(c);
  }

  applyDelta(id: string, changes: Record<string, unknown>): void {
    const cur = this.records.get(id);
    if (cur) {
      this.set({ ...cur, ...(changes as Partial<Colonist>) });
    } else if (changes.pos != null && changes.name != null) {
      this.set(changes as unknown as Colonist);
    }
  }

  private set(c: Colonist): void {
    this.records.set(c.id, c);
    if (this.ready) this.spawn(c);
  }

  private spawn(c: Colonist): void {
    let e = this.entries.get(c.id);
    if (!c.alive) {
      if (e) {
        this.group.remove(e.obj);
        this.entries.delete(c.id);
      }
      return;
    }
    if (!e) {
      const obj = this.protos[hash(c.id) % this.protos.length]!.clone(true);
      obj.userData = { miType: "colonist", miId: c.id };
      this.group.add(obj);
      e = { record: c, obj };
      this.entries.set(c.id, e);
    }
    e.record = c;
  }

  getRecord(id: string): Colonist | undefined {
    return this.entries.get(id)?.record;
  }

  /** Current world-space positions of every rendered colonist (for the population overlay). */
  positions(): Vector3[] {
    return [...this.entries.values()].map((e) => e.obj.position.clone());
  }

  /** Interpolate every colonist to its position at world time `now` and animate a walk bob. */
  update(now: number): void {
    for (const e of this.entries.values()) {
      const c = e.record;
      let x = c.pos.x;
      let z = c.pos.z;
      let walking = false;
      if (c.dest) {
        const dur = c.arriveSec - c.departSec;
        const t = dur > 0 ? MathUtils.clamp((now - c.departSec) / dur, 0, 1) : 1;
        x = lerp(c.pos.x, c.dest.x, t);
        z = lerp(c.pos.z, c.dest.z, t);
        if (t < 1) {
          walking = true;
          const dx = c.dest.x - c.pos.x;
          const dz = c.dest.z - c.pos.z;
          if (dx || dz) e.obj.rotation.y = Math.atan2(dx, dz);
        }
      }
      const bob = walking ? Math.abs(Math.sin(now * 3 + (hash(c.id) % 100))) * 0.12 : 0;
      e.obj.position.set(x, this.planet.height(x, z) + bob, z);
    }
  }
}
