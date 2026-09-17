import type { ConstructionEdgeId, ConstructionPatch, ConstructionPosition } from "@/ports";

import { createBoundaryEdges, simplifyClosedRing } from "../../../topology/index.ts";
import { heightsOnCurves, type FieldPort, type ReferenceCurve } from "./curve-projection.ts";
import type { PlanarArea, PlanarPoint, PlanarRing } from "../../../topology/planar-area.ts";

/**
 * How close (world units, XZ) a union's own vertex may sit to a node already
 * standing on the table before it is welded onto it instead of minting a
 * fresh id -- the same idea `SPINE_WELD_TOLERANCE` already plays for the
 * station-sweep engine, kept exact for the same reason: a generous tolerance
 * would drag a vertex sideways onto whichever node happened to be near.
 */
const WELD_TOLERANCE = 0.05; // PathCloud contour weld tolerance (5 cm).

/**
 * Below this area (world units squared), a shape is a sliver, not a face.
 *
 * The union of a *self-intersecting* input ring (an
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

function signedRingArea(ring: PlanarRing): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index]!;
    const [x2, z2] = ring[(index + 1) % ring.length]!;
    total += x1 * z2 - x2 * z1;
  }
  return total / 2;
}

/** The shoelace area of a ring, unsigned. */
function ringArea(ring: PlanarRing): number {
  return Math.abs(signedRingArea(ring));
}

/**
 * Ensures an outer ring is wound with positive normal (+Y, facing upwards).
 * In XZ coordinates with Y up, a positive signed area (total > 0) means the normal
 * points up (+Y). If total < 0, reversing the ring flips the normal to point up (+Y).
 */
function ensureUpwardWinding(ring: PlanarRing, isHole: boolean): PlanarRing {
  const area = signedRingArea(ring);
  const shouldReverse = isHole ? area > 0 : area < 0;
  return shouldReverse ? [...ring].reverse() : ring;
}

/**
 * A plan-view ring is carried closed, repeating its first point as its last
 * (`planar-area.ts`). A `ConstructionPatchRegion` boundary is a cycle of
 * distinct nodes with no repeated closing vertex (`useEdge` already wraps
 * `index + 1` back to `0`), so that trailing duplicate is dropped here once,
 * rather than every caller having to know both conventions.
 */
function openRing(ring: PlanarRing): PlanarRing {
  if (ring.length < 2) return ring;
  const [firstX, firstZ] = ring[0]!;
  const [lastX, lastZ] = ring[ring.length - 1]!;
  const closed = Math.hypot(firstX - lastX, firstZ - lastZ) < 1e-9;
  return closed ? ring.slice(0, -1) : ring;
}

function distanceToSegmentXZ(
  p: ConstructionPosition,
  a: readonly [number, number],
  b: readonly [number, number],
): { readonly dist: number; readonly t: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return { dist: Math.hypot(p.x - a[0], p.z - a[1]), t: 0 };
  const t = ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / lenSq;
  if (t < 1e-4 || t > 1 - 1e-4) return { dist: Infinity, t };
  const projX = a[0] + t * dx;
  const projZ = a[1] + t * dz;
  return { dist: Math.hypot(p.x - projX, p.z - projZ), t };
}

/**
 * Re-inserts intermediate ribbon samples along straight 2D edges produced by
 * polygon clipping so elevation stations are not lost before 3D simplification.
 */
function restoreHeightVertices(
  ring: PlanarRing,
  heightSamples: readonly ConstructionPosition[],
): PlanarRing {
  if (heightSamples.length === 0 || ring.length < 2) return ring;

  const cellSize = 2.0;
  const grid = new Map<string, ConstructionPosition[]>();
  for (const sample of heightSamples) {
    const cx = Math.floor(sample.x / cellSize);
    const cz = Math.floor(sample.z / cellSize);
    const key = `${cx},${cz}`;
    const cell = grid.get(key);
    if (cell !== undefined) {
      cell.push(sample);
    } else {
      grid.set(key, [sample]);
    }
  }

  const restored: PlanarPoint[] = [];
  const minInterval = 0.8;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    restored.push(a);

    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < minInterval * 1.5) continue;

    const minTStep = minInterval / segLen;
    const matching: { readonly x: number; readonly z: number; readonly t: number }[] = [];

    const minCX = Math.floor((Math.min(a[0], b[0]) - 1e-3) / cellSize);
    const maxCX = Math.floor((Math.max(a[0], b[0]) + 1e-3) / cellSize);
    const minCZ = Math.floor((Math.min(a[1], b[1]) - 1e-3) / cellSize);
    const maxCZ = Math.floor((Math.max(a[1], b[1]) + 1e-3) / cellSize);

    for (let cx = minCX; cx <= maxCX; cx += 1) {
      for (let cz = minCZ; cz <= maxCZ; cz += 1) {
        const cell = grid.get(`${cx},${cz}`);
        if (cell === undefined) continue;
        for (const sample of cell) {
          const { dist, t } = distanceToSegmentXZ(sample, a, b);
          if (dist < 1e-3) {
            matching.push({ x: sample.x, z: sample.z, t });
          }
        }
      }
    }

    if (matching.length > 0) {
      matching.sort((l, r) => l.t - r.t);
      let lastT = 0;
      for (const pt of matching) {
        if (pt.t - lastT >= minTStep && 1 - pt.t >= minTStep) {
          restored.push([pt.x, pt.z]);
          lastT = pt.t;
        }
      }
    }
  }
  restored.push(ring[ring.length - 1]!);
  return restored;
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
 * `referenceCurves` supplies `y` for every vertex, by projecting it onto the
 * curve the contour was swept from and reading that curve's own height at
 * the station the vertex lands on. See `curve-projection.ts` for why this
 * replaced a nearest-sample lookup, and why it has to keep agreeing with the
 * Rust field that elevates the same surface's interior -- the two answer for
 * the margin and the middle of one face, and a disagreement between them is
 * a seam right where they meet.
 *
 * `heightSamples` is now only what `restoreHeightVertices` densifies a long
 * clipped edge against; it no longer decides any height.
 */
export function buildContourPatch(
  /** The engine, which is what elevates a flat union vertex. See `curve-projection.ts`. */
  port: FieldPort,
  tableId: string,
  operationId: string,
  surfaceType: string,
  bandIndex: number,
  shapes: PlanarArea,
  heightSamples: readonly ConstructionPosition[],
  referenceCurves: readonly ReferenceCurve[],
  existingNodes: readonly ExistingNode[],
  /** Uses already live on the table; a new local patch must never overfill one. */
  existingEdgeUses: ReadonlyMap<ConstructionEdgeId, readonly boolean[]> = new Map(),
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

  // **Bucketed, not scanned.** Welding asks "is a node already standing
  // here", and asking it by walking every node on the table costs the whole
  // table once per ring vertex -- quadratic in the size of the road network,
  // which is precisely the cost that made welding unaffordable and left the
  // engine re-minting every node of the cloud on every stroke instead. A
  // vertex can only weld to a node within {@link WELD_TOLERANCE}, so only
  // the buckets that reach that far need looking at, and there are nine of
  // them however big the table is.
  const buckets = new Map<string, ExistingNode[]>();
  const bucketKey = (x: number, z: number): string =>
    `${Math.floor(x / WELD_TOLERANCE)}:${Math.floor(z / WELD_TOLERANCE)}`;
  for (const node of existingNodes) {
    const key = bucketKey(node.position.x, node.position.z);
    const held = buckets.get(key);
    if (held === undefined) buckets.set(key, [node]);
    else held.push(node);
  }

  const nearestExisting = (x: number, y: number, z: number): ExistingNode | undefined => {
    let best: { readonly node: ExistingNode; readonly distance: number } | undefined;
    const column = Math.floor(x / WELD_TOLERANCE);
    const row = Math.floor(z / WELD_TOLERANCE);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const node of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
          const distance = Math.hypot(node.position.x - x, node.position.z - z);
          if (distance > WELD_TOLERANCE || Math.abs(node.position.y - y) > WELD_TOLERANCE) continue;
          if (best === undefined || distance < best.distance) best = { node, distance };
        }
      }
    }
    return best?.node;
  };

  let mintedCounter = 0;
  const idsFor = (ring: PlanarRing, ringIndex: number): readonly string[] => {
    const walked = openRing(ring);
    // One crossing for the whole ring: the engine answers where each vertex
    // projects onto the curves this contour was swept from.
    const heights = heightsOnCurves(port, referenceCurves, walked.map(([x, z]) => [x, z] as const));
    return walked.map(([x, z], pointIndex) => {
      const y = heights[pointIndex] ?? 0;
      const welded = nearestExisting(x, y, z);
      if (welded !== undefined) {
        nodePositions.set(welded.id, welded.position);
        return welded.id;
      }
      const id = `contour:${operationId}:band-${bandIndex}:${ringIndex}:${mintedCounter}`;
      mintedCounter += 1;
      nodePositions.set(id, { x, y, z });
      return id;
    });
  };

  const regions = shapes
    .filter((shape) => {
      const [outerRing] = shape;
      return outerRing !== undefined && ringArea(outerRing) >= MIN_SHAPE_AREA;
    })
    .map((shape, shapeIndex) => {
      const [outerRing, ...holeRings] = shape;
      // A run of collinear points the union happened to leave standing is
      // still, geometrically, one straight edge -- simplified here, once, so
      // a self-intersection cleanup or a welded-in existing vertex does not
      // leave the patch with more boundary edges than the shape actually
      // has.
      const simplifyRing = (ids: readonly string[]): readonly string[] => {
        const positions = ids.map((id) => nodePositions.get(id)!);
        const kept = simplifyClosedRing(positions, () => undefined);
        return kept.map((index) => ids[index]!);
      };
      const restoredOuter = restoreHeightVertices(outerRing ?? [], heightSamples);
      const outerIds = simplifyRing(idsFor(ensureUpwardWinding(restoredOuter, false), 0));
      const boundary = outerIds.map((id, index) => edges.use(id, outerIds[(index + 1) % outerIds.length]!));
      const holes = holeRings.map((holeRing, holeIndex) => {
        const restoredHole = restoreHeightVertices(holeRing, heightSamples);
        const holeIds = simplifyRing(idsFor(ensureUpwardWinding(restoredHole, true), holeIndex + 1));
        return holeIds.map((id, index) => edges.use(id, holeIds[(index + 1) % holeIds.length]!));
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
