import type {
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

import { ALL_AXES, HORIZONTAL_AXES, type EditTarget } from "../../orchestration/atomic-edit.ts";
import { IGNORE } from "../creation-interaction.ts";
import { allowed, denied, type ConstrainContext, type EditRole, type RolePolicy, type StructureTypeDefinition } from "../structure-type.ts";

/**
 * The straight ramp: a trapezoid on an inclined plane. Its source of truth
 * is its own four corners, read as an axis -- the midpoint of the bottom
 * edge to the midpoint of the top edge, their height difference being the
 * rise -- and one width at each end. Both ends stay level and square to the
 * axis, centred on it, so the four corners always say exactly those four
 * numbers and nothing else is stored.
 *
 * Stairs are this same shape with steps: level strips between the two ends,
 * appearance rather than structure.
 *
 * A type of its own rather than a spine of two points, because the spine is
 * a different truth: a curve edited by its control points and handles. A
 * straight ramp edits by its widths and its ends, and never turns into a
 * curve -- that is the sloped platform, drawn as one.
 */
export const RAMP_SURFACE_TYPE = "platform-ramp";

export type RampEnd = "bottom" | "top";
export type RampSide = "min" | "max";
const ENDS: readonly RampEnd[] = ["bottom", "top"];
const SIDES: readonly RampSide[] = ["min", "max"];
const other = <T extends string>(pair: readonly [T, T], value: T): T => (value === pair[0] ? pair[1] : pair[0]);

/** Shortest end, and shortest axis, a ramp keeps. */
const MIN_SPAN = 0.1;
const LEVEL = 1e-4;
const SQUARE = 1e-3;

export const rampCornerId = (operationId: string, end: RampEnd, side: RampSide): string => `${operationId}:ramp:${end}:${side}`;
/** An end edge is named by its end, a side edge by its side. */
export const rampEdgeId = (operationId: string, name: RampEnd | RampSide): string => `${operationId}:ramp:edge:${name}`;
export const rampFaceId = (operationId: string): string => `${operationId}:ramp:face`;

function parseCorner(id: string): { readonly end: RampEnd; readonly side: RampSide } | undefined {
  const match = /:ramp:(bottom|top):(min|max)$/.exec(id);
  return match ? { end: match[1] as RampEnd, side: match[2] as RampSide } : undefined;
}

export type RampCorners = Readonly<Record<RampEnd, Readonly<Record<RampSide, ConstructionPosition>>>>;

/** What a straight ramp is: an axis from the bottom end's centre to the top end's, and a width at each end. */
export interface RampShape {
  readonly axisStart: ConstructionPosition;
  readonly axisEnd: ConstructionPosition;
  readonly bottomWidth: number;
  readonly topWidth: number;
}

/** The four corners `shape` says: each end level and square to the axis, centred on it. */
export function rampCorners(shape: RampShape): RampCorners {
  const { axisStart: start, axisEnd: end } = shape;
  const dx = end.x - start.x, dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < MIN_SPAN) throw new Error("A rampa precisa de comprimento.");
  if (!(shape.bottomWidth >= MIN_SPAN) || !(shape.topWidth >= MIN_SPAN)) throw new Error("As larguras da rampa devem ser positivas.");
  const nx = -dz / length, nz = dx / length;
  const at = (p: ConstructionPosition, width: number, sign: number) => ({ x: p.x + nx * (width / 2) * sign, y: p.y, z: p.z + nz * (width / 2) * sign });
  return {
    bottom: { min: at(start, shape.bottomWidth, -1), max: at(start, shape.bottomWidth, 1) },
    top: { min: at(end, shape.topWidth, -1), max: at(end, shape.topWidth, 1) },
  };
}

/** The outline of `corners` as a closed plan loop, for a preview. */
export function rampOutline(corners: RampCorners): readonly ConstructionPosition[] {
  return [corners.bottom.min, corners.bottom.max, corners.top.max, corners.top.min, corners.bottom.min];
}

/** The ramp's own nodes, edges and face. Its end edges are what a floor it lands on welds onto. */
export function rampPatch(operationId: string, corners: RampCorners): {
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly region: ConstructionPatchRegion;
} {
  const id = (end: RampEnd, side: RampSide) => rampCornerId(operationId, end, side);
  const edges: ConstructionPatchEdge[] = [
    { edgeId: rampEdgeId(operationId, "bottom"), startNodeId: id("bottom", "min"), endNodeId: id("bottom", "max") },
    { edgeId: rampEdgeId(operationId, "max"), startNodeId: id("bottom", "max"), endNodeId: id("top", "max") },
    { edgeId: rampEdgeId(operationId, "top"), startNodeId: id("top", "max"), endNodeId: id("top", "min") },
    { edgeId: rampEdgeId(operationId, "min"), startNodeId: id("top", "min"), endNodeId: id("bottom", "min") },
  ];
  const loop = rampOutline(corners);
  let area = 0;
  for (let i = 0; i < 4; i += 1) area += loop[i]!.x * loop[i + 1]!.z - loop[i + 1]!.x * loop[i]!.z;
  // A boundary winds with a non-negative signed area, as every contour here does.
  const boundary = area >= 0
    ? edges.map((edge) => ({ edgeId: edge.edgeId, reversed: false }))
    : [...edges].reverse().map((edge) => ({ edgeId: edge.edgeId, reversed: true }));
  return {
    nodes: ENDS.flatMap((end) => SIDES.map((side) => ({ id: id(end, side), position: corners[end][side] }))),
    edges,
    region: { regionId: rampFaceId(operationId), surfaceType: RAMP_SURFACE_TYPE, physical: true, boundary },
  };
}

interface Corners {
  readonly ids: Readonly<Record<RampEnd, Readonly<Record<RampSide, string>>>>;
  readonly at: RampCorners;
}

/** `topology`'s four corners, at `positions` where given, or `undefined` if it does not have exactly those. */
function cornersOf(topology: ConstructionRegionTopology, positions?: ReadonlyMap<string, ConstructionPosition>): Corners | undefined {
  const ids: Partial<Record<RampEnd, Partial<Record<RampSide, string>>>> = {};
  const at: Partial<Record<RampEnd, Partial<Record<RampSide, ConstructionPosition>>>> = {};
  for (const node of topology.nodes) {
    const corner = parseCorner(node.id);
    if (!corner) continue;
    (ids[corner.end] ??= {})[corner.side] = node.id;
    (at[corner.end] ??= {})[corner.side] = positions?.get(node.id) ?? node.position;
  }
  const complete = ENDS.every((end) => SIDES.every((side) => ids[end]?.[side] !== undefined));
  return complete ? { ids: ids as Corners["ids"], at: at as RampCorners } : undefined;
}

const midpoint = (a: ConstructionPosition, b: ConstructionPosition): ConstructionPosition => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

/** The plan-view unit direction from `from` to `to`, or `undefined` when they coincide. */
function direction(from: ConstructionPosition, to: ConstructionPosition): { readonly x: number; readonly z: number } | undefined {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return length < 1e-9 ? undefined : { x: dx / length, z: dz / length };
}

const axisOf = (at: RampCorners) => direction(midpoint(at.bottom.min, at.bottom.max), midpoint(at.top.min, at.top.max));

function edgeCorners(topology: ConstructionRegionTopology, edgeId: string) {
  const use = [...topology.outerLoops, ...topology.holes].flat().find((edge) => edge.edgeId === edgeId);
  if (!use) return undefined;
  const a = parseCorner(use.startNodeId), b = parseCorner(use.endNodeId);
  return a && b ? { a, b } : undefined;
}

function roleFor(topology: ConstructionRegionTopology, target: EditTarget): EditRole {
  if (target.kind === "region") return "ramp-region";
  if (target.kind === "vertex") {
    return parseCorner(target.nodeId) && topology.nodes.some((node) => node.id === target.nodeId) ? "ramp-corner" : "ramp-unknown";
  }
  const corners = edgeCorners(topology, target.edgeId);
  if (!corners) return "ramp-unknown";
  if (corners.a.end === corners.b.end) return "ramp-end";
  return corners.a.side === corners.b.side ? "ramp-side" : "ramp-unknown";
}

/** `delta` kept only along the plan direction `along`, plus its height when `keepHeight`. */
function projected(delta: ConstructionPosition, along: { readonly x: number; readonly z: number } | undefined, keepHeight: boolean): ConstructionPosition {
  const amount = along ? delta.x * along.x + delta.z * along.z : 0;
  return { x: along ? along.x * amount : 0, y: keepHeight ? delta.y : 0, z: along ? along.z * amount : 0 };
}

/** A corner widens or narrows its own end: it slides along that end's edge, and its twin mirrors it. */
function constrainCorner({ topology, target, delta }: ConstrainContext): ConstructionPosition {
  const corners = cornersOf(topology);
  const corner = target.kind === "vertex" ? parseCorner(target.nodeId) : undefined;
  if (!corners || !corner) return { x: 0, y: 0, z: 0 };
  const end = corners.at[corner.end];
  return projected(delta, direction(end[other(["min", "max"], corner.side)], end[corner.side]), false);
}

/** A side widens or narrows both ends together: it moves square to the axis, and the other side mirrors it. */
function constrainSide({ topology, delta }: ConstrainContext): ConstructionPosition {
  const corners = cornersOf(topology);
  const axis = corners && axisOf(corners.at);
  return projected(delta, axis && { x: -axis.z, z: axis.x }, false);
}

/** An end moves along the axis -- the ramp's length -- and up or down -- its rise. */
function constrainEnd({ topology, delta }: ConstrainContext): ConstructionPosition {
  const corners = cornersOf(topology);
  return projected(delta, corners && axisOf(corners.at), true);
}

function policyFor(role: EditRole): RolePolicy {
  switch (role) {
    case "ramp-corner": return { ...allowed(role, HORIZONTAL_AXES, "surface"), constrain: constrainCorner };
    case "ramp-side": return { ...allowed(role, HORIZONTAL_AXES, "surface"), constrain: constrainSide };
    case "ramp-end": return { ...allowed(role, ALL_AXES, "surface"), constrain: constrainEnd };
    case "ramp-region": return allowed(role, ALL_AXES, "cloud");
    default: return denied(role, "Edite a rampa pelos cantos, pelas bordas ou pelo corpo.");
  }
}

const sub = (a: ConstructionPosition, b: ConstructionPosition): ConstructionPosition => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const same = (a: ConstructionPosition, b: ConstructionPosition) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
/** `moved` mirrored across `centre` in plan, at `moved`'s own height so the end stays level. */
const mirrored = (centre: ConstructionPosition, moved: ConstructionPosition): ConstructionPosition => ({ x: 2 * centre.x - moved.x, y: moved.y, z: 2 * centre.z - moved.z });

/**
 * Keeps each ramp a symmetric trapezoid when some of its corners were moved:
 *
 * - one corner, or one whole side: each moved corner's twin mirrors it
 *   across its end's centre, so the width changes and the axis stays;
 * - one whole end, together: the other end follows only the part of the
 *   move square to the axis, so a floor carrying a welded end sideways drags
 *   the ramp with it, while moving that end along the axis or up changes
 *   the ramp's length or rise.
 *
 * Anything else is left for {@link validateRampMotion} to judge.
 */
export function deriveRampMotion(topologies: readonly ConstructionRegionTopology[], positions: ReadonlyMap<string, ConstructionPosition>): ReadonlyMap<string, ConstructionPosition> {
  const derived = new Map<string, ConstructionPosition>();
  for (const topology of topologies) {
    const corners = cornersOf(topology);
    if (!corners) continue;
    const moved = ENDS.flatMap((end) => SIDES.flatMap((side) => positions.has(corners.ids[end][side]) ? [{ end, side }] : []));
    const now = (end: RampEnd, side: RampSide) => positions.get(corners.ids[end][side])!;
    const place = (end: RampEnd, side: RampSide, position: ConstructionPosition) => {
      if (!positions.has(corners.ids[end][side])) derived.set(corners.ids[end][side], position);
    };
    const [first, second] = moved;
    const oneSide = moved.length === 2 && first!.side === second!.side;
    if (moved.length === 1 || oneSide) {
      for (const { end, side } of moved) place(end, other(["min", "max"], side), mirrored(midpoint(corners.at[end].min, corners.at[end].max), now(end, side)));
      continue;
    }
    if (moved.length !== 2 || first!.end !== second!.end) continue;
    const end = first!.end;
    const delta = sub(now(end, "min"), corners.at[end].min);
    if (!same(delta, sub(now(end, "max"), corners.at[end].max))) continue;
    const axis = axisOf(corners.at);
    if (!axis) continue;
    const across = projected(delta, { x: -axis.z, z: axis.x }, false);
    const far = other(["bottom", "top"], end);
    for (const side of SIDES) {
      const standing = corners.at[far][side];
      place(far, side, { x: standing.x + across.x, y: standing.y, z: standing.z + across.z });
    }
  }
  return derived;
}

/** Both ends level, square to the axis and on the same side of it, with a real length and width. */
export function validateRampMotion(topology: ConstructionRegionTopology, positions: ReadonlyMap<string, ConstructionPosition>): string | undefined {
  const corners = cornersOf(topology, positions);
  if (!corners) return "A rampa precisa dos seus quatro cantos.";
  const { at } = corners;
  if (ENDS.some((end) => Math.abs(at[end].min.y - at[end].max.y) > LEVEL)) return "As bordas da rampa devem permanecer niveladas.";
  const start = midpoint(at.bottom.min, at.bottom.max), finish = midpoint(at.top.min, at.top.max);
  const length = Math.hypot(finish.x - start.x, finish.z - start.z);
  if (length < MIN_SPAN) return "A rampa precisa de comprimento.";
  const ax = (finish.x - start.x) / length, az = (finish.z - start.z) / length;
  let turn: number | undefined;
  for (const end of ENDS) {
    const ex = at[end].max.x - at[end].min.x, ez = at[end].max.z - at[end].min.z;
    const width = Math.hypot(ex, ez);
    if (width < MIN_SPAN) return "As larguras da rampa devem ser positivas.";
    if (Math.abs(ex * ax + ez * az) / width > SQUARE) return "As bordas da rampa devem ficar perpendiculares ao eixo.";
    const sign = Math.sign(ax * ez - az * ex);
    if (turn !== undefined && sign !== turn) return "A rampa nao pode se torcer.";
    turn = sign;
  }
  return undefined;
}

/** The straight ramp's definition: edited by its corners, sides, ends and body, never carving the ground. */
export const rampStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: RAMP_SURFACE_TYPE, label: "Rampa",
  creation: "a symmetric trapezoid on an inclined plane: an axis and a width at each end",
  traits: Object.freeze([]),
  requiresMotionSolver: true,
  roleFor,
  policyFor,
  // A ramp climbs between levels above the ground; it never carves it.
  interactionOver: () => IGNORE,
  deriveMotion: deriveRampMotion,
  validateMotion: validateRampMotion,
});
