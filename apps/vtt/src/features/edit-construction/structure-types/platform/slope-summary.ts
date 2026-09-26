import type { BezierPort, ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot, CurvePoint } from "@/ports";

import { spineComponent, spineMemberOf } from "../../spine/index.ts";
import { isSlopeSpan } from "./platform-slope-spine.ts";

/**
 * What a sloped platform is as a whole -- the values its global edits change
 * -- read back from its spine: both ends' heights and its width, and, when
 * every span is an arc around one centre, the spiral it is.
 *
 * Nothing here is stored: the spine is the truth, and this is only how it
 * reads to someone editing it from a panel.
 */
export interface SlopeSummary {
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

interface Chain {
  readonly spans: readonly { readonly span: ConstructionEdgeSnapshot; readonly reversed: boolean }[];
  /** Control node ids from the first end to the last. */
  readonly nodes: readonly string[];
}

/** The sloped platform's spine through `nodeId`, walked from one free end to the other; `undefined` for a branch, a loop, or another owner. */
function chainAt(graph: ConstructionGraphSnapshot, id: string): Chain | undefined {
  const spans = spineComponent(graph, [spineMemberOf(graph, id)]).edges.filter((edge) => edge.curve && isSlopeSpan(edge));
  if (spans.length === 0) return undefined;
  const incident = new Map<string, ConstructionEdgeSnapshot[]>();
  for (const span of spans) for (const id of [span.startNodeId, span.endNodeId]) incident.set(id, [...(incident.get(id) ?? []), span]);
  if ([...incident.values()].some((list) => list.length > 2)) return undefined;
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

/** How the sloped platform through `nodeId` reads as a whole, or `undefined` when there is none. */
export function describeSlope(graph: ConstructionGraphSnapshot, nodeId: string): SlopeSummary | undefined {
  const chain = chainAt(graph, nodeId);
  if (!chain) return undefined;
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const first = positions.get(chain.nodes[0]!)!, last = positions.get(chain.nodes.at(-1)!)!;
  const offsets = chain.spans[0]!.span.curve!.bandOffsets;
  const width = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : 1.5;
  const summary = { startHeight: first.y, endHeight: last.y, width };
  const arcs = chain.spans.map(({ span }) => span.curve!.geometry);
  const [head] = arcs;
  if (head?.kind !== "arc" || !arcs.every((geometry) => geometry?.kind === "arc"
    && Math.hypot(geometry.center[0] - head.center[0], geometry.center[1] - head.center[1]) < 1e-6)) return summary;
  // Walked from the first end: a span walked backwards turns the other way.
  const positive = chain.spans[0]!.reversed ? !head.positive : head.positive;
  let turned = 0;
  for (let i = 0; i + 1 < chain.nodes.length; i += 1) {
    const a = positions.get(chain.nodes[i]!)!, b = positions.get(chain.nodes[i + 1]!)!;
    let step = Math.atan2(b.z - head.center[1], b.x - head.center[0]) - Math.atan2(a.z - head.center[1], a.x - head.center[0]);
    while (positive ? step <= 1e-9 : step >= -1e-9) step += positive ? 2 * Math.PI : -2 * Math.PI;
    turned += Math.abs(step);
  }
  return {
    ...summary,
    spiral: {
      centerX: head.center[0],
      centerZ: head.center[1],
      radius: Math.hypot(first.x - head.center[0], first.z - head.center[1]),
      turns: turned / (2 * Math.PI),
      positive,
    },
  };
}

/**
 * The spine edit taking the sloped platform through `nodeId` from what it is
 * to `next`. Heights move the ends (the owner re-grades between them), width
 * re-profiles every span, and any spiral value rebuilds the whole helix in
 * Rust from the start end, which keeps its angle round the centre. Node and
 * span ids are kept wherever the count allows, so what is welded to either
 * end stays welded.
 */
export function planSlopeEdit(graph: ConstructionGraphSnapshot, port: Pick<BezierPort, "curveBatch">, nodeId: string, next: SlopeSummary, operationId: string): ConstructionGraphPatch | undefined {
  const chain = chainAt(graph, nodeId);
  const current = describeSlope(graph, nodeId);
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
  const center: CurvePoint = [spiral.centerX, next.startHeight, spiral.centerZ];
  // The start keeps its angle round the old centre; everything else follows from the values.
  const startAngle = Math.atan2(start.z - current.spiral.centerZ, start.x - current.spiral.centerX);
  const sweep = spiral.turns * 2 * Math.PI * (spiral.positive ? 1 : -1);
  const helix = port.curveBatch({ tolerance: 0.01, commands: [{ kind: "helix", center, radius: spiral.radius, startAngle, sweep, rise: next.endHeight - next.startHeight }] })[0]!;
  const count = helix.curves.length;
  const ids = Array.from({ length: count + 1 }, (_, i) => i === 0 ? firstId : i === count ? lastId : chain.nodes[i] !== undefined && i < chain.nodes.length - 1 ? chain.nodes[i]! : `spine:${operationId}:${i}`);
  const edgeIds = Array.from({ length: count }, (_, i) => chain.spans[i]?.span.edgeId ?? `spine-edge:${operationId}:${i}`);
  return {
    nodes: ids.map((id, i) => {
      const p = i === count ? helix.curves[i - 1]!.points[3] : helix.curves[i]!.points[0];
      return { id, position: { x: p[0], y: p[1], z: p[2] } };
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
