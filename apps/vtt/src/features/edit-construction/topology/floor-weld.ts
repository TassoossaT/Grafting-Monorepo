import type {
  ConstructionEdgeGeometry,
  ConstructionOrientedEdgeUse,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import { reverseGeometry } from "./boundary-edges.ts";

/**
 * How a structure's end joins a floor, whatever the structure is: the end's
 * own edge -- its rung -- is spliced into one straight edge of the floor's
 * outline, so both faces share it and move together. Detaching takes the
 * rung back out and joins the floor's edge whole again.
 *
 * Nothing here knows ramps, spirals or which types are floors: callers hand
 * in the floors and name the rungs.
 */

/** How far in plan from a floor's edge a point still lands on it -- either side of the edge. */
export const LANDING_REACH = 0.75;
const ON_EDGE = 1e-3;
/** Kept clear of an edge's corners by a rung spliced into it. */
const CORNER_CLEARANCE = 1e-2;

/** Plan direction. */
export interface PlanDirection {
  readonly x: number;
  readonly z: number;
}

/** One straight edge of a floor's outline, as the floor walks it. */
export interface FloorEdge {
  readonly topology: ConstructionRegionTopology;
  readonly use: ConstructionRegionEdge;
  readonly a: ConstructionPosition;
  readonly b: ConstructionPosition;
}

/** Where something meets a floor: the point on its edge, at the floor's height, and the direction off the floor. */
export interface FloorLanding extends FloorEdge {
  readonly point: ConstructionPosition;
  readonly out: PlanDirection;
  readonly height: number;
}

/** A structure's end edge, from one of its end nodes to the other -- what a floor shares when welded. */
export interface WeldRung {
  readonly edgeId: string;
  readonly startNodeId: string;
  readonly endNodeId: string;
}

/** Twice the signed area of a loop in plan -- its winding. */
function signedArea(points: readonly ConstructionPosition[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, q = points[(i + 1) % points.length]!;
    area += p.x * q.z - q.x * p.z;
  }
  return area;
}

/** Straight steps in a row whose directions differ by less than this (sine of the angle) are one straight run. */
const IN_LINE = 1e-4;

/**
 * The loop's straight runs: consecutive straight steps in one line, as the
 * index of their first step and how many there are. Ground laid against a
 * floor splits its edges at the ground's own corners; a run is the edge as
 * drawn, whatever it was split into.
 */
function straightRuns(count: number, isLine: (i: number) => boolean, ends: (i: number) => { readonly a: ConstructionPosition; readonly b: ConstructionPosition }): readonly { readonly first: number; readonly count: number }[] {
  const dir = (i: number) => {
    const { a, b } = ends(i);
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  };
  const continues = (i: number) => {
    const previous = (i - 1 + count) % count;
    if (!isLine(i) || !isLine(previous)) return false;
    const p = dir(previous), q = dir(i);
    return Math.abs(p.x * q.z - p.z * q.x) < IN_LINE && p.x * q.x + p.z * q.z > 0;
  };
  const start = Array.from({ length: count }, (_, i) => i).find((i) => !continues(i));
  // Every step in one line all the way round is no outline at all.
  if (start === undefined) return [];
  const runs: { first: number; count: number }[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = (start + k) % count;
    if (!continues(i)) runs.push({ first: i, count: 0 });
    runs.at(-1)!.count += 1;
  }
  return runs;
}

/** Where `p` projects onto the line through `a` and `b`, as a parameter, and how far off it lies. */
export function projectOnto(a: ConstructionPosition, b: ConstructionPosition, p: PlanDirection): { readonly t: number; readonly distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return { t: -1, distance: Infinity };
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  return { t, distance: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) };
}

/** How far along `edge`, in length units, `point` stands. */
export function alongEdge(edge: Pick<FloorEdge, "a" | "b">, point: PlanDirection): number {
  const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
  return ((point.x - edge.a.x) * dx + (point.z - edge.a.z) * dz) / Math.hypot(dx, dz);
}

/**
 * The floor edge `point` lands on: a straight edge of a floor's outline
 * within `reach` of it in plan, whether it is on the floor or just off it.
 * The floor named `under` -- the one the pointer is on -- wins; otherwise
 * the nearest edge does, and among edges stacked in plan -- storeys -- the
 * one nearest `point`'s own height.
 */
export function floorLandingNear(
  floors: readonly ConstructionRegionTopology[],
  point: ConstructionPosition,
  options: { readonly under?: ConstructionSurfaceKey; readonly reach?: number } = {},
): FloorLanding | undefined {
  const reach = options.reach ?? LANDING_REACH;
  const underKey = options.under?.join("\u0000");
  let best: { landing: FloorLanding; score: number } | undefined;
  for (const topology of floors) {
    const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
    const outer = topology.outerLoops[0] ?? [];
    // The outline's winding says which side of each edge is off the floor.
    const winding = Math.sign(signedArea(outer.map((use) => positions.get(use.startNodeId)!))) || 1;
    const isUnder = underKey !== undefined && topology.surfaceKey.join("\u0000") === underKey;
    const runs = straightRuns(outer.length, (i) => outer[i]!.geometry.kind === "line",
      (i) => ({ a: positions.get(outer[i]!.startNodeId)!, b: positions.get(outer[i]!.endNodeId)! }));
    for (const run of runs) {
      if (outer[run.first]!.geometry.kind !== "line") continue;
      // The run as one edge: from its first step's start to its last step's end.
      const use = outer[run.first]!;
      const a = positions.get(use.startNodeId)!, b = positions.get(outer[(run.first + run.count - 1) % outer.length]!.endNodeId)!;
      const projected = projectOnto(a, b, point);
      if (!Number.isFinite(projected.distance)) continue;
      const t = Math.max(0, Math.min(1, projected.t));
      const on = { x: a.x + (b.x - a.x) * t, y: a.y, z: a.z + (b.z - a.z) * t };
      const distance = Math.hypot(on.x - point.x, on.z - point.z);
      if (distance > reach) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      // Counter-clockwise outline (positive area): the right-hand normal points out.
      const out = { x: ((b.z - a.z) / length) * winding, z: (-(b.x - a.x) / length) * winding };
      const score = (isUnder ? 0 : 1000) + distance + Math.abs(a.y - point.y) * 0.1;
      if (best && best.score <= score) continue;
      best = { landing: { topology, use, a, b, point: on, out, height: a.y }, score };
    }
  }
  return best?.landing;
}

/** Whether both nodes of `rung`, at `positions`, lie on `edge` strictly between its corners. */
export function rungFits(edge: Pick<FloorEdge, "a" | "b">, rung: WeldRung, positions: ReadonlyMap<string, ConstructionPosition>): boolean {
  const length = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
  return [rung.startNodeId, rung.endNodeId].every((id) => {
    const p = positions.get(id);
    if (!p) return false;
    const { t, distance } = projectOnto(edge.a, edge.b, p);
    return distance < ON_EDGE && Math.abs(p.y - edge.a.y) < ON_EDGE && t * length > CORNER_CLEARANCE && (1 - t) * length > CORNER_CLEARANCE;
  });
}

/** Every floor among `floors` whose outline shares the edge `edgeId` -- what an end welded by that rung is joined to. */
export function floorsWeldedBy(floors: readonly ConstructionRegionTopology[], edgeId: string): readonly ConstructionRegionTopology[] {
  return floors.filter((topology) => [...topology.outerLoops, ...topology.holes].some((loop) => loop.some((use) => use.edgeId === edgeId)));
}

/** One step of a loop, in the direction the loop walks it. */
interface Step {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly geometry: ConstructionEdgeGeometry;
  /** Whether the walk runs against the edge's own direction. */
  readonly reversed: boolean;
}

/** A floor being rewelded: its steps and node positions, changed step by step and emitted once. */
interface FloorDraft {
  readonly source: ConstructionRegionTopology;
  outer: Step[];
  readonly holes: readonly Step[][];
  readonly positions: Map<string, ConstructionPosition>;
}

const stepsOf = (loop: readonly ConstructionRegionEdge[]): Step[] =>
  loop.map((use) => ({ edgeId: use.edgeId, from: use.startNodeId, to: use.endNodeId, geometry: use.geometry, reversed: use.reversed }));

function draftOf(topology: ConstructionRegionTopology): FloorDraft {
  return {
    source: topology,
    outer: stepsOf(topology.outerLoops[0] ?? []),
    holes: topology.holes.map(stepsOf),
    positions: new Map(topology.nodes.map((node) => [node.id, node.position])),
  };
}

/** The draft as a topology again, so the next landing is found on the floor as it now stands. */
function asTopology(draft: FloorDraft): ConstructionRegionTopology {
  const use = (step: Step): ConstructionRegionEdge => ({ edgeId: step.edgeId, reversed: step.reversed, startNodeId: step.from, endNodeId: step.to, geometry: step.geometry });
  const used = new Set([...draft.outer, ...draft.holes.flat()].flatMap((step) => [step.from, step.to]));
  return {
    ...draft.source,
    outerLoops: [draft.outer.map(use)],
    holes: draft.holes.map((loop) => loop.map(use)),
    nodes: [...used].map((id) => ({ id, position: draft.positions.get(id)! })),
  };
}

/**
 * Takes the rung `edgeId` back out of the draft: the rung and the straight
 * steps either side of it -- unless another structure is welded along them
 * too (`shared`) -- become one straight step. `false` when the rung is not
 * on this floor.
 */
function detach(draft: FloorDraft, edgeId: string, joinId: string, shared: ReadonlySet<string>): boolean {
  const steps = draft.outer;
  const i = steps.findIndex((step) => step.edgeId === edgeId);
  if (i < 0) return false;
  const n = steps.length;
  const prev = steps[(i - 1 + n) % n]!, next = steps[(i + 1) % n]!;
  const mergesPrev = n > 3 && prev.geometry.kind === "line" && !shared.has(prev.edgeId);
  const mergesNext = n > 3 && next.geometry.kind === "line" && !shared.has(next.edgeId) && next !== prev;
  const joined: Step = { edgeId: joinId, from: mergesPrev ? prev.from : steps[i]!.from, to: mergesNext ? next.to : steps[i]!.to, geometry: { kind: "line" }, reversed: false };
  const drop = new Set([i, ...(mergesPrev ? [(i - 1 + n) % n] : []), ...(mergesNext ? [(i + 1) % n] : [])]);
  const kept: Step[] = [];
  for (let k = 0; k < n; k += 1) {
    if (k === i) kept.push(joined);
    else if (!drop.has(k)) kept.push(steps[k]!);
  }
  draft.outer = kept;
  return true;
}

/**
 * Splices `rung` into the straight run of the draft it lies on: the steps it
 * covers give way to it, the ones it only partly covers are cut short at its
 * ends by two new steps named from `weldId`, and every other step -- ground
 * laid against the floor still holds them -- stays as it is. `false` when it
 * lies on no run.
 */
function attach(draft: FloorDraft, rung: WeldRung, positions: ReadonlyMap<string, ConstructionPosition>, weldId: string): boolean {
  const steps = draft.outer;
  const at = (id: string) => draft.positions.get(id)!;
  const runs = straightRuns(steps.length, (i) => steps[i]!.geometry.kind === "line", (i) => ({ a: at(steps[i]!.from), b: at(steps[i]!.to) }));
  const run = runs.find(({ first, count }) => rungFits({ a: at(steps[first]!.from), b: at(steps[(first + count - 1) % steps.length]!.to) }, rung, positions));
  if (!run) return false;
  // Turned so the run starts the loop: it may wrap past the loop's first step.
  const turned = [...steps.slice(run.first), ...steps.slice(0, run.first)];
  const a = at(turned[0]!.from), b = at(turned[run.count - 1]!.to);
  const along = (p: ConstructionPosition) => projectOnto(a, b, p).t;
  const t = (id: string) => along(positions.get(id)!);
  const [first, second] = t(rung.startNodeId) <= t(rung.endNodeId) ? [rung.startNodeId, rung.endNodeId] : [rung.endNodeId, rung.startNodeId];
  const tFirst = t(first), tSecond = t(second);
  // The step each rung end falls in.
  const i = turned.slice(0, run.count).findIndex((step) => along(at(step.to)) > tFirst);
  const j = turned.slice(0, run.count).findIndex((step) => along(at(step.to)) >= tSecond);
  if (i < 0 || j < 0 || j < i) return false;
  draft.outer = [
    ...turned.slice(0, i),
    { edgeId: `${weldId}:before`, from: turned[i]!.from, to: first, geometry: { kind: "line" }, reversed: false },
    { edgeId: rung.edgeId, from: first, to: second, geometry: { kind: "line" }, reversed: first !== rung.startNodeId },
    { edgeId: `${weldId}:after`, from: second, to: turned[j]!.to, geometry: { kind: "line" }, reversed: false },
    ...turned.slice(j + 1),
  ];
  for (const id of [first, second]) draft.positions.set(id, positions.get(id)!);
  return true;
}

/** What rewelding changes, to add to the patch replacement that carries the structure's own change. */
export interface Rewelding {
  /** The floors changed -- replaced by `regions`. */
  readonly sourceSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly regions: readonly ConstructionPatchRegion[];
  /** Which of the asked-for attachments were made. */
  readonly attached: readonly WeldRung[];
}

export interface WeldChanges {
  /** Rungs to take back out of whichever floors share them. */
  readonly detach: readonly string[];
  /** Rungs to splice into a floor, each at the positions its nodes will stand at. */
  readonly attach: readonly { readonly rung: WeldRung; readonly floor: ConstructionSurfaceKey }[];
}

/**
 * The floors among `floors` changed by `changes`, as patch content, detaching
 * first so an end can re-land on the floor it left. `positions` is where
 * every rung node will stand; those nodes are the structure's own, so they
 * are left for its own patch to declare. `shared` names every edge another
 * structure is welded along, which detaching must not swallow.
 */
export function reweldFloors(
  floors: readonly ConstructionRegionTopology[],
  changes: WeldChanges,
  positions: ReadonlyMap<string, ConstructionPosition>,
  operationId: string,
  shared: ReadonlySet<string> = new Set(),
): Rewelding {
  const key = (surfaceKey: ConstructionSurfaceKey) => surfaceKey.join("\u0000");
  const drafts = new Map<string, FloorDraft>();
  const draftFor = (topology: ConstructionRegionTopology) => {
    let draft = drafts.get(key(topology.surfaceKey));
    if (!draft) drafts.set(key(topology.surfaceKey), draft = draftOf(topology));
    return draft;
  };
  changes.detach.forEach((edgeId, i) => {
    for (const floor of floorsWeldedBy(floors, edgeId)) detach(draftFor(floor), edgeId, `${operationId}:unweld:${i}`, shared);
  });
  const attached: WeldRung[] = [];
  changes.attach.forEach(({ rung, floor }, i) => {
    const topology = floors.find((candidate) => key(candidate.surfaceKey) === key(floor));
    if (topology && attach(draftFor(topology), rung, positions, `${operationId}:weld:${i}`)) attached.push(rung);
  });
  const nodes = new Map<string, ConstructionPosition>();
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  let index = 0;
  for (const draft of drafts.values()) {
    const walk = (loop: readonly Step[]): ConstructionOrientedEdgeUse[] => loop.map((step) => {
      edges.set(step.edgeId, step.reversed
        ? { edgeId: step.edgeId, startNodeId: step.to, endNodeId: step.from, geometry: reverseGeometry(step.geometry) }
        : { edgeId: step.edgeId, startNodeId: step.from, endNodeId: step.to, geometry: step.geometry });
      for (const id of [step.from, step.to]) if (!positions.has(id)) nodes.set(id, draft.positions.get(id)!);
      return { edgeId: step.edgeId, reversed: step.reversed };
    });
    const { source } = draft;
    regions.push({
      regionId: `${operationId}:floor:${index++}`,
      boundary: walk(draft.outer),
      holes: draft.holes.map(walk),
      surfaceType: source.surfaceType,
      physical: source.physical,
      ...(source.profile ? { profile: source.profile } : {}),
    });
  }
  return {
    sourceSurfaceKeys: [...drafts.values()].map((draft) => draft.source.surfaceKey),
    nodes: [...nodes].map(([id, position]) => ({ id, position })),
    edges: [...edges.values()],
    regions,
    attached,
  };
}

/** `floors` with the rungs `edgeIds` taken back out -- where an end that is about to move looks for its new landing. */
export function floorsWithout(floors: readonly ConstructionRegionTopology[], edgeIds: readonly string[], shared: ReadonlySet<string> = new Set()): readonly ConstructionRegionTopology[] {
  return floors.map((topology) => {
    const touched = edgeIds.filter((edgeId) => floorsWeldedBy([topology], edgeId).length > 0);
    if (touched.length === 0) return topology;
    const draft = draftOf(topology);
    touched.forEach((edgeId, i) => detach(draft, edgeId, `detached:${i}`, shared));
    return asTopology(draft);
  });
}

/** Every edge id at least two of `topologies` share -- where something is welded to something else. */
export function sharedEdgeIds(topologies: readonly ConstructionRegionTopology[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const topology of topologies) {
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) counts.set(use.edgeId, (counts.get(use.edgeId) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([edgeId]) => edgeId));
}
