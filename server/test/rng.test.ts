import { describe, it, expect } from "vitest";
import { RngGateway } from "../src/sim/rng";

describe("RngGateway", () => {
  it("same seed + stream → identical sequence", () => {
    const a = new RngGateway(42);
    const b = new RngGateway(42);
    const seqA = Array.from({ length: 20 }, () => a.next("weather"));
    const seqB = Array.from({ length: 20 }, () => b.next("weather"));
    expect(seqA).toEqual(seqB);
  });

  it("different streams are independent", () => {
    const g = new RngGateway(7);
    const weather = g.next("weather");
    const g2 = new RngGateway(7);
    g2.next("births"); // drawing births must not shift weather
    expect(g2.next("weather")).toBe(weather);
  });

  it("serialize + restore resumes the exact sequence (survives a restart)", () => {
    const original = new RngGateway(123);
    for (let i = 0; i < 50; i++) original.next("crises");
    const expectedNext = Array.from({ length: 10 }, () => original.next("crises"));

    // Rebuild from a fresh gateway seeded with the same value, drawing 50 first...
    const rebuilt = new RngGateway(123);
    for (let i = 0; i < 50; i++) rebuilt.next("crises");
    const state = rebuilt.serialize();

    // ...then restore that state into another gateway and continue.
    const resumed = new RngGateway(123, state);
    const actualNext = Array.from({ length: 10 }, () => resumed.next("crises"));
    expect(actualNext).toEqual(expectedNext);
  });
});
