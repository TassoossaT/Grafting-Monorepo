import assert from "node:assert/strict";
import test from "node:test";

import {
  createRoadMeshPreview,
  createSnapMeshPreview,
  PREVIEW_ELEVATION,
  NODE_DISK_ELEVATION,
  ROAD_PREVIEW_COLOR,
  ROAD_ERROR_COLOR,
  SNAP_DISK_COLOR,
} from "../src/composition/tabletop/tools/paths/road-preview-mesh.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { pathBrushTool as tool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { pathHalfWidth } from "../src/features/edit-construction/index.ts";

for (const way of ["click", "drag"]) for (const pathKind of ["street", "road"]) {
  test(`${way} preview preserves the confirmed ${pathKind} profile and sampling`, () => {
    const f=sessionFixture(), previews=new Map();
    f.runtime.showPreview=(d,c)=>previews.set(c,d);
    f.runtime.clearPreview=c=>previews.delete(c);
    f.runtime.getFootprintCoverage=()=>[];
    f.ctx.reportSelection=()=>{};
    const params={...tool.defaultParams(),pathKind,bedWidth:0.6,shoulderWidth:0.8};
    const samples=[{point:{x:-10,y:0,z:0}},{point:{x:0,y:2,z:3}},{point:{x:10,y:0,z:0}}];
    try {
      const before=f.session.snapshot_json();
      let preview,anchors;
      if(way==="click") {
        const [a,b]=samples;
        tool.onPointerDown(f.ctx,a,params);tool.onPointerUp(f.ctx,{start:a,current:a,samples:[a]},params);
        tool.previewFor({start:b,current:b,samples:[b]},params,f.ctx);
        preview=previews.get("road-span");anchors=[a.point,b.point];
        assert.equal(f.session.snapshot_json(),before);
        tool.onPointerDown(f.ctx,b,params);tool.onPointerUp(f.ctx,{start:b,current:b,samples:[b]},params);
      } else {
        const g={start:samples[0],current:samples[2],samples};
        tool.onPointerDown(f.ctx,samples[0],params);
        tool.onPointerMove(f.ctx,g,params);
        preview=previews.get("road-stroke");anchors=[samples[0].point,samples[2].point];
        assert.equal(f.session.snapshot_json(),before);
        tool.onPointerUp(f.ctx,g,params);
      }
      assert.notEqual(f.session.snapshot_json(),before);
      const graph=f.runtime.getGraphSnapshot(), nodes=new Map(graph.nodes.map(n=>[n.id,n.position]));
      const xyz=p=>[p.x,p.y,p.z];
      const curves=graph.edges.filter(e=>e.curve).map(e=>f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"resolve",handles:e.curve,start:xyz(nodes.get(e.startNodeId)),end:xyz(nodes.get(e.endNodeId))}]})[0].curves[0]);
      const half=pathHalfWidth(params);
      const ribbons=f.runtime.curveBatch({tolerance:0.025,commands:curves.map(curve=>({kind:"ribbon",curve,offsets:[-half,half]}))});
      const expected=createRoadMeshPreview({ribbons,anchors,bedWidth:half*2});
      assert.deepEqual(preview.positions,expected.positions);
      assert.deepEqual(preview.indices,expected.indices);
    }finally{tool.onCancel(f.ctx);f.session.free();}
  });
}

test("createRoadMeshPreview generates solid ribbon quads and anchor disks with anti-clipping elevation", () => {
  const outer = [
    [-1, 0, 0], [1, 0, 0],
    [-1, 0, 5], [1, 0, 5],
  ];
  // Outer ribbon loop: left side [0,0,0], [0,0,5] then right side [2,0,5], [2,0,0]
  const mockRibbonOuter = [
    [-1, 0, 0], [-1, 0, 5],
    [1, 0, 5], [1, 0, 0],
  ];

  const descriptor = createRoadMeshPreview({
    ribbons: [{ ribbon: { outer: mockRibbonOuter } }],
    anchors: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }],
    bedWidth: 2,
  });

  assert.equal(descriptor.kind, "mesh");
  assert.ok(descriptor.positions instanceof Float32Array);
  assert.ok(descriptor.indices instanceof Uint32Array);
  assert.ok(descriptor.positions.length > 0);
  assert.ok(descriptor.indices.length > 0);
  assert.equal(descriptor.color, ROAD_PREVIEW_COLOR);

  // Verify anti-clipping: all y coordinates must be elevated above 0
  for (let i = 1; i < descriptor.positions.length; i += 3) {
    const y = descriptor.positions[i];
    assert.ok(y >= PREVIEW_ELEVATION - 1e-4, `y=${y} should be at least ${PREVIEW_ELEVATION}`);
  }
});

test("createRoadMeshPreview creates straight quad fallback when curves cannot be computed", () => {
  const points = [{ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }];
  const descriptor = createRoadMeshPreview({
    fallbackPoints: points,
    anchors: points,
    bedWidth: 2,
    color: ROAD_ERROR_COLOR,
  });

  assert.equal(descriptor.kind, "mesh");
  assert.equal(descriptor.color, ROAD_ERROR_COLOR);
  assert.ok(descriptor.positions.length >= 12);
  assert.ok(descriptor.indices.length >= 6);

  // Check elevation offset
  for (let i = 1; i < descriptor.positions.length; i += 3) {
    const y = descriptor.positions[i];
    assert.ok(y >= 1 + PREVIEW_ELEVATION - 1e-4);
  }
});

test("createSnapMeshPreview generates glowing circular target at target coordinate", () => {
  const target = { x: 5, y: 2, z: -3 };
  const descriptor = createSnapMeshPreview(target, 0.5);

  assert.equal(descriptor.kind, "mesh");
  assert.equal(descriptor.color, SNAP_DISK_COLOR);
  assert.ok(descriptor.positions.length > 0);
  assert.ok(descriptor.indices.length > 0);

  // Check center and elevation
  assert.equal(descriptor.positions[0], 5);
  assert.ok(descriptor.positions[1] >= 2 + NODE_DISK_ELEVATION - 1e-4);
  assert.equal(descriptor.positions[2], -3);
});

test("the road tool previews the span to the pointer while an origin waits", () => {
  const f = sessionFixture();
  f.previews = new Map();
  f.runtime.showPreview = (d, c) => f.previews.set(c, d);
  f.runtime.clearPreview = (c) => f.previews.delete(c);

  const params = { ...tool.defaultParams(), bedWidth: 1.5 };
  const origin = { point: { x: 0, y: 0, z: 0 } };
  const move1 = { point: { x: 5, y: 0, z: 5 } };

  try {
    tool.onPointerDown(f.ctx, origin, params);
    tool.onPointerUp(f.ctx, { start: origin, current: origin, samples: [origin] }, params);
    tool.previewFor({ start: move1, current: move1, samples: [move1] }, params, f.ctx);

    assert.ok(f.previews.has("road-span"));
    const preview = f.previews.get("road-span");
    assert.equal(preview.kind, "mesh");
    assert.ok(preview.positions.length > 20);
    assert.ok(preview.indices.length > 20);
  } finally {
    tool.onCancel?.(f.ctx);
    f.session.free();
  }
});

test("invalid hover displays an error preview without changing the waiting origin",()=>{
  const f=sessionFixture(),previews=new Map();
  f.runtime.showPreview=(d,c)=>previews.set(c,d);
  f.runtime.clearPreview=c=>previews.delete(c);
  const params={...tool.defaultParams(),bedWidth:0.6};
  const a={point:{x:-4,y:0,z:0}},invalid={point:{x:-4,y:4,z:0}},valid={point:{x:4,y:4,z:0}};
  try {
    tool.onPointerDown(f.ctx,a,params);
    tool.onPointerUp(f.ctx,{start:a,current:a,samples:[a]},params);
    const before=f.session.snapshot_json();
    tool.previewFor({start:invalid,current:invalid,samples:[invalid]},params,f.ctx);
    assert.equal(previews.get("road-span").color,ROAD_ERROR_COLOR);
    assert.equal(f.session.snapshot_json(),before);
    tool.previewFor({start:valid,current:valid,samples:[valid]},params,f.ctx);
    assert.equal(previews.get("road-span").color,ROAD_PREVIEW_COLOR);
    assert.equal(f.session.snapshot_json(),before);
  } finally {tool.onCancel(f.ctx);f.session.free();}
});

test("the road tool previews a stroke during a drag", () => {
  const f = sessionFixture();
  f.previews = new Map();
  f.runtime.showPreview = (d, c) => f.previews.set(c, d);
  f.runtime.clearPreview = (c) => f.previews.delete(c);

  const params = { ...tool.defaultParams(), bedWidth: 2 };
  const a = { point: { x: 0, y: 0, z: 0 } };
  const b = { point: { x: 5, y: 0, z: 0 } };
  const c = { point: { x: 10, y: 0, z: 2 } };

  try {
    tool.onPointerDown(f.ctx, a, params);
    tool.onPointerMove(f.ctx, { start: a, current: c, samples: [a, b, c] }, params);

    assert.ok(f.previews.has("road-stroke"));
    const preview = f.previews.get("road-stroke");
    assert.equal(preview.kind, "mesh");
    assert.ok(preview.positions.length > 20);
    assert.ok(preview.indices.length > 20);
  } finally {
    tool.onCancel?.(f.ctx);
    f.session.free();
  }
});
