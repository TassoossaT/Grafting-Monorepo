import type { ConstructionCoveredRegion, ConstructionRegionTopology } from "@/ports";

import type { EditTarget } from "../orchestration/atomic-edit.ts";
import {
  organicStructureType,
  pathInteractionOver,
  terrainInteractionOver,
} from "./organic/organic-structure.ts";
import { panelStructureType } from "./panel/panel-structure.ts";
import { pathStructureType } from "./path/path-structure.ts";
import type { CutRepair, EditRole, RolePolicy, StructureTypeDefinition } from "./structure-type.ts";
import { denied } from "./structure-type.ts";
import { forbid, type CreationInteraction } from "./creation-interaction.ts";

/**
 * One module per structure family, each pairing creation-shape knowledge with
 * the role table that shape implies -- the whole TS-owned half of
 * `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
 *
 * A definition here is a **cloud's** behaviour, not a face's: the type
 * string a surface carries only selects which of these tables governs the
 * cloud it belongs to (`topology/construction-cloud.ts`). Every type declares
 * the same three things, including how far each of its roles reaches -- there
 * is no per-type escape from the rule, and a type that wants a different
 * reach says so in its own role table rather than in a tool.
 *
 * Types sharing a shape share a definition rather than restating one: every
 * upright panel (wall, tower, door jamb) is one type built by one builder --
 * a tower is a wall someone stamped a circle of, not a kind of its own --
 * and both terrain flavours are the same non-enumerable boundary. Splitting
 * those per product name would be duplication, not per-type policy.
 *
 * A path is its own definition despite also being generated, because its
 * shape genuinely differs: a swept run has addressable stations, so it has
 * real roles to name, where terrain has none and can only regenerate. Shape
 * is what decides whether two products share a table -- not whether they
 * happen to share a generator.
 */
export const STRUCTURE_TYPE_DEFINITIONS: readonly StructureTypeDefinition[] = Object.freeze([
  panelStructureType("wall-white", "Parede branca", "one upright panel per contour edge, drawn or stamped"),
  panelStructureType("wall-gray", "Parede cinza", "one upright panel per contour edge, drawn or stamped"),
  panelStructureType("door", "Porta", "one face standing in an opening, on the rim the wall shares with it"),
  panelStructureType("window", "Janela", "one face standing in an opening, on the rim the wall shares with it"),
  panelStructureType("floor", "Piso", "generateRegionPartition's per-region cap"),
  panelStructureType("ceiling", "Teto", "generateRegionPartition's per-region cap"),
  organicStructureType(
    "terrain",
    "Terreno",
    "generateTerrainCell / terrain-sculpt's noise lattice",
    "regenerate",
    terrainInteractionOver,
  ),
  organicStructureType(
    "terrain-grass",
    "Terreno com grama",
    "generateTerrainCell / terrain-sculpt's noise lattice",
    "regenerate",
    terrainInteractionOver,
  ),
  pathStructureType(
    "path",
    "Caminho",
    "the subtype's application-generated sweep patch, spine-major",
    pathInteractionOver,
  ),
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

/**
 * What painting `paintedType` over one already-present region means.
 *
 * An unrecognized covered type is refused rather than defaulting to
 * `"ignore"`: silently stacking on top of something nobody declared is
 * exactly how geometry accumulates unnoticed.
 */
export function resolveCreationInteraction(
  paintedType: string,
  coveredType: string,
  paintedSubtype?: string,
): CreationInteraction {
  const definition = structureTypeFor(paintedType);
  if (definition === undefined) {
    return forbid(`no structure type is defined for painted type "${paintedType}"`);
  }
  if (structureTypeFor(coveredType) === undefined) {
    return forbid(`no structure type is defined for covered type "${coveredType}"`);
  }
  return definition.interactionOver(coveredType, paintedSubtype);
}

/**
 * How `coveredType` repairs itself once a `"cut"` has consumed part of it.
 *
 * An unrecognized covered type has no table to consult, so it is reported
 * `"unsupported"` for the same reason `resolveCreationInteraction` refuses
 * one outright: there is nothing to defer to but a guess.
 */
export function resolveCutRepair(coveredType: string): CutRepair {
  const definition = structureTypeFor(coveredType);
  if (definition === undefined) {
    return { kind: "unsupported", reason: `no structure type is defined for covered type "${coveredType}"` };
  }
  return definition.repairAfterCut;
}

/** One covered region, paired with what the painted type wants to do about it. */
export interface ResolvedCoverage {
  readonly covered: ConstructionCoveredRegion;
  readonly interaction: CreationInteraction;
}

/**
 * Pairs every region a footprint touches with its resolved interaction --
 * the creation-side counterpart to `planEdit`. Pure: it decides, it does not
 * act, and the caller performs whatever the resolutions imply.
 *
 * A `"forbid"` anywhere in the result is the caller's cue to abandon the
 * whole stroke rather than apply the rest: painting terrain across a wall
 * must not quietly terraform everything except the wall.
 */
export function resolveCoverage(
  paintedType: string,
  covered: readonly ConstructionCoveredRegion[],
  paintedSubtype?: string,
): readonly ResolvedCoverage[] {
  return covered.map((entry) => ({
    covered: entry,
    interaction: resolveCreationInteraction(paintedType, entry.surfaceType, paintedSubtype),
  }));
}

/** The first refusal in a resolved coverage, if any. */
export function firstRefusal(resolved: readonly ResolvedCoverage[]): string | undefined {
  for (const entry of resolved) {
    if (entry.interaction.kind === "forbid") return entry.interaction.reason;
  }
  return undefined;
}

export * from "./structure-type.ts";
export * from "./creation-interaction.ts";
export * from "./panel/index.ts";
export * from "./organic/index.ts";
export * from "./path/index.ts";
