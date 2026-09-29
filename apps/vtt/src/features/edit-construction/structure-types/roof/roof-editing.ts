import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";
import type { RoofDormer } from "../../../../ports/cap-port.ts";

import type { GlobalHandleIntent } from "../../global-handles/global-handle.ts";
import { outward, ROTATE_REACH } from "../../spine/spine-global-handles.ts";
import { rotateInPlan } from "../../topology/plan-rotation.ts";
import type { RecipeGeneration, RecipeHandle } from "../structure-type.ts";
import { roofGraphPatch } from "./roof-graph-patch.ts";
import {
  dormerFrame, footprintsOf, inwardNormals, openingDormerSlopes, ownerOf, ringsOf, roofRecipeOf, roofRoleOf, sideNumber, sideOf,
  type Point, type RoofFaceRole, type RoofRecipe, type RoofSource,
} from "./roof-recipe.ts";

/** How far off a face, a side or a corner its handle stands. */
const STAND_OFF = 0.45;
/** The lowest a roof rises before its rise handle removes it. */
const MIN_RISE = 0.05;
/** Below this share of its neighbours' steepness, a side stops rising and becomes a gable. */
const MIN_SLOPE_SHARE = 0.05;
/** The narrowest a dormer is made by its side handles. */
const MIN_DORMER_WIDTH = 0.3;

/** A side of the roof -- or of one of its subroofs -- or of one of their dormers. */
type SideRef = { readonly subroof?: number; readonly dormer?: number; readonly side: number };

type RoofPart =
  | { readonly kind: "whole"; readonly subroof?: number }
  | { readonly kind: "leaf"; readonly of: SideRef }
  | { readonly kind: "seam"; readonly leaves: readonly [SideRef, SideRef] }
  | { readonly kind: "corner"; readonly ring: number; readonly corner: number }
  | { readonly kind: "insert"; readonly side: number }
  | { readonly kind: "dormer"; readonly dormer: number; readonly along: Point; readonly into: Point }
  | { readonly kind: "dormer-side"; readonly dormer: number; readonly right: boolean; readonly along: Point }
  | { readonly kind: "cutout"; readonly cutout: number }
  | { readonly kind: "cutout-corner"; readonly cutout: number; readonly corner: number };

const refKey = (ref: SideRef) => `${ref.subroof ?? "-"}:${ref.dormer ?? "-"}:${ref.side}`;
const refOf = (role: RoofFaceRole): SideRef => ({ ...(role.subroof === undefined ? {} : { subroof: role.subroof }), ...(role.dormer === undefined ? {} : { dormer: role.dormer }), side: role.side });
/** Whether a face's side is one a handle raises: not a flat top, nor where a dormer meets its leaf. */
const raisable = (recipe: RoofSource, role: RoofFaceRole) => {
  const owner = ownerOf(recipe, role.subroof);
  if (role.dormer === undefined) return role.side < owner.slopes.length;
  // A dormer raised for an opening is sized through that opening; only its two waters are its own.
  return owner.dormers?.[role.dormer]?.opening ? role.side === 1 || role.side === 3 : role.side <= 3;
};

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

function roofHandles(members: readonly ConstructionRegionTopology[], generic: unknown): RecipeHandle[] {
  const recipe = generic as RoofRecipe;
  const points = members.flatMap((member) => member.nodes);
  const peakOf = (faces: readonly ConstructionRegionTopology[]) => faces.flatMap((face) => face.nodes).reduce((best, node) => (node.position.y > best.position.y ? node : best));
  const own = members.filter((face) => roofRoleOf(face)?.subroof === undefined);
  const peak = peakOf(own.length ? own : members);
  const mean = (axis: "x" | "y" | "z") => points.reduce((sum, node) => sum + node.position[axis], 0) / points.length;
  const pivot = { x: mean("x"), y: mean("y"), z: mean("z") };
  const reach = Math.max(...points.map((node) => Math.hypot(node.position.x - pivot.x, node.position.z - pivot.z))) + ROTATE_REACH;
  const whole: RoofPart = { kind: "whole" };
  const handles: RecipeHandle[] = [
    { kind: "pivot", anchor: "pivot", position: pivot, motion: { kind: "free" }, part: whole },
    { kind: "rotate", anchor: "rotate", position: outward(pivot, peak.position, reach), motion: { kind: "orbit", center: pivot }, part: whole },
    { kind: "rise", anchor: "rise", position: { ...peak.position, y: peak.position.y + STAND_OFF }, motion: { kind: "vertical" }, part: whole },
  ];
  // Each subroof rises from its own tip, the larger roof keeping its height.
  (recipe.subroofs ?? []).forEach((_, k) => {
    const faces = members.filter((face) => roofRoleOf(face)?.subroof === k);
    if (faces.length === 0) return;
    const tip = peakOf(faces);
    handles.push({ kind: "rise", anchor: `subroof:${k}:rise`, position: { ...tip.position, y: tip.position.y + STAND_OFF }, motion: { kind: "vertical" }, part: { kind: "whole", subroof: k } satisfies RoofPart });
  });
  // One slope handle per side, off its largest leaf -- or, a gable having none, off its upright face.
  const bySide = new Map<string, { readonly face: ConstructionRegionTopology; readonly ref: SideRef; readonly rank: number }>();
  for (const face of members) {
    const role = roofRoleOf(face);
    // A flat top, and where a dormer meets its leaf, have no side to raise.
    if (!role || !raisable(recipe, role)) continue;
    const ref = refOf(role);
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
    const role = roofRoleOf(face);
    if (!role || role.upright || !raisable(recipe, role)) continue;
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    for (const use of [...face.outerLoops, ...face.holes].flat()) {
      const entry = byEdge.get(use.edgeId) ?? { refs: [], a: at.get(use.startNodeId)!, b: at.get(use.endNodeId)! };
      entry.refs.push(refOf(role));
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
    // One raised for an opening is moved, sized and removed through that opening.
    if (dormer.opening) return;
    const { u, n, front } = dormerFrame(recipe, dormer);
    const faces = members.filter((face) => roofRoleOf(face)?.dormer === k);
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
  const owner = ownerOf(recipe, ref.subroof);
  return ref.dormer === undefined ? owner.slopes : owner.dormers![ref.dormer]!.slopes;
}

function withSlopes(recipe: RoofRecipe, ref: SideRef, slopes: readonly number[]): RoofRecipe {
  // An opening's dormer keeps a water by its own law, never refused.
  const openingDormer = ref.dormer !== undefined && ownerOf(recipe, ref.subroof).dormers?.[ref.dormer]?.opening;
  if (!openingDormer && slopes.every((slope) => slope === 0)) throw new Error(ref.dormer === undefined ? "O telhado precisa de ao menos uma água." : "A lucarna precisa de ao menos uma água.");
  return withSubroof(recipe, ref.subroof, (owner) => (ref.dormer === undefined ? { ...owner, slopes } : withDormer(owner, ref.dormer, (dormer) => ({
    ...dormer,
    slopes: dormer.opening ? openingDormerSlopes(slopes) : (slopes as unknown as RoofDormer["slopes"]),
  }))));
}

/** `change` made to the roof itself, or to its subroof `k`; a subroof it drops is removed. */
function withSubroof<R extends RoofSource>(recipe: R, k: number | undefined, change: (owner: RoofSource) => RoofSource | undefined): R {
  if (k === undefined) return change(recipe) as R;
  return { ...recipe, subroofs: (recipe.subroofs ?? []).flatMap((child, i) => (i === k ? change(child) ?? [] : [child])) };
}

function withDormer<R extends RoofSource>(recipe: R, k: number, change: (dormer: RoofDormer) => RoofDormer | undefined): R {
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
    const { base: _base, anchors: _anchors, ...rest } = next;
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
      if (intent.kind !== "height" || part.kind !== "whole") return undefined;
      const height = ownerOf(recipe, part.subroof).height + intent.dy;
      // Brought down flat, a subroof is gone and the roof it joined stays.
      if (part.subroof !== undefined) return withSubroof(recipe, part.subroof, (child) => (height < MIN_RISE ? undefined : { ...child, height }));
      return height < MIN_RISE ? null : { ...recipe, height };
    }
    case "slope": {
      if (intent.kind !== "height" || part.kind !== "leaf") return undefined;
      const slopes = slopesOf(recipe, part.of);
      return withSlopes(recipe, part.of, slopes.map((slope, i) => (i === part.of.side ? reslope(slopes, i, intent.dy, ownerOf(recipe, part.of.subroof).height) : slope)));
    }
    case "seam": {
      if (intent.kind !== "height" || part.kind !== "seam") return undefined;
      let next = recipe;
      for (const ref of part.leaves) {
        const slopes = slopesOf(next, ref);
        next = withSlopes(next, ref, slopes.map((slope, i) => (i === ref.side ? reslope(slopesOf(recipe, ref), i, intent.dy, ownerOf(recipe, ref.subroof).height) : slope)));
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
    const recipe = roofRecipeOf(topology);
    return recipe ? { group: recipe.group, recipe } : undefined;
  },
  handles: roofHandles,
  edit: editRoof,
  generate: (port, recipe, operationId, standing) => roofGraphPatch(port, recipe as RoofRecipe, operationId, standing),
};
