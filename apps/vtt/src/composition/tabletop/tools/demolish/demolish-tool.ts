import { DEFAULT_TOOL_PARAMS, surfaceKeyText, resolvePolicy } from "../../../../features/edit-construction/index.ts";
import type { DemolishParams } from "@/features/edit-construction";
import type { ConstructionSurfaceKey } from "@/ports";

import { brushSweptOutlinePolygons, brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import type { ConstructionTool, ReleasedGesture, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { scopedToolId } from "../core/tool-context.ts";
import { commitSurfaceRemoval } from "../../effects/effect-commit.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";

const DEMOLISH_COLOR = 0xef4444;

function strokeChord(params: DemolishParams): number {
  return Math.max(0.2, params.radius * 0.25);
}

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

/**
 * Generic demolish/delete tool.
 *
 * Resolves surface deletion scope ("cloud" or "surface") through each picked
 * type's declared `StructureTypeDefinition` and policy, without hardcoding
 * specific type names. Commits deletion atomically via `commitSurfaceRemoval`,
 * triggering registered type reactions (e.g. ground/path lattice regeneration).
 */
export const demolishTool: ConstructionTool<"demolish"> = {
  id: "demolish",
  usesRuler: false,
  defaultParams: () => DEFAULT_TOOL_PARAMS.demolish,
  previewOnHover: true,

  previewFor(gesture: ToolGesture, params: DemolishParams, ctx: ToolContext) {
    const shape = { kind: "circle" as const, radius: params.radius };
    return brushSweptRegionFill(
      ctx.runtime,
      gesture.samples.map((s) => s.point),
      shape,
      DEMOLISH_COLOR,
      0.4,
      strokeChord(params),
    );
  },

  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ReleasedGesture, params: DemolishParams): void {
    const causeId = scopedToolId(ctx, "demolish", ctx.nextSequence());
    const targetKeysSet = new Set<string>();
    const targetKeysList: ConstructionSurfaceKey[] = [];
    const picked = new Map(ctx.runtime.getAllRegionTopologies().map((topology) => [surfaceRefFromNodeSet(topology.surfaceKey), topology.surfaceKey]));

    if (gesture.moved) {
      // Upright faces have no planar footprint; picked stroke samples still select them.
      for (const sample of gesture.samples) {
        const key = sample.surfaceRef ? picked.get(sample.surfaceRef) : undefined;
        if (key) resolveScopeForSurface(ctx, key, targetKeysSet, targetKeysList);
      }
      const samplePoints = gesture.samples.map((s) => s.point);
      const outlinePolygons = brushSweptOutlinePolygons(
        ctx.runtime,
        samplePoints,
        params.radius,
        strokeChord(params),
      );
      for (const polygon of outlinePolygons) {
        const ring = polygon[0];
        if (ring === undefined || ring.length < 3) continue;
        for (const region of ctx.runtime.getFootprintCoverage(ring)) {
          resolveScopeForSurface(ctx, region.surfaceKey, targetKeysSet, targetKeysList);
        }
      }
    } else {
      // Click demolition (single point pick)
      const sample = gesture.start;
      let hitKey: ConstructionSurfaceKey | undefined;

      if (sample.surfaceRef !== undefined) hitKey = picked.get(sample.surfaceRef);

      if (hitKey !== undefined) {
        resolveScopeForSurface(ctx, hitKey, targetKeysSet, targetKeysList);
      } else {
        // Fallback: check coverage under small circle around click point
        const circlePolygon = brushSweptOutlinePolygons(ctx.runtime, [sample.point], Math.max(params.radius, 0.5));
        for (const polygon of circlePolygon) {
          const ring = polygon[0];
          if (ring === undefined || ring.length < 3) continue;
          for (const region of ctx.runtime.getFootprintCoverage(ring)) {
            resolveScopeForSurface(ctx, region.surfaceKey, targetKeysSet, targetKeysList);
          }
        }
      }
    }

    if (targetKeysList.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nenhum elemento selecionado para demolição." });
      return;
    }

    try {
      const { recorded } = commitSurfaceRemoval(ctx.runtime, targetKeysList, {
        transactionId: causeId,
      });
      if (recorded) {
        ctx.history.record({ kind: "transaction", transactionId: causeId });
      }
      ctx.reportFeedback({
        tone: "success",
        message: `Demolição: ${targetKeysList.length} ${
          targetKeysList.length === 1 ? "elemento removido" : "elementos removidos"
        }.`,
      });
    } catch (error) {
      ctx.reportFeedback({
        tone: "error",
        message: `Demolição falhou: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
};
