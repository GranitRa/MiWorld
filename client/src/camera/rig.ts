import { MathUtils, PerspectiveCamera, Vector3 } from "three";

/**
 * Custom camera rig (no OrbitControls). Orbits/pans a ground target and zooms along an
 * altitude path: zooming in gently tilts toward the horizon (street-like), zooming out
 * lifts toward a map-like top-down. Keeps the camera above the terrain.
 */
export class CameraRig {
  readonly target = new Vector3();
  private distance = 2600;
  private azimuth = 0.6;
  private polar = 0.75; // radians from vertical: small = top-down, large = horizon
  private dragging: "orbit" | "pan" | null = null;
  private lastX = 0;
  private lastY = 0;
  private heightSampler: (x: number, z: number) => number = () => 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    this.attach();
  }

  setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightSampler = fn;
  }

  focus(x: number, z: number, distance = 900): void {
    this.target.set(x, this.heightSampler(x, z), z);
    this.distance = distance;
  }

  private attach(): void {
    const d = this.dom;
    d.addEventListener("contextmenu", (e) => e.preventDefault());
    d.addEventListener("pointerdown", (e) => {
      this.dragging = e.button === 2 || e.shiftKey ? "pan" : "orbit";
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      d.setPointerCapture(e.pointerId);
    });
    d.addEventListener("pointerup", (e) => {
      this.dragging = null;
      d.releasePointerCapture?.(e.pointerId);
    });
    d.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.dragging === "orbit") {
        this.azimuth -= dx * 0.005;
        this.polar = MathUtils.clamp(this.polar + dy * 0.005, 0.12, 1.45);
      } else {
        const s = this.distance * 0.0013;
        const sinA = Math.sin(this.azimuth);
        const cosA = Math.cos(this.azimuth);
        // Pan on the ground plane relative to view direction.
        this.target.x += (-dx * cosA - dy * sinA) * s;
        this.target.z += (dx * sinA - dy * cosA) * s;
      }
    });
    d.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = 1 + Math.sign(e.deltaY) * 0.12;
        this.distance = MathUtils.clamp(this.distance * factor, 25, 6500);
        // Zooming in eases toward the horizon; zooming out toward top-down.
        const altT = MathUtils.clamp((this.distance - 60) / (6500 - 60), 0, 1);
        const autoPolar = MathUtils.lerp(1.25, 0.45, altT);
        this.polar = MathUtils.lerp(this.polar, autoPolar, 0.15);
      },
      { passive: false },
    );
  }

  update(): void {
    const sinP = Math.sin(this.polar);
    const cosP = Math.cos(this.polar);
    const off = new Vector3(
      sinP * Math.sin(this.azimuth),
      cosP,
      sinP * Math.cos(this.azimuth),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);

    // Terrain collision: never let the camera dip below the ground.
    const ground = this.heightSampler(this.camera.position.x, this.camera.position.z) + 6;
    if (this.camera.position.y < ground) this.camera.position.y = ground;

    this.camera.lookAt(this.target);
  }
}
