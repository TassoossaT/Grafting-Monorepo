import assert from "node:assert/strict";
import test from "node:test";

import { clearRecentCommits, recentCommits, RECENT_COMMITS, timeCommit, timePhase } from "../src/composition/tabletop/commit-timing.ts";
import { countMap, createFrameMeter } from "../src/composition/tabletop/debug-stats.ts";

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

test("counting the map totals vertices, edges and faces and tells faces apart by type, most numerous first", () => {
  const counts = countMap(
    { nodes: [1, 2, 3, 4], edges: [1, 2, 3] },
    [{ surfaceType: "wall" }, { surfaceType: "terrain" }, { surfaceType: "terrain" }, { surfaceType: "terrain" }, { surfaceType: "path" }, { surfaceType: "wall" }],
  );

  assert.equal(counts.vertices, 4);
  assert.equal(counts.edges, 3);
  assert.equal(counts.faces, 6);
  assert.deepEqual(counts.byType, [
    { type: "terrain", count: 3 },
    { type: "wall", count: 2 },
    { type: "path", count: 1 },
  ]);
});

test("an empty map counts as zeroes", () => {
  const counts = countMap({ nodes: [], edges: [] }, []);

  assert.deepEqual(counts, { vertices: 0, edges: 0, faces: 0, byType: [] });
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
