import { endJointNear, jointedRampPatch, planRamp, rampEdgeId, reweldFloors, type PlannedRamp, type RampEndPlan } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { floorLandingToward, floorsOf } from "../core/floor-landing.ts";
import { pointerAtHeight } from "../core/pointer-ray.ts";
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
  const graph = ctx.runtime.getGraphSnapshot();
  const topologies = ctx.runtime.getAllRegionTopologies();
  // Another structure's free end near the pointer is run on from: it wins over a floor's edge.
  const startJoint = endJointNear(graph, topologies, (height) => pointerAtHeight(start, height));
  const endJoint = endJointNear(graph, topologies, (height) => pointerAtHeight(end, height),
    startJoint ? { own: new Set([startJoint.rung.startNodeId, startJoint.rung.endNodeId]) } : {});
  // An end dropped anywhere on a floor stops at the edge the ramp crosses to reach it.
  const startLanding = startJoint ? undefined : floorLandingToward(floors, start, end.point);
  let endLanding = endJoint ? undefined : floorLandingToward(floors, end, startLanding?.point ?? start.point);
  if (endLanding && endLanding.topology === startLanding?.topology) endLanding = undefined;
  const from: RampEndPlan = startJoint ? { point: startJoint.mid, joint: startJoint }
    : startLanding ? { point: startLanding.point, landing: startLanding } : { point: slopeControlPoint(ctx, start) };
  const y = endJoint?.height ?? endLanding?.height ?? from.point.y + (params.rise ?? 3);
  const to: RampEndPlan = endJoint ? { point: endJoint.mid, joint: endJoint }
    : endLanding ? { point: { ...endLanding.point, y }, landing: endLanding } : { point: pointerAtHeight(end, y) };
  return { from, to };
}

/**
 * Where a ramp begun at `start` would start, before it is drawn: on another
 * structure's free end it would run on from, on a floor's edge it would weld
 * into, or loose where the pointer is -- what the pointer shows before the
 * first click.
 */
export function rampStartAt(ctx: ToolContext, start: PointerSample): RampEndPlan {
  const graph = ctx.runtime.getGraphSnapshot();
  const joint = endJointNear(graph, ctx.runtime.getAllRegionTopologies(), (height) => pointerAtHeight(start, height));
  if (joint) return { point: joint.mid, joint };
  const landing = floorLandingToward(floorsOf(ctx), start, start.point);
  return landing ? { point: landing.point, landing } : { point: slopeControlPoint(ctx, start) };
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
    const plan = plannedRamp(ctx, start, end, params);
    const { corners, welds: landings } = plan;
    const operationId = scopedToolId(ctx, "platform-ramp", ctx.nextSequence());
    // An end run on from another structure's end takes that end's nodes.
    const ramp = jointedRampPatch(operationId, plan);
    const topologies = ctx.runtime.getAllRegionTopologies();
    const welds = reweldFloors(topologies, {
      detach: [],
      attach: landings.map((weld) => ({ rung: ramp.edges.find((edge) => edge.edgeId === rampEdgeId(operationId, weld.end))!, floor: weld.landing.topology.surfaceKey })),
    }, ramp.positions, operationId);
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
    const joined = plan.joints.length > 0 ? `, ${plan.joints.length} continuando outra estrutura` : "";
    ctx.reportFeedback({ tone: "success", message: `Rampa: ${welds.attached.length} ponta(s) soldada(s)${joined}.` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
