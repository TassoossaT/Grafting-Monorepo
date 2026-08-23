import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TOOL_PARAMS,
  STRUCTURE_TYPE_DEFINITIONS,
  structureTypeFor,
} from "../src/features/edit-construction/index.ts";

/**
 * The rule these tests hold: a **cloud's type** is where a structure's
 * behaviour lives, and a tool preset is a placeholder -- a named bundle of
 * parameters that picks a generator and a type that already exists. "A
 * tower," "a house," "the straight-line wall" are presets. None of them may
 * become a type, and none may name one the registry has not declared,
 * because the moment a preset owns a type it owns behaviour, and the same
 * structure would then edit differently depending on which button drew it.
 */

/** Every preset field that selects a structure type, by tool. */
const TYPE_BEARING_FIELDS = {
  "wall-brush": ["wallType"],
  "wall-line": ["wallType"],
  "interior-wall": ["wallType"],
  "tower-stamp": ["wallType"],
  opening: ["openingType"],
  "terrain-sculpt": ["targetSurface"],
};

/**
 * Types the app's own generators emit without a preset field naming them:
 * the path brush's own product, and the caps and notch
 * `generateRegionPartition` produces for a generated interior.
 */
const GENERATED_TYPES = ["path", "floor", "ceiling", "door"];

/** Presets, and near-miss names a preset might be tempted to become. */
const PRESET_NAMES = ["tower", "house", "room", "fence", "building", "wall-brush", "wall-line"];

test("every type a tool preset selects is one the structure-type registry already declares", () => {
  for (const [toolId, fields] of Object.entries(TYPE_BEARING_FIELDS)) {
    const params = DEFAULT_TOOL_PARAMS[toolId];
    assert.ok(params !== undefined, `${toolId} has no default params`);
    for (const field of fields) {
      const surfaceType = params[field];
      assert.equal(typeof surfaceType, "string", `${toolId}.${field} is not a type name`);
      assert.ok(
        structureTypeFor(surfaceType) !== undefined,
        `${toolId}.${field} names "${surfaceType}", which no structure type declares`,
      );
    }
  }
});

test("every type this app generates without a preset field is declared too", () => {
  for (const surfaceType of GENERATED_TYPES) {
    assert.ok(
      structureTypeFor(surfaceType) !== undefined,
      `nothing declares "${surfaceType}", so a cloud of it would have no behaviour`,
    );
  }
});

test("no preset became a type -- a tower is a wall someone stamped a circle of", () => {
  const declared = new Set(STRUCTURE_TYPE_DEFINITIONS.map((definition) => definition.surfaceType));
  for (const preset of PRESET_NAMES) {
    assert.equal(declared.has(preset), false, `"${preset}" is a preset and must not be a structure type`);
  }
});

test("a type is declared once, so one cloud can never resolve two behaviours", () => {
  const declared = STRUCTURE_TYPE_DEFINITIONS.map((definition) => definition.surfaceType);
  assert.equal(new Set(declared).size, declared.length);
});
