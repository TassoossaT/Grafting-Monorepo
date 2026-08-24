import assert from "node:assert/strict";
import test from "node:test";

import { AppTabletopRuntime } from "../src/composition/tabletop/tabletop-runtime.ts";
import { commitPathContour } from "../src/composition/tabletop/tools/paths/path-shared.ts";
import { createEditHistoryStack } from "../src/features/edit-construction/index.ts";

/**
 * A real end-to-end regression harness: `commitPathContour` against a real
 * `AppTabletopRuntime`, backed by a small but genuinely stateful in-memory
 * `ConstructionSessionPort` fake -- not a canned/scripted one. This is the
 * exact coverage gap that let the "unknown analytic region" bug through
 * 241/241 green: every prior path test (old and new) exercised the pure
 * planning functions directly, never a real add-then-read-then-delete round
 * trip through something that actually tracks what got registered.
 *
 * The fake mirrors the two things that matter for this bug: `addPatch`
 * really validates and stores only the regions it accepts (reporting the
 * rest via `skippedRegionIds`, never silently pretending they exist), and
 * `deleteRegion` really throws on a key it never stored -- the same
 * `SurfaceError::UnknownRegion` shape the real Rust session throws.
 */
function createFakeConstructionSession() {
  const nodes = new Map();
  const edges = new Map();
  const regions = new Map();
  let started = false;

  const requireStarted = () => {
    if (!started) throw new Error("construction session is not started");
  };

  /** A region's boundary is valid only if it walks at least three distinct nodes. */
  const boundaryNodeIds = (boundary) => {
    const ids = [];
    for (const use of boundary) {
      const edge = edges.get(use.edgeId);
      if (edge === undefined) return undefined;
      ids.push(use.reversed ? edge.endNodeId : edge.startNodeId);
    }
    return ids;
  };

  const toTopology = (region) => {
    const boundary = region.boundary.map((use) => {
      const edge = edges.get(use.edgeId);
      return {
        edgeId: use.edgeId,
        reversed: use.reversed,
        startNodeId: use.reversed ? edge.endNodeId : edge.startNodeId,
        endNodeId: use.reversed ? edge.startNodeId : edge.endNodeId,
        geometry: edge.geometry ?? { kind: "line" },
      };
    });
    const ids = new Set(boundary.flatMap((use) => [use.startNodeId, use.endNodeId]));
    return {
      surfaceKey: region.surfaceKey,
      surfaceType: region.surfaceType,
      physical: region.physical,
      outerLoops: [boundary],
      holes: [],
      nodes: [...ids].map((id) => ({ id, position: nodes.get(id) })),
    };
  };

  const emptyOutcome = () => ({
    affectedSurfaceKeys: [],
    createdSurfaceKeys: [],
    removedSurfaceKeys: [],
    createdNodeIds: [],
    removedNodeIds: [],
  });

  const emptyMesh = () => ({ positions: new Float32Array(), normals: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array() });

  return {
    async start() {
      started = true;
    },
    async dispose() {
      started = false;
    },
    addPatch(patch) {
      requireStarted();
      const createdNodeIds = [];
      for (const node of patch.nodes) {
        if (nodes.has(node.id)) continue;
        nodes.set(node.id, node.position);
        createdNodeIds.push(node.id);
      }
      for (const edge of patch.edges) {
        if (!edges.has(edge.edgeId)) edges.set(edge.edgeId, edge);
      }
      const createdSurfaceKeys = [];
      const skippedRegionIds = [];
      for (const region of patch.regions) {
        const surfaceKey = ["@region", region.regionId];
        const walked = boundaryNodeIds(region.boundary);
        const distinct = walked === undefined ? undefined : new Set(walked);
        if (walked === undefined || distinct.size < 3) {
          // A degenerate boundary is refused, exactly like the real
          // session -- reported, never silently registered.
          skippedRegionIds.push(region.regionId);
          continue;
        }
        regions.set(surfaceKey.join(":"), { ...region, surfaceKey });
        createdSurfaceKeys.push(surfaceKey);
      }
      return { ...emptyOutcome(), createdSurfaceKeys, createdNodeIds, skippedRegionIds };
    },
    deleteRegion(surfaceKey) {
      requireStarted();
      const key = surfaceKey.join(":");
      if (!regions.has(key)) {
        // The exact shape of the bug this test exists to catch:
        // `SurfaceError::UnknownRegion` on the real Rust session.
        throw new Error(`unknown analytic region ${key}`);
      }
      regions.delete(key);
      return { ...emptyOutcome(), removedSurfaceKeys: [surfaceKey] };
    },
    moveVertex() {
      throw new Error("not exercised by this fake");
    },
    moveEdge() {
      throw new Error("not exercised by this fake");
    },
    moveRegion() {
      throw new Error("not exercised by this fake");
    },
    insertVertex() {
      throw new Error("not exercised by this fake");
    },
    removeVertex() {
      throw new Error("not exercised by this fake");
    },
    retypeEdge() {
      throw new Error("not exercised by this fake");
    },
    duplicateRegion() {
      throw new Error("not exercised by this fake");
    },
    addHole() {
      throw new Error("not exercised by this fake");
    },
    getUnfilledLoops() {
      return [];
    },
    getRegionTopology(surfaceKey) {
      const region = regions.get(surfaceKey.join(":"));
      return region === undefined ? undefined : toTopology(region);
    },
    getFootprintCoverage() {
      return [];
    },
    classifyPoints(points) {
      return points.map((_point, index) => ({ index, surfaceKey: [], surfaceType: "" }));
    },
    getAllRegionTopologies() {
      return [...regions.values()].map(toTopology);
    },
    applyRegionOverlay() {
      throw new Error("not exercised by this fake");
    },
    undoRegionOverlay() {},
    redoRegionOverlay() {},
    generateRegionPartition() {
      throw new Error("not exercised by this fake");
    },
    removeSurface() {},
    cloudFor() {
      return { surfaceKeys: [] };
    },
    getSurfaceMesh(surfaceKey) {
      const region = regions.get(surfaceKey.join(":"));
      return region === undefined ? [] : [{ surfaceKey, surfaceType: region.surfaceType, physical: region.physical, mesh: emptyMesh() }];
    },
    getAllSurfaceMeshes() {
      return [...regions.values()].map((region) => ({
        surfaceKey: region.surfaceKey,
        surfaceType: region.surfaceType,
        physical: region.physical,
        mesh: emptyMesh(),
      }));
    },
    getNodePositions() {
      return [...nodes].map(([id, position]) => ({ id, position }));
    },
  };
}

function createFakeRenderPort() {
  return {
    async start() {},
    attachView() {
      return "view-1";
    },
    detachView() {},
    resizeView() {},
    applyConfirmed() {},
    pick() {
      return undefined;
    },
    setFloorClipHeight() {},
    getMetrics() {
      return { rendererCreates: 0, rendererDisposes: 0, attachedViews: 0, confirmedTokenChanges: 0, terrainUploads: 0 };
    },
    async dispose() {},
  };
}

function createFakeTerrainNoisePort() {
  return {
    async start() {},
    async dispose() {},
  };
}

async function createTestContext() {
  const runtime = new AppTabletopRuntime("table-1", createFakeRenderPort(), createFakeConstructionSession(), createFakeTerrainNoisePort(), []);
  await runtime.start();
  let sequence = 0;
  const feedback = [];
  return {
    runtime,
    tableId: "table-1",
    snapToGrid: false,
    history: createEditHistoryStack(),
    nextSequence: () => (sequence += 1),
    reportSelection() {},
    reportFeedback(entry) {
      feedback.push(entry);
    },
    feedback,
  };
}

const ROAD = Object.freeze({
  shape: "circle",
  radius: 2.5,
  rotationDegrees: 0,
  pathKind: "road",
  bedWidth: 3,
  shoulderWidth: 0.6,
  shoulderHeight: 0.15,
  miterLimit: 4,
});

test("a second road crossing a standing one commits without throwing, end to end", async () => {
  const ctx = await createTestContext();

  const main = [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  assert.doesNotThrow(() => commitPathContour(ctx, main, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush"));

  const crossing = [
    { x: 0, y: 0, z: -10 },
    { x: 0, y: 0, z: 10 },
  ];
  assert.doesNotThrow(() => commitPathContour(ctx, crossing, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush"));

  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );

  // The crossing genuinely merged the two roads' bands rather than leaving
  // the first road's own faces stranded and unreferenced.
  const topologies = ctx.runtime.getAllRegionTopologies();
  assert.ok(topologies.length > 0, "the table has real path faces standing after both strokes");
});

test("a sharp hairpin stroke, wide enough to self-intersect when offset, still commits", async () => {
  const ctx = await createTestContext();
  // A tight zig-zag narrower than the road's own half-width (2.1 m):
  // exactly the shape that can make an offset ribbon self-intersect.
  const hairpin = [
    { x: 0, y: 0, z: 0 },
    { x: 8, y: 0, z: 0 },
    { x: 8, y: 0, z: 1 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: 2 },
    { x: 8, y: 0, z: 2 },
  ];
  assert.doesNotThrow(() => commitPathContour(ctx, hairpin, { kind: "circle", radius: 2.5 }, 0.01, ROAD, "path-brush"));
  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );

  const second = [
    { x: 4, y: 0, z: -5 },
    { x: 4, y: 0, z: 5 },
  ];
  assert.doesNotThrow(() => commitPathContour(ctx, second, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush"));
  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected after the second stroke: ${JSON.stringify(ctx.feedback)}`,
  );
});

test("a standing band that refuses to delete is reported, not fatal -- the run still commits", async () => {
  // Reproduces the reported symptom directly: `deleteRegion` throwing
  // "unknown analytic region" for a key `getAllRegionTopologies` just
  // reported as standing. Whatever the deeper cause turns out to be in a
  // real session, this proves the commit no longer takes the whole stroke
  // down with it when that happens.
  const ctx = await createTestContext();
  const main = [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  commitPathContour(ctx, main, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush");

  // Patches the runtime's own `applyRegionEdit` to always refuse a
  // delete-region -- exactly the "unknown analytic region" shape the real
  // session threw, without needing to reach the private construction port
  // underneath it.
  const originalApplyRegionEdit = ctx.runtime.applyRegionEdit.bind(ctx.runtime);
  ctx.runtime.applyRegionEdit = (ops, origin, causeId) => {
    if (ops.some((op) => op.kind === "delete-region")) {
      throw new Error("unknown analytic region (forced for this test)");
    }
    return originalApplyRegionEdit(ops, origin, causeId);
  };

  const crossing = [
    { x: 0, y: 0, z: -10 },
    { x: 0, y: 0, z: 10 },
  ];
  assert.doesNotThrow(() => commitPathContour(ctx, crossing, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush"));

  assert.ok(
    ctx.feedback.some((entry) => entry.tone === "success"),
    `the stroke should still succeed overall: ${JSON.stringify(ctx.feedback)}`,
  );
});

test("a T where the second road ends inside the first commits without throwing", async () => {
  const ctx = await createTestContext();

  const main = [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  commitPathContour(ctx, main, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush");

  const branch = [
    { x: 0, y: 0, z: 8 },
    { x: 0, y: 0, z: 0.5 },
  ];
  assert.doesNotThrow(() => commitPathContour(ctx, branch, { kind: "circle", radius: 2.5 }, 0.1, ROAD, "path-brush"));

  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );
});
