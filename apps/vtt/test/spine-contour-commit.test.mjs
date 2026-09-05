import assert from "node:assert/strict";
import test from "node:test";

import { AppTabletopRuntime } from "../src/composition/tabletop/tabletop-runtime.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
import {
  createEditHistoryStack,
  createPathBrushEffect,
  pathFormationFor,
} from "../src/features/edit-construction/index.ts";

/**
 * A real end-to-end regression harness: `commitPathCloudIntent` against a real
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
      // Mirrors the real Rust `boundary_has_room`: an edge bounds at most two
      // faces, one per direction. Registering a region walks each of its
      // boundary/hole edges in that region's own commit order, so a use is
      // only ever provisional until the whole region clears every edge --
      // exactly like the live session's own region-by-region loop.
      const usage = new Map();
      for (const topology of regions.values()) {
        for (const use of topology.boundary) {
          const list = usage.get(use.edgeId) ?? [];
          list.push(use.reversed);
          usage.set(use.edgeId, list);
        }
      }
      const hasRoom = (edgeId, reversed) => {
        const uses = usage.get(edgeId) ?? [];
        if (uses.length >= 2) return false;
        return uses[0] === undefined || uses[0] !== reversed;
      };
      const createdSurfaceKeys = [];
      const skippedRegionIds = [];
      for (const region of patch.regions) {
        const surfaceKey = ["@region", region.regionId];
        const walked = boundaryNodeIds(region.boundary);
        const distinct = walked === undefined ? undefined : new Set(walked);
        const roomy = region.boundary.every((use) => hasRoom(use.edgeId, use.reversed));
        if (walked === undefined || distinct.size < 3 || !roomy) {
          // A degenerate boundary, or one with no room left on a shared
          // edge, is refused, exactly like the real session -- reported,
          // never silently registered.
          skippedRegionIds.push(region.regionId);
          continue;
        }
        for (const use of region.boundary) {
          const list = usage.get(use.edgeId) ?? [];
          list.push(use.reversed);
          usage.set(use.edgeId, list);
        }
        regions.set(surfaceKey.join(":"), { ...region, surfaceKey, boundary: region.boundary });
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
    applyPatchReplacement(request) {
      requireStarted();
      for (const surfaceKey of request.sourceSurfaceKeys) {
        if (!regions.has(surfaceKey.join(":"))) {
          throw new Error(`replacement source is no longer present ${surfaceKey.join(":")}`);
        }
      }
      // The real Rust session removes the source regions from its topology
      // *before* validating the target patch (see
      // `apply_patch_replacement`), so a source's own edge uses are already
      // freed by the time room is checked -- a target that reclaims a
      // source's own shared edge is exactly the common case (a band being
      // rebuilt reuses its own seam). Removing sources only *after*
      // `addPatch` here would refuse that room-freeing and reject targets
      // the real session accepts. The production executor stages this
      // against cloned Rust state; this fake mirrors that all-or-nothing
      // guarantee by rolling the removal back on any failure below.
      const removed = request.sourceSurfaceKeys.map((surfaceKey) => [surfaceKey.join(":"), regions.get(surfaceKey.join(":"))]);
      for (const [key] of removed) regions.delete(key);
      for (const node of request.graphPatch?.nodes ?? []) {
        if (!nodes.has(node.id)) nodes.set(node.id, node.position);
      }
      for (const edge of request.graphPatch?.edges ?? []) {
        if (!edges.has(edge.edgeId)) edges.set(edge.edgeId, edge);
      }
      let outcome;
      try {
        outcome = this.addPatch(request.patch);
      } catch (error) {
        for (const [key, value] of removed) regions.set(key, value);
        throw error;
      }
      if (outcome.skippedRegionIds.length > 0) {
        for (const [key, value] of removed) regions.set(key, value);
        throw new Error(`replacement target was refused: ${outcome.skippedRegionIds.join(", ")}`);
      }
      return { ...outcome, removedSurfaceKeys: [...request.sourceSurfaceKeys] };
    },
    applyRegionOverlay() {
      throw new Error("not exercised by this fake");
    },
    undoRegionOverlay() {},
    redoRegionOverlay() {},
    generateRegionPartition() {
      throw new Error("not exercised by this fake");
    },
    removeSurface() {
      return {
        affectedSurfaceKeys: [],
        createdSurfaceKeys: [],
        removedSurfaceKeys: [],
        createdNodeIds: [],
        removedNodeIds: [],
      };
    },
    cloudFor(request) {
      const all = [...regions.values()]
        .filter((region) => region.surfaceType === request.surfaceType)
        .map(toTopology);
      const seed = request.seed.join(":");
      const seedTopology = all.find((topology) => topology.surfaceKey.join(":") === seed);
      if (seedTopology === undefined) return { surfaceKeys: [] };
      const connected = new Set([seed]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const topology of all) {
          const key = topology.surfaceKey.join(":");
          if (connected.has(key)) continue;
          const nodes = new Set(topology.nodes.map((node) => node.id));
          const touchesCloud = all.some(
            (member) =>
              connected.has(member.surfaceKey.join(":")) && member.nodes.some((node) => nodes.has(node.id)),
          );
          if (!touchesCloud) continue;
          connected.add(key);
          changed = true;
        }
      }
      return { surfaceKeys: all.filter((topology) => connected.has(topology.surfaceKey.join(":"))).map((topology) => topology.surfaceKey) };
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
    getGraphSnapshot() {
      return { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges: [...edges.values()] };
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

/** The executor receives the immutable semantic effect the brush emits. */
function applyRoadBrushEffect(ctx, samples, tolerance, endpoints = {}) {
  const operationId = `table-1:path-brush:${ctx.nextSequence()}`;
  const effect = createPathBrushEffect(
    {
      brushShape: { kind: "circle", radius: ROAD.radius },
      brushRegion: { samples },
      parameters: pathFormationFor(ROAD),
      ...endpoints,
    },
    { operationId, tableId: "table-1", initiatedBy: "path-brush" },
  );
  commitPathCloudIntent(ctx, effect, tolerance);
}

test("a second unselected crossing road commits without replacing the standing one", async () => {
  const ctx = await createTestContext();

  const main = [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, main, 0.1));

  const crossing = [
    { x: 0, y: 0, z: -10 },
    { x: 0, y: 0, z: 10 },
  ];
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, crossing, 0.1));

  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );

  // A crossing without an explicit endpoint target is a new candidate cloud;
  // it must still leave valid path faces on the table.
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
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, hairpin, 0.01));
  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );

  const second = [
    { x: 4, y: 0, z: -5 },
    { x: 4, y: 0, z: 5 },
  ];
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, second, 0.1));
  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected after the second stroke: ${JSON.stringify(ctx.feedback)}`,
  );
});

test("a failed path replacement leaves every standing face untouched", async () => {
  const ctx = await createTestContext();
  const main = [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  applyRoadBrushEffect(ctx, main, 0.1);
  const before = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));

  ctx.runtime.applyPatchReplacement = () => {
    throw new Error("replacement target was refused (forced for this test)");
  };

  const crossing = [
    { x: 0, y: 0, z: -10 },
    { x: 0, y: 0, z: 10 },
  ];
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, crossing, 0.1));

  assert.ok(
    ctx.feedback.some((entry) => entry.tone === "error"),
    `the failed replacement must be reported: ${JSON.stringify(ctx.feedback)}`,
  );
  assert.deepEqual(
    ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":")),
    before,
    "a refused replacement must not delete any already-standing road face",
  );
});

test("a nearby unselected road never consumes the standing road's faces", async () => {
  const ctx = await createTestContext();
  applyRoadBrushEffect(ctx, [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ], 0.1);
  const firstRoad = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));

  // The two road footprints overlap by a few centimetres. No endpoint was
  // selected, so this is a separate PathCloud candidate and must not replace
  // the already committed one just because their bounds happen to touch.
  applyRoadBrushEffect(ctx, [
    { x: -10, y: 0, z: 4 },
    { x: 10, y: 0, z: 4 },
  ], 0.1);

  const after = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));
  assert.ok(firstRoad.every((surfaceKey) => after.includes(surfaceKey)), "the first road remains intact");
  assert.ok(after.length > firstRoad.length, "the second road was added without consuming the first");
});

test("an explicitly selected continuation replaces the whole path cloud and rebuilds its contour", async () => {
  const ctx = await createTestContext();
  applyRoadBrushEffect(ctx, [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ], 0.1);
  const before = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));
  const continuationSurfaceRef = [...ctx.runtime.getAllRegionTopologies()[0].surfaceKey].sort().join(",");

  applyRoadBrushEffect(
    ctx,
    [
      { x: 10, y: 0, z: 0 },
      { x: 30, y: 0, z: 0 },
    ],
    0.1,
    { start: { continuation: { surfaceRef: continuationSurfaceRef } } },
  );

  const after = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));
  assert.ok(after.length > 0, "the rebuilt cloud has contour faces");
  assert.ok(before.every((surfaceKey) => !after.includes(surfaceKey)), "the old cloud faces were replaced as one unit");
  const spine = ctx.runtime.getGraphSnapshot();
  const join = spine.nodes.filter((node) => node.id.startsWith("spine:") && node.position.x === 10 && node.position.z === 0);
  assert.equal(join.length, 1, "the continuation reuses the old spine end, rather than laying a coincident second node");
  assert.equal(
    spine.edges.filter((edge) => edge.startNodeId === join[0].id || edge.endNodeId === join[0].id).length,
    2,
    "the shared end joins both curve segments in the durable spine graph",
  );
  assert.ok(!ctx.feedback.some((entry) => entry.tone === "error"), `the continuation must succeed: ${JSON.stringify(ctx.feedback)}`);
});

test("a selected union splits the touched spine edge and makes one shared junction", async () => {
  const ctx = await createTestContext();
  applyRoadBrushEffect(ctx, [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ], 0.1);
  const unionSurfaceRef = [...ctx.runtime.getAllRegionTopologies()[0].surfaceKey].sort().join(",");

  applyRoadBrushEffect(
    ctx,
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 8 },
    ],
    0.1,
    { start: { unionSurfaceRef } },
  );

  const spine = ctx.runtime.getGraphSnapshot();
  const junction = spine.nodes.filter((node) => node.id.startsWith("spine:") && node.position.x === 0 && node.position.z === 0);
  assert.equal(junction.length, 1, "the intersection is represented by one graph node");
  assert.equal(
    spine.edges.filter((edge) => edge.startNodeId === junction[0].id || edge.endNodeId === junction[0].id).length,
    3,
    "splitting the old segment leaves three arms at the junction",
  );
  assert.ok(!ctx.feedback.some((entry) => entry.tone === "error"), `the joined contour must commit: ${JSON.stringify(ctx.feedback)}`);
});

test("a T where the second road ends inside the first commits without throwing", async () => {
  const ctx = await createTestContext();

  const main = [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  applyRoadBrushEffect(ctx, main, 0.1);

  const branch = [
    { x: 0, y: 0, z: 8 },
    { x: 0, y: 0, z: 0.5 },
  ];
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, branch, 0.1));

  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );
  const spine = ctx.runtime.getGraphSnapshot();
  const junction = spine.nodes.filter((node) => node.id.startsWith("spine:") && node.position.x === 0 && node.position.z === 0);
  assert.equal(junction.length, 1, "a geometric contact inside the brush snaps automatically, without a connection flag");
  assert.equal(spine.edges.filter((edge) => edge.startNodeId === junction[0].id || edge.endNodeId === junction[0].id).length, 3);
});

test("a T touching a long straight road mid-span merges into it instead of duplicating its face", async () => {
  // A straight run's own control points are only its two far-apart ends
  // (a straight line has nothing for the fitter to add in between), so a
  // branch landing mid-span, kilometres from either one, has no standing
  // node anywhere near it -- and this harness sends no observed pointer
  // hits either. The spine graph still snaps the contact (previous test),
  // but the *contour* replacement has its own, independent selection: if it
  // relied on node proximity alone it would never see this road as touched,
  // never consume its standing bands, and just add the branch's own bands
  // as a second, overlapping set next to the first -- the road visibly
  // duplicating instead of becoming one face.
  const ctx = await createTestContext();
  const main = [
    { x: -60, y: 0, z: 0 },
    { x: 60, y: 0, z: 0 },
  ];
  applyRoadBrushEffect(ctx, main, 0.1);
  const before = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));
  assert.ok(before.length > 0, "the main road has real faces standing");

  const branch = [
    { x: 0, y: 0, z: 8 },
    { x: 0, y: 0, z: 0.5 },
  ];
  applyRoadBrushEffect(ctx, branch, 0.1);
  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );

  const after = ctx.runtime.getAllRegionTopologies().filter((topology) => topology.surfaceType === "path");
  assert.ok(
    before.every((surfaceKey) => !after.some((topology) => topology.surfaceKey.join(":") === surfaceKey)),
    "the main road's original faces were replaced by the merge, not left standing beside a duplicate",
  );

  // Two overlapping-but-unmerged faces would both claim ground around
  // (0, 0) on the main road's own band; a real merge leaves exactly one.
  const atJunction = after.filter((topology) => {
    const xs = topology.nodes.map((node) => node.position.x);
    const zs = topology.nodes.map((node) => node.position.z);
    return Math.min(...xs) <= 0 && Math.max(...xs) >= 0 && Math.min(...zs) <= 0.5 && Math.max(...zs) >= 0;
  });
  const bandsAtJunction = new Set(atJunction.map((topology) => /:band-(\d+):/.exec(topology.surfaceKey.join(":"))?.[1]));
  for (const band of bandsAtJunction) {
    const withThisBand = atJunction.filter((topology) => topology.surfaceKey.join(":").includes(`:band-${band}:`));
    assert.equal(withThisBand.length, 1, `band ${band} must be one merged face at the junction, not ${withThisBand.length} overlapping ones`);
  }
});

test("an interior-to-interior crossing splits both spines into one connected road cloud", async () => {
  const ctx = await createTestContext();
  applyRoadBrushEffect(ctx, [
    { x: -60, y: 0, z: 0 },
    { x: 60, y: 0, z: 0 },
  ], 0.1);
  const before = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));

  // Neither endpoint comes close enough to snap. The only way to connect
  // these roads is to insert one shared node where their two interiors cross.
  applyRoadBrushEffect(ctx, [
    { x: 0, y: 0, z: -20 },
    { x: 0, y: 0, z: 20 },
  ], 0.1);

  const spine = ctx.runtime.getGraphSnapshot();
  const junction = spine.nodes.filter((node) => node.id.startsWith("spine:") && node.position.x === 0 && node.position.z === 0);
  assert.equal(junction.length, 1, "the crossing has one shared spine node");
  assert.equal(
    spine.edges.filter((edge) => edge.startNodeId === junction[0].id || edge.endNodeId === junction[0].id).length,
    4,
    "both former segments are split through the same four-way junction",
  );

  const after = ctx.runtime.getAllRegionTopologies().filter((topology) => topology.surfaceType === "path");
  assert.ok(
    before.every((surfaceKey) => !after.some((topology) => topology.surfaceKey.join(":") === surfaceKey)),
    "the original road faces are replaced as part of the connected cloud",
  );
  const atJunction = after.filter((topology) => {
    const xs = topology.nodes.map((node) => node.position.x);
    const zs = topology.nodes.map((node) => node.position.z);
    return Math.min(...xs) <= 0 && Math.max(...xs) >= 0 && Math.min(...zs) <= 0 && Math.max(...zs) >= 0;
  });
  const bands = new Set(atJunction.map((topology) => /:band-(\d+):/.exec(topology.surfaceKey.join(":"))?.[1]));
  for (const band of bands) {
    const faces = atJunction.filter((topology) => topology.surfaceKey.join(":").includes(`:band-${band}:`));
    assert.equal(faces.length, 1, `band ${band} is one unioned face at the crossing`);
  }
});

test("a stroke whose both ends snap onto the same existing node is a no-op, not a crash", async () => {
  // In a dense junction (several roads meeting near one point), a very
  // short new stroke can have both its own ends snap onto the very same
  // existing spine node -- collapsing its own control points to one
  // repeated position. The chain still has "length >= 2" by count, but its
  // own offset ribbon is degenerate (zero normal direction, zero area), so
  // the footprint-coverage query this stroke builds ends up with fewer than
  // three points. The real session's own coverage query refuses that
  // outright ("a footprint polygon needs at least three points"); this
  // must be caught before ever reaching that call, as a graceful no-op.
  const ctx = await createTestContext();
  const main = [
    { x: -60, y: 0, z: 0 },
    { x: 60, y: 0, z: 0 },
  ];
  applyRoadBrushEffect(ctx, main, 0.1);
  const before = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));

  // Both ends sit a couple of centimetres from the road's own left end
  // (-60, 0) -- well inside the brush's own snap tolerance (its radius,
  // 2.5) and nowhere near the road's other end, so both resolve to the same
  // single node.
  const collapsed = [
    { x: -60.02, y: 0, z: 0.01 },
    { x: -59.98, y: 0, z: -0.01 },
  ];
  assert.doesNotThrow(() => applyRoadBrushEffect(ctx, collapsed, 0.1));

  assert.ok(
    !ctx.feedback.some((entry) => entry.tone === "error"),
    `no error feedback expected: ${JSON.stringify(ctx.feedback)}`,
  );
  assert.ok(
    ctx.feedback.some((entry) => entry.tone === "info"),
    `an info feedback explaining nothing happened is expected: ${JSON.stringify(ctx.feedback)}`,
  );
  const after = ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":"));
  assert.deepEqual(after, before, "the standing road is untouched by a stroke with no real extent");
});
