import { type PerspectiveCamera, Raycaster, Vector2 } from "three";
import type { BuildingKind } from "@miworld/shared";
import type { BuildingLayer } from "../render/buildings";
import type { ColonistLayer } from "../render/colonists";

const EARTH_YEAR_SOL = 668;
const KIND_LABEL: Record<BuildingKind, string> = {
  habitat: "Habitat",
  solar_field: "Solar array",
  greenhouse: "Greenhouse",
  isru_plant: "Oxygen plant",
  water_extractor: "Water extractor",
  workshop: "Workshop",
  dome: "Dome",
  tunnel: "Tunnel",
  landing_pad: "Landing pad",
  monument: "Monument",
};

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** Click a colonist or building → a detail card. Distinguishes clicks from camera drags. */
export class Inspector {
  private readonly card: HTMLElement;
  private readonly ray = new Raycaster();
  private downX = 0;
  private downY = 0;

  constructor(
    root: HTMLElement,
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly buildings: BuildingLayer,
    private readonly colonists: ColonistLayer,
  ) {
    this.card = document.createElement("div");
    this.card.id = "inspector";
    this.card.style.display = "none";
    root.appendChild(this.card);
    injectStyles();
    this.card.addEventListener("pointerdown", (e) => e.stopPropagation());
    dom.addEventListener("pointerdown", (e) => {
      this.downX = e.clientX;
      this.downY = e.clientY;
    });
    dom.addEventListener("pointerup", (e) => {
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < 5) this.pick(e);
    });
  }

  private pick(e: PointerEvent): void {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects([this.colonists.group, this.buildings.group], true);
    for (const h of hits) {
      let o: import("three").Object3D | null = h.object;
      while (o && !o.userData?.miId) o = o.parent;
      if (o && o.userData.miId) {
        this.show(o.userData.miType as string, o.userData.miId as string);
        return;
      }
    }
    this.hide();
  }

  private show(type: string, id: string): void {
    if (type === "colonist") {
      const c = this.colonists.getRecord(id);
      if (!c) return this.hide();
      const years = Math.floor(c.ageDays / EARTH_YEAR_SOL);
      const partner = c.partner ? this.colonists.getRecord(c.partner)?.name : null;
      const traits = c.traits.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ");
      this.card.innerHTML = `
        <div class="ih">${esc(c.name)}</div>
        <div class="is">${esc(cap(c.role))} · ${c.sex === "f" ? "♀" : "♂"} · ${years} yr${c.role === "child" ? " · Mars-born" : ""}</div>
        <div class="irow">${traits || "<span class='dim'>no notable traits</span>"}</div>
        ${partner ? `<div class="irow dim">paired with ${esc(partner)}</div>` : ""}`;
    } else {
      const b = this.buildings.getRecord(id);
      if (!b) return this.hide();
      const pct = Math.round(b.progress * 100);
      this.card.innerHTML = `
        <div class="ih">${esc(KIND_LABEL[b.kind] ?? b.kind)}</div>
        <div class="is">${esc(cap(b.tier))}${b.progress < 1 ? "" : " · operational"}</div>
        ${b.progress < 1 ? `<div class="irow dim">under construction — ${pct}%</div>` : ""}`;
    }
    this.card.style.display = "block";
  }

  private hide(): void {
    this.card.style.display = "none";
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function injectStyles(): void {
  const s = document.createElement("style");
  s.textContent = `
    #inspector { position:absolute; bottom:52px; left:16px; width:240px; padding:12px 14px;
      background:rgba(20,16,12,.62); backdrop-filter:blur(3px); border:1px solid rgba(233,220,195,.16);
      border-radius:8px; color:#e9dcc3; font-family: ui-sans-serif, system-ui, sans-serif; }
    #inspector .ih { font-size:16px; font-weight:600; }
    #inspector .is { font-size:12px; opacity:.75; margin-top:2px; }
    #inspector .irow { margin-top:8px; font-size:12px; }
    #inspector .dim { opacity:.6; }
    #inspector .chip { display:inline-block; padding:1px 7px; margin:1px 2px 1px 0; font-size:11px;
      background:rgba(201,162,39,.22); border:1px solid rgba(201,162,39,.35); border-radius:10px; }
  `;
  document.head.appendChild(s);
}
