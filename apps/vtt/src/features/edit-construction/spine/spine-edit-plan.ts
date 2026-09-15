import type { BezierPort, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition, CurveHandleMode, CurveHandles } from "@/ports";

import { automaticCurve, curvePoint, curvePosition, resolveCurves } from "../topology/bezier-curve.ts";
import { planSpineAction, type SpineAction } from "./spine-actions.ts";
import { chainsOf } from "./spine-chains.ts";
import { spineGraphFromSnapshot } from "./spine-graph.ts";
import { curvePick, isBezierEditTarget } from "./spine-handles.ts";
import { spineComponent } from "./spine-owner.ts";

/**
 * Gives every spine span without authored handles the automatic curve
 * through its chain, once, through the Rust conversion. `offsets` is the
 * width a span with no profile of its own is given, and `owner`, when given,
 * the type it is stamped as generating.
 */
export function withAutomaticHandles(snapshot: ConstructionGraphSnapshot, port: BezierPort, offsets: readonly number[], owner?: string): ConstructionGraphSnapshot {
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
      handles.set(edge.edgeId, { ...h, start: edge.startNodeId === a ? h.start : h.end, end: edge.startNodeId === a ? h.end : h.start, bandOffsets: offsets, ...(owner === undefined ? {} : { surfaceType: owner }) });
    }
  }
  return { nodes: snapshot.nodes, edges: snapshot.edges.map((e) => ({ ...e, curve: e.curve ?? handles.get(e.edgeId) })) };
}

export interface SpineEditInput {
  readonly snapshot: ConstructionGraphSnapshot;
  readonly port: BezierPort;
  readonly targetId: string;
  readonly position: ConstructionPosition;
  readonly operationId: string;
  readonly action?: SpineAction;
  readonly width?: number;
  readonly endWidth?: number;
  readonly insert?: boolean;
  readonly mode?: CurveHandleMode;
}

/**
 * What one gesture does to a spine, as a graph patch -- dragging an anchor,
 * a handle or a span's midpoint, inserting an anchor, or a structural
 * action. Owner-free: the same for a road, a ramp or a curved wall. Whatever
 * the spine generates is regenerated from this patch by its owner.
 */
export function planSpineEditPatch(input: SpineEditInput): { readonly graphPatch: ConstructionGraphPatch; readonly selectedId: string } | undefined {
  const source = input.snapshot;
  const nodes = new Map(source.nodes.map((n) => [n.id, n.position]));
  const pick = curvePick(input.targetId);
  let graphPatch: ConstructionGraphPatch;
  let selectedId = input.targetId;
  if (input.action && input.action !== "edit") {
    graphPatch = planSpineAction(source, input.port, input.action, input.targetId, pick?.edgeId, input.operationId, input.width, input.endWidth);
  } else if (pick) {
    const edge = source.edges.find((e) => e.edgeId === pick.edgeId);
    if (!edge?.curve) return undefined;
    const curve = resolveCurves(input.port, [{ handles: edge.curve, start: nodes.get(edge.startNodeId)!, end: nodes.get(edge.endNodeId)! }], 0.025)[0]!.curves[0]!;
    const mode = input.mode ?? edge.curve.mode;
    const anchorId = pick.index === 1 ? edge.startNodeId : edge.endNodeId;
    const incident = source.edges.filter((e) => e.curve && e.edgeId !== edge.edgeId && (e.startNodeId === anchorId || e.endNodeId === anchorId));
    const paired = pick.index !== "midpoint" && incident.length === 1 ? incident[0] : undefined;
    const pairedIndex = paired?.startNodeId === anchorId ? 1 : 2;
    const pairedCurve = paired && resolveCurves(input.port, [{ handles: paired.curve!, start: nodes.get(paired.startNodeId)!, end: nodes.get(paired.endNodeId)! }], 0.025)[0]!.curves[0]!;
    let handleTarget = curvePoint(input.position);
    let automaticOpposite: typeof handleTarget | undefined;
    if (mode === "automatic" && pick.index !== "midpoint") {
      const farId = pick.index === 1 ? edge.endNodeId : edge.startNodeId;
      const otherId = paired && (paired.startNodeId === anchorId ? paired.endNodeId : paired.startNodeId);
      const automatic = automaticCurve(input.port, (otherId ? [otherId, anchorId, farId] : [anchorId, farId]).map((id) => nodes.get(id)!), 0.025);
      handleTarget = automatic.curves.at(-1)!.points[1];
      if (paired) automaticOpposite = automatic.curves[0]!.points[2];
    }
    const edited = input.port.curveBatch({ tolerance: 0.025, commands: [
      pick.index === "midpoint"
        ? input.insert ? { kind: "split", curve, t: 0.5, profile: edge.curve } : { kind: "pull", curve, t: 0.5, target: curvePoint(input.position) }
        : { kind: "handle", curve, index: pick.index, target: handleTarget, mode: mode === "automatic" ? "free" : mode, opposite: pairedCurve ? pairedCurve.points[pairedIndex] : null },
    ] })[0]!;
    const handles = edited.handles.map((h) => ({ ...h, mode: input.mode ?? edge.curve!.mode, bandOffsets: input.insert ? h.bandOffsets : edge.curve!.bandOffsets, endBandOffsets: input.insert ? h.endBandOffsets : edge.curve!.endBandOffsets, surfaceType: edge.curve!.surfaceType }));
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
      const pairEdges = paired && pairResult ? [{ ...paired, curve: { ...pairResult.handles[0]!, mode, bandOffsets: paired.curve!.bandOffsets, endBandOffsets: paired.curve!.endBandOffsets, surfaceType: paired.curve!.surfaceType } }] : [];
      graphPatch = { nodes: [], removedEdgeIds: [edge.edgeId, ...pairEdges.map((e) => e.edgeId)], edges: [{ ...edge, curve: handles[0]! }, ...pairEdges] };
    }
  } else {
    if (!isBezierEditTarget(source, input.targetId)) return undefined;
    const movedNodes = [{ id: input.targetId, position: input.position }];
    const moved = new Map(movedNodes.map((n) => [n.id, n]));
    const movedCloud = spineComponent({ nodes: source.nodes.map((n) => moved.get(n.id) ?? n), edges: source.edges }, [input.targetId]);
    const automatic = new Map(movedCloud.edges.filter((e) => e.curve?.mode === "automatic").map((e) => [e.edgeId,e.curve!]));
    const converted = automatic.size ? withAutomaticHandles({ ...movedCloud, edges: movedCloud.edges.map((e) => automatic.has(e.edgeId) ? {...e,curve:undefined} : e) }, input.port, [-2,2]) : movedCloud;
    const automaticEdges = converted.edges.filter((e) => automatic.has(e.edgeId)).map((e) => {
      const authored = automatic.get(e.edgeId)!;
      return { ...e, curve: { ...e.curve!, mode: "automatic" as const, bandOffsets: authored.bandOffsets, endBandOffsets: authored.endBandOffsets, surfaceType: authored.surfaceType } };
    });
    graphPatch = { nodes: movedNodes, removedEdgeIds: automaticEdges.map((e) => e.edgeId), edges: automaticEdges };
  }
  // Edge edits seed both anchors even when neither anchor moved.
  const seedIds = new Set(graphPatch.edges.flatMap((e) => [e.startNodeId, e.endNodeId]));
  graphPatch = { ...graphPatch, nodes: [
    ...graphPatch.nodes, ...source.nodes.filter((n) => seedIds.has(n.id) && !graphPatch.nodes.some((p) => p.id === n.id)),
  ] };
  return { graphPatch, selectedId };
}
