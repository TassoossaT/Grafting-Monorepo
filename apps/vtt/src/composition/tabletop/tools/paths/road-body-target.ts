import { curveEdgesOf, curvePick, curvePickId, structureTypeFor } from "../../../../features/edit-construction/index.ts";
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
  const projected = evaluated[i]!.curves[0]!.points[3];
  // Reuse anchors by world distance, not a percentage of arbitrarily long spans.
  const nearStart = Math.hypot(...projected.map((v, axis) => v - edge.curve.points[0][axis]!));
  const nearEnd = Math.hypot(...projected.map((v, axis) => v - edge.curve.points[3][axis]!));
  const endpoint = nearStart <= 0.6 && nearStart <= nearEnd ? 0 : nearEnd <= 0.6 ? 3 : undefined;
  const p=endpoint===undefined?evaluated[i]!.curves[0]!.points[3]:edge.curve.points[endpoint];
  return {
    sample:{...sample,nodeId:endpoint===0?edge.startNodeId:endpoint===3?edge.endNodeId:curvePickId(edge.edgeId,"midpoint"),point:{x:p[0],y:p[1],z:p[2]}},
    options:{mode:"shape",parameter:t,insertOnClick:false,pointerOrigin:sample.point,dragThreshold:5},
  };
}


export interface RoadSnapTarget extends PointerSample {
  readonly snapSignature?: string;
  readonly snapEdge?: { readonly edgeId: string; readonly parameter: number };
}
const snapLocks = new WeakMap<ToolContext["runtime"], { target: RoadSnapTarget; signature: string; exitReach: number }>();
function targetSignature(ctx: ToolContext, target: RoadSnapTarget): string | undefined {
  const graph = ctx.runtime.getGraphSnapshot();
  if (target.snapEdge) {
    const edge = graph.edges.find(e => e.edgeId === target.snapEdge!.edgeId);
    if (!edge) return;
    return JSON.stringify([edge, graph.nodes.find(n => n.id === edge.startNodeId), graph.nodes.find(n => n.id === edge.endNodeId)]);
  }
  const node = graph.nodes.find(n => n.id === target.nodeId);
  return node && JSON.stringify(node);
}
/** Keep the displayed position and edge parameter until the pointer exits the wider release zone. */
export function roadSnapTarget(ctx: ToolContext, sample: PointerSample): RoadSnapTarget | undefined {
  const previous = snapLocks.get(ctx.runtime);
  if (previous && targetSignature(ctx, previous.target) === previous.signature
      && Math.abs(previous.target.point.y - sample.point.y) <= 0.2
      && Math.hypot(previous.target.point.x - sample.point.x, previous.target.point.z - sample.point.z) <= previous.exitReach) {
    return { ...sample, nodeId: previous.target.nodeId, point: previous.target.point, snapEdge: previous.target.snapEdge, snapSignature: previous.signature };
  }
  snapLocks.delete(ctx.runtime);
  let target = acquireRoadSnap(ctx, sample);
  if (target) {
    const signature = targetSignature(ctx, target);
    if (signature) target = { ...target, snapSignature: signature };
    if (signature) snapLocks.set(ctx.runtime, { target, signature, exitReach: Math.max(0.9,
      Math.hypot(target.point.x - sample.point.x, target.point.z - sample.point.z) + 0.3) });
  }
  return target;
}

/** A deleted or reshaped target cannot be confirmed from a stale preview. */
export function roadSnapIsCurrent(ctx: ToolContext, target: RoadSnapTarget): boolean {
  return target.snapSignature !== undefined && targetSignature(ctx, target) === target.snapSignature;
}

/** Product snap reach; projection and splitting remain canonical Rust operations. */
function acquireRoadSnap(ctx: ToolContext, sample: PointerSample): RoadSnapTarget | undefined {
  const graph = ctx.runtime.getGraphSnapshot();
  const ids = new Set(graph.edges.filter(e => e.curve?.surfaceType && structureTypeFor(e.curve.surfaceType)?.spine).flatMap(e => [e.startNodeId, e.endNodeId]));
  let best: { node: typeof graph.nodes[number]; distance: number } | undefined;
  for (const node of graph.nodes) {
    if (!ids.has(node.id) || Math.abs(node.position.y - sample.point.y) > 0.2) continue;
    const distance = Math.hypot(node.position.x - sample.point.x, node.position.z - sample.point.z);
    if (distance <= 0.6 && (!best || distance < best.distance)) best = { node, distance };
  }
  if (best) return { ...sample, nodeId: best.node.id, point: best.node.position };
  const body = roadBodyTarget(ctx, sample);
  if (!body) return;
  const edge = curvePick(body.sample.nodeId!);
  return { ...body.sample, snapEdge: edge ? { edgeId: edge.edgeId, parameter: body.options.parameter! } : undefined };
}

/** Highlight the exact prospective junction without changing the graph. */
export function showRoadSnap(ctx: ToolContext, target?: PointerSample): void {
  if (!target) { snapLocks.delete(ctx.runtime); ctx.runtime.clearPreview("road-snap"); return; }
  const { x, y, z } = target.point;
  const r = 0.35, h = y + 0.035;
  ctx.runtime.showPreview({ kind: "segments", color: 0x38bdf8, opacity: 1,
    positions: Float32Array.from([x-r,h,z, x,h,z+r, x,h,z+r, x+r,h,z, x+r,h,z, x,h,z-r, x,h,z-r, x-r,h,z,
      x-r*2,h,z, x+r*2,h,z, x,h,z-r*2, x,h,z+r*2]),
  }, "road-snap");
}
