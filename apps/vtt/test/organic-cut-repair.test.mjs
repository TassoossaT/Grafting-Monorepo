import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCutRepairLattice,
  insertLatticeEdgePins,
  planOrganicCutRepair,
  repairOrganicCut,
} from "../src/features/edit-construction/structure-types/organic/organic-cut-repair.ts";
import { sharedEdgeId } from "../src/features/edit-construction/topology/boundary-edges.ts";

/**
 * Every test here targets the redesigned repair: a cut's hole is *filled*
 * with a fresh lattice from terrain's own generator
 * (`buildIrregularQuadGrid`), welded by real node id onto whatever real
 * geometry it meets, never a corner remapped on an untouched neighbour.
 *
 * The hole's own shape (`holeShapeRings`) is positions only -- a fact of
 * what got consumed, not itself a weld source, since those ids may no
 * longer be live after deletion. Weld candidates are a separate,
 * deliberately real, list (`candidates`).
 */

// ---------------------------------------------------------------------------
// planOrganicCutRepair -- pure, given an already-built lattice
// ---------------------------------------------------------------------------

/** A 4x4 square hole, centred at (2, 2) -- enough for `buildCutRepairLattice`'s own lattice to fully cover it. */
const SQUARE_HOLE_SHAPE = [
  [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
    { x: 0, y: 0, z: 4 },
  ],
];

/** The same square's own four corners, as real weldable candidates. */
const SQUARE_HOLE_CANDIDATES = [
  { id: "p0", position: { x: 0, y: 0, z: 0 } },
  { id: "p1", position: { x: 4, y: 0, z: 0 } },
  { id: "p2", position: { x: 4, y: 0, z: 4 } },
  { id: "p3", position: { x: 0, y: 0, z: 4 } },
];

test("planOrganicCutRepair fills the hole with a lattice welded onto the hole's own rim ids", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, SQUARE_HOLE_CANDIDATES, [], "cause-square");
  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: SQUARE_HOLE_SHAPE,
    candidates: SQUARE_HOLE_CANDIDATES,
    knownEdges: [],
    occupiedQuads: new Set(),
  });

  assert.notEqual(patch, undefined);
  assert.ok(patch.regions.length > 0, "at least one quad of the lattice landed inside the hole");
  for (const region of patch.regions) assert.equal(region.surfaceType, "terrain");

  const usedIds = new Set(patch.nodes.map((node) => node.id));
  // Every node this patch declares is either the hole's own rim (a real weld)
  // or a freshly minted lattice vertex -- never an id from nowhere.
  for (const id of usedIds) {
    assert.ok(id.startsWith("terrain-cut:cause-square:") || ["p0", "p1", "p2", "p3"].includes(id), `unexpected id ${id}`);
  }
  // The whole point: the fill actually reaches every side of the hole it was
  // built from, not just a corner of it.
  assert.deepEqual(["p0", "p1", "p2", "p3"].filter((id) => usedIds.has(id)).sort(), ["p0", "p1", "p2", "p3"]);
});

test("buildCutRepairLattice's own shape never bends toward a candidate -- it self-relaxes exactly like fresh terrain, welding happens after, by id, never by moving a vertex", () => {
  const withoutCandidates = buildCutRepairLattice(SQUARE_HOLE_SHAPE, [], [], "cause-square");
  const painted = { id: "painted-A", position: { x: 2.137, y: 1.5, z: 1.863 } };
  const withCandidate = buildCutRepairLattice(SQUARE_HOLE_SHAPE, [painted], [], "cause-square");

  assert.deepEqual(
    withCandidate.mesh.vertices,
    withoutCandidates.mesh.vertices,
    "the candidate never moved a single lattice vertex -- an earlier version pinned the mesh toward real geometry during relax; this one relaxes toward itself regardless of what it will later weld onto",
  );
});

test("planOrganicCutRepair welds a pinned lattice vertex onto a real painted node, not merely near it", () => {
  // The hole's own centre -- comfortably inside every candidate quad's own
  // reach, so whichever quad ends up owning this vertex is a plain, simple
  // one, not one straddling the rim.
  const painted = { id: "painted-A", position: { x: 2, y: 1.5, z: 2 } };
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, [painted], [], "cause-square");

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: SQUARE_HOLE_SHAPE,
    candidates: [painted],
    knownEdges: [],
    occupiedQuads: new Set(),
  });

  const weldedNode = patch.nodes.find((node) => node.id === "painted-A");
  assert.notEqual(weldedNode, undefined, "the painted node's own id was reused, not shadowed by a minted one");
  assert.deepEqual(weldedNode.position, painted.position);
});

test("planOrganicCutRepair drops every quad already claimed by something else", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, SQUARE_HOLE_CANDIDATES, [], "cause-square");
  const everyQuad = new Set(lattice.mesh.quads.map((_, index) => index));

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: SQUARE_HOLE_SHAPE,
    candidates: SQUARE_HOLE_CANDIDATES,
    knownEdges: [],
    occupiedQuads: everyQuad,
  });

  assert.equal(patch, undefined, "nothing survives once every quad is already claimed");
});

test("planOrganicCutRepair regenerates nothing when the hole is nowhere near the lattice", () => {
  const lattice = buildCutRepairLattice(SQUARE_HOLE_SHAPE, SQUARE_HOLE_CANDIDATES, [], "cause-square");
  const farHoleShape = [
    [
      { x: 1000, y: 0, z: 1000 },
      { x: 1004, y: 0, z: 1000 },
      { x: 1004, y: 0, z: 1004 },
      { x: 1000, y: 0, z: 1004 },
    ],
  ];

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-square",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings: farHoleShape,
    candidates: [],
    knownEdges: [],
    occupiedQuads: new Set(),
  });

  assert.equal(patch, undefined);
});

test("planOrganicCutRepair trusts a known edge's own true direction over sharedEdgeId's lexicographic guess", () => {
  // A single hand-built quad, corners already sitting exactly on four real
  // candidates -- deterministic weld, no relax noise, so exactly which
  // corners end up cyclically adjacent is known: corner 0 ("aaa-first") to
  // corner 1 ("zzz-second").
  const lattice = {
    mesh: {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      quads: [[0, 1, 2, 3]],
    },
    originX: 0,
    originZ: 0,
  };
  const candidates = [
    { id: "aaa-first", position: { x: 0, y: 0, z: 0 } },
    { id: "zzz-second", position: { x: 1, y: 0, z: 0 } },
    { id: "corner-c", position: { x: 1, y: 0, z: 1 } },
    { id: "corner-d", position: { x: 0, y: 0, z: 1 } },
  ];
  const holeShapeRings = [candidates.map((c) => c.position)];

  // "aaa-first" sorts before "zzz-second" as a plain string, so
  // sharedEdgeId's own lexicographic convention would assume this edge runs
  // aaa-first -> zzz-second (reversed: false for a corner-0 -> corner-1
  // walk). Declaring the *opposite* as this edge's own true, engine-side
  // direction is exactly the shape of mismatch `insert_vertex` produces --
  // see CutRepairKnownEdge's own doc.
  // planOrganicCutRepair now refuses to declare a boundary edge between two
  // *real* ids unless a known edge vouches for them (see its own doc) -- the
  // quad's other three sides are all real-to-real too, so they need known
  // entries here as well, in their plain canonical direction, purely to
  // authorize them. Only the first entry's direction is deliberately wrong,
  // to exercise the override this test is actually about.
  const canonical = (a, b) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    return { edgeId: sharedEdgeId("table-1", a, b), startNodeId: start, endNodeId: end };
  };
  const knownEdges = [
    {
      edgeId: "table-1:seg:aaa-first~zzz-second",
      startNodeId: "zzz-second",
      endNodeId: "aaa-first",
    },
    canonical("zzz-second", "corner-c"),
    canonical("corner-c", "corner-d"),
    canonical("corner-d", "aaa-first"),
  ];

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-known-edge",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings,
    candidates,
    knownEdges,
    occupiedQuads: new Set(),
  });

  assert.notEqual(patch, undefined);
  const [region] = patch.regions;
  const use = region.boundary.find((u) => u.edgeId === "table-1:seg:aaa-first~zzz-second");
  assert.notEqual(use, undefined, "the known edge id was reused, not recomputed under a different name");
  assert.equal(use.reversed, true, "walking aaa-first -> zzz-second against a true start of zzz-second must be reversed, not the lexicographic guess of false");
});

test("planOrganicCutRepair salvages a quad with one unvouched real pair instead of dropping the whole thing", () => {
  // Same hand-built single quad as the known-direction test above, but this
  // time three of its four sides are vouched into one connected component
  // (aaa-first ~ zzz-second ~ corner-c ~ corner-d) while the fourth,
  // corner-d -> aaa-first, is never declared at all -- same component, no
  // known edge, exactly what `boundaryPermitted` refuses.
  const lattice = {
    mesh: {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      quads: [[0, 1, 2, 3]],
    },
    originX: 0,
    originZ: 0,
  };
  const candidates = [
    { id: "aaa-first", position: { x: 0, y: 0, z: 0 } },
    { id: "zzz-second", position: { x: 1, y: 0, z: 0 } },
    { id: "corner-c", position: { x: 1, y: 0, z: 1 } },
    { id: "corner-d", position: { x: 0, y: 0, z: 1 } },
  ];
  const holeShapeRings = [candidates.map((c) => c.position)];
  const canonical = (a, b) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    return { edgeId: sharedEdgeId("table-1", a, b), startNodeId: start, endNodeId: end };
  };
  const knownEdges = [canonical("aaa-first", "zzz-second"), canonical("zzz-second", "corner-c"), canonical("corner-c", "corner-d")];

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-salvage",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings,
    candidates,
    knownEdges,
    occupiedQuads: new Set(),
  });

  assert.notEqual(patch, undefined, "the quad survives by substituting its one unvouched corner, not by being dropped whole");
  assert.equal(patch.regions.length, 1);

  // "corner-d" itself must be gone -- replaced by a freshly minted id -- but
  // every id it and aaa-first were vouched to keep (both its own real
  // neighbours) still stand, and the substitute sits at exactly corner-d's
  // own original position, so nothing about the fill visibly moved.
  const usedIds = new Set(patch.nodes.map((node) => node.id));
  assert.ok(usedIds.has("aaa-first"));
  assert.ok(usedIds.has("zzz-second"));
  assert.ok(usedIds.has("corner-c"));
  assert.ok(!usedIds.has("corner-d"), "the one corner with no vouched connection to its neighbour was substituted, not kept");

  const substitute = patch.nodes.find((node) => !["aaa-first", "zzz-second", "corner-c"].includes(node.id));
  assert.notEqual(substitute, undefined);
  assert.deepEqual(substitute.position, { x: 0, y: 0, z: 1 }, "the substitute sits exactly where corner-d resolved, not a new position");
});

test("planOrganicCutRepair demotes a shared corner globally, so two quads meeting at it still share a node", () => {
  // Two quads sharing one lattice edge (vertex 1 <-> vertex 2). Both real
  // candidates welded there ("shared-a", "shared-b") sit in one connected
  // component with no direct known edge between them -- an unvouched pair,
  // same as the single-quad test above, but this time BOTH quads touch it.
  // A per-quad-local substitute (an earlier version of this function used
  // one) would let quad A mint its own fresh id for vertex 1 while quad B,
  // built from the same untouched cache, still resolved vertex 1 to the
  // original real id -- the two quads then disagreeing about what vertex 1
  // even is, exactly the "field of disconnected mini-quads" a live session
  // reported. A global demotion must leave both quads agreeing.
  const lattice = {
    mesh: {
      vertices: [
        { x: 0, y: 0 }, // 0 -> p0
        { x: 1, y: 0 }, // 1 -> shared-a
        { x: 1, y: 1 }, // 2 -> shared-b
        { x: 0, y: 1 }, // 3 -> p3
        { x: 2, y: 0 }, // 4 -> p4
        { x: 2, y: 1 }, // 5 -> p5
      ],
      quads: [
        [0, 1, 2, 3],
        [1, 4, 5, 2],
      ],
    },
    originX: 0,
    originZ: 0,
  };
  const candidates = [
    { id: "p0", position: { x: 0, y: 0, z: 0 } },
    { id: "shared-a", position: { x: 1, y: 0, z: 0 } },
    { id: "shared-b", position: { x: 1, y: 0, z: 1 } },
    { id: "p3", position: { x: 0, y: 0, z: 1 } },
    { id: "p4", position: { x: 2, y: 0, z: 0 } },
    { id: "p5", position: { x: 2, y: 0, z: 1 } },
  ];
  const holeShapeRings = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
    ],
  ];
  const canonical = (a, b) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    return { edgeId: sharedEdgeId("table-1", a, b), startNodeId: start, endNodeId: end };
  };
  // p0, shared-a, shared-b and p3 all end up in one connected component
  // (p0~shared-a, shared-b~p3, p0~p3) -- but nothing ever vouches for
  // shared-a~shared-b directly.
  const knownEdges = [canonical("p0", "shared-a"), canonical("shared-b", "p3"), canonical("p0", "p3")];

  const patch = planOrganicCutRepair({
    tableId: "table-1",
    causeId: "cause-shared",
    surfaceType: "terrain",
    physical: true,
    lattice,
    holeShapeRings,
    candidates,
    knownEdges,
    occupiedQuads: new Set(),
  });

  assert.notEqual(patch, undefined);
  assert.equal(patch.regions.length, 2, "both quads survive");

  const [regionA, regionB] = patch.regions;
  // Quad A's own corner for vertex 1 (position 1 in its cycle) and quad B's
  // own corner for vertex 1 (position 0 in its cycle) must be the identical
  // substitute id -- not each quad minting its own.
  const cornerAt = (region, index) => region.regionId.split("|")[index];
  assert.equal(cornerAt(regionA, 1), cornerAt(regionB, 0), "both quads agree on the same substitute id for the shared corner");
  assert.equal(cornerAt(regionA, 2), cornerAt(regionB, 3), "and likewise for the other shared corner");
  assert.ok(!patch.nodes.some((node) => node.id === "shared-a"), "the unvouched real id was demoted, not kept, in every quad that touched it");
  assert.ok(!patch.nodes.some((node) => node.id === "shared-b"));
});

// ---------------------------------------------------------------------------
// buildCutRepairLattice's edge pins, and insertLatticeEdgePins turning them
// into real splits -- replaces the old densifyPaintedEdges pre-pass: the
// lattice itself decides where a painted edge needs a real anchor (the
// nearest point on it to each of its own nearby vertices), and this only
// ever mints one where the lattice actually landed.
// ---------------------------------------------------------------------------

function createInsertTrackingRuntime() {
  const inserts = [];
  return {
    inserts,
    runtime: {
      applyRegionEdit(ops) {
        for (const op of ops) if (op.kind === "insert-vertex") inserts.push(op);
      },
    },
  };
}

test("buildCutRepairLattice pins several vertices along a long painted edge, and insertLatticeEdgePins splits it into one unbroken chain", () => {
  const holeShape = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 2 },
      { x: 0, y: 0, z: 2 },
    ],
  ];
  const paintedNodes = [
    { id: "p-start", position: { x: 0, y: 0.2, z: 0 } },
    { id: "p-end", position: { x: 10, y: 0.2, z: 0 } },
  ];
  const paintedEdges = [{ edgeId: "table-1:seg:p-end~p-start", startNodeId: "p-start", endNodeId: "p-end" }];

  const lattice = buildCutRepairLattice(holeShape, paintedNodes, paintedEdges, "cause-1");

  // A 10-unit run bordering a hole this size is far longer than a single
  // lattice cell -- several of the lattice's own vertices should have found
  // a nearest point along it, not only its two sparse ends.
  assert.ok(lattice.edgePins.length > 3, `expected several edge pins along a 10-unit run, got ${lattice.edgePins.length}`);
  for (const pin of lattice.edgePins) {
    assert.equal(pin.edgeId, "table-1:seg:p-end~p-start");
    // Never at (or past) either end -- that is the plain node candidate's
    // own job, see EDGE_PIN_ENDPOINT_SLACK's own doc.
    assert.ok(pin.t > 0 && pin.t < 1, `pin landed at the very end (t=${pin.t}), should have matched the node candidate instead`);
    // On the line itself (z = 0), and height interpolated from the edge's
    // own endpoints (both 0.2 here) rather than an arbitrary lattice value.
    assert.equal(pin.position.z, 0);
    assert.equal(pin.position.y, 0.2);
  }

  const { runtime, inserts } = createInsertTrackingRuntime();
  const inserted = insertLatticeEdgePins(runtime, "table-1", "cause-1", lattice.edgePins);

  assert.equal(inserted.nodes.length, lattice.edgePins.length, "one real node per pin, no more, no less");
  assert.equal(inserts.length, lattice.edgePins.length, "one actual insert-vertex op per node, not merely computed and discarded");

  // Every fragment's own *true* direction is reported too, forming one
  // unbroken walk from the original edge's own start to its own end -- not
  // isolated anchor nodes with no known connectivity between them.
  assert.equal(inserted.edges.length, lattice.edgePins.length + 1, "N anchors split one run into N+1 fragment edges");
  assert.equal(inserted.edges[0].startNodeId, "p-start");
  assert.equal(inserted.edges.at(-1).endNodeId, "p-end");
  for (let i = 0; i < inserted.edges.length - 1; i += 1) {
    assert.equal(
      inserted.edges[i].endNodeId,
      inserted.edges[i + 1].startNodeId,
      "each fragment's own true end is the next fragment's own true start -- an unbroken chain",
    );
  }
});

test("buildCutRepairLattice never pins onto a painted edge nowhere near the hole", () => {
  const holeShape = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 2 },
      { x: 0, y: 0, z: 2 },
    ],
  ];
  const paintedNodes = [
    { id: "p-start", position: { x: 1000, y: 0, z: 1000 } },
    { id: "p-end", position: { x: 1010, y: 0, z: 1000 } },
  ];
  const paintedEdges = [{ edgeId: "table-1:seg:p-end~p-start", startNodeId: "p-start", endNodeId: "p-end" }];

  const lattice = buildCutRepairLattice(holeShape, paintedNodes, paintedEdges, "cause-1");

  assert.equal(lattice.edgePins.length, 0);
});

test("insertLatticeEdgePins is a no-op given no pins", () => {
  const { runtime, inserts } = createInsertTrackingRuntime();
  const inserted = insertLatticeEdgePins(runtime, "table-1", "cause-1", []);
  assert.deepEqual(inserted, { nodes: [], edges: [] });
  assert.equal(inserts.length, 0);
});

// ---------------------------------------------------------------------------
// repairOrganicCut -- fetch, delete, generate, weld, commit
// ---------------------------------------------------------------------------

/** A region's own outer loop, as the plain `{startNodeId}` cycle `repairOrganicCut` actually reads. */
function outerLoopOf(nodeIds) {
  return [nodeIds.map((id) => ({ startNodeId: id }))];
}

/**
 * T1 (consumed) and T2 (an untouched survivor) share the edge n2~n3. Unlike
 * the old corner-patching design, T2 is never a candidate for anything this
 * repair does -- it never appears in `getRegionTopology` results the plan
 * reads, and `classifyPoints` reports every point over T2's own footprint as
 * occupied, exactly the way a real neighbouring face would. The repair's
 * whole job is to fill T1's own hole and stop exactly at T2's edge.
 */
function createFakeTerrainRuntime() {
  const positions = new Map([
    ["n1", { x: 0, y: 0, z: 0 }],
    ["n2", { x: 2, y: 0, z: 0 }],
    ["n3", { x: 2, y: 0, z: 2 }],
    ["n4", { x: 0, y: 0, z: 2 }],
    ["n5", { x: 4, y: 0, z: 0 }],
    ["n6", { x: 4, y: 0, z: 2 }],
  ]);

  const regions = new Map([
    [
      "T1",
      {
        surfaceKey: ["@region", "T1"],
        surfaceType: "terrain",
        physical: true,
        outerLoops: outerLoopOf(["n1", "n2", "n3", "n4"]),
        nodes: ["n1", "n2", "n3", "n4"].map((id) => ({ id, position: positions.get(id) })),
      },
    ],
    [
      "T2",
      {
        surfaceKey: ["@region", "T2"],
        surfaceType: "terrain",
        physical: true,
        outerLoops: outerLoopOf(["n2", "n5", "n6", "n3"]),
        nodes: ["n2", "n5", "n6", "n3"].map((id) => ({ id, position: positions.get(id) })),
      },
    ],
  ]);

  const deleted = [];
  const addedPatches = [];
  let refuseFirstRegion = false;
  let throwOnAdd = false;

  function deleteBySurfaceKey(surfaceKey) {
    const key = surfaceKey.join("|");
    for (const [id, region] of regions) {
      if (region.surfaceKey.join("|") === key) {
        regions.delete(id);
        deleted.push(surfaceKey);
      }
    }
  }

  const runtime = {
    getRegionTopology(surfaceKey) {
      const key = surfaceKey.join("|");
      for (const region of regions.values()) if (region.surfaceKey.join("|") === key) return region;
      return undefined;
    },
    applyRegionEdit(ops) {
      for (const op of ops) if (op.kind === "delete-region") deleteBySurfaceKey(op.surfaceKey);
    },
    getUnfilledLoops(scope) {
      // T1's own full rim -- the real closed loop its deletion exposes on
      // its own side, even where T2 still stands on the other side of the
      // shared n2~n3 edge. `boundary` is each edge's own true direction, the
      // same shape the real engine returns ("registrable verbatim") -- here
      // it happens to agree with plain canonical order, but repairOrganicCut
      // must read it from `boundary`, never recompute it.
      const rim = ["n1", "n2", "n3", "n4"];
      if (!rim.every((id) => scope.includes(id))) return [];
      const boundary = rim.map((id, index) => {
        const next = rim[(index + 1) % rim.length];
        const [start] = id < next ? [id, next] : [next, id];
        return { edgeId: sharedEdgeId("table-1", id, next), reversed: id !== start };
      });
      return [{ nodeIds: rim, boundary }];
    },
    getSnapshot() {
      return { tableId: "table-1", map: { nodePositions: new Map([...positions].map(([id, position]) => [id, { position }])) } };
    },
    // T2's own footprint (x in [2, 4], z in [0, 2]) is occupied ground --
    // the same primitive `terrain-sculpt-tool.ts`'s `blockOccupiedQuads`
    // reads, standing in here for "a real neighbour already claims this."
    classifyPoints(points) {
      const hits = [];
      points.forEach(([x, z], index) => {
        if (x >= 2 && x <= 4 && z >= 0 && z <= 2) hits.push({ index, surfaceKey: ["@region", "T2"], surfaceType: "terrain" });
      });
      return hits;
    },
    // Real addPatch semantics (region_editing.rs's apply_add_patch, and its
    // own outcome shape): a region with no room is skipped, reported, and
    // costs nothing else in the same batch. `throwOnAdd` stands in for the
    // genuinely fatal case -- something other than "this one face had no
    // room" -- which is the only case repairOrganicCut still treats as an
    // error.
    addPatch(patch) {
      if (throwOnAdd) throw new Error("add patch failed: something other than a refused face");
      addedPatches.push(patch);
      const createdSurfaceKeys = [];
      const skippedRegionIds = [];
      patch.regions.forEach((region, index) => {
        if (refuseFirstRegion && index === 0) {
          skippedRegionIds.push(region.regionId);
          return;
        }
        regions.set(region.regionId, {
          surfaceKey: ["@region", region.regionId],
          surfaceType: region.surfaceType,
          physical: region.physical,
          outerLoops: [],
          nodes: [],
        });
        createdSurfaceKeys.push(["@region", region.regionId]);
      });
      return { createdSurfaceKeys, skippedRegionIds };
    },
  };

  return {
    runtime,
    deleted,
    addedPatches,
    refuseFirstSubmittedRegion: () => { refuseFirstRegion = true; },
    throwOnNextAdd: () => { throwOnAdd = true; },
  };
}

test("repairOrganicCut deletes exactly the consumed face, leaves the survivor untouched, and fills the hole with a real lattice", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1");

  assert.ok(rebuilt > 0, "at least one lattice quad filled T1's own hole");
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"], "T2 is never deleted -- this repair never touches a survivor");
  assert.equal(addedPatches.length, 1);

  const [patch] = addedPatches;
  assert.equal(patch.regions.length, rebuilt, "nothing was refused in this fixture, so every submitted region landed");
  for (const region of patch.regions) {
    for (const use of region.boundary) {
      assert.notEqual(use.edgeId.includes("n5"), true, "n5 belongs only to T2's own untouched corner");
      assert.notEqual(use.edgeId.includes("n6"), true, "n6 belongs only to T2's own untouched corner");
    }
  }

  // T2 itself is exactly as it was -- never renamed, never rebuilt.
  const survivor = runtime.getRegionTopology(["@region", "T2"]);
  assert.notEqual(survivor, undefined);
  assert.deepEqual(survivor.nodes.map((node) => node.id), ["n2", "n5", "n6", "n3"]);
});

test("repairOrganicCut fills the hole even when nothing survives to expose a rim (getUnfilledLoops empty)", () => {
  // The whole point of sourcing the hole's shape from the consumed
  // topology's own geometry, not getUnfilledLoops: this fixture consumes
  // BOTH T1 and T2 in the same cut, leaving no surviving terrain neighbour
  // at all (getUnfilledLoops has nothing terrain-side to report), yet the
  // hole still has a real shape and a real painted contour to weld onto.
  const { runtime } = createFakeTerrainRuntime();
  runtime.getUnfilledLoops = () => [];

  const painted = { id: "painted-A", position: { x: 1, y: 0.5, z: 1 } };
  const rebuilt = repairOrganicCut(
    runtime,
    {
      consumedSurfaceKeys: [["@region", "T1"], ["@region", "T2"]],
      paintedNodes: [painted],
      paintedEdges: [],
    },
    "cause-1",
  );

  assert.ok(rebuilt > 0, "the hole's own shape came from the consumed topology, not from an exposed rim that never existed");
});

test("consuming nothing is a no-op", () => {
  const { runtime, deleted, addedPatches } = createFakeTerrainRuntime();
  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [], paintedNodes: [], paintedEdges: [] }, "cause-1");

  assert.equal(rebuilt, 0);
  assert.equal(deleted.length, 0);
  assert.equal(addedPatches.length, 0);
});

test("a region the engine finds no room for is skipped, not fatal to the rest of the fill", () => {
  const { runtime, addedPatches, refuseFirstSubmittedRegion } = createFakeTerrainRuntime();
  refuseFirstSubmittedRegion();

  const rebuilt = repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1");

  const [patch] = addedPatches;
  assert.ok(patch.regions.length > 1, "the fixture needs more than one region for this to test anything");
  assert.equal(rebuilt, patch.regions.length - 1, "every region except the refused one still landed");
});

test("an add the engine flatly rejects (not merely a refused face) is a thrown error, and nothing new is left half-committed", () => {
  const { runtime, deleted, addedPatches, throwOnNextAdd } = createFakeTerrainRuntime();
  throwOnNextAdd();

  assert.throws(() => repairOrganicCut(runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [], paintedEdges: [] }, "cause-1"), /fill failed/);
  // Only T1 (deleted via applyRegionEdit before the fill was even attempted)
  // is gone. addPatch itself threw before registering anything.
  assert.deepEqual(deleted.map((key) => key.join("|")), ["@region|T1"]);
  assert.equal(addedPatches.length, 0);
});
