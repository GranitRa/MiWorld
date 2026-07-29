import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from "three";
import type { BuildingKind, Vec2 } from "@miworld/shared";
import type { BuildingLayer } from "../render/buildings";
import type { ColonistLayer } from "../render/colonists";

// Read-only diagnostic overlays the viewer can toggle: the resource NETWORK (lines from each
// producer to the hub, coloured by what it makes), the CONSTRUCTION queue (beacons over
// in-progress builds), and the PEOPLE density (glowing dots over every colonist). Nothing here
// feeds the sim — it's a lens onto it. The whole layer hides in Watch mode.

// What each producing building feeds into the colony, and the wire colour for it.
const OUTPUT: Partial<Record<BuildingKind, string>> = {
  solar_field: "power",
  isru_plant: "oxygen",
  water_extractor: "water",
  greenhouse: "food",
  workshop: "feedstock",
};
const WIRE: Record<string, number> = {
  power: 0xffd24a,
  oxygen: 0x6ad0ff,
  water: 0x5ad0c0,
  food: 0x8fd8a0,
  feedstock: 0xffab6a,
};

type OverlayName = "networks" | "construction" | "people";

export class Overlays {
  private readonly netGroup = new Group();
  private readonly buildGroup = new Group();
  private readonly peopleGroup = new Group();
  private readonly active: Record<OverlayName, boolean> = {
    networks: false,
    construction: false,
    people: false,
  };
  private readonly buttons = new Map<OverlayName, HTMLButtonElement>();
  private refreshAccum = 0;
  private hidden = false;

  constructor(
    scene: Scene,
    uiRoot: HTMLElement,
    private readonly buildings: BuildingLayer,
    private readonly colonists: ColonistLayer,
    private readonly hub: () => Vec2,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.netGroup.visible = false;
    this.buildGroup.visible = false;
    this.peopleGroup.visible = false;
    scene.add(this.netGroup, this.buildGroup, this.peopleGroup);

    const bar = document.createElement("div");
    bar.id = "overlays";
    const labels: [OverlayName, string][] = [
      ["networks", "⚡ Grid"],
      ["construction", "🏗 Building"],
      ["people", "👥 People"],
    ];
    for (const [name, label] of labels) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.addEventListener("click", () => this.toggle(name));
      bar.appendChild(btn);
      this.buttons.set(name, btn);
    }
    uiRoot.appendChild(bar);
    injectStyles();
  }

  /** The people overlay needs live colonist positions even outside the LOD bubble (Fable F3). */
  get peopleActive(): boolean {
    return this.active.people && !this.hidden;
  }

  /** Watch mode hides the whole diagnostic layer (groups + bar), not just the button bar. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const name of ["networks", "construction", "people"] as OverlayName[]) {
      this.group(name).visible = this.active[name] && !hidden;
    }
  }

  private toggle(name: OverlayName): void {
    this.active[name] = !this.active[name];
    this.buttons.get(name)!.classList.toggle("on", this.active[name]);
    this.group(name).visible = this.active[name] && !this.hidden;
    if (this.active[name]) this.rebuild(name);
  }

  private group(name: OverlayName): Group {
    return name === "networks" ? this.netGroup : name === "construction" ? this.buildGroup : this.peopleGroup;
  }

  /** Refresh active overlays a few times a second (data changes slowly). */
  update(dtSec: number): void {
    if (this.hidden) return;
    this.refreshAccum += dtSec;
    if (this.refreshAccum < 0.25) return;
    this.refreshAccum = 0;
    for (const name of ["networks", "construction", "people"] as OverlayName[]) {
      if (this.active[name]) this.rebuild(name);
    }
  }

  private rebuild(name: OverlayName): void {
    if (name === "networks") this.buildNetworks();
    else if (name === "construction") this.buildConstruction();
    else this.buildPeople();
  }

  private clear(g: Group): void {
    for (const c of g.children) {
      const o = c as Mesh;
      o.geometry?.dispose();
      const m = o.material as { dispose?: () => void } | undefined;
      m?.dispose?.();
    }
    g.clear();
  }

  private buildNetworks(): void {
    this.clear(this.netGroup);
    const hub = this.hub();
    const hy = this.heightAt(hub.x, hub.z) + 4;
    const verts: number[] = [];
    const cols: number[] = [];
    for (const b of this.buildings.list()) {
      if (b.tier === "ruin" || b.progress < 1) continue;
      const out = OUTPUT[b.kind];
      if (!out) continue;
      const c = new Color(WIRE[out]);
      const y = this.heightAt(b.pos.x, b.pos.z) + 4;
      verts.push(b.pos.x, y, b.pos.z, hub.x, hy, hub.z);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (verts.length === 0) return;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new Float32BufferAttribute(cols, 3));
    const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.netGroup.add(new LineSegments(geo, mat));
  }

  private buildConstruction(): void {
    this.clear(this.buildGroup);
    for (const b of this.buildings.list()) {
      if (b.tier === "ruin" || b.progress >= 1) continue;
      const h = this.heightAt(b.pos.x, b.pos.z);
      // A tapering beacon that shrinks as the build nears completion.
      const remaining = 1 - b.progress;
      const beam = new Mesh(
        new CylinderGeometry(0.6, 2.6, 14 * remaining + 3, 8, 1, true),
        new MeshBasicMaterial({
          color: 0xffe08a,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      beam.position.set(b.pos.x, h + (14 * remaining + 3) / 2 + 2, b.pos.z);
      this.buildGroup.add(beam);
    }
  }

  private buildPeople(): void {
    this.clear(this.peopleGroup);
    const pts = this.colonists.positions();
    if (pts.length === 0) return;
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y + 4;
      arr[i * 3 + 2] = p.z;
    });
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(arr, 3));
    const mat = new PointsMaterial({
      color: 0x9fe0ff,
      size: 7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.peopleGroup.add(new Points(geo, mat));
  }
}

function injectStyles(): void {
  const s = document.createElement("style");
  s.textContent = `
    #overlays { position:fixed; bottom:14px; left:50%; transform:translateX(-50%); z-index:30;
      display:flex; gap:6px; }
    #overlays button { cursor:pointer; background:rgba(20,16,12,.6); color:#e9dcc3;
      border:1px solid rgba(233,220,195,.2); border-radius:999px; padding:6px 12px;
      font:600 12px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.03em;
      backdrop-filter:blur(3px); transition:background .15s,border-color .15s; }
    #overlays button:hover { background:rgba(40,32,24,.8); }
    #overlays button.on { background:rgba(90,120,150,.55); border-color:rgba(159,224,255,.7); color:#fff; }
    body.watch-on #overlays { opacity:0; pointer-events:none; transition:opacity .4s ease; }
  `;
  document.head.appendChild(s);
}
