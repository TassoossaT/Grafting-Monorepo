import assert from "node:assert/strict";
import test from "node:test";

import { createInvalidationTracker, createScene, createVisualRegistry } from "../dist/index.js";

const marker = { kind: "marker", params: {} };

function sceneWithLayers(...ids) {
  const scene = createScene();
  ids.forEach((id, order) => scene.defineLayer({ id, order }));
  return scene;
}

test("moving an item in one layer does not invalidate another layer", () => {
  const scene = sceneWithLayers("terrain", "actors");
  const tracker = createInvalidationTracker();

  scene.put({ id: "ground", layer: "terrain", visual: marker });
  scene.put({ id: "hero", layer: "actors", visual: marker });
  scene.observe((changes) => tracker.record(changes));

  scene.setTransform("hero", { position: { x: 1, y: 0, z: 0 } }, "local");
  const changed = tracker.drain();

  assert.deepEqual([...changed.layers], ["actors"]);
  assert.equal(
    changed.layers.has("terrain"),
    false,
    "one item's movement must not be able to force terrain to redraw",
  );
  assert.deepEqual([...changed.reposition], ["hero"]);
  assert.equal(changed.rebuild.size, 0, "a move must not rebuild geometry");
});

test("every change carries where it came from", () => {
  const scene = sceneWithLayers("actors");
  const origins = [];
  scene.observe((changes) => origins.push(...changes.map((c) => c.origin)));

  scene.put({ id: "hero", layer: "actors", visual: marker }, "local");
  scene.setTransform("hero", { position: { x: 1, y: 0, z: 0 } }, "remote");
  scene.setVisible("hero", false, "engine");

  assert.deepEqual(origins, ["local", "remote", "engine"]);
});

test("a batch produces one notification, not one per change", () => {
  const scene = sceneWithLayers("actors");
  const batches = [];
  scene.observe((changes) => batches.push(changes.length));

  scene.batch(() => {
    for (let i = 0; i < 20; i += 1) {
      scene.put({ id: `unit-${i}`, layer: "actors", visual: marker }, "remote");
    }
  });

  assert.deepEqual(batches, [20], "twenty moves in a turn must notify once");
});

test("a rebuild supersedes a pending move for the same item", () => {
  const scene = sceneWithLayers("actors");
  const tracker = createInvalidationTracker();
  scene.put({ id: "hero", layer: "actors", visual: marker });
  scene.observe((changes) => tracker.record(changes));

  scene.setTransform("hero", { position: { x: 5, y: 0, z: 0 } });
  scene.setVisualParams("hero", { tint: 1 });
  const changed = tracker.drain();

  assert.deepEqual([...changed.rebuild], ["hero"]);
  assert.equal(changed.reposition.size, 0, "a rebuild reapplies placement anyway");
});

test("removing an item releases it and cancels its pending work", () => {
  const scene = sceneWithLayers("actors");
  const tracker = createInvalidationTracker();
  scene.put({ id: "hero", layer: "actors", visual: marker });
  scene.observe((changes) => tracker.record(changes));

  scene.setTransform("hero", { position: { x: 1, y: 0, z: 0 } });
  scene.remove("hero");
  const changed = tracker.drain();

  assert.deepEqual([...changed.release], ["hero"]);
  assert.equal(changed.rebuild.size + changed.reposition.size, 0);
});

test("draining resets, so an unchanged frame reports nothing", () => {
  const scene = sceneWithLayers("actors");
  const tracker = createInvalidationTracker();
  scene.observe((changes) => tracker.record(changes));

  scene.put({ id: "hero", layer: "actors", visual: marker });
  tracker.drain();

  assert.equal(tracker.drain().empty, true);
});

test("an item cannot be placed in a layer nobody declared", () => {
  const scene = createScene();
  assert.throws(
    () => scene.put({ id: "hero", layer: "typo", visual: marker }),
    /undeclared layer "typo"/,
  );
});

test("a registry refuses a duplicate kind rather than silently replacing it", () => {
  const registry = createVisualRegistry();
  const definition = { kind: "token", describe: () => ({ geometry: { shape: "sphere", radius: 1 }, material: { surface: "unlit" } }) };

  registry.register(definition);

  assert.throws(() => registry.register(definition), /already registered/);
  assert.deepEqual(registry.kinds(), ["token"]);
});

test("a kind registered from outside needs nothing from the engine", () => {
  // Standing in for a separate package that defines its own concepts and hands
  // the registry over. Nothing here imports anything product-specific.
  const registry = createVisualRegistry();
  registry.register({
    kind: "wall-segment",
    describe: (p) => ({
      geometry: { shape: "box", width: p.length, height: 3, depth: 0.2 },
      material: { surface: "lit", color: 0x8a8a8a },
    }),
  });

  const descriptor = registry.get("wall-segment").describe({ length: 4 });

  assert.equal(descriptor.geometry.shape, "box");
  assert.equal(descriptor.geometry.width, 4);
});
