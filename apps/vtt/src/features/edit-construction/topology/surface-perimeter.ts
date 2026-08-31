import type { ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";

/**
 * The perimeter of a set of faces: what is left when everything interior is
 * taken away.
 *
 * There is exactly one definition and it is not about shape. **An edge with a
 * face on both sides is interior; an edge with a face on one side is
 * perimeter.** Nothing else -- not which slot of a cross-section a node was
 * minted at, not how far it sits from a travel line, not what it looked like
 * when it was built.
 *
 * That matters because the obvious cheaper test is wrong in exactly the case
 * that counts. A road's rim used to be found by reading node addresses: the
 * chain of nodes at the outermost slot, in station order. Perfectly true of a
 * road standing on its own, and false the moment another road joins it --
 * those nodes keep their addresses while the stretch between them stops being
 * rim and becomes the mouth of the junction. Read by address it is still a
 * rim, and it draws as one: a line straight through the middle of the road.
 * Read by usage it is what it now is.
 *
 * So a perimeter is derived, never stored, and derived from the graph rather
 * than from the recipe that built it. It costs one pass over the faces.
 */

/** One closed run of perimeter, walked end to end. */
export interface PerimeterLoop {
  /** In walk order; one per step. */
  readonly edgeIds: readonly string[];
  /** In walk order, `nodeIds[i]` starting `edgeIds[i]`. */
  readonly nodeIds: readonly string[];
  readonly positions: readonly ConstructionPosition[];
  /** Whether the walk closed on itself, as a complete perimeter must. */
  readonly closed: boolean;
}

interface EdgeEnds {
  readonly startNodeId: string;
  readonly endNodeId: string;
}

/** How many faces each edge bounds, across the whole set. */
export function edgeUseCounts(
  topologies: readonly ConstructionRegionTopology[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const topology of topologies) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) counts.set(use.edgeId, (counts.get(use.edgeId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Every perimeter loop of `topologies`, as closed walks.
 *
 * Takes a whole set rather than one face, because the question is only
 * meaningful for a set: an edge is interior *to something*, and one face on
 * its own has nothing but perimeter. Hand it a cloud and it answers for the
 * cloud, which is the unit a junction actually changes.
 *
 * A node where three or more perimeter edges meet -- a pinch, where the
 * surface touches itself -- is walked by taking whichever edge has not been
 * walked yet. That yields loops that partition the perimeter rather than the
 * one canonical figure-of-eight, which is the right answer for drawing it and
 * an arbitrary one for reasoning about winding.
 */
export function perimeterOf(
  topologies: readonly ConstructionRegionTopology[],
): readonly PerimeterLoop[] {
  const counts = edgeUseCounts(topologies);
  const ends = new Map<string, EdgeEnds>();
  const positionOf = new Map<string, ConstructionPosition>();
  for (const topology of topologies) {
    for (const node of topology.nodes) positionOf.set(node.id, node.position);
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if (ends.has(use.edgeId)) continue;
        ends.set(use.edgeId, { startNodeId: use.startNodeId, endNodeId: use.endNodeId });
      }
    }
  }

  const rim = [...ends].filter(([edgeId]) => (counts.get(edgeId) ?? 0) === 1);
  const fromNode = new Map<string, string[]>();
  for (const [edgeId, edge] of rim) {
    for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
      const at = fromNode.get(nodeId) ?? [];
      fromNode.set(nodeId, at);
      at.push(edgeId);
    }
  }

  const walked = new Set<string>();
  const loops: PerimeterLoop[] = [];
  for (const [startEdgeId] of rim) {
    if (walked.has(startEdgeId)) continue;
    const edgeIds: string[] = [];
    const nodeIds: string[] = [];
    const first = ends.get(startEdgeId)!.startNodeId;
    let node = first;
    let edgeId: string | undefined = startEdgeId;
    while (edgeId !== undefined && !walked.has(edgeId)) {
      walked.add(edgeId);
      edgeIds.push(edgeId);
      nodeIds.push(node);
      const edge = ends.get(edgeId)!;
      node = edge.startNodeId === node ? edge.endNodeId : edge.startNodeId;
      edgeId = (fromNode.get(node) ?? []).find((candidate) => !walked.has(candidate));
    }
    loops.push({
      edgeIds,
      nodeIds,
      positions: nodeIds
        .map((nodeId) => positionOf.get(nodeId))
        .filter((position): position is ConstructionPosition => position !== undefined),
      closed: node === first,
    });
  }
  return loops;
}

/**
 * The same perimeter, as closed rings of edges **already oriented for
 * whatever stands on the other side** -- the outside.
 *
 * {@link perimeterOf} answers "where is the rim, and where does it run", for
 * drawing it. This answers "how would a face meeting this rim have to walk
 * it", which is a different question with a strict answer: a perimeter edge
 * has one face on it already, so its one free side is the other one, and a
 * face walking it the same way as the face already there is refused.
 *
 * Derived per edge from the use the set itself makes of it, never from the
 * ring's own walk direction -- which is arbitrary, since a walk may be
 * assembled either way round. Each step is therefore reversed relative to the
 * set's own use, and the ring is chained by those directions rather than
 * re-walked.
 *
 * Taking the whole set at once is the point: the perimeter of a cloud of
 * touching faces is one ring around all of them, and the individual faces'
 * own boundaries are not it. Handing those over one by one instead describes
 * a shape that overlaps itself along every edge two of them share.
 */
export function outwardPerimeterRings(
  topologies: readonly ConstructionRegionTopology[],
): readonly (readonly ConstructionRegionEdge[])[] {
  const counts = edgeUseCounts(topologies);
  const outward = new Map<string, ConstructionRegionEdge>();
  for (const topology of topologies) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if ((counts.get(use.edgeId) ?? 0) !== 1 || outward.has(use.edgeId)) continue;
        // `startNodeId`/`endNodeId` are already this face's own walk
        // direction, so the free side runs the other way.
        outward.set(use.edgeId, {
          edgeId: use.edgeId,
          reversed: !use.reversed,
          startNodeId: use.endNodeId,
          endNodeId: use.startNodeId,
          geometry: use.geometry,
        });
      }
    }
  }

  const startingAt = new Map<string, ConstructionRegionEdge[]>();
  for (const edge of outward.values()) {
    const at = startingAt.get(edge.startNodeId) ?? [];
    startingAt.set(edge.startNodeId, at);
    at.push(edge);
  }

  const walked = new Set<string>();
  const rings: (readonly ConstructionRegionEdge[])[] = [];
  for (const seed of outward.values()) {
    if (walked.has(seed.edgeId)) continue;
    const ring: ConstructionRegionEdge[] = [];
    let step: ConstructionRegionEdge | undefined = seed;
    while (step !== undefined && !walked.has(step.edgeId)) {
      walked.add(step.edgeId);
      ring.push(step);
      step = (startingAt.get(step.endNodeId) ?? []).find((candidate) => !walked.has(candidate.edgeId));
    }
    // Only a ring that closed on itself bounds anything. An open chain is a
    // perimeter running off the edge of the set it was derived from.
    if (ring.length >= 3 && ring[ring.length - 1]!.endNodeId === ring[0]!.startNodeId) rings.push(ring);
  }
  return rings;
}
