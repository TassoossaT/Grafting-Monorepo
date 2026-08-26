import type { ConstructionPosition } from "@/ports";
import { stationFrame } from "../../../topology/index.ts";

/**
 * TS mirror of `grafting-procgen-curve-offset`'s `offset_bands` (Estágio 1) --
 * see `catmull-rom.ts`'s own header for why this is a port rather than a
 * wasm call for now. Offsetting stays XZ-only, exactly like the Rust
 * primitive: a band's height at every point is carried from the spine
 * polyline's own `y` at that same station, since every profile this codebase
 * ships today is flat (`pathFormationFor`'s doc: "no raised rim in this
 * version") -- a raised shoulder is a per-point elevation this function would
 * need to add once one exists, not a reason to block on it now.
 *
 * Mitre/frame maths is `topology/sweep-formation.ts`'s own `stationFrame` --
 * the same function a wall's sweep already uses -- rather than a private
 * copy, so both cross-sections offset the same way at a corner.
 */

/** One band's ribbon: the ring between two consecutive `bandOffsets`. */
export interface BandRibbon {
  readonly bandIndex: number;
  /** Closed ring in the sweep's own winding, first curve forward then the next reversed. */
  readonly outer: readonly ConstructionPosition[];
}

/**
 * One band per consecutive pair of `bandOffsets`, following `polyline`'s
 * own shape. Returns no bands for a polyline shorter than two points or a
 * profile with fewer than two offsets.
 */
export function offsetBands(
  polyline: readonly ConstructionPosition[],
  bandOffsets: readonly number[],
  miterLimit: number,
): readonly BandRibbon[] {
  if (polyline.length < 2 || bandOffsets.length < 2) return [];
  const clampedMiter = Math.max(miterLimit, 1);
  const frames = polyline.map((_point, index) => stationFrame(polyline, index, clampedMiter));
  const curves = bandOffsets.map((offset) =>
    polyline.map((point, index) => {
      const frame = frames[index]!;
      return { x: point.x + frame[0] * offset, y: point.y, z: point.z + frame[1] * offset };
    }),
  );

  const bands: BandRibbon[] = [];
  for (let index = 0; index + 1 < curves.length; index += 1) {
    const outer = [...curves[index]!, ...[...curves[index + 1]!].reverse()];
    bands.push({ bandIndex: index, outer });
  }
  return bands;
}
