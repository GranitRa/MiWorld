import type { Texture } from "three";
import type { BuildingKind, BuildingTier } from "@miworld/shared";
import { PixelCanvas } from "./factory";
import { prngFor } from "./prng";
import { RAMPS } from "./palette";

// Abstraction over pixel-art assets so authored sprite sheets can later be swapped in behind
// the same interface (SheetSpriteSource) without touching renderers. For now everything is
// generated procedurally and memoized (one texture per key, ever).
export interface SpriteSource {
  /** A tiling regolith grain tile (multiply map) for the terrain micro-detail. */
  terrainTile(index: number): Texture;
  /** Pixel-art albedo for a building kind at a build tier. */
  building(kind: BuildingKind, tier: BuildingTier): Texture;
}

export class ProceduralSpriteSource implements SpriteSource {
  private readonly cache = new Map<string, Texture>();

  constructor(private readonly seed: number) {}

  private memo(key: string, make: () => Texture): Texture {
    let t = this.cache.get(key);
    if (!t) {
      t = make();
      this.cache.set(key, t);
    }
    return t;
  }

  terrainTile(index: number): Texture {
    const key = `terrain:${index}`;
    return this.memo(key, () => {
      const rnd = prngFor(this.seed, key);
      const c = new PixelCanvas(128, 128);
      // Warm-grey brightness dither used as a MULTIPLY map — mean near 1.0 so it modulates
      // the terrain's vertex colour into crisp regolith grain without shifting hue.
      const shades = ["#efe9df", "#e2dbcf", "#d3cabc", "#c3b9aa", "#b0a698"];
      const pebble = ["#8f8577", "#7c7365"];
      c.fill(() => {
        const r = rnd();
        if (r > 0.965) return pebble[Math.floor(rnd() * pebble.length)]!;
        return shades[Math.floor(r * shades.length)]!;
      });
      return c.texture({ repeat: true });
    });
  }

  building(kind: BuildingKind, tier: BuildingTier): Texture {
    const key = `bld:${kind}:${tier}`;
    return this.memo(key, () => {
      const rnd = prngFor(this.seed, key);
      const c = new PixelCanvas(48, 48);
      const base =
        kind === "solar_field"
          ? RAMPS.solar
          : kind === "greenhouse"
            ? RAMPS.ice
            : kind === "habitat" || kind === "dome"
              ? RAMPS.fabric
              : kind === "isru_plant" || kind === "water_extractor"
                ? RAMPS.steel
                : RAMPS.steel;
      const dark = tier === "ruin" ? 0.4 : 1;

      // Panelled body.
      c.fill(() => base[Math.floor(rnd() * base.length)]!);
      // Horizontal panel seams.
      for (let y = 4; y < 48; y += 8) c.rect(0, y, 48, 1, base[0]!);

      if (kind === "solar_field") {
        // Grid of cells with light borders.
        for (let gy = 3; gy < 44; gy += 10) {
          for (let gx = 3; gx < 44; gx += 10) {
            c.rect(gx, gy, 8, 8, RAMPS.solar[0]!);
            c.rect(gx, gy, 8, 1, RAMPS.solar[2]!);
            c.rect(gx, gy, 1, 8, RAMPS.solar[2]!);
          }
        }
      } else if (kind === "greenhouse") {
        // Green glow rows behind glass.
        for (let y = 6; y < 48; y += 6) c.rect(2, y, 44, 2, RAMPS.accent[3]!);
      } else if (kind === "habitat" || kind === "dome") {
        // Warm window band.
        for (let x = 6; x < 44; x += 12) c.rect(x, 20, 6, 5, RAMPS.glow[2]!);
      } else {
        // Hazard stripe + a detail light.
        for (let x = 0; x < 48; x += 8) c.rect(x, 34, 4, 3, RAMPS.accent[2]!);
        c.rect(38, 8, 4, 4, RAMPS.glow[1]!);
      }
      void dark;
      return c.texture();
    });
  }
}
