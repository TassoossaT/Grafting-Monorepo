import { roofStructureType } from "./roof/roof-structure.ts";
import { platformStructureType, slopedPlatformStructureType } from "./platform/platform-structure.ts";
import type { ConstructionCoveredRegion, ConstructionRegionTopology } from "@/ports";

import type { EditTarget } from "../orchestration/atomic-edit.ts";
import {
  organicStructureType,
  pathInteractionOver,
  terrainInteractionOver,
} from "./organic/organic-structure.ts";
import { panelStructureType } from "./panel/panel-structure.ts";
import { pathStructureType } from "./path/path-structure.ts";
import { PATH_SURFACE_TYPE } from "./path/path-surface-type.ts";
import type { EditRole, RolePolicy, StructureTrait, StructureTypeDefinition, StructureView } from "./structure-type.ts";
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
 * the same things, including how far each of its roles reaches -- there
 * is no per-type escape from the rule, and a type that wants a different
 * reach says so in its own role table rather than in a tool.
 *
 * This is the only place type names appear. Everything else asks what a type
 * is for through its traits (`hasTrait`), and the build fails on a type-name
 * comparison anywhere else (`test/no-type-name-comparisons.test.mjs`).
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
  platformStructureType,
  slopedPlatformStructureType,
  roofStructureType,
  panelStructureType("wall-white", "Parede branca", "one upright panel per contour edge, drawn or stamped", ["partition"]),
  panelStructureType("wall-gray", "Parede cinza", "one upright panel per contour edge, drawn or stamped", ["partition"]),
  panelStructureType("door", "Porta", "one face standing in an opening, on the rim the wall shares with it", []),
  panelStructureType("window", "Janela", "one face standing in an opening, on the rim the wall shares with it", []),
  organicStructureType(
    "terrain",
    "Terreno",
    "generateTerrainCell / terrain-sculpt's noise lattice",
    "regenerate",
    terrainInteractionOver,
    ["ground"],
  ),
  organicStructureType(
    "terrain-grass",
    "Terreno com grama",
    "generateTerrainCell / terrain-sculpt's noise lattice",
    "regenerate",
    terrainInteractionOver,
    ["ground"],
  ),
  pathStructureType(
    PATH_SURFACE_TYPE,
    "Caminho",
    "the subtype's application-generated sweep patch, spine-major",
    pathInteractionOver,
  ),
]);

const DEFINITION_BY_SURFACE_TYPE = new Map(
  STRUCTURE_TYPE_DEFINITIONS.map((definition) => [definition.surfaceType, definition]),
);

const TRAITS_BY_SURFACE_TYPE = new Map(
  STRUCTURE_TYPE_DEFINITIONS.map((definition) => [definition.surfaceType, new Set(definition.traits)]),
);

const NO_TRAITS: ReadonlySet<StructureTrait> = new Set();

/** The definition governing one surface type, or `undefined` if it has none. */
export function structureTypeFor(surfaceType: string): StructureTypeDefinition | undefined {
  return DEFINITION_BY_SURFACE_TYPE.get(surfaceType);
}

/** The traits one surface type declares. An undeclared type has none. */
export function traitsOf(surfaceType: string): ReadonlySet<StructureTrait> {
  return TRAITS_BY_SURFACE_TYPE.get(surfaceType) ?? NO_TRAITS;
}

/** Whether `surfaceType` declares `trait` -- the question to ask instead of comparing type names. */
export function hasTrait(surfaceType: string, trait: StructureTrait): boolean {
  return traitsOf(surfaceType).has(trait);
}

/** Every declared surface type carrying `trait`, in registry order. */
export function surfaceTypesWithTrait(trait: StructureTrait): readonly string[] {
  return STRUCTURE_TYPE_DEFINITIONS.filter((definition) => definition.traits.includes(trait)).map((definition) => definition.surfaceType);
}

function viewOf(definition: StructureTypeDefinition): StructureView {
  return { label: definition.label, traits: traitsOf(definition.surfaceType) };
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
  const covered = structureTypeFor(coveredType);
  if (covered === undefined) {
    return forbid(`no structure type is defined for covered type "${coveredType}"`);
  }
  return definition.interactionOver(viewOf(covered), paintedSubtype);
}

/**
 * Whether `structureType` vertically conforms to a support with these traits
 * (e.g. riding on top of ground and sampling its height). Defaults to `false`.
 */
export function resolveTraitConformance(
  structureType: string,
  support: ReadonlySet<StructureTrait>,
  subtype?: string,
): boolean {
  return structureTypeFor(structureType)?.conformsTo?.(support, subtype) ?? false;
}

/** {@link resolveTraitConformance} against a declared support type's own traits. */
export function resolveConformance(
  structureType: string,
  surfaceType: string,
  subtype?: string,
): boolean {
  return resolveTraitConformance(structureType, traitsOf(surfaceType), subtype);
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
