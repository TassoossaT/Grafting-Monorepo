import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition, ConstructionSurfaceKey } from "@/ports";

import { projectOntoLineXZ, xzDistance, pinnedToBaseline } from "../shapes/geometry-2d.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { wallSpans } from "./wall-spans.ts";

export { xzDistance, pinnedToBaseline };

const WALL_SURFACE_TYPES = new Set(["wall-white", "wall-gray"]);
/** Perpendicular distance (world units) within which a point counts as landing "on" an existing wall's centerline. */
const CROSSING_TOLERANCE = 0.15;
/** How close (as a fraction of the wall's own length) a point may get to either of that wall's own corners and still count as a genuine mid-span crossing -- any closer and it's really just landing near a corner, which position-derived ids already weld for free without splitting anything. */
const CROSSING_END_MARGIN = 0.3;
/** Perpendicular distance (world units) within which a click counts as picking a wall panel directly, for `findWallSurfaceAt` -- a bit more forgiving than {@link CROSSING_TOLERANCE} since this is a deliberate click on the panel itself, not a drawing snap, and (unlike crossing detection) there is no exclusion near a panel's own corners -- picking right at a corner should still delete whichever panel is closest. */
const WALL_PICK_TOLERANCE = 0.2;

/** Fixed wall height for a brush/line-drawn segment, shared by both wall tools. */
export const WALL_HEIGHT = 3;
export const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };

/**
 * A single stable prefix for every wall structure on this table, shared by
 * `wall-brush-tool.ts` and `wall-line-tool.ts` -- a wall's corner ids are
 * derived purely from XZ position (`extrude_path`'s own doc), so anything
 * sharing this one prefix welds together for free wherever its corners
 * happen to coincide, without either tool needing to know about the other
 * -- "ligar casas" (E7's own wording) comes for free, and a free-form
 * stroke can weld onto a precise straight run and vice versa.
 */
export function idPrefixFor(ctx: ToolContext): string {
  return scopedToolId(ctx, "wall-brush");
}

/** Same position-derived id format as `structure_generation::ids::corner_id` -- must stay byte-identical so a manually-added split node welds onto whatever `extrude_path` mints at the same position under the same prefix. */
function cornerId(idPrefix: string, x: number, z: number, top: boolean): ConstructionNodeId {
  return `${idPrefix}:corner:${x.toFixed(3)}:${z.toFixed(3)}:${top ? "top" : "bottom"}`;
}

const projectOntoSegment = projectOntoLineXZ;

/**
 * If `point` lands within {@link CROSSING_TOLERANCE} of an existing wall
 * panel's own centerline, and far enough (per {@link CROSSING_END_MARGIN})
 * from either of that panel's own corners to be a genuine mid-span crossing
 * rather than basically hitting a corner already: subdivides that panel's
 * bottom and top runs at the projected point through `insertVertex`, and
 * returns the projected point snapped to the existing wall's own
 * baseline/top Y -- so the caller's own new wall welds onto the freshly
 * minted nodes by position, forming a T-junction ("quando eu crio uma a
 * partir da lateral de outra... da um snap neles para que eles grudem um no
 * outro").
 *
 * The crossed panel stays one region with more boundary, rather than being
 * replaced by two. Splitting it was only ever a way to get nodes at the
 * crossing point, which is exactly what an insert does directly -- and
 * unlike a split, it cannot desynchronize the panel's own two runs. Returns
 * `point` unchanged (a plain no-op) if no wall panel qualifies.
 */
export function resolveWallCrossing(ctx: ToolContext, point: ConstructionPosition, causeId: string): ConstructionPosition {
  for (const span of wallSpans(ctx)) {
    const spanLength = xzDistance(span.a, span.b);
    if (spanLength < 1e-6) continue;

    const { t, perp, x, z } = projectOntoSegment(point, span.a, span.b);
    if (perp > CROSSING_TOLERANCE) continue;
    const marginT = CROSSING_END_MARGIN / spanLength;
    if (t <= marginT || t >= 1 - marginT) continue;

    // One bottom edge and one top edge is the panel as `extrude_path` emits
    // it; a panel already welded at another crossing has more, and only the
    // run the point actually lands on should subdivide -- but a 4-node span
    // by definition has not been welded yet, so taking the single run of
    // each is exact, not a simplification.
    const bottomEdgeId = span.bottomEdgeIds[0];
    const topEdgeId = span.topEdgeIds[0];
    if (bottomEdgeId === undefined || topEdgeId === undefined) continue;

    const idPrefix = idPrefixFor(ctx);
    const bottomId = cornerId(idPrefix, x, z, false);
    const topId = cornerId(idPrefix, x, z, true);
    const bottomPos: ConstructionPosition = { x, y: span.a.y, z };
    const topPos: ConstructionPosition = { x, y: span.topY, z };

    ctx.runtime.applyWallCrossingWeld(
      [
        { edgeId: bottomEdgeId, nodeId: bottomId, position: bottomPos, firstEdgeId: `${bottomEdgeId}|${bottomId}|0`, secondEdgeId: `${bottomEdgeId}|${bottomId}|1` },
        { edgeId: topEdgeId, nodeId: topId, position: topPos, firstEdgeId: `${topEdgeId}|${topId}|0`, secondEdgeId: `${topEdgeId}|${topId}|1` },
      ],
      "local",
      causeId,
    );

    return bottomPos;
  }
  return point;
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
