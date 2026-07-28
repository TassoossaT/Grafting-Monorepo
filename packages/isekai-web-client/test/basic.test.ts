// Runs under plain Node (Vitest's default environment). Only covers what
// doesn't need a real DOM Dedicated Worker -- Node has no global `Worker`
// matching the browser API this package targets. The real integration
// proof (increment round trip, overflow, panic-isolation, Worker crash)
// needs an actual browser and lives in `test/browser-check.html` +
// `test/run-browser-check.mjs` -- see this package's README for why, and
// how to run it.

import { describe, expect, it } from "vitest";
import { EngineError, IsekaiEngine } from "../src/index.js";

describe("IsekaiEngine.create", () => {
  it("rejects a seed that isn't exactly 32 bytes", async () => {
    await expect(IsekaiEngine.create(new Uint8Array(31))).rejects.toThrow(RangeError);
    await expect(IsekaiEngine.create(new Uint8Array(33))).rejects.toThrow(RangeError);
  });
});

describe("EngineError", () => {
  it("carries the poisoned flag", () => {
    const poisoned = new EngineError("boom", true);
    const notPoisoned = new EngineError("rejected", false);
    expect(poisoned.poisoned).toBe(true);
    expect(notPoisoned.poisoned).toBe(false);
    expect(poisoned.name).toBe("EngineError");
  });
});
