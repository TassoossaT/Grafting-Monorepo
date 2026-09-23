import { curveEdgesOf, curvePickId, structureTypeFor } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { PointerSample, ToolContext } from "../core/tool-context.ts";
import type { CurveGestureOptions } from "../core/curve-edit-gesture.ts";

/** Project a road-body pick onto its spine using the canonical curve query. */
export function roadBodyTarget(ctx: ToolContext,sample: PointerSample): {sample:PointerSample;options:CurveGestureOptions}|undefined {
  if(!sample.surfaceRef && !sample.nodeId)return;
  const hit=ctx.runtime.getAllRegionTopologies().find(t=>
    structureTypeFor(t.surfaceType)?.spine && (sample.surfaceRef
      ? surfaceRefFromNodeSet(t.surfaceKey)===sample.surfaceRef
      : t.nodes.some(n=>n.id===sample.nodeId)));
  const owner=hit && structureTypeFor(hit.surfaceType)?.spine;
  if(!owner)return;
  const snapshot=ctx.runtime.getGraphSnapshot();
  const roadIds=new Set(snapshot.edges.filter(e=>e.curve?.surfaceType && structureTypeFor(e.curve.surfaceType)?.spine===owner).map(e=>e.edgeId));
  const edges=curveEdgesOf(snapshot,[],ctx.runtime).filter(e=>roadIds.has(e.edgeId));
  if(!edges.length)return;
  const nearest=ctx.runtime.curveBatch({tolerance:0.025,commands:edges.map(e=>({kind:"nearest" as const,curve:e.curve,point:[sample.point.x,sample.point.y,sample.point.z] as const}))});
  const evaluated=ctx.runtime.curveBatch({tolerance:0.025,commands:edges.map((e,i)=>({kind:"split" as const,curve:e.curve,t:Math.max(0.000001,Math.min(0.999999,nearest[i]!.parameter!))}))});
  let best:{index:number;distance:number}|undefined;
  evaluated.forEach((result,i)=>{
    const p=result.curves[0]!.points[3];
    const distance=Math.hypot(p[0]-sample.point.x,p[1]-sample.point.y,p[2]-sample.point.z);
    if(Math.abs(p[1]-sample.point.y)>0.2)return;
    const profile=snapshot.edges.find(e=>e.edgeId===edges[i]!.edgeId)!.curve!;
    const reach=Math.max(...profile.bandOffsets.map(Math.abs),...(profile.endBandOffsets??[]).map(Math.abs),0.2)+0.2;
    if(distance<=reach && (!best||distance<best.distance))best={index:i,distance};
  });
  if(!best)return;
  const i=best.index, edge=edges[i]!,t=nearest[i]!.parameter!;
  const endpoint=t<0.05?0:t>0.95?3:undefined;
  const p=endpoint===undefined?evaluated[i]!.curves[0]!.points[3]:edge.curve.points[endpoint];
  return {
    sample:{...sample,nodeId:endpoint===0?edge.startNodeId:endpoint===3?edge.endNodeId:curvePickId(edge.edgeId,"midpoint"),point:{x:p[0],y:p[1],z:p[2]}},
    options:{mode:"shape",parameter:t,insertOnClick:false,pointerOrigin:sample.point,dragThreshold:5},
  };
}
