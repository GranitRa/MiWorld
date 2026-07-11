import type { Group } from "three";

// Level-of-detail bands keyed on the camera's focus distance. The colony is always drawn, but
// colonists (the many small, animated meshes) only render inside a "bubble" near the camera —
// from orbit they'd be sub-pixel and just burn GPU. A hysteresis gap on the on/off threshold
// keeps the boundary from flickering when the camera hovers right at the edge.

export type LodBand = "orbital" | "district" | "street" | "face";

export function bandFor(distance: number): LodBand {
  if (distance > 2600) return "orbital"; // whole colony; no agents
  if (distance > 700) return "district"; // buildings legible; agents fade in
  if (distance > 140) return "street"; // agents walking
  return "face"; // nearest colonist detail
}

export class LodController {
  private colonistsOn = true;

  /** Update per frame; returns whether colonists are in the bubble (so the caller can also
   * skip their per-frame interpolation work when they're not being drawn). */
  update(distance: number, colonistsGroup: Group | null): boolean {
    if (this.colonistsOn && distance > 2600) this.colonistsOn = false;
    else if (!this.colonistsOn && distance < 2300) this.colonistsOn = true;
    if (colonistsGroup) colonistsGroup.visible = this.colonistsOn;
    return this.colonistsOn;
  }
}
