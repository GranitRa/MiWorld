import {
  Box3,
  Color,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Building, BuildingKind, Planet } from "@miworld/shared";

// CC0 Quaternius "Ultimate Space Kit" models mapped to colony building kinds. landing_pad
// has no good model, so it falls back to a procedural disc.
const MODEL_FILE: Partial<Record<BuildingKind, string>> = {
  habitat: "habitat_cyl",
  dome: "dome",
  greenhouse: "house_long",
  solar_field: "solar",
  isru_plant: "base_large",
  water_extractor: "building_l",
  workshop: "base_large",
  tunnel: "connector",
  monument: "radar",
};

// Gentle per-function colour tint (multiplied onto the model's near-white materials) so the
// base reads with colony life instead of sterile grey.
const TINT: Partial<Record<BuildingKind, number>> = {
  habitat: 0xfff0e2,
  dome: 0xfff3e8,
  greenhouse: 0xcfeecb,
  solar_field: 0xd8e2ff,
  isru_plant: 0xffe6cf,
  water_extractor: 0xe4f0ff,
  workshop: 0xffe8d2,
  tunnel: 0xefe6da,
  monument: 0xffe0c0,
};

// Metres tall for the reference model (habitat); one uniform scale derived from it is
// applied to every model, so the kit's relative proportions are preserved.
const REF_HEIGHT_M = 7.5;

interface Entry {
  record: Building;
  obj: Object3D;
}

/**
 * Renders colony buildings using loaded CC0 3D models. `syncAll` seeds from the hello
 * snapshot; `applyDelta` upserts from "b:"-prefixed tick deltas. Records are tracked
 * immediately; meshes render once the models finish loading. A building scales up out of
 * the ground as its progress climbs (construction is the show).
 */
export class BuildingLayer {
  readonly group = new Group();
  private readonly protos = new Map<BuildingKind, Object3D>();
  private readonly records = new Map<string, Building>();
  private readonly entries = new Map<string, Entry>();
  private ready = false;

  constructor(private readonly planet: Planet) {
    void this.load();
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const kinds = Object.keys(MODEL_FILE) as BuildingKind[];
    const scenes = await Promise.all(
      kinds.map((k) => loader.loadAsync(`/models/spacekit/${MODEL_FILE[k]}.glb`).then((g) => g.scene)),
    );
    // One global scale, derived from the reference model's natural height.
    const ref = scenes[kinds.indexOf("habitat")]!;
    const refH = new Box3().setFromObject(ref).getSize(new Vector3()).y || 1;
    const scale = REF_HEIGHT_M / refH;

    const normalize = (scene: Object3D, tintHex?: number) => {
      scene.scale.setScalar(scale);
      scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(scene);
      scene.position.y -= box.min.y; // base sits at y=0 so it grows from the ground
      const tint = tintHex !== undefined ? new Color(tintHex) : null;
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (tint) {
          const apply = (m: MeshStandardMaterial) => {
            const c = m.clone();
            c.color.multiply(tint);
            return c;
          };
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((m) => apply(m as MeshStandardMaterial))
            : apply(mesh.material as MeshStandardMaterial);
        }
      });
    };

    kinds.forEach((k, i) => {
      normalize(scenes[i]!, TINT[k]);
      this.protos.set(k, scenes[i]!);
    });

    this.ready = true;
    for (const b of this.records.values()) this.render(b);
  }

  syncAll(buildings: Building[]): void {
    for (const b of buildings) this.set(b);
  }

  applyDelta(id: string, changes: Record<string, unknown>): void {
    const cur = this.records.get(id);
    if (cur) {
      this.set({ ...cur, ...(changes as Partial<Building>) });
    } else if (changes.kind != null && changes.pos != null) {
      this.set({ id, tier: "printed", rot: 0, progress: 0.001, ...(changes as object) } as Building);
    }
  }

  private set(b: Building): void {
    this.records.set(b.id, b);
    if (this.ready) this.render(b);
  }

  private render(b: Building): void {
    let e = this.entries.get(b.id);
    if (!e || e.record.kind !== b.kind) {
      if (e) this.group.remove(e.obj);
      const obj = this.makeObject(b);
      obj.position.set(b.pos.x, this.planet.height(b.pos.x, b.pos.z), b.pos.z);
      obj.rotation.y = b.rot;
      this.group.add(obj);
      e = { record: { ...b }, obj };
      this.entries.set(b.id, e);
    }
    e.record = { ...b };
    e.obj.scale.set(1, MathUtils.clamp(b.progress, 0.05, 1), 1);
  }

  private makeObject(b: Building): Object3D {
    const wrap = new Group();
    const proto = this.protos.get(b.kind);
    if (proto) {
      wrap.add(proto.clone(true));
    } else {
      // landing_pad / fallback: a flat procedural disc.
      const pad = new Mesh(
        new CylinderGeometry(8, 8, 1, 20),
        new MeshStandardMaterial({ color: "#41434a", roughness: 0.85, metalness: 0.3 }),
      );
      pad.geometry.translate(0, 0.5, 0);
      pad.receiveShadow = true;
      wrap.add(pad);
    }
    return wrap;
  }
}
