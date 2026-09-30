import { roadSnapTarget, showRoadSnap } from "./road-body-target.ts";
import { createRoadMeshPreview, showRoadSpinePreview, ROAD_PREVIEW_COLOR, ROAD_PREVIEW_OPACITY, ROAD_ERROR_COLOR, ROAD_ERROR_OPACITY } from "./road-preview-mesh.ts";
import { createPathBrushEffect, pathFormationFor, pathHalfWidth } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ToolContext, type ToolGesture, type PointerSample } from "../core/tool-context.ts";
import { isStroke, type SpineSketchStroke } from "../core/spine-sketch.ts";

const CHANNEL = "road-stroke";
const active = new WeakMap<ToolContext["runtime"], PointerSample>();
const point = (p: PointerSample) => [p.point.x,p.point.y,p.point.z] as const;

function draft(ctx: ToolContext,g: ToolGesture,params: PathBrushParams) {
  const samples = [...g.samples, g.current].filter((sample, index, all) => {
    const previous = all[index - 1];
    return !previous || sample.point.x !== previous.point.x || sample.point.y !== previous.point.y || sample.point.z !== previous.point.z;
  });
  const target = roadSnapTarget(ctx, g.current);
  if (target) samples[samples.length - 1] = target;
  showRoadSnap(ctx, target);

  // The brush reserves half the road width; the remaining area may correct hand wobble.
  const correction=Math.max(0,params.radius-params.bedWidth/2);
  const fitted=ctx.runtime.curveBatch({tolerance:0.025,commands:[{kind:"interpretStroke",points:samples.map(point),correction,curved:true}]})[0]!;
  const halfWidth=pathHalfWidth(params);
  const ribbons=ctx.runtime.curveBatch({tolerance:0.025,commands:fitted.curves.map(curve=>({kind:"ribbon" as const,curve,offsets:[-halfWidth,halfWidth] as const}))});
  return {fitted,ribbons,samples};
}
/** A road's centerline sketched by dragging; release lays one fitted curve transaction. */
export const pathStroke: SpineSketchStroke<"path-brush"> = {
  begin(ctx,sample){showRoadSnap(ctx);active.set(ctx.runtime,sample);},
  move(ctx,g,params) {
    if(!active.has(ctx.runtime)||!isStroke(g))return;
    try {
      const d=draft(ctx,g,params);
      showRoadSpinePreview(ctx, d.fitted.curves, "road-draft-spine");
      const anchors = [d.samples[0]!.point];
      if (d.samples.length > 1) anchors.push(d.samples[d.samples.length - 1]!.point);
      ctx.runtime.showPreview(createRoadMeshPreview({
        ribbons: d.ribbons,
        anchors,
        bedWidth: pathHalfWidth(params) * 2,
        color: ROAD_PREVIEW_COLOR,
        opacity: ROAD_PREVIEW_OPACITY,
      }), CHANNEL);
    } catch {
      ctx.runtime.clearPreview("road-draft-spine");
      showRoadSnap(ctx);
      // Red raw input is presentation only, never a candidate for confirmation.
      const points=g.samples.filter(s=>Object.values(s.point).every(Number.isFinite)).map(s=>s.point);
      ctx.runtime.showPreview(createRoadMeshPreview({
        fallbackPoints: points,
        anchors: points.length > 0 ? [points[0]!, points[points.length - 1]!] : [],
        bedWidth: pathHalfWidth(params) * 2,
        color: ROAD_ERROR_COLOR,
        opacity: ROAD_ERROR_OPACITY,
      }), CHANNEL);
    }
  },
  finish: finishPathStroke,
  cancel(ctx){active.delete(ctx.runtime);ctx.runtime.clearPreview(CHANNEL);ctx.runtime.clearPreview("road-draft-spine");showRoadSnap(ctx);},
};

/** The single release/commit path. */
function finishPathStroke(ctx: ToolContext, g: ToolGesture, params: PathBrushParams): boolean {
    if(!active.delete(ctx.runtime))return false;
    ctx.runtime.clearPreview(CHANNEL);
    ctx.runtime.clearPreview("road-draft-spine");
    const final={...g,samples:[...g.samples,g.current]};
    if(!isStroke(final)){showRoadSnap(ctx);return false;}
    try {
      const d=draft(ctx,final,params);
      const operationId=scopedToolId(ctx,"road-stroke",ctx.nextSequence());
      const effect=createPathBrushEffect({
        brushShape:{kind:"circle",radius:0.025},
        brushRegion:{samples:d.samples.map(s=>s.point)},
        authoredCurves:d.fitted.curves,parameters:pathFormationFor(params),
      },{operationId,tableId:ctx.tableId,initiatedBy:"road-stroke"});
      const committed=commitPathCloudIntent(ctx,effect,0.025);
      showRoadSnap(ctx);
      return committed;
    } catch(error) {
      showRoadSnap(ctx);
      ctx.reportFeedback({tone:"error",message:`Traçado não aplicado: ${String(error)}`});
      return false;
    }
}
