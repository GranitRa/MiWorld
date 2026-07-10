import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";

// A tiny pixel canvas with 1-px drawing primitives, turned into a NearestFilter texture so
// the art stays crisp up close and mip-filters gracefully at distance.
export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  clear(color?: string): void {
    if (color) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, this.w, this.h);
    } else {
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  px(x: number, y: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x | 0, y | 0, 1, 1);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  /** Fill every pixel by choosing a colour from `pick(x,y)`. */
  fill(pick: (x: number, y: number) => string): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) this.px(x, y, pick(x, y));
    }
  }

  texture(opts: { repeat?: boolean; mipmaps?: boolean } = {}): Texture {
    const t = new CanvasTexture(this.canvas);
    t.magFilter = NearestFilter;
    t.minFilter = opts.mipmaps === false ? NearestFilter : LinearMipmapLinearFilter;
    t.generateMipmaps = opts.mipmaps !== false;
    t.colorSpace = SRGBColorSpace;
    if (opts.repeat) {
      t.wrapS = RepeatWrapping;
      t.wrapT = RepeatWrapping;
    }
    t.needsUpdate = true;
    return t;
  }
}
