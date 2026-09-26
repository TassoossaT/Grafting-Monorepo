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
 * How a structure's end joins a floor, whatever the structure is: the
 * floor's outline is cut at the two nodes of the end's own edge -- its
 * rung -- so both share those nodes and move together, each keeping its own
 * edges. Detaching gives the floor copies of the nodes instead.
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

/** Every loop of `topology`: its outer loops, then its holes. */
const loopsOf = (topology: ConstructionRegionTopology) => [...topology.outerLoops, ...topology.holes];

/**
 * Every floor among `floors` the structure's end `rung` is welded into:
 * the floor's outline passes through both of the rung's nodes. The structure
 * itself -- the face walking the rung's own edge -- is not one.
 */
export function floorsWeldedBy(floors: readonly ConstructionRegionTopology[], rung: WeldRung): readonly ConstructionRegionTopology[] {
  return floors.filter((topology) => {
    const loops = loopsOf(topology).flat();
    if (loops.some((use) => use.edgeId === rung.edgeId)) return false;
    const nodes = new Set(loops.flatMap((use) => [use.startNodeId, use.endNodeId]));
    return nodes.has(rung.startNodeId) && nodes.has(rung.endNodeId);
  });
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

/** A face being changed: its loops -- the outer one first -- and node positions, changed step by step and emitted once. */
interface FaceDraft {
  readonly source: ConstructionRegionTopology;
  loops: Step[][];
  readonly positions: Map<string, ConstructionPosition>;
}

const stepsOf = (loop: readonly ConstructionRegionEdge[]): Step[] =>
  loop.map((use) => ({ edgeId: use.edgeId, from: use.startNodeId, to: use.endNodeId, geometry: use.geometry, reversed: use.reversed }));

function draftOf(topology: ConstructionRegionTopology): FaceDraft {
  return { source: topology, loops: loopsOf(topology).map(stepsOf), positions: new Map(topology.nodes.map((node) => [node.id, node.position])) };
}

/** The draft as a topology again, so the next landing is found on the face as it now stands. */
function asTopology(draft: FaceDraft): ConstructionRegionTopology {
  const use = (step: Step): ConstructionRegionEdge => ({ edgeId: step.edgeId, reversed: step.reversed, startNodeId: step.from, endNodeId: step.to, geometry: step.geometry });
  const outer = draft.source.outerLoops.length;
  const used = new Set(draft.loops.flat().flatMap((step) => [step.from, step.to]));
  return {
    ...draft.source,
    outerLoops: draft.loops.slice(0, outer).map((loop) => loop.map(use)),
    holes: draft.loops.slice(outer).map((loop) => loop.map(use)),
    nodes: [...used].map((id) => ({ id, position: draft.positions.get(id)! })),
  };
}

/** An edge cut at nodes: the pieces it becomes, from its own start to its own end. */
type Split = readonly { readonly edgeId: string; readonly from: string; readonly to: string }[];

/** Every step on a split edge replaced by its pieces, walked the way the step walked the edge. */
function applySplits(draft: FaceDraft, splits: ReadonlyMap<string, Split>): boolean {
  let changed = false;
  draft.loops = draft.loops.map((loop) => loop.flatMap((step): Step[] => {
    const pieces = splits.get(step.edgeId);
    if (!pieces) return [step];
    changed = true;
    const own: Step[] = pieces.map((piece) => ({ edgeId: piece.edgeId, from: piece.from, to: piece.to, geometry: { kind: "line" }, reversed: false }));
    return step.reversed ? own.reverse().map((piece) => ({ ...piece, from: piece.to, to: piece.from, reversed: true })) : own;
  }));
  return changed;
}

/**
 * Where `rung` joins the draft's floor: the straight run it lies on is cut
 * at the rung's two nodes, so the floor's outline passes through them. The
 * edges cut are returned, for every other face on them to be cut alike.
 * `undefined` when it lies on no run, or a rung node would fall on a node
 * the run already has.
 */
function attach(draft: FaceDraft, rung: WeldRung, positions: ReadonlyMap<string, ConstructionPosition>, weldId: string): { readonly splits: ReadonlyMap<string, Split>; readonly adopted: ReadonlyMap<string, string> } | undefined {
  const steps = draft.loops[0] ?? [];
  const at = (id: string) => draft.positions.get(id) ?? positions.get(id)!;
  const runs = straightRuns(steps.length, (i) => steps[i]!.geometry.kind === "line", (i) => ({ a: at(steps[i]!.from), b: at(steps[i]!.to) }));
  const run = runs.find(({ first, count }) => rungFits({ a: at(steps[first]!.from), b: at(steps[(first + count - 1) % steps.length]!.to) }, rung, positions));
  if (!run) return undefined;
  const inRun = Array.from({ length: run.count }, (_, k) => steps[(run.first + k) % steps.length]!);
  const splits = new Map<string, Split>();
  const adopted = new Map<string, string>();
  for (const node of [rung.startNodeId, rung.endNodeId]) {
    const p = positions.get(node)!;
    // A node the run already has right there -- where ground met the floor -- becomes the rung's own.
    const standing = inRun.map((step) => step.to).slice(0, -1).find((id) => Math.hypot(at(id).x - p.x, at(id).z - p.z) < ON_EDGE);
    if (standing !== undefined) {
      adopted.set(standing, node);
      continue;
    }
    // The piece the node falls strictly inside; a node on a piece's own end has no cut to make there.
    const step = inRun.find((candidate) => {
      const a = at(candidate.from), b = at(candidate.to);
      const { t, distance } = projectOnto(a, b, p);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      return distance < ON_EDGE && t * length > ON_EDGE && (1 - t) * length > ON_EDGE;
    });
    if (!step) return undefined;
    // In the edge's own direction; a piece the other rung node already cut is cut again.
    const [start, end] = step.reversed ? [step.to, step.from] : [step.from, step.to];
    draft.positions.set(node, p);
    const along = (id: string) => projectOnto(at(start), at(end), at(id)).t;
    const before = splits.get(step.edgeId) ?? [{ edgeId: step.edgeId, from: start, to: end }];
    splits.set(step.edgeId, before.flatMap((piece) => along(piece.from) < along(node) && along(node) < along(piece.to)
      ? [{ edgeId: `${weldId}:${piece.edgeId}:a`, from: piece.from, to: node }, { edgeId: `${weldId}:${piece.edgeId}:b`, from: node, to: piece.to }]
      : [piece]));
  }
  applySplits(draft, splits);
  return { splits, adopted };
}

/**
 * Joins the two straight steps through `node` into one, in every face of
 * `drafts` alike, so no face passes through it any more -- `false`, with
 * nothing changed, unless every loop through it runs straight on there.
 */
function mergeThrough(drafts: readonly FaceDraft[], node: string, edgeId: string): boolean {
  const passes: { draft: FaceDraft; loop: number; into: number }[] = [];
  for (const draft of drafts) {
    const at = (id: string) => draft.positions.get(id)!;
    for (const [loop, steps] of draft.loops.entries()) {
      for (const [into, step] of steps.entries()) {
        if (step.to !== node) continue;
        const out = steps[(into + 1) % steps.length]!;
        if (step.geometry.kind !== "line" || out.geometry.kind !== "line" || out.from !== node) return false;
        const a = at(step.from), b = at(node), c = at(out.to);
        const u = { x: b.x - a.x, z: b.z - a.z }, v = { x: c.x - b.x, z: c.z - b.z };
        const lengths = Math.hypot(u.x, u.z) * Math.hypot(v.x, v.z);
        if (!(lengths > 0) || Math.abs(u.x * v.z - u.z * v.x) / lengths > IN_LINE || u.x * v.x + u.z * v.z <= 0) return false;
        passes.push({ draft, loop, into });
      }
    }
  }
  if (passes.length === 0) return false;
  const first = passes[0]!;
  const start = first.draft.loops[first.loop]![first.into]!.from;
  for (const { draft, loop, into } of passes) {
    const steps = draft.loops[loop]!;
    const step = steps[into]!, out = steps[(into + 1) % steps.length]!;
    const joined: Step = { edgeId, from: step.from, to: out.to, geometry: { kind: "line" }, reversed: step.from !== start };
    draft.loops[loop] = into + 1 < steps.length
      ? [...steps.slice(0, into), joined, ...steps.slice(into + 2)]
      : [joined, ...steps.slice(1, into)];
  }
  return true;
}

/**
 * Takes the draft's face off `nodes`: each is replaced there by a copy of
 * its own, standing where it stands, and every edge through it by a copy
 * through the copy -- the same copies for every face; `renamed` keeps them.
 */
function release(draft: FaceDraft, nodes: ReadonlySet<string>, operationId: string, renamed: Map<string, string>): boolean {
  return renameNodes(draft, new Map([...nodes].map((id) => [id, `${operationId}:free:${id}`])), `${operationId}:free`, renamed);
}

/**
 * Every node of the draft's face named in `names` replaced by the node it
 * maps to, standing where it stands, and every edge through it by a copy --
 * the same copies for every face; `renamed` keeps them.
 */
function renameNodes(draft: FaceDraft, names: ReadonlyMap<string, string>, prefix: string, renamed: Map<string, string>): boolean {
  const nodes = new Set(names.keys());
  const copy = (id: string) => names.get(id) ?? id;
  let changed = false;
  draft.loops = draft.loops.map((loop) => loop.map((step) => {
    if (!nodes.has(step.from) && !nodes.has(step.to)) return step;
    changed = true;
    let edgeId = renamed.get(step.edgeId);
    if (!edgeId) renamed.set(step.edgeId, edgeId = `${prefix}:${step.edgeId}`);
    return { ...step, edgeId, from: copy(step.from), to: copy(step.to) };
  }));
  for (const id of nodes) {
    const p = draft.positions.get(id);
    if (p && !draft.positions.has(copy(id))) draft.positions.set(copy(id), p);
  }
  return changed;
}

/** What rewelding changes, to add to the patch replacement that carries the structure's own change. */
export interface Rewelding {
  /** The faces changed -- floors, and the ground cut alongside them -- replaced by `regions`. */
  readonly sourceSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly regions: readonly ConstructionPatchRegion[];
  /** Which of the asked-for attachments were made. */
  readonly attached: readonly WeldRung[];
}

export interface WeldChanges {
  /** Rungs to take off whichever floors they are welded into. */
  readonly detach: readonly WeldRung[];
  /** Rungs to weld into a floor, each at the positions its nodes will stand at. */
  readonly attach: readonly { readonly rung: WeldRung; readonly floor: ConstructionSurfaceKey }[];
}

/**
 * Every face among `faces` -- all of them, not only floors -- changed by
 * `changes`, as patch content, detaching first so an end can re-land on the
 * floor it left.
 *
 * A weld only shares nodes: the floor's outline is cut at the rung's two
 * nodes and each keeps its own edges, so the ground laid against the floor
 * keeps its side of them -- cut at the same nodes too. Detaching gives every
 * face but the structure's own a copy of those nodes instead. `positions` is
 * where every rung node will stand; those nodes are the structure's own,
 * left for its own patch to declare.
 */
export function reweldFloors(
  faces: readonly ConstructionRegionTopology[],
  changes: WeldChanges,
  positions: ReadonlyMap<string, ConstructionPosition>,
  operationId: string,
): Rewelding {
  const key = (surfaceKey: ConstructionSurfaceKey) => surfaceKey.join("\u0000");
  const drafts = new Map<string, FaceDraft>();
  const draftFor = (topology: ConstructionRegionTopology) => {
    let draft = drafts.get(key(topology.surfaceKey));
    if (!draft) drafts.set(key(topology.surfaceKey), draft = draftOf(topology));
    return draft;
  };
  const touched = new Set<string>();
  const renamed = new Map<string, string>();
  for (const rung of changes.detach) {
    for (const node of [rung.startNodeId, rung.endNodeId]) {
      const holding = faces.filter((face) => !loopsOf(face).flat().some((use) => use.edgeId === rung.edgeId) && face.nodes.some((candidate) => candidate.id === node));
      if (holding.length === 0) continue;
      for (const face of holding) touched.add(key(face.surfaceKey));
      // The floor's side made whole again where it runs straight through; else a copy of the node of its own.
      if (!mergeThrough(holding.map(draftFor), node, `${operationId}:unweld:${node}`)) {
        for (const face of holding) release(draftFor(face), new Set([node]), operationId, renamed);
      }
    }
  }
  const attached: WeldRung[] = [];
  changes.attach.forEach(({ rung, floor }, i) => {
    const topology = faces.find((candidate) => key(candidate.surfaceKey) === key(floor));
    const joined = topology && attach(draftFor(topology), rung, positions, `${operationId}:weld:${i}`);
    if (!topology || !joined) return;
    attached.push(rung);
    touched.add(key(topology.surfaceKey));
    // Whatever else stands on the edges cut -- the ground against the floor -- is cut at the same nodes.
    for (const face of faces) {
      if (face === topology || !loopsOf(face).flat().some((use) => joined.splits.has(use.edgeId))) continue;
      if (applySplits(draftFor(face), joined.splits)) touched.add(key(face.surfaceKey));
    }
    // And every face through a node the rung took over now passes through the rung's.
    if (joined.adopted.size > 0) {
      for (const face of faces) {
        if (!face.nodes.some((node) => joined.adopted.has(node.id))) continue;
        const draft = draftFor(face);
        for (const [from, to] of joined.adopted) draft.positions.set(to, positions.get(to)!);
        if (renameNodes(draft, joined.adopted, `${operationId}:weld:${i}:adopt`, renamed)) touched.add(key(face.surfaceKey));
      }
    }
  });
  const nodes = new Map<string, ConstructionPosition>();
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  const changed = [...drafts.entries()].filter(([faceKey]) => touched.has(faceKey)).map(([, draft]) => draft);
  changed.forEach((draft, index) => {
    const walk = (loop: readonly Step[]): ConstructionOrientedEdgeUse[] => loop.map((step) => {
      edges.set(step.edgeId, step.reversed
        ? { edgeId: step.edgeId, startNodeId: step.to, endNodeId: step.from, geometry: reverseGeometry(step.geometry) }
        : { edgeId: step.edgeId, startNodeId: step.from, endNodeId: step.to, geometry: step.geometry });
      for (const id of [step.from, step.to]) if (!positions.has(id)) nodes.set(id, draft.positions.get(id)!);
      return { edgeId: step.edgeId, reversed: step.reversed };
    });
    const { source } = draft;
    const outer = source.outerLoops.length;
    regions.push({
      // The face keeps its own name where it has one: the same floor, the same ground.
      regionId: source.surfaceKey[0] === "@region" && source.surfaceKey[1] ? source.surfaceKey[1] : `${operationId}:face:${index}`,
      boundary: walk(draft.loops[0] ?? []),
      holes: draft.loops.slice(outer).map(walk),
      surfaceType: source.surfaceType,
      physical: source.physical,
      ...(source.profile ? { profile: source.profile } : {}),
    });
  });
  return {
    sourceSurfaceKeys: changed.map((draft) => draft.source.surfaceKey),
    nodes: [...nodes].map(([id, position]) => ({ id, position })),
    edges: [...edges.values()],
    regions,
    attached,
  };
}

/** `floors` with the rungs taken off them -- where an end that is about to move looks for its new landing. */
export function floorsWithout(floors: readonly ConstructionRegionTopology[], rungs: readonly WeldRung[]): readonly ConstructionRegionTopology[] {
  return floors.map((topology) => {
    const off = rungs.filter((rung) => floorsWeldedBy([topology], rung).length > 0);
    if (off.length === 0) return topology;
    const draft = draftOf(topology);
    for (const node of off.flatMap((rung) => [rung.startNodeId, rung.endNodeId])) {
      if (!mergeThrough([draft], node, `released:${node}`)) release(draft, new Set([node]), "released", new Map());
    }
    return asTopology(draft);
  });
}
