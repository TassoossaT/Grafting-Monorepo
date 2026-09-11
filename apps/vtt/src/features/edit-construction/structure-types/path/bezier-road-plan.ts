import type { BezierPort, CurvePoint, CurveHandles, ConstructionGraphSnapshot, ConstructionGraphPatch, ConstructionRegionTopology, ConstructionPosition } from "@/ports";
import { chainsOf, spineGraphFromSnapshot, spineControlNodeId } from "./spine-graph/index.ts";
import { changedSpineCloud } from "./path-cloud-scope.ts";
import type { SpineChainInput, BandRibbon } from "./contour/index.ts";

export function unionBezierRibbons(port: BezierPort, ribbons: readonly BandRibbon[]): [number, number][][][] {
  return port.planarBoolean({ operation: "union", subject: ribbons.map((r) => [r.outer.map((p) => [p.x, p.z] as const)]), clip: [] }).map((shape) => shape.map((ring) => ring.map((p) => [p[0], p[1]] as [number, number])));
}

export const curvePoint = (p: ConstructionPosition): CurvePoint => [p.x, p.y, p.z];
export const curvePosition = (p: CurvePoint): ConstructionPosition => ({ x: p[0], y: p[1], z: p[2] });

/** Resolve legacy authorship once using the canonical Rust conversion. */
export function explicitSpineSnapshot(snapshot: ConstructionGraphSnapshot, port: BezierPort, offsets: readonly number[]): ConstructionGraphSnapshot {
  if (!snapshot.edges.some((e) => !e.curve && e.startNodeId.startsWith("spine:") && e.endNodeId.startsWith("spine:"))) return snapshot;
  const graph = spineGraphFromSnapshot(snapshot);
  const handles = new Map<string, CurveHandles>();
  for (const chain of chainsOf(graph)) {
    if (chain.nodes.length < 2) continue;
    const converted = port.curveBatch({ tolerance: 0.01, commands: [{ kind: "automatic", points: chain.nodes.map((n) => curvePoint(n.position)) }] })[0]!;
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
export function bezierChains(snapshot: ConstructionGraphSnapshot, port: BezierPort, offsets: readonly number[], miterLimit: number): readonly SpineChainInput[] {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n.position]));
  const edges = snapshot.edges.filter((e) => e.curve && e.startNodeId.startsWith("spine:") && e.endNodeId.startsWith("spine:"));
  const results = port.curveBatch({ tolerance: 0.025, commands: edges.map((e) => ({
    kind: "resolve", handles: e.curve!, start: curvePoint(nodes.get(e.startNodeId)!), end: curvePoint(nodes.get(e.endNodeId)!),
  })) });
  const sections = new Map<string, { chain: number; points: readonly [CurvePoint, CurvePoint] }[]>();
  // One crossing for every ribbon, not one crossing each. `resolve` and
  // `join` around it were already batched; this was the odd one out, issued
  // from inside the loop, so a network of three hundred streets paid three
  // hundred serialise/parse round trips to the engine every time any one of
  // them was touched. The commands and their results are identical -- this
  // only stops paying the toll per chain.
  const derived = port.curveBatch({
    tolerance: 0.025,
    commands: edges.map((e, i) => {
      const profile = e.curve!.bandOffsets.length ? e.curve!.bandOffsets : offsets;
      const endProfile = e.curve!.endBandOffsets?.length ? e.curve!.endBandOffsets! : profile;
      return {
        kind: "ribbon" as const,
        curve: results[i]!.curves[0]!,
        offsets: [Math.min(...profile), Math.max(...profile)] as const,
        endOffsets: [Math.min(...endProfile), Math.max(...endProfile)] as const,
      };
    }),
  });
  const chains = edges.map((e, i) => {
    const samples = results[i]!.samples[0]!.map((p) => curvePosition(p.position));
    const outer = derived[i]!.ribbon!.outer;
    const half = outer.length / 2;
    for (const [id, points] of [
      [e.startNodeId, [outer[0]!, outer.at(-1)!]],
      [e.endNodeId, [outer[half - 1]!, outer[half]!]],
    ] as const) {
      sections.set(id, [...(sections.get(id) ?? []), { chain: i, points }]);
    }
    const ribbons = [{ bandIndex: 0, outer: outer.map(curvePosition) }];
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
  // **The chains this regeneration cannot draw.** `bezierChains` reads only
  // edges that carry handles, so a spine edge without them is skipped in
  // silence -- and the face it was holding up gets consumed by the
  // regeneration with nothing put back. That is the road losing a piece of
  // itself, and it is invisible from anywhere downstream: by the time the
  // union runs, the chain that was supposed to redraw that face is simply
  // not there to be missed.
  //
  // Reported rather than worked around. Guessing which faces to spare from
  // their names was tried and was wrong in both directions -- too strict
  // doubled every junction, too loose deleted again -- because the names
  // were never the problem. This is the structural condition itself, so the
  // caller can refuse the whole edit and say which edge caused it instead of
  // committing a partial one.
  const droppedChainEdgeIds = cloud.snapshot.edges
    .filter(
      (edge) =>
        edge.curve === undefined &&
        edge.startNodeId.startsWith("spine:") &&
        edge.endNodeId.startsWith("spine:"),
    )
    .map((edge) => edge.edgeId);
  const chains = bezierChains(cloud.snapshot, port, offsets, input.miterLimit);
  const footprint = unionBezierRibbons(port, chains.filter((c) => c.chainId.startsWith(`spine-edge:${corridorId}:`)).flatMap((c) => c.ribbons ?? []));
  return { graphPatch, controlPoints, snapshot, chains, footprint, droppedChainEdgeIds,
    polyline: fitted.samples.flatMap((span, i) => (i ? span.slice(1) : span).map((p) => curvePosition(p.position))) };
}
