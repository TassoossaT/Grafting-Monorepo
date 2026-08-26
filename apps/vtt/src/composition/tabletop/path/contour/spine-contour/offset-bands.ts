import type { ConstructionPosition } from "@/ports";

/**
 * TS mirror of `grafting-procgen-curve-offset`'s `offset_bands` (Estágio 1) --
 * see `catmull-rom.ts`'s own header for why this is a port rather than a
 * wasm call for now. Offsetting stays XZ-only, exactly like the Rust
 * primitive: a band's height at every point is carried from the spine
 * polyline's own `y` at that same station, since every profile this codebase
 * ships today is flat (`pathFormationFor`'s doc: "no raised rim in this
 * version") -- a raised shoulder is a per-point elevation this function would
 * need to add once one exists, not a reason to block on it now.
 */

/** One band's ribbon: the ring between two consecutive `bandOffsets`. */
export interface BandRibbon {
  readonly bandIndex: number;
  /** Closed ring in the sweep's own winding, first curve forward then the next reversed. */
  readonly outer: readonly ConstructionPosition[];
}

interface StationFrame {
  readonly normalX: number;
  readonly normalZ: number;
  readonly scale: number;
}

function edgeNormalXZ(from: ConstructionPosition, to: ConstructionPosition): { readonly x: number; readonly z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.max(Math.hypot(dx, dz), 1e-9);
  return { x: -dz / len, z: dx / len };
}

/**
 * The offset direction and mitre scale at every point of `points` -- same
 * algorithm as `curve-offset/src/offset.rs`'s `station_frames`, and as
 * `apps/vtt`'s own `sweep-formation.ts` (`stationFrame`) before that. An
 * interior corner's mitre length is clamped to `miterLimit` rather than left
 * to grow without bound as the corner sharpens.
 */
function stationFrames(points: readonly ConstructionPosition[], miterLimit: number): readonly StationFrame[] {
  const last = points.length - 1;
  return points.map((_point, index) => {
    if (index === 0) {
      const normal = edgeNormalXZ(points[0]!, points[1]!);
      return { normalX: normal.x, normalZ: normal.z, scale: 1 };
    }
    if (index === last) {
      const normal = edgeNormalXZ(points[last - 1]!, points[last]!);
      return { normalX: normal.x, normalZ: normal.z, scale: 1 };
    }
    const incoming = edgeNormalXZ(points[index - 1]!, points[index]!);
    const outgoing = edgeNormalXZ(points[index]!, points[index + 1]!);
    const sumX = incoming.x + outgoing.x;
    const sumZ = incoming.z + outgoing.z;
    const sumLen = Math.hypot(sumX, sumZ);
    if (sumLen < 1e-6) {
      // A reversal has no meaningful mitre direction; fall back to the
      // outgoing edge's own normal rather than divide by zero.
      return { normalX: outgoing.x, normalZ: outgoing.z, scale: 1 };
    }
    const mitreX = sumX / sumLen;
    const mitreZ = sumZ / sumLen;
    const cosHalf = Math.max(mitreX * incoming.x + mitreZ * incoming.z, 1e-6);
    return { normalX: mitreX, normalZ: mitreZ, scale: Math.min(1 / cosHalf, miterLimit) };
  });
}

function offsetCurve(
  points: readonly ConstructionPosition[],
  frames: readonly StationFrame[],
  offset: number,
): readonly ConstructionPosition[] {
  return points.map((point, index) => {
    const frame = frames[index]!;
    return {
      x: point.x + frame.normalX * frame.scale * offset,
      y: point.y,
      z: point.z + frame.normalZ * frame.scale * offset,
    };
  });
}

/**
 * One ribbon per consecutive pair of `bandOffsets`, following `polyline`'s
 * own shape. Returns no bands for a polyline shorter than two points or a
 * profile with fewer than two offsets.
 */
export function offsetBands(
  polyline: readonly ConstructionPosition[],
  bandOffsets: readonly number[],
  miterLimit: number,
): readonly BandRibbon[] {
  if (polyline.length < 2 || bandOffsets.length < 2) return [];
  const frames = stationFrames(polyline, Math.max(miterLimit, 1));
  const curves = bandOffsets.map((offset) => offsetCurve(polyline, frames, offset));
  const bands: BandRibbon[] = [];
  for (let index = 0; index + 1 < curves.length; index += 1) {
    const outer = [...curves[index]!, ...[...curves[index + 1]!].reverse()];
    bands.push({ bandIndex: index, outer });
  }
  return bands;
}
