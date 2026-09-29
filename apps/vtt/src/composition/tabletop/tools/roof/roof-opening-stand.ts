import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { dormerAt, dormerFrame, openingPath, pointAt, ROOF_FACE_PROP, ROOF_RECIPE_PROP, type RoofFaceRole, type RoofRecipe } from "../../../../features/edit-construction/index.ts";
import type { RoofDormer } from "../../../../ports/cap-port.ts";
import type { ToolContext } from "../core/tool-context.ts";
import { commitOpeningGroup, runFrame, type OpeningCommit } from "../openings/opening-shared.ts";
import type { OpeningStand, StandLook } from "../openings/opening-stand.ts";
import { replaceRoofs } from "./roof-tool.ts";

const recipeOf = (face: ConstructionRegionTopology | undefined) => face?.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
const roleOf = (face: ConstructionRegionTopology | undefined) => face?.props?.[ROOF_FACE_PROP] as RoofFaceRole | undefined;
const keyText = (key: ConstructionSurfaceKey) => key.join("\u0000");
const faceAt = (ctx: ToolContext, key: ConstructionSurfaceKey) => ctx.runtime.getAllRegionTopologies().find((face) => keyText(face.surfaceKey) === keyText(key));
const facesOf = (ctx: ToolContext, group: string) => ctx.runtime.getAllRegionTopologies().filter((face) => recipeOf(face)?.group === group).map((face) => face.surfaceKey);

/** No side pitched: the dormer's top is level with the opening's top, running back until the leaf rises past it. */
const LEVEL: RoofDormer["slopes"] = [0, 0, 0, 0];
const CURVE_SAMPLES = 12;

/** The dormer for an opening of `look` whose front's middle stands at `at` on leaf side `side`: its front is the opening's box, all of it. */
function standFor(recipe: RoofRecipe, side: number, at: readonly [number, number], look: StandLook): RoofDormer {
  return { ...dormerAt(recipe, side, at, look.width, look.height, 1), slopes: LEVEL, opening: true };
}

/** The dormer raised for an opening whose front is `host`, and the roof it stands on. */
function heldBy(ctx: ToolContext, host: ConstructionSurfaceKey): { readonly recipe: RoofRecipe; readonly k: number } | undefined {
  const face = faceAt(ctx, host);
  const recipe = recipeOf(face), role = roleOf(face);
  if (!recipe || !role || role.dormer === undefined || role.subroof !== undefined) return undefined;
  return recipe.dormers?.[role.dormer]?.opening ? { recipe, k: role.dormer } : undefined;
}

/** The opening of `look` filling dormer `k`'s front whole -- on the roof just made as `group`. */
function placeInFront(ctx: ToolContext, causeId: string, group: string, k: number, look: StandLook): OpeningCommit {
  const front = ctx.runtime.getAllRegionTopologies().find((face) => {
    const role = roleOf(face);
    return recipeOf(face)?.group === group && role?.subroof === undefined && role?.dormer === k && role.upright && role.side === 0;
  });
  const run = front === undefined ? undefined : runFrame(ctx.runtime, front.surfaceKey);
  const panel = front === undefined ? undefined : run?.panelOf(front.surfaceKey);
  if (run === undefined || panel === undefined) throw new Error("a lucarna para a abertura nao ficou de pe aqui.");
  const pieces = run.pieces({ s0: panel.offset, s1: panel.offset + panel.length, v0: 0, v1: 1 }, look.shape);
  if (pieces === undefined || pieces.length === 0) throw new Error("a abertura nao cabe aqui.");
  const placed = commitOpeningGroup(ctx, causeId, [], pieces, look.shape);
  if (placed.error !== undefined) throw new Error(placed.error);
  return placed;
}

/** What the generator's refusals mean to whoever placed the opening. */
function said(message: string): string {
  if (/higher than the roof/.test(message)) return "a abertura nao pode passar da altura do telhado atras dela.";
  if (/stand on its leaf/.test(message)) return "a abertura nao cabe nessa agua do telhado.";
  return message;
}

/** `work` as one transaction, its failure the commit's error. */
function inOne(ctx: ToolContext, causeId: string, work: () => OpeningCommit): OpeningCommit {
  try {
    let result: OpeningCommit = { recorded: false };
    const { recorded } = ctx.runtime.transact(causeId, "local", () => {
      result = work();
    });
    return { ...result, recorded };
  } catch (error) {
    return { recorded: false, error: said(error instanceof Error ? error.message : String(error)) };
  }
}

/** The roof `recipe` with its dormers `dormers`, as a request. */
function withDormers(recipe: RoofRecipe, dormers: readonly RoofDormer[]) {
  const { group: _group, ...source } = recipe;
  return { ...source, dormers };
}

/**
 * A roof leaf holds an opening upright, the way a floor inside a roof is met
 * by transition walls: the opening's box is cut back into the leaf, its top
 * level, its cheeks upright, until the leaf rises past it. The opening fills
 * that front whole. The roof keeps this as a dormer in its recipe, marked as
 * the opening's, so the opening pinned to its front is carried whenever the
 * roof is made again.
 */
export const roofOpeningStand: OpeningStand = {
  raisesOn(face) {
    const recipe = recipeOf(face), role = roleOf(face);
    return !!recipe && !!role && !role.upright && role.dormer === undefined && role.subroof === undefined && (recipe.slopes[role.side] ?? 0) > 0;
  },

  outline(face, at, look) {
    const recipe = recipeOf(face), role = roleOf(face);
    if (!recipe || !role) return undefined;
    const { u } = dormerFrame(recipe, standFor(recipe, role.side, [at.x, at.z], look));
    return openingPath(look.shape, look.width, look.height).flatMap((segment) => Array.from({ length: segment.controls === undefined ? 1 : CURVE_SAMPLES }, (_, i) => {
      const [x, y] = pointAt(segment, i / (segment.controls === undefined ? 1 : CURVE_SAMPLES));
      return { x: at.x + u[0] * (x - look.width / 2), y: at.y + y, z: at.z + u[1] * (x - look.width / 2) };
    }));
  },

  raise(ctx, causeId, face, at, look) {
    const recipe = recipeOf(face)!, role = roleOf(face)!;
    const dormers = recipe.dormers ?? [];
    return inOne(ctx, causeId, () => {
      const made = replaceRoofs(ctx, [withDormers(recipe, [...dormers, standFor(recipe, role.side, [at.x, at.z], look)])], facesOf(ctx, recipe.group), causeId);
      return placeInFront(ctx, causeId, made.group, dormers.length, look);
    });
  },

  holds(ctx, host) {
    return heldBy(ctx, host) !== undefined;
  },

  refit(ctx, causeId, pieces, host, look, shift) {
    const held = heldBy(ctx, host);
    if (held === undefined) return { recorded: false, error: "esta abertura nao esta numa lucarna do telhado." };
    const { recipe, k } = held;
    const dormers = recipe.dormers!;
    const was = dormers[k]!;
    const { front } = dormerFrame(recipe, was);
    const next = standFor(recipe, was.side, [front[0] + shift.x, front[1] + shift.z], look);
    return inOne(ctx, causeId, () => {
      // The opening goes first, so nothing of it is carried onto the new front.
      const removed = commitOpeningGroup(ctx, causeId, pieces, []);
      if (removed.error !== undefined) throw new Error(removed.error);
      const made = replaceRoofs(ctx, [withDormers(recipe, dormers.map((dormer, i) => (i === k ? next : dormer)))], facesOf(ctx, recipe.group), causeId);
      return placeInFront(ctx, causeId, made.group, k, look);
    });
  },

  drop(ctx, causeId, pieces, host) {
    const held = heldBy(ctx, host);
    if (held === undefined) return { recorded: false, error: "esta abertura nao esta numa lucarna do telhado." };
    const { recipe, k } = held;
    // Every later dormer moves down one place: what is pinned to its faces follows.
    const renamed = (role: string) => {
      const [subroof, dormer, ...rest] = role.split(":");
      return subroof === "-" && dormer !== "-" && Number(dormer) > k ? [subroof, String(Number(dormer) - 1), ...rest].join(":") : role;
    };
    return inOne(ctx, causeId, () => {
      const removed = commitOpeningGroup(ctx, causeId, pieces, []);
      if (removed.error !== undefined) throw new Error(removed.error);
      replaceRoofs(ctx, [withDormers(recipe, recipe.dormers!.filter((_, i) => i !== k))], facesOf(ctx, recipe.group), causeId, renamed);
      return { recorded: false };
    });
  },
};
