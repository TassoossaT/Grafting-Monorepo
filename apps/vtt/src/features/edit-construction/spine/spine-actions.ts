import type { BezierPort, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionEdgeSnapshot } from "@/ports";
import { automaticCurve, resolveCurves } from "../topology/bezier-curve.ts";
import { spineComponent } from "./spine-owner.ts";

/** Structural edits on a spine, the same for every structure generated along one. */
export type SpineAction = "edit" | "remove-anchor" | "disconnect" | "delete-segment" | "close" | "width";

/** The graph patch one structural spine action makes; the owner regenerates its surface from it. */
export function planSpineAction(snapshot: ConstructionGraphSnapshot, port: BezierPort, action: SpineAction,
  targetId: string, edgeId: string | undefined, operationId: string, width?: number, endWidth?: number, allowShapeChange = false): ConstructionGraphPatch {
  const nodes=new Map(snapshot.nodes.map((n)=>[n.id,n]));
  const incident=snapshot.edges.filter((e)=>e.curve && (e.startNodeId===targetId || e.endNodeId===targetId));
  const seed = (edges: readonly ConstructionEdgeSnapshot[]) => [...new Set(edges.flatMap((e)=>[e.startNodeId,e.endNodeId]))].map((id)=>nodes.get(id)!);
  const resolve = (e: ConstructionEdgeSnapshot, reverse=false) => resolveCurves(port,[{
    handles:reverse?{...e.curve!,start:e.curve!.end,end:e.curve!.start}:e.curve!,
    start:nodes.get(reverse?e.endNodeId:e.startNodeId)!.position,
    end:nodes.get(reverse?e.startNodeId:e.endNodeId)!.position,
  }],0.025)[0]!.curves[0]!;
  if(action==="remove-anchor") {
    if (allowShapeChange && incident.length === 1) {
      if (spineComponent(snapshot,[targetId]).edges.filter(e=>e.curve).length < 2) throw Error("O caminho precisa manter pelo menos dois pontos.");
      return {nodes:seed(incident),removedEdgeIds:[incident[0]!.edgeId],edges:[]};
    }
    if(incident.length!==2) throw Error("Remova apenas âncoras entre dois trechos; desconecte os cruzamentos primeiro.");
    const [a,b]=incident as [ConstructionEdgeSnapshot,ConstructionEdgeSnapshot];
    if(JSON.stringify(a.curve!.bandOffsets)!==JSON.stringify(b.curve!.bandOffsets)) throw Error("Os perfis dos trechos precisam coincidir.");
    const from=a.startNodeId===targetId?a.endNodeId:a.startNodeId;
    const to=b.startNodeId===targetId?b.endNodeId:b.startNodeId;
    if(from===to) throw Error("A remoção eliminaria o circuito.");
    const left = resolve(a,a.startNodeId===targetId);
    const right = resolve(b,b.endNodeId===targetId);
    const merged=port.curveBatch({tolerance:0.025,commands:[allowShapeChange
      ? {kind:"sample",curves:[{points:[left.points[0],left.points[1],right.points[2],right.points[3]]}]}
      : {kind:"merge",curve:left,next:right}]})[0]!;
    return {nodes:seed(incident),removedEdgeIds:incident.map((e)=>e.edgeId),edges:[{...a,startNodeId:from,endNodeId:to,curve:{...merged.handles[0]!,bandOffsets:a.curve!.bandOffsets,surfaceType:a.curve!.surfaceType}}]};
  }
  if(action==="disconnect") {
    if(incident.length<2) throw Error("Selecione uma âncora compartilhada.");
    const copies=incident.slice(1).map((e,i)=>({edge:e,node:{id:"spine:"+operationId+":"+i,position:nodes.get(targetId)!.position}}));
    return {nodes:[...seed(incident),...copies.map((c)=>c.node)],removedEdgeIds:copies.map((c)=>c.edge.edgeId),
      edges:copies.map(({edge,node})=>({...edge,startNodeId:edge.startNodeId===targetId?node.id:edge.startNodeId,endNodeId:edge.endNodeId===targetId?node.id:edge.endNodeId}))};
  }
  if(action==="close") {
    const cloud=spineComponent(snapshot,[targetId]);
    const degree=new Map<string,number>();
    for(const e of cloud.edges)for(const id of [e.startNodeId,e.endNodeId])degree.set(id,(degree.get(id)??0)+1);
    const ends=[...degree].filter(([,d])=>d===1).map(([id])=>id);
    if(ends.length!==2 || !ends.includes(targetId) || cloud.edges.length<2) throw Error("Selecione a ponta de um caminho aberto com pelo menos dois trechos.");
    const other=ends.find((id)=>id!==targetId)!;
    const c=automaticCurve(port,[nodes.get(targetId)!.position,nodes.get(other)!.position],0.025);
    return {nodes:[nodes.get(targetId)!,nodes.get(other)!],edges:[{edgeId:"spine-edge:"+operationId+":close",startNodeId:targetId,endNodeId:other,curve:{...c.handles[0]!,bandOffsets:incident[0]!.curve!.bandOffsets,surfaceType:incident[0]!.curve!.surfaceType}}]};
  }
  const edge=snapshot.edges.find((e)=>e.edgeId===edgeId && e.curve);
  if(!edge)throw Error("Selecione o ponto central de um trecho.");
  if(action==="delete-segment") return {nodes:seed([edge]),removedEdgeIds:[edge.edgeId],edges:[]};
  if(action==="width") {
    if(width===undefined || !Number.isFinite(width) || width<=0 || (endWidth!==undefined && (!Number.isFinite(endWidth) || endWidth<=0)))throw Error("Informe uma largura positiva.");
    return {nodes:seed([edge]),removedEdgeIds:[edge.edgeId],edges:[{...edge,curve:{...edge.curve!,bandOffsets:[-width/2,width/2],endBandOffsets:endWidth===undefined || endWidth===width?undefined:[-endWidth/2,endWidth/2]}}]};
  }
  throw Error("Ação de curva desconhecida.");
}
