import { describe, it, expect } from "vitest";
import { REAL_MS_PER_TICK, type TickMessage } from "@miworld/shared";
import { PlaybackBuffer } from "../src/net/playback";

function tick(worldTimeSec: number): TickMessage {
  return {
    type: "tick",
    worldTimeSec,
    events: [],
    deltas: [],
    hud: { pop: 0, dust: 0, stock: {} as never, crisis: null, name: null },
  };
}

describe("PlaybackBuffer", () => {
  it("stays live: newest tick is always current", () => {
    const pb = new PlaybackBuffer(50);
    for (let i = 1; i <= 10; i++) pb.ingest(tick(i * 60));
    expect(pb.isLive()).toBe(true);
    expect(pb.current()?.worldTimeSec).toBe(600);
  });

  it("at 4x, a rewound playhead catches up to live and clamps", () => {
    const pb = new PlaybackBuffer(200);
    for (let i = 1; i <= 100; i++) pb.ingest(tick(i * 60));
    pb.rewind(40); // leave live, go back 40 ticks
    expect(pb.isLive()).toBe(false);
    pb.setSpeed(4);
    // Advance real time in chunks; 40 ticks / 4x needs ~10 ticks of real time.
    for (let i = 0; i < 20; i++) pb.step(REAL_MS_PER_TICK);
    expect(pb.isLive()).toBe(true);
    expect(pb.current()?.worldTimeSec).toBe(6000);
  });

  it("pause holds the view frozen while the buffer keeps growing", () => {
    const pb = new PlaybackBuffer(200);
    for (let i = 1; i <= 20; i++) pb.ingest(tick(i * 60));
    pb.rewind(10);
    pb.setSpeed(0);
    const frozen = pb.current()?.worldTimeSec;
    for (let i = 21; i <= 40; i++) pb.ingest(tick(i * 60)); // live keeps arriving
    pb.step(REAL_MS_PER_TICK * 100);
    expect(pb.current()?.worldTimeSec).toBe(frozen);
    expect(pb.isLive()).toBe(false);
  });

  it("drops oldest ticks beyond the window", () => {
    const pb = new PlaybackBuffer(10);
    for (let i = 1; i <= 30; i++) pb.ingest(tick(i * 60));
    expect(pb.size).toBe(10);
    expect(pb.current()?.worldTimeSec).toBe(1800); // newest kept
  });
});
