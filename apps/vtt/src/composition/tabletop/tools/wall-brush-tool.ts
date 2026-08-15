import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition, ConstructionSurfaceKey, ConstructionSurfaceSpec } from "@/ports";

import { buildGenerateWallOperation, type WallCornerRole } from "../default-map-seed.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { segmentBetween } from "./preview-shapes.ts";

/** Fixed wall height for a brush-drawn segment -- matches `room-seed.ts`'s own generated-room wall height range. */
const WALL_HEIGHT = 3;
const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };

/**
 * Walls have no thickness (`structure-generation/wall.rs`'s own doc: "the
 * fix is dropping the box extrusion, not adding anything"), so two walls
 * meeting at a corner is not a miter-geometry problem -- it is a shared-node
 * problem: if both walls' corner nodes are the *same* `NodeId`, the two flat
 * planes already meet exactly, for free, by the same graph-identity
 * principle `irregular-terrain-tool.ts`'s own weld already relies on. This
 * is the E7.3 "recognize shared edges/corners" mechanism: how close (3D --
 * unlike terrain's XZ-only weld, a wall's top and bottom must not cross-weld)
 * a new corner must land to an existing node before reusing its id instead
 * of minting a fresh one.
 *
 * Two cases are handled: a new wall's *endpoint* landing near an existing
 * corner welds onto it directly (`weldCornerOverrides`, below); a new wall
 * *crossing through the middle* of an existing wall's span instead splits
 * that existing wall in two via `splitSurface`, inserting a fresh shared
 * node pair at the crossing point (`findNearestWallCrossing`/
 * `splitCrossedWall`, further down) -- then the new wall is drawn as two
 * segments meeting at that same pair, welding onto it the ordinary way.
 *
 * v1 scope, deliberate: only the single nearest crossing per draw. A wall
 * crossing more than one existing wall only picks up the first; drawing it
 * again picks up the next. T-junctions where only one wall's endpoint (not
 * a full pass-through) lands mid-span are also covered by the same
 * crossing search, since it does not care whether the *new* wall continues
 * past the crossing or the gesture happened to end there.
 */
const WALL_WELD_EPSILON = 0.5;

interface ExistingWallNode {
  readonly id: ConstructionNodeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function nearestExistingCorner(
  point: ConstructionPosition,
  existing: readonly ExistingWallNode[],
): ConstructionNodeId | undefined {
  let best: ExistingWallNode | undefined;
  let bestDistanceSq = WALL_WELD_EPSILON * WALL_WELD_EPSILON;
  for (const candidate of existing) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    const dz = candidate.z - point.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq <= bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }
  return best?.id;
}

function weldCornerOverrides(
  ctx: ToolContext,
  start: ConstructionPosition,
  end: ConstructionPosition,
): Partial<Record<WallCornerRole, ConstructionNodeId>> {
  const existing: readonly ExistingWallNode[] = [...ctx.runtime.getSnapshot().map.nodePositions.values()].map(
    (entry) => ({ id: entry.nodeRef, x: entry.position.x, y: entry.position.y, z: entry.position.z }),
  );
  const startTop = { x: start.x, y: start.y + WALL_HEIGHT, z: start.z };
  const endTop = { x: end.x, y: end.y + WALL_HEIGHT, z: end.z };

  const overrides: Partial<Record<WallCornerRole, ConstructionNodeId>> = {};
  const startBottom = nearestExistingCorner(start, existing);
  if (startBottom !== undefined) overrides.startBottom = startBottom;
  const topOfStart = nearestExistingCorner(startTop, existing);
  if (topOfStart !== undefined) overrides.startTop = topOfStart;
  const endBottom = nearestExistingCorner(end, existing);
  if (endBottom !== undefined) overrides.endBottom = endBottom;
  const topOfEnd = nearestExistingCorner(endTop, existing);
  if (topOfEnd !== undefined) overrides.endTop = topOfEnd;
  return overrides;
}

/**
 * Two vertical posts (a node pair sharing one XZ, one at the base and one
 * `WALL_HEIGHT` above) an existing 4-node wall quad is built from --
 * recovered from *positions*, not from `orderedNodeRefs`' array order: a
 * `ConstructionSurfaceKey` is an unordered node-set identity
 * (`ports/construction-session-port.ts`'s own doc), so the array index
 * carries no cyclic/winding meaning to rely on here.
 */
interface WallPost {
  readonly bottomId: ConstructionNodeId;
  readonly topId: ConstructionNodeId;
  readonly x: number;
  readonly z: number;
  readonly bottomY: number;
  readonly topY: number;
}

function wallPostsFromNodes(
  nodeIds: readonly ConstructionNodeId[],
  existing: readonly ExistingWallNode[],
): readonly [WallPost, WallPost] | undefined {
  if (nodeIds.length !== 4) return undefined;
  const byId = new Map(existing.map((node) => [node.id, node]));
  const nodes = nodeIds.map((id) => byId.get(id)).filter((node): node is ExistingWallNode => node !== undefined);
  if (nodes.length !== 4) return undefined;

  const [first, ...rest] = nodes;
  if (first === undefined) return undefined;
  const sameXz = (a: ExistingWallNode, b: ExistingWallNode) =>
    Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
  const groupA = [first, ...rest.filter((node) => sameXz(node, first))];
  const groupB = rest.filter((node) => !sameXz(node, first));
  if (groupA.length !== 2 || groupB.length !== 2) return undefined; // not a simple vertical-post quad -- skip (e.g. an already-split, non-rectangular piece)

  const toPost = (group: readonly [ExistingWallNode, ExistingWallNode]): WallPost => {
    const [a, b] = group;
    const [bottom, top] = a.y <= b.y ? [a, b] : [b, a];
    return { bottomId: bottom.id, topId: top.id, x: bottom.x, z: bottom.z, bottomY: bottom.y, topY: top.y };
  };
  return [toPost(groupA as [ExistingWallNode, ExistingWallNode]), toPost(groupB as [ExistingWallNode, ExistingWallNode])];
}

/** Standard 2D segment intersection (XZ plane), parametrized 0..1 along each segment. `undefined` when parallel (including collinear). */
function segmentIntersection2D(
  p1: { readonly x: number; readonly z: number },
  p2: { readonly x: number; readonly z: number },
  p3: { readonly x: number; readonly z: number },
  p4: { readonly x: number; readonly z: number },
): { readonly t: number; readonly u: number } | undefined {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x;
  const d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-9) return undefined;
  const dx = p3.x - p1.x;
  const dz = p3.z - p1.z;
  const t = (dx * d2z - dz * d2x) / denom;
  const u = (dx * d1z - dz * d1x) / denom;
  return { t, u };
}

/**
 * How far (fraction along the *existing* wall) a crossing must sit from
 * that wall's own endpoints before it counts as a real mid-span crossing --
 * closer than this and it is what `weldCornerOverrides` already handles
 * (two walls sharing a corner), not a new node to insert. Only applies to
 * `u` (the existing wall) -- `t` (the new wall being drawn) has its own,
 * much smaller bound below, since a crossing landing at the new wall's own
 * endpoint is a legitimate T-junction (one segment, not two), not a case to
 * exclude.
 */
const CROSSING_ENDPOINT_GUARD = 0.05;
/**
 * `t` (along the new wall) must fall within its actual drawn span, not on
 * the line's extension past either end -- a tiny slop for float precision,
 * not a "too close to an end" exclusion. `t` at (or right next to) 0 is the
 * legitimate, intended case of starting a new wall's drag *from* a point on
 * an existing wall's middle, not something to reject: `onPointerUp`'s own
 * branching already treats a near-0/near-1 `t` as a one-segment T-junction.
 */
const CROSSING_T_SLOP = 1e-6;

interface WallCrossing {
  readonly originalKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
  readonly postA: WallPost;
  readonly postB: WallPost;
  /** Param along postA->postB (the *existing* wall) where the new wall crosses it, in (0, 1). */
  readonly u: number;
  /** Param along the *new* wall's own start->end where this crossing falls, in (0, 1). */
  readonly t: number;
}

/**
 * The nearest point (by `t` along the new wall) where the segment about to
 * be drawn crosses the *middle* of an existing wall -- E7.3's "passar por
 * cima" case: the new wall doesn't just touch an existing corner, it cuts
 * through an existing wall's span. v1 scope: only the single nearest
 * crossing is handled per draw; a wall crossing more than one existing wall
 * needs repeating this against the remaining sub-segments, not built yet.
 */
function findNearestWallCrossing(
  ctx: ToolContext,
  newStart: ConstructionPosition,
  newEnd: ConstructionPosition,
): WallCrossing | undefined {
  const map = ctx.runtime.getSnapshot().map;
  const existing: readonly ExistingWallNode[] = [...map.nodePositions.values()].map((entry) => ({
    id: entry.nodeRef,
    x: entry.position.x,
    y: entry.position.y,
    z: entry.position.z,
  }));

  let best: WallCrossing | undefined;
  for (const surface of map.byId.values()) {
    if (surface.type !== "wall-white" && surface.type !== "wall-gray") continue;
    const posts = wallPostsFromNodes(surface.orderedNodeRefs, existing);
    if (posts === undefined) continue;
    const [postA, postB] = posts;
    const hit = segmentIntersection2D(
      { x: newStart.x, z: newStart.z },
      { x: newEnd.x, z: newEnd.z },
      { x: postA.x, z: postA.z },
      { x: postB.x, z: postB.z },
    );
    if (hit === undefined) continue;
    if (hit.t < -CROSSING_T_SLOP || hit.t > 1 + CROSSING_T_SLOP) continue;
    if (hit.u <= CROSSING_ENDPOINT_GUARD || hit.u >= 1 - CROSSING_ENDPOINT_GUARD) continue;
    if (best === undefined || hit.t < best.t) {
      best = { originalKey: surface.orderedNodeRefs, surfaceType: surface.type, postA, postB, u: hit.u, t: hit.t };
    }
  }
  return best;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Splits `crossing`'s existing wall at its crossing point into two sibling quads, sharing a freshly inserted node pair with the new wall about to be drawn through it. */
function splitCrossedWall(ctx: ToolContext, sequence: number, crossing: WallCrossing): void {
  const { postA, postB, u } = crossing;
  const midBottomId: ConstructionNodeId = `${ctx.tableId}:brush-wall-${sequence}:cross-bottom`;
  const midTopId: ConstructionNodeId = `${ctx.tableId}:brush-wall-${sequence}:cross-top`;
  const midX = lerp(postA.x, postB.x, u);
  const midZ = lerp(postA.z, postB.z, u);
  // Interpolated from the two real posts (not assumed flat/equal-height) --
  // correct even if a future tool draws sloped or uneven-base walls.
  const bottomY = lerp(postA.bottomY, postB.bottomY, u);
  const topY = lerp(postA.topY, postB.topY, u);

  const nodes = [
    { id: midBottomId, position: { x: midX, y: bottomY, z: midZ } },
    { id: midTopId, position: { x: midX, y: topY, z: midZ } },
  ];
  const first: ConstructionSurfaceSpec = {
    cycle: [postA.bottomId, midBottomId, midTopId, postA.topId],
    surfaceType: crossing.surfaceType,
    physical: true,
  };
  const second: ConstructionSurfaceSpec = {
    cycle: [midBottomId, postB.bottomId, postB.topId, midTopId],
    surfaceType: crossing.surfaceType,
    physical: true,
  };
  ctx.runtime.applyWallCrossingSplit(
    nodes,
    [{ originalKey: crossing.originalKey, first, second }],
    "local",
    `${ctx.tableId}:brush-wall-crossing:${sequence}`,
  );
}

function commitWallSegment(
  ctx: ToolContext,
  sequence: number,
  start: ConstructionPosition,
  end: ConstructionPosition,
  params: WallBrushParams,
): void {
  const cornerOverrides = weldCornerOverrides(ctx, start, end);
  const operation = buildGenerateWallOperation(
    ctx.tableId,
    `brush-wall-${sequence}`,
    { operationId: `${ctx.tableId}:brush-wall:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
    { start, end, height: WALL_HEIGHT },
    // Door generation is a separate concern from wall-brush for now -- see
    // `WallBrushParams`'s own doc. `room-seed.ts`'s procedural room walls
    // still generate doors; this tool's straight segments do not.
    undefined,
    params.wallType,
    params.wallType,
    cornerOverrides,
  );
  ctx.runtime.generateWall(operation.payload, "local", operation.operationId);
}

/**
 * Click-drag to draw one wall segment: `onPointerDown` marks the start,
 * `onPointerMove` only updates the ghost (no commit -- closes the gap
 * `0005-edit-mode-interaction.md` flagged: "generate wall auto-places, does
 * not offer click-to-choose placement"), `onPointerUp` commits the real
 * segment from start to release point.
 */
export const wallBrushTool: ConstructionTool<"wall-brush"> = {
  id: "wall-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-brush"],

  previewFor(gesture: ToolGesture, params: WallBrushParams) {
    return segmentBetween(gesture.start.point, gesture.current.point, WALL_COLOR[params.wallType]);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    const sequence = ctx.nextSequence();
    const start = gesture.start.point;
    const end = gesture.current.point;

    const crossing = findNearestWallCrossing(ctx, start, end);
    if (crossing === undefined) {
      commitWallSegment(ctx, sequence, start, end, params);
      return;
    }

    // Insert the shared node pair and split the crossed wall *before*
    // drawing either half of the new wall, so `weldCornerOverrides` finds
    // and welds onto those brand new nodes exactly like any other existing
    // corner -- no separate weld path needed for the crossing point itself.
    splitCrossedWall(ctx, sequence, crossing);
    const crossPoint: ConstructionPosition = {
      x: lerp(start.x, end.x, crossing.t),
      y: start.y,
      z: lerp(start.z, end.z, crossing.t),
    };

    // A T-junction (the new wall's own tip lands at the crossing, not its
    // middle) needs only one segment -- the other "half" would be a
    // near-zero sliver. `crossing.t` close to 0/1 is exactly that case.
    if (crossing.t <= CROSSING_ENDPOINT_GUARD) {
      commitWallSegment(ctx, sequence, crossPoint, end, params);
    } else if (crossing.t >= 1 - CROSSING_ENDPOINT_GUARD) {
      commitWallSegment(ctx, sequence, start, crossPoint, params);
    } else {
      commitWallSegment(ctx, sequence, start, crossPoint, params);
      commitWallSegment(ctx, ctx.nextSequence(), crossPoint, end, params);
    }
  },
};
