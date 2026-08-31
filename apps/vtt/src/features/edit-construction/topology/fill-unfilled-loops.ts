import earcut from "earcut";

import type {
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionUnfilledLoop,
} from "@/ports";

/**
 * Closing a gap by registering the rim the engine already reports, rather
 * than by generating anything to put in it.
 *
 * This is the whole of "make the ground whole again", and it is one call
 * because the engine has already done the hard part: `getUnfilledLoops`
 * returns each closed loop of free boundary that no face fills, with its
 * edges **already oriented for the face that would fill it**. Registering one
 * therefore adds no node and no edge -- it declares a face over boundary that
 * is already there, walked the one way the graph will accept.
 *
 * That is not merely convenient, it is what makes the result correct by
 * construction, and every class of bug a generated fill has to fight is
 * absent rather than handled:
 *
 * - it cannot float, because it introduces no vertex to weld -- every corner
 *   is a node already standing there;
 * - it cannot leave a gap along a seam, because it walks the neighbour's own
 *   edges, all of them, including the collinear ones a clipper would have
 *   simplified away;
 * - it cannot be wound the wrong way, because the direction is reported, not
 *   chosen -- no convention of any type is assumed anywhere;
 * - it cannot pave over the outside of a patch, because the engine tells a
 *   gap's rim from a patch's outline by where the loop's own neighbours lie.
 *
 * `scope` is the whole point and never a speed-up. An edge is considered only
 * when **both** its nodes are named, so a caller has to name every node
 * bounding the gap it means to close -- both sides of a seam, not just its
 * own. A closed loop somewhere the caller never went is somebody else's
 * shape, and paving it over because something happened elsewhere is a bug,
 * not a repair.
 *
 * A hole a region *declared* -- a doorway, a courtyard -- is not reported and
 * so is never sealed; that exclusion lives in the engine.
 */
export interface UnfilledLoopFillRuntime {
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[];
  addPatch(
    patch: ConstructionPatch,
    origin: "local",
    causeId: string,
  ): { readonly createdSurfaceKeys: readonly unknown[]; readonly skippedRegionIds: readonly string[] };
  /** Only ever called for `mesh` -- a whole-rim fill needs no position at all. */
  getSnapshot?(): {
    readonly tableId: string;
    readonly map: { readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }> };
  };
}

/** How a gap is mended. */
export interface FillUnfilledLoopsOptions {
  /**
   * Cut each gap into a mesh over its own rim instead of covering it with one
   * face. Off by default: the gap a stroke leaves between its own cells is
   * one cell wide, and a single face is exactly right for it. A caller
   * mending something larger -- the hole a cut leaves across everything a
   * path crossed -- asks for it. Nothing about it is particular to that
   * caller; it is the same mend, cut finer.
   */
  readonly mesh?: boolean;
  /**
   * Closed rims of whatever may be standing *inside* a gap, each already
   * oriented for the mend rather than for the face that owns it (see
   * `outwardPerimeterRings`). Whichever of them a gap actually encloses
   * become openings in its mesh; the rest are ignored.
   *
   * One ring per *cloud*, never one per face: the faces of a road touch, so
   * handing over each face's own boundary describes a shape that overlaps
   * itself along every edge two of them share, and a triangulation of that is
   * meaningless -- edges running over and under the road instead of stopping
   * at it.
   *
   * Needed because the engine reports a gap's outer rim and stops there. It
   * tells a gap from an outline by which side the neighbouring faces lie on,
   * so a face sitting alone in the middle of a hole -- a road left standing
   * in the ground a cut removed around it -- reads as an outline, correctly,
   * and is never reported as something to fill. Mending the outer rim alone
   * therefore lays ground straight over it: the two banks joined across the
   * top of the road rather than stopping at its contour.
   */
  readonly islands?: readonly (readonly ConstructionRegionEdge[])[];
}

/**
 * What to make a gap out of: whatever most of the faces around it are made
 * of, falling back to `fallback` when it has no neighbours to copy.
 *
 * Filling with a *chosen* type instead is what leaves a mended gap a
 * different colour from the ground it sits in -- paint grass, pass over an
 * older slate patch to close a hole in it, and the patch comes back with a
 * green tile in the middle. Ground is never retyped just by being passed
 * over, so a gap inside that ground must not be retyped either. A gap inside
 * ground of one type has that type on every side anyway, so the two cases
 * agree.
 */
export function matchTheGroundAround(
  neighbours: readonly { readonly surfaceType: string; readonly physical: boolean }[],
  fallback: string,
): { readonly surfaceType: string; readonly physical: boolean } {
  const tally = new Map<string, { count: number; physical: number }>();
  for (const neighbour of neighbours) {
    const entry = tally.get(neighbour.surfaceType) ?? { count: 0, physical: 0 };
    entry.count += 1;
    if (neighbour.physical) entry.physical += 1;
    tally.set(neighbour.surfaceType, entry);
  }
  let best: { surfaceType: string; count: number; physical: number } | undefined;
  for (const [surfaceType, entry] of tally) {
    if (best === undefined || entry.count > best.count) best = { surfaceType, ...entry };
  }
  if (best === undefined) return { surfaceType: fallback, physical: true };
  // Physical wins a tie: a gap left walk-through in the middle of solid
  // ground is a worse wrong answer than a solid tile in a decorative patch.
  return { surfaceType: best.surfaceType, physical: best.physical * 2 >= best.count };
}

/** Twice a ring's signed area in XZ -- only its sign is ever read here, to compare one ring's winding with another's. */
function signedArea(ring: readonly ConstructionPosition[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[(index + 1) % ring.length]!;
    total += from.x * to.z - to.x * from.z;
  }
  return total;
}

/** Whether `point` lies inside `ring`, by the even-odd rule -- what keeps an island belonging to some other gap out of this one. */
function containsPoint(ring: readonly ConstructionPosition[], point: ConstructionPosition): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!;
    const b = ring[previous]!;
    const straddles = a.z > point.z !== b.z > point.z;
    if (straddles && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The key a walked pair is looked up by -- `~>` cannot occur in a node id, which `sharedEdgeId` already relies on. */
function walkKey(from: ConstructionNodeId, to: ConstructionNodeId): string {
  return `${from}~>${to}`;
}

/**
 * Cuts one gap into triangles over its own rim, opened around whatever
 * stands inside it, instead of covering it with a single face.
 *
 * The rim is never re-derived, which is what makes this safe where every
 * generated fill before it was not:
 *
 * - the corners are nodes already standing on the rim, so no vertex is
 *   invented and nothing can weld wrongly or float;
 * - a triangle edge running along the rim reuses **the engine's own edge id
 *   and direction**, taken from `loop.boundary` rather than derived --
 *   deriving it would mint a second edge beside a real one whose id was never
 *   a function of its endpoints (an edge left behind by splitting one, say),
 *   which is a seam that looks joined and is not;
 * - an island's edges are reused the same way but walked the other way round:
 *   the island already holds one side of each, so the mesh takes the other;
 * - only edges strictly *inside* the gap are new, and those are free on both
 *   sides by construction, so nothing can refuse them.
 *
 * A triangle is dropped only when it carries no ground at all -- three points
 * on one line, which `earcut` can emit where a rim doubles back.
 */
function tessellate(
  loop: ConstructionUnfilledLoop,
  positionOf: (id: ConstructionNodeId) => ConstructionPosition | undefined,
  tableId: string,
  surface: { readonly surfaceType: string; readonly physical: boolean },
  islands: readonly (readonly ConstructionRegionEdge[])[],
): { readonly regions: readonly ConstructionPatchRegion[]; readonly edges: readonly ConstructionPatchEdge[] } | undefined {
  if (loop.boundary.length !== loop.nodeIds.length) return undefined;

  const outer = loop.nodeIds.map(positionOf);
  if (outer.some((point) => point === undefined)) return undefined;
  const outerRing = outer as readonly ConstructionPosition[];

  // Keyed by the pair each edge runs between *in the direction this face will
  // walk it*. `loop.boundary[i]` is already that: the engine reports each
  // free edge oriented for whoever fills the gap.
  const walked = new Map<string, ConstructionOrientedEdgeUse>();
  for (let index = 0; index < loop.nodeIds.length; index += 1) {
    walked.set(walkKey(loop.nodeIds[index]!, loop.nodeIds[(index + 1) % loop.nodeIds.length]!), loop.boundary[index]!);
  }

  const ids: ConstructionNodeId[] = [...loop.nodeIds];
  const points: ConstructionPosition[] = [...outerRing];
  const holeStarts: number[] = [];
  for (const island of islands) {
    if (island.length < 3) continue;
    const ring = island.map((edge) => positionOf(edge.startNodeId));
    if (ring.some((point) => point === undefined)) continue;
    if (!containsPoint(outerRing, ring[0]!)) continue;
    // An opening is walked the opposite way round to the rim enclosing it --
    // that is what "opposite sides of the same ground" means once it reaches
    // winding. An island whose own required direction runs the same way as
    // the rim cannot be opened around with any single winding: the graph
    // disagrees with itself about which side of it is free, and quietly
    // triangulating anyway is what puts edges over and under it. Left out
    // instead, so the gap falls back to a whole-rim mend that at least joins.
    if (signedArea(ring as readonly ConstructionPosition[]) > 0 === signedArea(outerRing) > 0) continue;

    holeStarts.push(ids.length);
    for (let index = 0; index < island.length; index += 1) {
      ids.push(island[index]!.startNodeId);
      points.push(ring[index]!);
    }
    // Already oriented for this mend, exactly like `loop.boundary` -- the
    // island holds one side of each of its edges and hands over the other.
    for (const edge of island) {
      walked.set(walkKey(edge.startNodeId, edge.endNodeId), { edgeId: edge.edgeId, reversed: edge.reversed });
    }
  }

  if (ids.length < 4) return undefined;
  const coordinates: number[] = [];
  for (const point of points) coordinates.push(point.x, point.z);
  const indices = earcut(coordinates, holeStarts);
  if (indices.length < 3) return undefined;

  // The outer ring's own signed area fixes which way a face here is wound;
  // every triangle is normalised to it, so a rim segment is always walked the
  // way the engine said and an opening the way its owner left free.
  const ringArea = signedArea(outerRing);

  const edges = new Map<ConstructionEdgeId, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
    let corners = [indices[cursor]!, indices[cursor + 1]!, indices[cursor + 2]!];
    const [pa, pb, pc] = [points[corners[0]!]!, points[corners[1]!]!, points[corners[2]!]!];
    const signed = (pb.x - pa.x) * (pc.z - pa.z) - (pc.x - pa.x) * (pb.z - pa.z);
    if (signed === 0) continue;
    if (signed > 0 !== ringArea > 0) corners = [corners[0]!, corners[2]!, corners[1]!];

    const boundary = corners.map((corner, index) => {
      const from = ids[corner]!;
      const to = ids[corners[(index + 1) % corners.length]!]!;
      const existing = walked.get(walkKey(from, to));
      if (existing !== undefined) return existing;

      const forward = from < to;
      const edgeId: ConstructionEdgeId = forward ? `${tableId}:seg:${from}~${to}` : `${tableId}:seg:${to}~${from}`;
      if (!edges.has(edgeId)) {
        edges.set(edgeId, { edgeId, startNodeId: forward ? from : to, endNodeId: forward ? to : from });
      }
      return { edgeId, reversed: !forward };
    });

    regions.push({ regionId: corners.map((corner) => ids[corner]!).join("|"), boundary, ...surface });
  }

  return regions.length === 0 ? undefined : { regions, edges: [...edges.values()] };
}

/**
 * Fills every closed loop of free boundary within `scope` -- see
 * {@link UnfilledLoopFillRuntime} for why this is the whole algorithm, and
 * {@link FillUnfilledLoopsOptions} for the two ways a large gap differs from
 * a one-cell one.
 *
 * Returns how many faces actually landed, not how many gaps were found: a
 * face the engine then refuses costs itself and nothing else.
 */
export function fillUnfilledLoops(
  runtime: UnfilledLoopFillRuntime,
  scope: readonly ConstructionNodeId[],
  fallbackSurfaceType: string,
  causeId: string,
  options: FillUnfilledLoopsOptions = {},
): number {
  const loops = runtime.getUnfilledLoops(scope);
  if (loops.length === 0) return 0;

  const snapshot = options.mesh === true ? runtime.getSnapshot?.() : undefined;
  const positionOf = (id: ConstructionNodeId): ConstructionPosition | undefined =>
    snapshot?.map.nodePositions.get(id)?.position;

  const regions: ConstructionPatchRegion[] = [];
  const edges: ConstructionPatchEdge[] = [];
  for (const loop of loops) {
    const surface = matchTheGroundAround(loop.neighbours, fallbackSurfaceType);
    const meshed =
      snapshot === undefined
        ? undefined
        : tessellate(loop, positionOf, snapshot.tableId, surface, options.islands ?? []);
    if (meshed !== undefined) {
      regions.push(...meshed.regions);
      edges.push(...meshed.edges);
      continue;
    }
    // Whole-rim fill, and the fallback wherever a mesh cannot be cut: one
    // face over ground that is joined beats no ground at all.
    regions.push({ regionId: loop.nodeIds.join("|"), boundary: loop.boundary, ...surface });
  }

  const outcome = runtime.addPatch({ nodes: [], edges, regions }, "local", causeId);
  return outcome.createdSurfaceKeys.length;
}
