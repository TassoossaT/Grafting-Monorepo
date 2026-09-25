import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { pathBrushTool as tool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { PATH_SURFACE_TYPE } from "../src/features/edit-construction/structure-types/path/path-surface-type.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";

const points = { ...tool.defaultParams(), creationMode: "points", bedWidth: 4 };

function createRoadFixture() {
  const f = sessionFixture();
  f.previews = new Map();
  f.runtime.showPreview = (d, c) => f.previews.set(c, d);
  f.runtime.clearPreview = (c) => f.previews.delete(c);
  f.runtime.getFootprintCoverage = () => [];
  const sample = (x, z, y = 0) => ({ point: { x, y, z } });
  const gesture = (a, b) => ({ start: a, current: b, samples: [a, b] });
  f.click = (a, b = a, params = points) => {
    tool.onPointerDown(f.ctx, a, params);
    tool.onPointerUp(f.ctx, gesture(a, b), params);
  };
  f.finish = (params = points) => tool.onKeyDown(f.ctx, "Enter", params);
  f.cancel = () => tool.onCancel(f.ctx);
  f.close = () => { tool.onCancel(f.ctx); f.session.free(); };
  return { f, sample, gesture };
}

function clickBody(f, x, z, y = 0, params = points) {
  const topos = f.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === PATH_SURFACE_TYPE);
  let bestTopo = topos[0];
  let bestDist = Infinity;
  for (const t of topos) {
    for (const n of t.nodes) {
      const d = Math.hypot(n.position.x - x, n.position.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestTopo = t;
      }
    }
  }
  const surfaceRef = bestTopo ? surfaceRefFromNodeSet(bestTopo.surfaceKey) : undefined;
  const s = { point: { x, y, z }, surfaceRef };
  f.click(s, s, params);
}

function runScenario(setupFn) {
  const { f, sample } = createRoadFixture();
  try {
    setupFn(f, sample);
    const topologies = f.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === PATH_SURFACE_TYPE);
    const meshesJson = f.session.all_surface_meshes_json();
    const meshes = JSON.parse(meshesJson);
    const totalTriangles = meshes.reduce((acc, m) => acc + m.indices.length / 3, 0);
    const totalVertices = meshes.reduce((acc, m) => acc + m.positions.length / 3, 0);
    const totalTopoNodes = topologies.reduce((acc, t) => acc + t.nodes.length, 0);
    const refined = totalVertices > totalTopoNodes;
    const errors = f.calls.feedback.filter((v) => v.tone === "error");
    return { topologies, meshes, totalTriangles, totalVertices, refined, errors };
  } finally {
    f.close();
  }
}

test("junction geometry: perpendicular T-junction produces a single unified mesh", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0)); f.click(sample(10, 0)); f.finish();
    f.click(sample(0, 10)); clickBody(f, 0, 0);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
  assert.ok(res.totalTriangles >= 6);
});

test("junction geometry: acute 45° branch produces a single unified mesh", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0)); f.click(sample(10, 0)); f.finish();
    f.click(sample(-8, 4)); clickBody(f, 0, 0);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
});

test("junction geometry: acute 14° branch connects without error", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0)); f.click(sample(10, 0)); f.finish();
    f.click(sample(-10, 2.5)); clickBody(f, 0, 0);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
});

test("junction geometry: branch on curved road produces single mesh", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0)); f.click(sample(0, 5)); f.click(sample(10, 0)); f.finish();
    f.click(sample(0, 10)); clickBody(f, 0, 5);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
});

test("junction geometry: roads with different widths union cleanly", () => {
  const wide = { ...points, bedWidth: 8 };
  const narrow = { ...points, bedWidth: 2 };
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0), sample(-10, 0), wide);
    f.click(sample(10, 0), sample(10, 0), wide);
    f.finish(wide);
    f.click(sample(0, 10), sample(0, 10), narrow);
    clickBody(f, 0, 0);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
});

test("junction geometry: 4-way crossing produces single unified mesh", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0)); f.click(sample(10, 0)); f.finish();
    f.click(sample(0, -10)); f.click(sample(0, 10)); f.finish();
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
});

test("junction geometry: sloped meeting refines into smooth mesh without twisting", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0, 0)); f.click(sample(10, 0, 5)); f.finish();
    f.click(sample(0, 10, 2.5)); clickBody(f, 0, 0, 2.5);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
  assert.equal(res.refined, true);
  assert.ok(res.totalTriangles > 50, "sloped junction must be refined with interior strip triangles");
});

test("junction geometry: sloped meeting with vertical tolerance delta joins cleanly", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0, 0)); f.click(sample(10, 0, 5)); f.finish();
    f.click(sample(0, 10, 2.55)); clickBody(f, 0, 0, 2.55);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
  assert.equal(res.refined, true);
});

test("junction geometry: acute branch on sloped road refines cleanly", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0, 0)); f.click(sample(10, 0, 5)); f.finish();
    f.click(sample(-8, 4, 1.5)); clickBody(f, 0, 0, 2.5);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
  assert.equal(res.refined, true);
});

test("junction geometry: Y-fork on slope refines into continuous strip mesh", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(0, -10, 0)); f.click(sample(0, 0, 2.5)); f.finish();
    f.click(sample(-4, 7, 5)); clickBody(f, 0, 0, 2.5);
    f.click(sample(4, 7, 5)); clickBody(f, 0, 0, 2.5);
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 1);
  assert.equal(res.meshes.length, 1);
  assert.equal(res.refined, true);
});

test("junction geometry: grade-separated crossing produces two distinct independent meshes", () => {
  const res = runScenario((f, sample) => {
    f.click(sample(-10, 0, 0)); f.click(sample(10, 0, 0)); f.finish();
    f.click(sample(0, -10, 5)); f.click(sample(0, 10, 5)); f.finish();
  });
  assert.equal(res.errors.length, 0);
  assert.equal(res.topologies.length, 2);
  assert.equal(res.meshes.length, 2);
});
