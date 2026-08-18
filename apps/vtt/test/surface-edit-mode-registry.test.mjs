import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_BRUSH_SOURCE_SURFACE_TYPES,
  SURFACE_EDIT_MODE_DEFINITIONS,
  surfaceEditModeFor,
} from "../src/features/edit-construction/surface-edit-mode-registry.ts";

test("path-brush source policy is derived from the app-owned edit-mode registry", () => {
  assert.deepEqual(PATH_BRUSH_SOURCE_SURFACE_TYPES, ["terrain", "terrain-grass"]);
  assert.equal(surfaceEditModeFor("terrain")?.previewPolicy, "gesture-preview");
  assert.deepEqual(surfaceEditModeFor("terrain-grass")?.supportedTargetScopes, ["brush-region"]);
  assert.equal(surfaceEditModeFor("path"), undefined);
  assert.equal(Object.isFrozen(SURFACE_EDIT_MODE_DEFINITIONS), true);
  assert.equal(Object.isFrozen(PATH_BRUSH_SOURCE_SURFACE_TYPES), true);
});
