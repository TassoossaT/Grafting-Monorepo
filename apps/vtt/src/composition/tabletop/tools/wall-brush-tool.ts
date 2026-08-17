import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition, PathEdgeSpec } from "@/ports";

import type { FittedEdge } from "./path-fitting.ts";
import { fitPath } from "./path-fitting.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor, pinnedToBaseline, resolveWallCrossing, xzDistance } from "./wall-shared.ts";

const ARC_FACETS = 12;
/**
 * A new raw sample joins the stroke's own buffer only once it has moved
 * this far (XZ) from the last one -- without a floor, every `onPointerMove`
 * tick (throttled, but still frequent) would otherwise pile up near-duplicate
 * points `fitPath` gains nothing from. Deliberately finer than the old
 * per-corner gate this tool used before fitting existed: raw samples are no
 * longer corners themselves, they're `fitPath`'s own input, so a stroke
 * needs enough resolution left in it for {@link fitPath} to actually find
 * curvature, not just enough to avoid spamming zero-length panels.
 */
const RAW_SAMPLE_MIN_DISTANCE = 0.15;
/**
 * `fitPath`'s own Ramer-Douglas-Peucker tolerance (world units): how far the
 * raw stroke must wander off a straight line before that reads as a real
 * corner rather than hand tremor -- this is "fragmentar em contornos
 * conhecidos ao longo do grafo," the free brush's own correction step, so
 * only `wall-brush-tool.ts` (not `wall-line-tool.ts`, which is deliberately
 * always-exactly-straight) uses it.
 */
const CORNER_EPSILON = 0.4;

/**
 * The in-progress drag's own raw pointer samples (pinned to the stroke's
 * baseline Y, deduplicated by {@link RAW_SAMPLE_MIN_DISTANCE}) -- lives only
 * for the current press-drag-release gesture (like `terrain-brush-tool.ts`'s
 * own `activeSession`), not across separate strokes. Lifting the pointer
 * always ends the stroke; pressing again starts a wholly new, independent
 * one. This is deliberately the *raw* stroke, not the committed corners --
 * {@link fitPath} re-derives the fitted corners from this buffer every tick,
 * so a corner already committed can still be redrawn (as one straight run,
 * or reclassified into a curve) once later samples make its true shape
 * clearer, the same way `generatePathExtrusion`'s full-resend-every-tick
 * diff already lets a straight run's own endpoint move as the stroke
 * continues.
 */
let rawPath: readonly ConstructionPosition[] | undefined;

/**
 * Resolves each of `fitted`'s own corner points through `resolveWallCrossing`
 * (weld/T-junction, same as before fitting existed) exactly once each --
 * consecutive edges share a corner, so resolving per-edge-endpoint instead
 * would risk two independently-resolved-but-not-quite-identical points at
 * what must be one shared corner.
 */
function resolvedEdges(ctx: ToolContext, fitted: readonly FittedEdge[]): readonly PathEdgeSpec[] {
  const first = fitted[0];
  if (first === undefined) return [];

  const corners: ConstructionPosition[] = [resolveWallCrossing(ctx, first.start, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`)];
  for (const edge of fitted) corners.push(resolveWallCrossing(ctx, edge.end, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`));

  const edges: PathEdgeSpec[] = [];
  for (let index = 0; index < fitted.length; index += 1) {
    const start = corners[index];
    const end = corners[index + 1];
    const curvature = fitted[index]?.curvature;
    if (start === undefined || end === undefined || curvature === undefined) continue;
    edges.push({ start, end, curvature });
  }
  return edges;
}

function commitFitted(ctx: ToolContext, path: readonly ConstructionPosition[], params: WallBrushParams): void {
  const fitted = fitPath(path, CORNER_EPSILON);
  const edges = resolvedEdges(ctx, fitted);
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
 * Appends `rawPoint` to `path`'s own raw buffer, if it's at least
 * {@link RAW_SAMPLE_MIN_DISTANCE} past the buffer's own last sample;
 * otherwise a no-op (still mid-tiny-move, nothing new for `fitPath` to see).
 * Every accepted sample re-commits the *whole* raw buffer through
 * {@link fitPath}, so a stroke's own already-drawn shape can still be
 * corrected (straightened, or reclassified into a curve) as later samples
 * refine it.
 */
function extend(ctx: ToolContext, path: readonly ConstructionPosition[], rawPoint: ConstructionPosition, params: WallBrushParams): readonly ConstructionPosition[] {
  const first = path[0];
  const pinned = first === undefined ? rawPoint : pinnedToBaseline(first, rawPoint);
  const last = path[path.length - 1];
  if (last !== undefined && xzDistance(pinned, last) < RAW_SAMPLE_MIN_DISTANCE) return path;

  const nextPath = [...path, pinned];
  commitFitted(ctx, nextPath, params);
  return nextPath;
}

/**
 * A true drag brush: press to anchor the stroke's first corner, drag to lay
 * down wall panels continuously along wherever the pointer travels, release
 * to end the stroke. Free-form on purpose: there is no notion of "closing a
 * structure" here at all, and no floor/ceiling cap of any kind (not
 * implemented yet; see `generateBoundaryCap`'s own doc for why bolting one
 * onto this tool isn't safe today anyway). What actually reaches the graph
 * is never the raw stroke, though -- every `onPointerMove` tick appends one
 * more raw sample (throttled by the dispatcher, gated by
 * {@link RAW_SAMPLE_MIN_DISTANCE}) to `rawPath`, then re-fits *all* of it
 * (`fitPath`, `path-fitting.ts`) into a short list of straight/arc edges
 * from the engine's own known vocabulary and commits that instead -- "eu
 * quero... fragmentar em contornos conhecidos ao longo do grafo," not the
 * literal wobble of the mouse. Every tick resends the whole fitted path
 * (`GeneratePathExtrusionRequest`'s own doc on why that's cheap), so an
 * already-drawn run can still be corrected as later samples make its true
 * shape clearer. Landing on the side of an existing wall (not near one of
 * its own corners) splits it and welds this stroke's corner onto the split,
 * forming a T-junction -- see `resolveWallCrossing`'s own doc. See
 * `wall-line-tool.ts` for the always-exactly-straight, no-fitting
 * counterpart.
 */
export const wallBrushTool: ConstructionTool<"wall-brush"> = {
  id: "wall-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-brush"],

  previewFor(gesture: ToolGesture, params: WallBrushParams) {
    const path = rawPath;
    if (path === undefined || path.length === 0) return undefined;

    const fitted = fitPath(path, CORNER_EPSILON);
    const committed = fitted.flatMap((edge) => [
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
    rawPath = [sample.point];
  },

  // The dispatcher throttles how often this fires during an active drag, so
  // every call here is already spaced out -- RAW_SAMPLE_MIN_DISTANCE's own
  // gate in `extend` is a second, XZ-distance-based filter on top of that.
  onPointerMove(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    if (rawPath === undefined) return;
    rawPath = extend(ctx, rawPath, gesture.current.point, params);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    if (rawPath !== undefined) extend(ctx, rawPath, gesture.current.point, params);
    rawPath = undefined;
  },
};
