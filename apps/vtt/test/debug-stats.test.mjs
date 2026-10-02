import assert from "node:assert/strict";
import test from "node:test";

import { clearRecentCommits, recentCommits, RECENT_COMMITS, timeCommit, timePhase } from "../src/composition/tabletop/commit-timing.ts";
import { countMap, createFrameMeter, diffMaps, EMPTY_FINGERPRINT, fingerprintMap, isNoChange, nameCommits } from "../src/composition/tabletop/debug-stats.ts";

test("the frame meter says nothing until a window has filled, then reports it and starts over", () => {
  const meter = createFrameMeter(500);

  // 20 ms frames: 50 fps. The first timestamp only sets the clock.
  assert.equal(meter(0), undefined);
  for (let now = 20; now < 500; now += 20) assert.equal(meter(now), undefined);
  const stats = meter(500);
  assert.ok(stats);
  assert.equal(Math.round(stats.fps), 50);
  assert.equal(stats.meanMs, 20);
  assert.equal(stats.worstMs, 20);

  // The next window is its own: one long frame shows as the worst and drags the mean up.
  for (let now = 520; now < 900; now += 20) assert.equal(meter(now), undefined);
  const next = meter(1000);
  assert.ok(next);
  assert.equal(next.worstMs, 120);
  assert.ok(next.fps < 50);
});

const face = (surfaceType, ...edgeIds) => ({ surfaceType, outerLoops: [edgeIds.map((edgeId) => ({ edgeId }))], holes: [] });

test("counting the map totals vertices, edges and faces and tells faces apart by type, most numerous first", () => {
  const counts = countMap(
    { nodes: [1, 2, 3, 4], edges: [] },
    [face("wall", "a", "b"), face("terrain", "c"), face("terrain", "d"), face("terrain", "e"), face("path", "f"), face("wall", "g")],
  );

  assert.equal(counts.vertices, 4);
  assert.equal(counts.edges, 7);
  assert.equal(counts.faces, 6);
  assert.deepEqual(counts.byType, [
    { type: "terrain", count: 3 },
    { type: "wall", count: 2 },
    { type: "path", count: 1 },
  ]);
});

test("the edges faces are bounded by are counted although the graph's own edge list is empty", () => {
  // The graph's list holds only its durable generic edges; a plain face's boundary lives in the face itself.
  const counts = countMap({ nodes: [1, 2, 3], edges: [] }, [face("terrain", "a", "b", "c")]);

  assert.equal(counts.edges, 3);
});

test("an edge two faces share is counted once, and as shared", () => {
  const counts = countMap({ nodes: [], edges: [] }, [face("terrain", "a", "seam"), face("wall", "seam", "b")]);

  assert.equal(counts.edges, 3);
  assert.equal(counts.sharedEdges, 1);
});

test("a graph edge no face bounds, such as a spine segment, is counted too, and once when a face also walks it", () => {
  const counts = countMap({ nodes: [], edges: [{ edgeId: "spine" }, { edgeId: "a" }] }, [face("terrain", "a", "b")]);

  assert.equal(counts.edges, 3);
});

test("an empty map counts as zeroes", () => {
  const counts = countMap({ nodes: [], edges: [] }, []);

  assert.deepEqual(counts, { vertices: 0, edges: 0, sharedEdges: 0, faces: 0, byType: [] });
});

const at = (x, z = 0) => ({ x, y: 0, z });
const node = (id, x, z) => ({ id, position: at(x, z) });
const use = (edgeId, startNodeId, endNodeId, reversed = false, geometry = { kind: "line" }) => ({ edgeId, reversed, startNodeId, endNodeId, geometry });
/** A square face over four nodes, walking edges a b c d. */
const square = (surfaceType, nodes, ids = ["a", "b", "c", "d"]) => ({
  surfaceKey: nodes.map((entry) => entry.id),
  surfaceType,
  outerLoops: [nodes.map((entry, index) => use(ids[index], entry.id, nodes[(index + 1) % nodes.length].id))],
  holes: [],
  nodes,
});
const corners = () => [node("n1", 0, 0), node("n2", 1, 0), node("n3", 1, 1), node("n4", 0, 1)];

test("a map compared with itself has not changed", () => {
  const graph = { nodes: corners(), edges: [] };
  const print = fingerprintMap(graph, [square("terrain", corners())]);

  const change = diffMaps(print, fingerprintMap(graph, [square("terrain", corners())]));
  assert.ok(isNoChange(change));
  assert.deepEqual(change.facesByType, []);
});

test("the first read of a map counts everything on it as added", () => {
  const change = diffMaps(EMPTY_FINGERPRINT, fingerprintMap({ nodes: corners(), edges: [] }, [square("terrain", corners())]));

  assert.deepEqual(change.vertices, { added: 4, removed: 0, changed: 0 });
  assert.deepEqual(change.edges, { added: 4, removed: 0, changed: 0 });
  assert.deepEqual(change.faces, { added: 1, removed: 0, changed: 0 });
  assert.deepEqual(change.facesByType, [{ type: "terrain", added: 1, removed: 0, changed: 0 }]);
});

test("moving one vertex changes it, the two edges and the face it bends, and nothing else", () => {
  const before = fingerprintMap({ nodes: corners(), edges: [] }, [square("terrain", corners())]);
  const moved = corners().map((entry) => (entry.id === "n3" ? node("n3", 2, 2) : entry));

  const change = diffMaps(before, fingerprintMap({ nodes: moved, edges: [] }, [square("terrain", moved)]));

  assert.deepEqual(change.vertices, { added: 0, removed: 0, changed: 1 });
  assert.deepEqual(change.edges, { added: 0, removed: 0, changed: 2 });
  assert.deepEqual(change.faces, { added: 0, removed: 0, changed: 1 });
});

test("a move below a tenth of a millimetre is not a change", () => {
  const before = fingerprintMap({ nodes: corners(), edges: [] }, []);
  const nudged = corners().map((entry) => (entry.id === "n1" ? node("n1", 0.00001, 0) : entry));

  assert.ok(isNoChange(diffMaps(before, fingerprintMap({ nodes: nudged, edges: [] }, []))));
});

test("a face that gains a vertex is one face removed and one added, as it is known by its node set", () => {
  const before = fingerprintMap({ nodes: corners(), edges: [] }, [square("wall", corners())]);
  const grown = [...corners(), node("n5", 0.5, 1.5)];
  const pentagon = square("wall", grown, ["a", "b", "c", "e", "f"]);

  const change = diffMaps(before, fingerprintMap({ nodes: grown, edges: [] }, [pentagon]));

  assert.deepEqual(change.vertices, { added: 1, removed: 0, changed: 0 });
  assert.deepEqual(change.edges, { added: 2, removed: 1, changed: 0 });
  assert.deepEqual(change.faces, { added: 1, removed: 1, changed: 0 });
  assert.deepEqual(change.facesByType, [{ type: "wall", added: 1, removed: 1, changed: 0 }]);
});

test("a face whose type changes is changed, and listed under the type it changed to", () => {
  const before = fingerprintMap({ nodes: corners(), edges: [] }, [square("terrain", corners())]);

  const change = diffMaps(before, fingerprintMap({ nodes: corners(), edges: [] }, [square("path", corners())]));

  assert.deepEqual(change.faces, { added: 0, removed: 0, changed: 1 });
  assert.deepEqual(change.facesByType, [{ type: "path", added: 0, removed: 0, changed: 1 }]);
});

test("an edge two faces walk in opposite directions prints alike from either, curve included", () => {
  const bulge = { kind: "bezier", handle1: [0.2, 0.5], handle2: [0.8, 0.5] };
  const graph = { nodes: [node("p", 0, 0), node("q", 1, 0)], edges: [] };
  const face = (edge) => ({ surfaceKey: ["p", "q"], surfaceType: "terrain", outerLoops: [[edge]], holes: [], nodes: graph.nodes });
  const forward = fingerprintMap(graph, [face(use("seam", "p", "q", false, bulge))]);
  const backward = fingerprintMap(graph, [face(use("seam", "q", "p", true, { kind: "bezier", handle1: [0.8, 0.5], handle2: [0.2, 0.5] }))]);

  assert.equal(forward.edges.get("seam"), backward.edges.get("seam"));
});

test("a graph edge no face walks, such as a spine segment, is added and removed like any other", () => {
  const nodes = [node("p", 0, 0), node("q", 1, 0)];
  const without = fingerprintMap({ nodes, edges: [] }, []);
  const withSpine = fingerprintMap({ nodes, edges: [{ edgeId: "spine", startNodeId: "p", endNodeId: "q" }] }, []);

  assert.deepEqual(diffMaps(without, withSpine).edges, { added: 1, removed: 0, changed: 0 });
  assert.deepEqual(diffMaps(withSpine, without).edges, { added: 0, removed: 1, changed: 0 });
});

test("a run of commits is named in one line, each label once with how often it ran", () => {
  assert.equal(nameCommits(["rua", "terreno", "rua", "rua"]), "rua ×3, terreno");
  assert.equal(nameCommits(["parede"]), "parede");
});

test("every finished commit is remembered, slow or not, with the slowest phase inside it", () => {
  clearRecentCommits();

  timeCommit("quick", () => 1);
  timeCommit("with phases", () => {
    timePhase("small", () => 1);
    timePhase("big", () => {
      const until = performance.now() + 5;
      while (performance.now() < until);
    });
  });

  const [quick, phased] = recentCommits();
  assert.equal(quick.label, "quick");
  assert.equal(quick.slowest, undefined);
  assert.equal(phased.label, "with phases");
  assert.equal(phased.slowest.label, "big");
  assert.ok(phased.ms >= 5);
});

test("only the most recent commits are kept, oldest first", () => {
  clearRecentCommits();

  for (let i = 0; i < RECENT_COMMITS + 3; i += 1) timeCommit(`commit ${i}`, () => i);

  const kept = recentCommits();
  assert.equal(kept.length, RECENT_COMMITS);
  assert.equal(kept[0].label, "commit 3");
  assert.equal(kept.at(-1).label, `commit ${RECENT_COMMITS + 2}`);
});

test("each commit carries a number that only grows, so a reader can pick out the ones it has not seen", () => {
  clearRecentCommits();
  timeCommit("first", () => 1);
  timeCommit("second", () => 2);

  const [first, second] = recentCommits();
  assert.equal(second.seq, first.seq + 1);
  assert.deepEqual(recentCommits().filter((commit) => commit.seq > first.seq).map((commit) => commit.label), ["second"]);
});
