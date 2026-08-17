import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition, ConstructionSurfaceKey } from "@/ports";

import type { ToolContext } from "./tool-context.ts";

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
  return `${ctx.tableId}:wall-brush`;
}

/**
 * Pins `point`'s Y to `baseline`'s -- a later drag/click sample landing on a
 * different surface (a step, a sloped terrain tile) must not desync a
 * path's baseline, or `extrude_path` rejects the whole thing as
 * `InconsistentBaseline`.
 */
export function pinnedToBaseline(baseline: ConstructionPosition, point: ConstructionPosition): ConstructionPosition {
  return { ...point, y: baseline.y };
}

export function xzDistance(a: ConstructionPosition, b: ConstructionPosition): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Same position-derived id format as `structure_generation::ids::corner_id` -- must stay byte-identical so a manually-added split node welds onto whatever `extrude_path` mints at the same position under the same prefix. */
function cornerId(idPrefix: string, x: number, z: number, top: boolean): ConstructionNodeId {
  return `${idPrefix}:corner:${x.toFixed(3)}:${z.toFixed(3)}:${top ? "top" : "bottom"}`;
}

interface WallSpan {
  readonly surfaceKey: readonly ConstructionNodeId[];
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly bottomA: ConstructionNodeId;
  readonly bottomB: ConstructionNodeId;
  readonly topA: ConstructionNodeId;
  readonly topB: ConstructionNodeId;
  readonly a: ConstructionPosition;
  readonly b: ConstructionPosition;
  readonly topY: number;
}

/**
 * Every 4-node wall panel currently on the table, with its two vertical
 * posts recovered by grouping nodes that share an XZ position (a
 * `ConstructionSurfaceKey` is an unordered node-set identity, so this
 * cannot assume array order) -- mirrors `room-lookup.ts`'s own `wallSpans`,
 * kept separate since that one only needs XZ posts for room-tracing while
 * this needs the full 3D positions plus the surface's own key/type/physical
 * flag to actually split it.
 */
function wallSpans(ctx: ToolContext): readonly WallSpan[] {
  const map = ctx.runtime.getSnapshot().map;
  const spans: WallSpan[] = [];

  for (const surface of map.byId.values()) {
    if (!WALL_SURFACE_TYPES.has(surface.type)) continue;
    if (surface.orderedNodeRefs.length !== 4) continue;
    const nodes = surface.orderedNodeRefs
      .map((id) => map.nodePositions.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (nodes.length !== 4) continue;

    const [first, ...rest] = nodes;
    if (first === undefined) continue;
    const sameXz = (a: (typeof nodes)[number], b: (typeof nodes)[number]) =>
      Math.abs(a.position.x - b.position.x) < 1e-3 && Math.abs(a.position.z - b.position.z) < 1e-3;
    const groupA = [first, ...rest.filter((node) => sameXz(node, first))];
    const groupB = rest.filter((node) => !sameXz(node, first));
    if (groupA.length !== 2 || groupB.length !== 2) continue;

    const [a0, a1] = groupA.sort((x, y) => x.position.y - y.position.y) as [(typeof nodes)[number], (typeof nodes)[number]];
    const [b0, b1] = groupB.sort((x, y) => x.position.y - y.position.y) as [(typeof nodes)[number], (typeof nodes)[number]];
    spans.push({
      surfaceKey: surface.orderedNodeRefs,
      surfaceType: surface.type,
      physical: surface.physical,
      bottomA: a0.nodeRef,
      topA: a1.nodeRef,
      bottomB: b0.nodeRef,
      topB: b1.nodeRef,
      a: a0.position,
      b: b0.position,
      topY: a1.position.y,
    });
  }
  return spans;
}

/** `point` projected onto the infinite line through `a`/`b` (XZ only): how far along the segment (`t`, `0` at `a`, `1` at `b`) and how far off it (`perp`, world units). */
function projectOntoSegment(point: ConstructionPosition, a: ConstructionPosition, b: ConstructionPosition): { t: number; perp: number; x: number; z: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-9) return { t: 0, perp: xzDistance(point, a), x: a.x, z: a.z };

  const apx = point.x - a.x;
  const apz = point.z - a.z;
  const t = (apx * abx + apz * abz) / lengthSq;
  const x = a.x + t * abx;
  const z = a.z + t * abz;
  return { t, perp: Math.hypot(point.x - x, point.z - z), x, z };
}

/**
 * If `point` lands within {@link CROSSING_TOLERANCE} of an existing wall
 * panel's own centerline, and far enough (per {@link CROSSING_END_MARGIN})
 * from either of that panel's own corners to be a genuine mid-span
 * crossing rather than basically hitting a corner already: splits that
 * panel in two at the projected point (via `TabletopRuntime.applyWallCrossingSplit`)
 * and returns the projected point, snapped to the existing wall's own
 * baseline/top Y so the caller's own new wall welds onto the freshly-split
 * nodes by position, forming a T-junction -- "quando eu crio uma a partir
 * da lateral de outra... da um snap neles para que eles grudem um no
 * outro." Returns `point` unchanged (a plain no-op) if no wall panel
 * qualifies.
 */
export function resolveWallCrossing(ctx: ToolContext, point: ConstructionPosition, causeId: string): ConstructionPosition {
  for (const span of wallSpans(ctx)) {
    const spanLength = xzDistance(span.a, span.b);
    if (spanLength < 1e-6) continue;

    const { t, perp, x, z } = projectOntoSegment(point, span.a, span.b);
    if (perp > CROSSING_TOLERANCE) continue;
    const marginT = CROSSING_END_MARGIN / spanLength;
    if (t <= marginT || t >= 1 - marginT) continue;

    const idPrefix = idPrefixFor(ctx);
    const bottomId = cornerId(idPrefix, x, z, false);
    const topId = cornerId(idPrefix, x, z, true);
    const bottomPos: ConstructionPosition = { x, y: span.a.y, z };
    const topPos: ConstructionPosition = { x, y: span.topY, z };

    ctx.runtime.applyWallCrossingSplit(
      [
        { id: bottomId, position: bottomPos },
        { id: topId, position: topPos },
      ],
      [
        {
          originalKey: span.surfaceKey,
          first: { cycle: [span.bottomA, bottomId, topId, span.topA], surfaceType: span.surfaceType, physical: span.physical },
          second: { cycle: [bottomId, span.bottomB, span.topB, topId], surfaceType: span.surfaceType, physical: span.physical },
        },
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
