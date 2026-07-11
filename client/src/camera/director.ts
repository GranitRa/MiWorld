import type { ChronicleEvent, Vec2 } from "@miworld/shared";
import { IDLE_SHOT, shotForCategory, type ShotSpec } from "./shots";
import type { CameraRig } from "./rig";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface ActiveShot {
  spec: ShotSpec;
  target: Vec2;
  priority: number;
  baseAzimuth: number;
  elapsed: number;
  jitterSeed: number;
  interrupt: boolean;
}

/**
 * The auto-director: a cinematic AI camera. It consumes the live chronicle beat stream, maps
 * each beat to a shot (shots.ts), and plays it against the CameraRig — a higher-priority beat
 * (a crisis) cuts in over a gentle one (a ceremony). When nothing is happening it falls back to
 * a slow establishing orbit of the whole colony, so it never stares at nothing. Any manual
 * camera input hands control back to the viewer for a few seconds, then the show resumes.
 */
export class Director {
  private enabled = false;
  private queue: ChronicleEvent[] = [];
  private shot: ActiveShot | null = null;
  private center: Vec2 = { x: 0, z: 0 };
  private manualCooldown = 0; // seconds the camera is yielded to the viewer
  private seed = 1;

  constructor(private readonly rig: CameraRig) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
    this.shot = null; // re-establish on the next update
    this.manualCooldown = 0;
  }

  disable(): void {
    this.enabled = false;
  }

  setColonyCenter(c: Vec2): void {
    this.center = c;
  }

  /** Feed a live chronicle beat. Beats without a camera hint are ignored (nothing to look at). */
  push(e: ChronicleEvent): void {
    if (!e.cameraHint) return;
    this.queue.push(e);
    if (this.queue.length > 24) this.queue.shift();
  }

  /** Manual input arrived — yield to the viewer, then resume the show if still enabled. */
  yieldToManual(seconds = 8): void {
    this.manualCooldown = seconds;
  }

  update(dtSec: number): void {
    if (!this.enabled) return;
    if (this.manualCooldown > 0) {
      this.manualCooldown -= dtSec;
      this.shot = null; // whatever the viewer framed becomes our new starting point
      return;
    }

    // Find the most important pending beat.
    let bestIdx = -1;
    let bestPri = -Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const p = this.queue[i]!.priority;
      if (p > bestPri) {
        bestPri = p;
        bestIdx = i;
      }
    }

    if (!this.shot) {
      if (bestIdx >= 0) this.begin(this.take(bestIdx), false);
      else this.beginIdle();
    } else {
      this.shot.elapsed += dtSec;
      const expired = this.shot.elapsed >= this.shot.spec.duration;
      // A clearly more important beat cuts in (after a beat has had a moment to read).
      const canInterrupt = bestIdx >= 0 && bestPri > this.shot.priority + 0.5 && this.shot.elapsed > 1.2;
      if (canInterrupt) this.begin(this.take(bestIdx), true);
      else if (expired && bestIdx >= 0) this.begin(this.take(bestIdx), false);
      else if (expired) this.beginIdle();
    }

    this.apply();
  }

  private take(idx: number): ChronicleEvent {
    return this.queue.splice(idx, 1)[0]!;
  }

  private begin(e: ChronicleEvent, interrupt: boolean): void {
    this.shot = {
      spec: shotForCategory(e.category),
      target: e.cameraHint!,
      priority: e.priority,
      baseAzimuth: this.rig.currentAzimuth,
      elapsed: 0,
      jitterSeed: (this.seed = (this.seed * 1664525 + 1013904223) >>> 0) / 0xffffffff * 100,
      interrupt,
    };
  }

  private beginIdle(): void {
    this.shot = {
      spec: IDLE_SHOT,
      target: this.center,
      priority: -1,
      baseAzimuth: this.rig.currentAzimuth,
      elapsed: 0,
      jitterSeed: 0,
      interrupt: false,
    };
  }

  private apply(): void {
    const s = this.shot!;
    const spec = s.spec;
    const t = spec.duration > 0 ? Math.min(1, s.elapsed / spec.duration) : 1;
    const dist = lerp(spec.distance[0], spec.distance[1], easeInOut(t));
    const az = s.baseAzimuth + spec.orbitRate * s.elapsed;
    let tx = s.target.x;
    let tz = s.target.z;
    if (spec.jitter) {
      tx += Math.sin(s.elapsed * 7.3 + s.jitterSeed) * spec.jitter;
      tz += Math.cos(s.elapsed * 6.1 + s.jitterSeed) * spec.jitter;
    }
    // Interrupts snap a touch faster (a cut); push-ins glide; the rest drift cinematically.
    const lambda = s.interrupt ? 3.2 : spec.motion === "pushIn" ? 1.4 : spec.motion === "handheld" ? 2.6 : 1.5;
    this.rig.frame(tx, tz, dist, az, spec.polar, lambda);
  }
}
