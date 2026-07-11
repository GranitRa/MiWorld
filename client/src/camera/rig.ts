import { MathUtils, PerspectiveCamera, Vector3 } from "three";

/**
 * Custom camera rig (no OrbitControls). Orbits/pans a ground target and zooms along an
 * altitude path: zooming in gently tilts toward the horizon (street-like), zooming out
 * lifts toward a map-like top-down. Keeps the camera above the terrain.
 *
 * Every parameter is smoothed toward a goal with a framerate-independent exponential ease,
 * so both manual input (snappy) and the auto-director (cinematic) drive the same rig:
 * `frame()`/`focus()` set a goal; manual handlers set the goal directly with a fast lambda.
 */
export class CameraRig {
  readonly target = new Vector3(); // smoothed target (what the camera looks at)
  private readonly goalTarget = new Vector3();
  private distance = 2600;
  private goalDistance = 2600;
  private azimuth = 0.6;
  private goalAzimuth = 0.6;
  private polar = 0.75; // radians from vertical: small = top-down, large = horizon
  private goalPolar = 0.75;
  private lambda = 12; // smoothing rate (1/sec): high = snappy (manual), low = cinematic
  private dragging: "orbit" | "pan" | null = null;
  private lastX = 0;
  private lastY = 0;
  private heightSampler: (x: number, z: number) => number = () => 0;

  /** Fired on any manual camera input, so the director can disengage. */
  onManual: (() => void) | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    this.attach();
  }

  setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightSampler = fn;
  }

  /** Distance from camera to the (smoothed) target — drives LOD + tilt-shift focus. */
  get focusDistance(): number {
    return this.distance;
  }

  /** Smoothly move to look at a ground point (chronicle click / simple focus). */
  focus(x: number, z: number, distance = 900): void {
    this.goalTarget.set(x, this.heightSampler(x, z), z);
    this.goalDistance = distance;
    this.lambda = 3.5;
  }

  /** The auto-director's framing API: aim at a point with an explicit shot pose. */
  frame(
    x: number,
    z: number,
    distance: number,
    azimuth: number,
    polar: number,
    lambda = 1.8,
  ): void {
    this.goalTarget.set(x, this.heightSampler(x, z), z);
    this.goalDistance = distance;
    this.goalAzimuth = azimuth;
    this.goalPolar = polar;
    this.lambda = lambda;
  }

  /** Current azimuth, so a shot can start orbiting from wherever the camera already is. */
  get currentAzimuth(): number {
    return this.azimuth;
  }

  private manual(lambda: number): void {
    this.lambda = lambda;
    this.onManual?.();
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
        this.goalAzimuth -= dx * 0.005;
        this.goalPolar = MathUtils.clamp(this.goalPolar + dy * 0.005, 0.12, 1.45);
      } else {
        const s = this.distance * 0.0013;
        const sinA = Math.sin(this.azimuth);
        const cosA = Math.cos(this.azimuth);
        // Pan on the ground plane relative to view direction.
        this.goalTarget.x += (-dx * cosA - dy * sinA) * s;
        this.goalTarget.z += (dx * sinA - dy * cosA) * s;
      }
      this.manual(14);
    });
    d.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = 1 + Math.sign(e.deltaY) * 0.12;
        this.goalDistance = MathUtils.clamp(this.goalDistance * factor, 25, 6500);
        // Zooming in eases toward the horizon; zooming out toward top-down.
        const altT = MathUtils.clamp((this.goalDistance - 60) / (6500 - 60), 0, 1);
        this.goalPolar = MathUtils.lerp(1.25, 0.45, altT);
        this.manual(14);
      },
      { passive: false },
    );
  }

  update(dtSec: number): void {
    // Framerate-independent exponential smoothing toward the goal pose.
    const a = 1 - Math.exp(-this.lambda * Math.max(0, Math.min(0.1, dtSec)));
    this.target.lerp(this.goalTarget, a);
    this.distance += (this.goalDistance - this.distance) * a;
    this.azimuth += (this.goalAzimuth - this.azimuth) * a;
    this.polar += (this.goalPolar - this.polar) * a;

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
