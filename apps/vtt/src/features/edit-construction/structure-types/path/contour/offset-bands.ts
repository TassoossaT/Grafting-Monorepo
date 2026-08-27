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

/** Whether `polyline` is a closed loop -- an O-shaped road's own first and last station coincide. */
function isClosedRing(polyline: readonly ConstructionPosition[]): boolean {
  if (polyline.length < 3) return false;
  const first = polyline[0]!;
  const last = polyline[polyline.length - 1]!;
  return Math.hypot(first.x - last.x, first.z - last.z) < 1e-6;
}

/**
 * One band per consecutive pair of `bandOffsets`, following `polyline`'s
 * own shape. Returns no bands for a polyline shorter than two points or a
 * profile with fewer than two offsets.
 *
 * A closed loop's first and last station are the same physical point, but
 * `stationFrame` reads each end of the array it is handed as a free end --
 * treated separately, they would offset that one seam point two different
 * ways, leaving a gap or an overlap right where the loop closes. Framed
 * instead through a tiny wraparound window (its own neighbour on the far
 * side of the loop, standing in for the "next"/"previous" station an open
 * run would not have), both ends get the identical, correctly mitred frame.
 */
export function offsetBands(
  polyline: readonly ConstructionPosition[],
  bandOffsets: readonly number[],
  miterLimit: number,
): readonly BandRibbon[] {
  if (polyline.length < 2 || bandOffsets.length < 2) return [];
  const clampedMiter = Math.max(miterLimit, 1);
  const closed = isClosedRing(polyline);
  const last = polyline.length - 1;
  const seamFrame = closed
    ? stationFrame([polyline[last - 1]!, polyline[0]!, polyline[1]!], 1, clampedMiter)
    : undefined;
  const frames = polyline.map((point, index) => {
    if (seamFrame !== undefined && (index === 0 || index === last)) return seamFrame;
    return stationFrame(polyline, index, clampedMiter);
  });
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
