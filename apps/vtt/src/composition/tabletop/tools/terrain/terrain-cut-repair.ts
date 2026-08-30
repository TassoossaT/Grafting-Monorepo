import { nearestPointOnPolygonBoundaryXZ } from "../shapes/geometry-2d.ts";
import type { AtomicEditOp, CutFallout } from "@/features/edit-construction";

import type { ToolContext } from "../core/tool-context.ts";

/**
 * Terrain's own answer to `resolveCutRepair`'s `"regenerate"`: how it closes
 * up after some other type's stroke cut it.
 *
 * A caller that just performed a cut -- `path-cloud-transaction.ts` today --
 * still has to trigger this, since nothing in this codebase pushes events on
 * its own. But the trigger is where that caller's involvement ends: it hands
 * over a plain `CutFallout` (what it consumed, and the shape it consumed it
 * with), a fact about its own stroke it would report regardless of who is
 * listening, and knows nothing about *how* terrain repairs itself -- no
 * geometry, no strategy, not even that "nearest point on the outline" is the
 * answer. All of that lives here, the same way `terrain-restack.ts`'s
 * `restackTerrain` is terrain's own business when terrain paints over
 * terrain. This is terrain's own business when something *else* paints over
 * terrain.
 *
 * The strategy: `fallout.nodeScope` is every node the consumed faces stood
 * on. Whichever of them a surviving neighbour still references is exactly
 * the rim the cut exposed -- `getUnfilledLoops` reports it when asked about
 * that same scope, since the painted shape's own faces reference a disjoint
 * set of nodes and never close the loop themselves. Each exposed node then
 * moves (XZ only) onto the nearest point of `fallout.outline`, closing the
 * gap between "wherever the lattice's own quads happened to end" and the
 * painted shape's true boundary.
 *
 * This does not weld a shared graph node the way two faces of one patch
 * would -- terrain and whatever cut it stay two separate clouds. It only
 * makes their positions coincide, which is what a viewer reads as one
 * continuous ground instead of two adjacent ones.
 *
 * Height is left alone deliberately: `outline` is a flat XZ polygon with no
 * height of its own to offer, and most painters that ride terrain (a road,
 * via `referenceLineFrom`) already sampled terrain's own height when they
 * were drawn, so the two should already agree closely wherever the cut
 * actually happened.
 */
export function repairTerrainCut(ctx: ToolContext, fallout: CutFallout, causeId: string): number {
  const loops = ctx.runtime.getUnfilledLoops(fallout.nodeScope);
  if (loops.length === 0) return 0;
  const polygon = fallout.outline.map(([x, z]) => ({ x, z }));
  const nodePositions = ctx.runtime.getSnapshot().map.nodePositions;
  const ops: AtomicEditOp[] = [];
  const moved = new Set<string>();
  for (const loop of loops) {
    for (const nodeId of loop.nodeIds) {
      if (moved.has(nodeId)) continue;
      moved.add(nodeId);
      const entry = nodePositions.get(nodeId);
      if (entry === undefined) continue;
      const nearest = nearestPointOnPolygonBoundaryXZ(entry.position, polygon);
      ops.push({ kind: "move-vertex", nodeId, position: { x: nearest.x, y: entry.position.y, z: nearest.z } });
    }
  }
  if (ops.length === 0) return 0;
  ctx.runtime.applyRegionEdit(ops, "local", causeId);
  return ops.length;
}
