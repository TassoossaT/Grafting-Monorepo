import type { ConstructionRegionTopology } from "@/ports";
import type { RoofDormer, RoofFootprint, RoofRequest } from "../../../../ports/cap-port.ts";

/** Region property carrying a roof's recipe, which every edit regenerates the roof from. */
export const ROOF_RECIPE_PROP = "roof";
/** Region property naming which side a roof face rises from. */
export const ROOF_FACE_PROP = "roofFace";

/**
 * What a roof stands on, found again as it now stands: a floor, or the room a
 * wall loop closes -- by a face of it, and the nodes of its outline, which
 * outlive the face being replaced.
 */
export interface RoofBaseRef {
  readonly kind: "floor" | "walls";
  readonly surfaceKey: readonly string[];
  readonly nodeIds: readonly string[];
  /** Height above a floor when a wall on its rim supports the roof. */
  readonly offset?: number;
}

/** A roof's request, and the base it follows when it stands on one. */
export interface RoofSource extends RoofRequest {
  readonly base?: RoofBaseRef;
  /** Eave corners that follow the top nodes of their supporting walls. */
  readonly anchors?: readonly { readonly ring: number; readonly corner: number; readonly nodeId: string }[];
  readonly subroofs?: readonly RoofSource[];
}

/** A roof's recipe: what the generator is asked, the base it follows, and the group of faces it made. */
export interface RoofRecipe extends RoofSource {
  readonly group: string;
}

/**
 * Which footprint side a face rises from -- one past the last for a flat
 * top -- or, on a dormer, which of its sides: front, right, back, left, or
 * four where it meets its leaf; and whether it is an upright face under it.
 */
export interface RoofFaceRole {
  readonly side: number;
  readonly dormer?: number;
  readonly subroof?: number;
  readonly upright: boolean;
}

export type Point = readonly [number, number];
export type Waters = 1 | 2 | 4;

/** How far inside its side's ends a dormer has to stand: twice the generator's clearance from its leaf's rim. */
export const DORMER_RIM = 0.02;

/** One ring of a roof's footprints: an outline, or a hole through it. */
export interface RoofRing {
  readonly points: readonly Point[];
  readonly hole: boolean;
  readonly footprint: number;
}

/** Every ring of a roof, footprint by footprint: its outline, then its holes -- the order its sides are numbered in. */
export const ringsOf = (footprints: readonly RoofFootprint[]): readonly RoofRing[] => footprints.flatMap((footprint, f) => [
  { points: footprint.outer, hole: false, footprint: f },
  ...footprint.holes.map((points) => ({ points, hole: true, footprint: f })),
]);

/** Rings back into footprints. */
export function footprintsOf(rings: readonly RoofRing[]): RoofFootprint[] {
  const footprints: { outer: readonly Point[]; holes: (readonly Point[])[] }[] = [];
  for (const ring of rings) {
    if (!ring.hole) footprints[ring.footprint] = { outer: ring.points, holes: [] };
    else footprints[ring.footprint]!.holes.push(ring.points);
  }
  return footprints.filter(Boolean);
}

/** Where side `side` -- numbered through every ring in turn -- lies: its ring, its index there, and its ends. */
export function sideOf(footprints: readonly RoofFootprint[], side: number): { readonly ring: number; readonly index: number; readonly a: Point; readonly c: Point } {
  let first = 0;
  const rings = ringsOf(footprints);
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!.points;
    if (side < first + ring.length) {
      const index = side - first;
      return { ring: r, index, a: ring[index]!, c: ring[(index + 1) % ring.length]! };
    }
    first += ring.length;
  }
  throw new Error("O telhado não tem esse lado.");
}

/** The number of side `index` of ring `ring`. */
export function sideNumber(footprints: readonly RoofFootprint[], ring: number, index: number): number {
  return ringsOf(footprints).slice(0, ring).reduce((sum, r) => sum + r.points.length, 0) + index;
}

/** Each side's normal into the roof: off the outline inward, off a hole away from it. */
export function inwardNormals(ring: readonly Point[], hole: boolean): Point[] {
  const signed = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const winding = Math.sign(signed) * (hole ? -1 : 1);
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(-(b[1] - a[1]) * winding) / length, ((b[0] - a[0]) * winding) / length];
  });
}

/** A dormer's sides, by waters: two pitch its cheeks, one its front alone -- shallower, so it runs back into the leaf -- four all but its back. */
export function dormerSlopes(waters: Waters): readonly [number, number, number, number] {
  return waters === 2 ? [0, 1, 0, 1] : waters === 1 ? [0.5, 0, 0, 0] : [1, 1, 0, 1];
}

/**
 * Which sides of an outline rise, for a number of waters: every side; the
 * longest side and the one facing it most squarely; or the longest alone.
 * The rest are gables.
 */
export function presetSlopes(contour: readonly Point[], waters: Waters): number[] {
  const sides = contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { length, direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const };
  });
  if (waters === 4) return sides.map(() => 1);
  const longest = sides.reduce((best, side, i) => (side.length > sides[best]!.length ? i : best), 0);
  const along = (i: number) => sides[i]!.direction[0] * sides[longest]!.direction[0] + sides[i]!.direction[1] * sides[longest]!.direction[1];
  const facing = waters === 2
    ? sides.reduce((best, _, i) => (i !== longest && along(i) < along(best) ? i : best), longest === 0 ? 1 : 0)
    : longest;
  return sides.map((_, i) => (i === longest || i === facing ? 1 : 0));
}

/** A roof over `footprints`, each outline shaped by a number of waters; round a hole it always falls toward it. */
export function roofOver(footprints: readonly RoofFootprint[], elevation: number, height: number, waters: Waters): RoofRequest {
  return { elevation, height, footprints, slopes: ringsOf(footprints).flatMap((ring) => (ring.hole ? ring.points.map(() => 1) : presetSlopes(ring.points, waters))) };
}

/** Whether segments `a`-`b` and `c`-`d` lie on one line and share a stretch of it. */
function sameLine(a: Point, b: Point, c: Point, d: Point): boolean {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-9) return false;
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  const off = (p: Point) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]);
  if (off(c) > 1e-4 || off(d) > 1e-4) return false;
  const along = (p: Point) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
  const [lo, hi] = [Math.min(along(c), along(d)), Math.max(along(c), along(d))];
  return Math.min(hi, length) - Math.max(lo, 0) > 1e-4;
}

/**
 * New footprints that take over from `sources`: each side keeps the slope
 * of a side it lies along -- of a roof it came from, then of what was drawn
 * -- else rises; a corner where one side runs straight on into another as
 * steep is dropped, so no seam runs across one plane; each dormer stays on
 * the side its old one lies along.
 */
export function carriedOnto(footprints: readonly RoofFootprint[], sources: readonly RoofRequest[], drawn?: { readonly outline: readonly Point[]; readonly slopes: readonly number[] }): { readonly footprints: RoofFootprint[]; readonly slopes: number[]; readonly dormers: RoofDormer[]; readonly cutouts: RoofFootprint[] } {
  const known = [
    ...sources.flatMap((source) => ringsOf(source.footprints).flatMap(({ points }, r) => points.map((a, i) => ({ a, c: points[(i + 1) % points.length]!, slope: source.slopes[sideNumber(source.footprints, r, i)]! })))),
    ...(drawn ? drawn.outline.map((a, i) => ({ a, c: drawn.outline[(i + 1) % drawn.outline.length]!, slope: drawn.slopes[i]! })) : []),
  ];
  const slopeAlong = (a: Point, c: Point) => known.find((side) => sameLine(a, c, side.a, side.c))?.slope ?? 1;
  const rings = ringsOf(footprints).map((ring) => {
    let points = [...ring.points];
    for (let i = 0; points.length > 3 && i < points.length; ) {
      const prev = points[(i + points.length - 1) % points.length]!, at = points[i]!, next = points[(i + 1) % points.length]!;
      const cross = (at[0] - prev[0]) * (next[1] - at[1]) - (at[1] - prev[1]) * (next[0] - at[0]);
      const straight = Math.abs(cross) < 1e-9 * Math.hypot(at[0] - prev[0], at[1] - prev[1]) * Math.hypot(next[0] - at[0], next[1] - at[1]) + 1e-12;
      if (straight && slopeAlong(prev, at) === slopeAlong(at, next)) points = points.filter((_, k) => k !== i);
      else i++;
    }
    return { ...ring, points };
  });
  const merged = footprintsOf(rings);
  const sides = ringsOf(merged).flatMap(({ points }) => points.map((a, i) => [a, points[(i + 1) % points.length]!] as const));
  const slopes = sides.map(([a, c]) => slopeAlong(a, c));
  const dormers = sources.flatMap((source) => (source.dormers ?? []).flatMap((dormer) => {
    const old = sideOf(source.footprints, dormer.side);
    const side = sides.findIndex(([a, c]) => sameLine(a, c, old.a, old.c));
    if (side < 0) return [];
    // The same place along the side, measured afresh on the side it now stands on.
    const [a, c] = sides[side]!;
    const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const middle = [old.a[0] + dormer.along * (old.c[0] - old.a[0]), old.a[1] + dormer.along * (old.c[1] - old.a[1])];
    const along = ((middle[0]! - a[0]) * (c[0] - a[0]) + (middle[1]! - a[1]) * (c[1] - a[1])) / (length * length);
    // A dormer is on its leaf or it is gone: one the new outline leaves hanging over its end goes with that part.
    const reach = along * length;
    if (reach - dormer.width / 2 < DORMER_RIM || reach + dormer.width / 2 > length - DORMER_RIM) return [];
    return [{ ...dormer, side, along }];
  }));
  return { footprints: merged, slopes, dormers, cutouts: sources.flatMap((source) => source.cutouts ?? []) };
}

/**
 * A dormer standing with its front's middle at `at`, on the leaf rising from
 * footprint side `side`: where along that side and how far in.
 */
export function dormerAt(recipe: RoofRequest, side: number, at: Point, width: number, front: number, waters: Waters): RoofDormer {
  const { ring, index, a, c } = sideOf(recipe.footprints, side);
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const u = [(c[0] - a[0]) / length, (c[1] - a[1]) / length] as const;
  const { points, hole } = ringsOf(recipe.footprints)[ring]!;
  const n = inwardNormals(points, hole)[index]!;
  const w = [at[0] - a[0], at[1] - a[1]] as const;
  return {
    id: globalThis.crypto.randomUUID(),
    side, width, front, slopes: dormerSlopes(waters),
    along: Math.min(1, Math.max(0, (w[0] * u[0] + w[1] * u[1]) / length)),
    setback: Math.max(0, w[0] * n[0] + w[1] * n[1]),
  };
}

/** A dormer's frame: along its host side, into its host leaf, and where its front's middle stands. */
export function dormerFrame(recipe: RoofRequest, dormer: RoofDormer): { readonly u: Point; readonly n: Point; readonly front: Point; readonly length: number } {
  const { ring, index, a, c } = sideOf(recipe.footprints, dormer.side);
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const u = [(c[0] - a[0]) / length, (c[1] - a[1]) / length] as const;
  const { points, hole } = ringsOf(recipe.footprints)[ring]!;
  const n = inwardNormals(points, hole)[index]!;
  const middle = [a[0] + dormer.along * (c[0] - a[0]), a[1] + dormer.along * (c[1] - a[1])] as const;
  return { u, n, length, front: [middle[0] + n[0] * dormer.setback, middle[1] + n[1] * dormer.setback] };
}

/** The roof a side belongs to: the roof itself, or one of its subroofs. */
export const ownerOf = (recipe: RoofSource, subroof: number | undefined): RoofSource => (subroof === undefined ? recipe : recipe.subroofs?.[subroof] ?? recipe);

/** How steeply the two waters over an opening's dormer rise when it is raised: a right angle at its ridge. */
export const OPENING_DORMER_PITCH = 1;

/**
 * The law of a dormer raised for an opening: two waters, or one where the
 * other is brought down to a gable -- never none. Its front and back stay
 * upright; the opening fills its front, whatever shape its waters give it.
 */
export function openingDormerSlopes(slopes: readonly number[]): RoofDormer["slopes"] {
  let [right, left] = [Math.max(0, slopes[1] ?? 0), Math.max(0, slopes[3] ?? 0)];
  if (right === 0 && left === 0) [right, left] = [OPENING_DORMER_PITCH, OPENING_DORMER_PITCH];
  return [0, right, 0, left];
}

/** The recipe a roof face keeps, if it is a roof's. */
export const roofRecipeOf = (face: ConstructionRegionTopology | undefined): RoofRecipe | undefined => face?.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
/** The role a roof face plays in its roof, if it is a roof's. */
export const roofRoleOf = (face: ConstructionRegionTopology | undefined): RoofFaceRole | undefined => face?.props?.[ROOF_FACE_PROP] as RoofFaceRole | undefined;

