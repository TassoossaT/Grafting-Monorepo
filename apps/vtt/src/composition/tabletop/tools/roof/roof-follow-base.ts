import type { Reaction, ReactionOutcome } from "@/features/edit-construction";
import type { ApplyPatchReplacementRequest, ChangeOrigin, ConstructionPatchOutcome, ConstructionRegionTopology } from "@/ports";

import { carriedOnto, footprintsOf, hasTrait, ringsOf, roofGraphPatch, roofRecipeOf, surfaceKeyText, type RoofRecipe, type RoofSource } from "../../../../features/edit-construction/index.ts";
import type { RoofPort } from "../../../../ports/cap-port.ts";
import { keepFaceProps, pinnedToRoles, type FacePropsRuntime } from "../core/face-props.ts";
import { roofBaseOf } from "./roof-base.ts";

/** What following a base needs of the runtime, inside the pipeline's transaction. */
export interface FollowBaseRuntime extends FacePropsRuntime, Pick<RoofPort, "generateRoof"> {
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  applyPatchReplacement(request: ApplyPatchReplacementRequest, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome;
}

const DONE: ReactionOutcome = Object.freeze({ kind: "done" });

/** A roof's eave corners follow their supporting nodes, keeping its own rise. */
function followedAnchors(source: RoofSource, at: ReadonlyMap<string, ConstructionRegionTopology["nodes"][number]["position"]>): RoofSource | undefined {
  if (!source.anchors?.length) return undefined;
  const rings = ringsOf(source.footprints);
  const changed = source.anchors.some(({ ring, corner, nodeId }) => {
    const point = rings[ring]?.points[corner];
    const position = at.get(nodeId);
    return point && position && (Math.abs(point[0] - position.x) > 1e-6 || Math.abs(point[1] - position.z) > 1e-6 || Math.abs(source.elevation - position.y) > 1e-6);
  });
  if (!changed) return undefined;
  const footprints = footprintsOf(rings.map((ring, r) => ({ ...ring, points: ring.points.map((point, corner) => {
    const anchor = source.anchors!.find((candidate) => candidate.ring === r && candidate.corner === corner);
    const position = anchor ? at.get(anchor.nodeId) : undefined;
    return position ? [position.x, position.z] as const : point;
  }) })));
  const levels = source.anchors.map(({ nodeId }) => at.get(nodeId)?.y).filter((level): level is number => level !== undefined);
  const elevation = levels.length && levels.every((level) => Math.abs(level - levels[0]!) < 1e-4) ? levels[0]! : source.elevation;
  return { ...source, footprints, elevation };
}

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
    const faces = new Set(changed.map((face) => surfaceKeyText(face.surfaceKey)));
    const recipes = new Map<string, { readonly recipe: RoofRecipe; readonly baseChanged: boolean; readonly cutChanged: boolean; readonly anchorsChanged: boolean }>();
    const present = runtime.getAllRegionTopologies();
    const current = new Map(present.flatMap((face) => face.nodes).map((node) => [node.id, node.position] as const));
    // A moved support may carry roof vertices into the change itself. Such a
    // roof is excluded from the generic reaction's hit list when the first
    // changed face is also a roof, so inspect anchored dependants directly.
    const anchoredHits = present.filter((face) => {
      const recipe = roofRecipeOf(face);
      return (recipe?.anchors?.length ?? 0) > 0 || recipe?.subroofs?.some((child) => (child.anchors?.length ?? 0) > 0);
    });
    for (const hit of [...hits, ...anchoredHits]) {
      const recipe = roofRecipeOf(hit);
      if (!recipe) continue;
      const baseChanged = !!recipe.base && (faces.has(surfaceKeyText(recipe.base.surfaceKey)) || recipe.base.nodeIds.some((id) => nodes.has(id)));
      const cutChanged = changed.some((face) => hasTrait(face.surfaceType, "floor") && face.nodes.some((node) => node.position.y > recipe.elevation + 1e-4 && node.position.y <= recipe.elevation + recipe.height + 1e-4));
      const anchorsChanged = followedAnchors(recipe, current) !== undefined
        || (recipe.subroofs?.some((child) => followedAnchors(child, current) !== undefined) ?? false);
      if (baseChanged || cutChanged || anchorsChanged) recipes.set(recipe.group, { recipe, baseChanged, cutChanged, anchorsChanged });
    }
    for (const { recipe, baseChanged, cutChanged, anchorsChanged } of recipes.values()) {
      const topologies = runtime.getAllRegionTopologies();
      const base = baseChanged && recipe.base ? roofBaseOf(topologies, recipe.base) : undefined;
      const { group, ...source } = recipe;
      const was = ringsOf(recipe.footprints).map((ring) => ring.points);
      const at = new Map(topologies.flatMap((face) => face.nodes).map((node) => [node.id, node.position] as const));
      const followed = followedAnchors(recipe, at);
      const anchored = followed?.footprints;
      const anchorElevation = followed?.elevation;
      const subroofs = source.subroofs?.map((child) => followedAnchors(child, at) ?? child);
      const now = base ? ringsOf([base.footprint]).map((ring) => ring.points) : anchored ? ringsOf(anchored).map((ring) => ring.points) : was;
      const same = (a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-9 && Math.abs(p[1] - b[i]![1]) < 1e-9);
      if (!anchorsChanged && !cutChanged && (!base || Math.abs(base.elevation - recipe.elevation) < 1e-9) && was.length === now.length && was.every((ring, r) => same(ring, now[r]!))) continue;
      // Corner for corner, each side keeps its own slope; reshaped, by the sides it still lies along.
      const withChildren = { ...source, subroofs };
      const request: RoofSource = anchored && !base ? { ...withChildren, footprints: anchored, elevation: anchorElevation ?? recipe.elevation } : !base ? withChildren : was.length === now.length && was.every((ring, r) => ring.length === now[r]!.length)
        ? { ...withChildren, footprints: [base.footprint], elevation: base.elevation, base: base.ref }
        // Its subroofs as they already followed their own supports.
        : { ...withChildren, elevation: base.elevation, base: base.ref, ...carriedOnto([base.footprint], [recipe]), subroofs: withChildren.subroofs ?? [] };
      const own = topologies.filter((face) => (roofRecipeOf(face))?.group === group).map((face) => face.surfaceKey);
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
