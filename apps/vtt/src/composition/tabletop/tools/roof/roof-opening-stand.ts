import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { dormerAt, dormerFrame, faceRings, insideRing, OPENING_DORMER_PITCH, openingPath, planeOf, pointAt, ROOF_FACE_PROP, ROOF_RECIPE_PROP, type RoofFaceRole, type RoofRecipe } from "../../../../features/edit-construction/index.ts";
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

const CURVE_SAMPLES = 12;
/** The longest straight step an opening's outline takes across a gabled front, whose local height bends under the ridge. */
const OUTLINE_STEP = 0.05;

/** A stand's waters: how steeply each rises from its left and right sides, zero a gable. */
interface Waters {
  readonly left: number;
  readonly right: number;
}
/** Two waters at the gentlest the law allows: what a stand starts with. */
const TWO_WATERS: Waters = { left: OPENING_DORMER_PITCH, right: OPENING_DORMER_PITCH };
const watersOf = (dormer: RoofDormer): Waters => ({ right: dormer.slopes[1], left: dormer.slopes[3] });

/** How high its waters stand above its eaves at `x` across a front `width` wide: the lower of the two, one alone where the other is a gable. */
function roofOver(waters: Waters, width: number, x: number): number {
  return Math.min(waters.left > 0 ? waters.left * x : Infinity, waters.right > 0 ? waters.right * (width - x) : Infinity);
}

/** `look`'s outline as points `[x, y]` across its box, `x` from its left side, `y` up from its sill. */
function outlinePoints(look: StandLook): [number, number][] {
  return openingPath(look.shape, look.width, look.height).flatMap((segment) => {
    const steps = segment.controls === undefined ? 1 : CURVE_SAMPLES;
    return Array.from({ length: steps }, (_, i) => pointAt(segment, i / steps) as [number, number]);
  });
}

/**
 * The waters over an opening of `look`: their eaves as low as lets them clear
 * every point of its outline -- at its top for a plain rectangle, touching the
 * curve of an arch or a round one -- and how high their ridge stands.
 */
function gableFor(look: StandLook, waters: Waters): { readonly eave: number; readonly ridge: number } {
  const eave = outlinePoints(look).reduce((low, [x, y]) => Math.max(low, y - roofOver(waters, look.width, x)), 0);
  const across = Array.from({ length: 33 }, (_, i) => roofOver(waters, look.width, (look.width * i) / 32));
  return { eave, ridge: eave + Math.max(...across) };
}
/** The generator's clearance between a dormer and its leaf's rim. */
const RIM = 0.01;
/** How far below the leaf a stopped opening's top stays, so it still meets the leaf. */
const STOP_SHORT = 0.005;

/**
 * The dormer for an opening of `look` whose front's middle stands at `at` on
 * leaf side `side`: as wide as the opening, `waters` over it -- its gabled
 * front holding whatever outline it has. Its slopes are its own, so a roof
 * made steeper or flatter leaves it and its opening as they stand.
 */
function standFor(recipe: RoofRecipe, side: number, at: Point, look: StandLook, waters: Waters = TWO_WATERS): RoofDormer {
  const { eave } = gableFor(look, waters);
  return { ...dormerAt(recipe, side, at, look.width, eave, 2), slopes: [0, waters.right, 0, waters.left], absolute: true, opening: true };
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
 * the leaf runs along its eave there, no taller than lets the ridge over it
 * meet the leaf behind. What a preview shows and what is committed;
 * `undefined` where not even the smallest opening fits.
 */
function fit(leaf: ConstructionRegionTopology, at: Point, look: StandLook, waters: Waters = TWO_WATERS): Placed | undefined {
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
  const room = Math.min(...[left, front, right].map((p) => heightAt([p[0] + n[0] * depth, p[1] + n[1] * depth]))) - base - STOP_SHORT;
  // Its ridge -- eaves and rise both growing with it -- no higher than the leaf reaches there.
  const width = s1 - s0;
  const ridge = (height: number) => gableFor({ ...look, width, height }, waters).ridge;
  let height = look.height;
  if (ridge(height) > room) {
    if (ridge(MIN_OPENING_SIZE) > room) return undefined;
    let [low, high] = [MIN_OPENING_SIZE, look.height];
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      if (ridge(middle) <= room) low = middle;
      else high = middle;
    }
    height = low;
  }
  return { at: { x: front[0], y: base, z: front[1] }, look: { ...look, width, height } };
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
  // It keeps the waters it was given: two, or one a user left it with.
  const waters = watersOf(was);
  const placed = leaf === undefined ? undefined : fit(leaf, at, look, waters);
  return placed === undefined ? undefined : { ...held, was, placed, waters };
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
  // The front's `v` is a share of its local height, which rises under the
  // gable: the outline is set down point by point at its true heights,
  // closely enough that no side of it bends, and through the ridge's line.
  const toFront = ([x, y]: readonly [number, number]): readonly [number, number] => {
    const t = Math.min(1, Math.max(0, x / panel.length));
    const u = panel.reversed ? 1 - t : t;
    return [u, y / panel.frame.heightAt(u)];
  };
  const dense: [number, number][] = [];
  const outline = outlinePoints({ ...look, width: panel.length });
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const cuts = [0, 1, ...((a[0] - panel.length / 2) * (b[0] - panel.length / 2) < 0 ? [(panel.length / 2 - a[0]) / (b[0] - a[0])] : [])];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / OUTLINE_STEP));
    for (let k = 0; k < steps; k++) cuts.push(k / steps);
    [...new Set(cuts)].sort((p, q) => p - q).filter((t) => t < 1).forEach((t) => dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
  });
  // Counter-clockwise in the front's own frame, whichever way it runs.
  const ring = (panel.reversed ? [...dense].reverse() : dense).map(toFront);
  const us = ring.map(([u]) => u), vs = ring.map(([, v]) => v);
  const piece = {
    panel,
    rect: { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) },
    path: ring.map((from, i) => ({ from, to: ring[(i + 1) % ring.length]! })),
  };
  const placed = commitOpeningGroup(ctx, causeId, [], [piece], look.shape);
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
    const next = standFor(recipe, was.side, [placed.at.x, placed.at.z], placed.look, made.waters);
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
