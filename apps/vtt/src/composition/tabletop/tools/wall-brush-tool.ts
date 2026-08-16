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
  ctx.runtime.generateWallPath(
    {
      edges,
      wallHeight: WALL_HEIGHT,
      arcFacets: ARC_FACETS,
      idPrefix: idPrefixFor(ctx),
      wallType: params.wallType,
      floorType: "floor",
      ceilingType: "ceiling",
    },
    "local",
    `${ctx.tableId}:wall-brush:${sequence}`,
  );
}

/**
 * Click to place each corner of a continuous wall -- straight segments for
 * now (see `ARC_FACETS`'s own doc). Clicking back near the loop's own first
 * corner closes it: the same call that draws the closing segment also gets
 * a floor + ceiling back from the engine, for free (`generate_wall_path`'s
 * own closure detection) -- no separate "derive room" click needed. Every
 * tick resends the whole path so far (`GenerateWallPathRequest`'s own doc
 * on why that's cheap), so a stroke abandoned mid-loop leaves exactly the
 * open fence it already drew, nothing more.
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
    const point = sample.point;

    if (activePath === undefined) {
      activePath = [point];
      return;
    }

    const first = activePath[0];
    const closing = first !== undefined && activePath.length >= 3 && xzDistance(point, first) <= CLOSE_DISTANCE;
    const nextPoints = closing && first !== undefined ? [...activePath, first] : [...activePath, point];

    commitPath(ctx, nextPoints, params);

    activePath = closing ? undefined : nextPoints;
  },
};
