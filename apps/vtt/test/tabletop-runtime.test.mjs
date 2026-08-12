import assert from "node:assert/strict";
import test from "node:test";

import { createTabletopRuntime } from "../src/composition/tabletop/index.ts";
import { createTokenProjection } from "../src/entities/token/index.ts";

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

function createFakeConstructionPort() {
  let started = false;
  let sequence = 0;

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
      sequence += 1;
      return [`fake:terrain-${sequence}:n0`, `fake:terrain-${sequence}:n1`, `fake:terrain-${sequence}:n2`];
    },
    generateWall() {
      requireStarted();
      sequence += 1;
      return [{ surfaceKey: [`fake:wall-${sequence}:a`, `fake:wall-${sequence}:b`, `fake:wall-${sequence}:c`], surfaceType: "wall" }];
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
          surfaceKey: ["fake:terrain:n0", "fake:terrain:n1", "fake:terrain:n2", "fake:terrain:n3"],
          surfaceType: "terrain",
          physical: true,
          mesh: {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
            normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          },
        },
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
  assert.equal(initial.tokens.byId.size, 1);
  assert.equal(Object.isFrozen(initial), true);

  const observed = [];
  runtime.subscribe(() => observed.push(runtime.getSnapshot().status));

  await runtime.start();
  assert.deepEqual(observed, ["starting", "ready"]);
  assert.equal(runtime.getSnapshot().revision, 2);
  assert.equal(runtime.getSnapshot().status, "ready");
  await assert.rejects(runtime.start(), /already ready/);
});

test("starting a table seeds a generated terrain cell and wall through the construction port", async () => {
  const renderPort = createFakeRenderPort();
  const runtime = createTabletopRuntime({
    tableId: "table-map",
    renderPort,
    constructionPort: createFakeConstructionPort(),
  });

  await runtime.start();

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.map.byId.size, 1, "the fake's one returned surface becomes one map entry");
  const [surface] = [...snapshot.map.byId.values()];
  assert.equal(surface.type, "terrain");
  assert.equal(surface.physical, true);

  const mapChanges = renderPort.changes.filter((change) => change.type === "map-chunk-upserted");
  assert.equal(mapChanges.length, 1);
  assert.equal(mapChanges[0].dependency.layer, "terrain");
  assert.ok(mapChanges[0].chunk.mesh.positions.length > 0, "the seeded chunk carries real mesh data");
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
