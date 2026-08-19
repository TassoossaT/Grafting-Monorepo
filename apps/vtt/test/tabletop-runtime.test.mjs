import assert from "node:assert/strict";
import test from "node:test";

import { AppTabletopRuntime } from "../src/composition/tabletop/tabletop-runtime.ts";
import { createTokenProjection } from "../src/entities/token/index.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";

function createFakeTerrainNoisePort() {
  return {
    async start() {},
    async dispose() {},
  };
}

function createTabletopRuntime(options) {
  return new AppTabletopRuntime(
    options.tableId,
    options.renderPort,
    options.constructionPort,
    options.terrainNoisePort ?? createFakeTerrainNoisePort(),
    options.initialTokens ?? [],
    options.seedDefaultMap ?? false,
  );
}

function createFakeRenderPort() {
  const changes = [];
  let started = false;
  let creates = 0;
  let disposes = 0;
  let attachedViews = 0;

  return {
    changes,
    async start() {
      if (started) throw new Error("already started");
      started = true;
      creates += 1;
    },
    attachView() {
      if (!started) throw new Error("not started");
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
        rendererCreates: creates,
        rendererDisposes: disposes,
        attachedViews,
        confirmedTokenChanges: changes.length,
        terrainUploads: 0,
      };
    },
    async dispose() {
      if (!started) return;
      started = false;
      attachedViews = 0;
      disposes += 1;
    },
  };
}

const FAKE_TERRAIN_SURFACE_KEY = ["fake:terrain:n0", "fake:terrain:n1", "fake:terrain:n2", "fake:terrain:n3"];
const FAKE_WALL_SURFACE_KEY = ["fake:wall:a", "fake:wall:b", "fake:wall:c"];

function createFakeConstructionPort() {
  let started = false;

  function requireStarted() {
    if (!started) throw new Error("construction session is not started");
  }

  return {
    async start() {
      if (started) throw new Error("construction session is already started");
      started = true;
    },
    addNode() {
      requireStarted();
    },
    addEdge() {
      requireStarted();
    },
    addSurface() {
      requireStarted();
      return [];
    },
    moveNode() {
      requireStarted();
      return { affectedSurfaceKeys: [] };
    },
    deleteNode() {
      requireStarted();
      return { removedSurfaceKeys: [], cappingSurfaceKeys: [] };
    },
    mergeSurfaces() {
      requireStarted();
      return [];
    },
    splitSurface() {
      requireStarted();
      return { firstKey: [], secondKey: [] };
    },
    duplicateSurface() {
      requireStarted();
      return [];
    },
    setTerrainMesh() {
      requireStarted();
    },
    generateTerrainCell() {
      requireStarted();
      return FAKE_TERRAIN_SURFACE_KEY;
    },
    generatePathExtrusion() {
      requireStarted();
      return { addedSurfaceKeys: [FAKE_WALL_SURFACE_KEY], removedSurfaceKeys: [], removedNodeIds: [] };
    },
    applyPathBrush() {
      requireStarted();
      return {
        nodeIds: { created: [], preserved: [], replaced: [], removed: [] },
        edgeIds: { created: [], preserved: [], replaced: [], removed: [] },
        surfaceIds: { created: [], preserved: [], replaced: [], removed: [] },
        invalidation: { changedSurfaces: [], topologyRepairNeighbors: [], directDependencies: [] },
      };
    },
    previewPathBrush() {
      requireStarted();
      return [];
    },
    undoPathBrush() {
      requireStarted();
    },
    redoPathBrush() {
      requireStarted();
    },
    getSurfaceMesh() {
      requireStarted();
      return {
        surfaceKey: ["fake:a", "fake:b", "fake:c"],
        surfaceType: "wall",
        physical: true,
        mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]) },
      };
    },
    getAllSurfaceMeshes() {
      requireStarted();
      return [
        {
          surfaceKey: FAKE_TERRAIN_SURFACE_KEY,
          surfaceType: "terrain",
          physical: true,
          mesh: {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
            normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          },
        },
        {
          surfaceKey: FAKE_WALL_SURFACE_KEY,
          surfaceType: "wall",
          physical: true,
          mesh: {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]),
            normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
            indices: new Uint32Array([0, 1, 2]),
          },
        },
      ];
    },
    getNodePositions() {
      requireStarted();
      return [
        { id: "fake:terrain:n0", position: { x: 0, y: 0, z: 0 } },
        { id: "fake:terrain:n1", position: { x: 1, y: 0, z: 0 } },
        { id: "fake:terrain:n2", position: { x: 1, y: 0, z: 1 } },
        { id: "fake:terrain:n3", position: { x: 0, y: 0, z: 1 } },
        { id: "fake:wall:a", position: { x: 2, y: 0, z: 0 } },
        { id: "fake:wall:b", position: { x: 2, y: 0, z: 4 } },
        { id: "fake:wall:c", position: { x: 2, y: 3, z: 0 } },
      ];
    },
    async dispose() {
      if (!started) return;
      started = false;
    },
  };
}

test("keeps a cached immutable snapshot and publishes lifecycle transitions", async () => {
  const runtime = createTabletopRuntime({
    tableId: " table-1 ",
    renderPort: createFakeRenderPort(),
    constructionPort: createFakeConstructionPort(),
  });
  const initial = runtime.getSnapshot();

  assert.equal(runtime.getSnapshot(), initial);
  assert.equal(initial.tableId, "table-1");
  assert.equal(initial.status, "idle");
  assert.equal(initial.tokens.byId.size, 0);
  assert.equal(initial.map.byId.size, 0);
  assert.equal(Object.isFrozen(initial), true);

  const observed = [];
  runtime.subscribe(() => observed.push(runtime.getSnapshot().status));

  await runtime.start();
  assert.deepEqual(observed, ["starting", "ready"]);
  assert.equal(runtime.getSnapshot().status, "ready");
  await assert.rejects(runtime.start(), /already ready/);
});

test("by default, starting a tabletop runtime initializes a clean, empty board", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-clean",
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });

  await runtime.start();

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.tokens.byId.size, 0, "no hardcoded tokens on fresh board");
  assert.equal(snapshot.map.byId.size, 0, "no hardcoded terrain or walls on fresh board");
  assert.equal(snapshot.map.nodePositions.size, 0);
});

test("starting a table with seedDefaultMap seeds a generated terrain cell and wall through the construction port", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-map",
    seedDefaultMap: true,
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });

  await runtime.start();

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.map.byId.size, 2, "the fake's terrain cell and wall piece each become one map entry");
  const terrain = snapshot.map.byId.get(surfaceRefFromNodeSet(FAKE_TERRAIN_SURFACE_KEY));
  assert.equal(terrain.type, "terrain");
  assert.equal(terrain.physical, true);
  const wall = snapshot.map.byId.get(surfaceRefFromNodeSet(FAKE_WALL_SURFACE_KEY));
  assert.equal(wall.type, "wall");

  const mapChanges = renderPort.changes.filter((change) => change.type === "map-chunk-upserted");
  assert.ok(mapChanges.length > 0);
  assert.equal(mapChanges[0].dependency.layer, "terrain");
  assert.ok(mapChanges[0].chunk.mesh.positions.length > 0, "the seeded chunk carries real mesh data");
});

test("starting a table with seedDefaultMap also seeds every node's position from the construction port", async () => {
  const runtime = createTabletopRuntime({
    tableId: "table-nodes",
    seedDefaultMap: true,
    renderPort: createFakeRenderPort(),
    constructionPort: createFakeConstructionPort(),
  });

  await runtime.start();

  const { nodePositions } = runtime.getSnapshot().map;
  assert.equal(nodePositions.size, 7);
  assert.deepEqual(nodePositions.get("fake:terrain:n0").position, { x: 0, y: 0, z: 0 });
  assert.equal(nodePositions.get("fake:terrain:n0").revision, 1);
  assert.deepEqual(nodePositions.get("fake:wall:a").position, { x: 2, y: 0, z: 0 });
});

test("moving a node updates its position and re-uploads the map chunk it belongs to", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-move-node",
    seedDefaultMap: true,
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });
  await runtime.start();
  const before = runtime.getSnapshot();
  const uploadsBefore = renderPort.changes.filter((change) => change.type === "map-chunk-upserted").length;

  const affected = runtime.moveNode("fake:terrain:n0", { x: 9, y: 9, z: 9 }, "local", "drag-1");

  assert.deepEqual(affected, { affectedSurfaceKeys: [] });
  const after = runtime.getSnapshot();
  assert.notEqual(after, before);
  const moved = after.map.nodePositions.get("fake:terrain:n0");
  assert.deepEqual(moved.position, { x: 9, y: 9, z: 9 });
  assert.equal(moved.revision, 2);

  const uploadsAfter = renderPort.changes.filter((change) => change.type === "map-chunk-upserted");
  assert.ok(uploadsAfter.length > uploadsBefore, "moving a node re-uploads its chunk");
  assert.equal(uploadsAfter.at(-1).origin, "local");
  assert.equal(uploadsAfter.at(-1).causeId, "drag-1");
});

test("moving a node bumps the revision of every surface the engine reports as affected", async () => {
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-affected-surfaces",
    seedDefaultMap: true,
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const surfaceKey = ["fake:terrain:n0", "fake:terrain:n1", "fake:terrain:n2", "fake:terrain:n3"];
  const surfaceRef = surfaceRefFromNodeSet(surfaceKey);
  assert.equal(runtime.getSnapshot().map.byId.get(surfaceRef).revision, 1);

  constructionPort.moveNode = () => ({ affectedSurfaceKeys: [surfaceKey] });
  runtime.moveNode("fake:terrain:n0", { x: 2, y: 0, z: 0 }, "local", "drag-2");

  assert.equal(runtime.getSnapshot().map.byId.get(surfaceRef).revision, 2);
});

test("moving a node removes a chunk that no longer has any surface in it", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-chunk-removal",
    seedDefaultMap: true,
    renderPort,
    constructionPort,
  });
  await runtime.start();
  const seededChunkId = renderPort.changes.find((change) => change.type === "map-chunk-upserted").chunk.chunkId;

  constructionPort.getAllSurfaceMeshes = () => [];
  runtime.moveNode("fake:terrain:n0", { x: 100, y: 100, z: 100 }, "local", "drag-3");

  const removal = renderPort.changes.find(
    (change) => change.type === "map-chunk-removed" && change.chunkId === seededChunkId,
  );
  assert.ok(removal, "the vacated chunk must be removed, not left stale");
});

test("generateTerrainCell folds the new surface and its nodes into the map", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-generate-terrain",
    renderPort,
    constructionPort,
  });
  await runtime.start();

  const extraKey = ["fake:terrain2:n0", "fake:terrain2:n1"];
  constructionPort.generateTerrainCell = () => extraKey;
  constructionPort.getAllSurfaceMeshes = () => [
    {
      surfaceKey: extraKey,
      surfaceType: "terrain",
      physical: true,
      mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]), indices: new Uint32Array([0, 1, 2]) },
    },
  ];
  constructionPort.getNodePositions = () => [
    { id: "fake:terrain2:n0", position: { x: 5, y: 0, z: 5 } },
    { id: "fake:terrain2:n1", position: { x: 6, y: 0, z: 5 } },
  ];

  const returned = runtime.generateTerrainCell({}, "local", "generate-1");
  assert.deepEqual(returned, extraKey);

  const map = runtime.getSnapshot().map;
  const surfaceRef = surfaceRefFromNodeSet(extraKey);
  assert.equal(map.byId.get(surfaceRef).type, "terrain");
  assert.deepEqual(map.nodePositions.get("fake:terrain2:n0").position, { x: 5, y: 0, z: 5 });
});

test("generatePathExtrusion folds every added surface into the map", async () => {
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-generate-wall",
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const pieceKey = ["fake:wall2:a", "fake:wall2:b"];
  constructionPort.generatePathExtrusion = () => ({ addedSurfaceKeys: [pieceKey], removedSurfaceKeys: [], removedNodeIds: [] });
  constructionPort.getAllSurfaceMeshes = () => [
    {
      surfaceKey: pieceKey,
      surfaceType: "door",
      physical: false,
      mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]), indices: new Uint32Array([0, 1, 2]) },
    },
  ];
  constructionPort.getNodePositions = () => [
    { id: "fake:wall2:a", position: { x: 8, y: 0, z: 0 } },
    { id: "fake:wall2:b", position: { x: 8, y: 3, z: 0 } },
  ];

  const outcome = runtime.generatePathExtrusion({}, "local", "generate-2");
  assert.deepEqual(outcome, { addedSurfaceKeys: [pieceKey], removedSurfaceKeys: [], removedNodeIds: [] });

  const map = runtime.getSnapshot().map;
  const surfaceRef = surfaceRefFromNodeSet(pieceKey);
  assert.equal(map.byId.get(surfaceRef).type, "door");
  assert.equal(map.byId.get(surfaceRef).physical, false);
});

test("applyPathBrush folds atomic surface and node deltas into the map", async () => {
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-path-brush",
    seedDefaultMap: true,
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const pathKey = ["fake:path:a", "fake:path:b", "fake:path:c"];
  constructionPort.applyPathBrush = () => ({
    nodeIds: { created: ["fake:path:a", "fake:path:b", "fake:path:c"], preserved: [], replaced: [], removed: [] },
    edgeIds: { created: ["fake:path:e0"], preserved: [], replaced: [], removed: [] },
    surfaceIds: { created: [pathKey], preserved: [], replaced: [], removed: [FAKE_TERRAIN_SURFACE_KEY] },
    invalidation: { changedSurfaces: [pathKey], topologyRepairNeighbors: [], directDependencies: [] },
  });
  constructionPort.getAllSurfaceMeshes = () => [
    {
      surfaceKey: pathKey,
      surfaceType: "path",
      physical: true,
      mesh: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, -0.1, 1]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    },
  ];
  constructionPort.getNodePositions = () => [
    { id: "fake:path:a", position: { x: 0, y: 0, z: 0 } },
    { id: "fake:path:b", position: { x: 1, y: 0, z: 0 } },
    { id: "fake:path:c", position: { x: 0, y: -0.1, z: 1 } },
  ];

  const outcome = runtime.applyPathBrush(
    {
      operationId: "path-brush-1",
      targetType: "path",
      brushShape: { kind: "circle", radius: 0.25 },
      brushRegion: { samples: [{ x: 0.5, y: 0, z: 0.5 }] },
      parameters: { width: 0.5, depth: 0.1, falloff: 0.2, strength: 1 },
    },
    "local",
  );

  assert.deepEqual(outcome.surfaceIds.created, [pathKey]);
  const map = runtime.getSnapshot().map;
  assert.equal(map.byId.has(surfaceRefFromNodeSet(FAKE_TERRAIN_SURFACE_KEY)), false);
  assert.equal(map.byId.get(surfaceRefFromNodeSet(pathKey)).type, "path");
  assert.deepEqual(map.nodePositions.get("fake:path:c").position, { x: 0, y: -0.1, z: 1 });
});
test("generating construction requires a ready tabletop runtime", async () => {
  const runtime = createTabletopRuntime({
    tableId: "table-generate-not-ready",
    renderPort: createFakeRenderPort(),
    constructionPort: createFakeConstructionPort(),
  });
  assert.throws(() => runtime.generateTerrainCell({}, "local", "c"), /ready/);
  assert.throws(() => runtime.generatePathExtrusion({}, "local", "c"), /ready/);
});

test("moving a node requires a ready tabletop runtime", async () => {
  const runtime = createTabletopRuntime({
    tableId: "table-not-ready",
    renderPort: createFakeRenderPort(),
    constructionPort: createFakeConstructionPort(),
  });
  assert.throws(() => runtime.moveNode("n0", { x: 0, y: 0, z: 0 }, "local", "c"), /ready/);
});

test("a confirmed token move invalidates only that token and preserves no-op identity", async () => {
  const renderPort = createFakeRenderPort();
  const token = createTokenProjection({
    id: "token-1",
    sceneId: "scene-1",
    position: { x: 0, y: 1, z: 0 },
    appearance: { label: "Scout", color: 0x72d69e, size: 1.5 },
    revision: 1,
  });
  const runtime = createTabletopRuntime({
    tableId: "table-token",
    initialTokens: [token],
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });
  await runtime.start();
  const before = runtime.getSnapshot();

  const moved = createTokenProjection({
    ...token,
    position: { x: 2, y: 1, z: -1 },
    revision: 2,
  });
  runtime.applyConfirmedToken({
    origin: "network",
    causeId: "remote-operation-8",
    delta: { type: "token-upserted", token: moved },
  });

  const after = runtime.getSnapshot();
  assert.notEqual(after, before);
  assert.equal(after.tokens.byId.get("token-1").id, token.id);
  assert.deepEqual(renderPort.changes.at(-1).dependency, {
    layer: "tokens",
    scopeId: "token-1",
    revision: 2,
  });
  assert.equal(renderPort.changes.at(-1).origin, "network");
  assert.equal(runtime.getRenderMetrics().terrainUploads, 0);

  runtime.applyConfirmedToken({
    origin: "network",
    causeId: "duplicate",
    delta: { type: "token-upserted", token: moved },
  });
  assert.equal(runtime.getSnapshot(), after);
  const tokenChanges = renderPort.changes.filter((change) => change.type.startsWith("token-"));
  assert.equal(tokenChanges.length, 2, "one token load plus one semantic move; map-chunk loads are separate");
});

test("disposal is idempotent, releases views, and a later lifecycle generation can restart", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-2",
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });
  let notifications = 0;
  runtime.subscribe(() => (notifications += 1));

  await runtime.start();
  runtime.attachView({});
  await runtime.dispose();
  const disposed = runtime.getSnapshot();
  await runtime.dispose();

  assert.equal(runtime.getSnapshot(), disposed);
  assert.equal(disposed.status, "disposed");
  assert.equal(notifications, 3);
  assert.equal(runtime.getRenderMetrics().attachedViews, 0);
  assert.equal(runtime.getRenderMetrics().rendererDisposes, 1);

  const restarted = [];
  runtime.subscribe(() => restarted.push(runtime.getSnapshot().status));
  await runtime.start();

  assert.deepEqual(restarted, ["starting", "ready"]);
  assert.equal(runtime.getSnapshot().status, "ready");
  assert.equal(runtime.getRenderMetrics().rendererCreates, 2);
});

test("a superseded start cannot dispose the renderer of the next React lifecycle", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-strict",
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });

  const supersededStart = runtime.start();
  const disposal = runtime.dispose();
  const currentStart = runtime.start();
  await Promise.all([supersededStart, disposal, currentStart]);

  assert.equal(runtime.getSnapshot().status, "ready");
  assert.equal(runtime.getRenderMetrics().rendererCreates, 2);
  assert.equal(runtime.getRenderMetrics().rendererDisposes, 1);
});

test("rejects an empty table identity", () => {
  assert.throws(
    () =>
      createTabletopRuntime({
        tableId: "   ",
        renderPort: createFakeRenderPort(),
        constructionPort: createFakeConstructionPort(),
      }),
    /must not be empty/,
  );
});
test("startup publishes one SurfaceRef pick proxy per semantic surface", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-surface-picks",
    seedDefaultMap: true,
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });

  await runtime.start();

  const targets = renderPort.changes
    .filter((change) => change.type === "surface-pick-target-upserted")
    .map((change) => change.target.surfaceRef)
    .sort();
  assert.deepEqual(targets, [
    surfaceRefFromNodeSet(FAKE_TERRAIN_SURFACE_KEY),
    surfaceRefFromNodeSet(FAKE_WALL_SURFACE_KEY),
  ].sort());
});

test("path preview uses the exact Rust mesh and mode-registry source policy", async () => {
  const constructionPort = createFakeConstructionPort();
  let received;
  constructionPort.previewPathBrush = (request) => {
    received = request;
    return [{
      surfaceKey: ["preview:a", "preview:b", "preview:c"],
      surfaceType: "path",
      physical: true,
      mesh: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, -0.2, 1]),
        indices: new Uint32Array([0, 1, 2]),
      },
    }];
  };
  const runtime = createTabletopRuntime({
    tableId: "table-preview",
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const preview = runtime.previewPathBrush({
    operationId: "preview-1",
    targetType: "path",
    brushShape: { kind: "square", size: 1.5, rotationRadians: Math.PI / 4 },
    brushRegion: { samples: [{ x: 0.5, y: 0, z: 0.5 }, { x: 2, y: 0, z: 0.5 }] },
    parameters: { width: 1.5, depth: 0.2, falloff: 1, strength: 1 },
  });

  assert.equal(preview.kind, "mesh");
  assert.deepEqual([...preview.indices], [0, 1, 2]);
  assert.deepEqual(received.sourceSurfaceTypes, ["terrain", "terrain-grass"]);
  assert.equal(received.samples.length, 2);
  assert.deepEqual(received.brushShape, { kind: "square", size: 1.5, rotationRadians: Math.PI / 4 });
});