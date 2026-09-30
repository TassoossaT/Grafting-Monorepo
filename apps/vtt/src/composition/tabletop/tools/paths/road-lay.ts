import { createPathBrushEffect, curvePoint, curvePosition, pathFormationFor, pathHalfWidth, pathStrokeShape, PATH_MAX_GRADE } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { createRoadMeshPreview, ROAD_ERROR_COLOR, ROAD_ERROR_OPACITY } from "./road-preview-mesh.ts";

/**
 * Shaping, previewing and laying a road -- one path whether it was clicked
 * span by span or drawn in one stroke, so the two can never disagree about
 * the road's laws, what the preview shows, or how it is committed.
 */

/** The plan deviation, in metres, a freehand stroke is smoothed within, whatever the road's width. */
const HAND_WOBBLE = 1;
const TOLERANCE = 0.025;
/** Where a road's spine is drawn while it is only proposed. */
export const ROAD_SPINE_CHANNEL = "road-draft-spine";
const SPINE_COLOR = 0xfde047;
/** How far above the road its proposed spine is drawn, to stay clear of the ribbon. */
const SPINE_LIFT = 0.09;

export interface ShapedRoad {
  readonly curves: readonly CubicBezier[];
  /** Where the road ends -- short of the last point when its laws stop it; undefined when nothing is laid. */
  readonly end: ConstructionPosition | undefined;
}

/**
 * The road through `points`, held in Rust to its laws: a stroke loses its
 * loops, eases its turns and keeps to its grade; a click-to-click span is
 * straight and keeps to its grade.
 */
export function shapeRoad(ctx: ToolContext, points: readonly ConstructionPosition[], params: PathBrushParams, drawn: boolean): ShapedRoad {
  const command = drawn
    ? { kind: "interpretStroke" as const, points: points.map(curvePoint), correction: HAND_WOBBLE, curved: true, ...pathStrokeShape(params) }
    : { kind: "interpretStroke" as const, points: points.map(curvePoint), correction: 0, curved: false, maxGrade: PATH_MAX_GRADE };
  const { curves } = ctx.runtime.curveBatch({ tolerance: TOLERANCE, commands: [command] })[0]!;
  const last = curves.at(-1)?.points[3];
  return { curves, end: last && curvePosition(last) };
}

/**
 * Shows `curves` as the road they would lay -- spine and ribbon from one
 * engine crossing -- or, with none, only the point a road waits at.
 */
export function previewRoad(ctx: ToolContext, curves: readonly CubicBezier[], params: PathBrushParams, channel: string, waiting?: ConstructionPosition): void {
  const halfWidth = pathHalfWidth(params);
  if (curves.length === 0) {
    ctx.runtime.clearPreview(ROAD_SPINE_CHANNEL);
    ctx.runtime.showPreview(createRoadMeshPreview({ anchors: waiting ? [waiting] : [], bedWidth: halfWidth * 2 }), channel);
    return;
  }
  const [sampled, ...ribbons] = ctx.runtime.curveBatch({ tolerance: TOLERANCE, commands: [
    { kind: "sample" as const, curves },
    ...curves.map((curve) => ({ kind: "ribbon" as const, curve, offsets: [-halfWidth, halfWidth] as const })),
  ] });
  const spine: number[] = [];
  for (const samples of sampled!.samples) {
    for (let k = 1; k < samples.length; k += 1) {
      const [a, b] = [samples[k - 1]!.position, samples[k]!.position];
      spine.push(a[0], a[1] + SPINE_LIFT, a[2], b[0], b[1] + SPINE_LIFT, b[2]);
    }
  }
  ctx.runtime.showPreview(segmentsPreview(spine, SPINE_COLOR, 1), ROAD_SPINE_CHANNEL);
  const anchors = [curvePosition(curves[0]!.points[0]), curvePosition(curves.at(-1)!.points[3])];
  ctx.runtime.showPreview(createRoadMeshPreview({ anchors, bedWidth: halfWidth * 2, ribbons }), channel);
}

/** Shows raw `points` in red: what was drawn, which no road could be laid along. Never a candidate to confirm. */
export function previewRoadError(ctx: ToolContext, points: readonly ConstructionPosition[], params: PathBrushParams, channel: string): void {
  ctx.runtime.clearPreview(ROAD_SPINE_CHANNEL);
  const anchors = points.length > 0 ? [points[0]!, points.at(-1)!] : [];
  ctx.runtime.showPreview(createRoadMeshPreview({ anchors, fallbackPoints: points, bedWidth: pathHalfWidth(params) * 2, color: ROAD_ERROR_COLOR, opacity: ROAD_ERROR_OPACITY }), channel);
}

/** Clears a road preview on `channel`, spine included. */
export function clearRoadPreview(ctx: ToolContext, channel: string): void {
  ctx.runtime.clearPreview(channel);
  ctx.runtime.clearPreview(ROAD_SPINE_CHANNEL);
}

/**
 * Lays `curves` as one road transaction, named for the gesture that drew it;
 * false when it was refused or laid nothing. An automatic road's anchors
 * reinterpolate when one is moved; any other keeps its controls.
 */
export function layRoad(ctx: ToolContext, curves: readonly CubicBezier[], params: PathBrushParams, gesture: string, curveMode?: "automatic"): boolean {
  if (curves.length === 0) return false;
  const operationId = scopedToolId(ctx, gesture, ctx.nextSequence());
  // The anchors of the road as shaped, never the raw input it was shaped from: a cut-out loop is not laid.
  const anchors = [curves[0]!.points[0], ...curves.map((curve) => curve.points[3])].map(curvePosition);
  const effect = createPathBrushEffect({
    brushShape: { kind: "circle", radius: TOLERANCE }, brushRegion: { samples: anchors },
    authoredCurves: curves, ...(curveMode ? { curveMode } : {}), parameters: pathFormationFor(params),
  }, { operationId, tableId: ctx.tableId, initiatedBy: gesture });
  return commitPathCloudIntent(ctx, effect, TOLERANCE);
}
