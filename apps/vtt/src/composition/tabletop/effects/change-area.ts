// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type { ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";
import type { PlanarArea, PlanarPolygon, PlanarPort, ShapeChange } from "@/features/edit-construction";

import { planarDifference, planarUnion } from "../../../features/edit-construction/index.ts";

/**
 * Where a change actually went, read from its shape alone.
 *
 * **Why every reaction reads this rather than the type's own footprint.** A
 * type regenerating from a spine or a contour replaces its whole connected
 * component, so "the faces it produced" and any outline built from them name
 * the entire network on every edit, however small. A reaction scoped by that
 * rebuilds everything the network touches each time -- and ground rebuilt
 * against a finely described contour comes back finer, so every edit made the
 * next one heavier. What changed is the difference between the two shapes,
 * and that is a question about plan-view area, never about which type changed
 * or which node is which. So it is answered once, here, for every type.
 *
 * - `claimed`: ground the change covers now and did not before.
 * - `vacated`: ground it covered before and no longer does.
 *
 * Slivers are discarded. Re-flattening a curve lands its samples fractionally
 * off the last ones all along its length, so the difference of two runs of the
 * same shape is a hairline following the whole network. `2*area/perimeter` is
 * a strip's width, and anything thinner than {@link REALLY_MOVED} is
 * re-sampling noise rather than a change that went somewhere.
 */
export const REALLY_MOVED = 0.05;

export interface ChangeArea {
  readonly claimed: PlanarArea;
  readonly vacated: PlanarArea;
}

function areaPolygonsOf(topologies: readonly ConstructionRegionTopology[]): PlanarPolygon[] {
  const polygons: PlanarPolygon[] = [];
  for (const topology of topologies) {
    const at = new Map<string, { x: number; z: number }>();
    for (const node of topology.nodes) at.set(node.id, { x: node.position.x, z: node.position.z });
    const ringOf = (loop: readonly ConstructionRegionEdge[]): [number, number][] | undefined => {
      const ring: [number, number][] = [];
      for (const use of loop) {
        const position = at.get(use.startNodeId);
        if (position === undefined) return undefined;
        ring.push([position.x, position.z]);
      }
      if (ring.length < 3) return undefined;
      ring.push([ring[0]![0], ring[0]![1]]);
      return ring;
    };
    for (const loop of topology.outerLoops) {
      const ring = ringOf(loop);
      if (ring === undefined) continue;
      const holes = topology.holes.map(ringOf).filter((hole): hole is [number, number][] => hole !== undefined);
      polygons.push([ring, ...holes]);
    }
  }
  return polygons;
}

/** `undefined` when the boolean could not answer, which is not the same as no area. */
function unionOf(port: PlanarPort, polygons: readonly PlanarPolygon[]): PlanarArea | undefined {
  if (polygons.length === 0) return [];
  try {
    return planarUnion(port, polygons[0]!, ...polygons.slice(1));
  } catch {
    return undefined;
  }
}

function widthOfPiece(piece: PlanarArea[number]): number {
  let area = 0;
  let perimeter = 0;
  for (const ring of piece) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[index + 1]!;
      area += ax * bz - bx * az;
      perimeter += Math.hypot(bx - ax, bz - az);
    }
  }
  if (perimeter <= 1e-9) return 0;
  return Math.abs(area) / perimeter;
}

/** `from` minus `without`, slivers dropped; all of `from` when the boolean fails. */
function realDifference(port: PlanarPort, from: PlanarArea, without: PlanarArea): PlanarArea {
  if (from.length === 0) return [];
  if (without.length === 0) return from.filter((piece) => widthOfPiece(piece) >= REALLY_MOVED);
  let moved: PlanarArea;
  try {
    moved = planarDifference(port, from, without);
  } catch {
    return from;
  }
  return moved.filter((piece) => widthOfPiece(piece) >= REALLY_MOVED);
}

/**
 * The ground `change` claimed and vacated, in plan.
 *
 * `undefined` when there is no boolean to ask, or it refused the shapes: the
 * caller cannot tell "nothing moved" from "could not look", so it has to fall
 * back to its own wider scope rather than conclude that nothing needs repair.
 */
export function changeAreaOf(port: Partial<PlanarPort>, change: Pick<ShapeChange, "before" | "after">): ChangeArea | undefined {
  if (typeof port.planarBoolean !== "function") return undefined;
  const planar = port as PlanarPort;
  const was = unionOf(planar, areaPolygonsOf(change.before));
  const is = unionOf(planar, areaPolygonsOf(change.after));
  if (was === undefined || is === undefined) return undefined;
  return { claimed: realDifference(planar, is, was), vacated: realDifference(planar, was, is) };
}

/** Twice the signed area of a ring, closed or not. */
function twiceArea(ring: readonly (readonly [number, number])[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, az] = ring[index]!;
    const [bx, bz] = ring[(index + 1) % ring.length]!;
    twice += ax * bz - bx * az;
  }
  return twice;
}

/**
 * The outer ring of an area's largest piece: the one outline a footprint
 * contract carries. Every piece still reaches the reaction through the area
 * itself; this only names the one a single-ring consumer answers for.
 */
export function largestOuterRing(area: PlanarArea): readonly (readonly [number, number])[] | undefined {
  let best: readonly (readonly [number, number])[] | undefined;
  let bestArea = 0;
  for (const piece of area) {
    const ring = piece[0];
    if (ring === undefined || ring.length < 3) continue;
    const size = Math.abs(twiceArea(ring));
    if (size > bestArea) {
      bestArea = size;
      best = ring;
    }
  }
  return best;
}
