import type { ConstructionRegionTopology, RegionEditOutcome } from "@/ports";
import { DEFAULT_TOOL_PARAMS, surfaceKeyText } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { changeAreaOf } from "../../effects/change-area.ts";
import { digTerrain } from "../terrain/terrain-sculpt-tool.ts";
import type { ToolContext, ToolGesture } from "./tool-context.ts";

type RemovalAction = (region: ConstructionRegionTopology, ctx: ToolContext, gesture: ToolGesture, causeId: string) => RegionEditOutcome | undefined;
const ACTIONS: Readonly<Record<string, RemovalAction>> = Object.freeze({
  "terrain-dig": (region, ctx, gesture, causeId) => {
    const area = changeAreaOf(ctx.runtime, { before: [region], after: [] })?.vacated;
    if (!area?.length) throw new Error("Cannot resolve the selected face's excavation area");
    const samples = gesture.samples.filter(sample => sample.surfaceRef === surfaceRefFromNodeSet(region.surfaceKey));
    if (!samples.length) throw new Error("The selected face has no pointer samples");
    const params = DEFAULT_TOOL_PARAMS["terrain-sculpt"];
    digTerrain(ctx, { outline: area[0]?.[0] ?? [], sweptPolygon: area, path: samples.map(sample => sample.point), radius: params.brushRadius },
      [{ surfaceKey: region.surfaceKey, surfaceType: region.surfaceType }], region.surfaceType, params, causeId);
    return undefined;
  },
});

/** Types declare the action; one composition dispatcher resolves its implementation. */
export function executeSurfaceRemovalAction(action: string, region: ConstructionRegionTopology, ctx: ToolContext, gesture: ToolGesture, causeId: string): RegionEditOutcome | undefined {
  const execute = ACTIONS[action];
  if (!execute) throw new Error(`Unknown surface removal action: ${action}`);
  return execute(region, ctx, gesture, `${causeId}:face:${encodeURIComponent(surfaceKeyText(region.surfaceKey))}`);
}
