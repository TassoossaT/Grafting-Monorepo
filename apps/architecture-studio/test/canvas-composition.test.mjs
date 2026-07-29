import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCHITECTURE_CANVAS_COMPOSITION,
  presentArchitectureEdge,
} from "../src/canvas-composition.ts";

test("owns the concrete node, surface, ports, and interactions outside x6-canvas", () => {
  const nodeView = ARCHITECTURE_CANVAS_COMPOSITION.nodeViews[0];
  const ports = nodeView.ports.map(({ id, position }) => ({ id, position }));

  assert.equal(nodeView.id, "architecture.entity-summary");
  assert.deepEqual(ports, [
    { id: "top", position: "top" },
    { id: "right", position: "right" },
    { id: "bottom", position: "bottom" },
    { id: "left", position: "left" },
  ]);
  assert.equal(ARCHITECTURE_CANVAS_COMPOSITION.surface.backgroundColor, "#f8fafc");
  assert.equal(ARCHITECTURE_CANVAS_COMPOSITION.surface.grid.kind, "dot");
  assert.equal(ARCHITECTURE_CANVAS_COMPOSITION.interaction.panning, true);
  assert.equal(ARCHITECTURE_CANVAS_COMPOSITION.interaction.movableNodes, true);
  assert.equal(ARCHITECTURE_CANVAS_COMPOSITION.interaction.selectOnActivate, true);
  assert.equal(ARCHITECTURE_CANVAS_COMPOSITION.viewport.fitOnCreate, true);
});

test("owns edge curves and can change complete presentation on selection", () => {
  const edge = {
    id: "edge:test",
    view: "architecture.relation",
    source: { nodeId: "a", portId: "right" },
    target: { nodeId: "b", portId: "left" },
    data: { label: "depends_on", treatment: "dependency" },
  };
  const ordinary = presentArchitectureEdge({ edge, selected: false });
  const selected = presentArchitectureEdge({ edge, selected: true });

  assert.deepEqual(ordinary.connector, { kind: "smooth", direction: "horizontal" });
  assert.equal(ordinary.line.color, "#6366f1");
  assert.equal(ordinary.line.targetMarker.kind, "block");
  assert.equal(ordinary.labels[0].text, "depends_on");
  assert.equal(selected.line.color, "#2563eb");
  assert.equal(selected.line.width, 3);
  assert.match(selected.line.attributes.filter, /drop-shadow/);
});

test("accepts another product-defined node view without changing the canvas package", () => {
  const circleView = {
    id: "architecture.circle",
    defaultWidth: 64,
    defaultHeight: 64,
    mount: () => ({ update: () => undefined, dispose: () => undefined }),
  };
  const nextComposition = {
    ...ARCHITECTURE_CANVAS_COMPOSITION,
    nodeViews: [...ARCHITECTURE_CANVAS_COMPOSITION.nodeViews, circleView],
  };

  assert.deepEqual(
    nextComposition.nodeViews.map(({ id }) => id),
    ["architecture.entity-summary", "architecture.circle"],
  );
});
