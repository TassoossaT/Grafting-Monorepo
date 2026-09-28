import type {
  BezierPort,
  ConstructionEdgeSnapshot,
  ConstructionGraphPatch,
  ConstructionGraphSnapshot,
  ConstructionPosition,
  CurvePoint,
} from "@/ports";

import { spineMemberOf } from "./spine-handle-ids.ts";
import { spineComponent, spineOwnerOf } from "./spine-owner.ts";

/**
 * A spine read as one open run -- whatever it generates -- and the edits
 * that treat it as a whole: its two ends' heights, its width and, when every
 * span is an arc round one centre, the spiral it is. The geometry itself is
 * computed in Rust through the curve batch; this only walks and assembles.
 */

const TOLERANCE = 0.05;
const xyz = (p: ConstructionPosition): CurvePoint => [p.x, p.y, p.z];
const minus = (a: CurvePoint, b: CurvePoint): CurvePoint => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** An open spine walked from one free end to the other. The ends are ordered by id, so the walk is always the same. */
export interface OpenSpineChain {
  readonly spans: readonly { readonly span: ConstructionEdgeSnapshot; readonly reversed: boolean }[];
  /** Control node ids, first end to last. */
  readonly nodes: readonly string[];
}

/** `spans` walked end to end, when they form one open chain; `undefined` for a branch or a loop. */
export function openSpineChain(spans: readonly ConstructionEdgeSnapshot[]): OpenSpineChain | undefined {
  const incident = new Map<string, ConstructionEdgeSnapshot[]>();
  for (const span of spans) for (const id of [span.startNodeId, span.endNodeId]) incident.set(id, [...(incident.get(id) ?? []), span]);
  if (spans.length === 0 || [...incident.values()].some((list) => list.length > 2)) return undefined;
  const ends = [...incident].filter(([, list]) => list.length === 1).map(([id]) => id).sort();
  if (ends.length !== 2) return undefined;
  const walked: { span: ConstructionEdgeSnapshot; reversed: boolean }[] = [];
  const nodes = [ends[0]!];
  const used = new Set<string>();
  while (walked.length < spans.length) {
    const at = nodes.at(-1)!;
    const next = incident.get(at)!.find((span) => !used.has(span.edgeId));
    if (!next) return undefined;
    used.add(next.edgeId);
    const reversed = next.endNodeId === at;
    walked.push({ span: next, reversed });
    nodes.push(reversed ? next.startNodeId : next.endNodeId);
  }
  return { spans: walked, nodes };
}

/** The open spine `id` belongs to -- a control node, a curve handle or a global handle -- keeping only spans of its own owner. */
export function spineChainAt(graph: ConstructionGraphSnapshot, id: string): OpenSpineChain | undefined {
  const member = spineMemberOf(graph, id);
  const spans = spineComponent(graph, [member]).edges.filter((edge) => edge.curve);
  const owner = spans.find((edge) => edge.startNodeId === member || edge.endNodeId === member) ?? spans[0];
  return owner && openSpineChain(spans.filter((edge) => spineOwnerOf(edge) === spineOwnerOf(owner)));
}

/** The one centre every span of `spans` turns round, when every span is such an arc. */
export function sharedArcCenter(spans: readonly ConstructionEdgeSnapshot[]): readonly [number, number] | undefined {
  const first = spans[0]?.curve?.geometry;
  if (first?.kind !== "arc") return undefined;
  const same = spans.every((span) => {
    const geometry = span.curve?.geometry;
    return geometry?.kind === "arc" && Math.hypot(geometry.center[0] - first.center[0], geometry.center[1] - first.center[1]) < 1e-6;
  });
  return same ? first.center : undefined;
}

/** A spine as a whole, as its global edits read and change it. Nothing here is stored: the spine is the truth. */
export interface SpineChainShape {
  /** Height of the chain's first end. */
  readonly startHeight: number;
  /** Height of the chain's last end. */
  readonly endHeight: number;
  readonly width: number;
  readonly spiral?: {
    readonly centerX: number;
    readonly centerZ: number;
    readonly radius: number;
    /** Turns from start to end, always positive. */
    readonly turns: number;
    /** Turns from +X towards +Z when true. */
    readonly positive: boolean;
  };
}

/** How the open spine `id` belongs to reads as a whole, or `undefined` when there is none. */
export function describeSpineChain(graph: ConstructionGraphSnapshot, id: string): SpineChainShape | undefined {
  const chain = spineChainAt(graph, id);
  if (!chain) return undefined;
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const first = positions.get(chain.nodes[0]!)!, last = positions.get(chain.nodes.at(-1)!)!;
  const offsets = chain.spans[0]!.span.curve!.bandOffsets;
  const shape = { startHeight: first.y, endHeight: last.y, width: offsets.length ? Math.max(...offsets) - Math.min(...offsets) : 1.5 };
  const center = sharedArcCenter(chain.spans.map(({ span }) => span));
  const head = chain.spans[0]!.span.curve!.geometry;
  if (!center || head?.kind !== "arc") return shape;
  // Walked from the first end: a span walked backwards turns the other way.
  const positive = chain.spans[0]!.reversed ? !head.positive : head.positive;
  let turned = 0;
  for (let i = 0; i + 1 < chain.nodes.length; i += 1) {
    const a = positions.get(chain.nodes[i]!)!, b = positions.get(chain.nodes[i + 1]!)!;
    let step = Math.atan2(b.z - center[1], b.x - center[0]) - Math.atan2(a.z - center[1], a.x - center[0]);
    while (positive ? step <= 1e-9 : step >= -1e-9) step += positive ? 2 * Math.PI : -2 * Math.PI;
    turned += Math.abs(step);
  }
  return {
    ...shape,
    spiral: { centerX: center[0], centerZ: center[1], radius: Math.hypot(first.x - center[0], first.z - center[1]), turns: turned / (2 * Math.PI), positive },
  };
}

/**
 * The graph patch taking the open spine `id` belongs to from what it is to
 * `next`. Heights move the ends; width re-profiles every span; any spiral
 * value rebuilds the whole helix in Rust from the first end, which keeps its
 * angle round the centre. Node and span ids are kept wherever the count
 * allows, so what is welded to either end stays welded. The owner
 * regenerates from the patch -- re-grading between the ends if it grades.
 */
export function planSpineChainEdit(graph: ConstructionGraphSnapshot, port: Pick<BezierPort, "curveBatch">, id: string, next: SpineChainShape, operationId: string): ConstructionGraphPatch | undefined {
  const chain = spineChainAt(graph, id);
  const current = describeSpineChain(graph, id);
  if (!chain || !current) return undefined;
  if (!(next.width > 0)) throw new Error("A largura deve ser positiva.");
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const bandOffsets = [-next.width / 2, next.width / 2];
  const surfaceType = chain.spans[0]!.span.curve!.surfaceType;
  const firstId = chain.nodes[0]!, lastId = chain.nodes.at(-1)!;
  const start = positions.get(firstId)!;

  if (!next.spiral || !current.spiral) {
    return {
      nodes: [
        { id: firstId, position: { ...start, y: next.startHeight } },
        { id: lastId, position: { ...positions.get(lastId)!, y: next.endHeight } },
      ],
      removedEdgeIds: chain.spans.map(({ span }) => span.edgeId),
      edges: chain.spans.map(({ span }) => ({ ...span, curve: { ...span.curve!, bandOffsets, endBandOffsets: undefined } })),
    };
  }

  const { spiral } = next;
  if (!(spiral.radius > 0) || !(spiral.turns > 0)) throw new Error("Raio e voltas devem ser positivos.");
  const startAngle = Math.atan2(start.z - current.spiral.centerZ, start.x - current.spiral.centerX);
  const sweep = spiral.turns * 2 * Math.PI * (spiral.positive ? 1 : -1);
  const helix = port.curveBatch({ tolerance: 0.01, commands: [{
    kind: "helix", center: [spiral.centerX, next.startHeight, spiral.centerZ], radius: spiral.radius, startAngle, sweep, rise: next.endHeight - next.startHeight,
  }] })[0]!;
  const count = helix.curves.length;
  const ids = Array.from({ length: count + 1 }, (_, i) => i === 0 ? firstId : i === count ? lastId : i < chain.nodes.length - 1 ? chain.nodes[i]! : `spine:${operationId}:${i}`);
  const edgeIds = Array.from({ length: count }, (_, i) => chain.spans[i]?.span.edgeId ?? `spine-edge:${operationId}:${i}`);
  return {
    nodes: ids.map((nodeId, i) => {
      const p = i === count ? helix.curves[i - 1]!.points[3] : helix.curves[i]!.points[0];
      return { id: nodeId, position: { x: p[0], y: p[1], z: p[2] } };
    }),
    removedEdgeIds: chain.spans.map(({ span }) => span.edgeId),
    edges: helix.handles.map((handles, i) => ({
      edgeId: edgeIds[i]!,
      startNodeId: ids[i]!,
      endNodeId: ids[i + 1]!,
      curve: { ...handles, bandOffsets, ...(surfaceType === undefined ? {} : { surfaceType }) },
    })),
  };
}

/** A regrade: control nodes whose height changed, and every span with its handles' heights redone. */
export interface SpineGrade {
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionEdgeSnapshot[];
  /** Rise over plan length along the whole chain, when it was graded. */
  readonly grade?: number;
}

/**
 * `spans` re-graded: the chain's two free ends keep their heights, and every
 * point between takes the height one constant grade by plan length gives it
 * (Rust's `grade`). The plan is untouched. Nothing is returned for spans that
 * are not one open chain.
 */
export function gradeSpineSpans(port: Pick<BezierPort, "curveBatch">, graph: ConstructionGraphSnapshot, spans: readonly ConstructionEdgeSnapshot[]): SpineGrade {
  const chain = openSpineChain(spans.filter((span) => span.curve));
  if (!chain) return { nodes: [], edges: [] };
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const curves = port.curveBatch({ tolerance: TOLERANCE, commands: chain.spans.map(({ span }) => ({
    kind: "resolve" as const, handles: span.curve!, start: xyz(positions.get(span.startNodeId)!), end: xyz(positions.get(span.endNodeId)!),
  })) }).map((result, i) => {
    const curve = result.curves[0]!;
    return chain.spans[i]!.reversed ? { points: [curve.points[3], curve.points[2], curve.points[1], curve.points[0]] as const } : curve;
  });
  const first = curves[0]!.points[0][1], last = curves.at(-1)!.points[3][1];
  const result = port.curveBatch({ tolerance: TOLERANCE, commands: [{ kind: "grade", curves, start: first, end: last }] })[0]!;
  const run = result.lengths.reduce((sum, length) => sum + length, 0);
  const nodes = new Map<string, ConstructionPosition>();
  const edges = chain.spans.map(({ span, reversed }, i) => {
    const walked = result.curves[i]!.points;
    const [p0, p1, p2, p3] = reversed ? [walked[3], walked[2], walked[1], walked[0]] : walked;
    for (const [nodeId, p] of [[span.startNodeId, p0], [span.endNodeId, p3]] as const) {
      const standing = positions.get(nodeId)!;
      if (Math.abs(standing.y - p[1]) > 1e-9) nodes.set(nodeId, { ...standing, y: p[1] });
    }
    return { ...span, curve: { ...span.curve!, start: minus(p1, p0), end: minus(p2, p3) } };
  });
  return { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges, grade: run > 0 ? Math.abs(last - first) / run : undefined };
}
