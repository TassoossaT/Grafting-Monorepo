import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DataTable, EntitySummary, StatusBadge, Text } from "../dist/index.js";

test("exports only the deliberate Grafting component surface", async () => {
  const ui = await import("../dist/index.js");
  assert.deepEqual(Object.keys(ui).sort(), ["DataTable", "EntitySummary", "StatusBadge", "Text"]);
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
