import { DEFAULT_TOOL_PARAMS, surfaceKeyText, resolvePolicy } from "../../../../features/edit-construction/index.ts";
import type { ConstructionSurfaceKey } from "@/ports";

import type { ConstructionTool, ReleasedGesture, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { scopedToolId } from "../core/tool-context.ts";
import { commitSurfaceRemoval } from "../../effects/effect-commit.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";

const DEMOLISH_COLOR = 0xef4444;

function resolveScopeForSurface(
  ctx: ToolContext,
  seedKey: ConstructionSurfaceKey,
  targetKeysSet: Set<string>,
  targetKeysList: ConstructionSurfaceKey[],
): void {
  const strKey = surfaceKeyText(seedKey);
  if (targetKeysSet.has(strKey)) return;

  const topology = ctx.runtime.getRegionTopology(seedKey);
  if (topology === undefined) return;

  const policy = resolvePolicy(topology, { kind: "region" });
  if (policy.scope === "cloud") {
    const cloudOutcome = ctx.runtime.cloudFor({ seed: seedKey, surfaceType: topology.surfaceType });
    const keys = cloudOutcome.surfaceKeys.length > 0 ? cloudOutcome.surfaceKeys : [seedKey];
    for (const key of keys) {
      const s = surfaceKeyText(key);
      if (!targetKeysSet.has(s)) {
        targetKeysSet.add(s);
        targetKeysList.push(key);
      }
    }
  } else {
    targetKeysSet.add(strKey);
    targetKeysList.push(seedKey);
  }
}

/** The same picked targets feed the highlight and commit; empty space selects nothing. */
function targetsFor(ctx: ToolContext, gesture: ToolGesture): readonly ConstructionSurfaceKey[] {
  const seen = new Set<string>(), keys: ConstructionSurfaceKey[] = [];
  const picked = new Map(ctx.runtime.getAllRegionTopologies().map((topology) => [surfaceRefFromNodeSet(topology.surfaceKey), topology.surfaceKey]));
  for (const sample of gesture.samples) {
    const key = sample.surfaceRef ? picked.get(sample.surfaceRef) : undefined;
    if (key) resolveScopeForSurface(ctx, key, seen, keys);
  }
  return keys;
}

/** Direct structure selection, with type-declared scope and one transaction per gesture. */
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
