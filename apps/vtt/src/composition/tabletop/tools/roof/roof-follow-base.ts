import type { Reaction, ReactionOutcome } from "@/features/edit-construction";
import type { ApplyPatchReplacementRequest, ChangeOrigin, ConstructionPatchOutcome, ConstructionRegionTopology } from "@/ports";

import { carriedOnto, ringsOf, ROOF_RECIPE_PROP, roofGraphPatch, type RoofRecipe, type RoofSource } from "../../../../features/edit-construction/index.ts";
import type { RoofPort } from "../../../../ports/cap-port.ts";
import { keepFaceProps, pinnedToRoles, type FacePropsRuntime } from "../core/face-props.ts";
import { roofBaseOf } from "./roof-base.ts";

/** What following a base needs of the runtime, inside the pipeline's transaction. */
export interface FollowBaseRuntime extends FacePropsRuntime, Pick<RoofPort, "generateRoof"> {
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  applyPatchReplacement(request: ApplyPatchReplacementRequest, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome;
}

const DONE: ReactionOutcome = Object.freeze({ kind: "done" });
const keyOf = (key: readonly string[]) => key.join("\u0000");

/**
 * The `"follow-base"` reaction: a roof standing on a floor or a room is made
 * again over it whenever that changes -- moved, widened, raised, a wall of
 * the room pushed out. Its sides keep their slopes, its dormers their
 * places, and what is pinned to it stays pinned. A roof whose base is gone
 * stays as it stood.
 */
export function followBaseReaction(): Reaction<FollowBaseRuntime> {
  return (runtime, effect, hits) => {
    const changed = [...effect.change.before, ...effect.change.after];
    const nodes = new Set(changed.flatMap((face) => face.nodes.map((node) => node.id)));
    const faces = new Set(changed.map((face) => keyOf(face.surfaceKey)));
    const recipes = new Map<string, RoofRecipe>();
    for (const hit of hits) {
      const recipe = hit.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
      if (recipe?.base && (faces.has(keyOf(recipe.base.surfaceKey)) || recipe.base.nodeIds.some((id) => nodes.has(id)))) recipes.set(recipe.group, recipe);
    }
    for (const recipe of recipes.values()) {
      const topologies = runtime.getAllRegionTopologies();
      const base = roofBaseOf(topologies, recipe.base!);
      if (!base) continue;
      const { group, ...source } = recipe;
      const was = ringsOf(recipe.footprints).map((ring) => ring.points);
      const now = ringsOf([base.footprint]).map((ring) => ring.points);
      const same = (a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-9 && Math.abs(p[1] - b[i]![1]) < 1e-9);
      if (Math.abs(base.elevation - recipe.elevation) < 1e-9 && was.length === now.length && was.every((ring, r) => same(ring, now[r]!))) continue;
      // Corner for corner, each side keeps its own slope; reshaped, by the sides it still lies along.
      const request: RoofSource = was.length === now.length && was.every((ring, r) => ring.length === now[r]!.length)
        ? { ...source, footprints: [base.footprint], elevation: base.elevation, base: base.ref }
        : { ...source, elevation: base.elevation, base: base.ref, ...carriedOnto([base.footprint], [recipe]) };
      const own = topologies.filter((face) => (face.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined)?.group === group).map((face) => face.surfaceKey);
      const operationId = `${effect.causeId}:follow:${group}`;
      let made: ReturnType<typeof roofGraphPatch>;
      try {
        made = roofGraphPatch(runtime, request, operationId, topologies);
      } catch {
        // A base the roof cannot be raised over as it now stands: the roof stays as it stood.
        continue;
      }
      const pinned = pinnedToRoles(topologies, own);
      const outcome = runtime.applyPatchReplacement({ operationId, sourceSurfaceKeys: own, patch: made.patch }, "local", effect.causeId);
      keepFaceProps(runtime, effect.causeId, outcome.createdSurfaceKeys, made.faceProps, pinned);
    }
    return DONE;
  };
}
