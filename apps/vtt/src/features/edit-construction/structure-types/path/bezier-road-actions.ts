import type { BezierPort, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionEdgeSnapshot } from "@/ports";
import { curvePoint } from "./bezier-road-plan.ts";
import { changedSpineCloud } from "./path-cloud-scope.ts";

export type BezierRoadAction = "edit" | "remove-anchor" | "disconnect" | "delete-segment" | "close" | "width";
export function planBezierAction(snapshot: ConstructionGraphSnapshot, port: BezierPort, action: BezierRoadAction,
  targetId: string, edgeId: string | undefined, operationId: string, width?: number, endWidth?: number): ConstructionGraphPatch {
  const nodes=new Map(snapshot.nodes.map((n)=>[n.id,n]));
  const incident=snapshot.edges.filter((e)=>e.curve && (e.startNodeId===targetId || e.endNodeId===targetId));
  const seed = (edges: readonly ConstructionEdgeSnapshot[]) => [...new Set(edges.flatMap((e)=>[e.startNodeId,e.endNodeId]))].map((id)=>nodes.get(id)!);
  const resolve = (e: ConstructionEdgeSnapshot, reverse=false) => port.curveBatch({tolerance:0.025,commands:[{
    kind:"resolve",handles:reverse?{...e.curve!,start:e.curve!.end,end:e.curve!.start}:e.curve!,
    start:curvePoint(nodes.get(reverse?e.endNodeId:e.startNodeId)!.position),
    end:curvePoint(nodes.get(reverse?e.startNodeId:e.endNodeId)!.position),
  }]})[0]!.curves[0]!;
  if(action==="remove-anchor") {
    if(incident.length!==2) throw Error("Remova apenas âncoras entre dois trechos; desconecte os cruzamentos primeiro.");
    const [a,b]=incident as [ConstructionEdgeSnapshot,ConstructionEdgeSnapshot];
    if(JSON.stringify(a.curve!.bandOffsets)!==JSON.stringify(b.curve!.bandOffsets)) throw Error("Os perfis dos trechos precisam coincidir.");
    const from=a.startNodeId===targetId?a.endNodeId:a.startNodeId;
    const to=b.startNodeId===targetId?b.endNodeId:b.startNodeId;
    if(from===to) throw Error("A remoção eliminaria o circuito.");
    const merged=port.curveBatch({tolerance:0.025,commands:[{kind:"merge",curve:resolve(a,a.startNodeId===targetId),next:resolve(b,b.endNodeId===targetId)}]})[0]!;
    return {nodes:seed(incident),removedEdgeIds:incident.map((e)=>e.edgeId),edges:[{...a,startNodeId:from,endNodeId:to,curve:{...merged.handles[0]!,bandOffsets:a.curve!.bandOffsets}}]};
  }
  if(action==="disconnect") {
    if(incident.length<2) throw Error("Selecione uma âncora compartilhada.");
    const copies=incident.slice(1).map((e,i)=>({edge:e,node:{id:"spine:"+operationId+":"+i,position:nodes.get(targetId)!.position}}));
    return {nodes:[...seed(incident),...copies.map((c)=>c.node)],removedEdgeIds:copies.map((c)=>c.edge.edgeId),
      edges:copies.map(({edge,node})=>({...edge,startNodeId:edge.startNodeId===targetId?node.id:edge.startNodeId,endNodeId:edge.endNodeId===targetId?node.id:edge.endNodeId}))};
  }
  if(action==="close") {
    const cloud=changedSpineCloud(snapshot,{nodes:[nodes.get(targetId)!],edges:[]}).snapshot;
    const degree=new Map<string,number>();
    for(const e of cloud.edges)for(const id of [e.startNodeId,e.endNodeId])degree.set(id,(degree.get(id)??0)+1);
    const ends=[...degree].filter(([,d])=>d===1).map(([id])=>id);
    if(ends.length!==2 || !ends.includes(targetId) || cloud.edges.length<2) throw Error("Selecione a ponta de um caminho aberto com pelo menos dois trechos.");
    const other=ends.find((id)=>id!==targetId)!;
    const c=port.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:[curvePoint(nodes.get(targetId)!.position),curvePoint(nodes.get(other)!.position)]}]})[0]!;
    return {nodes:[nodes.get(targetId)!,nodes.get(other)!],edges:[{edgeId:"spine-edge:"+operationId+":close",startNodeId:targetId,endNodeId:other,curve:{...c.handles[0]!,bandOffsets:incident[0]!.curve!.bandOffsets}}]};
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
