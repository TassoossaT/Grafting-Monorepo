import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Card, DataTable, EntitySummary, GridLayout, PreviewCard, StatusBadge, Text } from "../dist/index.js";
import { createReactViewHandle } from "../dist/hosts/mount-react-view.js";

test("exports only the deliberate Grafting component surface", async () => {
  const ui = await import("../dist/index.js");
  assert.deepEqual(Object.keys(ui).sort(), [
    "Button",
    "Card",
    "DataTable",
    "EntitySummary",
    "GridLayout",
    "PreviewCard",
    "StatusBadge",
    "Text",
    "createCanvas",
    "createHeightfieldCanvas",
    "mountEntitySummary",
  ]);
});

test("renders a bounded surface built on Ant Design's Card (DEC: card-antd-rebuild, 2026-08-02)", () => {
  const markup = renderToStaticMarkup(
    createElement(Card, { ariaLabel: "Panel", children: createElement("span", null, "Content") }),
  );

  assert.match(markup, /^<div/);
  assert.match(markup, /class="ant-card/);
  assert.match(markup, /aria-label="Panel"/);
  assert.match(markup, /Content/);
});

test("renders semantic atoms without exposing vendor configuration", () => {
  const markup = renderToStaticMarkup(
    createElement("div", null, [
      createElement(Text, { content: "Architecture Studio", key: "text", truncate: true }),
      createElement(StatusBadge, {
        key: "status",
        label: "Ready",
        status: "success",
      }),
    ]),
  );

  assert.match(markup, /Architecture Studio/);
  assert.match(markup, /Ready/);
  assert.match(markup, /role="status"/);
});

test("keeps a long entity identity in a bounded reusable card", () => {
  const markup = renderToStaticMarkup(
    createElement(EntitySummary, {
      ariaLabel: "Selected repository node",
      description: "A deliberately long caption that must remain within the card",
      status: "info",
      statusLabel: "Project",
      title: "A deliberately long repository node title that must be truncated",
    }),
  );

  assert.match(markup, /aria-label="Selected repository node"/);
  assert.match(markup, /overflow:hidden/);
  assert.match(markup, /A deliberately long repository node title/);
});

test("lets the Card atom own a complete selected canvas-node boundary", () => {
  const markup = renderToStaticMarkup(
    createElement(EntitySummary, {
      accentColor: "#4f46e5",
      backgroundColor: "#eef4ff",
      description: "project",
      fillContainer: true,
      interactive: true,
      selected: true,
      selectedColor: "#2563eb",
      borderWidth: 3,
      title: "Architecture Studio",
    }),
  );
  const rootTag = markup.match(/^<[^>]+>/)?.[0] ?? "";

  assert.match(rootTag, /^<div/);
  assert.match(rootTag, /class="ant-card/);
  assert.match(rootTag, /data-selected="true"/);
  assert.match(rootTag, /border:3px solid #2563eb/);
  assert.match(rootTag, /height:100%/);
  assert.match(rootTag, /cursor:pointer/);
});

test("shows a capped row of caller-owned tags below the entity identity", () => {
  const markup = renderToStaticMarkup(
    createElement(EntitySummary, {
      tags: ["lang:rust", "scope:shared", "type:lib", "platform:web"],
      title: "grafting-graph-core",
    }),
  );

  assert.match(markup, /lang:rust/);
  assert.match(markup, /scope:shared/);
  assert.match(markup, /type:lib/);
  assert.doesNotMatch(markup, /platform:web/);
});

test("renders a gallery tile without a cover image when none is given", () => {
  const markup = renderToStaticMarkup(
    createElement(PreviewCard, {
      ariaLabel: "noise-rs",
      description: "Perlin-noise procedural terrain heightmap.",
      title: "noise-rs",
    }),
  );

  assert.match(markup, /aria-label="noise-rs"/);
  assert.match(markup, /noise-rs/);
  assert.match(markup, /Perlin-noise procedural terrain heightmap\./);
  assert.doesNotMatch(markup, /<img/);
});

test("clips a PreviewCard's cover image to the card's own corners", () => {
  const markup = renderToStaticMarkup(
    createElement(PreviewCard, {
      cover: { alt: "Rendered heightmap preview", src: "/preview.png" },
      title: "Heightmap generation",
    }),
  );

  assert.match(markup, /<img[^>]*src="\/preview\.png"/);
  assert.match(markup, /<img[^>]*alt="Rendered heightmap preview"/);
  assert.match(markup, /overflow:hidden/);
});

test("keeps a filled PreviewCard's identity visible while its cover adapts to the grid panel", () => {
  const markup = renderToStaticMarkup(
    createElement(PreviewCard, {
      actions: "Open trial",
      cover: { alt: "Rendered heightmap preview", src: "/preview.png" },
      description: "Perlin-noise procedural terrain heightmap.",
      fillContainer: true,
      title: "Heightmap generation",
    }),
  );
  const imageTag = markup.match(/<img[^>]+>/)?.[0] ?? "";

  assert.match(markup, /height:100%/);
  assert.match(markup, /flex-direction:column/);
  assert.match(imageTag, /flex:1 1 0/);
  assert.match(imageTag, /min-height:0/);
  assert.match(markup, /Heightmap generation/);
  assert.match(markup, /Open trial/);
});

test("shows status and tags together below a PreviewCard's identity", () => {
  const markup = renderToStaticMarkup(
    createElement(PreviewCard, {
      status: "warning",
      statusLabel: "In development",
      tags: ["noise-rs"],
      title: "Heightmap generation",
    }),
  );
  const rootTag = markup.match(/^<[^>]+>/)?.[0] ?? "";

  assert.match(markup, /In development/);
  assert.match(markup, />noise-rs</);
  assert.match(rootTag, /class="ant-card/);
});

test("updates and disposes a DOM mount through a ReactDOM-free public lifecycle", () => {
  const calls = [];
  const root = {
    render: (element) => calls.push(["render", element.props.content]),
    unmount: () => calls.push(["unmount"]),
  };
  const mounted = createReactViewHandle(
    root,
    { content: "first" },
    (props) => createElement("span", props),
  );

  mounted.update({ content: "second" });
  mounted.dispose();
  mounted.dispose();

  assert.deepEqual(calls, [
    ["render", "first"],
    ["render", "second"],
    ["unmount"],
  ]);
  assert.throws(() => mounted.update({ content: "late" }), /disposed/);
});

test("renders bespoke React components inside vendor-neutral table cells", () => {
  const rows = [{ id: "node:ui", label: "@grafting/ui", kind: "library" }];
  const markup = renderToStaticMarkup(
    createElement(DataTable, {
      ariaLabel: "Repository nodes",
      columns: [
        {
          header: "Node",
          id: "node",
          renderCell: ({ row }) =>
            createElement(EntitySummary, {
              description: row.kind,
              title: row.label,
            }),
          value: (row) => row.label,
        },
      ],
      pagination: false,
      rowKey: (row) => row.id,
      rows,
    }),
  );

  assert.match(markup, /aria-label="Repository nodes"/);
  assert.match(markup, /<table/);
  assert.match(markup, /@grafting\/ui/);
  assert.match(markup, /library/);
});

test("arranges caller-owned panels on a vendor-neutral dashboard grid", () => {
  const markup = renderToStaticMarkup(
    createElement(GridLayout, {
      ariaLabel: "Studio dashboard",
      panels: [
        {
          content: createElement("span", null, "Graph canvas"),
          placement: { id: "canvas", x: 0, y: 0, width: 8, height: 6 },
        },
        {
          content: createElement("span", null, "Entity list"),
          placement: { id: "explorer", x: 8, y: 0, width: 4, height: 6, locked: true },
        },
      ],
    }),
  );

  assert.match(markup, /aria-label="Studio dashboard"/);
  assert.match(markup, /role="region"/);
  assert.match(markup, /Graph canvas/);
  assert.match(markup, /Entity list/);
});
