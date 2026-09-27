import { endJointNear, jointedRampPatch, planRamp, rampEdgeId, reweldFloors, type PlannedRamp, type RampEndPlan } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { floorLandingToward, floorsOf } from "../core/floor-landing.ts";
import { pointerAtHeight } from "../core/pointer-ray.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { buildFrameAt } from "../core/build-frame.ts";
import { slopeControlPoint } from "./slope-commit.ts";

/** What drawing a straight ramp may decide. */
export interface RampParams {
  readonly bottomWidth?: number;
  readonly topWidth?: number;
  readonly rise?: number;
}

/** How far across the ramp the pointer must be taken before the drag is drawing its width, not only its length. */
const WIDTH_DRAWN = 0.3;

type Plan2 = { readonly x: number; readonly z: number };
const unit = (x: number, z: number): Plan2 => { const length = Math.hypot(x, z) || 1; return { x: x / length, z: z / length }; };

/**
 * A ramp drawn as a floor is: the first press is one corner of its foot and
 * the pointer the far corner, so the drag draws its width and its length at
 * once. The foot starts on a floor's edge it is pressed on -- the edge is its
 * width, the ramp climbs away from it -- or on another ramp's end it runs on
 * from, whose width it takes; pressed on open ground it climbs along the
 * longer side of what is drawn. Dragged straight out, with no width drawn,
 * it takes the tool's own widths, centred on the press. `undefined` when the
 * drag has drawn no length yet.
 */
function rampRectangle(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams) {
  const foot = rampStartAt(ctx, start);
  const origin = foot.point;
  const pointer = pointerAtHeight(end, origin.y);
  const d = { x: pointer.x - origin.x, z: pointer.z - origin.z };
  let across: Plan2, up: Plan2;
  if (foot.joint) {
    across = unit(foot.joint.b.x - foot.joint.a.x, foot.joint.b.z - foot.joint.a.z);
    up = foot.joint.out;
  } else if (foot.landing) {
    across = unit(foot.landing.b.x - foot.landing.a.x, foot.landing.b.z - foot.landing.a.z);
    // Away from the edge, whichever side of it the pointer is on.
    const out = foot.landing.out;
    up = d.x * out.x + d.z * out.z >= 0 ? out : { x: -out.x, z: -out.z };
  } else {
    const frame = buildFrameAt(ctx, start);
    const alongU = d.x * frame.u.x + d.z * frame.u.z, alongV = d.x * frame.v.x + d.z * frame.v.z;
    const [length, width] = Math.abs(alongU) >= Math.abs(alongV) ? [frame.u, frame.v] : [frame.v, frame.u];
    const sign = d.x * length.x + d.z * length.z >= 0 ? 1 : -1;
    up = { x: length.x * sign, z: length.z * sign };
    across = width;
  }
  const length = d.x * up.x + d.z * up.z;
  const drawn = d.x * across.x + d.z * across.z;
  const widthDrawn = !foot.joint && Math.abs(drawn) >= WIDTH_DRAWN;
  // Not drawn across: straight out from the press, as far as the pointer, the tool's widths.
  if (!widthDrawn && !foot.joint && !foot.landing) {
    return { foot, centre: origin, up: unit(d.x, d.z), length: Math.hypot(d.x, d.z), width: undefined };
  }
  const centre = widthDrawn ? { x: origin.x + across.x * drawn / 2, y: origin.y, z: origin.z + across.z * drawn / 2 } : origin;
  return { foot, centre, up, length, width: widthDrawn ? Math.abs(drawn) : undefined };
}

/**
 * The drag's two ends. An end within reach of a floor's edge -- on the
 * floor or just off it -- lands on that edge at the floor's height. An end
 * landing nowhere takes the height it touched (the start) or the start's
 * height plus `rise` (the end). A drag cannot land both ends on one floor.
 */
function rampEnds(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): { readonly from: RampEndPlan; readonly to: RampEndPlan; readonly width?: number } {
  const drawn = rampRectangle(ctx, start, end, params);
  if (drawn.width !== undefined) {
    const { foot, centre, up, length, width } = drawn;
    const from: RampEndPlan = foot.landing ? { point: centre, landing: foot.landing } : { point: centre };
    const reach = { x: centre.x + up.x * length, y: centre.y, z: centre.z + up.z * length };
    // The far end lands on a floor's edge where it is taken to one, at that floor's height.
    const topLanding = floorLandingToward(floorsOf(ctx), { point: reach }, centre);
    const landing = topLanding && topLanding.topology !== foot.landing?.topology ? topLanding : undefined;
    const to: RampEndPlan = landing
      ? { point: { ...reach, y: landing.height }, landing }
      : { point: { ...reach, y: centre.y + (params.rise ?? 3) } };
    return { from, to, width };
  }
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

/** The width a drag from `start` to `end` has drawn, if it has drawn one -- else the ramp takes the tool's own. */
export function drawnRampWidth(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): number | undefined {
  return rampEnds(ctx, start, end, params).width;
}

/** The ramp a drag from `start` to `end` would build, before anything is committed -- what the preview draws. */
export function plannedRamp(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): PlannedRamp {
  const { from, to, width } = rampEnds(ctx, start, end, params);
  // A width drawn is the whole ramp's, foot and top alike -- opened or closed afterwards by its corners.
  return planRamp(from, to, width !== undefined ? { bottom: width, top: width } : { bottom: params.bottomWidth ?? 1.5, top: params.topWidth ?? 1.5 });
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
