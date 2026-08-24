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

/** A patch with nothing in it: what a test hands over when only the fake's own reply matters. */
const EMPTY_PATCH = { nodes: [], edges: [], regions: [] };

/**
 * Putting geometry on the table is a fixture concern, not something the
 * runtime does for you: it starts empty, and a test that needs surfaces adds
 * them the way a tool would -- one patch.
 */
function createTabletopRuntime(options) {
  const runtime = new AppTabletopRuntime(
    options.tableId,
    options.renderPort,
    options.constructionPort,
    options.terrainNoisePort ?? createFakeTerrainNoisePort(),
    options.initialTokens ?? [],
  );
  if (options.seedFakeMap !== true) return runtime;
  const start = runtime.start.bind(runtime);
  runtime.start = async () => {
    await start();
    runtime.addPatch(EMPTY_PATCH, "programmatic", `seed:${options.tableId}`);
  };
  return runtime;
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

function emptyRegionEdit() {
  return {
    affectedSurfaceKeys: [],
    createdSurfaceKeys: [],
    removedSurfaceKeys: [],
    createdNodeIds: [],
    removedNodeIds: [],
  };
}

function createFakeConstructionPort() {
  let started = false;
  /** What the next `addPatch` reports as created. Unset means the fake's own two surfaces. */
  let nextCreatedSurfaceKeys;
  const livePositions = new Map([
    ["fake:terrain:n0", { x: 0, y: 0, z: 0 }],
    ["fake:terrain:n1", { x: 1, y: 0, z: 0 }],
    ["fake:terrain:n2", { x: 1, y: 0, z: 1 }],
    ["fake:terrain:n3", { x: 0, y: 0, z: 1 }],
    ["fake:wall:a", { x: 2, y: 0, z: 0 }],
    ["fake:wall:b", { x: 2, y: 0, z: 4 }],
    ["fake:wall:c", { x: 2, y: 3, z: 0 }],
  ]);

  function requireStarted() {
    if (!started) throw new Error("construction session is not started");
  }

  return {
    async start() {
      if (started) throw new Error("construction session is already started");
      started = true;
    },
    addPatch() {
      requireStarted();
      const created = nextCreatedSurfaceKeys ?? [FAKE_TERRAIN_SURFACE_KEY, FAKE_WALL_SURFACE_KEY];
      nextCreatedSurfaceKeys = undefined;
      return { ...emptyRegionEdit(), createdSurfaceKeys: created, skippedRegionIds: [] };
    },
    /** Test seam: the keys the next `addPatch` claims to have created. */
    createsNext(keys) {
      nextCreatedSurfaceKeys = keys;
    },
    moveVertex(nodeId, position) {
      requireStarted();
      // The real engine holds the positions, so the fake must too: the
      // runtime re-scans `getNodePositions()` after every edit rather than
      // trusting the caller's own target, since a cascade moves nodes the
      // caller never named.
      livePositions.set(nodeId, position);
      return emptyRegionEdit();
    },
    insertVertex() {
      requireStarted();
      return emptyRegionEdit();
    },
    removeVertex() {
      requireStarted();
      return emptyRegionEdit();
    },
    retypeEdge() {
      requireStarted();
      return emptyRegionEdit();
    },
    moveEdge() {
      requireStarted();
      return emptyRegionEdit();
    },
    moveRegion() {
      requireStarted();
      return emptyRegionEdit();
    },
    deleteRegion() {
      requireStarted();
      return emptyRegionEdit();
    },
    duplicateRegion() {
      requireStarted();
      return emptyRegionEdit();
    },
    getRegionTopology() {
      requireStarted();
      return undefined;
    },
    getAllRegionTopologies() {
      requireStarted();
      return [];
    },
    applyRegionOverlay() {
      requireStarted();
      return {
        ...emptyRegionEdit(),
        skippedRegionIds: [],
      };
    },
    undoRegionOverlay() {
      requireStarted();
    },
    redoRegionOverlay() {
      requireStarted();
    },
    getSurfaceMesh(surfaceKey) {
      requireStarted();
      const surfaceRef = surfaceRefFromNodeSet(surfaceKey);
      const match = this.getAllSurfaceMeshes().find((mesh) => surfaceRefFromNodeSet(mesh.surfaceKey) === surfaceRef);
      if (match !== undefined) return [match];
      return [
        {
          surfaceKey,
          surfaceType: "wall",
          physical: true,
          mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]) },
        },
      ];
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
      return [...livePositions].map(([id, position]) => ({ id, position }));
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

test("a patch's created surfaces each become one map entry", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-map",
    seedFakeMap: true,
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

test("a patch also folds every node's position in from the construction port", async () => {
  const runtime = createTabletopRuntime({
    tableId: "table-nodes",
    seedFakeMap: true,
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

test("moving a vertex updates its position and re-uploads the map chunk it belongs to", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-move-node",
    seedFakeMap: true,
    renderPort,
    constructionPort,
  });
  await runtime.start();
  const before = runtime.getSnapshot();
  const uploadsBefore = renderPort.changes.filter((change) => change.type === "map-chunk-upserted").length;

  const move = constructionPort.moveVertex.bind(constructionPort);
  constructionPort.moveVertex = (nodeId, position) => ({
    ...move(nodeId, position),
    affectedSurfaceKeys: [FAKE_TERRAIN_SURFACE_KEY],
  });
  const outcome = runtime.moveVertex("fake:terrain:n0", { x: 9, y: 9, z: 9 }, "local", "drag-1");

  assert.deepEqual(outcome.affectedSurfaceKeys, [FAKE_TERRAIN_SURFACE_KEY]);
  const after = runtime.getSnapshot();
  assert.notEqual(after, before);
  const moved = after.map.nodePositions.get("fake:terrain:n0");
  assert.deepEqual(moved.position, { x: 9, y: 9, z: 9 });
  assert.equal(moved.revision, 2);

  const uploadsAfter = renderPort.changes.filter((change) => change.type === "map-chunk-upserted");
  assert.ok(uploadsAfter.length > uploadsBefore, "moving a vertex re-uploads its chunk");
  assert.equal(uploadsAfter.at(-1).origin, "local");
  assert.equal(uploadsAfter.at(-1).causeId, "drag-1");
});

test("moving a vertex bumps the revision of every surface the engine reports as affected", async () => {
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-affected-surfaces",
    seedFakeMap: true,
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const surfaceKey = ["fake:terrain:n0", "fake:terrain:n1", "fake:terrain:n2", "fake:terrain:n3"];
  const surfaceRef = surfaceRefFromNodeSet(surfaceKey);
  assert.equal(runtime.getSnapshot().map.byId.get(surfaceRef).revision, 1);

  const move = constructionPort.moveVertex.bind(constructionPort);
  constructionPort.moveVertex = (nodeId, position) => ({
    ...move(nodeId, position),
    affectedSurfaceKeys: [surfaceKey],
  });
  runtime.moveVertex("fake:terrain:n0", { x: 2, y: 0, z: 0 }, "local", "drag-2");

  assert.equal(runtime.getSnapshot().map.byId.get(surfaceRef).revision, 2);
});

test("moving a vertex removes a chunk that no longer has any surface in it", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-chunk-removal",
    renderPort,
    constructionPort,
  });
  await runtime.start();
  // No wall here on purpose -- the fake's terrain cell and wall land in the
  // same near-origin chunk, so moving only the terrain surface away would
  // leave the wall still occupying that chunk and it would never actually
  // empty out. One surface alone is what makes the chunk under test emptiable.
  constructionPort.createsNext([FAKE_TERRAIN_SURFACE_KEY]);
  runtime.addPatch(EMPTY_PATCH, "local", "seed-cell");
  const seededChunkId = renderPort.changes.find((change) => change.type === "map-chunk-upserted").chunk.chunkId;

  const move = constructionPort.moveVertex.bind(constructionPort);
  constructionPort.moveVertex = (nodeId, position) => ({
    ...move(nodeId, position),
    affectedSurfaceKeys: [FAKE_TERRAIN_SURFACE_KEY],
  });
  constructionPort.getSurfaceMesh = (surfaceKey) => [
    {
      surfaceKey,
      surfaceType: "terrain",
      physical: true,
      // Far enough from the seeded chunk to land in a different spatial bucket, so the old chunk ends up with zero members.
      mesh: { positions: new Float32Array([500, 100, 500, 501, 100, 500, 501, 100, 501, 500, 100, 501]) },
    },
  ];
  runtime.moveVertex("fake:terrain:n0", { x: 100, y: 100, z: 100 }, "local", "drag-3");

  const removal = renderPort.changes.find(
    (change) => change.type === "map-chunk-removed" && change.chunkId === seededChunkId,
  );
  assert.ok(removal, "the vacated chunk must be removed, not left stale");
});

test("editing one surface never touches the render chunk of an unrelated, untouched surface", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-incremental-scope",
    renderPort,
    constructionPort,
  });
  await runtime.start();

  // Two surfaces, deliberately far apart so they land in different spatial
  // chunk buckets (`chunkKeyFor`'s own 8-unit bucket size).
  const farKey = ["fake:far:n0", "fake:far:n1"];
  const nearKey = ["fake:near:n0", "fake:near:n1"];
  constructionPort.getSurfaceMesh = (surfaceKey) => {
    if (surfaceRefFromNodeSet(surfaceKey) === surfaceRefFromNodeSet(farKey)) {
      return [
        {
          surfaceKey: farKey,
          surfaceType: "terrain",
          physical: true,
          mesh: { positions: new Float32Array([900, 0, 900, 901, 0, 900, 901, 0, 901, 900, 0, 901]) },
        },
      ];
    }
    return [
      {
        surfaceKey,
        surfaceType: "terrain",
        physical: true,
        mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]) },
      },
    ];
  };
  constructionPort.createsNext([farKey]);
  runtime.addPatch(EMPTY_PATCH, "local", "far-cell");
  const farChunkId = renderPort.changes.find((change) => change.type === "map-chunk-upserted").chunk.chunkId;
  const eventsBeforeSecondEdit = renderPort.changes.length;

  // A second, unrelated surface elsewhere on the map -- this is the only
  // thing this edit is allowed to touch.
  constructionPort.createsNext([nearKey]);
  runtime.addPatch(EMPTY_PATCH, "local", "near-cell");

  const eventsForFarChunkSinceSecondEdit = renderPort.changes
    .slice(eventsBeforeSecondEdit)
    .filter((change) => "chunkId" in change ? change.chunkId === farChunkId : change.chunk?.chunkId === farChunkId);
  assert.deepEqual(
    eventsForFarChunkSinceSecondEdit,
    [],
    "an edit to a different surface must not re-upload or remove an unrelated chunk",
  );
});

test("one surface key returning several disjoint mesh pieces uploads every piece, not just the first", async () => {
  // Regression: an analytic-region surface (a merged path-brush
  // source/target region) can legitimately triangulate into more than one
  // disjoint mesh piece -- one per outer loop. `getSurfaceMesh` used to be
  // a single-mesh contract, so `#applyConstructionMutation`'s refetch kept
  // only the first piece and silently dropped the rest from the render
  // chunk -- the real cause of "surfaces vanishing" after a path-brush
  // stroke merged several separate terrain pieces into one region.
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-multi-piece-surface",
    renderPort,
    constructionPort,
  });
  await runtime.start();

  const regionKey = ["@region", "path-1-target"];
  constructionPort.getSurfaceMesh = (surfaceKey) => [
    {
      surfaceKey,
      surfaceType: "terrain",
      physical: true,
      mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]) },
    },
    {
      surfaceKey,
      surfaceType: "terrain",
      physical: true,
      // Far enough from the first piece to land in a different spatial chunk bucket.
      mesh: { positions: new Float32Array([900, 0, 900, 901, 0, 900, 901, 0, 901, 900, 0, 901]) },
    },
  ];
  constructionPort.createsNext([regionKey]);
  runtime.addPatch(EMPTY_PATCH, "local", "multi-piece-cell");

  const upserted = renderPort.changes.filter((change) => change.type === "map-chunk-upserted");
  const chunkIds = new Set(upserted.map((change) => change.chunk.chunkId));
  assert.equal(chunkIds.size, 2, "both mesh pieces must land in (and upload) their own chunk");
});

test("addPatch folds the new surface and its nodes into the map", async () => {
  const renderPort = createFakeRenderPort();
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-generate-terrain",
    renderPort,
    constructionPort,
  });
  await runtime.start();

  const extraKey = ["fake:terrain2:n0", "fake:terrain2:n1"];
  constructionPort.createsNext([extraKey]);
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

  const outcome = runtime.addPatch(EMPTY_PATCH, "local", "generate-1");
  assert.deepEqual(outcome.createdSurfaceKeys, [extraKey]);

  const map = runtime.getSnapshot().map;
  const surfaceRef = surfaceRefFromNodeSet(extraKey);
  assert.equal(map.byId.get(surfaceRef).type, "terrain");
  assert.deepEqual(map.nodePositions.get("fake:terrain2:n0").position, { x: 5, y: 0, z: 5 });
});

test("addPatch folds every created surface into the map, with its own type and physical flag", async () => {
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-generate-wall",
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const pieceKey = ["fake:wall2:a", "fake:wall2:b"];
  constructionPort.createsNext([pieceKey]);
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

  const outcome = runtime.addPatch(EMPTY_PATCH, "local", "generate-2");
  assert.deepEqual(outcome.createdSurfaceKeys, [pieceKey]);

  const map = runtime.getSnapshot().map;
  const surfaceRef = surfaceRefFromNodeSet(pieceKey);
  assert.equal(map.byId.get(surfaceRef).type, "door");
  assert.equal(map.byId.get(surfaceRef).physical, false);
});

test("applyRegionOverlay folds generic surface and node deltas into the map", async () => {
  const constructionPort = createFakeConstructionPort();
  const runtime = createTabletopRuntime({
    tableId: "table-path-brush",
    seedFakeMap: true,
    renderPort: createFakeRenderPort(),
    constructionPort,
  });
  await runtime.start();

  const pathKey = ["fake:path:a", "fake:path:b", "fake:path:c"];
  constructionPort.applyRegionOverlay = () => ({
    affectedSurfaceKeys: [],
    createdSurfaceKeys: [pathKey],
    removedSurfaceKeys: [FAKE_TERRAIN_SURFACE_KEY],
    createdNodeIds: ["fake:path:a", "fake:path:b", "fake:path:c"],
    removedNodeIds: [],
    skippedRegionIds: [],
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

  const outcome = runtime.applyRegionOverlay(
    { operationId: "path-brush-1", sourceSurfaceKeys: [], outline: [], boundary: [], patch: EMPTY_PATCH },
    "local",
    "path-brush-1",
  );

  assert.deepEqual(outcome.createdSurfaceKeys, [pathKey]);
  const map = runtime.getSnapshot().map;
  assert.equal(map.byId.has(surfaceRefFromNodeSet(FAKE_TERRAIN_SURFACE_KEY)), false);
  assert.equal(map.byId.get(surfaceRefFromNodeSet(pathKey)).type, "path");
  assert.deepEqual(map.nodePositions.get("fake:path:c").position, { x: 0, y: -0.1, z: 1 });
});
test("registering a patch requires a ready tabletop runtime", async () => {
  const runtime = createTabletopRuntime({
    tableId: "table-generate-not-ready",
    renderPort: createFakeRenderPort(),
    constructionPort: createFakeConstructionPort(),
  });
  assert.throws(() => runtime.addPatch(EMPTY_PATCH, "local", "c"), /ready/);
});

test("moving a vertex requires a ready tabletop runtime", async () => {
  const runtime = createTabletopRuntime({
    tableId: "table-not-ready",
    renderPort: createFakeRenderPort(),
    constructionPort: createFakeConstructionPort(),
  });
  assert.throws(() => runtime.moveVertex("n0", { x: 0, y: 0, z: 0 }, "local", "c"), /ready/);
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
    seedFakeMap: true,
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
