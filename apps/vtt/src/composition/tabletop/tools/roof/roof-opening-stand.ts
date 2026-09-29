import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import {
  DORMER_RIM, dormerAt, dormerFrame, faceRings, heightOnPlane, insideRing, OPENING_DORMER_PITCH, openingPath, planeOf, pointAt, rayToRing,
  roofRecipeOf, roofRoleOf, surfaceKeyText, type RoofRecipe,
} from "../../../../features/edit-construction/index.ts";
import type { RoofDormer } from "../../../../ports/cap-port.ts";
import type { ToolContext } from "../core/tool-context.ts";
import { commitOpeningGroup, MIN_OPENING_SIZE, runFrame, type OpeningCommit } from "../openings/opening-shared.ts";
import type { OpeningStand, StandLook } from "../openings/opening-stand.ts";
import { replaceRoofs } from "./roof-commit.ts";

type Point = readonly [number, number];
type Placed = { readonly at: ConstructionPosition; readonly look: StandLook };

const faceAt = (ctx: ToolContext, key: ConstructionSurfaceKey) => ctx.runtime.getAllRegionTopologies().find((face) => surfaceKeyText(face.surfaceKey) === surfaceKeyText(key));
const facesOf = (ctx: ToolContext, group: string) => ctx.runtime.getAllRegionTopologies().filter((face) => roofRecipeOf(face)?.group === group).map((face) => face.surfaceKey);

/** Points each curved piece of a ghost outline is drawn by. */
const CURVE_SAMPLES = 12;
/** How far below the leaf a stopped opening's top stays, so it still meets the leaf. */
const STOP_SHORT = 0.005;

/** A stand's waters: how steeply each rises from its left and right sides, zero a gable. */
interface Waters {
  readonly left: number;
  readonly right: number;
}
/** What a stand starts with: two waters at a right angle's pitch. */
const TWO_WATERS: Waters = { left: OPENING_DORMER_PITCH, right: OPENING_DORMER_PITCH };
const watersOf = (dormer: RoofDormer): Waters => ({ right: dormer.slopes[1], left: dormer.slopes[3] });

/** How high `waters` stand above their eaves at `x` across a front `width` wide: the lower of the two, one alone where the other is a gable. */
function roofOver(waters: Waters, width: number, x: number): number {
  return Math.min(waters.left > 0 ? waters.left * x : Infinity, waters.right > 0 ? waters.right * (width - x) : Infinity);
}

/** How high `waters` rise over their eaves across a front `width` wide, at their ridge. */
function riseOf(waters: Waters, width: number): number {
  const rise = Math.max(...Array.from({ length: 33 }, (_, i) => roofOver(waters, width, (width * i) / 32)));
  return Number.isFinite(rise) ? rise : 0;
}

/**
 * The dormer for an opening of `look` whose front's middle stands at `at` on
 * leaf side `side`: its front a plain wall exactly the opening's size, which
 * the opening fills; `waters` over it, their gable a face apart. Its slopes
 * are its own, so a roof made steeper or flatter leaves it and its opening
 * as they stand.
 */
function standFor(recipe: RoofRecipe, side: number, at: Point, look: StandLook, waters: Waters = TWO_WATERS): RoofDormer {
  return { ...dormerAt(recipe, side, at, look.width, look.height, 2), slopes: [0, waters.right, 0, waters.left], absolute: true, gableApart: true, opening: true };
}

/**
 * `look` at `at` on `leaf`, stopped where the leaf stops it: no wider than
 * the leaf runs along its eave there, no taller than lets the ridge of
 * `waters` over it meet the leaf behind. What a preview shows and what is
 * committed; `undefined` where not even the smallest opening fits.
 */
function fit(leaf: ConstructionRegionTopology, at: Point, look: StandLook, waters: Waters = TWO_WATERS): Placed | undefined {
  const recipe = roofRecipeOf(leaf), role = roofRoleOf(leaf);
  const ring3 = faceRings(leaf)[0] ?? [];
  const plane = planeOf(ring3);
  if (!recipe || !role || !plane || heightOnPlane(plane, { x: at[0], z: at[1] }) === undefined) return undefined;
  const heightAt = (p: Point) => heightOnPlane(plane, { x: p[0], z: p[1] })!;
  const ring = ring3.map((p) => [p.x, p.z] as const);
  const { u, n } = dormerFrame(recipe, standFor(recipe, role.side, at, look));
  const along = (s: number): Point => [at[0] + u[0] * s, at[1] + u[1] * s];
  const s0 = Math.max(-look.width / 2, -(rayToRing(ring, at, [-u[0], -u[1]]) - DORMER_RIM));
  const s1 = Math.min(look.width / 2, rayToRing(ring, at, u) - DORMER_RIM);
  if (!(s1 - s0 >= MIN_OPENING_SIZE)) return undefined;
  const front = along((s0 + s1) / 2);
  const base = heightAt(front);
  // As deep as the generator makes it: the leaf's nearest rim behind its
  // front corners and middle, less two clearances -- where its ridge has to
  // have met the leaf already.
  const [left, right] = [along(s0), along(s1)];
  const depth = Math.min(...[left, front, right].map((p) => rayToRing(ring, p, n))) - DORMER_RIM;
  if (!(depth > 0) || !Number.isFinite(depth)) return undefined;
  const room = Math.min(...[left, front, right].map((p) => heightAt([p[0] + n[0] * depth, p[1] + n[1] * depth]))) - base - STOP_SHORT;
  const width = s1 - s0;
  const height = Math.min(look.height, room - riseOf(waters, width));
  if (!(height >= MIN_OPENING_SIZE)) return undefined;
  return { at: { x: front[0], y: base, z: front[1] }, look: { ...look, width, height } };
}

/** The dormer raised for an opening whose front is `host`, and the roof it stands on. */
function heldBy(ctx: ToolContext, host: ConstructionSurfaceKey): { readonly recipe: RoofRecipe; readonly k: number } | undefined {
  const face = faceAt(ctx, host);
  const recipe = roofRecipeOf(face), role = roofRoleOf(face);
  if (!recipe || !role || role.dormer === undefined || role.subroof !== undefined) return undefined;
  return recipe.dormers?.[role.dormer]?.opening ? { recipe, k: role.dormer } : undefined;
}

/** Where the opening at `host`, now `look` and moved by `shift`, stands once stopped by its leaf -- and what holds it. */
function refitted(ctx: ToolContext, host: ConstructionSurfaceKey, look: StandLook, shift: { readonly x: number; readonly z: number }) {
  const held = heldBy(ctx, host);
  if (held === undefined) return undefined;
  const { recipe, k } = held;
  const was = recipe.dormers![k]!;
  const { front } = dormerFrame(recipe, was);
  const at: Point = [front[0] + shift.x, front[1] + shift.z];
  // The leaf it stands on: a main leaf of its side whose outline -- its own
  // cut is a hole in it -- holds where its front now stands.
  const leaves = ctx.runtime.getAllRegionTopologies().filter((face) => {
    const role = roofRoleOf(face);
    return roofRecipeOf(face)?.group === recipe.group && role !== undefined && !role.upright && role.dormer === undefined && role.subroof === undefined && role.side === was.side;
  });
  const leaf = leaves.find((face) => insideRing(faceRings(face)[0] ?? [], { x: at[0], z: at[1] })) ?? leaves[0];
  // It keeps the waters it was given: two, or one a user left it with.
  const waters = watersOf(was);
  const placed = leaf === undefined ? undefined : fit(leaf, at, look, waters);
  return placed === undefined ? undefined : { ...held, was, placed, waters };
}

/**
 * The opening filling dormer `k`'s front whole -- on the roof just made as
 * `group` -- placed as any opening is placed in any wall: the front is all
 * opening, its outline laid over the front's own shape.
 */
function placeInFront(ctx: ToolContext, causeId: string, group: string, k: number, look: StandLook): OpeningCommit {
  const front = ctx.runtime.getAllRegionTopologies().find((face) => {
    const role = roofRoleOf(face);
    return roofRecipeOf(face)?.group === group && role?.subroof === undefined && role?.dormer === k && role.upright && role.side === 0;
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

/** `work` as one transaction, its failure the commit's error. */
function inOne(ctx: ToolContext, causeId: string, work: () => OpeningCommit): OpeningCommit {
  try {
    let result: OpeningCommit = { recorded: false };
    const { recorded } = ctx.runtime.transact(causeId, "local", () => {
      result = work();
    });
    return { ...result, recorded };
  } catch (error) {
    return { recorded: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The roof `recipe` with its dormers `dormers`, as a request. */
function withDormers(recipe: RoofRecipe, dormers: readonly RoofDormer[]) {
  const { group: _group, ...source } = recipe;
  return { ...source, dormers };
}

/** The outline an opening `placed` stands on: the tool's own outline, upright, its front along `u`. */
function outlineAt(placed: Placed, u: Point): readonly ConstructionPosition[] {
  const { at, look } = placed;
  return openingPath(look.shape, look.width, look.height).flatMap((segment) => {
    const steps = segment.controls === undefined ? 1 : CURVE_SAMPLES;
    return Array.from({ length: steps }, (_, i) => {
      const [x, y] = pointAt(segment, i / steps);
      return { x: at.x + u[0] * (x - look.width / 2), y: at.y + y, z: at.z + u[1] * (x - look.width / 2) };
    });
  });
}

/**
 * A roof leaf holds an opening upright, the way a floor inside a roof is met
 * by transition walls: a dormer is cut back into the leaf, its front a plain
 * wall the opening's size which the opening fills, as any opening fills a
 * wall -- its outline the tool's own -- two waters over it, or one as its
 * user makes it, their gable a wall apart. The roof keeps it as a dormer in its recipe,
 * marked as the opening's, so the opening pinned to its front is carried
 * whenever the roof is made again.
 */
export const roofOpeningStand: OpeningStand = {
  raisesOn(face) {
    const recipe = roofRecipeOf(face), role = roofRoleOf(face);
    return !!recipe && !!role && !role.upright && role.dormer === undefined && role.subroof === undefined && (recipe.slopes[role.side] ?? 0) > 0;
  },

  fitted(face, at, look) {
    return fit(face, [at.x, at.z], look);
  },

  drawn(face, from, to, shape, isDoor) {
    const recipe = roofRecipeOf(face), role = roofRoleOf(face);
    const plane = planeOf(faceRings(face)[0] ?? []);
    if (!recipe || !role || !plane || heightOnPlane(plane, from) === undefined) return undefined;
    const leafAt = (p: ConstructionPosition) => ({ ...p, y: heightOnPlane(plane, p)! });
    const [a, b] = [leafAt(from), leafAt(to)];
    // The lower corner stands the front; the upper is where its ridge meets the leaf.
    const [low, high] = a.y <= b.y ? [a, b] : [b, a];
    const { u } = dormerFrame(recipe, standFor(recipe, role.side, [low.x, low.z], { width: 1, height: 1, shape, isDoor }));
    const along = (high.x - low.x) * u[0] + (high.z - low.z) * u[1];
    return fit(face, [low.x + (u[0] * along) / 2, low.z + (u[1] * along) / 2], { width: Math.abs(along), height: high.y - low.y, shape, isDoor });
  },

  outline(face, placed) {
    const recipe = roofRecipeOf(face), role = roofRoleOf(face);
    if (!recipe || !role) return undefined;
    const { u } = dormerFrame(recipe, standFor(recipe, role.side, [placed.at.x, placed.at.z], placed.look));
    return outlineAt(placed, u);
  },

  refitOutline(ctx, host, look, shift) {
    const made = refitted(ctx, host, look, shift);
    if (made === undefined) return undefined;
    const { u } = dormerFrame(made.recipe, made.was);
    return outlineAt(made.placed, u);
  },

  raise(ctx, causeId, face, placed) {
    const recipe = roofRecipeOf(face)!, role = roofRoleOf(face)!;
    const dormers = recipe.dormers ?? [];
    return inOne(ctx, causeId, () => {
      const made = replaceRoofs(ctx, [withDormers(recipe, [...dormers, standFor(recipe, role.side, [placed.at.x, placed.at.z], placed.look)])], facesOf(ctx, recipe.group), causeId);
      return placeInFront(ctx, causeId, made.group, dormers.length, placed.look);
    });
  },

  holds(ctx, host) {
    return heldBy(ctx, host) !== undefined;
  },

  refit(ctx, causeId, pieces, host, look, shift) {
    const made = refitted(ctx, host, look, shift);
    // Stopped short of any room at all: the opening stays as it stood.
    if (made === undefined) return { recorded: false };
    const { recipe, k, was, placed } = made;
    const next = { ...standFor(recipe, was.side, [placed.at.x, placed.at.z], placed.look, made.waters), ...(was.id ? { id: was.id } : {}) };
    return inOne(ctx, causeId, () => {
      // The opening goes first, so nothing of it is carried onto the new front.
      const removed = commitOpeningGroup(ctx, causeId, pieces, []);
      if (removed.error !== undefined) throw new Error(removed.error);
      const regenerated = replaceRoofs(ctx, [withDormers(recipe, recipe.dormers!.map((dormer, i) => (i === k ? next : dormer)))], facesOf(ctx, recipe.group), causeId);
      return placeInFront(ctx, causeId, regenerated.group, k, placed.look);
    });
  },

  drop(ctx, causeId, pieces, host) {
    const held = heldBy(ctx, host);
    if (held === undefined) return { recorded: false, error: "esta abertura nao esta numa lucarna do telhado." };
    const { recipe, k } = held;
    return inOne(ctx, causeId, () => {
      const removed = commitOpeningGroup(ctx, causeId, pieces, []);
      if (removed.error !== undefined) throw new Error(removed.error);
      replaceRoofs(ctx, [withDormers(recipe, recipe.dormers!.filter((_, i) => i !== k))], facesOf(ctx, recipe.group), causeId);
      return { recorded: false };
    });
  },
};
