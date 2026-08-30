import type { AtomicEditOp, PathBrushEffect, TerrainCutFallout } from "../../../features/edit-construction/index.ts";
import { planPathCloudMutation } from "../../../features/edit-construction/index.ts";

import type { ToolContext } from "../tools/core/tool-context.ts";
import { reportToolFailure, reportToolWarning } from "../tools/core/tool-diagnostics.ts";
import { nearestPointOnPolygonBoundaryXZ } from "../tools/shapes/geometry-2d.ts";

/**
 * Moves every terrain node the cut just exposed onto the road's own
 * footprint boundary -- XZ only, height untouched.
 *
 * `fallout.nodeScope` is every node the consumed faces stood on; whichever
 * of them a surviving neighbour still references is exactly the rim the
 * deletion left behind, which is what {@link ToolContext.runtime.getUnfilledLoops}
 * reports when asked about that same scope (the road's own faces reference
 * a disjoint set of nodes, so they never close the loop themselves). Without
 * this, the deleted region's edge is wherever the lattice's own quads
 * happened to end -- a jagged approximation of the road's true footprint --
 * and the two surfaces read as merely adjacent rather than one continuous
 * ground. This does not weld a shared graph node the way two faces of one
 * patch would; it only moves terrain's own node to sit at the same position
 * the road's boundary already occupies, which is what closes the visible
 * seam between two otherwise-unrelated clouds.
 *
 * Height is left alone deliberately: `outline` is a flat XZ polygon with no
 * height of its own to offer, and the road's reference line already rode
 * the terrain's height when it was drawn (`referenceLineFrom`), so the two
 * should already agree closely wherever the cut actually happened.
 */
function snapTerrainRimToRoad(ctx: ToolContext, fallout: TerrainCutFallout, causeId: string): number {
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

/**
 * Runtime boundary for a PathCloud decision. This file deliberately contains
 * no path geometry or topology policy: it reads snapshots, invokes the type,
 * and submits the generic replacement transaction it returns.
 */
export function commitPathCloudIntent(
  ctx: ToolContext,
  effect: PathBrushEffect,
  tolerance: number,
): void {
  try {
    const plan = planPathCloudMutation({
      tableId: ctx.tableId,
      snapToGrid: ctx.snapToGrid,
      graphSnapshot: ctx.runtime.getGraphSnapshot(),
      regionTopologies: ctx.runtime.getAllRegionTopologies(),
      coverageFor: (outline) => ctx.runtime.getFootprintCoverage(outline),
      effect,
      tolerance,
    });
    if (plan.kind === "noop") {
      ctx.reportFeedback({ tone: "info", message: plan.message });
      return;
    }
    if (plan.kind === "refused") {
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${plan.reason}` });
      return;
    }

    const outcome = ctx.runtime.applyPatchReplacement(plan.request, "local", effect.operationId);
    if (outcome.skippedRegionIds.length > 0) {
      reportToolWarning("path-cloud", "a band face was refused", {
        operationId: effect.operationId,
        skipped: outcome.skippedRegionIds,
      });
    }
    if (plan.terrainCut !== undefined) {
      snapTerrainRimToRoad(ctx, plan.terrainCut, effect.operationId);
    }
    const changedSurfaceCount = outcome.createdSurfaceKeys.length + outcome.affectedSurfaceKeys.length;
    if (changedSurfaceCount === 0 && outcome.removedSurfaceKeys.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nenhuma alteração: o traço não cobriu nenhuma área válida." });
      return;
    }
    ctx.history.record({ kind: "path-brush", operationId: effect.operationId });
    ctx.reportFeedback({
      tone: "success",
      message: `Caminho aplicado: ${changedSurfaceCount} superfícies alteradas e ${outcome.createdNodeIds.length} nós novos.`,
    });
  } catch (error) {
    reportToolFailure("path-cloud", "commit the PathCloud transaction", { operationId: effect.operationId }, error);
    const message = error instanceof Error ? error.message : String(error);
    ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
  }
}
