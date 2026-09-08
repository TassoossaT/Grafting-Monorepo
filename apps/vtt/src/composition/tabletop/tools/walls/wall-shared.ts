import type { PreviewDescriptor, WallParams } from "@/features/edit-construction";
import type {
  ConstructionEdgeGeometry,
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSurfaceKey,
} from "@/ports";

import { projectOntoLineXZ, xzDistance, pinnedToBaseline } from "../shapes/geometry-2d.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { fitPath, type FittedEdge } from "../core/stroke-fitting.ts";
import { boundaryUsage, type EdgeSharing } from "../core/boundary-edges.ts";
import { brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import { wallPatch, type WallColumn, type WallContour } from "./wall-patch.ts";
import { wallSpans, type WallSpan } from "./wall-spans.ts";

export { xzDistance, pinnedToBaseline };

/**
 * The three tolerances below -- crossing, corner weld, and loop closure --
 * are **floors**, not fixed rules. A run carrying a correction budget of its
 * own (a brush stroke, whose budget is the brush reach the product leaves
 * unused) raises each of them to that budget.
 *
 * Without that, a wide brush produced a contradiction: the stroke was
 * straightened generously, yet still refused to weld onto a corner well
 * inside the very radius that licensed the straightening. What the budget
 * says is "everything within this distance is the same intention" -- and
 * joining is as much a consequence of that as straightening is. A run with
 * no budget at all, like a drawn line or a stamped preset, keeps the floor,
 * because a deliberate placement still has to snap to what it touches.
 */
/** Perpendicular distance (world units) within which a point counts as landing "on" an existing wall's centerline. */
const CROSSING_TOLERANCE = 0.15;
/** How close (as a fraction of the wall's own length) a point may get to either of that wall's own corners and still count as a genuine mid-span crossing -- any closer and it is really landing on the corner, which welds onto that corner's own nodes instead of splitting anything. */
const CROSSING_END_MARGIN = 0.3;
/** How close (world units, XZ) a new corner may sit to an existing wall's own corner and still be treated as that same corner -- the point at which the run being drawn stops minting nodes and references the existing ones instead. */
export const CORNER_WELD_TOLERANCE = 0.25;
/** Perpendicular distance (world units) within which a click counts as picking a wall panel directly, for `findWallSurfaceAt` -- a bit more forgiving than {@link CROSSING_TOLERANCE} since this is a deliberate click on the panel itself, not a drawing snap, and (unlike crossing detection) there is no exclusion near a panel's own corners: picking right at a corner should still delete whichever panel is closest. */
const WALL_PICK_TOLERANCE = 0.2;
/** How close (world units, XZ) two consecutive corners may be before the step between them is no wall at all -- a stroke held still, or a grid snap folding several samples onto one intersection. */
const DEGENERATE_STEP_TOLERANCE = 1e-3;
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
function existingColumnAt(
  ctx: ToolContext,
  point: ConstructionPosition,
  weldTolerance: number,
): { readonly column: WallColumn; readonly distance: number } | undefined {
  let best: { readonly column: WallColumn; readonly distance: number } | undefined;
  for (const span of wallSpans(ctx)) {
    for (const column of columnsOf(span)) {
      if (Math.abs(point.y - column.bottom.y) > 1e-3) continue;
      const distance = xzDistance(point, column.bottom);
      if (distance > weldTolerance) continue;
      if (best === undefined || distance < best.distance) best = { column, distance };
    }
  }
  return best;
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
  crossingTolerance: number,
): WallColumn | undefined {
  for (const span of wallSpans(ctx)) {
    if (Math.abs(point.y - span.a.y) > 1e-3) continue;
    const spanLength = xzDistance(span.a, span.b);
    if (spanLength < 1e-6) continue;

    const { t, perp, x, z } = projectOntoSegment(point, span.a, span.b);
    if (perp > crossingTolerance) continue;
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
/**
 * The closest platform vertex within `weldTolerance` (XZ) at the same
 * elevation (Y, `1e-3`) as `position`, or `undefined` -- the XZ half of
 * endpoint welding is a magnet, same tolerance a wall corner snaps onto
 * another wall's column with, never a reuse of a lower storey merely by XZ.
 */
function nearestPlatformNodeAt(
  ctx: ToolContext,
  position: ConstructionPosition,
  weldTolerance: number,
): { readonly node: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }; readonly distance: number } | undefined {
  let best: { readonly node: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }; readonly distance: number } | undefined;
  for (const region of ctx.runtime.getAllRegionTopologies()) {
    if (region.surfaceType !== "platform") continue;
    for (const node of region.nodes) {
      if (Math.abs(node.position.y - position.y) > 1e-3) continue;
      const distance = xzDistance(node.position, position);
      if (distance > weldTolerance) continue;
      if (best === undefined || distance < best.distance) best = { node, distance };
    }
  }
  return best;
}

/**
 * The single corner magnet both `resolveColumn` and its read-only preview
 * echo pull from: an existing wall column and a platform vertex are the same
 * strength, so whichever actually sits closer wins, rather than a wall
 * column shadowing a nearer platform vertex just by being checked first --
 * that priority order was the whole bug this fixes. Reusing a wall's own
 * column still carries its paired top id along; a platform vertex only ever
 * supplies one elevation, so its top is resolved separately by the caller.
 */
function nearestCornerAt(
  ctx: ToolContext,
  point: ConstructionPosition,
  weldTolerance: number,
): { readonly bottomNodeId: ConstructionNodeId; readonly topNodeId: ConstructionNodeId | undefined; readonly bottom: ConstructionPosition; readonly top: ConstructionPosition | undefined } | undefined {
  const wall = existingColumnAt(ctx, point, weldTolerance);
  const platform = nearestPlatformNodeAt(ctx, point, weldTolerance);
  if (wall !== undefined && (platform === undefined || wall.distance <= platform.distance)) {
    return { bottomNodeId: wall.column.bottomNodeId, topNodeId: wall.column.topNodeId, bottom: wall.column.bottom, top: wall.column.top };
  }
  if (platform !== undefined) {
    return { bottomNodeId: platform.node.id, topNodeId: undefined, bottom: platform.node.position, top: undefined };
  }
  return undefined;
}

function resolveColumn(
  ctx: ToolContext,
  point: ConstructionPosition,
  height: number,
  idPrefix: string,
  index: number,
  causeId: string,
  correction: number,
): WallColumn {
  const mint = () => ({
    bottomNodeId: `${idPrefix}:c${index}:bottom`,
    topNodeId: `${idPrefix}:c${index}:top`,
  });
  const weldTolerance = Math.max(CORNER_WELD_TOLERANCE, correction);
  const corner = nearestCornerAt(ctx, point, weldTolerance);
  if (corner !== undefined) {
    const top = { x: point.x, y: point.y + height, z: point.z };
    // The corner's own paired top (an existing wall column) wins outright.
    // A bare platform vertex has no top of its own -- what it welds the
    // post's *top* onto is still only ever another platform vertex, never
    // another wall's unrelated base that merely happens to sit at the same
    // height: two walls at different elevations lining up by coincidence is
    // not the same intention as a post actually landing on a floor.
    const upper = corner.topNodeId !== undefined ? undefined : nearestPlatformNodeAt(ctx, top, weldTolerance);
    return {
      bottomNodeId: corner.bottomNodeId,
      topNodeId: corner.topNodeId ?? upper?.node.id ?? mint().topNodeId,
      bottom: corner.bottom,
      top: corner.top ?? upper?.node.position ?? top,
    };
  }
  const inserted = insertedColumnAt(ctx, point, mint, causeId, Math.max(CROSSING_TOLERANCE, correction));
  if (inserted !== undefined) return inserted;
  const { bottomNodeId, topNodeId } = mint();
  return { bottomNodeId, topNodeId, bottom: point, top: { x: point.x, y: point.y + height, z: point.z } };
}

/**
 * A read-only echo of {@link resolveColumn}'s own corner magnet, for showing
 * where a run will actually land before it commits. Never mints or inserts
 * anything (unlike {@link resolveColumn}, it must stay safe to call every
 * frame of a drag), so a corner that would only resolve by T-junction
 * insertion still previews at the raw point; the commit itself is unaffected.
 */
export function snappedEndpoint(ctx: ToolContext, point: ConstructionPosition, correction = 0): ConstructionPosition {
  return nearestCornerAt(ctx, point, Math.max(CORNER_WELD_TOLERANCE, correction))?.bottom ?? point;
}

/**
 * The corner-to-corner skeleton a stroke will actually commit as: the same
 * fit {@link commitWallStroke} runs, each resulting corner echoed through
 * {@link snappedEndpoint}. This is what a preview is for -- showing the
 * correction and the weld before release, not a decoration on top of the raw
 * hand -- so both wall tools draw from this one function rather than each
 * approximating it their own way. An arc corrects the same as a straight
 * run; only its two endpoints are shown here, not its curvature, the same
 * simplification every other preview in this codebase already makes.
 */
export function correctedWallCorners(
  ctx: ToolContext,
  samples: readonly ConstructionPosition[],
  tolerance = 0,
): readonly ConstructionPosition[] {
  const first = samples[0];
  if (first === undefined) return [];
  const pinned = samples.map((sample) => pinnedToBaseline(first, sample));
  const fitted = fitPath(pinned, tolerance, { arcs: !ctx.snapToGrid });
  const corners = fitted.length > 0 ? [fitted[0]!.start, ...fitted.map((edge) => edge.end)] : pinned;
  return corners.map((corner) => snappedEndpoint(ctx, corner, tolerance));
}

/**
 * The one wall preview, both tools draw it: a filled band along
 * {@link correctedWallCorners}, wide enough to read as the budget that let
 * the hand drift this far and still weld -- a thin centerline alone showed
 * the correct result but not *why* it was correct, which is what read as
 * "not really snapping." The floor is {@link CORNER_WELD_TOLERANCE} itself,
 * so a zero-tolerance straight line still shows its own magnet reach.
 */
export function wallCorrectionPreview(
  ctx: ToolContext,
  samples: readonly ConstructionPosition[],
  tolerance: number,
  color: number,
): PreviewDescriptor {
  const corners = correctedWallCorners(ctx, samples, tolerance);
  return brushSweptRegionFill(corners, { kind: "circle", radius: Math.max(tolerance, CORNER_WELD_TOLERANCE) }, color);
}

/**
 * The columns a fitted run passes through and the geometry of each step
 * between them, with degenerate steps dropped and closure resolved.
 *
 * A corner landing on the one before it is not a corner: it is the same
 * place twice, which a held pointer or a grid snap folding several samples
 * onto one intersection both produce. Kept, it would declare a panel of no
 * width between two columns standing at one spot.
 */
function contourOf(fitted: readonly FittedEdge[], closeTolerance: number): {
  readonly points: readonly ConstructionPosition[];
  readonly geometries: readonly ConstructionEdgeGeometry[];
  readonly closed: boolean;
} {
  const first = fitted[0];
  if (first === undefined) return { points: [], geometries: [], closed: false };

  const points: ConstructionPosition[] = [first.start];
  const geometries: ConstructionEdgeGeometry[] = [];
  for (const edge of fitted) {
    const previous = points[points.length - 1];
    if (previous !== undefined && xzDistance(previous, edge.end) <= DEGENERATE_STEP_TOLERANCE) continue;
    points.push(edge.end);
    geometries.push(edge.geometry);
  }

  // A run that came back to where it started has no seam: its last step
  // lands on the first column rather than on a fifth one of its own.
  const last = points[points.length - 1];
  const start = points[0];
  const closed =
    points.length > 3 &&
    last !== undefined &&
    start !== undefined &&
    xzDistance(last, start) <= closeTolerance;
  return { points: closed ? points.slice(0, -1) : points, geometries, closed };
}

/**
 * Commits a fitted run of contour edges as walls, in one transaction.
 *
 * This is the only path a wall is ever built by. A free stroke, a straight
 * drag and a tower preset differ in nothing but the contour they hand over:
 * they all resolve their corners the same way, claim their edges the same
 * way, and declare the same faces. Nothing here knows which tool called it,
 * and nothing downstream is told any of it is a wall.
 */
export function commitWallContour(
  ctx: ToolContext,
  fitted: readonly FittedEdge[],
  params: WallParams,
  domain: string,
  correction = 0,
): void {
  if (fitted.length === 0) return;
  const sequence = ctx.nextSequence();
  const causeId = scopedToolId(ctx, domain, sequence);
  const idPrefix = scopedToolId(ctx, `wall-${sequence}`);

  const { points, geometries, closed } = contourOf(fitted, Math.max(CONTOUR_CLOSE_TOLERANCE, correction));
  if (points.length < 2) return;

  const columns = points.map((point, index) =>
    resolveColumn(ctx, point, params.height, idPrefix, index, causeId, correction),
  );
  const contour: WallContour = { columns, geometries, closed };
  // Any number of walls may stand on one column, so a run keeps its own
  // edge wherever the shared one is full rather than losing the face.
  const sharing: EdgeSharing = {
    kind: "private-when-full",
    runPrefix: idPrefix,
    existingUses: boundaryUsage(ctx),
  };

  const outcome = ctx.runtime.addPatch(wallPatch(ctx.tableId, contour, params.wallType, sharing), "local", causeId);
  // A refused panel used to be the whole of this bug and left no trace at
  // all. Claiming edges against the live graph should make it unreachable
  // now, so say so out loud rather than letting it go quiet again.
  if (outcome.skippedRegionIds.length > 0) {
    ctx.reportFeedback({
      tone: "error",
      message: `Parede: ${outcome.skippedRegionIds.length} face nao coube sobre o que ja existe ali.`,
    });
  }
}

/**
 * Fits a raw stroke and commits it, the free-brush entry point --
 * `tolerance` is the brush's own radius, so a radius of 0 commits the drawn
 * contour literally and a wider brush corrects a shakier stroke into clean
 * straight runs and true arcs.
 *
 * With the grid magnet on, the stroke is already a sequence of exact grid
 * intersections: the hand is no longer what the samples describe, so there
 * is no hand tremor to read curvature out of, and the circle through any
 * three staircase points is a real circle that was never drawn. Arcs are
 * off in that mode for that reason -- snapped means deliberate, and what
 * was placed deliberately is what gets built.
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
  commitWallContour(ctx, fitPath(pinned, tolerance, { arcs: !ctx.snapToGrid }), params, domain, tolerance);
}
