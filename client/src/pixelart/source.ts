import type { Texture } from "three";
import { PixelCanvas } from "./factory";
import { prngFor } from "./prng";

// Abstraction over pixel-art assets so authored sprite sheets can later be swapped in behind
// the same interface (SheetSpriteSource) without touching renderers. For now everything is
// generated procedurally and memoized (one texture per key, ever).
export interface SpriteSource {
  /** A tiling regolith grain tile (multiply map) for the terrain micro-detail. */
  terrainTile(index: number): Texture;
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
}
