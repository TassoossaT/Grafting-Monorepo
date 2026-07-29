import assert from "node:assert/strict";
import test from "node:test";
import {
  setX6NodeSelection,
  toX6EdgeMetadata,
  toX6NodeMetadata,
  toX6ReadOnlyInteractionOptions,
  X6_EDGE_SELECTION_HIGHLIGHT,
} from "../dist/internal/visual-style.js";

test("renders generic group nodes as reusable cards with four connection ports", () => {
  const metadata = toX6NodeMetadata({
    id: "group:a",
    label: "Architecture Studio",
    caption: "application",
    role: "group",
    x: 72,
    y: 72,
    width: 288,
    height: 72,
    color: "#eef4ff",
  });

  assert.equal(metadata.attrs.title.textWrap.text, "Architecture Studio");
  assert.equal(metadata.attrs.caption.textWrap.text, "application");
  assert.equal(metadata.attrs.title.textWrap.width, 222);
  assert.equal(metadata.attrs.caption.textWrap.width, 222);
  assert.equal(metadata.attrs.title.x, 50);
  assert.equal(metadata.attrs.title.y, 27);
  assert.equal(metadata.attrs.title.fontSize, 15);
  assert.equal(metadata.attrs.caption.x, 50);
  assert.equal(metadata.attrs.caption.y, 48);
  assert.equal(metadata.attrs.caption.fontSize, 10);
  assert.equal(
    metadata.markup.some(({ selector }) => selector === "textViewport"),
    false,
  );

  const definitions = metadata.markup.find(({ tagName }) => tagName === "defs");
  const textClip = definitions.children[0];
  assert.equal(textClip.tagName, "clipPath");
  assert.equal(textClip.attrs.clipPathUnits, "userSpaceOnUse");
  assert.match(textClip.attrs.id, /^grafting-node-text-/);
  assert.deepEqual(textClip.children[0], {
    tagName: "rect",
    attrs: { x: 50, y: 8, width: 222, height: 56 },
  });
  assert.equal(metadata.attrs.title.clipPath, `url(#${textClip.attrs.id})`);
  assert.equal(metadata.attrs.caption.clipPath, `url(#${textClip.attrs.id})`);
  assert.equal(metadata.attrs.body.rx, 16);
  assert.equal(metadata.attrs.accent.fill, "#4f46e5");
  assert.deepEqual(
    metadata.ports.items.map(({ id, group }) => ({ id, group })),
    [
      { id: "top", group: "top" },
      { id: "right", group: "right" },
      { id: "bottom", group: "bottom" },
      { id: "left", group: "left" },
    ],
  );
});

test("aligns node selection with the visible card body", () => {
  const attributes = new Map();
  const outline = {
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const selectors = [];
  const view = {
    findOne: (selector) => {
      selectors.push(selector);
      return outline;
    },
  };

  assert.equal(setX6NodeSelection(view, true), true);
  assert.equal(attributes.get("opacity"), "1");
  assert.equal(setX6NodeSelection(view, false), true);
  assert.equal(attributes.get("opacity"), "0");
  assert.deepEqual(selectors, ["selectionOutline", "selectionOutline"]);
  assert.equal(X6_EDGE_SELECTION_HIGHLIGHT.highlighter.args.padding, 0);
  assert.equal(X6_EDGE_SELECTION_HIGHLIGHT.highlighter.args.rx, 16);
});

test("supports ordinary left-button panning with click movement tolerance", () => {
  const options = toX6ReadOnlyInteractionOptions();

  assert.equal(options.interacting, false);
  assert.equal(options.clickThreshold, 4);
  assert.deepEqual(options.panning, {
    enabled: true,
    eventTypes: ["leftMouseDown"],
  });
});

test("uses vertical hierarchy curves and horizontal dependency arrows without domain names", () => {
  const hierarchy = toX6EdgeMetadata({
    id: "edge:hierarchy",
    source: "group:a",
    target: "item:a",
    label: "contains",
    role: "hierarchy",
  });
  const dependency = toX6EdgeMetadata({
    id: "edge:dependency",
    source: "group:a",
    target: "group:b",
    label: "depends_on",
    role: "dependency",
  });

  assert.deepEqual(hierarchy.connector, { name: "smooth", args: { direction: "V" } });
  assert.deepEqual(hierarchy.source, { cell: "group:a", port: "bottom" });
  assert.deepEqual(hierarchy.target, { cell: "item:a", port: "top" });
  assert.equal(hierarchy.attrs.line.strokeDasharray, "5 6");
  assert.deepEqual(dependency.connector, { name: "smooth", args: { direction: "H" } });
  assert.deepEqual(dependency.source, { cell: "group:a", port: "right" });
  assert.deepEqual(dependency.target, { cell: "group:b", port: "left" });
  assert.equal(dependency.attrs.line.targetMarker.name, "block");
  assert.equal(dependency.labels[0].attrs.body.rx, 8);
});
