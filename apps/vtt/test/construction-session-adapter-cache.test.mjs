import assert from "node:assert/strict";
import test from "node:test";
// The fixture initialises the construction engine synchronously, which the adapter then finds ready.
import "./platform-session-fixture.mjs";
import { createConstructionSessionAdapter } from "../src/adapters/construction/construction-session-wasm-adapter.ts";

const patch = (id) => ({
  nodes: [{ id: `${id}:a`, position: { x: 0, y: 0, z: 0 } }, { id: `${id}:b`, position: { x: 1, y: 0, z: 0 } }],
  edges: [{ edgeId: `${id}:ab`, startNodeId: `${id}:a`, endNodeId: `${id}:b` }],
  regions: [],
});

test("the graph read is shared until a call that may change the session, then read afresh", async () => {
  const adapter = createConstructionSessionAdapter();
  await adapter.start();
  try {
    const first = adapter.getGraphSnapshot();
    adapter.curveBatch({ tolerance: 0.025, commands: [{ kind: "automatic", points: [[0, 0, 0], [3, 0, 0]] }] });
    adapter.getAllRegionTopologies();
    assert.equal(adapter.getGraphSnapshot(), first, "reads that change nothing keep the graph read");
    adapter.addPatch(patch("p"));
    const after = adapter.getGraphSnapshot();
    assert.notEqual(after, first, "a change is read afresh");
    assert.ok(after.nodes.some((node) => node.id === "p:a"));
    assert.equal(first.nodes.some((node) => node.id === "p:a"), false, "the earlier read is not changed under its holder");
  } finally {
    await adapter.dispose();
  }
});
