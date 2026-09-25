import { roadSnapTarget, showRoadSnap } from "./road-body-target.ts";
import { createRoadMeshPreview, ROAD_PREVIEW_COLOR, ROAD_PREVIEW_OPACITY, ROAD_ERROR_COLOR, ROAD_ERROR_OPACITY } from "./road-preview-mesh.ts";
import { createPathBrushEffect, pathFormationFor, DEFAULT_TOOL_PARAMS } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ConstructionTool, type ToolContext, type ToolGesture, type PointerSample } from "../core/tool-context.ts";

const CHANNEL = "road-stroke";
const active = new WeakMap<ToolContext["runtime"], PointerSample>();
const point = (p: PointerSample) => [p.point.x,p.point.y,p.point.z] as const;

/** Product gesture threshold; fitting and curve geometry stay behind the Rust port. */
function meaningful(g: ToolGesture): boolean {
  return g.samples.some(s => g.start.screenX !== undefined && s.screenX !== undefined && g.start.screenY !== undefined && s.screenY !== undefined
    ? Math.hypot(s.screenX-g.start.screenX,s.screenY-g.start.screenY) >= 5
    : Math.hypot(s.point.x-g.start.point.x,s.point.z-g.start.point.z) >= 0.15);
}
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
  const ribbons=ctx.runtime.curveBatch({tolerance:0.05,commands:fitted.curves.map(curve=>({kind:"ribbon" as const,curve,offsets:[-params.bedWidth/2,params.bedWidth/2] as const}))});
  return {fitted,ribbons,samples};
}
/** Drag to sketch the centerline. Release commits one fitted curve transaction. */
export const pathStrokeTool: ConstructionTool<"path-brush"> = {
  id:"path-brush",defaultParams:()=>DEFAULT_TOOL_PARAMS["path-brush"],
  onPointerDown(ctx,sample){showRoadSnap(ctx);active.set(ctx.runtime,sample);},
  onPointerMove(ctx,g,params) {
    if(!active.has(ctx.runtime)||!meaningful(g))return;
    try {
      const d=draft(ctx,g,params);
      const anchors = [d.samples[0]!.point];
      if (d.samples.length > 1) anchors.push(d.samples[d.samples.length - 1]!.point);
      ctx.runtime.showPreview(createRoadMeshPreview({
        ribbons: d.ribbons,
        anchors,
        bedWidth: params.bedWidth,
        color: ROAD_PREVIEW_COLOR,
        opacity: ROAD_PREVIEW_OPACITY,
      }), CHANNEL);
    } catch {
      showRoadSnap(ctx);
      // Red raw input is presentation only, never a candidate for confirmation.
      const points=g.samples.filter(s=>Object.values(s.point).every(Number.isFinite)).map(s=>s.point);
      ctx.runtime.showPreview(createRoadMeshPreview({
        fallbackPoints: points,
        anchors: points.length > 0 ? [points[0]!, points[points.length - 1]!] : [],
        bedWidth: params.bedWidth,
        color: ROAD_ERROR_COLOR,
        opacity: ROAD_ERROR_OPACITY,
      }), CHANNEL);
    }
  },
  onPointerUp(ctx,g,params) {
    if(!active.delete(ctx.runtime))return;
    ctx.runtime.clearPreview(CHANNEL);
    const final={...g,samples:[...g.samples,g.current]};
    if(!meaningful(final)){showRoadSnap(ctx);return;}
    try {
      const d=draft(ctx,final,params);
      const operationId=scopedToolId(ctx,"road-stroke",ctx.nextSequence());
      const effect=createPathBrushEffect({
        brushShape:{kind:"circle",radius:0.025},
        brushRegion:{samples:d.samples.map(s=>s.point)},
        authoredCurves:d.fitted.curves,parameters:pathFormationFor(params),
      },{operationId,tableId:ctx.tableId,initiatedBy:"road-stroke"});
      commitPathCloudIntent(ctx,effect,0.025);
      showRoadSnap(ctx);
    } catch(error) {
      showRoadSnap(ctx);
      ctx.reportFeedback({tone:"error",message:`Traçado não aplicado: ${String(error)}`});
    }
  },
  onCancel(ctx){active.delete(ctx.runtime);ctx.runtime.clearPreview(CHANNEL);showRoadSnap(ctx);},
};
