import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition, PathEdgeSpec } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor, pinnedToBaseline, resolveWallCrossing, xzDistance } from "./wall-shared.ts";

/** No curved edges from this tool yet -- reserved for a future arc-drawing gesture. Ignored by the engine while every edge is `"straight"`. */
const ARC_FACETS = 12;
/**
 * A new drag sample joins the stroke only once it has moved this far (XZ)
 * from the last accepted corner -- without a floor, every `onPointerMove`
 * tick (throttled, but still frequent) would otherwise mint a near-zero-length
 * wall panel per pixel of mouse movement.
 */
const MIN_SEGMENT_LENGTH = 0.5;

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
 * The in-progress drag's own accumulated corner points -- lives only for the
 * current press-drag-release gesture (like `terrain-brush-tool.ts`'s own
 * `activeSession`), not across separate strokes. Lifting the pointer always
 * ends the stroke; pressing again starts a wholly new, independent one.
 */
let activePath: readonly ConstructionPosition[] | undefined;

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
 * Appends `point` to `path` and commits, if it's at least
 * {@link MIN_SEGMENT_LENGTH} past the path's own last corner; otherwise a
 * no-op (still mid-tiny-move, nothing new to draw). Every accepted point
 * passes through `resolveWallCrossing` first -- landing on the side of an
 * existing wall splits it and snaps this corner onto the split, forming a
 * T-junction (see that function's own doc).
 */
function extend(ctx: ToolContext, path: readonly ConstructionPosition[], rawPoint: ConstructionPosition, params: WallBrushParams): readonly ConstructionPosition[] {
  const first = path[0];
  const pinned = first === undefined ? rawPoint : pinnedToBaseline(first, rawPoint);
  const last = path[path.length - 1];
  if (last !== undefined && xzDistance(pinned, last) < MIN_SEGMENT_LENGTH) return path;

  const point = resolveWallCrossing(ctx, pinned, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`);
  const nextPath = [...path, point];
  commitPath(ctx, nextPath, params);
  return nextPath;
}

/**
 * A true drag brush: press to anchor the stroke's first corner, drag to lay
 * down wall panels continuously along wherever the pointer travels (each
 * `onPointerMove` tick appends one more corner, throttled by the dispatcher,
 * gated by {@link MIN_SEGMENT_LENGTH} so a slow drag doesn't spam
 * near-zero-length panels), release to end the stroke. Free-form on
 * purpose: there is no notion of "closing a structure" here at all, and no
 * floor/ceiling cap of any kind (not implemented yet; see
 * `generateBoundaryCap`'s own doc for why bolting one onto this tool isn't
 * safe today anyway). Every tick resends the whole path so far
 * (`GeneratePathExtrusionRequest`'s own doc on why that's cheap). Landing on
 * the side of an existing wall (not near one of its own corners) splits it
 * and welds this stroke's corner onto the split, forming a T-junction --
 * see `resolveWallCrossing`'s own doc. See `wall-line-tool.ts` for the
 * exact-point-to-point counterpart.
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

  onPointerDown(ctx: ToolContext, sample: PointerSample): void {
    activePath = [resolveWallCrossing(ctx, sample.point, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`)];
  },

  // The dispatcher throttles how often this fires during an active drag, so
  // every call here is already spaced out -- MIN_SEGMENT_LENGTH's own gate
  // in `extend` is a second, XZ-distance-based filter on top of that.
  onPointerMove(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    if (activePath === undefined) return;
    activePath = extend(ctx, activePath, gesture.current.point, params);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    if (activePath !== undefined) extend(ctx, activePath, gesture.current.point, params);
    activePath = undefined;
  },
};
