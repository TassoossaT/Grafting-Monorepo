import type { BezierPort, CubicBezier, CurvePoint, ConstructionGraphSnapshot, ConstructionGraphPatch, ConstructionRegionTopology, ConstructionPosition } from "@/ports";
import { curvePoint, curvePosition, unionRibbonOutlines } from "../../topology/bezier-curve.ts";
import { isSpineEdge, spineControlNodeId, spineRibbons, withAutomaticHandles } from "../../spine/index.ts";
import { changedSpineCloud } from "./path-cloud-scope.ts";
import type { SpineChainInput, BandRibbon } from "./contour/index.ts";
import { PATH_SURFACE_TYPE } from "./path-surface-type.ts";
import { isRoadSpan } from "./road-span.ts";

export { isRoadSpan } from "./road-span.ts";

/** A road's band ribbons unioned in plan through the shared curve module. */
export function unionBezierRibbons(port: BezierPort, ribbons: readonly BandRibbon[]): [number, number][][][] {
  return unionRibbonOutlines(port, ribbons.map((r) => r.outer));
}

/** Resolve legacy road authorship once using the canonical Rust conversion. */
export function explicitSpineSnapshot(snapshot: ConstructionGraphSnapshot, port: BezierPort, offsets: readonly number[]): ConstructionGraphSnapshot {
  return withAutomaticHandles(snapshot, port, offsets, PATH_SURFACE_TYPE);
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
  const edges = snapshot.edges.filter((e) => e.curve && isRoadSpan(e) && isSpineEdge(e));
  const sections = new Map<string, { chain: number; points: readonly [CurvePoint, CurvePoint] }[]>();
  // The same generator a sloped platform sweeps its spans with, batched over
  // every span of the network in one crossing per step.
  const swept = spineRibbons(port, edges.map((e) => ({ handles: e.curve!, start: nodes.get(e.startNodeId)!, end: nodes.get(e.endNodeId)! })), offsets, 0.025);
  const chains = edges.map((e, i) => {
    const samples = swept[i]!.resolved.samples[0]!.map((p) => curvePosition(p.position));
    const outer = swept[i]!.outline;
    const half = outer.length / 2;
    for (const [id, points] of [
      [e.startNodeId, [curvePoint(outer[0]!), curvePoint(outer.at(-1)!)]],
      [e.endNodeId, [curvePoint(outer[half - 1]!), curvePoint(outer[half]!)]],
    ] as const) {
      sections.set(id, [...(sections.get(id) ?? []), { chain: i, points }]);
    }
    const ribbons = [{ bandIndex: 0, outer: [...outer] }];
    return { chainId: e.edgeId, controlPoints: samples, sampledPoints: samples, ribbons,
      bandOffsets: e.curve!.bandOffsets.length ? e.curve!.bandOffsets : offsets, miterLimit, tolerance: 0.025,
      nodeIds: [e.startNodeId, e.endNodeId] as const };
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
  readonly authoredCurves?: readonly CubicBezier[];
  readonly curveMode?: "automatic" | "free";
  readonly corridorId: string;
  readonly offsets: readonly number[];
  readonly miterLimit: number;
  readonly tolerance: number;
  readonly snapReach: number;
}) {
  const { port, offsets, corridorId } = input;
  const fitted = port.curveBatch({ tolerance: Math.max(input.tolerance, 0.025), commands: [
    input.authoredCurves === undefined
      ? { kind: "fit", points: input.stroke.map(curvePoint) }
      : { kind: "sample", curves: input.authoredCurves },
  ] })[0]!;
  const controlPoints = [...fitted.curves.map((c) => curvePosition(c.points[0])), curvePosition(fitted.curves.at(-1)!.points[3])];
  const addedNodes = controlPoints.map((p, i) => ({ id: spineControlNodeId(corridorId, i), position: curvePoint(p) }));
  const addedEdges = fitted.handles.map((h, i) => ({
    edgeId: `spine-edge:${corridorId}:${i}`, startNodeId: addedNodes[i]!.id, endNodeId: addedNodes[i + 1]!.id,
    curve: { ...h, mode: input.curveMode ?? h.mode, bandOffsets: offsets, surfaceType: PATH_SURFACE_TYPE },
  }));
  const snapshot = explicitSpineSnapshot(input.snapshot, port, offsets);
  // A road snaps onto and splits other roads only: a ramp's spine passing
  // overhead is another structure's, never a junction to weld into.
  const foreign = new Set(snapshot.edges.filter((e) => !isRoadSpan(e)).flatMap((e) => [e.startNodeId, e.endNodeId]));
  const network = port.curveNetwork({
    nodes: snapshot.nodes.filter((n) => n.id.startsWith("spine:") && !foreign.has(n.id)).map((n) => ({ id: n.id, position: curvePoint(n.position) })),
    edges: snapshot.edges.filter((e) => e.curve !== undefined && isRoadSpan(e)).map((e) => ({ ...e, curve: e.curve! })),
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
