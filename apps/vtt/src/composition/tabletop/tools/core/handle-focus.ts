import { curvePick, globalHandleOf, isSpineEdge, spineComponent, spineMemberOf, structureTypeFor, type HandleFocus } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import { spineBodyTarget } from "./spine-body-target.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/**
 * Which structure's handles show: the one under the pointer, else the one
 * it passes nearest, within {@link REACH} -- the handles stand just outside
 * a structure, so coming up to it from outside shows them as well as
 * crossing it does. The focus holds while the pointer is on one of them, or
 * still within {@link KEEP} of the structure on its way to one -- and moves
 * on as soon as it is over another structure.
 */

/** How far outside a focused structure, in plan, the pointer may go and keep its handles showing. */
const KEEP = 1.8;
/** How close the pointer's ray must pass to a structure -- its outline, or the upright through its middle -- to show its handles. */
const REACH = 1.2;
/** How high above a structure's middle the handles standing over it reach. */
const ABOVE = 2;

const keyOf = (surfaceKey: readonly string[]) => surfaceKey.join("\u0000");
export const NO_FOCUS: HandleFocus = Object.freeze({ faces: new Set<string>(), spineNodes: new Set<string>() });

/** Whether `p` is inside `ring` in plan. */
function insideRing(ring: readonly ConstructionPosition[], p: { readonly x: number; readonly z: number }): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Where the pointer's ray first meets the face `topology` -- its plane, within
 * its outline and out of its holes -- as the distance along the ray and the
 * point; `undefined` when it passes by. The face's own geometry is asked, not
 * whatever the renderer's pick met first: a ramp lying on the ground, or a
 * floor the ground was cut round, is found under the pointer all the same.
 */
function rayMeets(sample: PointerSample, topology: ConstructionRegionTopology): { readonly t: number; readonly point: ConstructionPosition } | undefined {
  const ray = sample.ray;
  if (!ray) return undefined;
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const ringOf = (loop: ConstructionRegionTopology["outerLoops"][number]) => loop.map((use) => at.get(use.startNodeId)!);
  const outer = topology.outerLoops.map(ringOf);
  const points = outer.flat();
  if (points.length < 3) return undefined;
  // The face's plane, by Newell's method over its outline.
  let nx = 0, ny = 0, nz = 0;
  for (const ring of outer) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12) return undefined;
  const n = { x: nx / length, y: ny / length, z: nz / length };
  const p0 = points[0]!;
  const facing = n.x * ray.direction.x + n.y * ray.direction.y + n.z * ray.direction.z;
  if (Math.abs(facing) < 1e-9) return undefined;
  const t = (n.x * (p0.x - ray.origin.x) + n.y * (p0.y - ray.origin.y) + n.z * (p0.z - ray.origin.z)) / facing;
  if (t <= 0) return undefined;
  const point = { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: ray.origin.z + ray.direction.z * t };
  if (!outer.some((ring) => insideRing(ring, point)) || topology.holes.map(ringOf).some((ring) => insideRing(ring, point))) return undefined;
  return { t, point };
}

/** The face of a type `owns` accepts that `sample` is over: the nearest its ray meets, else the one the renderer's pick met. */
function faceUnder(ctx: ToolContext, sample: PointerSample, owns: (surfaceType: string) => boolean): { readonly topology: ConstructionRegionTopology; readonly point: ConstructionPosition } | undefined {
  const owned = ctx.runtime.getAllRegionTopologies().filter((topology) => owns(topology.surfaceType));
  let best: { topology: ConstructionRegionTopology; point: ConstructionPosition; t: number } | undefined;
  for (const topology of owned) {
    const met = rayMeets(sample, topology);
    if (met && (!best || met.t < best.t)) best = { topology, ...met };
  }
  if (best) return best;
  const picked = sample.surfaceRef === undefined ? undefined : owned.find((candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === sample.surfaceRef);
  return picked && { topology: picked, point: sample.point };
}

/** Where on the segment `a`-`b` the ray passes nearest, how near, and how far along the ray. */
function rayToSegment(ray: NonNullable<PointerSample["ray"]>, a: ConstructionPosition, b: ConstructionPosition): { readonly distance: number; readonly point: ConstructionPosition; readonly t: number } {
  const d = ray.direction, e = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, w = { x: ray.origin.x - a.x, y: ray.origin.y - a.y, z: ray.origin.z - a.z };
  const dot = (u: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) => u.x * v.x + u.y * v.y + u.z * v.z;
  const dd = dot(d, d), de = dot(d, e), ee = dot(e, e), dw = dot(d, w), ew = dot(e, w);
  const denominator = dd * ee - de * de;
  // Along the segment, then back along the ray, each clamped to its own extent.
  let u = ee < 1e-12 ? 0 : Math.min(1, Math.max(0, denominator < 1e-12 ? ew / ee : (dd * ew - de * dw) / denominator));
  const t = Math.max(0, (de * u - dw) / dd);
  if (ee >= 1e-12) u = Math.min(1, Math.max(0, (t * de + ew) / ee));
  const point = { x: a.x + e.x * u, y: a.y + e.y * u, z: a.z + e.z * u };
  const on = { x: ray.origin.x + d.x * t, y: ray.origin.y + d.y * t, z: ray.origin.z + d.z * t };
  return { distance: Math.hypot(on.x - point.x, on.y - point.y, on.z - point.z), point, t };
}

/**
 * The face of a type `owns` accepts whose outline -- or the upright through
 * its middle, where the handles over it stand -- the pointer's ray passes
 * nearest, within {@link REACH}; with the point of the outline it passed nearest.
 * Of two as near -- a wall standing on a floor's edge -- the one the ray
 * reaches first, nearest the viewer.
 */
function faceNear(ctx: ToolContext, sample: PointerSample, owns: (surfaceType: string) => boolean): { readonly topology: ConstructionRegionTopology; readonly point: ConstructionPosition } | undefined {
  const ray = sample.ray;
  if (!ray) return undefined;
  let best: { topology: ConstructionRegionTopology; point: ConstructionPosition; distance: number; t: number } | undefined;
  const nearer = (a: { distance: number; t: number }, b: { distance: number; t: number } | undefined) => !b || a.distance < b.distance - 1e-6 || (a.distance <= b.distance + 1e-6 && a.t < b.t);
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    if (!owns(topology.surfaceType) || topology.nodes.length === 0) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    let nearest: { distance: number; point: ConstructionPosition; t: number } | undefined;
    for (const use of topology.outerLoops.flat()) {
      const met = rayToSegment(ray, at.get(use.startNodeId)!, at.get(use.endNodeId)!);
      if (nearer(met, nearest)) nearest = met;
    }
    if (!nearest) continue;
    const points = topology.nodes.map((node) => node.position);
    const middle = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: Math.max(...points.map((p) => p.y)), z: points.reduce((sum, p) => sum + p.z, 0) / points.length };
    const over = rayToSegment(ray, middle, { ...middle, y: middle.y + ABOVE });
    const reached = nearer(over, nearest) ? { ...over, point: nearest.point } : nearest;
    if (reached.distance <= REACH && nearer(reached, best)) best = { topology, ...reached };
  }
  return best;
}

/** The structure of a type `owns` accepts found by `find` -- the one `sample` is over, or passes nearest -- if any. */
function focusOn(ctx: ToolContext, sample: PointerSample, owns: (surfaceType: string) => boolean, find: typeof faceUnder): HandleFocus | undefined {
  const under = find(ctx, sample, owns);
  if (!under) return undefined;
  const { topology } = under;
  if (structureTypeFor(topology.surfaceType)?.spine === undefined) return { faces: new Set([keyOf(topology.surfaceKey)]), spineNodes: new Set() };
  const body = spineBodyTarget(ctx, { ...sample, point: under.point, surfaceRef: surfaceRefFromNodeSet(topology.surfaceKey) }, undefined, owns);
  if (!body?.sample.nodeId) return undefined;
  const graph = ctx.runtime.getGraphSnapshot();
  const spans = spineComponent(graph, [spineMemberOf(graph, body.sample.nodeId)]).edges.filter(isSpineEdge);
  return { faces: new Set(), spineNodes: new Set(spans.flatMap((span) => [span.startNodeId, span.endNodeId])) };
}

/** Every point of the focused structure, where it stands. */
function focusPoints(ctx: ToolContext, focus: HandleFocus): readonly ConstructionPosition[] {
  const faces = ctx.runtime.getAllRegionTopologies().filter((topology) => focus.faces.has(keyOf(topology.surfaceKey)));
  const nodes = faces.flatMap((face) => face.nodes.map((node) => node.position));
  if (focus.spineNodes.size === 0) return nodes;
  return [...nodes, ...ctx.runtime.getGraphSnapshot().nodes.filter((node) => focus.spineNodes.has(node.id)).map((node) => node.position)];
}

/** Whether the pointer is still within reach of `focus`'s handles, around the structure in plan. */
function near(ctx: ToolContext, sample: PointerSample, focus: HandleFocus): boolean {
  const points = focusPoints(ctx, focus);
  if (points.length === 0) return false;
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
  const at = sample.ray ? pointerAtHeight(sample, points.reduce((sum, p) => sum + p.y, 0) / points.length) : sample.point;
  return at.x >= min.x - KEEP && at.x <= max.x + KEEP && at.z >= min.z - KEEP && at.z <= max.z + KEEP;
}

/**
 * The focus after the pointer moved to `sample`: the structure it is over,
 * else the one it was on while it stays on that one's handles or near it,
 * else the one it comes within reach of, else none.
 */
export function handleFocusAt(ctx: ToolContext, sample: PointerSample | undefined, previous: HandleFocus, owns: (surfaceType: string) => boolean): HandleFocus {
  if (!sample) return NO_FOCUS;
  const focus = focusFrom(ctx, sample, previous, owns);
  // Where the viewer looks, in steps of 15 degrees: a handle's side shows or hides only as the camera really turns.
  const look = sample.forward;
  if (!look || Math.hypot(look.x, look.z) < 1e-6 || focus === NO_FOCUS) return focus;
  const heading = Math.round(Math.atan2(look.z, look.x) / (Math.PI / 12)) * (Math.PI / 12);
  return { ...focus, viewer: { x: Math.cos(heading), z: Math.sin(heading) } };
}

function focusFrom(ctx: ToolContext, sample: PointerSample, previous: HandleFocus, owns: (surfaceType: string) => boolean): HandleFocus {
  // On a handle: whatever it belongs to stays in focus.
  if (sample.nodeId && (globalHandleOf(sample.nodeId) || curvePick(sample.nodeId))) return previous;
  const under = focusOn(ctx, sample, owns, faceUnder);
  if (under) return under;
  if (sample.nodeId && previous.spineNodes.has(sample.nodeId)) return previous;
  if ((previous.faces.size > 0 || previous.spineNodes.size > 0) && near(ctx, sample, previous)) return previous;
  // Over none and away from the last: the one it comes up to.
  return focusOn(ctx, sample, owns, faceNear) ?? NO_FOCUS;
}

/** Whether two foci show the same handles. */
export function sameFocus(a: HandleFocus | undefined, b: HandleFocus | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.faces.size !== b.faces.size || a.spineNodes.size !== b.spineNodes.size) return false;
  if (Math.hypot((a.viewer?.x ?? 0) - (b.viewer?.x ?? 0), (a.viewer?.z ?? 0) - (b.viewer?.z ?? 0)) > 1e-6) return false;
  return [...a.faces].every((key) => b.faces.has(key)) && [...a.spineNodes].every((id) => b.spineNodes.has(id));
}
