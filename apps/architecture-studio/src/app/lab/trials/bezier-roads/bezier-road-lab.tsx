"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import init, { ConstructionSession } from "@grafting/procgen-construction-wasm";

import { writePreviewImage } from "../../../../lab-preview-storage.ts";

type Point = [number, number, number];
type Curve = { points: [Point, Point, Point, Point] };
type Profile = { bandOffsets: number[]; endBandOffsets?: number[] };
const profileFor = (m: Model, i: number): Profile => m.profiles?.[i] ?? { bandOffsets: [-m.width,m.width], endBandOffsets: [-(m.endWidth ?? m.width),m.endWidth ?? m.width] };
type Model = { curves: Curve[]; layers: number[]; width: number; endWidth?: number; profiles?: Profile[] };
type Result = { curves: Curve[]; handles: unknown[]; samples: { t: number; position: Point }[][]; ribbon: { outer: Point[] } | null };
const FIXTURES: Record<string, Point[][]> = {
  "Transição de largura": [[[-16,0,0],[16,0,0]]],
  Arco: [[[-12,0,0],[0,0,-10],[12,0,0]]],
  S: [[[-15,0,0],[-5,0,7],[5,0,-7],[15,0,0]]],
  Retorno: [[[-9,0,12],[-9,0,-6],[0,0,-12],[9,0,-6],[9,0,12]]],
  T: [[[-16,0,0],[16,0,0]],[[0,0,0],[0,0,16]]],
  X: [[[-16,0,0],[16,0,0]],[[0,0,-16],[0,0,16]]],
  Y: [[[0,0,0],[-12,0,-12]],[[0,0,0],[12,0,-12]],[[0,0,0],[0,0,16]]],
  Rotatória: [[[-10,0,0],[0,0,-10],[10,0,0],[0,0,10],[-10,0,0]],[[10,0,0],[20,0,0]]],
  Ponte: [[[-16,0,0],[16,0,0]],[[0,4,-16],[0,4,16]]],
};
const SAVE_KEY = "grafting:bezier-lab:v1";
const command = (s: ConstructionSession, commands: unknown[]): Result[] =>
  JSON.parse(s.bezier_batch_json(JSON.stringify({ tolerance: 0.025, commands }))) as Result[];

export default function BezierRoadLab() {
  const [session, setSession] = useState<ConstructionSession>();
  const [model, setModel] = useState<Model>({ curves: [], layers: [], width: 1 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const undo = useRef<Model[]>([]);
  const redo = useRef<Model[]>([]);
  const drag = useRef<{ curve: number; handle: 1 | 2 | "middle"; before: Model } | undefined>(undefined);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let disposed = false;
    let value: ConstructionSession | undefined;
    void init().then(() => {
      if (disposed) return;
      value = new ConstructionSession(); setSession(value);
    }).catch((e: unknown) => setError(String(e)));
    return () => { disposed = true; value?.free(); };
  }, []);
  const commit = (next: Model) => { undo.current.push(model); redo.current = []; setModel(next); };
  const fixture = (name: string) => {
    if (!session) return;
    const paths = FIXTURES[name]!;
    const fitted = command(session, paths.map((points) => ({ kind: "automatic", points })));
    commit({ curves: fitted.flatMap((r) => r.curves), layers: fitted.flatMap((r, i) => r.curves.map(() => paths[i]![0]![1])), width: 1, endWidth: name === "Transição de largura" ? 3 : undefined });
    setError(""); setNotice(name);
  };
  const view = useMemo(() => {
    if (!session || !model.curves.length) return undefined;
    try {
      if (!Number.isFinite(model.width) || model.width <= 0 || model.layers.length !== model.curves.length) throw Error("Perfil inválido.");
      const results = command(session, model.curves.map((curve,i) => ({ kind: "ribbon", curve, offsets: profileFor(model,i).bandOffsets, endOffsets: profileFor(model,i).endBandOffsets })));
      const fills = [...new Set(model.layers)].flatMap((layer) => {
        const subject = results.flatMap((r, i) => model.layers[i] === layer ? [ [r.ribbon!.outer.map((p) => [p[0],p[2]])] ] : []);
        const shapes = JSON.parse(session.planar_boolean_json(JSON.stringify({ operation: "union", subject, clip: [] }))) as number[][][][];
        return shapes.map((shape) => ({ layer, path: shape.map((ring) => "M"+ring.map((p) => p.join(",")).join("L")+"Z").join(" ") }));
      });
      const network = JSON.parse(session.bezier_network_json(JSON.stringify({
        nodes: [], edges: [],
        addedNodes: model.curves.flatMap((c, i) => [{id:"anchor:"+i+":a",position:c.points[0]},{id:"anchor:"+i+":b",position:c.points[3]}]),
        addedEdges: results.map((r, i) => ({edgeId:"edge:"+i,startNodeId:"anchor:"+i+":a",endNodeId:"anchor:"+i+":b",curve:{...(r.handles[0] as object),...profileFor(model,i)}})),
        nodePrefix:"junction:",snapTolerance:0.001,heightTolerance:0.15,tolerance:0.005,
      }))) as {nodes:{id:string;position:Point}[];edges:unknown[]};
      const middle = command(session, model.curves.map((curve) => ({ kind: "split", curve, t: 0.5 }))).map((r) => r.curves[0]!.points[3]);
      return { results, fills, network, middle, error: "" };
    } catch (e) { return { error: String(e), results: [], fills: [], network: {nodes:[],edges:[]}, middle: [] }; }
  }, [session, model]);
  const split = (index: number) => {
    if (!session) return;
    const authored=command(session,[{kind:"sample",curves:[model.curves[index]]}])[0]!.handles[0] as object;
    const result = command(session,[{kind:"split",curve:model.curves[index],t:0.5,profile:{...authored,...profileFor(model,index)}}])[0]!;
    const profiles=model.curves.map((_,i)=>profileFor(model,i));
    commit({ ...model, profiles: [...profiles.slice(0,index),...(result.handles as Profile[]).map(({bandOffsets,endBandOffsets})=>({bandOffsets,endBandOffsets})),...profiles.slice(index+1)], curves: [...model.curves.slice(0,index),...result.curves,...model.curves.slice(index+1)],
      layers:[...model.layers.slice(0,index),model.layers[index]!,model.layers[index]!,...model.layers.slice(index+1)] });
  };
  return <main style={{padding:24,maxWidth:1200,margin:"auto",fontFamily:"system-ui"}}>
    <a href="/lab">← Laboratório</a>
    <h1>Ruas Bézier</h1>
    <p>Arraste as alças azuis ou o ponto laranja no meio do trecho. Clique duas vezes no ponto laranja para inserir uma âncora sem mudar a forma.</p>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {Object.keys(FIXTURES).map((name)=><button key={name} disabled={!session} onClick={()=>fixture(name)}>{name}</button>)}
      <button onClick={()=>{const before=undo.current.pop();if(before){redo.current.push(model);setModel(before);}}}>Desfazer</button>
      <button onClick={()=>{const after=redo.current.pop();if(after){undo.current.push(model);setModel(after);}}}>Refazer</button>
      <label>Meia largura <input type="number" min="0.1" max="5" step="0.1" value={model.width} onChange={(e)=>commit({...model,width:Number(e.target.value),profiles:undefined})}/></label>
    </div>
    <p role="status">{error || view?.error || notice || (session ? "Selecione um cenário." : "Carregando núcleo Rust…")}</p>
    <svg ref={svgRef} viewBox="-24 -22 48 44" style={{width:"100%",height:600,background:"#12202d",touchAction:"none"}}
      onPointerMove={(e)=>{
        if(!drag.current || !session) return;
        const d=drag.current;const p=e.currentTarget.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
        const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;
        const local=p.matrixTransform(matrix.inverse());
        const c=d.before.curves[d.curve]!;
        const target:Point=[local.x,c.points[0][1],local.y];
        try {
          const r=command(session,[d.handle==="middle"?{kind:"pull",curve:c,t:0.5,target}:{kind:"handle",curve:c,index:d.handle,target,mode:"free",opposite:null}])[0]!;
          command(session,[{kind:"ribbon",curve:r.curves[0],offsets:[-model.width,model.width]}]);
          setModel({...d.before,curves:d.before.curves.map((v,i)=>i===d.curve?r.curves[0]!:v)});setError("");
        }catch(ex){setError(String(ex));}
      }}
      onPointerUp={(e)=>{if(drag.current){undo.current.push(drag.current.before);redo.current=[];drag.current=undefined;e.currentTarget.releasePointerCapture(e.pointerId);}}}
      onPointerCancel={()=>{if(drag.current)setModel(drag.current.before);drag.current=undefined;}}
      onKeyDown={(e)=>{if(e.key==="Escape" && drag.current){setModel(drag.current.before);drag.current=undefined;}}} tabIndex={0}>
      {view?.fills.map((f,i)=><path key={i} d={f.path} fill={f.layer ? "#7694ad" : "#455969"} fillRule="evenodd" stroke="#bacbd7" strokeWidth={0.05}/>)}
      {view?.results.map((r,i)=><polyline key={i} points={r.samples[0]!.map((p)=>p.position[0]+","+p.position[2]).join(" ")} fill="none" stroke="#f4b860" strokeWidth={0.08}/>)}
      {model.curves.map((c,i)=><g key={i}>
        <polyline points={[c.points[0],c.points[1],c.points[2],c.points[3]].map((p)=>p[0]+","+p[2]).join(" ")} fill="none" stroke="#52b7ff" strokeWidth={0.05} strokeDasharray="0.2 0.15"/>
        {([1,2] as const).map((h)=><circle key={h} cx={c.points[h][0]} cy={c.points[h][2]} r={0.25} fill="#52b7ff" onPointerDown={(e)=>{e.stopPropagation();drag.current={curve:i,handle:h,before:model};e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId);}}/>)}
        {view?.middle[i] && <circle cx={view.middle[i]![0]} cy={view.middle[i]![2]} r={0.25} fill="#ffbd59" onDoubleClick={()=>split(i)} onPointerDown={(e)=>{e.stopPropagation();drag.current={curve:i,handle:"middle",before:model};e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId);}}/>}
      </g>)}
      {view?.network.nodes.map((n)=><circle key={n.id} cx={n.position[0]} cy={n.position[2]} r={0.16} fill="#f4f6f8"/>)}
    </svg>
    <p>{view?.network.nodes.length ?? 0} âncoras · {view?.network.edges.length ?? 0} trechos após conexões. A ponte mantém alturas e conectividade separadas.</p>
    <button onClick={()=>{const json=JSON.stringify(model);localStorage.setItem(SAVE_KEY,json);if(svgRef.current)writePreviewImage("bezier-roads","data:image/svg+xml;charset=utf-8,"+encodeURIComponent(new XMLSerializer().serializeToString(svgRef.current)));setSaved(json);setNotice("Autoria salva neste navegador.");}}>Salvar autoria</button>
    <button onClick={()=>{try{const next=JSON.parse(saved || localStorage.getItem(SAVE_KEY) || "") as Model;if(!session) return;command(session,next.curves.map((curve)=>({kind:"sample",curves:[curve]})));commit(next);setNotice("Autoria restaurada.");}catch(e){setError(String(e));}}}>Restaurar autoria</button>
    <textarea aria-label="Autoria em JSON" value={saved} onChange={(e)=>setSaved(e.target.value)} style={{display:"block",width:"100%",minHeight:70}}/>
    <details><summary>Topologia retornada pelo núcleo</summary><pre>{JSON.stringify(view?.network,null,2)}</pre></details>
  </main>;
}
