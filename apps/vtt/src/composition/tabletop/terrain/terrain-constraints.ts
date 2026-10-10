import type { AtomicEditOp } from "@/features/edit-construction";
import type {
  ConstructionEdgeId,
  ConstructionGridConstraintPoint,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. The type-only
// `@/` imports above are fine -- those are erased.
import { sharedEdgeId } from "../../../features/edit-construction/index.ts";
import { countInCommit } from "../commit-timing.ts";

/**
 * The rings a structure's outline is met along, and the splits that make the
 * ground share a neighbour's edge where one of its corners landed on it.
 *
 * **No position is ever matched back to a node or an edge**: a ring carries
 * the node id of every corner and the edge every side runs along, and a
 * corner landing on a side is split into that very edge.
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

/** One node to be adopted, resolved to the edge it splits. */
export interface ContourAdoption {
  readonly vertex: number;
  readonly edge: ConstructionRegionEdge;
  /** Where along that edge it sits, `0` at its start and `1` at its end. */
  readonly along: number;
  /** Length of the edge being split, for spacing checks. */
  readonly edgeLength?: number;
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
export const SHORTEST_USEFUL_FRACTION = 0.25;

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
  const planned: { readonly vertex: number; readonly op: AtomicEditOp }[] = [];

  // **Everything below runs in the edge's own stored direction, never the
  // ring's.**
  //
  // `insert_vertex` splits by what the edge stores: the first fragment runs
  // from `start_node` to the new node, the second from the new node to
  // `end_node`. It takes the two names on trust and applies them in that
  // order.
  //
  // The ring hands its edges over pointing the other way. `outwardPerimeterRings`
  // flips them deliberately -- the free side of a boundary runs opposite the
  // face that owns it -- so `startNodeId` there is the *free-side* walk, and
  // for every edge whose owning face walks it forwards that is the reverse of
  // what the graph stores.
  //
  // Naming the fragments from the ring's direction therefore put the two names
  // on the wrong halves, and an edge whose id names a pair it does not connect
  // is a contradiction the graph carries silently until something walks it:
  // "expected next edge to start at X, found Y" on one face, and an arbitrary
  // "no room on edge" on its neighbour. Half the seam, since it depends on
  // which way round each edge happened to be minted.
  //
  // The `reversed` flag is what recovers the stored direction: false means the
  // walk agrees with it, so `startNodeId` is the stored start.
  const storedEndsOf = (edge: ContourAdoption["edge"]) =>
    edge.reversed
      ? { start: edge.endNodeId, end: edge.startNodeId }
      : { start: edge.startNodeId, end: edge.endNodeId };

  // Grouped per original edge, and ordered along the stored direction rather
  // than the ring's, so "the fragment still to be split" is always the one
  // running to the stored end.
  const perEdge = new Map<
    ConstructionEdgeId,
    { readonly edge: ContourAdoption["edge"]; readonly entries: { vertex: number; alongStored: number }[] }
  >();
  for (const adoption of adoptions) {
    if (positionOf(adoption.vertex) === undefined) {
      refused.push(adoption.vertex);
      continue;
    }
    const group = perEdge.get(adoption.edge.edgeId) ?? { edge: adoption.edge, entries: [] };
    perEdge.set(adoption.edge.edgeId, group);
    group.entries.push({
      vertex: adoption.vertex,
      alongStored: adoption.edge.reversed ? 1 - adoption.along : adoption.along,
    });
  }

  for (const group of perEdge.values()) {
    const { start, end } = storedEndsOf(group.edge);
    let edgeId = group.edge.edgeId;
    let from = start;
    for (const entry of [...group.entries].sort((a, b) => a.alongStored - b.alongStored)) {
      const position = positionOf(entry.vertex);
      if (position === undefined) continue;
      const nodeId = nodeIdFor(entry.vertex);
      // Named by the pair, through the one rule every edge in the graph is
      // named by. Minting a name of this splitting's own would mean a face
      // declared later over the same two nodes derives the shared name, finds
      // nothing, and creates a second edge coincident with this one -- two
      // edges used once each where there should be one used twice, which looks
      // joined and is not.
      const firstEdgeId = sharedEdgeId(tableId, from, nodeId);
      const secondEdgeId = sharedEdgeId(tableId, nodeId, end);
      planned.push({
        vertex: entry.vertex,
        op: { kind: "insert-vertex", edgeId, nodeId, position, firstEdgeId, secondEdgeId },
      });
      // The next node sits further along the stored direction, so it falls in
      // the second fragment, which now runs from the node just inserted.
      // Bookkeeping this side owns entirely -- it never had to wait for an
      // answer, which is what makes one transaction for the lot possible.
      edgeId = secondEdgeId;
      from = nodeId;
    }
  }

  if (planned.length === 0) return { adopted, refused };

  // **One transaction, and one fold of the render, for every split.**
  //
  // A stroke adopts a node per point where the new mesh meets the old, which
  // on a merge is well over a hundred. Sent one at a time that is a hundred
  // separate commits, each paying the whole cost of syncing what is drawn --
  // for a set of edits that was decided in full before the first was sent.
  //
  // The fallback is not caution for its own sake. A batch is all-or-nothing,
  // so one op the engine will not take costs every other node its seam;
  // applied one by one, it costs only itself. Fast when nothing is wrong,
  // exactly as forgiving as before when something is.
  try {
    runtime.applyRegionEdit(planned.map((entry) => entry.op), "local", causeId);
    for (const entry of planned) adopted.add(entry.vertex);
    return { adopted, refused };
  } catch {
    // Fall through and pay per node, so one refusal loses one node.
    countInCommit("splits refeitos um a um (lote recusado)", planned.length);
  }

  for (const entry of planned) {
    try {
      runtime.applyRegionEdit([entry.op], "local", causeId);
      adopted.add(entry.vertex);
    } catch {
      refused.push(entry.vertex);
    }
  }

  return { adopted, refused };
}
