import assert from "node:assert/strict";
import test from "node:test";

import { commitWallStroke } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

/**
 * The concrete claim this whole feature makes, against the real WASM
 * engine: a curved wall the free brush draws stays exactly the same
 * 4-vertex, 4-edge upright panel every other wall step is -- the curve is
 * carried entirely as one edge's own `"bezier"` geometry, never as extra
 * graph vertices.
 */
test("a genuinely curved free-hand wall stroke commits as one 4-node, 4-edge Bezier panel", () => {
  const fixture = sessionFixture();
  try {
    const stroke = [];
    for (let index = 0; index <= 16; index += 1) {
      const t = index / 16;
      const angle = Math.PI - Math.PI * t;
      stroke.push({ x: 2 + 2 * Math.cos(angle), y: 0, z: 2 * Math.sin(angle) });
    }
    commitWallStroke(fixture.ctx, stroke, 0.3, { wallType: "wall-white", height: 3 }, "wall-brush");

    const panels = fixture.runtime.getAllRegionTopologies().filter((topology) => topology.surfaceType === "wall-white");
    assert.equal(panels.length, 1, "a single smooth curve should commit as one panel, not several");
    const panel = panels[0];
    assert.equal(panel.nodes.length, 4, "a wall panel is 4 vertices, curved or not");

    const loop = panel.outerLoops[0];
    assert.equal(loop.length, 4, "a wall panel is 4 edges, curved or not");
    const geometries = loop.map((use) => use.geometry?.kind ?? "line");
    const bezierEdges = geometries.filter((kind) => kind === "bezier");
    assert.equal(bezierEdges.length, 2, "the base and top rails carry the curve; the two verticals stay lines");
    const lineEdges = geometries.filter((kind) => kind === "line");
    assert.equal(lineEdges.length, 2);
  } finally {
    fixture.session.free();
  }
});
