import { rampCorners, rampEdgeId, rampPatch, type RampCorners } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { landsInside, project, reweldedFloor, slopeControlPoint, type EndWeld, type Rung } from "./slope-commit.ts";
import { alongEdge, floorLandingAt, floorsOf, type FloorLanding } from "../core/floor-landing.ts";

/** What drawing a straight ramp may decide. */
export interface RampParams {
  readonly bottomWidth?: number;
  readonly topWidth?: number;
  readonly rise?: number;
}

/** Kept clear of an edge's corners when a ramp end is slid along it to fit. */
const CORNER_CLEARANCE = 0.02;

/** Where a straight ramp's two ends land, and the heights they stand at. */
interface RampEnds {
  readonly from: ConstructionPosition;
  readonly to: ConstructionPosition;
  readonly start?: EndWeld;
  readonly end?: EndWeld;
}

const weldOf = (landing: FloorLanding | undefined, controlIndex: number): EndWeld | undefined =>
  landing && { controlIndex, topology: landing.topology, use: landing.use, a: landing.a, b: landing.b };

/**
 * The drag's two ends. An end within reach of a floor's edge -- on the
 * floor or just off it -- lands on that edge at the floor's height. An end
 * landing nowhere takes the height it touched (the start) or the start's
 * height plus `rise` (the end). A drag cannot land both ends on one floor.
 */
function rampEnds(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): RampEnds {
  const floors = floorsOf(ctx);
  const startLanding = floorLandingAt(floors, start);
  let endLanding = floorLandingAt(floors, end);
  if (endLanding && endLanding.topology === startLanding?.topology) endLanding = undefined;
  const from = startLanding?.point ?? slopeControlPoint(ctx, start);
  const to = { x: end.point.x, y: endLanding?.height ?? from.y + (params.rise ?? 3), z: end.point.z };
  return { from, to: endLanding ? { ...endLanding.point, y: to.y } : to, start: weldOf(startLanding, 0), end: weldOf(endLanding, 1) };
}

/** From where the drag starts to where it ends, at the heights they land at. */
export function straightRampPoints(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): readonly [ConstructionPosition, ConstructionPosition] {
  const { from, to } = rampEnds(ctx, start, end, params);
  return [from, to];
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
    const both = end !== undefined && parallel(start, end);
    const reach = both
      ? n.x * (end!.a.x - axisStart.x) + n.z * (end!.a.z - axisStart.z)
      : n.x * (to.x - axisStart.x) + n.z * (to.z - axisStart.z);
    return { axisStart, axisEnd: { x: axisStart.x + n.x * reach, y: to.y, z: axisStart.z + n.z * reach }, welds: both ? [start, end!] : [start] };
  }
  if (end) {
    const axisEnd = onto(end, to);
    const n = normalToward(end, axisEnd, from);
    const reach = n.x * (from.x - axisEnd.x) + n.z * (from.z - axisEnd.z);
    return { axisStart: { x: axisEnd.x + n.x * reach, y: from.y, z: axisEnd.z + n.z * reach }, axisEnd, welds: [end] };
  }
  return { axisStart: from, axisEnd: to, welds: [] as EndWeld[] };
}

/**
 * How far to slide the ramp along its welded edges so each welded end's
 * width fits inside its edge, clear of the corners; welds that cannot fit
 * even so are dropped. Every welded edge is square to the axis, so one
 * slide moves every end along its own edge alike.
 */
function fitAlongEdges(axisStart: ConstructionPosition, axisEnd: ConstructionPosition, welds: readonly EndWeld[], widths: { readonly bottom: number; readonly top: number }) {
  const dx = axisEnd.x - axisStart.x, dz = axisEnd.z - axisStart.z, length = Math.hypot(dx, dz);
  const side = { x: -dz / length, z: dx / length };
  let low = -Infinity, high = Infinity;
  const kept: EndWeld[] = [];
  for (const weld of welds) {
    const at = weld.controlIndex === 0 ? axisStart : axisEnd;
    const half = (weld.controlIndex === 0 ? widths.bottom : widths.top) / 2 + CORNER_CLEARANCE;
    const edge = Math.hypot(weld.b.x - weld.a.x, weld.b.z - weld.a.z);
    // The edge's own direction, signed so sliding by `s` moves the end by `s` along it.
    const sign = Math.sign(((weld.b.x - weld.a.x) * side.x + (weld.b.z - weld.a.z) * side.z) / edge) || 1;
    const s = alongEdge(weld, at);
    const [lo, hi] = sign > 0 ? [half - s, edge - half - s] : [s - (edge - half), s - half];
    if (lo > hi || Math.max(low, lo) > Math.min(high, hi)) continue;
    low = Math.max(low, lo);
    high = Math.min(high, hi);
    kept.push(weld);
  }
  const slide = Math.max(low, Math.min(high, 0));
  const moved = (p: ConstructionPosition) => ({ x: p.x + side.x * slide, y: p.y, z: p.z + side.z * slide });
  return { axisStart: moved(axisStart), axisEnd: moved(axisEnd), welds: kept };
}

/** The corners a drag from `start` to `end` would build, before anything is committed -- what the preview draws. */
export function plannedRamp(ctx: ToolContext, start: PointerSample, end: PointerSample, params: RampParams): { readonly corners: RampCorners; readonly welds: readonly EndWeld[] } {
  const ends = rampEnds(ctx, start, end, params);
  const widths = { bottom: params.bottomWidth ?? 1.5, top: params.topWidth ?? 1.5 };
  const axis = plannedAxis(ends.from, ends.to, ends.start, ends.end);
  const fitted = axis.welds.length === 0 ? axis : fitAlongEdges(axis.axisStart, axis.axisEnd, axis.welds, widths);
  const corners = rampCorners({ axisStart: fitted.axisStart, axisEnd: fitted.axisEnd, bottomWidth: widths.bottom, topWidth: widths.top });
  return { corners, welds: fitted.welds };
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
