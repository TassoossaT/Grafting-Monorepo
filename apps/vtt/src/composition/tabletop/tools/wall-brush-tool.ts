import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition, PathEdgeSpec } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

/** Fixed wall height for a brush-drawn segment. */
const WALL_HEIGHT = 3;
const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };
/** No curved edges from this tool yet -- reserved for a future arc-drawing gesture. Ignored by the engine while every edge is `"straight"`. */
const ARC_FACETS = 12;

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
 * long as the wall-brush tool keeps drawing one continuous structure, dying
 * only when the gesture itself ends (there is no forced closure -- see this
 * tool's own doc).
 */
let activePath: ConstructionPosition[] | undefined;

/**
 * A single stable prefix for every wall-brush structure on this table -- a
 * wall's corner ids are derived purely from XZ position (`extrude_path`'s
 * own doc), so two separate strokes sharing this one prefix still weld
 * together for free wherever their corners happen to coincide, without
 * either stroke needing to know about the other -- "ligar casas" (E7's own
 * wording) comes for free.
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
 * Click to place each corner of a wall -- straight segments for now (see
 * `ARC_FACETS`'s own doc). Free-form on purpose: there is no notion of
 * "closing a structure" here at all -- every click just extends the current
 * stroke by one more segment, forever, and there is no floor/ceiling cap of
 * any kind (not implemented yet; see `generateBoundaryCap`'s own doc for
 * why bolting one onto this tool isn't safe today anyway). Every tick
 * resends the whole path so far (`GeneratePathExtrusionRequest`'s own doc
 * on why that's cheap).
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
    const nextPoints = [...activePath, point];

    commitPath(ctx, nextPoints, params);

    activePath = nextPoints;
  },
};
