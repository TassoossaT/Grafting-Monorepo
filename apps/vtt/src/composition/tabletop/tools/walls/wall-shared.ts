import type { WallParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition, ConstructionSurfaceKey } from "@/ports";

import { projectOntoLineXZ, xzDistance, pinnedToBaseline } from "../shapes/geometry-2d.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { fitPath, type FittedEdge } from "./path-fitting.ts";
import { wallPatch, type WallColumn, type WallContour } from "./wall-patch.ts";
import { wallSpans, type WallSpan } from "./wall-spans.ts";

export { xzDistance, pinnedToBaseline };

/** Perpendicular distance (world units) within which a point counts as landing "on" an existing wall's centerline. */
const CROSSING_TOLERANCE = 0.15;
/** How close (as a fraction of the wall's own length) a point may get to either of that wall's own corners and still count as a genuine mid-span crossing -- any closer and it is really landing on the corner, which welds onto that corner's own nodes instead of splitting anything. */
const CROSSING_END_MARGIN = 0.3;
/** How close (world units, XZ) a new corner may sit to an existing wall's own corner and still be treated as that same corner -- the point at which the run being drawn stops minting nodes and references the existing ones instead. */
const CORNER_WELD_TOLERANCE = 0.25;
/** Perpendicular distance (world units) within which a click counts as picking a wall panel directly, for `findWallSurfaceAt` -- a bit more forgiving than {@link CROSSING_TOLERANCE} since this is a deliberate click on the panel itself, not a drawing snap, and (unlike crossing detection) there is no exclusion near a panel's own corners: picking right at a corner should still delete whichever panel is closest. */
const WALL_PICK_TOLERANCE = 0.2;
/** How close (world units, XZ) a run's own last corner must land to its first for the run to be treated as closed -- what turns a stroke drawn all the way round into a closed loop of panels rather than one with a seam. */
const CONTOUR_CLOSE_TOLERANCE = 0.5;

/** Default length of a panel's own vertical edge, for callers with no height parameter of their own. */
export const WALL_HEIGHT = 3;
export const WALL_COLOR: Record<WallParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };

const projectOntoSegment = projectOntoLineXZ;

/** Both extremities of one existing panel, as columns a new run can weld onto directly. */
function columnsOf(span: WallSpan): readonly WallColumn[] {
  return [
    {
      bottomNodeId: span.bottomA,
      topNodeId: span.topA,
      bottom: span.a,
      top: { x: span.a.x, y: span.topY, z: span.a.z },
    },
    {
      bottomNodeId: span.bottomB,
      topNodeId: span.topB,
      bottom: span.b,
      top: { x: span.b.x, y: span.topY, z: span.b.z },
    },
  ];
}

/**
 * The existing column a new corner should simply *be*, if one is close
 * enough -- not a position to copy, the very nodes.
 *
 * This is the whole of welding. Two walls are joined because they reference
 * one column, never because two independently minted columns happened to
 * land on the same coordinate: coincident is not connected. Which also means
 * the engine is never asked to notice a coincidence, because there is none
 * to notice.
 */
function existingColumnAt(ctx: ToolContext, point: ConstructionPosition): WallColumn | undefined {
  let best: { readonly column: WallColumn; readonly distance: number } | undefined;
  for (const span of wallSpans(ctx)) {
    for (const column of columnsOf(span)) {
      const distance = xzDistance(point, column.bottom);
      if (distance > CORNER_WELD_TOLERANCE) continue;
      if (best === undefined || distance < best.distance) best = { column, distance };
    }
  }
  return best?.column;
}

/**
 * If `point` lands on the *side* of an existing panel rather than at one of
 * its corners, subdivides that panel's own bottom and top runs there and
 * returns the freshly inserted column -- a T-junction.
 *
 * The crossed panel stays one region with more boundary. A vertex sitting
 * partway along an edge does not divide a wall; only an edge running side to
 * side does. So the insert adds exactly what the junction needs -- nodes to
 * connect to -- and changes nothing about what the crossed wall is.
 */
function insertedColumnAt(
  ctx: ToolContext,
  point: ConstructionPosition,
  mint: () => { readonly bottomNodeId: ConstructionNodeId; readonly topNodeId: ConstructionNodeId },
  causeId: string,
): WallColumn | undefined {
  for (const span of wallSpans(ctx)) {
    const spanLength = xzDistance(span.a, span.b);
    if (spanLength < 1e-6) continue;

    const { t, perp, x, z } = projectOntoSegment(point, span.a, span.b);
    if (perp > CROSSING_TOLERANCE) continue;
    const marginT = CROSSING_END_MARGIN / spanLength;
    if (t <= marginT || t >= 1 - marginT) continue;

    const bottomEdgeId = span.bottomEdgeIds[0];
    const topEdgeId = span.topEdgeIds[0];
    if (bottomEdgeId === undefined || topEdgeId === undefined) continue;

    const { bottomNodeId, topNodeId } = mint();
    const bottom: ConstructionPosition = { x, y: span.a.y, z };
    const top: ConstructionPosition = { x, y: span.topY, z };

    ctx.runtime.applyWallCrossingWeld(
      [
        { edgeId: bottomEdgeId, nodeId: bottomNodeId, position: bottom, firstEdgeId: `${bottomEdgeId}|${bottomNodeId}|0`, secondEdgeId: `${bottomEdgeId}|${bottomNodeId}|1` },
        { edgeId: topEdgeId, nodeId: topNodeId, position: top, firstEdgeId: `${topEdgeId}|${topNodeId}|0`, secondEdgeId: `${topEdgeId}|${topNodeId}|1` },
      ],
      "local",
      causeId,
    );

    return { bottomNodeId, topNodeId, bottom, top };
  }
  return undefined;
}

/**
 * The wall panel whose own centerline `point` lands closest to (XZ only,
 * within {@link WALL_PICK_TOLERANCE}), or `undefined` if none qualify --
 * `house-room-delete-tool.ts`'s single-surface delete: a click that lands
 * directly on a wall removes just that one panel, distinct from a click on
 * open floor inside a room, which removes every wall bounding it instead.
 */
export function findWallSurfaceAt(ctx: ToolContext, point: ConstructionPosition): ConstructionSurfaceKey | undefined {
  let best: { readonly surfaceKey: ConstructionSurfaceKey; readonly perp: number } | undefined;
  for (const span of wallSpans(ctx)) {
    const { perp } = projectOntoSegment(point, span.a, span.b);
    if (perp > WALL_PICK_TOLERANCE) continue;
    if (best === undefined || perp < best.perp) best = { surfaceKey: span.surfaceKey, perp };
  }
  return best?.surfaceKey;
}

/**
 * Resolves one corner of a run being drawn into the column it should use:
 * an existing panel's own column if the corner lands on one, a column
 * inserted into an existing panel's side if it lands there, and otherwise a
 * fresh pair of nodes minted for this run alone.
 *
 * Fresh ids are namespaced by the run, never derived from the coordinate.
 * Two runs drawn over the same spot stay two separate walls unless one of
 * them was actually resolved onto the other's nodes, which is the rule the
 * whole type is built on.
 */
function resolveColumn(
  ctx: ToolContext,
  point: ConstructionPosition,
  height: number,
  idPrefix: string,
  index: number,
  causeId: string,
): WallColumn {
  const mint = () => ({
    bottomNodeId: `${idPrefix}:c${index}:bottom`,
    topNodeId: `${idPrefix}:c${index}:top`,
  });
  const existing = existingColumnAt(ctx, point);
  if (existing !== undefined) return existing;
  const inserted = insertedColumnAt(ctx, point, mint, causeId);
  if (inserted !== undefined) return inserted;
  const { bottomNodeId, topNodeId } = mint();
  return {
    bottomNodeId,
    topNodeId,
    bottom: point,
    top: { x: point.x, y: point.y + height, z: point.z },
  };
}

/** The corner points of a fitted run, and whether the run closed back onto itself. */
function cornersOf(fitted: readonly FittedEdge[]): { readonly points: readonly ConstructionPosition[]; readonly closed: boolean } {
  const first = fitted[0];
  const last = fitted[fitted.length - 1];
  if (first === undefined || last === undefined) return { points: [], closed: false };

  const points = [first.start, ...fitted.map((edge) => edge.end)];
  const closed = points.length > 3 && xzDistance(last.end, first.start) <= CONTOUR_CLOSE_TOLERANCE;
  return { points: closed ? points.slice(0, -1) : points, closed };
}

/**
 * Commits a fitted run of contour edges as walls, in one transaction.
 *
 * This is the only path a wall is ever built by. A free stroke, a straight
 * drag and a tower preset differ in nothing but the contour they hand over:
 * they all resolve their corners the same way, share the same edges, and
 * declare the same faces. Nothing here knows which tool called it, and
 * nothing downstream is told any of it is a wall.
 */
export function commitWallContour(
  ctx: ToolContext,
  fitted: readonly FittedEdge[],
  params: WallParams,
  domain: string,
): void {
  if (fitted.length === 0) return;
  const sequence = ctx.nextSequence();
  const causeId = scopedToolId(ctx, domain, sequence);
  const idPrefix = scopedToolId(ctx, `wall-${sequence}`);

  const { points, closed } = cornersOf(fitted);
  if (points.length < 2) return;

  const columns = points.map((point, index) => resolveColumn(ctx, point, params.height, idPrefix, index, causeId));
  const contour: WallContour = { columns, geometries: fitted.map((edge) => edge.geometry), closed };

  ctx.runtime.addPatch(wallPatch(ctx.tableId, contour, params.wallType), "local", causeId);
}

/**
 * Fits a raw stroke and commits it, the free-brush entry point --
 * `tolerance` is the brush's own radius, so a radius of 0 commits the drawn
 * contour literally and a wider brush corrects a shakier stroke into clean
 * straight runs and true arcs.
 */
export function commitWallStroke(
  ctx: ToolContext,
  samples: readonly ConstructionPosition[],
  tolerance: number,
  params: WallParams,
  domain: string,
): void {
  const first = samples[0];
  if (first === undefined) return;
  const pinned = samples.map((sample) => pinnedToBaseline(first, sample));
  commitWallContour(ctx, fitPath(pinned, tolerance), params, domain);
}
