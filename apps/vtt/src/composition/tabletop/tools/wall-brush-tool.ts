import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition, PathEdgeSpec } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

/** Fixed wall height for a brush-drawn segment -- matches `room-seed.ts`'s own generated-room wall height range. */
const WALL_HEIGHT = 3;
const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };
/** No curved edges from this tool yet -- reserved for a future arc-drawing gesture. Ignored by the engine while every edge is `"straight"`. */
const ARC_FACETS = 12;
/**
 * How close (XZ) a new click must land to the path's own first point before
 * it counts as closing the loop instead of extending it -- world units, half
 * a grid cell (`construction-grid-scene-item.ts`'s `MINOR_CELL_SIZE`).
 */
const CLOSE_DISTANCE = 0.5;

function xzDistance(a: ConstructionPosition, b: ConstructionPosition): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function pathEdges(points: readonly ConstructionPosition[]): readonly PathEdgeSpec[] {
  const edges: PathEdgeSpec[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === undefined || end === undefined) continue;
    edges.push({ start, end, curvature: "straight" });
  }
  return edges;
}

/**
 * The in-progress pen stroke's own accumulated corner points -- lives for as
 * long as the wall-brush tool keeps drawing one continuous structure, the
 * same "dies with the gesture, cheap full resend" lifetime
 * `house-brush-tool.ts`'s own `activeSession` uses, except here the gesture
 * is a chain of clicks (`onClick`), not a drag.
 */
let activePath: ConstructionPosition[] | undefined;

/**
 * A single stable prefix for every wall-brush structure on this table --
 * unlike `house-brush-tool.ts`'s cell-grid ids, a wall path's corner ids are
 * derived purely from XZ position (`generate_wall_path`'s own doc), so two
 * separate loops sharing this one prefix still weld together for free
 * wherever their corners happen to coincide, without either loop needing to
 * know about the other -- "ligar casas" (E7's own wording) comes for free.
 */
function idPrefixFor(ctx: ToolContext): string {
  return `${ctx.tableId}:wall-brush`;
}

function commitPath(ctx: ToolContext, points: readonly ConstructionPosition[], params: WallBrushParams): void {
  const edges = pathEdges(points);
  if (edges.length === 0) return;
  const sequence = ctx.nextSequence();
  ctx.runtime.generatePathExtrusion(
    {
      edges,
      height: WALL_HEIGHT,
      arcFacets: ARC_FACETS,
      idPrefix: idPrefixFor(ctx),
      surfaceType: params.wallType,
    },
    "local",
    `${ctx.tableId}:wall-brush:${sequence}`,
  );
}

/**
 * Caps a just-closed loop's own footprint with a flat floor + ceiling,
 * via `generateBoundaryCap` -- `generatePathExtrusion` never generates a
 * cap itself (`ADR-0022`'s generation/orchestration split). `points`
 * already forms a closed polygon (its last entry repeats the first), so
 * this reuses it directly rather than rasterizing it into grid cells and
 * routing through `generateRegionPartition`'s auto-subdivision -- a
 * closed wall-brush loop always becomes exactly one room for now; the
 * subdivide-on-close behavior `region_partition` supports is `house-brush-tool.ts`'s
 * own path (whole cell grid painted at once), not this pointwise pen.
 */
function commitClosure(ctx: ToolContext, points: readonly ConstructionPosition[]): void {
  const first = points[0];
  if (first === undefined) return;
  const idPrefix = idPrefixFor(ctx);
  const bottom = points.map((point) => ({ x: point.x, y: first.y, z: point.z }));
  const top = points.map((point) => ({ x: point.x, y: first.y + WALL_HEIGHT, z: point.z }));
  const sequence = ctx.nextSequence();
  ctx.runtime.generateBoundaryCap(
    { points: bottom, idPrefix, surfaceType: "floor", top: false },
    "local",
    `${ctx.tableId}:wall-brush:${sequence}:floor`,
  );
  ctx.runtime.generateBoundaryCap(
    { points: top, idPrefix, surfaceType: "ceiling", top: true },
    "local",
    `${ctx.tableId}:wall-brush:${sequence}:ceiling`,
  );
}

/**
 * Click to place each corner of a continuous wall -- straight segments for
 * now (see `ARC_FACETS`'s own doc). Clicking back near the loop's own first
 * corner closes it: the closing segment's own `generatePathExtrusion` call
 * lands first, then {@link commitClosure} caps the now-closed footprint
 * with a floor + ceiling -- no separate "derive room" click needed. Every
 * tick resends the whole path so far (`GeneratePathExtrusionRequest`'s own
 * doc on why that's cheap), so a stroke abandoned mid-loop leaves exactly
 * the open fence it already drew, nothing more.
 */
export const wallBrushTool: ConstructionTool<"wall-brush"> = {
  id: "wall-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-brush"],

  previewFor(gesture: ToolGesture, params: WallBrushParams) {
    const path = activePath;
    if (path === undefined || path.length === 0) return undefined;

    const committed = pathEdges(path).flatMap((edge) => [
      edge.start.x, edge.start.y, edge.start.z,
      edge.end.x, edge.end.y, edge.end.z,
    ]);
    const last = path[path.length - 1];
    const ghost = last === undefined
      ? []
      : [last.x, last.y, last.z, gesture.current.point.x, gesture.current.point.y, gesture.current.point.z];

    return { kind: "segments", color: WALL_COLOR[params.wallType], opacity: 0.7, positions: Float32Array.from([...committed, ...ghost]) };
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: WallBrushParams): void {
    if (activePath === undefined) {
      activePath = [sample.point];
      return;
    }

    // Every corner shares the stroke's own first point's Y -- a later hover
    // sample landing on a different surface (a step, a sloped terrain tile)
    // must not desync the path's baseline, or `extrude_path` rejects the
    // whole stroke as `InconsistentBaseline`.
    const first = activePath[0];
    const point: ConstructionPosition = first === undefined ? sample.point : { ...sample.point, y: first.y };
    const closing = first !== undefined && activePath.length >= 3 && xzDistance(point, first) <= CLOSE_DISTANCE;
    const nextPoints = closing && first !== undefined ? [...activePath, first] : [...activePath, point];

    commitPath(ctx, nextPoints, params);
    if (closing) commitClosure(ctx, nextPoints);

    activePath = closing ? undefined : nextPoints;
  },
};
