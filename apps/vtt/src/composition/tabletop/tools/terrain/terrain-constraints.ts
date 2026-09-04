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
import { outwardPerimeterRings } from "../../../../features/edit-construction/index.ts";

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

/** A stroke's own swept outline: real ground to fill, owned by nobody yet. */
export function outlineConstraints(
  rings: readonly (readonly (readonly [number, number])[])[],
): readonly ConstraintRing[] {
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
      return {
        points: open.map(([x, z]) => ({ x, z })),
        edges: [] as readonly ConstructionRegionEdge[],
      };
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

/**
 * Resolves each reported contour node to the graph edge it landed on.
 *
 * Nodes on a ring that has no edges -- the stroke's own outline -- are left
 * out: there is nothing to split, because nothing owns that boundary yet.
 *
 * Sorted along each edge, because several nodes routinely land on one. The
 * triangulation may already have split a supplied segment before
 * quadrangulation put a midpoint on each of the pieces, so an edge of the
 * neighbour can owe two or three nodes, and they have to be inserted in the
 * order they sit -- each split shortens what is left to split.
 */
export function resolveAdoptions(
  holeRings: readonly ConstraintRing[],
  boundaryRings: readonly ConstraintRing[],
  reported: readonly ConstructionGridContourNode[],
  positionOf: (vertex: number) => { readonly x: number; readonly z: number } | undefined,
): readonly ContourAdoption[] {
  const adoptions: ContourAdoption[] = [];
  for (const node of reported) {
    const rings = node.ringKind === "hole" ? holeRings : boundaryRings;
    const ring = rings[node.ring];
    const edge = ring?.edges[node.segment];
    const from = ring?.points[node.segment];
    const to = ring?.points[(node.segment + 1) % (ring?.points.length ?? 1)];
    const point = positionOf(node.vertex);
    if (edge === undefined || from === undefined || to === undefined || point === undefined) continue;

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 0) continue;
    const along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq;
    // Exactly the ends are the corners themselves, which are already shared
    // nodes and have nothing to split.
    if (!(along > 1e-9 && along < 1 - 1e-9)) continue;

    adoptions.push({ vertex: node.vertex, edge, along });
  }

  adoptions.sort((a, b) => (a.edge.edgeId === b.edge.edgeId ? a.along - b.along : a.edge.edgeId < b.edge.edgeId ? -1 : 1));
  return adoptions;
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
  /** Prefix every edge this splitting mints is named under -- unique per fill. */
  mint: string,
  causeId: string,
  adoptions: readonly ContourAdoption[],
  nodeIdFor: (vertex: number) => ConstructionNodeId,
  positionOf: (vertex: number) => ConstructionPosition | undefined,
): { readonly adopted: ReadonlySet<number>; readonly refused: readonly number[] } {
  const adopted = new Set<number>();
  const refused: number[] = [];
  // The fragment still to be split, per original edge, and where along the
  // original edge that fragment starts.
  const tail = new Map<ConstructionEdgeId, ConstructionEdgeId>();
  let minted = 0;

  for (const adoption of adoptions) {
    const position = positionOf(adoption.vertex);
    if (position === undefined) {
      refused.push(adoption.vertex);
      continue;
    }
    const edgeId = tail.get(adoption.edge.edgeId) ?? adoption.edge.edgeId;
    const firstEdgeId: ConstructionEdgeId = `${mint}:adopt-${minted}a`;
    const secondEdgeId: ConstructionEdgeId = `${mint}:adopt-${minted}b`;
    minted += 1;
    try {
      runtime.applyRegionEdit(
        [
          {
            kind: "insert-vertex",
            edgeId,
            nodeId: nodeIdFor(adoption.vertex),
            position,
            firstEdgeId,
            secondEdgeId,
          },
        ],
        "local",
        causeId,
      );
      // The next node on this edge sits further along, so it falls in the
      // second fragment.
      tail.set(adoption.edge.edgeId, secondEdgeId);
      adopted.add(adoption.vertex);
    } catch {
      refused.push(adoption.vertex);
    }
  }

  return { adopted, refused };
}
