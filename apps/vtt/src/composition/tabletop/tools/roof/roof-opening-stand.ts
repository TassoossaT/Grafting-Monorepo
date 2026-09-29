import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { dormerAt, dormerFrame, faceRings, insideRing, openingPath, planeOf, pointAt, ROOF_FACE_PROP, ROOF_RECIPE_PROP, type RoofFaceRole, type RoofRecipe } from "../../../../features/edit-construction/index.ts";
import type { RoofDormer } from "../../../../ports/cap-port.ts";
import type { ToolContext } from "../core/tool-context.ts";
import { commitOpeningGroup, MIN_OPENING_SIZE, runFrame, type OpeningCommit } from "../openings/opening-shared.ts";
import type { OpeningStand, StandLook } from "../openings/opening-stand.ts";
import { replaceRoofs } from "./roof-tool.ts";

type Point = readonly [number, number];
type Placed = { readonly at: ConstructionPosition; readonly look: StandLook };

const recipeOf = (face: ConstructionRegionTopology | undefined) => face?.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
const roleOf = (face: ConstructionRegionTopology | undefined) => face?.props?.[ROOF_FACE_PROP] as RoofFaceRole | undefined;
const keyText = (key: ConstructionSurfaceKey) => key.join("\u0000");
const faceAt = (ctx: ToolContext, key: ConstructionSurfaceKey) => ctx.runtime.getAllRegionTopologies().find((face) => keyText(face.surfaceKey) === keyText(key));
const facesOf = (ctx: ToolContext, group: string) => ctx.runtime.getAllRegionTopologies().filter((face) => recipeOf(face)?.group === group).map((face) => face.surfaceKey);

/** No side pitched: the dormer's top is level with the opening's top, running back until the leaf rises past it. */
const LEVEL: RoofDormer["slopes"] = [0, 0, 0, 0];
const CURVE_SAMPLES = 12;
/** The generator's clearance between a dormer and its leaf's rim. */
const RIM = 0.01;
/** How far below the leaf a stopped opening's top stays, so it still meets the leaf. */
const STOP_SHORT = 0.005;

/** The dormer for an opening of `look` whose front's middle stands at `at` on leaf side `side`: its front is the opening's box, all of it. */
function standFor(recipe: RoofRecipe, side: number, at: Point, look: StandLook): RoofDormer {
  return { ...dormerAt(recipe, side, at, look.width, look.height, 1), slopes: LEVEL, opening: true };
}

/** How far from `o` along `d` the ring `ring` is first met; infinite when never. */
function reach(ring: readonly Point[], o: Point, d: Point): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const e = [b[0] - a[0], b[1] - a[1]] as const;
    const det = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(det) < 1e-12) continue;
    const w = [a[0] - o[0], a[1] - o[1]] as const;
    const t = (w[0] * e[1] - w[1] * e[0]) / det;
    const s = (w[0] * d[1] - w[1] * d[0]) / det;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/**
 * `look` at `at` on `leaf`, stopped where the leaf stops it: no wider than
 * the leaf runs along its eave there, no taller than the leaf rises behind
 * it -- its level top has to meet the leaf. What a preview shows and what is
 * committed; `undefined` where not even the smallest opening fits.
 */
function fit(leaf: ConstructionRegionTopology, at: Point, look: StandLook): Placed | undefined {
  const recipe = recipeOf(leaf), role = roleOf(leaf);
  const ring3 = faceRings(leaf)[0] ?? [];
  const plane = planeOf(ring3);
  if (!recipe || !role || !plane || Math.abs(plane.normal.y) < 1e-9) return undefined;
  const { normal: nn, centre: c } = plane;
  const heightAt = (p: Point) => c.y - (nn.x * (p[0] - c.x) + nn.z * (p[1] - c.z)) / nn.y;
  const ring = ring3.map((p) => [p.x, p.z] as const);
  const { u, n } = dormerFrame(recipe, standFor(recipe, role.side, at, look));
  const along = (s: number): Point => [at[0] + u[0] * s, at[1] + u[1] * s];
  const s0 = Math.max(-look.width / 2, -(reach(ring, at, [-u[0], -u[1]]) - 2 * RIM));
  const s1 = Math.min(look.width / 2, reach(ring, at, u) - 2 * RIM);
  if (!(s1 - s0 >= MIN_OPENING_SIZE)) return undefined;
  const front = along((s0 + s1) / 2);
  const base = heightAt(front);
  // As deep as the generator makes it: the leaf's nearest rim behind its
  // front corners and middle, less two clearances -- where its top has to
  // have met the leaf already.
  const [left, right] = [along(s0), along(s1)];
  const depth = Math.min(...[left, front, right].map((p) => reach(ring, p, n))) - 2 * RIM;
  if (!(depth > 0) || !Number.isFinite(depth)) return undefined;
  const tops = [left, right].map((p) => heightAt([p[0] + n[0] * depth, p[1] + n[1] * depth]));
  const height = Math.min(look.height, Math.min(...tops) - base - STOP_SHORT);
  if (!(height >= MIN_OPENING_SIZE)) return undefined;
  return { at: { x: front[0], y: base, z: front[1] }, look: { ...look, width: s1 - s0, height } };
}

/** The dormer raised for an opening whose front is `host`, and the roof it stands on. */
function heldBy(ctx: ToolContext, host: ConstructionSurfaceKey): { readonly recipe: RoofRecipe; readonly k: number } | undefined {
  const face = faceAt(ctx, host);
  const recipe = recipeOf(face), role = roleOf(face);
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
    const role = roleOf(face);
    return recipeOf(face)?.group === recipe.group && role !== undefined && !role.upright && role.dormer === undefined && role.subroof === undefined && role.side === was.side;
  });
  const leaf = leaves.find((face) => insideRing(faceRings(face)[0] ?? [], { x: at[0], z: at[1] })) ?? leaves[0];
  const placed = leaf === undefined ? undefined : fit(leaf, at, look);
  return placed === undefined ? undefined : { ...held, was, placed };
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

/** An opening's outline standing upright at `placed`, its front along `u`. */
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
 * by transition walls: the opening's box is cut back into the leaf, its top
 * level, its cheeks upright, until the leaf rises past it. The opening fills
 * that front whole, stopped wherever the leaf stops it. The roof keeps this
 * as a dormer in its recipe, marked as the opening's, so the opening pinned
 * to its front is carried whenever the roof is made again.
 */
export const roofOpeningStand: OpeningStand = {
  raisesOn(face) {
    const recipe = recipeOf(face), role = roleOf(face);
    return !!recipe && !!role && !role.upright && role.dormer === undefined && role.subroof === undefined && (recipe.slopes[role.side] ?? 0) > 0;
  },

  fitted(face, at, look) {
    return fit(face, [at.x, at.z], look);
  },

  drawn(face, from, to, shape, isDoor) {
    const recipe = recipeOf(face), role = roleOf(face);
    const plane = planeOf(faceRings(face)[0] ?? []);
    if (!recipe || !role || !plane || Math.abs(plane.normal.y) < 1e-9) return undefined;
    const { normal: n, centre: c } = plane;
    const leafAt = (p: ConstructionPosition) => ({ ...p, y: c.y - (n.x * (p.x - c.x) + n.z * (p.z - c.z)) / n.y });
    const [a, b] = [leafAt(from), leafAt(to)];
    // The lower corner stands the front; the upper is where the level top meets the leaf.
    const [low, high] = a.y <= b.y ? [a, b] : [b, a];
    const { u } = dormerFrame(recipe, standFor(recipe, role.side, [low.x, low.z], { width: 1, height: 1, shape, isDoor }));
    const along = (high.x - low.x) * u[0] + (high.z - low.z) * u[1];
    return fit(face, [low.x + (u[0] * along) / 2, low.z + (u[1] * along) / 2], { width: Math.abs(along), height: high.y - low.y, shape, isDoor });
  },

  outline(face, placed) {
    const recipe = recipeOf(face), role = roleOf(face);
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
    const recipe = recipeOf(face)!, role = roleOf(face)!;
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
    const next = standFor(recipe, was.side, [placed.at.x, placed.at.z], placed.look);
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
