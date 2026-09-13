import type { BezierPort, CurvePoint, CurveHandles, ConstructionGraphSnapshot, ConstructionGraphPatch, ConstructionRegionTopology, ConstructionPosition } from "@/ports";
import { chainsOf, spineGraphFromSnapshot, spineControlNodeId } from "./spine-graph/index.ts";
import { changedSpineCloud, extractCorridorsFromEdgeId } from "./path-cloud-scope.ts";
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
export function bezierChains(
  snapshot: ConstructionGraphSnapshot,
  port: BezierPort,
  offsets: readonly number[],
  miterLimit: number,
  targetEdgeIds?: ReadonlySet<string>,
): readonly SpineChainInput[] {
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
    if (outer.length >= 3) {
      const target = targetEdgeIds
        ? (incident.find((entry) => targetEdgeIds.has(edges[entry.chain]!.edgeId)) ?? incident[0]!)
        : incident[0]!;
      chains[target.chain]!.ribbons.push({ bandIndex: 0, outer: outer.map(curvePosition) });
    }
  });
  return targetEdgeIds ? chains.filter((c) => targetEdgeIds.has(c.chainId)) : chains;
}

/**
 * The turn, in degrees, past which a stroke is read as two runs meeting at a
 * corner rather than one road bending.
 *
 * Mirrors `grafting_graph_core::bezier::GESTURE_CORNER_DEGREES`, and is
 * passed explicitly rather than left to the engine's default so that the
 * value a road is authored with is visible on this side too -- the same
 * reason every other tolerance in this plan is named here.
 */
export const PATH_CORNER_DEGREES = 75;

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
  /**
   * Turn past which the stroke breaks into separate runs. Omitted, the
   * stroke is fitted as one smooth run however sharply it was drawn --
   * which is what every road did before, and is still what a caller with no
   * opinion about corners should get.
   */
  readonly cornerDegrees?: number;
}) {
  const { port, offsets, corridorId } = input;
  const fitted = port.curveBatch({ tolerance: Math.max(input.tolerance, 0.025), commands: [
    { kind: "fit", points: input.stroke.map(curvePoint), cornerDegrees: input.cornerDegrees },
  ] })[0]!;
  const controlPoints = [...fitted.curves.map((c) => curvePosition(c.points[0])), curvePosition(fitted.curves.at(-1)!.points[3])];
  const addedNodes = controlPoints.map((p, i) => ({ id: spineControlNodeId(corridorId, i), position: curvePoint(p) }));
  const addedEdges = fitted.handles.map((h, i) => ({
    edgeId: `spine-edge:${corridorId}:${i}`, startNodeId: addedNodes[i]!.id, endNodeId: addedNodes[i + 1]!.id,
    curve: { ...h, bandOffsets: offsets },
  }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of input.stroke) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const reach = Math.max(input.snapReach, 5.0);
  const strokeMinX = minX - reach, strokeMaxX = maxX + reach;
  const strokeMinZ = minZ - reach, strokeMaxZ = maxZ + reach;
  const nodeMap = new Map(input.snapshot.nodes.map((n) => [n.id, n]));
  const nearbyEdges = input.snapshot.edges.filter((e) => {
    if (!e.curve || !e.startNodeId.startsWith("spine:") || !e.endNodeId.startsWith("spine:")) return false;
    const a = nodeMap.get(e.startNodeId);
    const b = nodeMap.get(e.endNodeId);
    if (!a || !b) return false;
    const eMinX = Math.min(a.position.x, b.position.x) - reach;
    const eMaxX = Math.max(a.position.x, b.position.x) + reach;
    const eMinZ = Math.min(a.position.z, b.position.z) - reach;
    const eMaxZ = Math.max(a.position.z, b.position.z) + reach;
    return !(eMaxX < minX || eMinX > maxX || eMaxZ < minZ || eMinZ > maxZ);
  });
  const candidateNodeIds = new Set<string>();
  for (const e of nearbyEdges) {
    candidateNodeIds.add(e.startNodeId);
    candidateNodeIds.add(e.endNodeId);
  }
  for (const n of input.snapshot.nodes) {
    if (n.id.startsWith("spine:") && n.position.x >= strokeMinX && n.position.x <= strokeMaxX && n.position.z >= strokeMinZ && n.position.z <= strokeMaxZ) {
      candidateNodeIds.add(n.id);
    }
  }
  const candidateNodes = input.snapshot.nodes.filter((n) => candidateNodeIds.has(n.id));

  const snapshot = explicitSpineSnapshot(input.snapshot, port, offsets);
  const network = port.curveNetwork({
    nodes: candidateNodes.filter((n) => n.id.startsWith("spine:")).map((n) => ({ id: n.id, position: curvePoint(n.position) })),
    edges: nearbyEdges.map((e) => ({ ...e, curve: e.curve! })),
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
  const directlyAffectedEdgeIds = new Set(network.edges.map((e) => e.edgeId));
  for (const node of network.nodes) {
    for (const e of nearbyEdges) {
      if (e.startNodeId === node.id || e.endNodeId === node.id) {
        directlyAffectedEdgeIds.add(e.edgeId);
      }
    }
  }
  const directlyAffectedCorridors = new Set<string>([corridorId]);
  for (const edgeId of directlyAffectedEdgeIds) {
    for (const c of extractCorridorsFromEdgeId(edgeId)) {
      directlyAffectedCorridors.add(c);
    }
  }
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
