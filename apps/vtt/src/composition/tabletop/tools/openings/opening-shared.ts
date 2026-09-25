import type { OpeningShape } from "@/features/edit-construction";
import type {
  ConstructionHostPoint,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPinEdgeCurveRequest,
  ConstructionPinRequest,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionRunPanel,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import {
  clipPathToStrip,
  hasTrait,
  mapPath,
  openingPath,
  openingStructureType,
  pointAt,
  reversePath,
  segmentExtremes,
  shapeFromProps,
  shapeProps,
  splitSegment,
  startAtLowest,
  type OutlineSegment,
} from "../../../../features/edit-construction/index.ts";

import { boundaryUsage, createBoundaryEdges } from "../core/boundary-edges.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { commitChange } from "../../effects/effect-commit.ts";
import { shapeChangeOfAddition } from "../../effects/shape-change.ts";

/**
 * What creating, moving, resizing and deleting an opening share. An opening
 * is a group of pieces, one per upright face it covers; each piece is its
 * own region whose nodes are pinned to that one face in relative `(u, v)`.
 * The tool edits the group in RUN space: `s` is the arc length along the
 * chain of faces the engine reports (`panelRun`), `v` the fraction of local
 * height -- continuous across a seam, since neighbouring faces share it.
 */

/** How much wall (world units) must be left standing at either end of a run, and above and below an opening. */
export const MARGIN = 0.15;
/** A cut edge closer than this (world units) past a seam is moved onto it, so no sliver piece is left on the far face. */
const SEAM_SNAP = 0.02;
const PIECE_EPS = 1e-6;

/** An axis-aligned rectangle in one face's `(u, v)` frame. */
interface HostRect {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

/** An axis-aligned rectangle in a run's `(s, v)` frame; `s` is in world units. */
export interface RunRect {
  readonly s0: number;
  readonly s1: number;
  readonly v0: number;
  readonly v1: number;
}

type RunRuntime = Pick<ToolContext["runtime"], "projectToHost" | "resolveOnHost" | "panelRun">;

/** One face measured through the engine's own resolve, so the tool never duplicates the mesher's frame. */
interface HostFrame {
  readonly hostSurfaceKey: ConstructionSurfaceKey;
  /** World length of the face's base run. */
  readonly length: number;
  /** World height of the face at `u`. */
  heightAt(u: number): number;
  /** The smallest world height over `[u0, u1]`. */
  minHeightBetween(u0: number, u1: number): number;
  resolve(uv: readonly (readonly [number, number])[]): readonly ConstructionPosition[];
  project(points: readonly ConstructionPosition[]): readonly ConstructionHostPoint[];
}

interface RunPanelFrame extends ConstructionRunPanel {
  readonly ref: string;
  readonly frame: HostFrame;
}

/** One face's share of a run rectangle: its bounds, and its outline as straight and cubic segments counter-clockwise in the face's `(u, v)`. */
export interface OpeningPiece {
  readonly panel: RunPanelFrame;
  readonly rect: HostRect;
  readonly path: readonly OutlineSegment[];
}

export interface RunFrame {
  readonly panels: readonly RunPanelFrame[];
  readonly closed: boolean;
  readonly start: number;
  readonly end: number;
  panelOf(surfaceKey: ConstructionSurfaceKey): RunPanelFrame | undefined;
  sOf(panel: RunPanelFrame, u: number): number;
  /** Where `point` lands on the run; `hint` is tried first. */
  project(point: ConstructionPosition, hint?: ConstructionSurfaceKey): { readonly s: number; readonly v: number } | undefined;
  heightAt(s: number): number;
  minHeightBetween(s0: number, s1: number): number;
  resolveAt(s: number, v: number): ConstructionPosition;
  /** `rect`, outlined by `shape`, split at the seams: one piece per face it covers -- `undefined` when a closed run would make it overlap itself. */
  pieces(rect: RunRect, shape?: OpeningShape): readonly OpeningPiece[] | undefined;
}

const HEIGHT_SAMPLES = 6;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const distance = (a: ConstructionPosition, b: ConstructionPosition): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function panelFrame(runtime: RunRuntime, hostSurfaceKey: ConstructionSurfaceKey, length: number): HostFrame {
  const resolve = (uv: readonly (readonly [number, number])[]) => runtime.resolveOnHost({ hostSurfaceKey, uv });
  const heightsAt = (us: readonly number[]): number[] => {
    const ends = resolve(us.flatMap((u) => [[u, 0] as const, [u, 1] as const]));
    return us.map((_, index) => distance(ends[2 * index]!, ends[2 * index + 1]!));
  };
  return {
    hostSurfaceKey,
    length,
    heightAt: (u) => heightsAt([u])[0]!,
    minHeightBetween: (u0, u1) =>
      Math.min(...heightsAt(Array.from({ length: HEIGHT_SAMPLES + 1 }, (_, index) => u0 + ((u1 - u0) * index) / HEIGHT_SAMPLES))),
    resolve,
    project: (points) => (points.length === 0 ? [] : runtime.projectToHost({ hostSurfaceKey, points })),
  };
}

/** The run through `surfaceKey` -- `undefined` when it is not an upright face that accepts cuts. */
export function runFrame(runtime: RunRuntime, surfaceKey: ConstructionSurfaceKey): RunFrame | undefined {
  let wire;
  try {
    wire = runtime.panelRun(surfaceKey);
  } catch {
    return undefined;
  }
  const panels: RunPanelFrame[] = wire.panels
    .filter((panel) => panel.length > 1e-9)
    .map((panel) => ({ ...panel, ref: surfaceRefFromNodeSet(panel.surfaceKey), frame: panelFrame(runtime, panel.surfaceKey, panel.length) }))
    .sort((a, b) => a.offset - b.offset);
  if (panels.length === 0) return undefined;
  const start = panels[0]!.offset;
  const end = Math.max(...panels.map((panel) => panel.offset + panel.length));
  const period = end - start;
  const byRef = new Map(panels.map((panel) => [panel.ref, panel]));

  const sOf = (panel: RunPanelFrame, u: number) => panel.offset + (panel.reversed ? 1 - u : u) * panel.length;
  const uOf = (panel: RunPanelFrame, s: number) => {
    const t = (s - panel.offset) / panel.length;
    return panel.reversed ? 1 - t : t;
  };
  const wrap = (s: number) => (wire.closed ? start + ((((s - start) % period) + period) % period) : s);
  /** The face `s` falls on, extrapolated past a free end. */
  const locate = (s: number): { readonly panel: RunPanelFrame; readonly u: number } => {
    const at = wrap(s);
    const panel = panels.find((candidate) => at <= candidate.offset + candidate.length) ?? panels[panels.length - 1]!;
    return { panel, u: uOf(panel, at) };
  };

  const heightAt = (s: number) => {
    const { panel, u } = locate(s);
    return panel.frame.heightAt(clamp01(u));
  };

  const pieces = (rect: RunRect, shape?: OpeningShape): OpeningPiece[] | undefined => {
    const shifts = wire.closed ? [-period, 0, period] : [0];
    const outline = runOutline(rect, shape, heightAt((rect.s0 + rect.s1) / 2));
    const out: OpeningPiece[] = [];
    for (const panel of panels) {
      let found = 0;
      for (const shift of shifts) {
        const a = Math.max(rect.s0, panel.offset + shift);
        const b = Math.min(rect.s1, panel.offset + panel.length + shift);
        if (b - a <= PIECE_EPS) continue;
        const clipped = atLeastThree(clipPathToStrip(outline, a, b));
        if (clipped === undefined) continue;
        found += 1;
        const onFace = mapPath(clipped, ([s, v]) => [uOf(panel, s - shift), v]).map(clampEnds);
        const path = startAtLowest(panel.reversed ? reversePath(onFace) : onFace);
        const extremes = path.flatMap(segmentExtremes);
        const us = extremes.map(([u]) => u);
        const vs = extremes.map(([, v]) => v);
        out.push({ panel, rect: { u0: Math.max(0, Math.min(...us)), u1: Math.min(1, Math.max(...us)), v0: Math.min(...vs), v1: Math.max(...vs) }, path });
      }
      if (found > 1) return undefined;
    }
    return out;
  };

  return {
    panels,
    closed: wire.closed,
    start,
    end,
    panelOf: (key) => byRef.get(surfaceRefFromNodeSet(key)),
    sOf,
    project(point, hint) {
      const hinted = hint === undefined ? undefined : byRef.get(surfaceRefFromNodeSet(hint));
      const order = hinted === undefined ? panels : [hinted, ...panels.filter((panel) => panel !== hinted)];
      let best: { readonly panel: RunPanelFrame; readonly u: number; readonly v: number; readonly distance: number } | undefined;
      for (const panel of order) {
        let at: ConstructionHostPoint | undefined;
        try {
          at = panel.frame.project([point])[0];
        } catch {
          continue;
        }
        if (at === undefined) continue;
        const [onFace] = panel.frame.resolve([[clamp01(at.u), at.v]]);
        const gap = distance(point, onFace!);
        if (best === undefined || gap < best.distance - 1e-9) best = { panel, u: at.u, v: at.v, distance: gap };
        // The hinted face already holds the point: no other face can be closer.
        if (panel === hinted && at.u >= 0 && at.u <= 1 && gap < 1e-3) break;
      }
      return best === undefined ? undefined : { s: sOf(best.panel, best.u), v: best.v };
    },
    heightAt,
    minHeightBetween(s0, s1) {
      const split = pieces({ s0, s1, v0: 0, v1: 1 });
      if (split === undefined || split.length === 0) return heightAt((s0 + s1) / 2);
      return Math.min(...split.map((piece) => piece.panel.frame.minHeightBetween(piece.rect.u0, piece.rect.u1)));
    },
    resolveAt(s, v) {
      const { panel, u } = locate(s);
      return panel.frame.resolve([[clamp01(u), v]])[0]!;
    },
    pieces,
  };
}

/** `rect`'s outline in run `(s, v)`: the shape is drawn in world meters, `height` being the wall's height across it. */
function runOutline(rect: RunRect, shape: OpeningShape | undefined, height: number): OutlineSegment[] {
  const width = rect.s1 - rect.s0;
  const dv = rect.v1 - rect.v0;
  const tall = dv * (height > 0 ? height : 1);
  return mapPath(openingPath(shape, width, tall), ([x, y]) => [rect.s0 + x, rect.v0 + (tall > 0 ? (y / tall) * dv : 0)]);
}

function clampEnds(segment: OutlineSegment): OutlineSegment {
  const clamp = ([u, v]: readonly [number, number]) => [clamp01(u), v] as const;
  return { ...segment, from: clamp(segment.from), to: clamp(segment.to) };
}

/** A closed path of at least three segments -- two would name the same node pair twice -- or `undefined` when it bounds nothing. */
function atLeastThree(path: readonly OutlineSegment[]): readonly OutlineSegment[] | undefined {
  if (path.length >= 3) return path;
  const curved = path.findIndex((segment) => segment.controls !== undefined);
  if (curved < 0) return undefined;
  return [...path.slice(0, curved), ...splitSegment(path[curved]!, 0.5), ...path.slice(curved + 1)];
}

/** The shape an opening group carries, read from any piece's property bag. */
export function shapeOfGroup(pieces: readonly ConstructionRegionTopology[]): OpeningShape {
  const carrier = pieces.find((piece) => piece.props !== undefined);
  return shapeFromProps(carrier?.props);
}

/** Interior seams, in run distance: every face start but a free end's. */
function seamsOf(run: RunFrame): number[] {
  const seams = run.panels.map((panel) => panel.offset);
  return run.closed ? seams : seams.slice(1);
}

/**
 * `rect` with an edge that falls just past a seam moved onto it, so no
 * sliver piece is left on the neighbouring face. `keepWidth` shifts the
 * whole rect instead of moving one edge.
 */
function snapToSeams(run: RunFrame, rect: RunRect, keepWidth: boolean): RunRect {
  const shifts = run.closed ? [-(run.end - run.start), 0, run.end - run.start] : [0];
  const seams = seamsOf(run).flatMap((seam) => shifts.map((shift) => seam + shift));
  const nearLeft = seams.find((seam) => seam > rect.s0 && seam - rect.s0 < SEAM_SNAP);
  if (nearLeft !== undefined) {
    return keepWidth ? { ...rect, s0: nearLeft, s1: rect.s1 + (nearLeft - rect.s0) } : { ...rect, s0: nearLeft };
  }
  const nearRight = seams.find((seam) => seam < rect.s1 && rect.s1 - seam < SEAM_SNAP);
  if (nearRight !== undefined) {
    return keepWidth ? { ...rect, s0: rect.s0 - (rect.s1 - nearRight), s1: nearRight } : { ...rect, s1: nearRight };
  }
  return rect;
}

/**
 * `rect` settled on the run: an edge just past a seam snapped onto it, then
 * repositioned (never resized) to keep {@link MARGIN} of wall at the run's
 * ends and above and below -- `undefined` when it cannot fit at all. A door
 * keeps `v0 = 0`: it sits on the floor. A closed run has no ends, but a
 * rect may not reach round onto itself.
 */
export function settleRect(run: RunFrame, rect: RunRect, isDoor: boolean, keepWidth = true): RunRect | undefined {
  const snapped = snapToSeams(run, rect, keepWidth);
  const ds = snapped.s1 - snapped.s0;
  const length = run.end - run.start;
  if (!(ds > 0) || ds > length - 2 * MARGIN) return undefined;
  const s0 = run.closed ? snapped.s0 : Math.max(run.start + MARGIN, Math.min(snapped.s0, run.end - MARGIN - ds));
  const s1 = s0 + ds;

  const height = run.minHeightBetween(s0, s1);
  if (!(height > 0)) return undefined;
  const vMargin = MARGIN / height;
  const dv = snapped.v1 - snapped.v0;
  if (!(dv > 0)) return undefined;
  if (isDoor) return dv > 1 - vMargin ? undefined : { s0, s1, v0: 0, v1: dv };
  if (dv > 1 - 2 * vMargin) return undefined;
  const v0 = Math.max(vMargin, Math.min(snapped.v0, 1 - vMargin - dv));
  return { s0, s1, v0, v1: v0 + dv };
}

/** Whether `rect` reads as a door: a door is the only opening standing on the floor. */
export function isDoorRect(rect: { readonly v0: number }): boolean {
  return rect.v0 < 1e-6;
}

/** Every host a region's nodes are pinned to, keyed by surface ref, with the nodes each holds. */
function hostsOf(region: ConstructionRegionTopology): ReadonlyMap<string, { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly nodeIds: readonly ConstructionNodeId[] }> {
  const hosts = new Map<string, { hostSurfaceKey: ConstructionSurfaceKey; nodeIds: ConstructionNodeId[] }>();
  for (const node of region.nodes) {
    if (node.pin === undefined) continue;
    const ref = surfaceRefFromNodeSet(node.pin.hostSurfaceKey);
    const entry = hosts.get(ref) ?? { hostSurfaceKey: node.pin.hostSurfaceKey, nodeIds: [] };
    entry.nodeIds.push(node.id);
    hosts.set(ref, entry);
  }
  return hosts;
}

/** Where a region's host-space cubics bulge past their end nodes, in their host's `(u, v)`. */
function curveExtremes(region: ConstructionRegionTopology): readonly { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly u: number; readonly v: number }[] {
  let pins: Map<string, { readonly u: number; readonly v: number }> | undefined;
  const out: { hostSurfaceKey: ConstructionSurfaceKey; u: number; v: number }[] = [];
  for (const loop of region.outerLoops) {
    for (const edge of loop) {
      const controls = edge.hostCurve?.controls;
      if (controls === undefined) continue;
      pins ??= new Map(region.nodes.flatMap((node) => (node.pin === undefined ? [] : [[node.id, node.pin] as const])));
      const from = pins.get(edge.startNodeId);
      const to = pins.get(edge.endNodeId);
      if (from === undefined || to === undefined) continue;
      const extremes = segmentExtremes({ from: [from.u, from.v], to: [to.u, to.v], controls: [controls[0], controls[1]] });
      for (const [u, v] of extremes.slice(2)) out.push({ hostSurfaceKey: edge.hostCurve!.hostSurfaceKey, u, v });
    }
  }
  return out;
}

/** A region's `(u, v)` box on one host: its pins there and any cubic bulging past them. */
export function hostBoxOf(region: ConstructionRegionTopology, hostSurfaceKey: ConstructionSurfaceKey): HostRect | undefined {
  const ref = surfaceRefFromNodeSet(hostSurfaceKey);
  const points = [
    ...region.nodes.flatMap((node) => (node.pin !== undefined && surfaceRefFromNodeSet(node.pin.hostSurfaceKey) === ref ? [node.pin] : [])),
    ...curveExtremes(region).filter((point) => surfaceRefFromNodeSet(point.hostSurfaceKey) === ref),
  ];
  if (points.length === 0) return undefined;
  const us = points.map((point) => point.u);
  const vs = points.map((point) => point.v);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** The host holding most of a region's pinned nodes. */
export function primaryHostOf(region: ConstructionRegionTopology): ConstructionSurfaceKey | undefined {
  let best: { readonly key: ConstructionSurfaceKey; readonly count: number } | undefined;
  for (const { hostSurfaceKey, nodeIds } of hostsOf(region).values()) {
    if (best === undefined || nodeIds.length > best.count) best = { key: hostSurfaceKey, count: nodeIds.length };
  }
  return best?.key;
}

/** Where an opening's group id lives in its region's property bag, beside its shape. */
const GROUP_PROP = "group";

/** The id of the group `region` belongs to, read from its property bag. */
export function groupIdOf(region: ConstructionRegionTopology): string | undefined {
  const group = region.props?.[GROUP_PROP];
  return typeof group === "string" ? group : undefined;
}

/** Every piece of the group `group`. */
export function groupPieces(ctx: ToolContext, group: string): readonly ConstructionRegionTopology[] {
  return ctx.runtime.getAllRegionTopologies().filter((candidate) => groupIdOf(candidate) === group);
}

/** The run-space box `region`'s pins on the run occupy, cubic bulges included; `undefined` when none is on it. */
function regionRunSpan(run: RunFrame, region: ConstructionRegionTopology): RunRect | undefined {
  const points: { s: number; v: number }[] = [];
  for (const node of region.nodes) {
    const panel = node.pin === undefined ? undefined : run.panelOf(node.pin.hostSurfaceKey);
    if (panel !== undefined) points.push({ s: run.sOf(panel, node.pin!.u), v: node.pin!.v });
  }
  if (points.length === 0) return undefined;
  for (const { hostSurfaceKey, u, v } of curveExtremes(region)) {
    const panel = run.panelOf(hostSurfaceKey);
    if (panel !== undefined) points.push({ s: run.sOf(panel, u), v });
  }
  const ss = points.map((point) => point.s);
  const vs = points.map((point) => point.v);
  return { s0: Math.min(...ss), s1: Math.max(...ss), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** The one run rectangle a group's pieces make together; on a closed run it starts after the widest gap. */
export function groupRunSpan(run: RunFrame, pieces: readonly ConstructionRegionTopology[]): RunRect | undefined {
  const spans = pieces.flatMap((piece) => regionRunSpan(run, piece) ?? []).sort((a, b) => a.s0 - b.s0);
  if (spans.length === 0) return undefined;
  const period = run.end - run.start;
  let first = 0;
  if (run.closed) {
    let widest = spans[0]!.s0 + period - spans[spans.length - 1]!.s1;
    for (let index = 1; index < spans.length; index += 1) {
      const gap = spans[index]!.s0 - spans[index - 1]!.s1;
      if (gap > widest) {
        widest = gap;
        first = index;
      }
    }
  }
  const ordered = [...spans.slice(first), ...spans.slice(0, first).map((span) => ({ ...span, s0: span.s0 + period, s1: span.s1 + period }))];
  return {
    s0: ordered[0]!.s0,
    s1: Math.max(...ordered.map((span) => span.s1)),
    v0: Math.min(...spans.map((span) => span.v0)),
    v1: Math.max(...spans.map((span) => span.v1)),
  };
}

/**
 * Whether `rect` would share area with any region that cuts and is already
 * pinned to the run, other than `excluded` (surface refs of the group being
 * edited). Touching is fine; overlapping is refused, never merged.
 */
export function overlapsOther(ctx: ToolContext, run: RunFrame, rect: RunRect, excluded: ReadonlySet<string> = new Set()): boolean {
  const EPS = 1e-9;
  const period = run.end - run.start;
  const shifts = run.closed ? [-period, 0, period] : [0];
  return ctx.runtime.getAllRegionTopologies().some((region) => {
    if (!hasTrait(region.surfaceType, "cuts") || excluded.has(surfaceRefFromNodeSet(region.surfaceKey))) return false;
    if (!region.nodes.some((node) => node.pin !== undefined && run.panelOf(node.pin.hostSurfaceKey) !== undefined)) return false;
    const other = regionRunSpan(run, region);
    if (other === undefined) return false;
    if (!(rect.v0 < other.v1 - EPS && rect.v1 > other.v0 + EPS)) return false;
    return shifts.some((shift) => rect.s0 < other.s1 + shift - EPS && rect.s1 > other.s0 + shift + EPS);
  });
}

const CURVE_TOLERANCE = 1e-3;
const CURVE_SAMPLES = 12;

/** Whether the face bends between `u0` and `u1`, so a straight chord would leave it. */
function bendsBetween(frame: HostFrame, rect: HostRect): boolean {
  const uMid = (rect.u0 + rect.u1) / 2;
  const [a, b, mid] = frame.resolve([[rect.u0, rect.v0], [rect.u1, rect.v0], [uMid, rect.v0]]);
  const chordMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, z: (a!.z + b!.z) / 2 };
  return distance(chordMid, mid!) > CURVE_TOLERANCE;
}

/**
 * A piece's outline as a `(u, v)` polyline for drawing: each cubic sampled,
 * and on a bending face each straight side split so no step spans more than
 * `step` world units along it -- the same path the engine traces.
 */
export function piecePolyline(piece: OpeningPiece, step: number): readonly (readonly [number, number])[] {
  const { frame } = piece.panel;
  const bends = bendsBetween(frame, piece.rect);
  const out: (readonly [number, number])[] = [];
  for (const segment of piece.path) {
    const [u, v] = segment.from;
    const [nu, nv] = segment.to;
    const steps = segment.controls !== undefined ? CURVE_SAMPLES : bends ? Math.max(1, Math.ceil((Math.abs(nu - u) * frame.length) / step)) : 1;
    for (let k = 0; k < steps; k += 1) out.push(segment.controls !== undefined ? pointAt(segment, k / steps) : [u + ((nu - u) * k) / steps, v + ((nv - v) * k) / steps]);
  }
  return out;
}

/**
 * Each piece as a plain graph: one node per path segment start, pinned to
 * its face. A straight segment is a line edge -- the engine traces it in the
 * face's frame, so it follows a curved wall -- and each cubic is one edge
 * given its `(u, v)` controls.
 */
function buildGroupPatch(
  ctx: ToolContext,
  idPrefix: string,
  pieces: readonly OpeningPiece[],
): { readonly patch: ConstructionPatch; readonly pins: readonly ConstructionPinRequest[]; readonly curves: readonly ConstructionPinEdgeCurveRequest[] } {
  const existingUses = boundaryUsage(ctx);
  const nodes: { id: ConstructionNodeId; position: ConstructionPosition }[] = [];
  const edges: ConstructionPatch["edges"][number][] = [];
  const regions: ConstructionPatch["regions"][number][] = [];
  const pins: ConstructionPinRequest[] = [];
  const curves: ConstructionPinEdgeCurveRequest[] = [];
  pieces.forEach((piece, pieceIndex) => {
    const prefix = `${idPrefix}:p${pieceIndex}`;
    const hostSurfaceKey = piece.panel.surfaceKey;
    const corners = piece.path.map((segment) => segment.from);
    const ring = piece.panel.frame.resolve(corners).map((position, index) => ({ id: `${prefix}:c${index}` as ConstructionNodeId, position }));
    const boundaryEdges = createBoundaryEdges(ctx.tableId, { kind: "private-when-full", runPrefix: prefix, existingUses });
    const boundary: ConstructionOrientedEdgeUse[] = ring.map((node, index) => {
      const use = boundaryEdges.use(node.id, ring[(index + 1) % ring.length]!.id);
      const controls = piece.path[index]!.controls;
      if (controls !== undefined) curves.push({ edgeId: use.edgeId, hostSurfaceKey, controls: use.reversed ? [controls[1], controls[0]] : [controls[0], controls[1]] });
      return use;
    });
    nodes.push(...ring);
    edges.push(...boundaryEdges.all());
    regions.push({ regionId: ring.map((node) => node.id).join("|"), boundary, surfaceType: openingStructureType.surfaceType, physical: false });
    ring.forEach((node, index) => pins.push({ nodeId: node.id, hostSurfaceKey, u: corners[index]![0], v: corners[index]![1] }));
  });
  return { patch: { nodes, edges, regions }, pins, curves };
}

/**
 * One transaction: delete every region in `removals`, then add `pieces` as
 * new regions with their own nodes, each pinned to its face, all labelled
 * one group in their property bag beside the shape. Both is a move or resize; only `removals` a delete; only
 * `pieces` a creation.
 */
export function commitOpeningGroup(
  ctx: ToolContext,
  causeId: string,
  removals: readonly ConstructionSurfaceKey[],
  pieces: readonly OpeningPiece[],
  shape?: OpeningShape,
): OpeningCommit {
  let recorded = false;
  let created: { readonly group: string; readonly surfaceKeys: readonly ConstructionSurfaceKey[] } | undefined;
  try {
    ({ recorded } = commitChange(ctx.runtime, { transactionId: causeId }, () => {
      if (removals.length > 0) {
        ctx.runtime.applyRegionEdit(removals.map((surfaceKey) => ({ kind: "delete-region" as const, surfaceKey })), "local", causeId);
      }
      if (pieces.length === 0) return { value: undefined };

      const idPrefix = scopedToolId(ctx, `opening-${ctx.nextSequence()}`);
      const { pins, patch, curves } = buildGroupPatch(ctx, idPrefix, pieces);
      const outcome = ctx.runtime.addPatch(patch, "local", causeId);
      if (outcome.skippedRegionIds.length > 0 || outcome.createdSurfaceKeys.length !== pieces.length) {
        throw new Error("a face nao coube sobre o que ja existe ali.");
      }
      ctx.runtime.pinNodes(pins, "local", causeId);
      if (curves.length > 0) ctx.runtime.pinEdgeCurves(curves, "local", causeId);
      ctx.runtime.setRegionProps(outcome.createdSurfaceKeys, { ...shapeProps(shape), [GROUP_PROP]: idPrefix });
      created = { group: idPrefix, surfaceKeys: outcome.createdSurfaceKeys };
      return { value: outcome, change: shapeChangeOfAddition(ctx.runtime, patch, outcome) };
    }));
  } catch (error) {
    return { recorded: false, error: error instanceof Error ? error.message : String(error) };
  }
  return created === undefined ? { recorded } : { recorded, created };
}

interface OpeningCommit {
  readonly recorded: boolean;
  readonly error?: string;
  /** The new group, when pieces were added. */
  readonly created?: { readonly group: string; readonly surfaceKeys: readonly ConstructionSurfaceKey[] };
}
