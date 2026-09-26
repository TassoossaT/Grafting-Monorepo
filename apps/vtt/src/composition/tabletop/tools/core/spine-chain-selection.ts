import { describeSpineChain, planSpineChainEdit, spineMemberOf, spineOwnerAt, type ConstructionToolId, type SpineChainShape, type ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import { createSelectionMirror, type SelectionMirror } from "./selection-mirror.ts";
import { commitSpineRegeneration, regenerateSpine } from "./spine-commit.ts";
import { scopedToolId } from "./tool-context.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function sameShape(a: SpineChainShape, b: SpineChainShape): boolean {
  if (!close(a.startHeight, b.startHeight) || !close(a.endHeight, b.endHeight) || !close(a.width, b.width)) return false;
  if (!a.spiral || !b.spiral) return !a.spiral === !b.spiral;
  return close(a.spiral.centerX, b.spiral.centerX) && close(a.spiral.centerZ, b.spiral.centerZ)
    && close(a.spiral.radius, b.spiral.radius) && close(a.spiral.turns, b.spiral.turns) && a.spiral.positive === b.spiral.positive;
}

/** A spine tool's params that carry the picked spine as a whole. */
type WithSelectedSpine = { readonly selected?: SpineChainShape };

/**
 * The picked spine as a whole -- its ends' heights, width and, for a spiral,
 * centre, radius, turns and direction -- in any spine tool's `selected`
 * param, edited back from it through the spine's own owner. Any tool that
 * edits spines and has a `selected` param uses this unchanged.
 */
export function spineChainSelection<Id extends ConstructionToolId>(id: Id): SelectionMirror<Id> {
  return createSelectionMirror<Id, SpineChainShape>({
    id,
    describe: (ctx, selectedId) => describeSpineChain(ctx.runtime.getGraphSnapshot(), selectedId),
    same: sameShape,
    apply(ctx, selectedId, next) {
      const operationId = scopedToolId(ctx, "spine-edit", ctx.nextSequence());
      const snapshot = ctx.runtime.getGraphSnapshot();
      const graphPatch = planSpineChainEdit(snapshot, ctx.runtime, selectedId, next, operationId);
      const regenerated = graphPatch && regenerateSpine(ctx, snapshot, spineOwnerAt(snapshot, spineMemberOf(snapshot, selectedId)), graphPatch, operationId);
      if (!graphPatch || !regenerated) return selectedId;
      commitSpineRegeneration(ctx, regenerated.request, operationId);
      // The chain's first end keeps its id through any rebuild.
      return graphPatch.nodes[0]?.id ?? selectedId;
    },
    read: (params) => (params as WithSelectedSpine).selected,
    write: (params, value) => ({ ...params, selected: value }) as ToolParamsFor<Id>,
    messages: { applied: "Estrutura atualizada.", refused: "Estrutura preservada" },
  });
}
