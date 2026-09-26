import { planRamp, rampEdgeId, rampPatch, reweldFloors, sharedEdgeIds, type PlannedRamp, type RampEndPlan } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { floorLandingAt, floorsOf } from "../core/floor-landing.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { slopeControlPoint } from "./slope-commit.ts";

/** What drawing a straight ramp may decide. */
export interface RampParams {
  readonly bottomWidth?: number;
  readonly topWidth?: number;
  readonly rise?: number;
}

/**
 * The drag's two ends. An end within reach of a floor's edge -- on the
 * floor or just off it -- lands on that edge at the floor's height. An end
 * landing nowhere takes the height it touched (the start) or the start's
 * height plus `rise` (the end). A drag cannot land both ends on one floor.
 */
function rampEnds(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): { readonly from: RampEndPlan; readonly to: RampEndPlan } {
  const floors = floorsOf(ctx);
  const startLanding = floorLandingAt(floors, start);
  let endLanding = floorLandingAt(floors, end);
  if (endLanding && endLanding.topology === startLanding?.topology) endLanding = undefined;
  const from: RampEndPlan = startLanding ? { point: startLanding.point, landing: startLanding } : { point: slopeControlPoint(ctx, start) };
  const y = endLanding?.height ?? from.point.y + (params.rise ?? 3);
  const to: RampEndPlan = endLanding ? { point: { ...endLanding.point, y }, landing: endLanding } : { point: { x: end.point.x, y, z: end.point.z } };
  return { from, to };
}

/** From where the drag starts to where it ends, at the heights they land at. */
export function straightRampPoints(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): readonly [ConstructionPosition, ConstructionPosition] {
  const { from, to } = rampEnds(ctx, start, end, params);
  return [from.point, to.point];
}

/** The ramp a drag from `start` to `end` would build, before anything is committed -- what the preview draws. */
export function plannedRamp(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): PlannedRamp {
  const { from, to } = rampEnds(ctx, start, end, params);
  return planRamp(from, to, { bottom: params.bottomWidth ?? 1.5, top: params.topWidth ?? 1.5 });
}

/**
 * Commits one straight ramp. An end landing on a floor's edge -- grounded
 * or floating -- is welded into it (`topology/floor-weld.ts`): the floor's
 * edge is split around the ramp's end edge, which both faces then share.
 */
export function commitStraightRamp(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): void {
  try {
    const { corners, welds: landings } = plannedRamp(ctx, start, end, params);
    const operationId = scopedToolId(ctx, "platform-ramp", ctx.nextSequence());
    const ramp = rampPatch(operationId, corners);
    const topologies = ctx.runtime.getAllRegionTopologies();
    const welds = reweldFloors(floorsOf(ctx), {
      detach: [],
      attach: landings.map((weld) => ({ rung: ramp.edges.find((edge) => edge.edgeId === rampEdgeId(operationId, weld.end))!, floor: weld.landing.topology.surfaceKey })),
    }, new Map(ramp.nodes.map((node) => [node.id, node.position])), operationId, sharedEdgeIds(topologies));
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId,
      sourceSurfaceKeys: welds.sourceSurfaceKeys,
      patch: {
        nodes: [...ramp.nodes, ...welds.nodes],
        edges: [...ramp.edges, ...welds.edges],
        // The ramp's own face first: the first region names the type whose change the commit emits.
        regions: [ramp.region, ...welds.regions],
      },
      footprintOutline: [corners.bottom.min, corners.bottom.max, corners.top.max, corners.top.min].map((p) => [p.x, p.z] as const),
    }, { transactionId: operationId });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: `Rampa: ${welds.attached.length} ponta(s) soldada(s).` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
