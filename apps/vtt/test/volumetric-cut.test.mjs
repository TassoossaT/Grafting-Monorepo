import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initSync } from "../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm.js";
initSync({ module: readFileSync(new URL("../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm_bg.wasm", import.meta.url)) });

import { createConstructionSessionAdapter } from "../src/adapters/construction/index.ts";
import { AppTabletopRuntime } from "../src/composition/tabletop/tabletop-runtime.ts";

function createFakeTerrainNoisePort() {
  return {
    async start() {},
    async dispose() {},
  };
}

function createFakeRenderPort() {
  const changes = [];
  let started = false;
  let attachedViews = 0;

  return {
    changes,
    async start() {
      started = true;
    },
    attachView() {
      attachedViews += 1;
      return `view-${attachedViews}`;
    },
    detachView() {
      attachedViews = Math.max(0, attachedViews - 1);
    },
    resizeView() {},
    applyConfirmed(change) {
      changes.push(change);
    },
    pick() {
      return undefined;
    },
    setFloorClipHeight() {},
    getMetrics() {
      return {
        attachedViews,
        confirmedTokenChanges: changes.length,
        terrainUploads: 0,
      };
    },
    async dispose() {
      started = false;
    },
  };
}

test("ConstructionSessionWasmAdapter: applyVolumetricCut pierces hole and generates cavity lining", async () => {
  const adapter = createConstructionSessionAdapter();
  await adapter.start();

  // Create a 10x10 quad terrain patch
  const patch = {
    nodes: [
      { id: "v0", position: { x: 0, y: 0, z: 0 } },
      { id: "v1", position: { x: 10, y: 0, z: 0 } },
      { id: "v2", position: { x: 10, y: 0, z: 10 } },
      { id: "v3", position: { x: 0, y: 0, z: 10 } },
    ],
    edges: [
      { edgeId: "e0", startNodeId: "v0", endNodeId: "v1" },
      { edgeId: "e1", startNodeId: "v1", endNodeId: "v2" },
      { edgeId: "e2", startNodeId: "v2", endNodeId: "v3" },
      { edgeId: "e3", startNodeId: "v3", endNodeId: "v0" },
    ],
    regions: [
      {
        regionId: "ground_patch_1",
        surfaceType: "terrain",
        physical: true,
        boundary: [
          { edgeId: "e0", reversed: false },
          { edgeId: "e1", reversed: false },
          { edgeId: "e2", reversed: false },
          { edgeId: "e3", reversed: false },
        ],
      },
    ],
  };

  const outcome = adapter.applyRegionOverlay({
    operationId: "initial_ground",
    sourceSurfaceKeys: [],
    outline: [[0, 0], [10, 0], [10, 10], [0, 10]],
    boundary: [
      { edgeId: "e0", reversed: false },
      { edgeId: "e1", reversed: false },
      { edgeId: "e2", reversed: false },
      { edgeId: "e3", reversed: false },
    ],
    patch,
  });

  assert.ok(outcome.createdSurfaceKeys.length >= 1, "created ground surface");

  // Apply a spherical excavation cut at center (5, 0, 5) with radius 2
  const cutResponse = adapter.applyVolumetricCut({
    volume: {
      type: "sphere",
      center: [5.0, 0.0, 5.0],
      radius: 2.0,
    },
    liningSurfaceType: "cave_rock",
    generateLining: true,
  });

  assert.equal(cutResponse.affectedRegions.length, 1, "ground region was cut");
  assert.equal(cutResponse.holesInserted, 1, "hole was inserted in ground");
  assert.ok(cutResponse.liningRegions.length > 0, "cavity lining regions generated");
});

test("TabletopRuntime: applyVolumetricCut integrates seamlessly into map projection and renders", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createConstructionSessionAdapter();

  const runtime = new AppTabletopRuntime(
    "table-volumetric-cut-test",
    renderPort,
    constructionPort,
    createFakeTerrainNoisePort(),
    [],
  );

  await runtime.start();

  // Add initial ground patch
  const patch = {
    nodes: [
      { id: "g0", position: { x: 0, y: 0, z: 0 } },
      { id: "g1", position: { x: 10, y: 0, z: 0 } },
      { id: "g2", position: { x: 10, y: 0, z: 10 } },
      { id: "g3", position: { x: 0, y: 0, z: 10 } },
    ],
    edges: [
      { edgeId: "ge0", startNodeId: "g0", endNodeId: "g1" },
      { edgeId: "ge1", startNodeId: "g1", endNodeId: "g2" },
      { edgeId: "ge2", startNodeId: "g2", endNodeId: "g3" },
      { edgeId: "ge3", startNodeId: "g3", endNodeId: "g0" },
    ],
    regions: [
      {
        regionId: "ground_surface_main",
        surfaceType: "terrain",
        physical: true,
        boundary: [
          { edgeId: "ge0", reversed: false },
          { edgeId: "ge1", reversed: false },
          { edgeId: "ge2", reversed: false },
          { edgeId: "ge3", reversed: false },
        ],
      },
    ],
  };

  runtime.applyRegionOverlay(
    {
      operationId: "seed_ground",
      sourceSurfaceKeys: [],
      outline: [[0, 0], [10, 0], [10, 10], [0, 10]],
      boundary: [
        { edgeId: "ge0", reversed: false },
        { edgeId: "ge1", reversed: false },
        { edgeId: "ge2", reversed: false },
        { edgeId: "ge3", reversed: false },
      ],
      patch,
    },
    "local",
    "init",
  );

  // Excavate a tunnel / cave
  const cutResponse = runtime.applyVolumetricCut(
    {
      volume: {
        type: "cylinder",
        start: [0.0, 0.0, 5.0],
        end: [10.0, 0.0, 5.0],
        radius: 1.5,
      },
      liningSurfaceType: "tunnel_interior",
      generateLining: true,
    },
    "local",
    "excavate_tunnel",
  );

  assert.ok(cutResponse.affectedRegions.length >= 1, "pierced tunnel entrances");
  assert.ok(cutResponse.liningRegions.length >= 1, "generated tunnel sleeve");
});

test("executeTerrainCut: cleanly pierces hole and excavates 3D cavity using volumetric boolean engine", async () => {
  const { executeTerrainCut } = await import("../src/composition/tabletop/terrain/terrain-cut-executor.ts");
  const renderPort = createFakeRenderPort();
  const constructionPort = createConstructionSessionAdapter();

  const runtime = new AppTabletopRuntime(
    "table-terrain-cut-volumetric",
    renderPort,
    constructionPort,
    createFakeTerrainNoisePort(),
    [],
  );

  await runtime.start();

  const patch = {
    nodes: [
      { id: "h0", position: { x: 0, y: 0, z: 0 } },
      { id: "h1", position: { x: 20, y: 0, z: 0 } },
      { id: "h2", position: { x: 20, y: 0, z: 20 } },
      { id: "h3", position: { x: 0, y: 0, z: 20 } },
    ],
    edges: [
      { edgeId: "he0", startNodeId: "h0", endNodeId: "h1" },
      { edgeId: "he1", startNodeId: "h1", endNodeId: "h2" },
      { edgeId: "he2", startNodeId: "h2", endNodeId: "h3" },
      { edgeId: "he3", startNodeId: "h3", endNodeId: "h0" },
    ],
    regions: [
      {
        regionId: "ground_plate",
        surfaceType: "terrain",
        physical: true,
        boundary: [
          { edgeId: "he0", reversed: false },
          { edgeId: "he1", reversed: false },
          { edgeId: "he2", reversed: false },
          { edgeId: "he3", reversed: false },
        ],
      },
    ],
  };

  runtime.applyRegionOverlay(
    {
      operationId: "seed_plate",
      sourceSurfaceKeys: [],
      outline: [[0, 0], [20, 0], [20, 20], [0, 20]],
      boundary: [
        { edgeId: "he0", reversed: false },
        { edgeId: "he1", reversed: false },
        { edgeId: "he2", reversed: false },
        { edgeId: "he3", reversed: false },
      ],
      patch,
    },
    "local",
    "init",
  );

  // 1. Test profile: { kind: "hole" } using volumetric cut
  const holeOutcome = executeTerrainCut(runtime, {
    area: {
      center: { x: 10, y: 0, z: 10 },
      radius: 3,
    },
    targetSurfaceType: "terrain",
    profile: { kind: "hole" },
    causeId: "hole_cut_1",
    tableId: "table-terrain-cut-volumetric",
  });

  assert.equal(holeOutcome.success, true, "hole cut succeeded");
  assert.ok(holeOutcome.message?.includes("aberturas recortadas"), "reported boolean hole piercing");

  // 2. Test profile: { kind: "volumetric" } with lining
  const volOutcome = executeTerrainCut(runtime, {
    area: {
      center: { x: 5, y: 0, z: 5 },
      radius: 2,
    },
    targetSurfaceType: "terrain",
    profile: { kind: "volumetric", generateLining: true, liningSurfaceType: "terrain-rock" },
    causeId: "vol_cut_1",
    tableId: "table-terrain-cut-volumetric",
  });

  assert.equal(volOutcome.success, true, "volumetric cut succeeded");
  assert.ok(volOutcome.builtFaces > 0, "built lining faces");
});

