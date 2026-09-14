import type { BezierPort, CurveHandles, CurvePoint, ConstructionGraphSnapshot, ConstructionGraphPatch, ConstructionRegionTopology, ConstructionPosition } from "@/ports";
import { automaticCurve, curvePoint, curvePosition, resolveCurves, sampleRibbons, unionRibbonOutlines } from "../../topology/bezier-curve.ts";
import { chainsOf, spineGraphFromSnapshot, spineControlNodeId } from "./spine-graph/index.ts";
import { changedSpineCloud } from "./path-cloud-scope.ts";
import type { SpineChainInput, BandRibbon } from "./contour/index.ts";

/** A road's band ribbons unioned in plan through the shared curve module. */
export function unionBezierRibbons(port: BezierPort, ribbons: readonly BandRibbon[]): [number, number][][][] {
  return unionRibbonOutlines(port, ribbons.map((r) => r.outer));
}

/** Resolve legacy authorship once using the canonical Rust conversion. */
export function explicitSpineSnapshot(snapshot: ConstructionGraphSnapshot, port: BezierPort, offsets: readonly number[]): ConstructionGraphSnapshot {
  if (!snapshot.edges.some((e) => !e.curve && e.startNodeId.startsWith("spine:") && e.endNodeId.startsWith("spine:"))) return snapshot;
  const graph = spineGraphFromSnapshot(snapshot);
  const handles = new Map<string, CurveHandles>();
  for (const chain of chainsOf(graph)) {
    if (chain.nodes.length < 2) continue;
    const converted = automaticCurve(port, chain.nodes.map((n) => n.position), 0.01);
    for (let i = 0; i + 1 < chain.nodes.length; i += 1) {
      const a = chain.nodes[i]!.nodeId;
      const b = chain.nodes[i + 1]!.nodeId;
      const edge = snapshot.edges.find((e) => (e.startNodeId === a && e.endNodeId === b) || (e.startNodeId === b && e.endNodeId === a));
      if (!edge || edge.curve) continue;
      const h = converted.handles[i]!;
      handles.set(edge.edgeId, { ...h, start: edge.startNodeId === a ? h.start : h.end, end: edge.startNodeId === a ? h.end : h.start, bandOffsets: offsets });
    }
  }
  return { nodes: snapshot.nodes, edges: snapshot.edges.map((e) => ({ ...e, curve: e.curve ?? handles.get(e.edgeId) })) };
}

/** Converts graph-owned authoring data to sampled ribbons through the Rust port. */
export function bezierChains(
  snapshot: ConstructionGraphSnapshot,
  port: BezierPort,
  offsets: readonly number[],
  miterLimit: number,
  targetEdgeIds?: ReadonlySet<string>,
): readonly SpineChainInput[] {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n.position]));
  const edges = snapshot.edges.filter((e) => e.curve && e.startNodeId.startsWith("spine:") && e.endNodeId.startsWith("spine:"));
  const results = resolveCurves(port, edges.map((e) => ({ handles: e.curve!, start: nodes.get(e.startNodeId)!, end: nodes.get(e.endNodeId)! })), 0.025);
  const sections = new Map<string, { chain: number; points: readonly [CurvePoint, CurvePoint] }[]>();
  // One crossing for every ribbon, not one crossing each. `resolve` and
  // `join` around it were already batched; this was the odd one out, issued
  // from inside the loop, so a network of three hundred streets paid three
  // hundred serialise/parse round trips to the engine every time any one of
  // them was touched. The commands and their results are identical -- this
  // only stops paying the toll per chain.
  const derived = sampleRibbons(port, edges.map((e, i) => {
    const profile = e.curve!.bandOffsets.length ? e.curve!.bandOffsets : offsets;
    const endProfile = e.curve!.endBandOffsets?.length ? e.curve!.endBandOffsets! : profile;
    return {
      curve: results[i]!.curves[0]!,
      offsets: [Math.min(...profile), Math.max(...profile)] as const,
      endOffsets: [Math.min(...endProfile), Math.max(...endProfile)] as const,
    };
  }), 0.025);
  const chains = edges.map((e, i) => {
    const samples = results[i]!.samples[0]!.map((p) => curvePosition(p.position));
    const outer = derived[i]!;
    const half = outer.length / 2;
    for (const [id, points] of [
      [e.startNodeId, [curvePoint(outer[0]!), curvePoint(outer.at(-1)!)]],
      [e.endNodeId, [curvePoint(outer[half - 1]!), curvePoint(outer[half]!)]],
    ] as const) {
      sections.set(id, [...(sections.get(id) ?? []), { chain: i, points }]);
    }
    const ribbons = [{ bandIndex: 0, outer: [...outer] }];
    return { chainId: e.edgeId, controlPoints: samples, sampledPoints: samples, ribbons,
      bandOffsets: e.curve!.bandOffsets.length ? e.curve!.bandOffsets : offsets, miterLimit, tolerance: 0.025 };
  });
  // Connectivity, not proximity: disconnected or grade-separated anchors never join.
  const junctions = [...sections.values()].filter((incident) => incident.length > 1);
  const joins = port.curveBatch({ tolerance: 0.025, commands: junctions.map((incident) => ({
    kind: "join", sections: incident.map((entry) => entry.points),
  })) });
  junctions.forEach((incident, index) => {
    const outer = joins[index]!.ribbon!.outer;
    if (outer.length >= 3) chains[incident[0]!.chain]!.ribbons.push({ bandIndex: 0, outer: outer.map(curvePosition) });
  });
  return chains;
}

/** Product identities and profile policy surround generic Rust fitting and connections. */
export function planBezierRoad(input: {
  readonly snapshot: ConstructionGraphSnapshot;
  readonly topologies?: readonly ConstructionRegionTopology[];
  readonly port: BezierPort;
  readonly stroke: readonly ConstructionPosition[];
  readonly corridorId: string;
  readonly offsets: readonly number[];
  readonly miterLimit: number;
  readonly tolerance: number;
  readonly snapReach: number;
}) {
  const { port, offsets, corridorId } = input;
  const fitted = port.curveBatch({ tolerance: Math.max(input.tolerance, 0.025), commands: [
    { kind: "fit", points: input.stroke.map(curvePoint) },
  ] })[0]!;
  const controlPoints = [...fitted.curves.map((c) => curvePosition(c.points[0])), curvePosition(fitted.curves.at(-1)!.points[3])];
  const addedNodes = controlPoints.map((p, i) => ({ id: spineControlNodeId(corridorId, i), position: curvePoint(p) }));
  const addedEdges = fitted.handles.map((h, i) => ({
    edgeId: `spine-edge:${corridorId}:${i}`, startNodeId: addedNodes[i]!.id, endNodeId: addedNodes[i + 1]!.id,
    curve: { ...h, bandOffsets: offsets },
  }));
  const snapshot = explicitSpineSnapshot(input.snapshot, port, offsets);
  const network = port.curveNetwork({
    nodes: snapshot.nodes.filter((n) => n.id.startsWith("spine:")).map((n) => ({ id: n.id, position: curvePoint(n.position) })),
    edges: snapshot.edges.filter((e) => e.curve !== undefined).map((e) => ({ ...e, curve: e.curve! })),
    addedNodes, addedEdges, nodePrefix: `spine:${corridorId}#junction:`,
    snapTolerance: input.snapReach, heightTolerance: 0.15, tolerance: 0.005,
  });
  const initialPatch: ConstructionGraphPatch = { ...network, nodes: network.nodes.map((n) => ({ id: n.id, position: curvePosition(n.position) })) };
  const cloud = changedSpineCloud(snapshot, initialPatch, input.topologies);
  const originalEdges = new Map(input.snapshot.edges.map((e) => [e.edgeId, e]));
  const migrations = cloud.snapshot.edges.filter((e) => !originalEdges.get(e.edgeId)?.curve && originalEdges.has(e.edgeId) && !network.edges.some((n) => n.edgeId === e.edgeId));
  const graphPatch: ConstructionGraphPatch = {
    ...initialPatch,
    removedEdgeIds: [...network.removedEdgeIds, ...migrations.map((e) => e.edgeId)],
    edges: [...network.edges, ...migrations],
  };
  const chains = bezierChains(cloud.snapshot, port, offsets, input.miterLimit);
  const footprint = unionBezierRibbons(port, chains.filter((c) => c.chainId.startsWith(`spine-edge:${corridorId}:`)).flatMap((c) => c.ribbons ?? []));
  return { graphPatch, controlPoints, snapshot, chains, footprint,
    polyline: fitted.samples.flatMap((span, i) => (i ? span.slice(1) : span).map((p) => curvePosition(p.position))) };
}
