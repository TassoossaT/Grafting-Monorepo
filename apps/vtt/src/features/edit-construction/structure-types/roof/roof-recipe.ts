import type { ConstructionPatch, ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";
import type { RoofDormer, RoofFootprint, RoofPatch, RoofPort, RoofRequest } from "../../../../ports/cap-port.ts";

import type { GlobalHandleIntent } from "../../global-handles/global-handle.ts";
import { outward, ROTATE_REACH } from "../../spine/spine-global-handles.ts";
import { rotateInPlan } from "../../topology/plan-rotation.ts";
import { insideRingXZ } from "../../topology/plan-geometry.ts";
import { faceArea } from "../../topology/plan-overlap.ts";
import { hasTrait } from "../registry.ts";
import { RECIPE_ROLE_PROP, type RecipeGeneration, type RecipeHandle } from "../structure-type.ts";

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
}

/** A roof's request, and the base it follows when it stands on one. */
export interface RoofSource extends RoofRequest {
  readonly base?: RoofBaseRef;
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
  readonly upright: boolean;
}

export type Point = readonly [number, number];
export type Waters = 1 | 2 | 4;

/** How far off a face, a side or a corner its handle stands. */
const STAND_OFF = 0.45;
/** The lowest a roof rises before its rise handle removes it. */
const MIN_RISE = 0.05;
/** Below this share of its neighbours' steepness, a side stops rising and becomes a gable. */
const MIN_SLOPE_SHARE = 0.05;
/** The narrowest a dormer is made by its side handles. */
const MIN_DORMER_WIDTH = 0.3;

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
    return [{ ...dormer, side, along: Math.min(1, Math.max(0, along)) }];
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
    side, width, front, slopes: dormerSlopes(waters),
    along: Math.min(1, Math.max(0, (w[0] * u[0] + w[1] * u[1]) / length)),
    setback: Math.max(0, w[0] * n[0] + w[1] * n[1]),
  };
}

/** How close a roof corner must stand to a standing node to be that node. */
const WELD = 1e-6;

/**
 * The roof `request` makes, as a patch named under `operationId`, and what
 * each face keeps, by region id: the recipe, under that name as its group,
 * its role, and that role as the key an edit finds the same face again by.
 *
 * Welded to what stands under it: every eave corner lying exactly on a node
 * of `standing` -- a floor's corner, a wall's top -- is that node, and every
 * eave between two of them that already has a side there is that side. So a
 * roof on a floor shares its corners and sides, and goes where they go.
 */
export function roofGraphPatch(port: Pick<RoofPort, "generateRoof">, request: RoofSource, operationId: string, standing: readonly ConstructionRegionTopology[] = []): {
  readonly patch: ConstructionPatch;
  readonly faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
} {
  const { base, ...wire } = request;
  const plan = (ring: readonly { readonly x: number; readonly z: number }[]): Point[] => ring.map(({ x, z }) => [x, z]);
  // A floor placed inside a roof's rise replaces the leaves beneath its own
  // boundary. Its live edges supply the cut each time either structure changes.
  // A floor at the eaves is the roof's base, so it does not cut its own roof.
  const platformCuts: RoofFootprint[] = standing.flatMap((face) => {
    if (!hasTrait(face.surfaceType, "floor") || face.nodes.length === 0) return [];
    const level = face.nodes[0]!.position.y;
    if (!face.nodes.every((node) => Math.abs(node.position.y - level) < 1e-4)
      || level <= request.elevation + 1e-4 || level > request.elevation + request.height + 1e-4) return [];
    const area = faceArea(face);
    const holes = area.holes.map(plan);
    return area.outers.map(plan).filter((outer) => outer.length >= 3).map((outer) => ({
      outer,
      holes: holes.filter((hole) => hole.length >= 3 && insideRingXZ(outer, { x: hole[0]![0], z: hole[0]![1] })),
    }));
  });
  const roof: RoofPatch = port.generateRoof({ ...wire, cutouts: [...(request.cutouts ?? []), ...platformCuts] });
  const others = standing.filter((face) => face.props?.[ROOF_RECIPE_PROP] === undefined);
  const standingNodes = others.flatMap((face) => face.nodes);
  const welded = roof.nodes.map(([x, y, z]) => (Math.abs(y - request.elevation) > WELD ? undefined
    : standingNodes.find((node) => Math.abs(node.position.x - x) < WELD && Math.abs(node.position.y - y) < WELD && Math.abs(node.position.z - z) < WELD)));
  const sides = new Map(others.flatMap((face) => [...face.outerLoops, ...face.holes].flat()).map((use) => [[use.startNodeId, use.endNodeId].sort().join("\u0000"), use] as const));
  const nodeId = (index: number) => welded[index]?.id ?? `${operationId}:node:${index}`;
  const sharedSide = (index: number) => {
    const edge = roof.edges[index]!;
    const [a, b] = [welded[edge.start], welded[edge.end]];
    return a && b ? sides.get([a.id, b.id].sort().join("\u0000")) : undefined;
  };
  const edgeId = (index: number) => sharedSide(index)?.edgeId ?? `${operationId}:edge:${index}`;
  const regionId = (index: number) => `${operationId}:face:${index}`;
  /** A shared side as it is stored, whichever way the face standing on it walks it. */
  const stored = (use: ConstructionRegionEdge) => (use.reversed ? { start: use.endNodeId, end: use.startNodeId } : { start: use.startNodeId, end: use.endNodeId });
  /** Where a roof loop's use of edge `edge` starts walking. */
  const walkStart = (edge: number, reversed: boolean) => nodeId(reversed ? roof.edges[edge]!.end : roof.edges[edge]!.start);
  // A side two faces share is walked one way by each: welded to a floor, the
  // roof takes the side it leaves free -- the whole roof wound the other way
  // round when it would walk a shared side the way the floor does.
  const turned = roof.faces.some((face) => [face.boundary, ...face.holes].flat().some(([edge, reversed]) => {
    const shared = sharedSide(edge);
    return shared !== undefined && walkStart(edge, reversed) === shared.startNodeId;
  }));
  const uses = (loop: readonly (readonly [number, boolean])[]) => {
    const walked = (turned ? [...loop].reverse().map(([edge, reversed]) => [edge, !reversed] as const) : loop);
    return walked.map(([edge, reversed]) => {
      const shared = sharedSide(edge);
      return { edgeId: edgeId(edge), reversed: shared ? walkStart(edge, reversed) !== stored(shared).start : reversed };
    });
  };
  const recipe: RoofRecipe = { elevation: request.elevation, height: request.height, footprints: request.footprints, slopes: request.slopes, dormers: request.dormers ?? [], cutouts: request.cutouts ?? [], ...(base ? { base } : {}), group: operationId };
  const faceProps = new Map<string, Readonly<Record<string, unknown>>>();
  roof.faces.forEach((face, index) => {
    const role: RoofFaceRole = { side: face.side, upright: face.upright, ...(face.dormer === null ? {} : { dormer: face.dormer }) };
    faceProps.set(regionId(index), { [ROOF_RECIPE_PROP]: recipe, [ROOF_FACE_PROP]: role, [RECIPE_ROLE_PROP]: `${face.dormer ?? "-"}:${face.side}:${face.upright ? "upright" : "leaf"}` });
  });
  return {
    patch: {
      nodes: roof.nodes.map(([x, y, z], index) => ({ id: nodeId(index), position: welded[index]?.position ?? { x, y, z } })),
      edges: roof.edges.map((edge, index) => {
        const shared = sharedSide(index);
        return shared
          ? { edgeId: shared.edgeId, startNodeId: stored(shared).start, endNodeId: stored(shared).end }
          : { edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end) };
      }),
      regions: roof.faces.map((face, index) => ({
        regionId: regionId(index), surfaceType: "roof", physical: true,
        boundary: uses(face.boundary), ...(face.holes.length > 0 ? { holes: face.holes.map(uses) } : {}),
      })),
    },
    faceProps,
  };
}

// ---- Handles ----

/** A side of the roof -- `dormer` absent -- or of one of its dormers. */
type SideRef = { readonly dormer?: number; readonly side: number };

type RoofPart =
  | { readonly kind: "whole" }
  | { readonly kind: "leaf"; readonly of: SideRef }
  | { readonly kind: "seam"; readonly leaves: readonly [SideRef, SideRef] }
  | { readonly kind: "corner"; readonly ring: number; readonly corner: number }
  | { readonly kind: "insert"; readonly side: number }
  | { readonly kind: "dormer"; readonly dormer: number; readonly along: Point; readonly into: Point }
  | { readonly kind: "dormer-side"; readonly dormer: number; readonly right: boolean; readonly along: Point }
  | { readonly kind: "cutout"; readonly cutout: number }
  | { readonly kind: "cutout-corner"; readonly cutout: number; readonly corner: number };

const recipeOf = (topology: ConstructionRegionTopology) => topology.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
const roleOf = (topology: ConstructionRegionTopology) => topology.props?.[ROOF_FACE_PROP] as RoofFaceRole | undefined;
const refKey = (ref: SideRef) => `${ref.dormer ?? "-"}:${ref.side}`;

/** A face's centre and unit Newell normal. */
function centreAndNormal(face: ConstructionRegionTopology): { readonly centre: ConstructionPosition; readonly normal: ConstructionPosition } {
  const at = new Map(face.nodes.map((node) => [node.id, node.position]));
  const ring = face.outerLoops[0]!.map((use) => at.get(use.startNodeId)!);
  const n = { x: 0, y: 0, z: 0 };
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  const length = Math.hypot(n.x, n.y, n.z) || 1;
  const mean = (axis: "x" | "y" | "z") => ring.reduce((sum, p) => sum + p[axis], 0) / ring.length;
  return { centre: { x: mean("x"), y: mean("y"), z: mean("z") }, normal: { x: n.x / length, y: n.y / length, z: n.z / length } };
}

/** A dormer's frame: along its host side, into its host leaf, and where its front's middle stands. */
function dormerFrame(recipe: RoofRecipe, dormer: RoofDormer): { readonly u: Point; readonly n: Point; readonly front: Point; readonly length: number } {
  const { ring, index, a, c } = sideOf(recipe.footprints, dormer.side);
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const u = [(c[0] - a[0]) / length, (c[1] - a[1]) / length] as const;
  const { points, hole } = ringsOf(recipe.footprints)[ring]!;
  const n = inwardNormals(points, hole)[index]!;
  const middle = [a[0] + dormer.along * (c[0] - a[0]), a[1] + dormer.along * (c[1] - a[1])] as const;
  return { u, n, length, front: [middle[0] + n[0] * dormer.setback, middle[1] + n[1] * dormer.setback] };
}

function roofHandles(members: readonly ConstructionRegionTopology[], generic: unknown): RecipeHandle[] {
  const recipe = generic as RoofRecipe;
  const sideCount = recipe.slopes.length;
  const points = members.flatMap((member) => member.nodes);
  const peak = points.reduce((best, node) => (node.position.y > best.position.y ? node : best));
  const mean = (axis: "x" | "y" | "z") => points.reduce((sum, node) => sum + node.position[axis], 0) / points.length;
  const pivot = { x: mean("x"), y: mean("y"), z: mean("z") };
  const reach = Math.max(...points.map((node) => Math.hypot(node.position.x - pivot.x, node.position.z - pivot.z))) + ROTATE_REACH;
  const whole: RoofPart = { kind: "whole" };
  const handles: RecipeHandle[] = [
    { kind: "pivot", anchor: "pivot", position: pivot, motion: { kind: "free" }, part: whole },
    { kind: "rotate", anchor: "rotate", position: outward(pivot, peak.position, reach), motion: { kind: "orbit", center: pivot }, part: whole },
    { kind: "rise", anchor: "rise", position: { ...peak.position, y: peak.position.y + STAND_OFF }, motion: { kind: "vertical" }, part: whole },
  ];
  // One slope handle per side, off its largest leaf -- or, a gable having none, off its upright face.
  const bySide = new Map<string, { readonly face: ConstructionRegionTopology; readonly ref: SideRef; readonly rank: number }>();
  for (const face of members) {
    const role = roleOf(face);
    // A flat top, and where a dormer meets its leaf, have no side to raise.
    if (!role || (role.dormer === undefined ? role.side >= sideCount : role.side > 3)) continue;
    const ref: SideRef = role.dormer === undefined ? { side: role.side } : { dormer: role.dormer, side: role.side };
    const rank = (role.upright ? 0 : 1000) + face.nodes.length;
    if ((bySide.get(refKey(ref))?.rank ?? -1) < rank) bySide.set(refKey(ref), { face, ref, rank });
  }
  for (const [key, { face, ref }] of bySide) {
    // Faces wind with their normal into the roof: off them is against it.
    const { centre, normal } = centreAndNormal(face);
    handles.push({
      kind: "slope", anchor: `slope:${key}`, motion: { kind: "vertical" },
      position: { x: centre.x - normal.x * STAND_OFF, y: centre.y - normal.y * STAND_OFF, z: centre.z - normal.z * STAND_OFF },
      part: { kind: "leaf", of: ref } satisfies RoofPart,
    });
  }
  // Seams: an edge two leaves of different sides share, above the eaves.
  const byEdge = new Map<string, { refs: SideRef[]; a: ConstructionPosition; b: ConstructionPosition }>();
  for (const face of members) {
    const role = roleOf(face);
    if (!role || role.upright || (role.dormer === undefined ? role.side >= sideCount : role.side > 3)) continue;
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    for (const use of [...face.outerLoops, ...face.holes].flat()) {
      const entry = byEdge.get(use.edgeId) ?? { refs: [], a: at.get(use.startNodeId)!, b: at.get(use.endNodeId)! };
      entry.refs.push(role.dormer === undefined ? { side: role.side } : { dormer: role.dormer, side: role.side });
      byEdge.set(use.edgeId, entry);
    }
  }
  const seams = new Set<string>();
  for (const { refs, a, b } of byEdge.values()) {
    if (refs.length !== 2 || Math.max(a.y, b.y) - recipe.elevation < 1e-6) continue;
    const pair = [...refs].sort((x, y) => refKey(x).localeCompare(refKey(y))) as [SideRef, SideRef];
    const key = pair.map(refKey).join("|");
    if (refKey(pair[0]) === refKey(pair[1]) || seams.has(key)) continue;
    seams.add(key);
    handles.push({
      kind: "seam", anchor: `seam:${key}`, motion: { kind: "vertical" },
      position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + STAND_OFF, z: (a.z + b.z) / 2 },
      part: { kind: "seam", leaves: pair } satisfies RoofPart,
    });
  }
  // Every corner of the footprint, stood off outward; every side's middle, below the eave, to pull a new corner from.
  ringsOf(recipe.footprints).forEach(({ points: ring, hole }, r) => {
    const normals = inwardNormals(ring, hole);
    ring.forEach((a, i) => {
      const n = normals[i]!, previous = normals[(i + ring.length - 1) % ring.length]!;
      const out = [-(n[0] + previous[0]), -(n[1] + previous[1])];
      const length = Math.hypot(out[0]!, out[1]!) || 1;
      handles.push({
        kind: "corner", anchor: `corner:${r}:${i}`, motion: { kind: "plane" },
        position: { x: a[0] + (out[0]! / length) * STAND_OFF, y: recipe.elevation, z: a[1] + (out[1]! / length) * STAND_OFF },
        part: { kind: "corner", ring: r, corner: i } satisfies RoofPart,
      });
      const c = ring[(i + 1) % ring.length]!;
      handles.push({
        kind: "insert", anchor: `insert:${r}:${i}`, motion: { kind: "plane" },
        position: { x: (a[0] + c[0]) / 2 - n[0] * STAND_OFF, y: recipe.elevation - STAND_OFF, z: (a[1] + c[1]) / 2 - n[1] * STAND_OFF },
        part: { kind: "insert", side: sideNumber(recipe.footprints, r, i) } satisfies RoofPart,
      });
    });
  });
  // Dormers: moved over their leaf from before their front, widened from beside their cheeks, raised from above their front.
  (recipe.dormers ?? []).forEach((dormer, k) => {
    const { u, n, front } = dormerFrame(recipe, dormer);
    const faces = members.filter((face) => roleOf(face)?.dormer === k);
    if (faces.length === 0) return;
    const ys = faces.flatMap((face) => face.nodes.map((node) => node.position.y));
    const [low, high] = [Math.min(...ys), Math.max(...ys)];
    const part: RoofPart = { kind: "dormer", dormer: k, along: u, into: n };
    handles.push({ kind: "pivot", anchor: `dormer:${k}:move`, motion: { kind: "plane" }, position: { x: front[0] - n[0] * STAND_OFF, y: low, z: front[1] - n[1] * STAND_OFF }, part });
    handles.push({ kind: "rise", anchor: `dormer:${k}:front`, motion: { kind: "vertical" }, position: { x: front[0] - n[0] * STAND_OFF, y: high + STAND_OFF, z: front[1] - n[1] * STAND_OFF }, part });
    for (const right of [true, false]) {
      const sign = right ? 1 : -1;
      const reachOut = dormer.width / 2 + STAND_OFF;
      handles.push({
        kind: "side", anchor: `dormer:${k}:${right ? "right" : "left"}`, motion: { kind: "line", direction: { x: u[0] * sign, z: u[1] * sign } },
        facing: { x: u[0] * sign, z: u[1] * sign },
        position: { x: front[0] + u[0] * sign * reachOut, y: (low + high) / 2, z: front[1] + u[1] * sign * reachOut },
        part: { kind: "dormer-side", dormer: k, right, along: u } satisfies RoofPart,
      });
    }
  });
  // An authored opening is moved by its centre and reshaped by its corners.
  // Platform cuts are derived from their own floor handles, so appear nowhere here.
  (recipe.cutouts ?? []).forEach((cutout, k) => {
    const ring = cutout.outer;
    if (ring.length < 3) return;
    const heightAt = (p: Point) => points.reduce((best, node) => {
      const distance = Math.hypot(node.position.x - p[0], node.position.z - p[1]);
      return distance < best.distance ? { distance, y: node.position.y } : best;
    }, { distance: Infinity, y: recipe.elevation + recipe.height / 2 }).y;
    const centre: Point = [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length];
    handles.push({ kind: "pivot", anchor: `cutout:${k}:move`, motion: { kind: "plane" }, position: { x: centre[0], y: heightAt(centre) + STAND_OFF, z: centre[1] }, part: { kind: "cutout", cutout: k } satisfies RoofPart });
    ring.forEach((p, corner) => handles.push({ kind: "corner", anchor: `cutout:${k}:corner:${corner}`, motion: { kind: "plane" }, position: { x: p[0], y: heightAt(p) + STAND_OFF, z: p[1] }, part: { kind: "cutout-corner", cutout: k, corner } satisfies RoofPart }));
  });
  return handles;
}

// ---- Edits ----

function slopesOf(recipe: RoofRecipe, ref: SideRef): readonly number[] {
  return ref.dormer === undefined ? recipe.slopes : recipe.dormers![ref.dormer]!.slopes;
}

function withSlopes(recipe: RoofRecipe, ref: SideRef, slopes: readonly number[]): RoofRecipe {
  if (slopes.every((slope) => slope === 0)) throw new Error(ref.dormer === undefined ? "O telhado precisa de ao menos uma água." : "A lucarna precisa de ao menos uma água.");
  if (ref.dormer === undefined) return { ...recipe, slopes };
  return withDormer(recipe, ref.dormer, (dormer) => ({ ...dormer, slopes: slopes as unknown as RoofDormer["slopes"] }));
}

function withDormer(recipe: RoofRecipe, k: number, change: (dormer: RoofDormer) => RoofDormer | undefined): RoofRecipe {
  return { ...recipe, dormers: (recipe.dormers ?? []).flatMap((dormer, i) => (i === k ? change(dormer) ?? [] : [dormer])) };
}

function withRings(recipe: RoofRecipe, change: (ring: readonly Point[], r: number) => readonly Point[]): RoofRecipe {
  return { ...recipe, footprints: footprintsOf(ringsOf(recipe.footprints).map((ring, r) => ({ ...ring, points: change(ring.points, r) }))) };
}

/** A side's slope after its handle rose by `dy`: steeper up, shallower down, and a gable once it stops rising. */
function reslope(slopes: readonly number[], side: number, dy: number, height: number): number {
  const pitched = slopes.filter((slope) => slope > 0);
  const reference = pitched.reduce((sum, slope) => sum + slope, 0) / Math.max(1, pitched.length) || 1;
  const factor = dy / (0.5 * height);
  const current = slopes[side]!;
  const next = current > 0 ? current * (1 + factor) : reference * factor;
  return next < reference * MIN_SLOPE_SHARE ? 0 : next;
}

function editRoof(generic: unknown, handle: RecipeHandle, intent: GlobalHandleIntent): unknown {
  const recipe = generic as RoofRecipe;
  const part = handle.part as RoofPart;
  const moveAll = (place: (p: Point) => Point, dy = 0): RoofRecipe => ({
    ...withRings(recipe, (ring) => ring.map(place)),
    cutouts: recipe.cutouts?.map((cutout) => ({ outer: cutout.outer.map(place), holes: cutout.holes.map((hole) => hole.map(place)) })) ?? [],
    elevation: recipe.elevation + dy,
  });
  // Moved or reshaped by its own hand, it no longer stands where its base does: it lets go of it.
  const free = (next: RoofRecipe): RoofRecipe => {
    const { base: _base, ...rest } = next;
    return rest;
  };
  if (part.kind === "cutout" && handle.kind === "pivot" && intent.kind === "move") {
    const place = (p: Point): Point => [p[0] + intent.delta.x, p[1] + intent.delta.z];
    return { ...recipe, cutouts: (recipe.cutouts ?? []).map((cutout, i) => i === part.cutout ? { outer: cutout.outer.map(place), holes: cutout.holes.map((hole) => hole.map(place)) } : cutout) };
  }
  if (part.kind === "cutout-corner" && handle.kind === "corner" && intent.kind === "move") {
    return { ...recipe, cutouts: (recipe.cutouts ?? []).map((cutout, i) => i === part.cutout ? { ...cutout, outer: cutout.outer.map((p, corner): Point => corner === part.corner ? [p[0] + intent.delta.x, p[1] + intent.delta.z] : p) } : cutout) };
  }
  if (part.kind === "dormer") {
    if (handle.kind === "pivot" && intent.kind === "move") {
      // Along its side and into its leaf; the generator refuses one pushed off it.
      return withDormer(recipe, part.dormer, (dormer) => {
        const { length } = dormerFrame(recipe, dormer);
        const along = intent.delta.x * part.along[0] + intent.delta.z * part.along[1];
        const into = intent.delta.x * part.into[0] + intent.delta.z * part.into[1];
        return { ...dormer, along: Math.min(1, Math.max(0, dormer.along + along / length)), setback: Math.max(0, dormer.setback + into) };
      });
    }
    // Its front brought below the leaf removes it.
    if (handle.kind === "rise" && intent.kind === "height") return withDormer(recipe, part.dormer, (dormer) => (dormer.front + intent.dy < 0 ? undefined : { ...dormer, front: dormer.front + intent.dy }));
    return undefined;
  }
  if (part.kind === "dormer-side") {
    if (intent.kind !== "move") return undefined;
    // The other cheek stays where it stands.
    return withDormer(recipe, part.dormer, (dormer) => {
      const { length } = dormerFrame(recipe, dormer);
      const push = (intent.delta.x * part.along[0] + intent.delta.z * part.along[1]) * (part.right ? 1 : -1);
      const width = Math.max(MIN_DORMER_WIDTH, dormer.width + push);
      const shift = ((width - dormer.width) / 2) * (part.right ? 1 : -1);
      return { ...dormer, width, along: Math.min(1, Math.max(0, dormer.along + shift / length)) };
    });
  }
  switch (handle.kind) {
    case "pivot":
      if (intent.kind !== "move") return undefined;
      return free(moveAll((p) => [p[0] + intent.delta.x, p[1] + intent.delta.z], intent.delta.y));
    case "rotate": {
      if (intent.kind !== "rotate") return undefined;
      const centre = handle.motion.kind === "orbit" ? handle.motion.center : { x: 0, z: 0 };
      return free(moveAll((p) => {
        const turned = rotateInPlan({ x: p[0], z: p[1] }, centre, intent.angle);
        return [turned.x, turned.z];
      }));
    }
    case "rise": {
      if (intent.kind !== "height") return undefined;
      const height = recipe.height + intent.dy;
      return height < MIN_RISE ? null : { ...recipe, height };
    }
    case "slope": {
      if (intent.kind !== "height" || part.kind !== "leaf") return undefined;
      const slopes = slopesOf(recipe, part.of);
      return withSlopes(recipe, part.of, slopes.map((slope, i) => (i === part.of.side ? reslope(slopes, i, intent.dy, recipe.height) : slope)));
    }
    case "seam": {
      if (intent.kind !== "height" || part.kind !== "seam") return undefined;
      let next = recipe;
      for (const ref of part.leaves) {
        const slopes = slopesOf(next, ref);
        next = withSlopes(next, ref, slopes.map((slope, i) => (i === ref.side ? reslope(slopesOf(recipe, ref), i, intent.dy, recipe.height) : slope)));
      }
      return next;
    }
    case "corner": {
      if (intent.kind !== "move" || part.kind !== "corner") return undefined;
      return free(withRings(recipe, (ring, r) => (r !== part.ring ? ring : ring.map((p, i) => (i === part.corner ? [p[0] + intent.delta.x, p[1] + intent.delta.z] as const : p)))));
    }
    case "insert": {
      if (intent.kind !== "move" || part.kind !== "insert") return undefined;
      if (Math.hypot(intent.delta.x, intent.delta.z) < 1e-3) return undefined;
      // A new corner pulled out of a side: both halves keep its slope, and dormers on later sides keep to their own.
      const { ring, index, a, c } = sideOf(recipe.footprints, part.side);
      const corner: Point = [(a[0] + c[0]) / 2 + intent.delta.x, (a[1] + c[1]) / 2 + intent.delta.z];
      const next = withRings(recipe, (points, r) => (r !== ring ? points : [...points.slice(0, index + 1), corner, ...points.slice(index + 1)]));
      return {
        ...free(next),
        slopes: [...recipe.slopes.slice(0, part.side + 1), recipe.slopes[part.side]!, ...recipe.slopes.slice(part.side + 1)],
        dormers: (recipe.dormers ?? []).map((dormer) => (dormer.side > part.side ? { ...dormer, side: dormer.side + 1 } : dormer)),
      };
    }
    default:
      return undefined;
  }
}

/** How a roof is regenerated from the recipe its faces keep. */
export const roofRecipeGeneration: RecipeGeneration = {
  of: (topology) => {
    const recipe = recipeOf(topology);
    return recipe ? { group: recipe.group, recipe } : undefined;
  },
  handles: roofHandles,
  edit: editRoof,
  generate: (port, recipe, operationId, standing) => roofGraphPatch(port, recipe as RoofRecipe, operationId, standing),
};
