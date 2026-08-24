import assert from "node:assert/strict";
import test from "node:test";

import {
  SURFACE_EDIT_MODE_DEFINITIONS,
  surfaceEditModeFor,
} from "../src/features/edit-construction/modes/surface-edit-mode-registry.ts";

test("path-brush contextual modes remain app-owned", () => {
  assert.equal(surfaceEditModeFor("terrain")?.previewPolicy, "gesture-preview");
  assert.deepEqual(surfaceEditModeFor("terrain-grass")?.supportedTargetScopes, ["brush-region"]);
  assert.equal(surfaceEditModeFor("path"), undefined);
  assert.equal(Object.isFrozen(SURFACE_EDIT_MODE_DEFINITIONS), true);
});
