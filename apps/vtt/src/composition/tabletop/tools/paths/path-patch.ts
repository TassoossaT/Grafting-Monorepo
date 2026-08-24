import type {
  ConstructionEdgeGeometry,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionSweepPlan,
} from "@/ports";

import { createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { stationNodeId } from "../../../../features/edit-construction/index.ts";

/** How far two ends of an arc may disagree about its radius, in world units. */
const ARC_RADIUS_TOLERANCE = 1e-3;

/** Whether both ends of a curve really do sit on one circle about its centre. */
function concentric(
  plan: ConstructionSweepPlan,
  curve: { readonly from: number; readonly to: number; readonly geometry: ConstructionEdgeGeometry },
): boolean {
  if (curve.geometry.kind !== "arc") return true;
  const start = plan.vertices[curve.from];
  const end = plan.vertices[curve.to];
  if (start === undefined || end === undefined) return false;
  const [centerX, centerZ] = curve.geometry.center;
  const fromRadius = Math.hypot(start.x - centerX, start.z - centerZ);
  const toRadius = Math.hypot(end.x - centerX, end.z - centerZ);
  const scale = Math.max(1, fromRadius, toRadius);
  return Math.abs(fromRadius - toRadius) <= ARC_RADIUS_TOLERANCE * scale;
}

/** Application-owned graph declaration for one generic sweep result. */
export interface PathPatchFormation {
  readonly patch: ConstructionPatch;
  readonly outline: readonly (readonly [number, number])[];
  readonly boundary: readonly ConstructionOrientedEdgeUse[];
}

/**
 * Converts graph-neutral Rust geometry into the exact nodes, shared edges,
 * and faces the construction graph must register. This mirrors `wallPatch`:
 * the application defines what the product is; Rust only validates and
 * executes the resulting patch.
 *
 * Edges are named after the table and the pair of nodes they run between,
 * exactly as `wallPatch` names them, because that shared name is the whole
 * mechanism by which two independently declared faces agree on one edge.
 * Namespacing them per operation instead would guarantee that no path could
 * ever share an edge with anything -- the interior edges of one sweep would
 * still be shared, since they carry the same prefix, which is precisely what
 * made the mistake invisible.
 *
 * `refuse-when-full` is the right rule here, and only becomes meaningful now
 * that the name can actually collide: two faces to an edge is the true limit
 * for ground, so an edge with no room left means something is already there,
 * and the overlay refusing the patch is that fact arriving where it is
 * precise. A wall shares `private-when-full` for the opposite reason -- any
 * number of walls may legitimately stand on one column.
 */
export function pathPatch(
  tableId: string,
  corridorId: string,
  surfaceType: string,
  plan: ConstructionSweepPlan,
  profileLength: number,
  spineSlot: number,
  /**
   * Nodes that already exist, keyed `${station}:${across}` -- a junction.
   * Reusing the very node is what joins two runs; nothing here compares
   * coordinates, because coincident is not connected.
   *
   * Addressed by the full station address rather than by station alone
   * because a junction is not only a spine matter: fusing two contours welds
   * a node at an outer slot in exactly the same way, and giving the spine its
   * own private channel would make that a second mechanism doing one job.
   */
  welded: ReadonlyMap<string, string> = new Map(),
): PathPatchFormation {
  // Station-major, exactly as the sweep lays its vertices out, so the address
  // an id carries is the one the generator actually built it at. `across` is
  // signed from the spine, which is what later makes "outward" arithmetic --
  // see `features/edit-construction/station-node-id.ts`.
  const nodeIds = plan.vertices.map((_vertex, index) => {
    const station = Math.floor(index / profileLength);
    const across = (index % profileLength) - spineSlot;
    return welded.get(`${station}:${across}`) ?? stationNodeId(corridorId, station, across);
  });
  const nodes = plan.vertices.map((position, index) => ({ id: nodeIds[index]!, position }));
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });

  // The curves the sweep found, by the pair of vertices each runs between.
  // A lengthwise edge of a curved stretch is a real arc in the graph, not the
  // chord that approximates it, so the road stays smooth however finely or
  // coarsely its stations happen to be spaced.
  const curved = new Map<string, ConstructionEdgeGeometry>();
  for (const curve of plan.curves ?? []) {
    // An arc is only an arc while both its ends are the same distance from
    // its centre. Anything that moves one of them afterwards -- a mitre
    // pulling a corner onto another road, a rim cut back to a junction --
    // leaves a curve claiming a centre that fits one end and not the other,
    // and a renderer asked to draw that draws the whole enormous circle it
    // implies. Checked here rather than trusted, because this is the last
    // place that knows both the geometry and where the vertices ended up,
    // and because a straight edge is a harmless wrong answer where a wrong
    // arc is not.
    if (curve.geometry.kind === "arc" && !concentric(plan, curve)) continue;
    curved.set(`${curve.from}~${curve.to}`, curve.geometry);
  }

  const useEdge = (start: number, end: number): ConstructionOrientedEdgeUse => {
    const forward = curved.get(`${start}~${end}`);
    if (forward !== undefined) return edges.use(nodeIds[start]!, nodeIds[end]!, forward);
    const backward = curved.get(`${end}~${start}`);
    if (backward !== undefined) {
      // Walked the other way round, so the same curve seen from the far end:
      // one centre, the opposite sense of turn.
      return edges.use(nodeIds[start]!, nodeIds[end]!, reverseGeometry(backward));
    }
    return edges.use(nodeIds[start]!, nodeIds[end]!);
  };

  const regions = plan.quads.map((quad, index) => ({
    regionId: `${corridorId}:path-band:${index}`,
    boundary: quad.map((start, position) => useEdge(start, quad[(position + 1) % quad.length]!)),
    surfaceType,
    physical: true,
  }));
  const boundary = plan.boundary.map((start, position) =>
    useEdge(start, plan.boundary[(position + 1) % plan.boundary.length]!),
  );
  const outline = plan.boundary.map((index) => {
    const vertex = plan.vertices[index]!;
    return [vertex.x, vertex.z] as const;
  });

  return { patch: { nodes, edges: edges.all(), regions }, outline, boundary };
}
