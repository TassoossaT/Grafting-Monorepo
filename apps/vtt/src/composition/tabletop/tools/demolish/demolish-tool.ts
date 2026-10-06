import { DEFAULT_TOOL_PARAMS, surfaceKeyText } from "../../../../features/edit-construction/index.ts";
import type { ConstructionSurfaceKey } from "@/ports";

import type { ConstructionTool, ReleasedGesture, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { scopedToolId } from "../core/tool-context.ts";
import { commitSurfaceRemoval } from "../../effects/effect-commit.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";

const DEMOLISH_COLOR = 0xef4444;

/** The same picked targets feed the highlight and commit; empty space selects nothing. */
function targetsFor(ctx: ToolContext, gesture: ToolGesture): readonly ConstructionSurfaceKey[] {
  const seen = new Set<string>(), keys: ConstructionSurfaceKey[] = [];
  const picked = new Map(ctx.runtime.getAllRegionTopologies().map((topology) => [surfaceRefFromNodeSet(topology.surfaceKey), topology.surfaceKey]));
  for (const sample of gesture.samples) {
    const key = sample.surfaceRef ? picked.get(sample.surfaceRef) : undefined;
    if (key && !seen.has(surfaceKeyText(key))) {
      seen.add(surfaceKeyText(key));
      keys.push(key);
    }
  }
  return keys;
}

/** Direct face selection and one transaction per gesture. */
export const demolishTool: ConstructionTool<"demolish"> = {
  id: "demolish",
  usesRuler: false,
  handlePresentation: "none",
  defaultParams: () => DEFAULT_TOOL_PARAMS.demolish,
  previewOnHover: true,
  previewFor(gesture: ToolGesture, _params, ctx: ToolContext) {
    const keys = targetsFor(ctx, gesture);
    return keys.length ? ctx.runtime.previewSurfaces?.(keys, DEMOLISH_COLOR) : undefined;
  },
  onPointerMove(): void {},
  onPointerUp(ctx: ToolContext, gesture: ReleasedGesture): void {
    const keys = targetsFor(ctx, gesture);
    if (keys.length === 0) return;
    const causeId = scopedToolId(ctx, "demolish", ctx.nextSequence());
    try {
      const { recorded } = commitSurfaceRemoval(ctx.runtime, keys, { transactionId: causeId });
      if (recorded) ctx.history.record({ kind: "transaction", transactionId: causeId });
      ctx.reportFeedback({ tone: "success", message: "Estruturas selecionadas removidas." });
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: String(error) });
    }
  },
};
