import assert from "node:assert/strict";
import test from "node:test";

import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";

/**
 * A platform laid in a depression, against the real engine, meets the ground
 * around it on every side -- whichever diagonal the rectangle was dragged along.
 *
 * Dragged one way the contour winds counter-clockwise, the other way clockwise,
 * and two things went wrong only for the second. The face was stored walking
 * its edges the same way as the ground outside, so every cell laid against it
 * was dropped for "sitting on standing ground". And the ground's corners were
 * inserted into each platform edge in reverse order, so the edge came back as
 * fragments overlapping each other. Either one leaves whole sides empty, with
 * every count in the terrain log still reading zero.
 *
 * A platform's outline is sealed now: the ground meets its sides at their
 * height without splitting them, so "met" reads as a ground node standing at
 * each corner rather than a ground face sharing each edge.
 */

function bowl(runtime, session) {
  // The fixture's snapshot knows no positions; adoption reads live ones.
  runtime.getSnapshot = () => ({
    tableId: "t",
    map: {
      nodePositions: new Map(JSON.parse(session.snapshot_json()).nodes.map((n) => [
        n.id,
        { position: { x: n.position[0], y: n.position[1], z: n.position[2] } },
      ])),
    },
  });
  const cell = 2;
  const cells = 8;
  const id = (i, j) => `g:${i}:${j}`;
  const nodes = [];
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = -8 + i * cell;
    const z = -8 + j * cell;
    nodes.push({ id: id(i, j), position: { x, y: 0.04 * (x * x + z * z), z } });
  }
  const edges = new Map();
  const use = (a, b) => {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    if (!edges.has(key)) edges.set(key, { edgeId: `e:${key}`, startNodeId: a < b ? a : b, endNodeId: a < b ? b : a });
    return { edgeId: edges.get(key).edgeId, reversed: edges.get(key).startNodeId !== a };
  };
  const regions = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    // Counter-clockwise in plan, as the ground the generator lays winds: a seam against the other way refuses every cell.
    const ring = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
    regions.push({ regionId: `q:${i}:${j}`, boundary: ring.map((a, n) => use(a, ring[(n + 1) % 4])), surfaceType: "terrain", physical: true });
  }
  runtime.addPatch({ nodes, edges: [...edges.values()], regions });
}

/**
 * Platform corners no ground node stands at, at their height. A platform's
 * outline is sealed: the ground meets its sides without splitting them or
 * taking its nodes, so a corner met is a ground node of its own exactly there.
 */
function unmetCorners(runtime) {
  const topologies = runtime.getAllRegionTopologies();
  const ground = topologies.filter((t) => t.surfaceType === "terrain").flatMap((t) => t.nodes.map((n) => n.position));
  return topologies
    .filter((t) => t.surfaceType === "platform")
    .flatMap((t) => t.nodes)
    .filter((corner) => !ground.some((p) => Math.hypot(p.x - corner.position.x, p.y - corner.position.y, p.z - corner.position.z) < 1e-3)).length;
}

for (const [label, from, to] of [
  ["counter-clockwise", [-3, -2], [2, 3]],
  ["clockwise", [2, -2], [-3, 3]],
]) {
  test(`a platform dragged ${label} in a depression is met by ground on every side`, () => {
    const { session, runtime, ctx, calls } = sessionFixture();
    const info = console.info;
    const warn = console.warn;
    console.info = () => {};
    console.warn = () => {};
    try {
      bowl(runtime, session);
      const corners = [[from[0], from[1]], [to[0], from[1]], [to[0], to[1]], [from[0], to[1]]]
        .map(([x, z]) => ({ point: { x, y: 0.3, z } }));
      commitPlatformContour(ctx, corners, { mode: "create", elevation: 0.3, shape: "rectangle" });

      assert.equal(calls.feedback.at(-1)?.tone, "success", JSON.stringify(calls.feedback));
      assert.equal(runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform").nodes.length, 4, "its four corners: the ground never splits its sides");
      assert.equal(unmetCorners(runtime), 0, "no side of the platform is left without ground against it");
      // And no hole in the ground round it: every point just off its outline has ground over it.
      const ground = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain");
      const covered = (x, z) => ground.some((t) => {
        const ring = t.outerLoops[0].map((use) => t.nodes.find((n) => n.id === use.startNodeId).position);
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i], b = ring[j];
          if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
        }
        return inside;
      });
      const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])], [z0, z1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
      const around = [];
      for (let t = 0.07; t < 1; t += 0.1) {
        around.push([x0 + (x1 - x0) * t, z0 - 0.3], [x0 + (x1 - x0) * t, z1 + 0.3], [x0 - 0.3, z0 + (z1 - z0) * t], [x1 + 0.3, z0 + (z1 - z0) * t]);
      }
      assert.deepEqual(around.filter(([x, z]) => !covered(x, z)), [], "no hole in the ground round the platform");
    } finally {
      console.info = info;
      console.warn = warn;
      session.free();
    }
  });
}

test("ground repaired around a platform already stored clockwise leaves the platform whole and meets it", async () => {
  // Faces committed before winding was normalised still stand the wrong way
  // round. Repairing ground against one must not break the platform itself:
  // when the ground split its sides, the corners it adopted were measured
  // along the ring, which runs against this edge, and inserted in that order
  // came back as fragments overlapping each other -- a side of 5 walked as
  // four spans of 3.75. Its sides are no longer split at all.
  const { repairTerrainCut } = await import("../src/composition/tabletop/terrain/terrain-regenerate.ts");
  const { session, runtime } = sessionFixture();
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    bowl(runtime, session);
    const clockwise = [[2, -2], [-3, -2], [-3, 3], [2, 3]];
    const nodes = clockwise.map(([x, z], index) => ({ id: `cw:${index}`, position: { x, y: 0.3, z } }));
    const edges = nodes.map((node, index) => ({ edgeId: `cw:edge:${index}`, startNodeId: node.id, endNodeId: nodes[(index + 1) % 4].id }));
    runtime.addPatch({ nodes, edges, regions: [{ regionId: "cw", boundary: edges.map((e) => ({ edgeId: e.edgeId, reversed: false })), surfaceType: "platform", physical: true }] });

    const under = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "terrain" && t.nodes.some((n) => n.position.x > -3 && n.position.x < 2 && n.position.z > -2 && n.position.z < 3));
    repairTerrainCut(runtime, {
      consumedSurfaceKeys: under.map((t) => t.surfaceKey),
      paintedNodes: [],
      paintedLoops: [],
      footprintOutline: clockwise,
      painterSurfaceType: "platform",
    }, "repair", "t");

    const platform = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    const at = new Map(platform.nodes.map((n) => [n.id, n.position]));
    const walked = platform.outerLoops[0].reduce((sum, e) => {
      const a = at.get(e.startNodeId);
      const b = at.get(e.endNodeId);
      return sum + Math.hypot(b.x - a.x, b.z - a.z);
    }, 0);
    assert.equal(platform.outerLoops[0].length, 4, "the repair left the platform's sides whole");
    assert.ok(Math.abs(walked - 20) < 1e-3, `the platform's rim is still 20 long, not ${walked}`);
    assert.equal(unmetCorners(runtime), 0, "and the ground came back up to every corner");
  } finally {
    console.info = info;
    console.warn = warn;
    session.free();
  }
});

test("a ramp still welds to a platform merged with the ground, whose sides the ground meets without splitting", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { session, runtime, ctx, calls } = sessionFixture();
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    bowl(runtime, session);
    const corners = [[-3, -2], [2, -2], [2, 3], [-3, 3]].map(([x, z]) => ({ point: { x, y: 0.3, z } }));
    commitPlatformContour(ctx, corners, { mode: "create", elevation: 0.3, shape: "rectangle" });
    const platform = () => runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
    assert.equal(platform().outerLoops[0].length, 4, "the ground meets the platform's sides without splitting them");
    assert.equal(unmetCorners(runtime), 0, "and comes up to every corner");
    // Straight ramp off the east side.
    const s = { point: { x: 2, y: 0.3, z: 0.5 } }, e = { point: { x: 6, y: 0, z: 0.5 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 2.5, topWidth: 1.5, rise: 2 });
    assert.equal(calls.feedback.at(-1).message, "Rampa: 1 ponta(s) soldada(s).", JSON.stringify(calls.feedback.at(-1)));
    const ramp = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform-ramp");
    for (const side of ["min", "max"]) {
      const id = ramp.nodes.find((n) => n.id.endsWith(`:ramp:bottom:${side}`)).id;
      assert.ok(platform().nodes.some((n) => n.id === id), `the platform shares the ramp's bottom ${side}`);
    }
    // And a curved one off the west side.
    commitPlatformSlope(ctx, [{ x: -3, y: 0.3, z: 0.5 }, { x: -7, y: 2, z: 0.5 }], { width: 1.5 });
    assert.match(calls.feedback.at(-1).message, /1 ponta\(s\) soldada/, JSON.stringify(calls.feedback.at(-1)));
  } finally {
    console.info = info;
    console.warn = warn;
    session.free();
  }
});

test("ground, a platform, a ramp off it and a floating floor welded on the ramp's top: every structure moves and turns, the ground rebuilt round it", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { platformContourTool } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { shownGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  const build = () => {
    const fixture = sessionFixture();
    const { session, runtime, ctx } = fixture;
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    bowl(runtime, session);
    commitPlatformContour(ctx, [[-3, -2], [2, -2], [2, 3], [-3, 3]].map(([x, z]) => ({ point: { x, y: 0.3, z } })), { mode: "create", elevation: 0.3, shape: "rectangle" });
    const s = { point: { x: 2, y: 0.3, z: 0.5 } }, e = { point: { x: 5, y: 0, z: 0.5 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 1.5, topWidth: 1.5, rise: 2 });
    const ramp = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform-ramp");
    const tmin = ramp.nodes.find((n) => n.id.endsWith(":top:min")), tmax = ramp.nodes.find((n) => n.id.endsWith(":top:max"));
    const { x, y } = tmin.position;
    commitPlatformContour(ctx, [{ point: tmin.position, nodeId: tmin.id }, { point: { x: x + 3, y, z: tmin.position.z } }, { point: { x: x + 3, y, z: tmax.position.z } }, { point: tmax.position, nodeId: tmax.id }], { mode: "create", elevation: y, support: "floating" });
    return fixture;
  };
  try {
    for (const owner of ["platform", "platform-ramp", "platform"]) {
      for (const [kind, amount] of [["pivot", [0, 2]], ["pivot", [-1, 0.5]], ["rotate", 0.5], ["rotate", -1]]) {
        const fixture = build();
        const { runtime, ctx, calls } = fixture;
        try {
          const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor };
          const handle = shownGlobalHandles(scene).find((h) => h.kind === kind && h.owner === owner);
          const tool = owner === "platform-ramp" ? slopeRampTool : platformContourTool;
          const params = owner === "platform-ramp" ? { bottomWidth: 1.5, topWidth: 1.5, rise: 2 } : platformContourTool.defaultParams();
          let to;
          if (kind === "pivot") to = { x: handle.position.x + amount[0], y: 0, z: handle.position.z + amount[1] };
          else {
            const a = Math.atan2(handle.position.z - handle.pivot.z, handle.position.x - handle.pivot.x) + amount;
            const r = Math.hypot(handle.position.x - handle.pivot.x, handle.position.z - handle.pivot.z);
            to = { x: handle.pivot.x + r * Math.cos(a), y: 0, z: handle.pivot.z + r * Math.sin(a) };
          }
          const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
          const current = { point: to, screenX: 200, screenY: 300 };
          const before = calls.feedback.length;
          tool.onPointerDown(ctx, start, params);
          tool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
          tool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
          const said = calls.feedback.slice(before).filter(Boolean);
          assert.ok(said.every((f) => f.tone !== "error"), `${owner} ${kind} ${JSON.stringify(amount)}: ${JSON.stringify(said.at(-1))}`);
          assert.equal(said.at(-1)?.tone, "success", `${owner} ${kind}: the handle's own edit ran, not a new structure`);
          assert.ok(!/ponta/.test(said.at(-1).message), `${owner} ${kind}: grabbed the handle rather than drawing a ramp`);
        } finally { fixture.session.free(); }
      }
    }
  } finally {
    console.info = info;
    console.warn = warn;
  }
});

test("a ramp drawn from the ground and dropped well onto a platform stops at the edge it crosses and joins it there", async () => {
  const { slopeRampTool, slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { surfaceRefFromNodeSet } = await import("../src/entities/map/index.ts");
  const { clickAll } = await import("./curve-draft-fixture.mjs");
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    for (const [label, draw] of [
      ["straight", (ctx, s, e) => slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 1.5, topWidth: 1.5, rise: 2 })],
      ["curved", (ctx, s, e) => clickAll(slopeCurveTool, ctx, [s, e], { width: 1.5, rise: 2, mode: "straight" })],
    ]) {
      for (const support of ["grounded", "floating"]) {
        const { session, runtime, ctx, calls } = sessionFixture();
        Object.assign(runtime, { showPreview() {}, clearPreview() {} });
        try {
          bowl(runtime, session);
          const y = support === "floating" ? 2 : 0.3;
          commitPlatformContour(ctx, [[-3, -2], [2, -2], [2, 3], [-3, 3]].map(([x, z]) => ({ point: { x, y, z } })), { mode: "create", elevation: y, shape: "rectangle", support });
          const platform = runtime.getAllRegionTopologies().find((t) => t.surfaceType === (support === "floating" ? "platform" : "platform"));
          // From the ground east of it, dropped 2 inside its east edge, on the platform itself.
          const start = { point: { x: 7, y: 0.04 * (49 + 0.25), z: 0.5 } };
          const end = { point: { x: 0, y, z: 0.5 }, surfaceRef: surfaceRefFromNodeSet(platform.surfaceKey) };
          draw(ctx, start, end);
          assert.match(calls.feedback.at(-1).message, /1 ponta\(s\) soldada/, `${label} ${support}: ${JSON.stringify(calls.feedback.at(-1))}`);
          const joined = runtime.getAllRegionTopologies().find((t) => t.surfaceKey.join() === platform.surfaceKey.join()) ?? runtime.getAllRegionTopologies().find((t) => t.surfaceType === platform.surfaceType);
          const edgeNodes = joined.nodes.filter((n) => Math.abs(n.position.x - 2) < 1e-6);
          assert.ok(edgeNodes.length > 2, `${label} ${support}: the ramp's end stands on the platform's east edge`);
        } finally { session.free(); }
      }
    }
  } finally {
    console.info = info;
    console.warn = warn;
  }
});

test("a ramp between a platform on the ground and a floor on its top comes off one end and back, the other end staying welded", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { shownGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  const params = { bottomWidth: 1.5, topWidth: 1.5, rise: 2 };
  const build = () => {
    const fixture = sessionFixture();
    const { session, runtime, ctx } = fixture;
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    bowl(runtime, session);
    commitPlatformContour(ctx, [[-3, -2], [2, -2], [2, 3], [-3, 3]].map(([x, z]) => ({ point: { x, y: 0.3, z } })), { mode: "create", elevation: 0.3, shape: "rectangle" });
    const s = { point: { x: 2, y: 0.3, z: 0.5 } }, e = { point: { x: 5, y: 0, z: 0.5 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, params);
    const ramp = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform-ramp");
    const tmin = ramp.nodes.find((n) => n.id.endsWith(":top:min")), tmax = ramp.nodes.find((n) => n.id.endsWith(":top:max"));
    const { x, y } = tmin.position;
    // Drawn from the ramp's own top corners: the floor's side is exactly as wide as the ramp's end.
    commitPlatformContour(ctx, [{ point: tmin.position, nodeId: tmin.id }, { point: { x: x + 3, y, z: tmin.position.z } }, { point: { x: x + 3, y, z: tmax.position.z } }, { point: tmax.position, nodeId: tmax.id }], { mode: "create", elevation: y, support: "floating" });
    return fixture;
  };
  /** How many of the ramp's nodes the low floor, or the high one, holds. */
  const shared = (runtime, level) => {
    const ramp = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform-ramp");
    const ids = new Set(ramp.nodes.map((n) => n.id));
    return runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform" && (level === "high") === (t.nodes[0].position.y > 1)).nodes.filter((n) => ids.has(n.id)).length;
  };
  const drag = (fixture, kind, to) => {
    const { runtime, ctx, calls } = fixture;
    const handle = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor }).find((h) => h.kind === kind && h.owner === "platform-ramp");
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: to(handle.position), screenX: 200, screenY: 300 };
    slopeRampTool.onPointerDown(ctx, start, params);
    slopeRampTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    slopeRampTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    const said = calls.feedback.at(-1);
    assert.equal(said.tone, "success", `${kind}: ${JSON.stringify(said)}`);
  };
  try {
    {
      // Pulled back along the ramp, off the platform's edge: it comes off; the top stays on its floor.
      const fixture = build();
      try {
        assert.deepEqual([shared(fixture.runtime, "low"), shared(fixture.runtime, "high")], [2, 2]);
        drag(fixture, "origin", (p) => ({ ...p, x: p.x + 1 }));
        assert.equal(shared(fixture.runtime, "low"), 0, "the bottom came off");
        assert.equal(shared(fixture.runtime, "high"), 2, "the top still welded, corner to corner");
      } finally { fixture.session.free(); }
    }
  } finally {
    console.info = info;
    console.warn = warn;
  }
});

test("the structure under the pointer shows its handles even where the renderer's pick met the ground or a floor it is welded to", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { sceneHandles, hasTrait } = await import("../src/features/edit-construction/index.ts");
  const { handleFocusAt, NO_FOCUS } = await import("../src/composition/tabletop/tools/core/handle-focus.ts");
  const { surfaceRefFromNodeSet } = await import("../src/entities/map/index.ts");
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  const { session, runtime, ctx } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    bowl(runtime, session);
    commitPlatformContour(ctx, [[-3, -2], [2, -2], [2, 3], [-3, 3]].map(([x, z]) => ({ point: { x, y: 0.3, z } })), { mode: "create", elevation: 0.3, shape: "rectangle" });
    const s = { point: { x: 2, y: 0.3, z: 0.5 } }, e = { point: { x: 5, y: 0, z: 0.5 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 1.5, topWidth: 1.5, rise: 2 });
    const faces = runtime.getAllRegionTopologies();
    const ramp = faces.find((t) => t.surfaceType === "platform-ramp");
    const platform = faces.find((t) => t.surfaceType === "platform");
    const ground = faces.find((t) => t.surfaceType === "terrain");
    const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor };
    // A ray from above and behind, down through the middle of the ramp.
    const mid = ramp.nodes.reduce((sum, n) => ({ x: sum.x + n.position.x / 4, y: sum.y + n.position.y / 4, z: sum.z + n.position.z / 4 }), { x: 0, y: 0, z: 0 });
    const origin = { x: mid.x - 6, y: mid.y + 10, z: mid.z - 4 };
    const d = { x: mid.x - origin.x, y: mid.y - origin.y, z: mid.z - origin.z }, l = Math.hypot(d.x, d.y, d.z);
    const ray = { origin, direction: { x: d.x / l, y: d.y / l, z: d.z / l } };
    const owns = (t) => t === "platform-ramp";
    for (const [label, hit] of [["the ground", ground], ["the platform it is welded to", platform]]) {
      const focus = handleFocusAt(ctx, { point: mid, ray, surfaceRef: surfaceRefFromNodeSet(hit.surfaceKey) }, NO_FOCUS, owns);
      const kinds = sceneHandles({ ...scene, contour: [], pointsOnly: false, owns, focus }).map((h) => h.kind);
      assert.ok(["pivot", "origin", "destination"].every((kind) => kinds.includes(kind)), `picked ${label}: ${JSON.stringify(kinds)}`);
    }
    // And a floor's own handles, pointing at the floor, with the floor tool.
    const floorFocus = handleFocusAt(ctx, { point: { x: -1, y: 0.3, z: 0 }, ray: { origin: { x: -1, y: 10, z: -2 }, direction: { x: 0, y: -0.98, z: 0.2 } }, surfaceRef: surfaceRefFromNodeSet(ground.surfaceKey) }, NO_FOCUS, (t) => hasTrait(t, "floor"));
    assert.ok(sceneHandles({ ...scene, contour: [], pointsOnly: false, owns: (t) => hasTrait(t, "floor"), focus: floorFocus }).some((h) => h.kind === "pivot"), "the platform's");
  } finally {
    session.free();
    console.info = info;
    console.warn = warn;
  }
});

test("with ground round a platform and a ramp welded to it, edits in a row never jam the session: the ground is cut at the ramp's end wherever it re-lands", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { platformContourTool } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { shownGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const info = console.info, warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  const params = { bottomWidth: 1.5, topWidth: 1.5, rise: 2 };
  const sequences = {
    // The ramp's foot slid along the platform's edge, then the platform's corner pushed: the ground had kept the foot's old cut.
    "slide the foot, push a corner": [["platform-ramp", "origin", { x: 2, y: 0.3, z: 1.1207 }], ["platform", "corner", { x: 1.2394, y: 0.3, z: -2.512 }]],
    // Turned twice and moved: the ground left to fill came out tangled, and the engine failed on it for good.
    "turn, turn, move": [["platform", "rotate", { x: -5.2359, y: 0.3, z: -1.0135 }], ["platform", "rotate", { x: -3.9356, y: 0.3, z: -3.4363 }], ["platform", "pivot", { x: 2.0857, y: 0.3, z: 1.1701 }]],
  };
  try {
    for (const [name, steps] of Object.entries(sequences)) {
      const fixture = sessionFixture();
      const { session, runtime, ctx, calls } = fixture;
      Object.assign(runtime, { showPreview() {}, clearPreview() {} });
      try {
        bowl(runtime, session);
        commitPlatformContour(ctx, [[-3, -2], [2, -2], [2, 3], [-3, 3]].map(([x, z]) => ({ point: { x, y: 0.3, z } })), { mode: "create", elevation: 0.3, shape: "rectangle" });
        const s = { point: { x: 2, y: 0.3, z: 0.5 } }, e = { point: { x: 5, y: 0, z: 0.5 } };
        slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, params);
        for (const [owner, kind, to] of [...steps, ["platform-ramp", "pivot", null]]) {
          const handles = shownGlobalHandles({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor }).filter((h) => h.owner === owner && h.kind === kind);
          const handle = to ? handles.sort((a, b) => Math.hypot(a.position.x - to.x, a.position.z - to.z) - Math.hypot(b.position.x - to.x, b.position.z - to.z))[0] : handles[0];
          const target = to ?? { x: handle.position.x + 0.5, y: handle.position.y, z: handle.position.z + 0.5 };
          const tool = owner === "platform-ramp" ? slopeRampTool : platformContourTool;
          const p = owner === "platform-ramp" ? params : platformContourTool.defaultParams();
          const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
          const current = { point: target, screenX: 200, screenY: 300 };
          tool.onPointerDown(ctx, start, p);
          tool.onPointerMove(ctx, { start, current, samples: [start, current] }, p);
          tool.onPointerUp(ctx, { start, current, samples: [start, current] }, p);
          assert.equal(calls.feedback.at(-1)?.tone, "success", `${name}, ${owner} ${kind}: ${JSON.stringify(calls.feedback.at(-1))}`);
        }
      } finally { session.free(); }
    }
  } finally {
    console.info = info;
    console.warn = warn;
  }
});
