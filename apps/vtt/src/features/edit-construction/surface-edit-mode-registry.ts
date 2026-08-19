import type { SurfaceEditModeDefinition } from "./surface-edit-contract.ts";

const PATH_BRUSH_EFFECT_KIND = "surface.path-brush@1";
const PATH_BRUSH_TRANSFORMER = "procgen.surface-transformations.path-brush@1";

function pathBrushMode(sourceSurfaceType: string, label: string): SurfaceEditModeDefinition {
  return Object.freeze({
    id: `${sourceSurfaceType}.path-brush`,
    sourceSurfaceType,
    label,
    supportedTargetScopes: Object.freeze(["brush-region"] as const),
    effectKinds: Object.freeze([PATH_BRUSH_EFFECT_KIND]),
    transformerCapability: PATH_BRUSH_TRANSFORMER,
    scopePolicy: "local",
    previewPolicy: "gesture-preview",
  });
}

/** Product-owned edit modes; capabilities stay renderer- and WASM-neutral. */
export const SURFACE_EDIT_MODE_DEFINITIONS: readonly SurfaceEditModeDefinition[] = Object.freeze([
  pathBrushMode("terrain", "Terreno"),
  pathBrushMode("terrain-grass", "Terreno com grama"),
]);

const MODE_BY_SOURCE_TYPE = new Map(
  SURFACE_EDIT_MODE_DEFINITIONS.map((definition) => [definition.sourceSurfaceType, definition]),
);

/** Resolves the contextual edit mode for one semantic construction surface type. */
export function surfaceEditModeFor(sourceSurfaceType: string): SurfaceEditModeDefinition | undefined {
  return MODE_BY_SOURCE_TYPE.get(sourceSurfaceType);
}

/** Source policy consumed by the path transformer; derived once from the mode registry. */
export const PATH_BRUSH_SOURCE_SURFACE_TYPES: readonly string[] = Object.freeze(
  SURFACE_EDIT_MODE_DEFINITIONS.filter((definition) =>
    definition.effectKinds.includes(PATH_BRUSH_EFFECT_KIND),
  ).map((definition) => definition.sourceSurfaceType),
);
