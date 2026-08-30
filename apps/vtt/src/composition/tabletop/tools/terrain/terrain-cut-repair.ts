// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type { ConstructionNodeId, ConstructionPatch, ConstructionPatchRegion, ConstructionPosition } from "@/ports";
import { createBoundaryEdges, type AtomicEditOp, type CutFallout } from "../../../../features/edit-construction/index.ts";

import type { TabletopRuntime } from "../../tabletop-runtime.ts";

/**
 * How close (world units, XZ) an exposed terrain rim node must land to one
 * of the painter's own nodes to be welded onto it, rather than left as its
 * own node at its own unrelated position.
 *
 * Terrain's lattice and a road's own contour are two independently
 * generated meshes that were never built to align -- the road's stations
 * sit wherever its own curve-flattening put them, terrain's rim wherever
 * its own relax settled. This is a first-pass heuristic, roughly one
 * terrain cell wide, wide enough to catch a genuine correspondence across
 * that mismatch without reaching across an unrelated gap and welding onto
 * the wrong side of a curve.
 */
const WELD_SEARCH_RADIUS = 2;

interface PaintedNode {
  readonly id: ConstructionNodeId;
  readonly position: ConstructionPosition;
}

/** The painter's own node nearest `position`, or `undefined` if none land within {@link WELD_SEARCH_RADIUS}. */
function nearestPaintedNode(position: ConstructionPosition, paintedNodes: readonly PaintedNode[]): PaintedNode | undefined {
  let best: PaintedNode | undefined;
  let bestDistanceSq = WELD_SEARCH_RADIUS * WELD_SEARCH_RADIUS;
  for (const node of paintedNodes) {
    const dx = node.position.x - position.x;
    const dz = node.position.z - position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = node;
    }
  }
  return best;
}

/** One surviving face whose cycle names a welded node now, ready to replace the version still naming the old rim node. */
interface RebuiltFace {
  readonly surfaceKey: readonly string[];
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly cycle: readonly ConstructionNodeId[];
}

/**
 * Terrain's own answer to `resolveCutRepair`'s `"regenerate"`: how it closes
 * up, as a real connected graph, after some other type's stroke cut it.
 *
 * `TabletopRuntime.applyPatchReplacement` is this function's only caller,
 * dispatching to it generically once it resolves that a stroke's own
 * footprint cut into terrain -- see that method's own doc. Nothing upstream
 * of it knows this function exists or how terrain repairs itself.
 *
 * **The whole point: a weld is a shared node id, not a shared position.**
 * `ConstructionSessionPort.addPatch`'s own node handling skips minting a
 * node whose id already exists and reuses the live one instead
 * (`region_editing.rs`, `apply_add_patch`) -- so a face that declares one of
 * the painter's own node ids as one of its own corners becomes the *same*
 * node the painter's face uses, sharing a real edge with it. Moving an
 * existing terrain node to a nearby position, which an earlier version of
 * this function did, never achieves that: two nodes at the same spot are
 * still two nodes, "coincident, never connected" the way `ConstructionPatch`
 * itself already warns two independently generated faces can end up.
 *
 * **The steps:**
 * 1. Read every consumed face's own topology before deleting it -- once
 *    gone, there is nothing left to ask.
 * 2. Delete the consumed faces. Terrain's own call, not the painter's --
 *    the painter's `sourceSurfaceKeys` never named them.
 * 3. `getUnfilledLoops`, scoped to what those faces stood on, reports
 *    exactly the rim the deletion exposed.
 * 4. Match each rim node to the nearest painted node close enough to call
 *    the same seam ({@link WELD_SEARCH_RADIUS}), building a node-id remap.
 * 5. Every *surviving* terrain face that still names a remapped rim node in
 *    one of its own corners has to be rebuilt to name the welded id
 *    instead -- a face is a fixed cycle of ids, and nothing short of
 *    rebuilding it changes which ids it names. A face whose remap would
 *    collapse two of its own corners onto one id (two rim nodes landing on
 *    the same painted node) is left alone rather than registered
 *    degenerate.
 * 6. Delete every affected survivor, then re-add it with its welded cycle,
 *    reusing whichever ids -- painted or terrain's own -- were already
 *    live, minting nothing but a fresh boundary edge where the seam itself
 *    now runs.
 *
 * A rim node with no painted node close enough to weld onto is left
 * exactly where the deletion left it: no repair is attempted for that one
 * corner, rather than moving it toward a match too far away to mean
 * anything.
 */
export function repairTerrainCut(runtime: TabletopRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  const preScope = new Set<ConstructionNodeId>();
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    const topology = runtime.getRegionTopology(surfaceKey);
    if (topology === undefined) continue;
    for (const node of topology.nodes) preScope.add(node.id);
  }
  if (preScope.size === 0) return 0;

  runtime.applyRegionEdit(
    fallout.consumedSurfaceKeys.map((surfaceKey): AtomicEditOp => ({ kind: "delete-region", surfaceKey })),
    "local",
    causeId,
  );

  const loops = runtime.getUnfilledLoops([...preScope]);
  if (loops.length === 0) return 0;
  const rimNodeIds = new Set(loops.flatMap((loop) => loop.nodeIds));
  if (rimNodeIds.size === 0) return 0;

  const nodePositions = runtime.getSnapshot().map.nodePositions;
  const remap = new Map<ConstructionNodeId, ConstructionNodeId>();
  const weldedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const rimNodeId of rimNodeIds) {
    const entry = nodePositions.get(rimNodeId);
    if (entry === undefined) continue;
    const nearest = nearestPaintedNode(entry.position, fallout.paintedNodes);
    if (nearest === undefined) continue;
    remap.set(rimNodeId, nearest.id);
    weldedPositions.set(nearest.id, nearest.position);
  }
  if (remap.size === 0) return 0;

  const affected: RebuiltFace[] = [];
  for (const topology of runtime.getAllRegionTopologies()) {
    if (topology.outerLoops.length !== 1 || topology.holes.length > 0) continue;
    const cycle = topology.outerLoops[0]!.map((edge) => edge.startNodeId);
    if (!cycle.some((id) => remap.has(id))) continue;
    const remapped = cycle.map((id) => remap.get(id) ?? id);
    // Two corners of one face landing on the same welded node would
    // register a degenerate cycle; leave that face exactly as the deletion
    // left it rather than register something broken.
    if (new Set(remapped).size !== remapped.length) continue;
    affected.push({
      surfaceKey: topology.surfaceKey,
      surfaceType: topology.surfaceType,
      physical: topology.physical,
      cycle: remapped,
    });
  }
  if (affected.length === 0) return 0;

  runtime.applyRegionEdit(
    affected.map((face): AtomicEditOp => ({ kind: "delete-region", surfaceKey: face.surfaceKey })),
    "local",
    causeId,
  );

  const tableId = runtime.getSnapshot().tableId;
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const paintedById = new Map(fallout.paintedNodes.map((node) => [node.id, node.position]));
  const nodes = new Map<ConstructionNodeId, ConstructionPosition>();
  const positionOf = (id: ConstructionNodeId): ConstructionPosition | undefined =>
    weldedPositions.get(id) ?? paintedById.get(id) ?? nodePositions.get(id)?.position;

  const regions: ConstructionPatchRegion[] = [];
  for (const face of affected) {
    const boundary = face.cycle.map((id, index) => {
      const next = face.cycle[(index + 1) % face.cycle.length]!;
      return edges.use(id, next);
    });
    for (const id of face.cycle) {
      const position = positionOf(id);
      if (position !== undefined) nodes.set(id, position);
    }
    regions.push({
      regionId: face.cycle.join("|"),
      boundary,
      surfaceType: face.surfaceType,
      physical: face.physical,
    });
  }

  const patch: ConstructionPatch = { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges: edges.all(), regions };
  runtime.addPatch(patch, "local", causeId);
  return regions.length;
}
