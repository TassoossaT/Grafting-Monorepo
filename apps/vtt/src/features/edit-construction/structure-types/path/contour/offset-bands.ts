import type { ConstructionPosition } from "@/ports";
import { stationFrame, type SweptArc } from "../../../topology/index.ts";

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
 * copy, so a curved span offsets onto a genuinely concentric circle here too
 * instead of the chord-mitre approximation a private reimplementation would
 * drift back towards.
 */

/** One band's ribbon: the ring between two consecutive `bandOffsets`. */
export interface BandRibbon {
  readonly bandIndex: number;
  /** Closed ring in the sweep's own winding, first curve forward then the next reversed. */
  readonly outer: readonly ConstructionPosition[];
  /**
   * The arc (if any) every consecutive pair of `outer` actually runs on --
   * wrapping, so `ringArcs[k]` describes `outer[k] -> outer[(k+1) %
   * outer.length]`. `undefined` on the two end caps (never part of the
   * original curve) and on any span the polyline itself was not an arc for.
   */
  readonly ringArcs: readonly (SweptArc | undefined)[];
}

/** The same circle read from the opposite direction of travel. */
function reverseArc(arc: SweptArc | undefined): SweptArc | undefined {
  return arc === undefined ? undefined : { center: arc.center, clockwise: !arc.clockwise };
}

/**
 * One band per consecutive pair of `bandOffsets`, following `polyline`'s
 * own shape. Returns no bands for a polyline shorter than two points or a
 * profile with fewer than two offsets.
 *
 * `arcs[index]` -- one shorter than `polyline`, same convention
 * `sweep-formation.ts` and `catmull-rom.ts`'s `sampleSpineCurve` already
 * use -- names the true circle the span from `polyline[index]` to
 * `polyline[index + 1]` runs on, so a curved stretch offsets radially
 * (concentric, same centre) instead of by the chord mitre an ordinary bend
 * gets.
 */
export function offsetBands(
  polyline: readonly ConstructionPosition[],
  bandOffsets: readonly number[],
  miterLimit: number,
  arcs: readonly (SweptArc | undefined)[] = [],
): readonly BandRibbon[] {
  if (polyline.length < 2 || bandOffsets.length < 2) return [];
  const clampedMiter = Math.max(miterLimit, 1);
  const frames = polyline.map((_point, index) => stationFrame(polyline, index, clampedMiter, arcs));
  const curves = bandOffsets.map((offset) =>
    polyline.map((point, index) => {
      const frame = frames[index]!;
      return { x: point.x + frame[0] * offset, y: point.y, z: point.z + frame[1] * offset };
    }),
  );

  const spanCount = polyline.length - 1;
  const bands: BandRibbon[] = [];
  for (let index = 0; index + 1 < curves.length; index += 1) {
    const outer = [...curves[index]!, ...[...curves[index + 1]!].reverse()];
    const ringArcs: (SweptArc | undefined)[] = [];
    for (let span = 0; span < spanCount; span += 1) ringArcs.push(arcs[span]);
    ringArcs.push(undefined); // end cap: this band's two offset curves meet at the run's far end.
    for (let span = spanCount - 1; span >= 0; span -= 1) ringArcs.push(reverseArc(arcs[span]));
    ringArcs.push(undefined); // start cap: closes the ring back to the run's near end.
    bands.push({ bandIndex: index, outer, ringArcs });
  }
  return bands;
}
