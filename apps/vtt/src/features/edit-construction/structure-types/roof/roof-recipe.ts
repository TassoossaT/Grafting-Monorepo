import type { ConstructionPatch, ConstructionPosition, ConstructionRegionTopology } from "@/ports";
import type { RoofBlock, RoofDormer, RoofPatch, RoofPort, RoofRequest } from "../../../../ports/cap-port.ts";

import type { GlobalHandleIntent } from "../../global-handles/global-handle.ts";
import { outward, ROTATE_REACH } from "../../spine/spine-global-handles.ts";
import { rotateInPlan } from "../../topology/plan-rotation.ts";
import { RECIPE_ROLE_PROP, type RecipeGeneration, type RecipeHandle } from "../structure-type.ts";

/** Region property carrying a roof's recipe, which every edit regenerates the roof from. */
export const ROOF_RECIPE_PROP = "roof";
/** Region property naming which side of which block a roof face rises from. */
export const ROOF_FACE_PROP = "roofFace";
/** How far every eave reaches past its footprint when a roof is made. */
export const ROOF_OVERHANG = 0.2;

/** A roof's recipe: what the generator is asked, and the group of faces it made. */
export interface RoofRecipe extends RoofRequest {
  readonly group: string;
}

/**
 * Which side of which block a face rises from -- dormers numbered after the
 * blocks, their sides front, right, back and left -- and whether it is an
 * upright face under that side.
 */
export interface RoofFaceRole {
  readonly block: number;
  readonly side: number;
  readonly upright: boolean;
}

type Point = readonly [number, number];

/** How far off a face, a side or a corner its handle stands. */
const STAND_OFF = 0.45;
/** The lowest a roof rises before its rise handle removes it. */
const MIN_RISE = 0.05;
/** Below this share of its block's steepness, a side stops rising and becomes a gable. */
const MIN_SLOPE_SHARE = 0.05;
/** The narrowest a dormer is made by its side handles. */
const MIN_DORMER_WIDTH = 0.3;

/** A dormer's sides, by waters: two pitch its cheeks, one its front alone -- shallower, so it runs back into the leaf -- four all but its back. */
export function dormerSlopes(waters: 1 | 2 | 4): readonly [number, number, number, number] {
  return waters === 2 ? [0, 1, 0, 1] : waters === 1 ? [0.5, 0, 0, 0] : [1, 1, 0, 1];
}

/**
 * Which sides of a footprint rise, for a number of waters: every side; the
 * longest side and the one facing it most squarely; or the longest alone.
 * The rest are gables.
 */
export function presetSlopes(contour: readonly Point[], waters: 1 | 2 | 4): number[] {
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

/** A roof over convex blocks, each shaped by a number of waters. */
export function roofOver(blocks: readonly (readonly Point[])[], elevation: number, height: number, waters: 1 | 2 | 4): RoofRequest {
  return {
    elevation, height,
    blocks: blocks.map((contour) => ({ contour, slopes: presetSlopes(contour, waters), overhangs: contour.map(() => ROOF_OVERHANG) })),
  };
}

/** Inward unit normal of each side of an outline, whichever way it winds. */
export function inwardNormals(contour: readonly Point[]): Point[] {
  const winding = Math.sign(contour.reduce((sum, a, i) => {
    const b = contour[(i + 1) % contour.length]!;
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0));
  return contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(-(b[1] - a[1]) * winding) / length, ((b[0] - a[0]) * winding) / length];
  });
}

/**
 * A dormer standing with its front's middle at `at`, on the leaf rising from
 * side `side` of block `block`: where along that side and how far in.
 */
export function dormerAt(recipe: RoofRequest, block: number, side: number, at: Point, width: number, front: number, waters: 1 | 2 | 4): RoofDormer {
  const contour = recipe.blocks[block]!.contour;
  const a = contour[side]!, c = contour[(side + 1) % contour.length]!;
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const u = [(c[0] - a[0]) / length, (c[1] - a[1]) / length] as const;
  const n = inwardNormals(contour)[side]!;
  const w = [at[0] - a[0], at[1] - a[1]] as const;
  return {
    block, side, width, front, slopes: dormerSlopes(waters),
    along: Math.min(1, Math.max(0, (w[0] * u[0] + w[1] * u[1]) / length)),
    setback: Math.max(0, w[0] * n[0] + w[1] * n[1]),
  };
}

/**
 * The roof `request` makes, as a patch named under `operationId`, and what
 * each face keeps, by region id: the recipe, under that name as its group,
 * its role, and that role as the key an edit finds the same face again by.
 */
export function roofGraphPatch(port: Pick<RoofPort, "generateRoof">, request: RoofRequest, operationId: string): {
  readonly patch: ConstructionPatch;
  readonly faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
} {
  const roof: RoofPatch = port.generateRoof(request);
  const nodeId = (index: number) => `${operationId}:node:${index}`;
  const edgeId = (index: number) => `${operationId}:edge:${index}`;
  const regionId = (index: number) => `${operationId}:face:${index}`;
  const uses = (loop: readonly (readonly [number, boolean])[]) => loop.map(([edge, reversed]) => ({ edgeId: edgeId(edge), reversed }));
  const recipe: RoofRecipe = { elevation: request.elevation, height: request.height, blocks: request.blocks, dormers: request.dormers ?? [], group: operationId };
  const faceProps = new Map<string, Readonly<Record<string, unknown>>>();
  roof.faces.forEach((face, index) => {
    const role: RoofFaceRole = { block: face.block, side: face.side, upright: face.upright };
    faceProps.set(regionId(index), { [ROOF_RECIPE_PROP]: recipe, [ROOF_FACE_PROP]: role, [RECIPE_ROLE_PROP]: `${role.block}:${role.side}:${role.upright ? "upright" : "leaf"}` });
  });
  return {
    patch: {
      nodes: roof.nodes.map(([x, y, z], index) => ({ id: nodeId(index), position: { x, y, z } })),
      edges: roof.edges.map((edge, index) => ({ edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end) })),
      regions: roof.faces.map((face, index) => ({
        regionId: regionId(index), surfaceType: "roof", physical: true,
        boundary: uses(face.boundary), ...(face.holes.length > 0 ? { holes: face.holes.map(uses) } : {}),
      })),
    },
    faceProps,
  };
}

// ---- Handles ----

/** A side of a block or of a dormer: dormers are numbered after the blocks. */
type SideRef = readonly [number, number];

type RoofPart =
  | { readonly kind: "whole" }
  | { readonly kind: "leaf"; readonly block: number; readonly side: number }
  | { readonly kind: "seam"; readonly leaves: readonly [SideRef, SideRef] }
  | { readonly kind: "side"; readonly block: number; readonly side: number; readonly outward: Point }
  | { readonly kind: "corner"; readonly block: number; readonly corner: number }
  | { readonly kind: "dormer"; readonly dormer: number; readonly along: Point; readonly into: Point }
  | { readonly kind: "dormer-side"; readonly dormer: number; readonly right: boolean; readonly along: Point };

const recipeOf = (topology: ConstructionRegionTopology) => topology.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
const roleOf = (topology: ConstructionRegionTopology) => topology.props?.[ROOF_FACE_PROP] as RoofFaceRole | undefined;

/** Whether `x` lies strictly inside another block of the roof than `own`. */
function coveredByAnother(blocks: readonly RoofBlock[], own: number, x: Point): boolean {
  return blocks.some((block, b) => b !== own && inwardNormals(block.contour).every((n, i) => {
    const a = block.contour[i]!;
    return (x[0] - a[0]) * n[0] + (x[1] - a[1]) * n[1] > 1e-6;
  }));
}

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
function dormerFrame(recipe: RoofRecipe, dormer: RoofDormer): { readonly u: Point; readonly n: Point; readonly front: Point } {
  const contour = recipe.blocks[dormer.block]!.contour;
  const a = contour[dormer.side]!, c = contour[(dormer.side + 1) % contour.length]!;
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const u = [(c[0] - a[0]) / length, (c[1] - a[1]) / length] as const;
  const n = inwardNormals(contour)[dormer.side]!;
  const middle = [a[0] + dormer.along * (c[0] - a[0]), a[1] + dormer.along * (c[1] - a[1])] as const;
  return { u, n, front: [middle[0] + n[0] * dormer.setback, middle[1] + n[1] * dormer.setback] };
}

function roofHandles(members: readonly ConstructionRegionTopology[], generic: unknown): RecipeHandle[] {
  const recipe = generic as RoofRecipe;
  const dormers = recipe.dormers ?? [];
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
  const bySide = new Map<string, { readonly face: ConstructionRegionTopology; readonly role: RoofFaceRole; readonly rank: number }>();
  for (const face of members) {
    const role = roleOf(face);
    // A dormer's side 4 is where it meets its leaf: nothing to raise there.
    if (!role || (role.block >= recipe.blocks.length && role.side > 3)) continue;
    const key = `${role.block}:${role.side}`;
    const rank = (role.upright ? 0 : 1000) + face.nodes.length;
    if ((bySide.get(key)?.rank ?? -1) < rank) bySide.set(key, { face, role, rank });
  }
  for (const [key, { face, role }] of bySide) {
    // Faces wind with their normal into the roof: off them is against it.
    const { centre, normal } = centreAndNormal(face);
    handles.push({
      kind: "slope", anchor: `slope:${key}`, motion: { kind: "vertical" },
      position: { x: centre.x - normal.x * STAND_OFF, y: centre.y - normal.y * STAND_OFF, z: centre.z - normal.z * STAND_OFF },
      part: { kind: "leaf", block: role.block, side: role.side } satisfies RoofPart,
    });
  }
  // Seams: an edge two leaves of different sides share, above the eaves.
  const byEdge = new Map<string, { roles: RoofFaceRole[]; a: ConstructionPosition; b: ConstructionPosition }>();
  for (const face of members) {
    const role = roleOf(face);
    if (!role || role.upright) continue;
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    for (const use of [...face.outerLoops, ...face.holes].flat()) {
      const entry = byEdge.get(use.edgeId) ?? { roles: [], a: at.get(use.startNodeId)!, b: at.get(use.endNodeId)! };
      entry.roles.push(role);
      byEdge.set(use.edgeId, entry);
    }
  }
  const seams = new Set<string>();
  for (const { roles, a, b } of byEdge.values()) {
    if (roles.length !== 2 || Math.max(a.y, b.y) - recipe.elevation < 1e-6) continue;
    const [p, q] = roles as [RoofFaceRole, RoofFaceRole];
    if (p.block === q.block && p.side === q.side) continue;
    const pair = [[p.block, p.side], [q.block, q.side]].sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!) as [[number, number], [number, number]];
    const key = pair.flat().join(":");
    if (seams.has(key)) continue;
    seams.add(key);
    handles.push({
      kind: "seam", anchor: `seam:${key}`, motion: { kind: "vertical" },
      position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + STAND_OFF, z: (a.z + b.z) / 2 },
      part: { kind: "seam", leaves: pair } satisfies RoofPart,
    });
  }
  // Sides and corners of each block's footprint that stand on the roof's outline.
  recipe.blocks.forEach((block, b) => {
    const normals = inwardNormals(block.contour);
    block.contour.forEach((a, i) => {
      const c = block.contour[(i + 1) % block.contour.length]!;
      const n = normals[i]!;
      const middle: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      if (!coveredByAnother(recipe.blocks, b, middle)) {
        const reachOut = block.overhangs[i]! + STAND_OFF;
        handles.push({
          kind: "side", anchor: `side:${b}:${i}`, motion: { kind: "line", direction: { x: -n[0], z: -n[1] } }, facing: { x: -n[0], z: -n[1] },
          position: { x: middle[0] - n[0] * reachOut, y: recipe.elevation, z: middle[1] - n[1] * reachOut },
          part: { kind: "side", block: b, side: i, outward: [-n[0], -n[1]] } satisfies RoofPart,
        });
        handles.push({
          kind: "insert", anchor: `insert:${b}:${i}`, motion: { kind: "plane" },
          position: { x: middle[0], y: recipe.elevation - STAND_OFF, z: middle[1] },
          part: { kind: "side", block: b, side: i, outward: [-n[0], -n[1]] } satisfies RoofPart,
        });
      }
      if (coveredByAnother(recipe.blocks, b, a)) return;
      const previous = normals[(i + block.contour.length - 1) % block.contour.length]!;
      const out = [-(n[0] + previous[0]), -(n[1] + previous[1])];
      const length = Math.hypot(out[0]!, out[1]!) || 1;
      const reachOut = Math.max(block.overhangs[i]!, block.overhangs[(i + block.contour.length - 1) % block.contour.length]!) + STAND_OFF;
      handles.push({
        kind: "corner", anchor: `corner:${b}:${i}`, motion: { kind: "plane" },
        position: { x: a[0] + (out[0]! / length) * reachOut, y: recipe.elevation, z: a[1] + (out[1]! / length) * reachOut },
        part: { kind: "corner", block: b, corner: i } satisfies RoofPart,
      });
    });
  });
  // Dormers: moved over their leaf from before their front, widened from beside their cheeks, raised from above their front.
  dormers.forEach((dormer, k) => {
    const { u, n, front } = dormerFrame(recipe, dormer);
    const faces = members.filter((face) => roleOf(face)?.block === recipe.blocks.length + k);
    if (faces.length === 0) return;
    const ys = faces.flatMap((face) => face.nodes.map((node) => node.position.y));
    const [low, high] = [Math.min(...ys), Math.max(...ys)];
    handles.push({
      kind: "pivot", anchor: `dormer:${k}:move`, motion: { kind: "plane" },
      position: { x: front[0] - n[0] * STAND_OFF, y: low, z: front[1] - n[1] * STAND_OFF },
      part: { kind: "dormer", dormer: k, along: u, into: n } satisfies RoofPart,
    });
    handles.push({
      kind: "rise", anchor: `dormer:${k}:front`, motion: { kind: "vertical" },
      position: { x: front[0] - n[0] * STAND_OFF, y: high + STAND_OFF, z: front[1] - n[1] * STAND_OFF },
      part: { kind: "dormer", dormer: k, along: u, into: n } satisfies RoofPart,
    });
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
  return handles;
}

// ---- Edits ----

/** The slopes of a block, or of a dormer numbered after the blocks. */
function slopesOf(recipe: RoofRecipe, block: number): readonly number[] {
  return block < recipe.blocks.length ? recipe.blocks[block]!.slopes : recipe.dormers![block - recipe.blocks.length]!.slopes;
}

function withSlopes(recipe: RoofRecipe, block: number, slopes: readonly number[]): RoofRecipe {
  if (slopes.every((slope) => slope === 0)) throw new Error("Cada bloco do telhado precisa de ao menos uma água.");
  if (block < recipe.blocks.length) return withBlock(recipe, block, (own) => ({ ...own, slopes }));
  return withDormer(recipe, block - recipe.blocks.length, (dormer) => ({ ...dormer, slopes: slopes as unknown as RoofDormer["slopes"] }));
}

function withBlock(recipe: RoofRecipe, b: number, change: (block: RoofBlock) => RoofBlock): RoofRecipe {
  return { ...recipe, blocks: recipe.blocks.map((block, i) => (i === b ? change(block) : block)) };
}

function withDormer(recipe: RoofRecipe, k: number, change: (dormer: RoofDormer) => RoofDormer | undefined): RoofRecipe {
  return { ...recipe, dormers: (recipe.dormers ?? []).flatMap((dormer, i) => (i === k ? change(dormer) ?? [] : [dormer])) };
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
    ...recipe, elevation: recipe.elevation + dy,
    blocks: recipe.blocks.map((block) => ({ ...block, contour: block.contour.map(place) })),
  });
  if (part.kind === "dormer") {
    if (handle.kind === "pivot" && intent.kind === "move") {
      // Along its side and into its leaf; the generator refuses one pushed off it.
      return withDormer(recipe, part.dormer, (dormer) => {
        const contour = recipe.blocks[dormer.block]!.contour;
        const a = contour[dormer.side]!, c = contour[(dormer.side + 1) % contour.length]!;
        const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
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
      const contour = recipe.blocks[dormer.block]!.contour;
      const a = contour[dormer.side]!, c = contour[(dormer.side + 1) % contour.length]!;
      const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const push = (intent.delta.x * part.along[0] + intent.delta.z * part.along[1]) * (part.right ? 1 : -1);
      const width = Math.max(MIN_DORMER_WIDTH, dormer.width + push);
      const shift = ((width - dormer.width) / 2) * (part.right ? 1 : -1);
      return { ...dormer, width, along: Math.min(1, Math.max(0, dormer.along + shift / length)) };
    });
  }
  switch (handle.kind) {
    case "pivot":
      if (intent.kind !== "move") return undefined;
      return moveAll((p) => [p[0] + intent.delta.x, p[1] + intent.delta.z], intent.delta.y);
    case "rotate": {
      if (intent.kind !== "rotate") return undefined;
      const centre = handle.motion.kind === "orbit" ? handle.motion.center : { x: 0, z: 0 };
      return moveAll((p) => {
        const turned = rotateInPlan({ x: p[0], z: p[1] }, centre, intent.angle);
        return [turned.x, turned.z];
      });
    }
    case "rise": {
      if (intent.kind !== "height") return undefined;
      const height = recipe.height + intent.dy;
      return height < MIN_RISE ? null : { ...recipe, height };
    }
    case "slope": {
      if (intent.kind !== "height" || part.kind !== "leaf") return undefined;
      const slopes = slopesOf(recipe, part.block);
      return withSlopes(recipe, part.block, slopes.map((slope, i) => (i === part.side ? reslope(slopes, i, intent.dy, recipe.height) : slope)));
    }
    case "seam": {
      if (intent.kind !== "height" || part.kind !== "seam") return undefined;
      let next = recipe;
      for (const [b, side] of part.leaves) {
        const slopes = slopesOf(next, b);
        next = withSlopes(next, b, slopes.map((slope, i) => (i === side ? reslope(slopesOf(recipe, b), i, intent.dy, recipe.height) : slope)));
      }
      return next;
    }
    case "side": {
      if (intent.kind !== "move" || part.kind !== "side") return undefined;
      const push = intent.delta.x * part.outward[0] + intent.delta.z * part.outward[1];
      return withBlock(recipe, part.block, (block) => ({ ...block, overhangs: block.overhangs.map((overhang, i) => (i === part.side ? Math.max(0, overhang + push) : overhang)) }));
    }
    case "corner": {
      if (intent.kind !== "move" || part.kind !== "corner") return undefined;
      return withBlock(recipe, part.block, (block) => ({
        ...block, contour: block.contour.map((p, i) => (i === part.corner ? [p[0] + intent.delta.x, p[1] + intent.delta.z] as const : p)),
      }));
    }
    case "insert": {
      if (intent.kind !== "move" || part.kind !== "side") return undefined;
      if (Math.hypot(intent.delta.x, intent.delta.z) < 1e-3) return undefined;
      // A new corner pulled out of a side: dormers standing on later sides of that block keep to their own.
      const next = withBlock(recipe, part.block, (block) => {
        const a = block.contour[part.side]!, c = block.contour[(part.side + 1) % block.contour.length]!;
        const corner: Point = [(a[0] + c[0]) / 2 + intent.delta.x, (a[1] + c[1]) / 2 + intent.delta.z];
        const after = <T>(values: readonly T[], value: T) => [...values.slice(0, part.side + 1), value, ...values.slice(part.side + 1)];
        return {
          contour: after(block.contour, corner),
          slopes: after(block.slopes, block.slopes[part.side]!),
          overhangs: after(block.overhangs, block.overhangs[part.side]!),
        };
      });
      return { ...next, dormers: (next.dormers ?? []).map((dormer) => (dormer.block === part.block && dormer.side > part.side ? { ...dormer, side: dormer.side + 1 } : dormer)) };
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
  generate: (port, recipe, operationId) => roofGraphPatch(port, recipe as RoofRecipe, operationId),
};
