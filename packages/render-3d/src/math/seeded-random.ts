/**
 * A small, self-contained PRNG (mulberry32) rather than `Math.random` --
 * seeded deterministically, so the same seed always produces the same
 * sequence. That is what makes procedural visual variation (a room's shape,
 * a scatter of instances, a jittered grid) reproducible in tests and
 * replayable across a reload, instead of flaky.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear interpolation: `fraction` of the way from `min` to `max`. */
export function lerp(min: number, max: number, fraction: number): number {
  return min + (max - min) * fraction;
}
