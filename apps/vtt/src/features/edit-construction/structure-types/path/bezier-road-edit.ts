import type { BezierPort, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ApplyPatchReplacementRequest, CurveHandleMode } from "@/ports";
import { bezierChains, unionBezierRibbons, curvePoint, curvePosition, explicitSpineSnapshot } from "./bezier-road-plan.ts";
import { changedSpineCloud, standingRegionsForCloud } from "./path-cloud-scope.ts";
import { planSpineContour } from "./contour/index.ts";

import { planBezierAction, type BezierRoadAction } from "./bezier-road-actions.ts";

const HANDLE = "bezier-handle:";
const MIDPOINT = "bezier-midpoint:";
export function curvePickId(edgeId: string, index: 1 | 2 | "midpoint"): string {
  return index === "midpoint" ? MIDPOINT + encodeURIComponent(edgeId) : HANDLE + index + ":" + encodeURIComponent(edgeId);
}
function curvePick(id: string): { edgeId: string; index: 1 | 2 | "midpoint" } | undefined {
  if (id.startsWith(MIDPOINT)) return { edgeId: decodeURIComponent(id.slice(MIDPOINT.length)), index: "midpoint" };
  if (id.startsWith(HANDLE + "1:") || id.startsWith(HANDLE + "2:")) {
    return { edgeId: decodeURIComponent(id.slice(HANDLE.length + 2)), index: id[HANDLE.length] === "1" ? 1 : 2 };
  }
  return undefined;
}
/** Pick handles are presentation projections, not extra graph anchors. */
export function bezierPickHandles(snapshot: ConstructionGraphSnapshot, port: BezierPort) {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n.position]));
  const edges = snapshot.edges.filter((e) => e.curve);
  if (!edges.length) return [];
  const resolved = port.curveBatch({ tolerance: 0.025, commands: edges.map((e) => ({
    kind: "resolve", handles: e.curve!, start: curvePoint(nodes.get(e.startNodeId)!), end: curvePoint(nodes.get(e.endNodeId)!),
  })) });
  return edges.flatMap((e, i) => {
    const curve = resolved[i]!.curves[0]!;
    const halves = port.curveBatch({ tolerance: 0.025, commands: [{ kind: "split", curve, t: 0.5 }] })[0]!;
    return [
      { id: curvePickId(e.edgeId, 1), position: curvePosition(curve.points[1]) },
      { id: curvePickId(e.edgeId, 2), position: curvePosition(curve.points[2]) },
      { id: curvePickId(e.edgeId, "midpoint"), position: curvePosition(halves.curves[0]!.points[3]) },
    ];
  });
}
export function isBezierEditTarget(snapshot: ConstructionGraphSnapshot, id: string): boolean {
  const pick = curvePick(id);
  return pick ? snapshot.edges.some((e) => e.edgeId === pick.edgeId && e.curve) :
    snapshot.edges.some((e) => e.curve && (e.startNodeId === id || e.endNodeId === id));
}

/** One complete gesture plan; the caller commits it once or discards it. */
export function planBezierEdit(input: {
  readonly snapshot: ConstructionGraphSnapshot;
  readonly topologies: readonly ConstructionRegionTopology[];
  readonly port: BezierPort;
  readonly targetId: string;
  readonly position: ConstructionPosition;
  readonly operationId: string;
  readonly tableId: string;
  readonly action?: BezierRoadAction;
  readonly width?: number;
  readonly endWidth?: number;
  readonly insert?: boolean;
  readonly mode?: CurveHandleMode;
}): { request: ApplyPatchReplacementRequest; preview: Float32Array; selectedId: string } | undefined {
  const source = explicitSpineSnapshot(input.snapshot, input.port, [-2, 2]);
  const nodes = new Map(source.nodes.map((n) => [n.id, n.position]));
  const pick = curvePick(input.targetId);
  let graphPatch: ConstructionGraphPatch;
  let selectedId = input.targetId;
  if (input.action && input.action !== "edit") {
    graphPatch = planBezierAction(source, input.port, input.action, input.targetId, pick?.edgeId, input.operationId, input.width, input.endWidth);
  } else if (pick) {
    const edge = source.edges.find((e) => e.edgeId === pick.edgeId);
    if (!edge?.curve) return undefined;
    const curve = input.port.curveBatch({ tolerance: 0.025, commands: [{
      kind: "resolve", handles: edge.curve, start: curvePoint(nodes.get(edge.startNodeId)!), end: curvePoint(nodes.get(edge.endNodeId)!),
    }] })[0]!.curves[0]!;
    const mode = input.mode ?? edge.curve.mode;
    const anchorId = pick.index === 1 ? edge.startNodeId : edge.endNodeId;
    const incident = source.edges.filter((e) => e.curve && e.edgeId !== edge.edgeId && (e.startNodeId === anchorId || e.endNodeId === anchorId));
    const paired = pick.index !== "midpoint" && incident.length === 1 ? incident[0] : undefined;
    const pairedIndex = paired?.startNodeId === anchorId ? 1 : 2;
    const pairedCurve = paired && input.port.curveBatch({ tolerance: 0.025, commands: [{
      kind: "resolve", handles: paired.curve!, start: curvePoint(nodes.get(paired.startNodeId)!), end: curvePoint(nodes.get(paired.endNodeId)!),
    }] })[0]!.curves[0]!;
    let handleTarget = curvePoint(input.position);
    let automaticOpposite: typeof handleTarget | undefined;
    if (mode === "automatic" && pick.index !== "midpoint") {
      const farId = pick.index === 1 ? edge.endNodeId : edge.startNodeId;
      const otherId = paired && (paired.startNodeId === anchorId ? paired.endNodeId : paired.startNodeId);
      const points = (otherId ? [otherId, anchorId, farId] : [anchorId, farId]).map((id) => curvePoint(nodes.get(id)!));
      const automatic = input.port.curveBatch({ tolerance: 0.025, commands: [{ kind: "automatic", points }] })[0]!;
      handleTarget = automatic.curves.at(-1)!.points[1];
      if (paired) automaticOpposite = automatic.curves[0]!.points[2];
    }
    const edited = input.port.curveBatch({ tolerance: 0.025, commands: [
      pick.index === "midpoint"
        ? input.insert ? { kind: "split", curve, t: 0.5, profile: edge.curve } : { kind: "pull", curve, t: 0.5, target: curvePoint(input.position) }
        : { kind: "handle", curve, index: pick.index, target: handleTarget, mode: mode === "automatic" ? "free" : mode, opposite: pairedCurve ? pairedCurve.points[pairedIndex] : null },
    ] })[0]!;
    const handles = edited.handles.map((h) => ({ ...h, mode: input.mode ?? edge.curve!.mode, bandOffsets: input.insert ? h.bandOffsets : edge.curve!.bandOffsets, endBandOffsets: input.insert ? h.endBandOffsets : edge.curve!.endBandOffsets }));
    if (input.insert) {
      selectedId = `spine:${input.operationId}:0`;
      graphPatch = { nodes: [{ id: selectedId, position: curvePosition(edited.curves[0]!.points[3]) }], removedEdgeIds: [edge.edgeId], edges: [
        { ...edge, endNodeId: selectedId, curve: handles[0]! },
        { ...edge, edgeId: `${edge.edgeId}:split:${input.operationId}`, startNodeId: selectedId, curve: handles[1]! },
      ] };
    } else {
            const opposite = automaticOpposite ?? edited.opposite;
      const pairResult = paired && pairedCurve && opposite && input.port.curveBatch({ tolerance: 0.025, commands: [{
        kind: "handle", curve: pairedCurve, index: pairedIndex, target: opposite, mode: "free", opposite: null,
      }] })[0]!;
      const pairEdges = paired && pairResult ? [{ ...paired, curve: { ...pairResult.handles[0]!, mode, bandOffsets: paired.curve!.bandOffsets, endBandOffsets: paired.curve!.endBandOffsets } }] : [];
      graphPatch = { nodes: [], removedEdgeIds: [edge.edgeId, ...pairEdges.map((e) => e.edgeId)], edges: [{ ...edge, curve: handles[0]! }, ...pairEdges] };
    }
  } else {
    if (!isBezierEditTarget(source, input.targetId)) return undefined;
    const movedNodes = [{ id: input.targetId, position: input.position }];
    const movedCloud = changedSpineCloud(source, { nodes: movedNodes, edges: [] }).snapshot;
    const automatic = new Map(movedCloud.edges.filter((e) => e.curve?.mode === "automatic").map((e) => [e.edgeId,e.curve!]));
    const converted = automatic.size ? explicitSpineSnapshot({ ...movedCloud, edges: movedCloud.edges.map((e) => automatic.has(e.edgeId) ? {...e,curve:undefined} : e) }, input.port, [-2,2]) : movedCloud;
    const automaticEdges = converted.edges.filter((e) => automatic.has(e.edgeId)).map((e) => ({...e,curve:{...e.curve!,mode:"automatic" as const,bandOffsets:automatic.get(e.edgeId)!.bandOffsets,endBandOffsets:automatic.get(e.edgeId)!.endBandOffsets}}));
    graphPatch = { nodes: movedNodes, removedEdgeIds: automaticEdges.map((e) => e.edgeId), edges: automaticEdges };
  }
  // Edge edits seed both anchors even when neither anchor moved.
  const seedIds = new Set(graphPatch.edges.flatMap((e) => [e.startNodeId, e.endNodeId]));
  graphPatch = { ...graphPatch, nodes: [
    ...graphPatch.nodes, ...source.nodes.filter((n) => seedIds.has(n.id) && !graphPatch.nodes.some((p) => p.id === n.id)),
  ] };
  const cloud = changedSpineCloud(source, graphPatch);
  const chains = bezierChains(cloud.snapshot, input.port, [-2, 2], 4);
  const beforeCloud = changedSpineCloud(source, { nodes: graphPatch.nodes.filter((n) => source.nodes.some((s) => s.id === n.id)), edges: [] });
  const standing = standingRegionsForCloud(input.topologies, [...cloud.positions, ...beforeCloud.positions], new Set([...cloud.corridorIds, ...beforeCloud.corridorIds]));
  if (chains.length === 0) return { request: { operationId: input.operationId, sourceSurfaceKeys: standing.map((s) => s.surfaceKey), patch: { nodes: [], edges: [], regions: [] }, graphPatch }, preview: new Float32Array(), selectedId };
  const edgeUses = new Map<string, boolean[]>();
  for (const topology of input.topologies) for (const loop of [...topology.outerLoops, ...topology.holes]) {
    for (const e of loop) edgeUses.set(e.edgeId, [...(edgeUses.get(e.edgeId) ?? []), e.reversed]);
  }
  const plan = planSpineContour({ tableId: input.tableId, operationId: `${[...cloud.corridorIds].sort()[0] ?? input.operationId}:edit:${input.operationId}`, surfaceType: "path",
    union: (ribbons) => unionBezierRibbons(input.port, ribbons), editedChains: chains, standingRegions: standing, existingNodes: source.nodes, existingEdgeUses: edgeUses });
  if (!plan) return undefined;
  const segments = chains.flatMap((c) => c.sampledPoints!.slice(1).flatMap((p, i) => {
    const a = c.sampledPoints![i]!; return [a.x, a.y, a.z, p.x, p.y, p.z];
  }));
  return { request: { operationId: input.operationId, sourceSurfaceKeys: plan.consumedSurfaceKeys, patch: plan.patch, graphPatch },
    preview: Float32Array.from(segments), selectedId };
}
