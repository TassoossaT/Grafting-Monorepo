import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping";

import type { ConstructionPosition } from "@/ports";

import type { BandRibbon } from "./offset-bands.ts";

/**
 * Unions every ribbon of one band layer into its own outer loop(s) and
 * hole(s) -- the same `polygon-clipping` union `preview-shapes.ts`'s
 * `unionCapsules` already proves works in this codebase, including its
 * incremental fallback for the rare case the library throws on a whole
 * batch at once.
 *
 * **Union only, deliberately no triangulation here.** The construction graph
 * stores a region as a boundary *cycle*, not a mesh -- triangulating a face
 * is `grafting-procgen-surface-mesh`'s job, done later from that cycle at
 * render time (see that crate's own doc: "turning that into geometry is the
 * caller's job", read at mesh-generation time, never at patch-authoring
 * time). `grafting-procgen-curve-offset`'s Rust `union_and_triangulate`
 * (Estágio 1) triangulates too, which is the wrong shape for *this* step --
 * a design note carried forward for whenever that crate is wired in: the
 * Rust primitive this function will eventually call needs a union-only
 * variant (or the boundary loop exposed before triangulation), not the
 * `TriangulatedMesh` it hands back today.
 *
 * A T, an X, or an L of overlapping ribbons all fall out of this one call
 * with no per-topology branch: the union either merges two ribbons into one
 * loop or it doesn't, and both are the same code path.
 */
export function unionBandLayer(ribbons: readonly BandRibbon[]): MultiPolygon {
  const polygons: Polygon[] = ribbons
    .map((ribbon) => [ringOf(ribbon.outer)])
    .filter(([ring]) => ring.length >= 4);
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return [polygons[0]!];
  try {
    const [first, ...rest] = polygons;
    return polygonClipping.union(first!, ...rest);
  } catch {
    let merged: MultiPolygon = [polygons[0]!];
    for (let i = 1; i < polygons.length; i++) {
      try {
        merged = polygonClipping.union(merged, polygons[i]!);
      } catch {
        merged = [...merged, polygons[i]!];
      }
    }
    return merged;
  }
}

export function ringOf(outer: readonly ConstructionPosition[]): Ring {
  const points = outer.map((point): [number, number] => [point.x, point.z]);
  if (points.length >= 3) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
      points.push([first[0], first[1]]);
    }
  }
  return points;
}

/** The `y` of whichever `samples` point is nearest `(x, z)` -- same lookup `preview-shapes.ts`'s `nearestSampleY` already uses to give a union's new vertices a height. */
export function nearestSampleY(x: number, z: number, samples: readonly ConstructionPosition[]): number {
  let bestY = samples[0]?.y ?? 0;
  let bestDistanceSq = Infinity;
  for (const sample of samples) {
    const dx = sample.x - x;
    const dz = sample.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestY = sample.y;
    }
  }
  return bestY;
}
