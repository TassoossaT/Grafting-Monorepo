import type { ConstructionRegionTopology } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleProvider, GlobalHandleScene } from "../../global-handles/index.ts";
import { topologiesOfPatch } from "../handle-neighbors.ts";
import { structureTypeFor, type RecipeGeneration, type RecipeHandle } from "../../structure-types/index.ts";

/** A handle of a structure regenerated from a recipe: the generic handle, with its type's own reading of it. */
export interface RecipeGlobalHandle extends GlobalHandle {
  readonly group: string;
  readonly recipeHandle: RecipeHandle;
}

interface RecipeStructure {
  readonly type: RecipeGeneration;
  readonly owner: string;
  readonly recipe: unknown;
  readonly members: ConstructionRegionTopology[];
}

/** Every structure of the scene regenerated from a recipe, by the group its faces share. */
function structuresOf(scene: GlobalHandleScene): ReadonlyMap<string, RecipeStructure> {
  const structures = new Map<string, RecipeStructure>();
  for (const topology of scene.topologies) {
    const type = structureTypeFor(topology.surfaceType)?.recipe;
    const kept = type?.of(topology);
    if (!type || !kept) continue;
    const known = structures.get(kept.group);
    if (known) known.members.push(topology);
    else structures.set(kept.group, { type, owner: topology.surfaceType, recipe: kept.recipe, members: [topology] });
  }
  return structures;
}

/**
 * Global handles of structures regenerated whole from a recipe -- a roof:
 * the type places them and says what each does to the recipe, and every edit
 * replaces the structure's faces by the ones the new recipe makes, in one
 * patch replacement. A recipe left with nothing removes the structure.
 */
export const recipeHandleProvider: GlobalHandleProvider = {
  name: "recipe",
  handles(scene) {
    return [...structuresOf(scene)].flatMap(([group, structure]): RecipeGlobalHandle[] => {
      const points = structure.members.flatMap((member) => member.nodes.map((node) => node.position));
      const mean = (axis: "x" | "y" | "z") => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
      const pivot = { x: mean("x"), y: mean("y"), z: mean("z") };
      const nodeIds = [...new Set(structure.members.flatMap((member) => member.nodes.map((node) => node.id)))].sort();
      const faces = structure.members.map((member) => member.surfaceKey.join("\u0000"));
      return structure.type.handles(structure.members, structure.recipe).map((recipeHandle) => ({
        id: globalHandleId(recipeHandle.kind, `${group}:${recipeHandle.anchor}`),
        kind: recipeHandle.kind, position: recipeHandle.position, motion: recipeHandle.motion,
        ...(recipeHandle.facing ? { facing: recipeHandle.facing } : {}),
        pivot: recipeHandle.at ?? pivot, owner: structure.owner, provider: "recipe", nodeIds, faces, group, recipeHandle,
      }));
    });
  },
  plan(scene, generic, intent, port, operationId) {
    const handle = generic as RecipeGlobalHandle;
    const structure = structuresOf(scene).get(handle.group);
    if (!structure) throw new Error("A estrutura não está mais aqui.");
    const next = structure.type.edit(structure.recipe, handle.recipeHandle, intent);
    if (next === undefined) return undefined;
    const sourceSurfaceKeys = structure.members.map((member) => member.surfaceKey);
    // Removed whole: no face succeeds any, so what was pinned to them goes with them.
    if (next === null) return { kind: "replace", request: { operationId, sourceSurfaceKeys, patch: { nodes: [], edges: [], regions: [] } }, faceProps: new Map() };
    const { patch, faceProps } = structure.type.generate(port, next, operationId, scene.topologies);
    return { kind: "replace", request: { operationId, sourceSurfaceKeys, patch }, faceProps, ...settledOn(structure.type, next, patch, faceProps, handle.recipeHandle.anchor) };
  },
};

/** Where the handle named `anchor` stands on the structure `patch` makes of `next`: read by the type's own placing, as it would be once the edit lands. */
function settledOn(type: RecipeGeneration, next: unknown, patch: Parameters<typeof topologiesOfPatch>[0], faceProps: Parameters<typeof topologiesOfPatch>[1], anchor: string): { readonly settled?: { readonly position: GlobalHandle["position"]; readonly at: GlobalHandle["position"] } } {
  try {
    const members = topologiesOfPatch(patch, faceProps);
    if (members.length === 0) return {};
    const after = type.handles([...members], next).find((candidate) => candidate.anchor === anchor);
    return after ? { settled: { position: after.position, at: after.at ?? after.position } } : {};
  } catch {
    return {};
  }
}
