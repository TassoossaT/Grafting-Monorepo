import assert from "node:assert/strict";
import test from "node:test";

import { createStructureEditBehavior } from "../src/composition/tabletop/tools/core/structure-edit-behavior.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/** A wall and a platform with entirely disjoint nodes -- the case that actually exercises `ownsType` filtering, unlike `building()`'s fixture where every wall corner doubles as a platform corner. */
function wallAndPlatform(runtime) {
  const wall = addFace(runtime, "wall-only", "wall-white", [
    { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "w:b-bottom", position: { x: 4, y: 0, z: 0 } },
    { id: "w:b-top", position: { x: 4, y: 3, z: 0 } },
    { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
  ]);
  const platform = addFace(runtime, "platform-only", "platform", [
    { id: "p:0", position: { x: 10, y: 0, z: 0 } },
    { id: "p:1", position: { x: 14, y: 0, z: 0 } },
    { id: "p:2", position: { x: 14, y: 0, z: 4 } },
    { id: "p:3", position: { x: 10, y: 0, z: 4 } },
  ]);
  return { wall, platform };
}

test("a wall-scoped behavior grabs the wall's own vertex and edits it", () => {
  const { runtime, session } = sessionFixture();
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
    const grabbed = behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 0, y: 0, z: 0 }, nodeId: "w:a-bottom" }, { mode: "shape" });
    assert.equal(grabbed, true);
    assert.equal(behavior.wasGrabbed(), true);
    assert.equal(behavior.isActive(), true);
  } finally { session.free(); }
});

test("a wall-scoped behavior refuses a platform's own vertex -- it does not own that type", () => {
  const { runtime, session } = sessionFixture();
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
    const grabbed = behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 10, y: 0, z: 0 }, nodeId: "p:0" }, { mode: "shape" });
    assert.equal(grabbed, false);
    assert.equal(behavior.wasGrabbed(), false);
    assert.equal(behavior.isActive(), false);
  } finally { session.free(); }
});

test("a platform-scoped behavior grabs the platform's own vertex, and refuses the wall's", () => {
  const { runtime, session } = sessionFixture();
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "platform" });
    assert.equal(behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 10, y: 0, z: 0 }, nodeId: "p:0" }, { mode: "shape" }), true);
    assert.equal(behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 0, y: 0, z: 0 }, nodeId: "w:a-bottom" }, { mode: "shape" }), false);
  } finally { session.free(); }
});
