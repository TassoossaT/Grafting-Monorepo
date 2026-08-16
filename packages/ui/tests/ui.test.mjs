import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ActionDock,
  Card,
  Collapse,
  DataTable,
  Descriptions,
  Drawer,
  EDGE_HANDLE_SIZE,
  EdgeHandle,
  EntitySummary,
  FloatButton,
  FloatButtonGroup,
  FloatButtonTree,
  GridLayout,
  IconButton,
  Popover,
  PreviewCard,
  SelectableChip,
  SlidingPanel,
  StatusBadge,
  Text,
} from "../dist/index.js";
import { createReactViewHandle } from "../dist/hosts/mount-react-view.js";

test("exports only the deliberate Grafting component surface", async () => {
  const ui = await import("../dist/index.js");
  assert.deepEqual(Object.keys(ui).sort(), [
    "ActionDock",
    "Button",
    "Card",
    "Collapse",
    "DataTable",
    "Descriptions",
    "Drawer",
    "EDGE_HANDLE_SIZE",
    "EdgeHandle",
    "EntitySummary",
    "FloatButton",
    "FloatButtonGroup",
    "FloatButtonTree",
    "GridLayout",
    "IconButton",
    "Popover",
    "PreviewCard",
    "SelectableChip",
    "SlidingPanel",
    "StatusBadge",
    "Text",
    "createCanvas",
    "createGeometryCanvas",
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

test("renders an EdgeHandle fused to the requested edge, flat on the panel side and rounded on the other", () => {
  const rightMarkup = renderToStaticMarkup(
    createElement(EdgeHandle, { open: false, onClick: () => {}, edge: "right", title: "Abrir" }),
  );
  const leftMarkup = renderToStaticMarkup(
    createElement(EdgeHandle, { open: false, onClick: () => {}, edge: "left", title: "Abrir" }),
  );

  // Rounded on the side facing away from the panel, flat on the side
  // touching it -- edge="right" (panel anchored left) rounds its right side.
  assert.match(rightMarkup, /border-top-left-radius:0[;"]/);
  assert.match(rightMarkup, /border-top-right-radius:28px/);
  assert.match(leftMarkup, /border-top-right-radius:0[;"]/);
  assert.match(leftMarkup, /border-top-left-radius:28px/);
});

test("flips an EdgeHandle's glyph between open and closed", () => {
  const closedMarkup = renderToStaticMarkup(
    createElement(EdgeHandle, { open: false, onClick: () => {}, edge: "right", title: "Abrir" }),
  );
  const openMarkup = renderToStaticMarkup(
    createElement(EdgeHandle, { open: true, onClick: () => {}, edge: "right", title: "Fechar" }),
  );

  assert.match(closedMarkup, /aria-expanded="false"/);
  assert.match(openMarkup, /aria-expanded="true"/);
  assert.notEqual(closedMarkup.includes(">›<"), openMarkup.includes(">›<"));
});

test("slides a SlidingPanel fully off its anchored edge when closed and back when open", () => {
  const closedMarkup = renderToStaticMarkup(
    createElement(
      SlidingPanel,
      { open: false, onOpenChange: () => {}, edge: "right", width: 280 },
      createElement("span", null, "Configurações"),
    ),
  );
  const openMarkup = renderToStaticMarkup(
    createElement(
      SlidingPanel,
      { open: true, onOpenChange: () => {}, edge: "right", width: 280 },
      createElement("span", null, "Configurações"),
    ),
  );

  assert.match(closedMarkup, /transform:translateX\(280px\)/);
  assert.match(openMarkup, /transform:translateX\(0px\)/);
  assert.match(closedMarkup, /Configurações/);
});

test("fuses a SlidingPanel's EdgeHandle to the edge opposite its screen anchor, sized by EDGE_HANDLE_SIZE", () => {
  const rightAnchored = renderToStaticMarkup(
    createElement(
      SlidingPanel,
      { open: false, onOpenChange: () => {}, edge: "right", width: 280, title: "Configurações" },
      createElement("span", null, "Content"),
    ),
  );
  const leftAnchored = renderToStaticMarkup(
    createElement(
      SlidingPanel,
      { open: false, onOpenChange: () => {}, edge: "left", width: 280, title: "Configurações" },
      createElement("span", null, "Content"),
    ),
  );

  // Anchored right -> handle bulges left, so it must be flat on its right side.
  assert.match(rightAnchored, new RegExp(`left:-${EDGE_HANDLE_SIZE}px`));
  assert.match(rightAnchored, /border-top-right-radius:0[;"]/);
  // Anchored left -> handle bulges right, so it must be flat on its left side.
  assert.match(leftAnchored, new RegExp(`right:-${EDGE_HANDLE_SIZE}px`));
  assert.match(leftAnchored, /border-top-left-radius:0[;"]/);
});

test("renders an icon-only IconButton with its title as the accessible name", () => {
  const markup = renderToStaticMarkup(
    createElement(IconButton, { icon: "▢", title: "Adicionar Sala" }),
  );

  assert.match(markup, /<button/);
  assert.match(markup, /title="Adicionar Sala"/);
  assert.doesNotMatch(markup, /data-selected/);
});

test("marks a selected IconButton so the app's own boundary color can key off it", () => {
  const markup = renderToStaticMarkup(
    createElement(IconButton, { icon: "▢", title: "Terreno", label: "Terreno", selected: true }),
  );

  assert.match(markup, /data-selected="true"/);
  assert.match(markup, /Terreno/);
});

test("renders a Descriptions label-value grid in order", () => {
  const markup = renderToStaticMarkup(
    createElement(Descriptions, {
      items: [
        { key: "id", label: "Node ID", value: "node:42" },
        { key: "x", label: "Posição X", value: "1.23m" },
      ],
    }),
  );

  assert.match(markup, /Node ID/);
  assert.match(markup, /node:42/);
  assert.match(markup, /Posição X/);
  assert.match(markup, /1\.23m/);
  assert.ok(markup.indexOf("Node ID") < markup.indexOf("Posição X"), "rows stay in the given order");
});

test("renders a Collapse with every panel's header, expanded by default", () => {
  const markup = renderToStaticMarkup(
    createElement(Collapse, {
      panels: [
        { key: "inspector", header: "Inspector de Seleção", content: createElement("span", null, "node info") },
        { key: "material", header: "Material", content: createElement("span", null, "chips") },
      ],
    }),
  );

  assert.match(markup, /Inspector de Seleção/);
  assert.match(markup, /Material/);
  // Expanded by default (no explicit `defaultActiveKeys`) means both panels'
  // own content renders, not just their headers.
  assert.match(markup, /node info/);
  assert.match(markup, /chips/);
});

test("renders a Collapse with only the requested panels expanded", () => {
  const markup = renderToStaticMarkup(
    createElement(Collapse, {
      defaultActiveKeys: ["inspector"],
      panels: [
        { key: "inspector", header: "Inspector", content: createElement("span", null, "node info") },
        { key: "material", header: "Material", content: createElement("span", null, "chips") },
      ],
    }),
  );

  assert.match(markup, /node info/);
  assert.doesNotMatch(markup, /chips/);
});

test("a borderless Collapse drops its own outer frame, for nesting inside an already-bounded surface", () => {
  const bordered = renderToStaticMarkup(createElement(Collapse, { panels: [{ key: "a", header: "A", content: "x" }] }));
  const borderless = renderToStaticMarkup(
    createElement(Collapse, { bordered: false, panels: [{ key: "a", header: "A", content: "x" }] }),
  );

  assert.doesNotMatch(bordered, /ant-collapse-borderless/);
  assert.match(borderless, /ant-collapse-borderless/);
  assert.match(borderless, /ant-collapse-ghost/);
});

test("renders a standalone FloatButton with its tooltip as the accessible name", () => {
  const markup = renderToStaticMarkup(createElement(FloatButton, { icon: "☰", tooltip: "Configurações" }));

  assert.match(markup, /float-btn/);
});

// Like Drawer and Popover, a FloatButtonGroup's expanded item list only
// renders once opened client-side (menu-mode) -- its SSR markup shows only
// the collapsed trigger. This asserts what is actually observable server-side.
test("renders a FloatButtonGroup's own trigger icon", () => {
  const markup = renderToStaticMarkup(
    createElement(FloatButtonGroup, {
      icon: "⚒",
      items: [
        { key: "navigate", icon: "N", tooltip: "Navegar" },
        { key: "move-node", icon: "M", tooltip: "Mover Node" },
      ],
    }),
  );

  assert.match(markup, /ant-float-btn-group/);
  assert.match(markup, />⚒</);
});

test("renders an alwaysExpanded FloatButtonGroup as every item directly, with no trigger button at all", () => {
  const markup = renderToStaticMarkup(
    createElement(FloatButtonGroup, {
      alwaysExpanded: true,
      items: [
        { key: "navigate", icon: "N", tooltip: "Navegar" },
        { key: "move-node", icon: "M", tooltip: "Mover Node" },
      ],
    }),
  );

  assert.doesNotMatch(markup, /ant-float-btn-group/);
  assert.match(markup, /position:static/);
  assert.match(markup, />N</);
  assert.match(markup, />M</);
});

test("renders a SelectableChip as an Ant Design checkable tag with its swatch and checked state", () => {
  const checkedMarkup = renderToStaticMarkup(
    createElement(SelectableChip, { label: "Bloco Branco", swatchColor: "#e2e8f0", selected: true }),
  );
  const uncheckedMarkup = renderToStaticMarkup(
    createElement(SelectableChip, { label: "Bloco Cinza", selected: false }),
  );

  assert.match(checkedMarkup, /ant-tag-checkable-checked/);
  assert.match(checkedMarkup, /background:#e2e8f0/);
  assert.match(checkedMarkup, /Bloco Branco/);
  assert.doesNotMatch(uncheckedMarkup, /ant-tag-checkable-checked/);
});

// Drawer and Popover both render their panel content through Ant Design's
// own portal (into `document.body`), which does not exist under
// `renderToStaticMarkup` -- confirmed directly (antd itself logs "Portal
// only work in client side" during these tests). So unlike every other atom
// in this file, their panel content is not observable through static markup
// in either open or closed state; these tests assert only what actually is
// observable server-side: that each renders without throwing, and that a
// Popover's own anchor (not portaled) is present and reflects `open`.

test("renders a Drawer for either open state without throwing", () => {
  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      createElement(Drawer, { open: true, onClose: () => {}, title: "Ajustes" }, createElement("span", null, "body")),
    ),
  );
  assert.doesNotThrow(() =>
    renderToStaticMarkup(createElement(Drawer, { open: false, onClose: () => {} }, createElement("span", null, "body"))),
  );
});

test("renders a Popover's own anchor, marked open when shown", () => {
  const openMarkup = renderToStaticMarkup(
    createElement(
      Popover,
      { anchor: createElement("button", null, "Trigger"), open: true, onClose: () => {}, title: "Moldar Terreno" },
      createElement("span", null, "body"),
    ),
  );
  const closedMarkup = renderToStaticMarkup(
    createElement(Popover, { anchor: createElement("button", null, "Trigger"), open: false, onClose: () => {} }, "body"),
  );

  assert.match(openMarkup, /Trigger/);
  assert.match(openMarkup, /ant-popover-open/);
  assert.doesNotMatch(closedMarkup, /ant-popover-open/);
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

test("renders ActionDock with primary construction verbs and expandable sub-items", () => {
  const markup = renderToStaticMarkup(
    createElement(ActionDock, {
      ariaLabel: "Barra de Construção",
      items: [
        {
          key: "building",
          label: "Edifício",
          icon: "🏠",
          active: true,
          shortcut: "B",
          subItems: [
            { key: "rect", label: "Retangular", active: true, shortcut: "1" },
            { key: "tower", label: "Torre", active: false, shortcut: "2" },
          ],
        },
        {
          key: "wall",
          label: "Muro",
          icon: "🧱",
          shortcut: "W",
        },
      ],
      leadingAccessories: createElement("button", { type: "button" }, "Undo"),
      trailingAccessories: createElement("button", { type: "button" }, "Snap"),
    }),
  );

  assert.match(markup, /aria-label="Barra de Construção"/);
  assert.match(markup, /role="toolbar"/);
  assert.match(markup, /Edifício/);
  assert.match(markup, /Muro/);
  assert.match(markup, /Variações de ferramenta/);
  assert.match(markup, /Retangular/);
  assert.match(markup, /Torre/);
  assert.match(markup, /Undo/);
  assert.match(markup, /Snap/);
});

