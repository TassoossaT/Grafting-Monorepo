import { describeSlope, planSlopeEdit, SLOPE_SURFACE_TYPE, structureTypeFor, type SlopeSummary } from "../../../../features/edit-construction/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";

type SlopeToolId = "slope-curve" | "slope-spiral";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function same(a: SlopeSummary, b: SlopeSummary): boolean {
  if (!close(a.startHeight, b.startHeight) || !close(a.endHeight, b.endHeight) || !close(a.width, b.width)) return false;
  if (!a.spiral || !b.spiral) return !a.spiral === !b.spiral;
  return close(a.spiral.centerX, b.spiral.centerX) && close(a.spiral.centerZ, b.spiral.centerZ)
    && close(a.spiral.radius, b.spiral.radius) && close(a.spiral.turns, b.spiral.turns) && a.spiral.positive === b.spiral.positive;
}

/**
 * The global edits of a sloped platform, from the panel: picking a point of
 * one mirrors what it is as a whole -- its ends' heights, its width, and the
 * spiral it is -- into the tool's `selected` params, and changing any of
 * those edits it. The same regeneration a point drag runs does the rest.
 *
 * This is the panel half of editing a slope as a whole; handles in the scene
 * for the same values come with the shared edit-mode components (#318).
 */
export function slopeSelection(id: SlopeToolId) {
  const picked = new WeakMap<ToolContext["runtime"], { readonly nodeId: string; readonly summary: SlopeSummary }>();

  function mirror(ctx: ToolContext, nodeId: string | undefined): void {
    const summary = nodeId === undefined ? undefined : describeSlope(ctx.runtime.getGraphSnapshot(), nodeId);
    // Nothing was picked and nothing is: the panel has nothing to change.
    if (!summary && !picked.has(ctx.runtime)) return;
    if (nodeId !== undefined && summary) picked.set(ctx.runtime, { nodeId, summary });
    else picked.delete(ctx.runtime);
    ctx.updateToolParams?.(id, (params) => ({ ...params, selected: summary }));
  }

  function apply(ctx: ToolContext, nodeId: string, next: SlopeSummary): void {
    const operationId = scopedToolId(ctx, "slope-edit", ctx.nextSequence());
    const snapshot = ctx.runtime.getGraphSnapshot();
    try {
      const graphPatch = planSlopeEdit(snapshot, ctx.runtime, nodeId, next, operationId);
      const generation = structureTypeFor(SLOPE_SURFACE_TYPE)?.spine;
      if (!graphPatch || !generation) return;
      const regenerated = generation.regenerate({
        snapshot, graphPatch, topologies: ctx.runtime.getAllRegionTopologies(), port: ctx.runtime, field: ctx.runtime, operationId, tableId: ctx.tableId,
      });
      if (!regenerated) return;
      const { recorded } = commitPatchReplacement(ctx.runtime, regenerated.request, { transactionId: operationId });
      if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
      // The chain's first end keeps its id through any rebuild.
      mirror(ctx, graphPatch.nodes[0]?.id ?? nodeId);
      ctx.reportFeedback({ tone: "success", message: "Rampa atualizada." });
    } catch (error) {
      mirror(ctx, nodeId);
      ctx.reportFeedback({ tone: "error", message: `Rampa preservada: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return {
    /** For `withSpineEditing`'s `onSelect`. */
    onSelect: mirror,
    /** For the tool's `onParamsChange`: a changed `selected` edits the picked slope. */
    onParamsChange(ctx: ToolContext, next: { readonly selected?: SlopeSummary }): void {
      const current = picked.get(ctx.runtime);
      if (!current || !next.selected || same(next.selected, current.summary)) return;
      apply(ctx, current.nodeId, next.selected);
    },
  };
}
