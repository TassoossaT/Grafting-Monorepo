import assert from "node:assert/strict";
import test from "node:test";
import { findMarkers, findMissingNotices } from "./check-third-party-notices.mjs";

test("findMarkers ignores files with no adaptation marker", () => {
  const markers = findMarkers([["src/foo.ts", "export const x = 1;"]]);
  assert.deepEqual(markers, []);
});

test("findMarkers extracts project name and URL from a marked file", () => {
  const content = [
    "// Adapted from deck.gl (https://github.com/visgl/deck.gl).",
    "// Original license: MIT. See THIRD_PARTY_NOTICES.md.",
    "export function extrude() {}",
  ].join("\n");
  const markers = findMarkers([["src/terrain.ts", content]]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].file, "src/terrain.ts");
  assert.equal(markers[0].project, "deck.gl");
  assert.equal(markers[0].url, "https://github.com/visgl/deck.gl");
});

test("findMarkers works regardless of comment syntax", () => {
  const content = "# Adapted from noise-rs (https://github.com/Razaekel/noise-rs).\n";
  const markers = findMarkers([["src/lib.rs", content]]);
  assert.equal(markers[0].project, "noise-rs");
});

test("findMissingNotices flags a marker with no matching entry", () => {
  const markers = [{ file: "src/terrain.ts", project: "deck.gl", url: "https://example.com" }];
  const missing = findMissingNotices(markers, "## Notices\n\nNone yet.\n");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].project, "deck.gl");
});

test("findMissingNotices passes a marker whose project name appears in the notices file", () => {
  const markers = [{ file: "src/terrain.ts", project: "deck.gl", url: "https://example.com" }];
  const missing = findMissingNotices(markers, "### deck.gl\n\n- Source: https://example.com\n");
  assert.deepEqual(missing, []);
});

test("findMissingNotices returns nothing when there are no markers", () => {
  assert.deepEqual(findMissingNotices([], "## Notices\n\nNone yet.\n"), []);
});
