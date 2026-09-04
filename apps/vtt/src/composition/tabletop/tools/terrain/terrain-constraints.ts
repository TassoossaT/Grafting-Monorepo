import type { AtomicEditOp } from "@/features/edit-construction";
import type {
  ConstructionEdgeId,
  ConstructionGridConstraintPoint,
  ConstructionGridContourNode,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. The type-only
// `@/` imports above are fine -- those are erased.
import { outwardPerimeterRings, sharedEdgeId } from "../../../../features/edit-construction/index.ts";

/**
 * Turning the live graph into constraints for the grid generator, and turning
 * what it hands back into edges the neighbour actually adopts.
 *
 * Both halves exist to keep one promise: **no position is ever matched back to
 * a node or an edge**. A ring goes down carrying the node id of every corner,
 * and a node that comes back on that ring names the segment it landed on, so
 * the edge to split is known by identity rather than found by proximity. That
 * guess is what the weld this replaces did, and what minted a second node on
 * top of a real one.
 */

/** A ring of constraint points, together with the graph edges it was built from. */
export interface ConstraintRing {
  /** What the generator receives. */
  readonly points: readonly ConstructionGridConstraintPoint[];
  /**
   * The edge each segment of `points` runs along, index-aligned: `edges[i]`
   * spans `points[i]` to `points[i + 1]`, wrapping.
   *
   * A segment may own no edge, and that is a real state rather than an error:
   * the stroke's own outline is nobody's boundary until this stroke registers
   * it, and the rim of a hole left by a cut can run through a node the
   * deletion took with it. Either way there is nothing to split there, so a
   * node landing on that segment is declared as ordinary new geometry.
   */
  readonly edges: readonly (ConstructionRegionEdge | undefined)[];
}

/** The node ids a set of rings referred to, by the index they were given. */
export interface ConstraintTable {
  readonly rings: readonly ConstraintRing[];
  /** `sources[i]` is the node id handed out as `source: i`. */
  readonly sources: readonly ConstructionNodeId[];
}

/**
 * The outward perimeter of everything already standing, as rings whose every
 * corner carries the real node id sitting there.
 *
 * One ring per *cloud* of touching faces, never one per face: the faces of an
 * established patch of ground share edges, so handing over each face's own
 * boundary describes a shape overlapping itself along every shared edge.
 * {@link outwardPerimeterRings} already resolves that.
 */
export function perimeterConstraints(
  topologies: readonly ConstructionRegionTopology[],
  startingIndex: number,
): ConstraintTable {
  const positions = new Map<ConstructionNodeId, { x: number; z: number }>();
  for (const topology of topologies) {
    for (const node of topology.nodes) positions.set(node.id, { x: node.position.x, z: node.position.z });
  }
  return constraintsFromRings(outwardPerimeterRings(topologies), (nodeId) => positions.get(nodeId), startingIndex);
}

/**
 * The same thing one step lower: rings of oriented edges, already walked,
 * turned into constraint rings that carry a node id per corner.
 *
 * Separate from {@link perimeterConstraints} because a cut's repair holds its
 * rings before it holds any topology to read them from -- it walks the
 * perimeter of the faces it is about to delete, and asks the graph for the
 * positions afterwards. Both callers must be able to share one numbering, so
 * `startingIndex` is where this table's `source` values begin.
 *
 * A corner whose position cannot be found leaves the ring unusable and the
 * ring is dropped: keeping it would put a constraint through a point nobody
 * stands at, which is worse than losing the seam it would have met.
 */
export function constraintsFromRings(
  rings: readonly (readonly ConstructionRegionEdge[])[],
  positionOf: (nodeId: ConstructionNodeId) => { readonly x: number; readonly z: number } | undefined,
  startingIndex: number,
): ConstraintTable {
  const sources: ConstructionNodeId[] = [];
  const index = new Map<ConstructionNodeId, number>();
  const claim = (nodeId: ConstructionNodeId): number => {
    const already = index.get(nodeId);
    if (already !== undefined) return already;
    const next = startingIndex + sources.length;
    sources.push(nodeId);
    index.set(nodeId, next);
    return next;
  };

  const built: ConstraintRing[] = [];
  for (const ring of rings) {
    const points: ConstructionGridConstraintPoint[] = [];
    let complete = true;
    for (const edge of ring) {
      const position = positionOf(edge.startNodeId);
      if (position === undefined) {
        complete = false;
        break;
      }
      points.push({ x: position.x, z: position.z, source: claim(edge.startNodeId) });
    }
    if (complete && points.length >= 3) built.push({ points, edges: ring });
  }

  return { rings: built, sources };
}

/**
 * A stroke's own swept outline: real ground to fill, owned by nobody yet.
 *
 * **Handed over whole, and an attempt to simplify it was reverted.** The cells
 * do bunch at the round ends of a stroke, and the cap segments there are a
 * fraction of a face long, so coarsening the outline looked like the fix.
 * Ramer-Douglas-Peucker at 0.3 of the face size made it measurably worse: 279
 * faces of 0.70 where the unsimplified outline gave 215 of 1.02, and the
 * ground generated shrank from 224 square units to 137.
 *
 * The reason is that RDP cuts corners *globally*. A real drag wobbles, so its
 * swept outline is full of shallow concavities, and a chord drawn across one
 * of them leaves the ring self-intersecting. The generator then splits every
 * crossing, fills the slivers, and classifies part of the interior as outside.
 * Any future attempt has to preserve the ring's simplicity -- a local
 * collinearity test, or a simplification checked for self-intersection and
 * dropped when it fails -- and not merely its shape within a tolerance.
 *
 * **Welding coincident points is not that, and is done here.** `weld` drops a
 * point only when it sits nearer than the tolerance to the point before it, and
 * moves nothing. It cannot cut a corner wider than the tolerance and so cannot
 * introduce a crossing the way a chord across a concavity does. It exists
 * because the union of the brush's capsules leaves near-duplicate points where
 * two capsules meet, and a segment a hundredth of a face long forces the
 * triangulation into slivers exactly the way a split fragment does.
 */
export function outlineConstraints(
  rings: readonly (readonly (readonly [number, number])[])[],
  /** Consecutive points nearer than this collapse to one. `0` welds nothing. */
  weld = 0,
): readonly ConstraintRing[] {
  const weldSq = weld * weld;
  return rings
    .map((ring) => {
      // `polygon-clipping` closes a ring by repeating its first point as its
      // last; a constraint ring closes implicitly, so the repeat would be a
      // zero-length segment.
      const open =
        ring.length > 1 &&
        ring[0]![0] === ring[ring.length - 1]![0] &&
        ring[0]![1] === ring[ring.length - 1]![1]
          ? ring.slice(0, -1)
          : ring;

      const points: { x: number; z: number }[] = [];
      for (const [x, z] of open) {
        const previous = points[points.length - 1];
        if (previous !== undefined) {
          const dx = x - previous.x;
          const dz = z - previous.z;
          if (dx * dx + dz * dz < weldSq) continue;
        }
        points.push({ x, z });
      }
      // The ring closes on its first point, so the last segment is subject to
      // the same rule -- and dropping the first would renumber every segment
      // the generator reports back, so the last goes instead.
      while (points.length >= 3) {
        const last = points[points.length - 1]!;
        const first = points[0]!;
        const dx = last.x - first.x;
        const dz = last.z - first.z;
        if (dx * dx + dz * dz >= weldSq) break;
        points.pop();
      }

      return { points, edges: [] as readonly ConstructionRegionEdge[] };
    })
    .filter((ring) => ring.points.length >= 3);
}

/** One node to be adopted, resolved to the edge it splits. */
export interface ContourAdoption {
  readonly vertex: number;
  readonly edge: ConstructionRegionEdge;
  /** Where along that edge it sits, `0` at its start and `1` at its end. */
  readonly along: number;
}

/** One generated corner that resolves to a node already standing, rather than splitting anything. */
export interface ContourSnap {
  readonly vertex: number;
  /** The `source` index of the ring corner it takes the identity of. */
  readonly source: number;
}

export interface ResolvedAdoptions {
  readonly adoptions: readonly ContourAdoption[];
  readonly snaps: readonly ContourSnap[];
}

/**
 * The shortest piece of an edge worth keeping, as a fraction of the face size.
 *
 * **This is the number that was missing, and its absence is what degraded the
 * mesh over strokes.** A split used to be accepted anywhere strictly inside an
 * edge, so a corner landing half a percent from an end left a fragment a
 * hundredth of a face long -- permanently, as a real edge in the graph. The
 * next stroke reads that fragment as a constraint, the triangulation has to
 * honour it, and it comes back as a cluster of slivers whose winding is
 * numerically ambiguous; then the ortho step midpoints it and the piece halves
 * again. Measured on the table: a first stroke's contour had no segment under
 * 1.98, and the second stroke, reading that stroke's own mesh, found one of
 * 0.01 and lost 76 faces to "no room on edge".
 *
 * Below this, the corner takes the identity of the end it is near instead. The
 * cell moves by at most this much -- a nudge on the scale the relax step
 * already applies -- and no edge shorter than this can ever enter the graph.
 */
export const SHORTEST_USEFUL_FRACTION = 0.2;

/**
 * How coarsely a stroke describes its own swept outline, as a multiple of the
 * face size.
 *
 * **This is what decides how many faces a stroke costs.** A patch comes back
 * with about twice as many faces as its boundary has points, so describing the
 * outline finely does not buy a finer *shape* -- it buys a finer *mesh*, which
 * is the opposite of what the caller asked for. Measured on the capsule the
 * brush actually hands over, 30 long and 6 across, asking for faces of 2:
 *
 * | chord | outline points | faces | mean side |
 * |-------|----------------|-------|-----------|
 * | 0.5x  | 98             | 312   | 1.27      |
 * | 1x    | 50             | 308   | 1.28      |
 * | 2x    | 26             | 120   | 2.04      |
 * | 3x    | 18             | 104   | 2.20      |
 *
 * Below 1x the extra points are pure waste -- 98 of them give the same mesh
 * 50 do. At 2x the mesh finally comes back the size it was asked for, with two
 * and a half times fewer faces. Pinned in the engine's own tests as
 * `an_outline_described_at_twice_the_face_size_gives_the_size_asked_for`.
 */
export const OUTLINE_CHORD_PER_FACE = 2;

/**
 * Resolves each reported contour node either to the graph edge it splits or to
 * a node already standing that it is too close to be distinct from.
 *
 * Nodes on a segment that owns no edge -- the stroke's own outline -- can still
 * snap, because a corner of that outline may land on top of a node the ring
 * carries; there is simply nothing there to split.
 *
 * Adoptions are sorted along each edge, because several nodes routinely land on
 * one. The triangulation may already have split a supplied segment before
 * quadrangulation put a midpoint on each of the pieces, so an edge of the
 * neighbour can owe two or three nodes, and they have to be inserted in the
 * order they sit -- each split shortens what is left to split.
 */
export function resolveAdoptions(
  holeRings: readonly ConstraintRing[],
  boundaryRings: readonly ConstraintRing[],
  reported: readonly ConstructionGridContourNode[],
  positionOf: (vertex: number) => { readonly x: number; readonly z: number } | undefined,
  /** Fragments shorter than this are not created; see {@link SHORTEST_USEFUL_FRACTION}. */
  shortestUseful = 0,
): ResolvedAdoptions {
  const adoptions: ContourAdoption[] = [];
  const snaps: ContourSnap[] = [];
  for (const node of reported) {
    const rings = node.ringKind === "hole" ? holeRings : boundaryRings;
    const ring = rings[node.ring];
    const from = ring?.points[node.segment];
    const to = ring?.points[(node.segment + 1) % (ring?.points.length ?? 1)];
    const point = positionOf(node.vertex);
    if (ring === undefined || from === undefined || to === undefined || point === undefined) continue;

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 0) continue;
    const along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq;
    // Exactly the ends are the corners themselves, which are already shared
    // nodes and have nothing to split.
    if (!(along > 1e-9 && along < 1 - 1e-9)) continue;

    // Too near an end to be a corner of its own. Take that end's identity --
    // whether or not this segment owns an edge, because the damage a sliver
    // does is done by the geometry, not by the split.
    const length = Math.sqrt(lengthSq);
    if (along * length < shortestUseful && from.source !== undefined) {
      snaps.push({ vertex: node.vertex, source: from.source });
      continue;
    }
    if ((1 - along) * length < shortestUseful && to.source !== undefined) {
      snaps.push({ vertex: node.vertex, source: to.source });
      continue;
    }

    const edge = ring.edges[node.segment];
    if (edge === undefined) continue;
    adoptions.push({ vertex: node.vertex, edge, along });
  }

  adoptions.sort((a, b) => (a.edge.edgeId === b.edge.edgeId ? a.along - b.along : a.edge.edgeId < b.edge.edgeId ? -1 : 1));
  return { adoptions, snaps };
}

/**
 * What {@link adoptContourNodes} needs of the runtime.
 *
 * The atomic op rather than the port call directly, so a split goes through
 * the same transaction and render-sync path every other edit does. A node
 * appearing on a live edge changes the mesh of the face that owns it, and a
 * split that skipped that fold would leave the neighbour drawn with its old
 * boundary.
 */
export interface AdoptionRuntime {
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
}

/**
 * Splits every neighbour edge that owes a node, so the ground about to be
 * registered shares real edges with what was already there.
 *
 * This is the decision recorded on this task made real: the cloud owning a
 * contour accepts the nodes the grid puts along it. Skipping it would leave
 * the new ground touching the old at a point without sharing the edge through
 * it -- a T-junction, which is a seam that looks joined, renders as a crack,
 * and is exactly the "gap along the path" the mend before this could never
 * close.
 *
 * Each split replaces one edge with two, so a second node on the same edge has
 * to split whichever fragment now contains it. Tracked by parameter rather
 * than re-queried: `along` is exact and monotonic within an edge, so the tail
 * fragment is always the one to split next.
 *
 * Fail-soft per node, and the refusals are named rather than counted: a node
 * whose edge would not split still has to exist for the face that references
 * it, so the caller declares it as ordinary new geometry instead. That costs
 * one T-junction; dropping it would cost the face.
 */
export function adoptContourNodes(
  runtime: AdoptionRuntime,
  /** Which table the edges belong to; the pair, not this, is what names them. */
  tableId: string,
  causeId: string,
  adoptions: readonly ContourAdoption[],
  nodeIdFor: (vertex: number) => ConstructionNodeId,
  positionOf: (vertex: number) => ConstructionPosition | undefined,
): { readonly adopted: ReadonlySet<number>; readonly refused: readonly number[] } {
  const adopted = new Set<number>();
  const refused: number[] = [];
  // The fragment still to be split, per original edge, and where along the
  // original edge that fragment starts.
  const tail = new Map<ConstructionEdgeId, { edgeId: ConstructionEdgeId; startNodeId: ConstructionNodeId }>();

  for (const adoption of adoptions) {
    const position = positionOf(adoption.vertex);
    if (position === undefined) {
      refused.push(adoption.vertex);
      continue;
    }
    const fragment = tail.get(adoption.edge.edgeId);
    const edgeId = fragment?.edgeId ?? adoption.edge.edgeId;
    const from = fragment?.startNodeId ?? adoption.edge.startNodeId;
    const nodeId = nodeIdFor(adoption.vertex);
    // Named by the pair, through the one rule every edge in the graph is
    // named by. Minting a name of this splitting's own would mean a face
    // declared later over the same two nodes derives the shared name, finds
    // nothing, and creates a second edge coincident with this one -- two
    // edges used once each where there should be one used twice, which looks
    // joined and is not.
    const firstEdgeId = sharedEdgeId(tableId, from, nodeId);
    const secondEdgeId = sharedEdgeId(tableId, nodeId, adoption.edge.endNodeId);
    try {
      runtime.applyRegionEdit(
        [
          {
            kind: "insert-vertex",
            edgeId,
            nodeId,
            position,
            firstEdgeId,
            secondEdgeId,
          },
        ],
        "local",
        causeId,
      );
      // The next node on this edge sits further along, so it falls in the
      // second fragment, which now runs from the node just inserted.
      tail.set(adoption.edge.edgeId, { edgeId: secondEdgeId, startNodeId: nodeId });
      adopted.add(adoption.vertex);
    } catch {
      refused.push(adoption.vertex);
    }
  }

  return { adopted, refused };
}
