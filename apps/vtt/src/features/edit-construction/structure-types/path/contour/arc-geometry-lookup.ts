import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports";
import type { SweptArc } from "../../../topology/index.ts";
import type { BandRibbon } from "./offset-bands.ts";

/**
 * Rounds to the same order of magnitude `contour-patch.ts`'s own
 * `WELD_TOLERANCE` welds at. A union that leaves a stretch untouched hands
 * its vertices straight back at floating-point-identical positions, but
 * this stays a rounded key rather than an exact one so the lookup does not
 * silently go cold the one time it does not.
 */
const KEY_PRECISION = 1e4;

function roundedKey(point: ConstructionPosition): string {
  return `${Math.round(point.x * KEY_PRECISION)},${Math.round(point.z * KEY_PRECISION)}`;
}

function pairKey(from: ConstructionPosition, to: ConstructionPosition): string {
  return `${roundedKey(from)}->${roundedKey(to)}`;
}

/**
 * Every lengthwise edge every band ribbon actually runs on as a real arc,
 * keyed by the two endpoints in the direction the ribbon itself walks them.
 *
 * Built once per contour regeneration, before the ribbons are handed to the
 * union: `unionBandLayer` only ever sees plain points, so this is the one
 * place left that still knows which of them came from a true circle.
 */
export function buildArcGeometryLookup(ribbons: readonly BandRibbon[]): ReadonlyMap<string, SweptArc> {
  const lookup = new Map<string, SweptArc>();
  for (const { outer, ringArcs } of ribbons) {
    for (let index = 0; index < outer.length; index += 1) {
      const arc = ringArcs[index];
      if (arc === undefined) continue;
      lookup.set(pairKey(outer[index]!, outer[(index + 1) % outer.length]!), arc);
    }
  }
  return lookup;
}

/**
 * The geometry a boundary edge from `from` to `to` should declare -- a real
 * arc when `lookup` recognises this pair (from either direction of travel;
 * an edge welded onto the opposite side of the ring still reads its own
 * true circle, just reversed), a straight chord (`undefined`, the patch's
 * own default) everywhere the union actually reshaped the boundary.
 */
export function arcGeometryFor(
  lookup: ReadonlyMap<string, SweptArc>,
  from: ConstructionPosition,
  to: ConstructionPosition,
): ConstructionEdgeGeometry | undefined {
  const forward = lookup.get(pairKey(from, to));
  if (forward !== undefined) return { kind: "arc", center: forward.center, clockwise: forward.clockwise };
  const backward = lookup.get(pairKey(to, from));
  if (backward !== undefined) return { kind: "arc", center: backward.center, clockwise: !backward.clockwise };
  return undefined;
}
