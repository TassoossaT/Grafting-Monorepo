import { rampCorners, rampEdgeId, rampPatch, type RampCorners } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { landingEdge, landsInside, project, reweldedFloor, slopeControlPoint, type EndWeld, type Rung } from "./slope-commit.ts";

/** What drawing a straight ramp may decide. */
export interface RampParams {
  readonly bottomWidth?: number;
  readonly topWidth?: number;
  readonly rise?: number;
}

/** From where the drag starts, at that height, to where it ends, `rise` higher. */
export function straightRampPoints(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): readonly [ConstructionPosition, ConstructionPosition] {
  const from = slopeControlPoint(ctx, start);
  return [from, { x: end.point.x, y: from.y + (params.rise ?? 3), z: end.point.z }];
}

/** The plan-view unit normal of the welded edge, turned to point from `from` towards `to`. */
function normalToward(weld: EndWeld, from: ConstructionPosition, to: ConstructionPosition): { readonly x: number; readonly z: number } {
  const ux = weld.b.x - weld.a.x, uz = weld.b.z - weld.a.z;
  const length = Math.hypot(ux, uz);
  const n = { x: -uz / length, z: ux / length };
  return n.x * (to.x - from.x) + n.z * (to.z - from.z) < 0 ? { x: -n.x, z: -n.z } : n;
}

/** `point` moved onto the welded edge's line, keeping its own height. */
function onto(weld: EndWeld, point: ConstructionPosition): ConstructionPosition {
  const { t } = project(weld.a, weld.b, point);
  return { x: weld.a.x + (weld.b.x - weld.a.x) * t, y: point.y, z: weld.a.z + (weld.b.z - weld.a.z) * t };
}

/**
 * The axis actually built: an end landing on a floor's edge sits on that
 * edge and the axis meets it square on, so the ramp's end edge lies along
 * the floor's. A second landing is kept only if its edge is parallel to the
 * first -- a straight ramp cannot meet two edges square on otherwise.
 */
function plannedAxis(from: ConstructionPosition, to: ConstructionPosition, start: EndWeld | undefined, end: EndWeld | undefined) {
  const parallel = (a: EndWeld, b: EndWeld) => Math.abs((a.b.x - a.a.x) * (b.b.z - b.a.z) - (a.b.z - a.a.z) * (b.b.x - b.a.x))
    / (Math.hypot(a.b.x - a.a.x, a.b.z - a.a.z) * Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z)) < 1e-3;
  if (start) {
    const axisStart = onto(start, from);
    const n = normalToward(start, axisStart, to);
    const reach = end && parallel(start, end)
      ? n.x * (end.a.x - axisStart.x) + n.z * (end.a.z - axisStart.z)
      : n.x * (to.x - axisStart.x) + n.z * (to.z - axisStart.z);
    return { axisStart, axisEnd: { x: axisStart.x + n.x * reach, y: to.y, z: axisStart.z + n.z * reach }, welds: end && parallel(start, end) ? [start, end] : [start] };
  }
  if (end) {
    const axisEnd = onto(end, to);
    const n = normalToward(end, axisEnd, from);
    const reach = n.x * (from.x - axisEnd.x) + n.z * (from.z - axisEnd.z);
    return { axisStart: { x: axisEnd.x + n.x * reach, y: from.y, z: axisEnd.z + n.z * reach }, axisEnd, welds: [end] };
  }
  return { axisStart: from, axisEnd: to, welds: [] };
}

/** The corners a drag from `start` to `end` would build, before anything is committed -- what the preview draws. */
export function plannedRamp(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): { readonly corners: RampCorners; readonly welds: readonly EndWeld[] } {
  const [from, to] = straightRampPoints(ctx, start, end, params);
  const topologies = ctx.runtime.getAllRegionTopologies();
  const axis = plannedAxis(from, to, landingEdge(topologies, from, 0), landingEdge(topologies, to, 1));
  const corners = rampCorners({ axisStart: axis.axisStart, axisEnd: axis.axisEnd, bottomWidth: params.bottomWidth ?? 1.5, topWidth: params.topWidth ?? 1.5 });
  return { corners, welds: axis.welds };
}

/**
 * Commits one straight ramp. An end landing on a floor's edge at its own
 * height -- grounded or floating -- is welded into it: the floor's edge is
 * split around the ramp's end edge, which both faces then share.
 */
export function commitStraightRamp(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): void {
  try {
    const { corners, welds: landings } = plannedRamp(ctx, start, end, params);
    const operationId = scopedToolId(ctx, "platform-ramp", ctx.nextSequence());
    const ramp = rampPatch(operationId, corners);
    const positions = new Map(ramp.nodes.map((node) => [node.id, node.position]));
    const rungOf = (weld: EndWeld): Rung => {
      const rampEnd = weld.controlIndex === 0 ? "bottom" : "top";
      const edge = ramp.edges.find((candidate) => candidate.edgeId === rampEdgeId(operationId, rampEnd))!;
      return { edgeId: edge.edgeId, startNodeId: edge.startNodeId, endNodeId: edge.endNodeId };
    };
    const welds = landings.filter((weld) => landsInside(weld, rungOf(weld), positions));
    if (welds.length === 2 && welds[0]!.topology === welds[1]!.topology) welds.pop();
    const floors = welds.map((weld) => ({ weld, ...reweldedFloor(operationId, weld, rungOf(weld), positions) }));
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId,
      sourceSurfaceKeys: floors.map((floor) => floor.weld.topology.surfaceKey),
      patch: {
        nodes: [...ramp.nodes, ...floors.flatMap((floor) => floor.nodes)],
        edges: [...ramp.edges, ...floors.flatMap((floor) => floor.edges)],
        // The ramp's own face first: the first region names the type whose change the commit emits.
        regions: [ramp.region, ...floors.map((floor) => floor.region)],
      },
      footprintOutline: [corners.bottom.min, corners.bottom.max, corners.top.max, corners.top.min].map((p) => [p.x, p.z] as const),
    }, { transactionId: operationId });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: `Rampa: ${welds.length} ponta(s) soldada(s).` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
