import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { spineRibbons } from "../src/features/edit-construction/spine/spine-ribbons.ts";
import { bezierChains } from "../src/features/edit-construction/structure-types/path/bezier-road-plan.ts";

test("generated segments keep graph references and Rust stations independently of mesh resolution", () => {
  const f=sessionFixture();
  const profile={start:[1,0,1],end:[4,1,1],mode:"free",bandOffsets:[-1,1],endBandOffsets:[-2,2],surfaceType:"path"};
  const snapshot={nodes:[{id:"spine:composition:0",position:{x:0,y:0,z:0}},{id:"spine:composition:1",position:{x:5,y:1,z:0}}],edges:[{edgeId:"spine-edge:composition:0",startNodeId:"spine:composition:0",endNodeId:"spine:composition:1",curve:profile}]};
  try {
    const before=structuredClone(snapshot);
    const [chain]=bezierChains(snapshot,f.runtime,[-1,1],4);
    assert.equal(chain.chainId,snapshot.edges[0].edgeId);
    assert.equal(chain.source.startNodeId,snapshot.nodes[0].id);
    assert.equal(chain.source.endNodeId,snapshot.nodes[1].id);
    assert.deepEqual(chain.source.profile,profile);
    assert.equal(chain.source.stations[0].t,0);
    assert.equal(chain.source.stations.at(-1).t,1);
    assert.deepEqual(chain.source.stations.map(s=>({x:s.position[0],y:s.position[1],z:s.position[2]})),chain.sampledPoints);
    assert.ok(chain.sampledPoints.length>snapshot.nodes.length);
    assert.deepEqual(snapshot,before,"mesh stations must not create authoring handles");
  }finally{f.session.free();}
});

test("segment dependencies reuse unchanged Rust sweeps and invalidate anchors, profile and resolution", () => {
  const f=sessionFixture(), calls=[];
  const port={curveBatch(request){calls.push(request);return f.runtime.curveBatch(request);}};
  const span=(x)=>({start:{x,y:0,z:0},end:{x:x+5,y:0,z:0},handles:{start:[x+1,0,1],end:[x+4,0,1],mode:"free",bandOffsets:[-1,1]}});
  const spans=[span(0),span(5),span(10)];
  const count=kind=>calls.flatMap(r=>r.commands).filter(c=>c.kind===kind).length;
  try {
    const first=spineRibbons(port,spans,[-1,1],0.025);
    assert.equal(count("resolve"),3);assert.equal(count("ribbon"),3);
    calls.length=0;
    assert.deepEqual(spineRibbons(port,structuredClone(spans),[-1,1],0.025),first);
    assert.equal(calls.length,0,"identical authoring must reuse all derived segments");
    const changed=structuredClone(spans);changed[1].end.y=2;
    const second=spineRibbons(port,changed,[-1,1],0.025);
    assert.equal(count("resolve"),1);assert.equal(count("ribbon"),1);
    assert.deepEqual(second[0],first[0]);assert.deepEqual(second[2],first[2]);
    assert.notDeepEqual(second[1],first[1]);
    calls.length=0;changed[1].handles.endBandOffsets=[-2,2];
    const tapered=spineRibbons(port,changed,[-1,1],0.025);
    assert.equal(count("ribbon"),1);assert.notDeepEqual(tapered[1].outline,second[1].outline);
    calls.length=0;spineRibbons(port,changed,[-1,1],0.01);
    assert.equal(count("resolve"),3);assert.equal(count("ribbon"),3);
    calls.length=0;spineRibbons(port,spans,[-1,1],0.025);
    assert.equal(calls.length,0,"rollback can recover the original derived inputs");
  }finally{f.session.free();}
});

test("segment reuse is port-local and never suppresses custom station policies", () => {
  const f=sessionFixture();
  const spans=[{start:{x:0,y:0,z:0},end:{x:5,y:1,z:0},handles:{start:[1,0,1],end:[4,1,1],mode:"free",bandOffsets:[-1,1]}}];
  let requests=0;
  const port={curveBatch(r){requests++;return f.runtime.curveBatch(r);}};
  try {
    spineRibbons(port,spans,[-1,1],0.025);
    const a=spineRibbons(port,spans,[-1,1],0.025,()=>[0,0.5,1]);
    const b=spineRibbons(port,spans,[-1,1],0.025,()=>[0,0.25,0.5,0.75,1]);
    assert.equal(a[0].outline.length,6);assert.equal(b[0].outline.length,10);
    assert.equal(requests,6);
    const other={curveBatch(r){requests++;return f.runtime.curveBatch(r);}};
    spineRibbons(other,spans,[-1,1],0.025);assert.equal(requests,8);
  }finally{f.session.free();}
});

test("a shared-anchor edit resweeps its two incident spans while preserving all junction dependencies", () => {
  const f=sessionFixture(),calls=[];
  const port={curveBatch(r){calls.push(r);return f.runtime.curveBatch(r);}};
  const nodes=Array.from({length:61},(_,i)=>({id:`spine:dependencies:${i}`,position:{x:i*5,y:0,z:0}}));
  const edges=nodes.slice(1).map((_,i)=>({edgeId:`spine-edge:dependencies:${i}`,startNodeId:nodes[i].id,endNodeId:nodes[i+1].id,
    curve:{start:[i*5+1,0,0],end:[i*5+4,0,0],mode:"free",bandOffsets:[-0.3,0.3],surfaceType:"path"}}));
  const count=kind=>calls.flatMap(r=>r.commands).filter(c=>c.kind===kind).length;
  try {
    const before=bezierChains({nodes,edges},port,[-0.3,0.3],4);
    assert.equal(count("resolve"),60);assert.equal(count("ribbon"),60);assert.equal(count("join"),59);
    calls.length=0;
    const next=structuredClone(nodes);next[25].position.y=0.3;
    const after=bezierChains({nodes:next,edges},port,[-0.3,0.3],4);
    assert.equal(count("resolve"),2);assert.equal(count("ribbon"),2);
    assert.equal(count("join"),59,"junction evaluation remains complete, never silently narrowed");
    for(let i=0;i<60;i++)if(i!==24&&i!==25){
      assert.deepEqual(after[i].sampledPoints,before[i].sampledPoints);
      assert.deepEqual(after[i].source,before[i].source);
    }
  }finally{f.session.free();}
});
