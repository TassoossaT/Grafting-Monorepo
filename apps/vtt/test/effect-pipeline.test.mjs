import assert from "node:assert/strict";
import test from "node:test";

import {
  EffectChainTooDeepError,
  EffectRefusedError,
  MAX_EFFECT_DEPTH,
  runEffects,
  STRUCTURE_TYPE_DEFINITIONS,
} from "../src/features/edit-construction/index.ts";

/**
 * The pipeline's own rules, with reactions standing in for real ones: who an
 * effect reaches, how a chain grows and how it ends, and that one refusal
 * condemns everything. Reach comes from the real registry's interactions;
 * which reaction a type declares is injected so a chain across several
 * reactions can be exercised before real types declare one.
 */

function face(key, surfaceType, x = 0, z = 0) {
  const ids = [`${key}:0`, `${key}:1`, `${key}:2`, `${key}:3`];
  const corners = [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]];
  return {
    surfaceKey: ["@region", key],
    surfaceType,
    physical: true,
    nodes: ids.map((id, index) => ({ id, position: { x: corners[index][0], y: 0, z: corners[index][1] } })),
    outerLoops: [ids.map((id, index) => ({ edgeId: `${key}:e${index}`, reversed: false, startNodeId: id, endNodeId: ids[(index + 1) % 4], geometry: { kind: "line" } }))],
    holes: [],
  };
}

function effect(kind, surfaceType, options = {}) {
  return {
    kind,
    causeId: "cause",
    change: { surfaceType, subtype: options.subtype, before: [], after: [face(`${surfaceType}-changed`, surfaceType)], removedNodeIds: [], declaredPositions: [] },
  };
}

const sourceOf = (faces) => ({ regionsNear: () => faces });
const declaredBy = (table) => (surfaceType, kind) => table[`${surfaceType}/${kind}`];
const done = (emitted) => ({ kind: "done", emitted });

test("an effect reaches only what the changed type's interaction cuts, one call per declared reaction", () => {
  const calls = [];
  const faces = [face("t", "terrain"), face("g", "terrain-grass", 1), face("w", "wall-white", 2), face("r", "roof", 3)];
  const declared = declaredBy({ "terrain/cut": "ground", "terrain-grass/cut": "ground", "wall-white/cut": "wall", "roof/cut": "roof" });
  const reactions = {
    ground: (_context, _effect, hits) => { calls.push(["ground", hits.map((hit) => hit.surfaceType)]); return done(); },
    wall: () => { calls.push(["wall"]); return done(); },
    roof: () => { calls.push(["roof"]); return done(); },
  };

  runEffects(undefined, sourceOf(faces), [effect("cut", "platform")], reactions, declared);

  // Hits arrive sorted by surface key: "@region g" before "@region t".
  assert.deepEqual(calls, [["ground", ["terrain-grass", "terrain"]]], "a platform cuts ground only, and ground answers once for both of its types");
});

test("a preset that spans instead of carving reaches nothing", () => {
  let called = false;
  runEffects(undefined, sourceOf([face("t", "terrain")]), [effect("cut", "path", { subtype: "bridge" })], { ground: () => { called = true; return done(); } }, declaredBy({ "terrain/cut": "ground" }));
  assert.equal(called, false);
});

test("a reaction's emitted effect reaches the next cloud, which answers from its own declaration", () => {
  const order = [];
  const faces = [face("t", "terrain"), face("w", "wall-white", 2)];
  const declared = declaredBy({ "terrain/cut": "ground", "wall-white/remove": "wall" });
  const reactions = {
    ground: () => { order.push("ground"); return done([effect("remove", "wall-white")]); },
    wall: (_context, received) => { order.push(`wall<-${received.emittedBy}`); return done(); },
  };

  const records = runEffects(undefined, sourceOf(faces), [effect("cut", "path")], reactions, declared);

  assert.deepEqual(order, ["ground", "wall<-ground"]);
  assert.deepEqual(records.map((record) => [record.reactionId, record.depth]), [["ground", 0], ["wall", 1]]);
});

test("a reaction answers each effect kind once per run, however many effects of that kind reach it", () => {
  let calls = 0;
  const reactions = { ground: () => { calls += 1; return done(); } };
  runEffects(undefined, sourceOf([face("t", "terrain")]), [effect("cut", "path"), effect("cut", "platform")], reactions, declaredBy({ "terrain/cut": "ground" }));
  assert.equal(calls, 1);
});

test("a reaction never receives what it emitted itself", () => {
  let calls = 0;
  const reactions = { ground: () => { calls += 1; return done([effect("remove", "terrain")]); } };
  runEffects(undefined, sourceOf([face("t", "terrain")]), [effect("cut", "path")], reactions, declaredBy({ "terrain/cut": "ground", "terrain/remove": "ground" }));
  assert.equal(calls, 1);
});

test("a refusal anywhere in the chain throws, and nothing after it runs", () => {
  const order = [];
  const faces = [face("t", "terrain"), face("w", "wall-white", 2)];
  const declared = declaredBy({ "terrain/cut": "ground", "wall-white/remove": "wall" });
  const reactions = {
    ground: () => { order.push("ground"); return done([effect("remove", "wall-white")]); },
    wall: () => { order.push("wall"); return { kind: "refuse", reason: "the wall cannot lose its base" }; },
  };

  assert.throws(
    () => runEffects(undefined, sourceOf(faces), [effect("cut", "path"), effect("remove", "wall-white")], reactions, declared),
    (error) => error instanceof EffectRefusedError && error.reactionId === "wall" && /cannot lose its base/.test(error.message),
  );
  assert.deepEqual(order, ["ground", "wall"], "the refusal ends the run before the queued effect is dispatched");
});

test("groups run in a stable order, independent of how the engine listed the faces", () => {
  const run = (faces) => {
    const order = [];
    const reactions = { a: () => { order.push("a"); return done(); }, b: () => { order.push("b"); return done(); } };
    runEffects(undefined, sourceOf(faces), [effect("cut", "path")], reactions, declaredBy({ "terrain/cut": "b", "wall-white/cut": "a" }));
    return order;
  };
  const faces = [face("t", "terrain"), face("w", "wall-white", 2)];
  assert.deepEqual(run(faces), ["a", "b"]);
  assert.deepEqual(run([...faces].reverse()), ["a", "b"]);
});

test("a chain longer than the depth cap aborts instead of running on", () => {
  const types = STRUCTURE_TYPE_DEFINITIONS.map((definition) => definition.surfaceType);
  assert.ok(types.length > MAX_EFFECT_DEPTH + 1, "enough declared types to build a chain past the cap");
  const table = {};
  const reactions = {};
  types.forEach((surfaceType, index) => {
    table[`${surfaceType}/remove`] = `step-${String(index).padStart(2, "0")}`;
    const next = types[index + 1];
    reactions[`step-${String(index).padStart(2, "0")}`] = () => done(next === undefined ? [] : [effect("remove", next)]);
  });
  const faces = types.map((surfaceType, index) => face(`f${index}`, surfaceType, index * 2));

  assert.throws(
    () => runEffects(undefined, sourceOf(faces), [effect("remove", types[0])], reactions, declaredBy(table)),
    EffectChainTooDeepError,
  );
});
