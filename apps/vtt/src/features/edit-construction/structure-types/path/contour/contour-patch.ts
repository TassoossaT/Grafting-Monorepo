import type { ConstructionEdgeGeometry, ConstructionEdgeId, ConstructionPatch, ConstructionPosition } from "@/ports";
import type { MultiPolygon, Ring } from "polygon-clipping";

import { createBoundaryEdges, simplifyClosedRing, type SweptArc } from "../../../topology/index.ts";
import { nearestSampleY } from "./union-bands.ts";
import { arcGeometryFor } from "./arc-geometry-lookup.ts";

/**
 * How close (world units, XZ) a union's own vertex may sit to a node already
 * standing on the table before it is welded onto it instead of minting a
 * fresh id -- the same idea `SPINE_WELD_TOLERANCE` already plays for the
 * station-sweep engine, kept exact for the same reason: a generous tolerance
 * would drag a vertex sideways onto whichever node happened to be near.
 */
const WELD_TOLERANCE = 1e-3; // PathCloud contour weld tolerance.

/**
 * Below this area (world units squared), a shape is a sliver, not a face.
 *
 * `polygon-clipping`'s union of a *self-intersecting* input ring (an
 * offset ribbon can self-intersect on a tight bend relative to its own
 * width -- a real hand-drawn stroke, unlike a clean two-point test line,
 * can do this) does not refuse the input; it normalises it, and a
 * self-intersection can split one ribbon into several output polygons,
 * one or more of them a near-zero-area artifact at the crossing point
 * itself. Every one of those is still a structurally valid ring -- three
 * or more distinct points, a closed loop -- so nothing upstream of area
 * would ever catch it, and it would commit as a real, permanent face no
 * one drew. Filtered here, once, rather than trusted downstream.
 */
const MIN_SHAPE_AREA = 1e-4;

function signedRingArea(ring: Ring): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index]!;
    const [x2, z2] = ring[(index + 1) % ring.length]!;
    total += z1 * x2 - x1 * z2;
  }
  return total / 2;
}

/** The shoelace area of a ring, unsigned. */
function ringArea(ring: Ring): number {
  return Math.abs(signedRingArea(ring));
}

/**
 * Ensures an outer ring is wound with positive normal (+Y, facing upwards).
 * In XZ coordinates with Y up, a positive signed area (total > 0) means the normal
 * points up (+Y). If total < 0, reversing the ring flips the normal to point up (+Y).
 */
function ensureUpwardWinding(ring: Ring, isHole: boolean): Ring {
  const area = signedRingArea(ring);
  const shouldReverse = isHole ? area > 0 : area < 0;
  return shouldReverse ? [...ring].reverse() : ring;
}

/**
 * `polygon-clipping` closes every ring by repeating its first point as its
 * last -- the GeoJSON convention. A `ConstructionPatchRegion` boundary is a
 * cycle of distinct nodes with no repeated closing vertex (`useEdge` already
 * wraps `index + 1` back to `0`), so that trailing duplicate is dropped here
 * once, rather than every caller having to know the library's own ring
 * convention.
 */
function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const [firstX, firstZ] = ring[0]!;
  const [lastX, lastZ] = ring[ring.length - 1]!;
  const closed = Math.hypot(firstX - lastX, firstZ - lastZ) < 1e-9;
  return closed ? ring.slice(0, -1) : ring;
}

export interface ExistingNode {
  readonly id: string;
  readonly position: ConstructionPosition;
}

export interface ContourPatchResult {
  readonly patch: ConstructionPatch;
  readonly regionIds: readonly string[];
}

/**
 * Turns one band layer's unioned shapes into a `ConstructionPatch` -- the
 * same kind of conversion the retired station-sweep engine's own patch
 * builder used to do, but from a union's boundary loops instead of a
 * sweep's quad grid, and welding by **position** rather than by a station
 * address, because a union vertex has no station: it may be a genuine spine
 * point, or a brand new intersection the union itself created where two
 * ribbons crossed.
 *
 * A vertex within {@link WELD_TOLERANCE} of a node already on the table
 * reuses that node's id -- which is what keeps everything **outside** the
 * region this call was scoped to untouched: those nodes are simply never
 * candidates for a fresh id, because they were never inside any ribbon this
 * call was handed.
 *
 * `heightSamples` supplies `y` for a vertex the union minted (a crossing
 * point no original ribbon vertex sits exactly on) via nearest-neighbour
 * lookup -- the same approximation `preview-shapes.ts` already uses for its
 * own union output, and the same shape of approximation `groundHeightNear`
 * uses elsewhere in this codebase for "the height nearest sample said."
 */
export function buildContourPatch(
  tableId: string,
  operationId: string,
  surfaceType: string,
  bandIndex: number,
  shapes: MultiPolygon,
  heightSamples: readonly ConstructionPosition[],
  existingNodes: readonly ExistingNode[],
  /** Uses already live on the table; a new local patch must never overfill one. */
  existingEdgeUses: ReadonlyMap<ConstructionEdgeId, readonly boolean[]> = new Map(),
  /** Which of this union's own edges are still real arcs -- {@link buildArcGeometryLookup}'s output, read back by position. */
  arcGeometry: ReadonlyMap<string, SweptArc> = new Map(),
): ContourPatchResult {
  // Contours rebuilt in a small brush window can weld to faces deliberately
  // left outside that window. A shared edge may therefore already be full;
  // keep its identity only when its two-sided manifold budget allows it and
  // mint a private boundary otherwise. Refusing the whole road leaves the
  // renderer with stale/dark geometry, which is worse than a local seam.
  const edges = createBoundaryEdges(tableId, {
    kind: "private-when-full",
    runPrefix: `contour:${operationId}:band-${bandIndex}`,
    existingUses: existingEdgeUses,
  });
  const nodePositions = new Map<string, ConstructionPosition>();

  const nearestExisting = (x: number, z: number): ExistingNode | undefined => {
    let best: { readonly node: ExistingNode; readonly distance: number } | undefined;
    for (const node of existingNodes) {
      const distance = Math.hypot(node.position.x - x, node.position.z - z);
      if (distance > WELD_TOLERANCE) continue;
      if (best === undefined || distance < best.distance) best = { node, distance };
    }
    return best?.node;
  };

  let mintedCounter = 0;
  const idsFor = (ring: Ring, ringIndex: number): readonly string[] =>
    openRing(ring).map(([x, z]) => {
      const welded = nearestExisting(x, z);
      if (welded !== undefined) {
        nodePositions.set(welded.id, welded.position);
        return welded.id;
      }
      const id = `contour:${operationId}:band-${bandIndex}:${ringIndex}:${mintedCounter}`;
      mintedCounter += 1;
      nodePositions.set(id, { x, y: nearestSampleY(x, z, heightSamples), z });
      return id;
    });

  const regions = shapes
    .filter((shape) => {
      const [outerRing] = shape;
      return outerRing !== undefined && ringArea(outerRing) >= MIN_SHAPE_AREA;
    })
    .map((shape, shapeIndex) => {
      const [outerRing, ...holeRings] = shape;
      const geometryBetween = (from: string, to: string): ConstructionEdgeGeometry | undefined =>
        arcGeometryFor(arcGeometry, nodePositions.get(from)!, nodePositions.get(to)!);
      const boundaryUse = (ids: readonly string[], index: number) => {
        const from = ids[index]!;
        const to = ids[(index + 1) % ids.length]!;
        return edges.use(from, to, geometryBetween(from, to));
      };
      // A curve the union tessellated into many small chords or many small
      // arc samples of the same circle is still, geometrically, one edge --
      // simplified here, once, so every consumer downstream (the graph, the
      // renderer, a future edit) sees the road it actually is rather than
      // the polyline a boolean union happened to produce.
      const simplifyRing = (ids: readonly string[]): readonly string[] => {
        const positions = ids.map((id) => nodePositions.get(id)!);
        const kept = simplifyClosedRing(positions, (fromIndex, toIndex) => geometryBetween(ids[fromIndex]!, ids[toIndex]!));
        return kept.map((index) => ids[index]!);
      };
      const outerIds = simplifyRing(idsFor(ensureUpwardWinding(outerRing ?? [], false), 0));
      const boundary = outerIds.map((_id, index) => boundaryUse(outerIds, index));
      const holes = holeRings.map((holeRing, holeIndex) => {
        const holeIds = simplifyRing(idsFor(ensureUpwardWinding(holeRing, true), holeIndex + 1));
        return holeIds.map((_id, index) => boundaryUse(holeIds, index));
      });
      return {
        regionId: `${operationId}:band-${bandIndex}:${shapeIndex}`,
        boundary,
        holes: holes.length > 0 ? holes : undefined,
        surfaceType,
        physical: true,
      };
    });

  // Simplification mints ids for points the ring no longer walks through --
  // still in `nodePositions` from `idsFor`, but on no edge any boundary or
  // hole above actually declared. Reported only for what the patch still
  // uses, so a collapsed run of arc samples does not resurrect its own
  // discarded middle as orphaned nodes nobody references.
  const declaredEdges = edges.all();
  const usedNodeIds = new Set<string>();
  for (const edge of declaredEdges) {
    usedNodeIds.add(edge.startNodeId);
    usedNodeIds.add(edge.endNodeId);
  }

  return {
    patch: {
      nodes: [...nodePositions].filter(([id]) => usedNodeIds.has(id)).map(([id, position]) => ({ id, position })),
      edges: declaredEdges,
      regions,
    },
    regionIds: regions.map((region) => region.regionId),
  };
}
