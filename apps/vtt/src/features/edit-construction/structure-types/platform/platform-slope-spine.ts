import type {
  BezierPort,
  ConstructionEdgeSnapshot,
  CurvePoint,
  ConstructionGraphPatch,
  ConstructionGraphSnapshot,
  ConstructionMotionInfluence,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

import { ribbonSections, unionRibbonOutlines } from "../../topology/bezier-curve.ts";
import { isSpineControlNodeId, ownedBy, spineComponent, spineRibbons } from "../../spine/index.ts";
import type { MotionContext, SpineRegeneration, SpineRegenerationInput } from "../structure-type.ts";

/**
 * A sloped platform generated from a spine, the way a road is: the spine's
 * bezier spans are the source of truth, and the surface is regenerated from
 * them.
 *
 * Plan and height are kept apart, as ramp tools do: the spine's plan is
 * edited freely, and only its two free ends carry authored heights. Every
 * point between them is re-graded on each regeneration so the whole run
 * climbs at one constant grade by plan length (`gradeSlopeSpans`, computed
 * in Rust). A spiral is this same ramp whose plan is a helix. What differs from a road is only the last step -- a road unions its
 * ribbons in plan, and a spiral's turns overlap in plan, so a sloped platform
 * keeps **one face per span** instead: that span's ribbon outline, sampled
 * along the curve on both margins. No face ever overlaps itself in plan, and
 * the mesher lifts its interior from the same curve.
 *
 * Boundary nodes carry the curve parameter they were sampled at, so a move
 * the spine receives -- a floor lifting the end welded to it -- re-places
 * them on the moved curve without re-sampling and changing their count.
 */

export const SLOPE_SURFACE_TYPE = "platform-slope";
export const SLOPE_DEFAULT_OFFSETS: readonly number[] = [-0.75, 0.75];
const TOLERANCE = 0.05;
const COINCIDENT = 1e-4;

type Side = "min" | "max";
const SIDES: readonly Side[] = ["min", "max"];

export const isSlopeSpan = ownedBy(SLOPE_SURFACE_TYPE);

/** A cross-section node shared by every span meeting at a control node. */
export const controlSectionId = (controlNodeId: string, side: Side): string => `${controlNodeId}:section:${side}`;
/** A cross-section node inside one span, at curve parameter `t`. */
const spanSectionId = (edgeId: string, t: number, side: Side): string => `${edgeId}:section:${t.toFixed(6)}:${side}`;
/**
 * A boundary edge is named by the two nodes it joins. A regeneration that
 * re-places a span keeps every edge whose ends did not change, and can never
 * inherit a standing edge of the same name that joins different nodes.
 */
const boundaryEdgeId = (from: string, to: string): string => `slope-edge:${from}~${to}`;
/** The cross-section edge a control node's spans -- and a floor welded there -- all share. */
export const controlRungId = (controlNodeId: string): string => boundaryEdgeId(controlSectionId(controlNodeId, "min"), controlSectionId(controlNodeId, "max"));
export const slopeFaceId = (edgeId: string): string => `${edgeId}:face`;

function parseSection(id: string): { readonly owner: string; readonly t?: number; readonly side: Side } | undefined {
  const span = /^(.*):section:(\d+\.\d+):(min|max)$/.exec(id);
  if (span) return { owner: span[1]!, t: Number(span[2]), side: span[3] as Side };
  const control = /^(.*):section:(min|max)$/.exec(id);
  return control ? { owner: control[1]!, side: control[2] as Side } : undefined;
}

export interface SlopeSurface {
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly regions: readonly ConstructionPatchRegion[];
  readonly preview: Float32Array;
}

/** The faces of every sloped-platform span in `spans`, sampled along their curves. */
export function slopeSurface(port: Pick<BezierPort, "curveBatch">, nodes: ReadonlyMap<string, ConstructionPosition>, spans: readonly ConstructionEdgeSnapshot[]): SlopeSurface {
  // Cross-sections at the curve's own adaptive samples, so each carries the
  // parameter a later move re-places it at.
  const ribbons = spineRibbons(port, spans.map((span) => ({ handles: span.curve!, start: nodes.get(span.startNodeId)!, end: nodes.get(span.endNodeId)! })), SLOPE_DEFAULT_OFFSETS, TOLERANCE,
    (resolved) => resolved.samples[0]!.map((sample) => sample.t));
  const parameters = ribbons.map((ribbon) => ribbon.resolved.samples[0]!.map((sample) => sample.t));
  const placed = new Map<string, ConstructionPosition>();
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  const preview: number[] = [];
  spans.forEach((span, i) => {
    const ts = parameters[i]!;
    const sections = ribbonSections(ribbons[i]!.outline);
    const last = ts.length - 1;
    const ids = sections.map((section, k) => Object.fromEntries(SIDES.map((side) => {
      const control = k === 0 ? span.startNodeId : k === last ? span.endNodeId : undefined;
      let id = control === undefined ? spanSectionId(span.edgeId, ts[k]!, side) : controlSectionId(control, side);
      const standing = placed.get(id);
      // Spans meeting at a corner do not share a cross-section; each keeps its own.
      if (standing && Math.hypot(standing.x - section[side].x, standing.y - section[side].y, standing.z - section[side].z) > COINCIDENT) {
        id = spanSectionId(span.edgeId, ts[k]!, side);
      }
      if (!placed.has(id)) placed.set(id, section[side]);
      return [side, id];
    })) as Record<Side, string>);
    const join = (from: string, to: string): string => {
      const edgeId = boundaryEdgeId(from, to);
      edges.set(edgeId, { edgeId, startNodeId: from, endNodeId: to });
      return edgeId;
    };
    const along = (side: Side) => ids.slice(0, -1).map((_, k) => join(ids[k]![side], ids[k + 1]![side]));
    const startRung = join(ids[0]!.min, ids[0]!.max);
    const endRung = join(ids[last]!.min, ids[last]!.max);
    regions.push({
      regionId: slopeFaceId(span.edgeId),
      surfaceType: SLOPE_SURFACE_TYPE,
      physical: true,
      boundary: [
        ...along("min").map((edgeId) => ({ edgeId, reversed: false })),
        { edgeId: endRung, reversed: false },
        ...along("max").reverse().map((edgeId) => ({ edgeId, reversed: true })),
        { edgeId: startRung, reversed: true },
      ],
    });
    const samples = ribbons[i]!.resolved.samples[0]!;
    for (let k = 1; k < samples.length; k += 1) preview.push(...samples[k - 1]!.position, ...samples[k]!.position);
  });
  return { nodes: [...placed].map(([id, position]) => ({ id, position })), edges: [...edges.values()], regions, preview: Float32Array.from(preview) };
}

/**
 * The plan-view outline the whole surface claims -- what the runtime cuts
 * the ground under it by and bounds the terrain's regeneration with. The
 * largest outer ring of the faces' union: a spiral's open centre is not
 * excluded here, but the repair subtracts the faces themselves, not this.
 */
export function slopeFootprint(port: Pick<BezierPort, "planarBoolean">, surface: Pick<SlopeSurface, "nodes" | "edges" | "regions">): readonly (readonly [number, number])[] | undefined {
  const positions = new Map(surface.nodes.map((node) => [node.id, node.position]));
  const edges = new Map(surface.edges.map((edge) => [edge.edgeId, edge]));
  const outlines = surface.regions.map((region) => region.boundary.map((use) => {
    const edge = edges.get(use.edgeId)!;
    return positions.get(use.reversed ? edge.endNodeId : edge.startNodeId)!;
  }));
  if (outlines.length === 0) return undefined;
  const area = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, z], i) => {
    const [nx, nz] = ring[(i + 1) % ring.length]!;
    return sum + x * nz - nx * z;
  }, 0));
  const rings = unionRibbonOutlines(port, outlines).map((shape) => shape[0]).filter((ring): ring is [number, number][] => ring !== undefined && ring.length >= 3);
  return rings.sort((a, b) => area(b) - area(a))[0];
}

export { prospectiveGraph } from "../../spine/index.ts";
import { prospectiveGraph } from "../../spine/index.ts";

const xyz = (p: ConstructionPosition) => [p.x, p.y, p.z] as const;

/** `spans`, when they form one open chain, walked from one free end to the other; `undefined` for a branch or a loop. */
function openChain(spans: readonly ConstructionEdgeSnapshot[]): readonly { readonly span: ConstructionEdgeSnapshot; readonly reversed: boolean }[] | undefined {
  const incident = new Map<string, ConstructionEdgeSnapshot[]>();
  for (const span of spans) for (const id of [span.startNodeId, span.endNodeId]) incident.set(id, [...(incident.get(id) ?? []), span]);
  if ([...incident.values()].some((list) => list.length > 2)) return undefined;
  const ends = [...incident].filter(([, list]) => list.length === 1).map(([id]) => id).sort();
  if (ends.length !== 2) return undefined;
  const walk: { span: ConstructionEdgeSnapshot; reversed: boolean }[] = [];
  let at = ends[0]!;
  const used = new Set<string>();
  while (walk.length < spans.length) {
    const next = incident.get(at)!.find((span) => !used.has(span.edgeId));
    if (!next) return undefined;
    used.add(next.edgeId);
    const reversed = next.endNodeId === at;
    walk.push({ span: next, reversed });
    at = reversed ? next.startNodeId : next.endNodeId;
  }
  return walk;
}

/**
 * The control nodes and spans of `spans` re-graded: the chain's two free
 * ends keep their heights, and every point between takes the height one
 * constant grade by plan length gives it. The plan is untouched. Nothing is
 * returned for a spine that is not one open chain.
 */
export function gradeSlopeSpans(
  port: Pick<BezierPort, "curveBatch">,
  graph: ConstructionGraphSnapshot,
  spans: readonly ConstructionEdgeSnapshot[],
): {
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionEdgeSnapshot[];
  /** Rise over plan length along the whole chain, when it was graded. */
  readonly grade?: number;
} {
  const chain = openChain(spans.filter((span) => span.curve));
  if (!chain || chain.length === 0) return { nodes: [], edges: [] };
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const curves = port.curveBatch({ tolerance: TOLERANCE, commands: chain.map(({ span, reversed }) => ({
    kind: "resolve" as const, handles: span.curve!,
    start: xyz(positions.get(span.startNodeId)!), end: xyz(positions.get(span.endNodeId)!),
  })) }).map((result, i) => {
    const curve = result.curves[0]!;
    return chain[i]!.reversed ? { points: [curve.points[3], curve.points[2], curve.points[1], curve.points[0]] as const } : curve;
  });
  const first = curves[0]!.points[0][1], last = curves.at(-1)!.points[3][1];
  const result = port.curveBatch({ tolerance: TOLERANCE, commands: [{ kind: "grade", curves, start: first, end: last }] })[0]!;
  const graded = result.curves;
  const run = result.lengths.reduce((sum, length) => sum + length, 0);
  const nodes = new Map<string, ConstructionPosition>();
  const edges = chain.map(({ span, reversed }, i) => {
    const walked = graded[i]!.points;
    const [p0, p1, p2, p3] = reversed ? [walked[3], walked[2], walked[1], walked[0]] : walked;
    for (const [id, p] of [[span.startNodeId, p0], [span.endNodeId, p3]] as const) {
      const standing = positions.get(id)!;
      if (Math.abs(standing.y - p[1]) > 1e-9) nodes.set(id, { ...standing, y: p[1] });
    }
    const minus = (a: CurvePoint, b: CurvePoint): CurvePoint => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    return { ...span, curve: { ...span.curve!, start: minus(p1, p0), end: minus(p2, p3) } };
  });
  return { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges, grade: run > 0 ? Math.abs(last - first) / run : undefined };
}

/** `patch` with `extra` laid over it: a later node or edge of the same id wins. */
function overlaid(patch: ConstructionGraphPatch, extra: ReturnType<typeof gradeSlopeSpans>): ConstructionGraphPatch {
  const nodes = new Map(patch.nodes.map((node) => [node.id, node]));
  for (const node of extra.nodes) nodes.set(node.id, node);
  const edges = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  for (const edge of extra.edges) edges.set(edge.edgeId, edge);
  return { ...patch, nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Regenerates every sloped-platform span on the spine a graph patch touches, re-graded between its ends. */
export function regenerateSlopeSpine(input: SpineRegenerationInput): SpineRegeneration {
  const { snapshot } = input;
  const seeds = [...input.graphPatch.nodes.map((node) => node.id), ...input.graphPatch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId])];
  const drafted = prospectiveGraph(snapshot, input.graphPatch);
  const graphPatch = overlaid(input.graphPatch, gradeSlopeSpans(input.port, drafted, spineComponent(drafted, seeds).edges.filter(isSlopeSpan)));
  const after = prospectiveGraph(snapshot, graphPatch);
  const spans = spineComponent(after, seeds).edges.filter((edge) => edge.curve && isSlopeSpan(edge));
  const before = spineComponent(snapshot, seeds).edges.filter(isSlopeSpan);
  const touched = new Set([...spans, ...before].map((edge) => slopeFaceId(edge.edgeId)).concat((graphPatch.removedEdgeIds ?? []).map(slopeFaceId)));
  const standing = input.topologies.filter((topology) => topology.surfaceType === SLOPE_SURFACE_TYPE && touched.has(topology.surfaceKey[1] ?? ""));
  const surface = slopeSurface(input.port, new Map(after.nodes.map((node) => [node.id, node.position])), spans);
  return {
    request: {
      operationId: input.operationId,
      sourceSurfaceKeys: standing.map((topology) => topology.surfaceKey),
      patch: { nodes: surface.nodes, edges: surface.edges, regions: surface.regions },
      // Section nodes that already stand are moved here: a patch only adds.
      graphPatch: { ...graphPatch, nodes: [...graphPatch.nodes, ...surface.nodes] },
      footprintOutline: slopeFootprint(input.port, surface),
    },
    preview: surface.preview,
  };
}

/** Each face's control cross-sections follow their control node, and stay level with each other. */
export function slopeMotionInfluences(topology: ConstructionRegionTopology, transport: boolean): readonly ConstructionMotionInfluence[] {
  const axes = [transport, true, transport] as const;
  return topology.nodes.flatMap((node) => {
    const section = parseSection(node.id);
    if (section === undefined || section.t !== undefined || !isSpineControlNodeId(section.owner)) return [];
    return [{ from: node.id, to: section.owner, axes }, { from: section.owner, to: node.id, axes }];
  });
}

/**
 * Re-places every cross-section of a span whose control node moved, at its
 * own curve parameter on the moved curve -- the ramp bends with the move
 * instead of kinking at the moved end.
 */
export function deriveSlopeMotion(topologies: readonly ConstructionRegionTopology[], positions: ReadonlyMap<string, ConstructionPosition>, context: MotionContext): ReadonlyMap<string, ConstructionPosition> {
  const derived = new Map<string, ConstructionPosition>();
  const { graphSnapshot, port } = context;
  if (!graphSnapshot || !port) return derived;
  const standing = new Map(graphSnapshot.nodes.map((node) => [node.id, node.position]));
  const at = (id: string) => positions.get(id) ?? standing.get(id)!;
  const faces = new Map(topologies.map((topology) => [topology.surfaceKey[1] ?? "", topology]));
  const spans = graphSnapshot.edges.filter((edge) => edge.curve && isSlopeSpan(edge) && (positions.has(edge.startNodeId) || positions.has(edge.endNodeId)));
  const work = spans.flatMap((span) => {
    const face = faces.get(slopeFaceId(span.edgeId));
    if (!face) return [];
    const members = face.nodes.flatMap((node) => {
      const section = parseSection(node.id);
      if (!section) return [];
      const t = section.t ?? (section.owner === span.startNodeId ? 0 : section.owner === span.endNodeId ? 1 : undefined);
      return t === undefined ? [] : [{ id: node.id, t, side: section.side }];
    });
    const ts = [...new Set(members.map((member) => member.t))].sort((a, b) => a - b);
    return ts.length >= 2 ? [{ span, members, ts }] : [];
  });
  if (work.length === 0) return derived;
  const ribbons = spineRibbons(port, work.map(({ span }) => ({ handles: span.curve!, start: at(span.startNodeId), end: at(span.endNodeId) })), SLOPE_DEFAULT_OFFSETS, TOLERANCE,
    (_resolved, i) => work[i]!.ts);
  work.forEach(({ members, ts }, i) => {
    const sections = ribbonSections(ribbons[i]!.outline);
    for (const member of members) {
      if (positions.has(member.id) || derived.has(member.id)) continue;
      derived.set(member.id, sections[ts.indexOf(member.t)]![member.side]);
    }
  });
  return derived;
}

/** Every cross-section stays level from margin to margin. */
export function validateSlopeMotion(topology: ConstructionRegionTopology, positions: ReadonlyMap<string, ConstructionPosition>): string | undefined {
  const levels = new Map<string, number>();
  for (const node of topology.nodes) {
    const section = parseSection(node.id);
    if (!section) continue;
    const key = `${section.owner}@${section.t ?? "control"}`;
    const y = (positions.get(node.id) ?? node.position).y;
    const other = levels.get(key);
    if (other !== undefined && Math.abs(other - y) > 1e-4) return "Cada secao da plataforma inclinada deve permanecer nivelada de lado a lado.";
    levels.set(key, y);
  }
  return undefined;
}
