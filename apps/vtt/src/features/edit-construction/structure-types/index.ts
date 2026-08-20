import type { ConstructionRegionTopology } from "@/ports";

import type { EditTarget } from "../atomic-edit.ts";
import { organicStructureType } from "./organic-structure.ts";
import { panelStructureType } from "./panel-structure.ts";
import type { EditRole, RolePolicy, StructureTypeDefinition } from "./structure-type.ts";
import { denied } from "./structure-type.ts";

/**
 * One file per structure type, each pairing creation-shape knowledge with
 * the role table that shape implies -- the whole TS-owned half of
 * `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
 *
 * Types sharing a generation call share a definition rather than restating
 * one: every `extrude_path` product (wall, tower, door jamb) is the same
 * upright panel, and every procedurally swept product (terrain, path) is the
 * same non-enumerable boundary. Splitting them per product name would be
 * duplication, not per-type policy.
 */
export const STRUCTURE_TYPE_DEFINITIONS: readonly StructureTypeDefinition[] = Object.freeze([
  panelStructureType("wall-white", "Parede branca", "generatePathExtrusion, one upright panel per drawn edge"),
  panelStructureType("wall-gray", "Parede cinza", "generatePathExtrusion, one upright panel per drawn edge"),
  panelStructureType("door", "Porta", "generatePathExtrusion's own notch piece, the same upright panel shape"),
  panelStructureType("floor", "Piso", "generateRegionPartition's per-region cap"),
  panelStructureType("ceiling", "Teto", "generateRegionPartition's per-region cap"),
  organicStructureType(
    "terrain",
    "Terreno",
    "generateTerrainCell / terrain-sculpt's noise lattice",
    "regenerate",
  ),
  organicStructureType(
    "terrain-grass",
    "Terreno com grama",
    "generateTerrainCell / terrain-sculpt's noise lattice",
    "regenerate",
  ),
  organicStructureType("path", "Caminho", "applyPathBrush's swept convex footprint", "deny"),
]);

const DEFINITION_BY_SURFACE_TYPE = new Map(
  STRUCTURE_TYPE_DEFINITIONS.map((definition) => [definition.surfaceType, definition]),
);

/** The definition governing one surface type, or `undefined` if it has none. */
export function structureTypeFor(surfaceType: string): StructureTypeDefinition | undefined {
  return DEFINITION_BY_SURFACE_TYPE.get(surfaceType);
}

/**
 * The role a grabbed part of a region carries, plus the policy governing it.
 * A surface type with no definition at all resolves to a denial rather than
 * a permissive default -- an unrecognized type is exactly the case where
 * guessing would corrupt geometry.
 */
export function resolvePolicy(topology: ConstructionRegionTopology, target: EditTarget): RolePolicy {
  const definition = structureTypeFor(topology.surfaceType);
  if (definition === undefined) {
    return denied(
      `unknown:${topology.surfaceType}` satisfies EditRole,
      `no structure type is defined for surface type "${topology.surfaceType}"`,
    );
  }
  return definition.policyFor(definition.roleFor(topology, target));
}

export { organicStructureType, ORGANIC_ROLES } from "./organic-structure.ts";
export { panelStructureType, PANEL_ROLES } from "./panel-structure.ts";
export { allowed, denied } from "./structure-type.ts";
export type {
  CascadeContext,
  EditResolution,
  EditRole,
  RolePolicy,
  StructureTypeDefinition,
} from "./structure-type.ts";
