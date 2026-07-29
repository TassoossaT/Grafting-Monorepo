import assert from "node:assert/strict";
import test from "node:test";

import {
  createEdgeViewCatalog,
  createNodeViewCatalog,
  resolveCanvasView,
} from "../dist/canvas/view-catalog.js";
import { toX6EdgeMetadata } from "../dist/edges/metadata.js";
import { toX6EdgePresentation } from "../dist/edges/presentation.js";
import { toX6NodeMetadata } from "../dist/nodes/metadata.js";
import { setNodeSelection } from "../dist/nodes/selection.js";

const nodeView = {
  id: "consumer.any-dom-view",
  defaultWidth: 240,
  defaultHeight: 96,
  ports: [
    {
      id: "out",
      position: "right",
      presentation: { radius: 4, fill: "orange", stroke: "purple", strokeWidth: 2 },
    },
  ],
  mount: () => ({ update: () => undefined, dispose: () => undefined }),
};

const edgeView = {
  id: "consumer.any-edge-view",
  present: ({ edge, selected }) => ({
    connector: { kind: "smooth", direction: "horizontal" },
    line: {
      color: selected ? "blue" : "purple",
      width: selected ? 4 : 2,
      className: "consumer-effect",
      targetMarker: { kind: "classic", width: 8, height: 6 },
    },
    labels: [{ text: edge.data.label, backgroundColor: "white", borderRadius: 6 }],
    hitAreaWidth: 14,
  }),
};

test("builds per-canvas catalogs and rejects missing or duplicated consumer views", () => {
  const nodes = createNodeViewCatalog([nodeView]);
  const edges = createEdgeViewCatalog([edgeView]);

  assert.equal(resolveCanvasView("node", nodes, nodeView.id), nodeView);
  assert.equal(resolveCanvasView("edge", edges, edgeView.id), edgeView);
  assert.throws(() => createNodeViewCatalog([nodeView, nodeView]), /duplicated/);
  assert.throws(() => resolveCanvasView("node", nodes, "missing"), /not registered/);
});

test("hosts arbitrary consumer nodes without card, role, color, or product assumptions", () => {
  const catalog = createNodeViewCatalog([nodeView]);
  const node = {
    id: "consumer:shape",
    view: nodeView.id,
    x: 12,
    y: 34,
    data: { anything: true },
  };
  const metadata = toX6NodeMetadata(node, catalog);

  assert.equal(metadata.shape, "grafting-composable-node-host");
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 96);
  assert.equal(metadata.data.node, node);
  assert.equal(metadata.data.definition, nodeView);
  assert.equal("attrs" in metadata, false);
  assert.equal(metadata.ports.groups.out.attrs.circle.fill, "orange");
  assert.deepEqual(metadata.ports.items, [{ id: "out", group: "out" }]);
});

test("reprojects generic node selection through its opaque host data", () => {
  let data = { node: { id: "node-1" }, definition: nodeView, selected: false };
  const cell = {
    getData: () => data,
    setData: (next) => {
      data = next;
    },
  };

  assert.equal(setNodeSelection(cell, true), true);
  assert.equal(data.selected, true);
  assert.equal(Object.isFrozen(data), true);
  assert.equal(setNodeSelection({ getData: () => null, setData: () => undefined }, true), false);
});

test("maps consumer-owned terminals, curves, markers, labels, classes, and effects", () => {
  const edge = {
    id: "edge-1",
    view: edgeView.id,
    source: { nodeId: "a", portId: "out" },
    target: { nodeId: "b", portId: "in" },
    data: { label: "relates" },
  };
  const metadata = toX6EdgeMetadata(edge, createEdgeViewCatalog([edgeView]));
  const selected = toX6EdgePresentation(edgeView.present({ edge, selected: true }));

  assert.deepEqual(metadata.source, { cell: "a", port: "out" });
  assert.deepEqual(metadata.target, { cell: "b", port: "in" });
  assert.deepEqual(metadata.connector, { name: "smooth", args: { direction: "H" } });
  assert.equal(metadata.attrs.line.class, "consumer-effect");
  assert.equal(metadata.attrs.line.targetMarker.name, "classic");
  assert.equal(metadata.labels[0].attrs.label.text, "relates");
  assert.equal(selected.attrs.line.stroke, "blue");
  assert.equal(selected.attrs.line.strokeWidth, 4);
});

test("keeps neutral interaction defaults replaceable", async () => {
  const { toX6ReadOnlyInteractionOptions } = await import(
    "../dist/canvas/interaction-options.js"
  );
  const defaults = toX6ReadOnlyInteractionOptions();
  const composed = toX6ReadOnlyInteractionOptions({
    clickThreshold: 7,
    panning: true,
    zoom: { modifiers: ["control"], minScale: 0.2 },
  });

  assert.equal(defaults.panning.enabled, false);
  assert.equal(defaults.mousewheel.enabled, false);
  assert.equal(composed.clickThreshold, 7);
  assert.equal(composed.panning.enabled, true);
  assert.deepEqual(composed.mousewheel.modifiers, ["ctrl"]);
});
