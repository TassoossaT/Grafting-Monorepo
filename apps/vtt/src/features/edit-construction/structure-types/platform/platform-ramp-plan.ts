import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { alongEdge, projectOnto, type EndJoint, type FloorLanding } from "../../topology/floor-weld.ts";

/** How far off the line of another structure's end a second one may stand and still be continued in a straight line. */
const ON_LINE = 1e-3;
import type { RebuiltFromEnds, StructureEnd, StructureEndName, StructureEnds } from "../structure-type.ts";
import { RAMP_SURFACE_TYPE, rampCornerId, rampCornerIdsOf as cornerIdsOf, rampCorners, rampEdgeId, rampOutline, rampPatch, rampShapeOf, type RampCorners, type RampEnd } from "./platform-ramp.ts";

/**
 * Where a straight ramp goes, from where its two ends are asked to be --
 * the same plan whether the ramp is being drawn or one of its ends is being
 * moved:
 *
 * - an end landing on a floor's edge sits on that edge and the ramp leaves
 *   it square on, off the floor -- a ramp welded into a floor never lies
 *   over it; an end whose other end lies over its floor does not weld;
 * - a second landing is kept only if its edge is parallel to the first and
 *   faces it across the gap -- a straight ramp cannot meet two edges square
 *   on otherwise;
 * - welded ends slide together along their edges until each end's width
 *   fits inside its edge, clear of the corners.
 */

/** Kept clear of an edge's corners when a ramp end is slid along it to fit. */
const CORNER_CLEARANCE = 0.02;

/** Where one end is asked to be, and the floor edge it lands on or the structure's end it continues, if any. */
export interface RampEndPlan {
  readonly point: ConstructionPosition;
  readonly landing?: FloorLanding;
  /** Another structure's free end this one takes over: its edge, its width and its way on. */
  readonly joint?: EndJoint;
}

/** The ramp a plan builds, which of its ends weld into which floor edge, and which continue another structure's end. */
export interface PlannedRamp {
  readonly corners: RampCorners;
  readonly welds: readonly { readonly end: RampEnd; readonly landing: FloorLanding }[];
  readonly joints: readonly { readonly end: RampEnd; readonly joint: EndJoint }[];
}

/** `point` moved onto the landing edge's line, keeping its own height. */
function onto(landing: FloorLanding, point: ConstructionPosition): ConstructionPosition {
  const { t } = projectOnto(landing.a, landing.b, point);
  return { x: landing.a.x + (landing.b.x - landing.a.x) * t, y: point.y, z: landing.a.z + (landing.b.z - landing.a.z) * t };
}

/** How far `to` lies off `landing`'s floor from `at`, square to its edge; not positive when it lies over the floor. */
const offFloor = (landing: FloorLanding, at: { readonly x: number; readonly z: number }, to: { readonly x: number; readonly z: number }) =>
  landing.out.x * (to.x - at.x) + landing.out.z * (to.z - at.z);

function parallel(a: FloorLanding, b: FloorLanding): boolean {
  return Math.abs((a.b.x - a.a.x) * (b.b.z - b.a.z) - (a.b.z - a.a.z) * (b.b.x - b.a.x))
    / (Math.hypot(a.b.x - a.a.x, a.b.z - a.a.z) * Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z)) < 1e-3;
}

type Welds = { end: RampEnd; landing: FloorLanding }[];
type Joints = { end: RampEnd; joint: EndJoint }[];

const dot = (n: { readonly x: number; readonly z: number }, from: { readonly x: number; readonly z: number }, to: { readonly x: number; readonly z: number }) =>
  n.x * (to.x - from.x) + n.z * (to.z - from.z);

/**
 * The axis when an end continues another structure's end: it starts on that
 * end's edge and runs straight on, the way that structure was going. The
 * other end then continues a second structure only where that one faces it
 * straight along the same line, and welds into a floor only where the
 * floor's edge is square to the line and faces back across the gap.
 */
function jointAxis(joint: EndJoint, far: RampEndPlan) {
  const n = joint.out, start = joint.mid;
  const other = far.joint;
  if (other && dot(n, start, other.mid) > 0 && n.x * other.out.x + n.z * other.out.z < -0.999
    && Math.abs(n.x * (other.mid.z - start.z) - n.z * (other.mid.x - start.x)) < ON_LINE) {
    return { start, end: other.mid, farJoint: other, farWeld: undefined };
  }
  const landing = far.landing;
  const square = landing && Math.abs(n.x * (landing.b.x - landing.a.x) + n.z * (landing.b.z - landing.a.z)) < 1e-3 * Math.hypot(landing.b.x - landing.a.x, landing.b.z - landing.a.z)
    && dot(n, start, landing.a) > 0 && dot(landing.out, landing.a, start) > 0;
  const reach = square ? dot(n, start, landing!.a) : dot(n, start, far.point);
  return { start, end: { x: start.x + n.x * reach, y: square ? landing!.height : far.point.y, z: start.z + n.z * reach }, farJoint: undefined, farWeld: square ? landing : undefined };
}

/** The axis the two asked-for ends make, and which of their landings and joints it keeps. */
function plannedAxis(from: RampEndPlan, to: RampEndPlan): { axisStart: ConstructionPosition; axisEnd: ConstructionPosition; welds: Welds; joints: Joints } {
  if (from.joint) {
    const axis = jointAxis(from.joint, to);
    const joints: Joints = [{ end: "bottom", joint: from.joint }];
    if (axis.farJoint) joints.push({ end: "top", joint: axis.farJoint });
    return { axisStart: axis.start, axisEnd: axis.end, welds: axis.farWeld ? [{ end: "top", landing: axis.farWeld }] : [], joints };
  }
  if (to.joint) {
    const axis = jointAxis(to.joint, from);
    return { axisStart: axis.end, axisEnd: axis.start, welds: axis.farWeld ? [{ end: "bottom", landing: axis.farWeld }] : [], joints: [{ end: "top", joint: to.joint }] };
  }
  return { ...floorAxis(from, to), joints: [] };
}

/** The axis the two asked-for ends make between floors, and which of their landings it keeps. */
function floorAxis(from: RampEndPlan, to: RampEndPlan) {
  let start = from.landing, end = to.landing;
  if (start && !(offFloor(start, onto(start, from.point), to.point) > 0)) start = undefined;
  if (end && !(offFloor(end, onto(end, to.point), from.point) > 0)) end = undefined;
  if (start) {
    const axisStart = onto(start, from.point);
    const n = start.out;
    // Both welded: the far floor's edge must face back at the start, across the gap.
    const both = end !== undefined && parallel(start, end) && offFloor(end, end.a, axisStart) > 0;
    const reach = both ? offFloor(start, axisStart, end!.a) : offFloor(start, axisStart, to.point);
    const welds: Welds = [{ end: "bottom", landing: start }];
    if (both) welds.push({ end: "top", landing: end! });
    return { axisStart, axisEnd: { x: axisStart.x + n.x * reach, y: to.point.y, z: axisStart.z + n.z * reach }, welds };
  }
  if (end) {
    const axisEnd = onto(end, to.point);
    const reach = offFloor(end, axisEnd, from.point);
    return { axisStart: { x: axisEnd.x + end.out.x * reach, y: from.point.y, z: axisEnd.z + end.out.z * reach }, axisEnd, welds: [{ end: "top", landing: end }] as Welds };
  }
  return { axisStart: from.point, axisEnd: to.point, welds: [] as Welds };
}

/**
 * How far to slide the ramp along its welded edges so each welded end's
 * width fits inside its edge; welds that cannot fit even so are dropped.
 * Every welded edge is square to the axis, so one slide moves every end
 * along its own edge alike.
 */
function fitAlongEdges(axisStart: ConstructionPosition, axisEnd: ConstructionPosition, welds: Welds, widths: { readonly bottom: number; readonly top: number }, slidable = true) {
  const dx = axisEnd.x - axisStart.x, dz = axisEnd.z - axisStart.z, length = Math.hypot(dx, dz);
  // No axis yet -- the pointer still on the edge it started from: nothing to slide.
  if (!(length > 1e-9)) return { axisStart, axisEnd, welds };
  const side = { x: -dz / length, z: dx / length };
  let low = -Infinity, high = Infinity;
  const kept: Welds = [];
  for (const weld of welds) {
    const { landing } = weld;
    const at = weld.end === "bottom" ? axisStart : axisEnd;
    const half = (weld.end === "bottom" ? widths.bottom : widths.top) / 2 + CORNER_CLEARANCE;
    const edge = Math.hypot(landing.b.x - landing.a.x, landing.b.z - landing.a.z);
    // The edge's own direction, signed so sliding by `s` moves the end by `s` along it.
    const sign = Math.sign(((landing.b.x - landing.a.x) * side.x + (landing.b.z - landing.a.z) * side.z) / edge) || 1;
    const s = alongEdge(landing, at);
    const [lo, hi] = sign > 0 ? [half - s, edge - half - s] : [s - (edge - half), s - half];
    if (lo > hi || Math.max(low, lo) > Math.min(high, hi) || (!slidable && (lo > 0 || hi < 0))) continue;
    low = Math.max(low, lo);
    high = Math.min(high, hi);
    kept.push(weld);
  }
  const slide = Math.max(low, Math.min(high, 0));
  const moved = (p: ConstructionPosition) => ({ x: p.x + side.x * slide, y: p.y, z: p.z + side.z * slide });
  return { axisStart: moved(axisStart), axisEnd: moved(axisEnd), welds: kept };
}

/**
 * The ramp from `from` (its bottom) to `to` (its top), `widths` wide at each
 * end -- an end continuing another structure takes that end's width. Throws
 * when it has no length.
 */
export function planRamp(from: RampEndPlan, to: RampEndPlan, widths: { readonly bottom: number; readonly top: number }): PlannedRamp {
  const axis = plannedAxis(from, to);
  const width = (end: RampEnd) => axis.joints.find((joint) => joint.end === end)?.joint.width ?? (end === "bottom" ? widths.bottom : widths.top);
  const own = { bottom: width("bottom"), top: width("top") };
  // An end continuing another structure is fixed where that end is: nothing slides.
  const fitted = axis.welds.length === 0 ? axis : fitAlongEdges(axis.axisStart, axis.axisEnd, axis.welds, own, axis.joints.length === 0);
  return {
    corners: rampCorners({ axisStart: fitted.axisStart, axisEnd: fitted.axisEnd, bottomWidth: own.bottom, topWidth: own.top }),
    welds: fitted.welds,
    joints: axis.joints,
  };
}

/**
 * The ramp's own patch with each end that continues another structure
 * taking that end's two nodes as its corners: they already stand, so they
 * are not declared again, and the two structures share them from then on.
 */
export function jointedRampPatch(operationId: string, plan: PlannedRamp, keep: ReadonlyMap<string, string> = new Map()) {
  const patch = rampPatch(operationId, plan.corners);
  const names = new Map(keep);
  for (const { end, joint } of plan.joints) {
    const corners = plan.corners[end];
    const nearest = (p: ConstructionPosition) => (Math.hypot(p.x - joint.a.x, p.z - joint.a.z) <= Math.hypot(p.x - joint.b.x, p.z - joint.b.z) ? joint.rung.startNodeId : joint.rung.endNodeId);
    names.set(rampCornerId(operationId, end, "min"), nearest(corners.min));
    names.set(rampCornerId(operationId, end, "max"), nearest(corners.max));
  }
  const name = (id: string) => names.get(id) ?? id;
  const adopted = new Set(plan.joints.flatMap(({ joint }) => [joint.rung.startNodeId, joint.rung.endNodeId]));
  return {
    nodes: patch.nodes.map((node) => ({ ...node, id: name(node.id) })).filter((node) => !adopted.has(node.id)),
    // Every node of the ramp where it will stand, adopted ones included.
    positions: new Map(patch.nodes.map((node) => [name(node.id), node.position])),
    edges: patch.edges.map((edge) => ({ ...edge, startNodeId: name(edge.startNodeId), endNodeId: name(edge.endNodeId) })),
    region: patch.region,
  };
}

const END_OF: Readonly<Record<StructureEndName, RampEnd>> = { origin: "bottom", destination: "top" };

/** A ramp's ends: its bottom is where it starts, its top where it goes, each by its end edge. */
function rampEnds(topology: ConstructionRegionTopology): readonly StructureEnd[] {
  const shape = rampShapeOf(topology);
  if (!shape) return [];
  const rung = (end: RampEnd) => {
    const edgeId = rampEdgeId(shape.operationId, end);
    const use = topology.outerLoops.flat().find((candidate) => candidate.edgeId === edgeId);
    return use && { edgeId, startNodeId: use.reversed ? use.endNodeId : use.startNodeId, endNodeId: use.reversed ? use.startNodeId : use.endNodeId };
  };
  const bottom = rung("bottom"), top = rung("top");
  if (!bottom || !top) return [];
  return [
    { name: "origin", position: shape.axisStart, rung: bottom },
    { name: "destination", position: shape.axisEnd, rung: top },
  ];
}

/** The ramp rebuilt with one end moved: the same ids, so it stays the same ramp. */
function rebuildRamp(topology: ConstructionRegionTopology, name: StructureEndName, target: RampEndPlan, kept?: FloorLanding, keptJoint?: EndJoint): RebuiltFromEnds {
  const shape = rampShapeOf(topology);
  if (!shape) throw new Error("A rampa precisa dos seus quatro cantos.");
  const moving = END_OF[name];
  const standingEnd: RampEnd = moving === "bottom" ? "top" : "bottom";
  const standing: RampEndPlan = { point: moving === "bottom" ? shape.axisEnd : shape.axisStart, ...(kept ? { landing: kept } : {}), ...(keptJoint ? { joint: keptJoint } : {}) };
  const plan = moving === "bottom" ? planRamp(target, standing, { bottom: shape.bottomWidth, top: shape.topWidth }) : planRamp(standing, target, { bottom: shape.bottomWidth, top: shape.topWidth });
  // The standing end keeps the nodes it has -- another structure's, when it continues one.
  const current = cornerIdsOf(topology);
  const keep = new Map(current ? (["min", "max"] as const).map((side) => [rampCornerId(shape.operationId, standingEnd, side), current[standingEnd][side]] as const) : []);
  const patch = jointedRampPatch(shape.operationId, plan, keep);
  const edge = (end: RampEnd) => patch.edges.find((candidate) => candidate.edgeId === rampEdgeId(shape.operationId, end))!;
  const weld = (end: RampEnd) => plan.welds.find((candidate) => candidate.end === end)?.landing;
  const standingNodes = [...patch.positions].map(([id, position]) => ({ id, position }));
  return {
    patch: { nodes: patch.nodes, edges: patch.edges, regions: [patch.region] },
    moved: standingNodes,
    rungs: (["bottom", "top"] as const).map((end) => {
      const landing = weld(end);
      return { rung: edge(end), ...(landing ? { landing } : {}) };
    }),
    footprintOutline: rampOutline(plan.corners).slice(0, 4).map((p) => [p.x, p.z] as const),
  };
}

/** A straight ramp's ends, as the `ends` capability of its type. */
export const rampEndsCapability: StructureEnds = Object.freeze<StructureEnds>({
  ends: (topology) => (topology.surfaceType === RAMP_SURFACE_TYPE ? rampEnds(topology) : []),
  rebuild: rebuildRamp,
});
