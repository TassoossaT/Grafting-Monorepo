/**
 * A deterministic, seeded height-noise source -- what a procedural terrain
 * generator samples per-vertex to decide elevation. Kept as its own port
 * (not folded into `ConstructionSessionPort`) because it wraps a completely
 * separate Wasm module (`@grafting/procgen-generation-wasm`) with no shared
 * state: this is a pure function behind an async-init lifecycle, not a
 * stateful session.
 */
export interface TerrainNoisePort {
  /** Loads the underlying Wasm module. Every other method requires this to have resolved first. */
  start(): Promise<void>;
  /**
   * Samples a real Perlin-noise heightmap on a `width` x `height` grid,
   * seeded deterministically. Returns a flat row-major array of one height
   * value per cell, in Perlin's native `[-1, 1]` range. `scale` is the
   * distance between samples in the noise's own space -- smaller values
   * produce smoother, larger-scale features (useful range roughly `0.05`
   * to `0.2`, per the underlying Wasm binding's own doc comment).
   *
   * `originX` / `originY` place the grid's first cell in the noise's own
   * coordinates. A caller that anchors them to the world gets one height per
   * world point however large or small a window it asks for; a caller that
   * always passes `0` and stretches the result over its own extent gets a
   * different height for the same point every time that extent changes, and
   * two patches of ground made that way meet along a crease.
   */
  generateHeightmap(
    width: number,
    height: number,
    seed: number,
    scale: number,
    originX: number,
    originY: number,
  ): Float32Array;
}
