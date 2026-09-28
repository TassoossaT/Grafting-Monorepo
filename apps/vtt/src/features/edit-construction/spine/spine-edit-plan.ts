import type { BezierPort, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition, CurveHandleMode, CurveHandles } from "@/ports";

import { automaticCurve, curvePoint, curvePosition, resolveCurves } from "../topology/bezier-curve.ts";
import { planSpineAction, type SpineAction } from "./spine-actions.ts";
import { chainsOf } from "./spine-chains.ts";
import { spineGraphFromSnapshot } from "./spine-graph.ts";
import { curvePick, isBezierEditTarget } from "./spine-handles.ts";
import { isSpineControlNodeId } from "./spine-node-id.ts";
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
  /** Explicit point deletion may change the adjacent curve shape. */
  readonly allowShapeChange?: boolean;
  /** Parameter of the grabbed span, supplied by the curve nearest-point query. */
  readonly parameter?: number;
  readonly mode?: CurveHandleMode;
  /**
   * Whether a dragged anchor may weld onto another spine's node or split a
   * span into a junction by landing near it. Off for an owner whose spine
   * moves in plan only: a spiral's turns pass right over each other.
   */
  readonly weld?: boolean;
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
    graphPatch = planSpineAction(source, input.port, input.action, input.targetId, pick?.edgeId, input.operationId, input.width, input.endWidth, input.allowShapeChange);
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
    // A straight or circular span keeps a shape when its midpoint is pulled:
    // it becomes the arc through its two anchors and the pointer, as a
    // two-point arc tool pulls a bulge. A free span is pulled as a cubic.
    const shapedPull = pick.index === "midpoint" && !input.insert && edge.curve.geometry !== undefined;
    const edited = input.port.curveBatch({ tolerance: 0.025, commands: [
      shapedPull
        ? { kind: "arcThrough", start: curve.points[0], through: curvePoint(input.position), end: curve.points[3] }
        : pick.index === "midpoint"
        ? input.insert ? { kind: "split", curve, t: input.parameter ?? 0.5, profile: edge.curve } : { kind: "pull", curve, t: input.parameter ?? 0.5, target: curvePoint(input.position) }
        : { kind: "handle", curve, index: pick.index, target: handleTarget, mode: mode === "automatic" ? "free" : mode, opposite: pairedCurve ? pairedCurve.points[pairedIndex] : null },
    ] })[0]!;
    const handles = edited.handles.map((h) => ({ ...h, mode: input.mode ?? edge.curve!.mode, bandOffsets: input.insert ? h.bandOffsets : edge.curve!.bandOffsets, endBandOffsets: input.insert ? h.endBandOffsets : edge.curve!.endBandOffsets, surfaceType: edge.curve!.surfaceType }));
    if (input.insert) {
      selectedId = `spine:${input.operationId}:0`;
      graphPatch = { nodes: [{ id: selectedId, position: curvePosition(edited.curves[0]!.points[3]) }], removedEdgeIds: [edge.edgeId], edges: [
        { ...edge, endNodeId: selectedId, curve: handles[0]! },
        { ...edge, edgeId: `${edge.edgeId}:split:${input.operationId}`, startNodeId: selectedId, curve: handles[1]! },
      ] };
    } else if (handles.length > 1) {
      // A pulled arc past a quarter turn comes back in quarter turns: the
      // span is replaced by that many, joined at new anchors on the arc.
      const ids = handles.slice(1).map((_, i) => `spine:${input.operationId}:${i}`);
      selectedId = ids[0]!;
      const anchors = [edge.startNodeId, ...ids, edge.endNodeId];
      graphPatch = {
        nodes: ids.map((id, i) => ({ id, position: curvePosition(edited.curves[i]!.points[3]) })),
        removedEdgeIds: [edge.edgeId],
        edges: handles.map((h, i) => ({
          ...edge,
          edgeId: i === 0 ? edge.edgeId : `${edge.edgeId}:arc:${input.operationId}:${i}`,
          startNodeId: anchors[i]!,
          endNodeId: anchors[i + 1]!,
          curve: { ...h, endBandOffsets: undefined },
        })),
      };
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
    const weld = input.weld ?? true;
    const snapNode = weld && source.nodes.find((n) => n.id !== input.targetId &&
      isSpineControlNodeId(n.id) &&
      Math.hypot(n.position.x - input.position.x, n.position.z - input.position.z) <= 0.55 &&
      Math.abs(n.position.y - input.position.y) <= 1.5);

    if (snapNode) {
      selectedId = snapNode.id;
      const targetId = input.targetId;
      const snapId = snapNode.id;
      const removedEdgeIds: string[] = [];
      const intermediateEdges: typeof source.edges[number][] = [];

      for (const edge of source.edges) {
        const connectsA = edge.startNodeId === targetId || edge.endNodeId === targetId;
        const connectsB = edge.startNodeId === snapId || edge.endNodeId === snapId;

        if (connectsA && connectsB) {
          // Direct edge between A and B: collapse edge, prune node A
          removedEdgeIds.push(edge.edgeId);
          continue;
        }

        if (connectsA) {
          removedEdgeIds.push(edge.edgeId);
          const startNodeId = edge.startNodeId === targetId ? snapId : edge.startNodeId;
          const endNodeId = edge.endNodeId === targetId ? snapId : edge.endNodeId;
          if (startNodeId !== endNodeId) {
            intermediateEdges.push({ ...edge, startNodeId, endNodeId, curve: undefined });
          }
          continue;
        }

        if (connectsB && edge.curve?.mode === "automatic") {
          removedEdgeIds.push(edge.edgeId);
          intermediateEdges.push({ ...edge, curve: undefined });
          continue;
        }

        intermediateEdges.push(edge);
      }

      const intermediateNodes = source.nodes.filter((n) => n.id !== targetId);
      const movedCloud = spineComponent({ nodes: intermediateNodes, edges: intermediateEdges }, [snapId]);
      const converted = withAutomaticHandles(movedCloud, input.port, [-2, 2]);
      const automaticEdges = converted.edges.filter((e) => movedCloud.edges.some((m) => m.edgeId === e.edgeId && !m.curve)).map((e) => {
        const original = source.edges.find((s) => s.edgeId === e.edgeId);
        const bandOffsets = original?.curve?.bandOffsets ?? [-2, 2];
        const endBandOffsets = original?.curve?.endBandOffsets;
        const surfaceType = original?.curve?.surfaceType;
        return {
          ...e,
          curve: e.curve ? { ...e.curve, mode: "automatic" as const, bandOffsets, endBandOffsets, surfaceType } : undefined,
        };
      }).filter((e): e is typeof e & { curve: NonNullable<typeof e.curve> } => e.curve !== undefined);

      graphPatch = {
        nodes: [{ id: snapId, position: snapNode.position }],
        removedEdgeIds: [...new Set([...removedEdgeIds, ...automaticEdges.map((e) => e.edgeId)])],
        edges: automaticEdges,
      };
    } else {
      // Check if target node was moved to meet an existing road edge (T-junction snap):
      const candidateEdges = !weld ? [] : source.edges.filter((e) =>
        e.curve &&
        e.startNodeId !== input.targetId &&
        e.endNodeId !== input.targetId &&
        isSpineControlNodeId(e.startNodeId) &&
        isSpineControlNodeId(e.endNodeId)
      );

      let tSnap: { edge: typeof source.edges[number]; t: number; junctionPosition: ConstructionPosition; splitCurves: import("@/ports").CurveResult } | undefined;
      for (const candidate of candidateEdges) {
        const startPos = nodes.get(candidate.startNodeId);
        const endPos = nodes.get(candidate.endNodeId);
        if (!startPos || !endPos) continue;
        const resolved = resolveCurves(input.port, [{ handles: candidate.curve!, start: startPos, end: endPos }], 0.025)[0];
        if (!resolved?.curves[0]) continue;
        const curve = resolved.curves[0];
        const near = input.port.curveBatch({ tolerance: 0.025, commands: [{ kind: "nearest", curve, point: curvePoint(input.position) }] })[0];
        if (!near?.parameter) continue;
        const t = near.parameter;
        if (t <= 0.05 || t >= 0.95) continue;
        const evaluated = input.port.curveBatch({ tolerance: 0.025, commands: [{ kind: "split", curve, t, profile: candidate.curve }] })[0];
        if (!evaluated?.curves[0]) continue;
        const proj = evaluated.curves[0].points[3];
        const dist = Math.hypot(proj[0] - input.position.x, proj[2] - input.position.z);
        const heightDiff = Math.abs(proj[1] - input.position.y);
        const reach = Math.max(...candidate.curve!.bandOffsets.map(Math.abs), 2.0);
        if (dist <= reach && heightDiff <= 1.5 && (!tSnap || dist < Math.hypot(tSnap.junctionPosition.x - input.position.x, tSnap.junctionPosition.z - input.position.z))) {
          tSnap = {
            edge: candidate,
            t,
            junctionPosition: curvePosition(proj),
            splitCurves: evaluated,
          };
        }
      }

      if (tSnap) {
        const targetId = input.targetId;
        const junctionPos = tSnap.junctionPosition;
        const splitEdge = tSnap.edge;

        const edgeA = {
          ...splitEdge,
          endNodeId: targetId,
          curve: {
            ...tSnap.splitCurves.handles[0]!,
            mode: "automatic" as const,
            bandOffsets: splitEdge.curve!.bandOffsets,
            endBandOffsets: splitEdge.curve!.endBandOffsets,
            surfaceType: splitEdge.curve!.surfaceType,
          },
        };
        const edgeB = {
          ...splitEdge,
          edgeId: `${splitEdge.edgeId}:split:${input.operationId}`,
          startNodeId: targetId,
          curve: {
            ...tSnap.splitCurves.handles[1]!,
            mode: "automatic" as const,
            bandOffsets: splitEdge.curve!.bandOffsets,
            endBandOffsets: splitEdge.curve!.endBandOffsets,
            surfaceType: splitEdge.curve!.surfaceType,
          },
        };

        const movedNodes = [{ id: targetId, position: junctionPos }];
        const movedMap = new Map(movedNodes.map((n) => [n.id, n]));
        const movedCloud = spineComponent({ nodes: source.nodes.map((n) => movedMap.get(n.id) ?? n), edges: source.edges }, [targetId]);
        const automatic = new Map(movedCloud.edges.filter((e) => e.edgeId !== splitEdge.edgeId && e.curve?.mode === "automatic").map((e) => [e.edgeId, e.curve!]));
        const converted = automatic.size ? withAutomaticHandles({ ...movedCloud, edges: movedCloud.edges.map((e) => automatic.has(e.edgeId) ? { ...e, curve: undefined } : e) }, input.port, [-2, 2]) : movedCloud;
        const automaticEdges = converted.edges.filter((e) => automatic.has(e.edgeId)).map((e) => {
          const authored = automatic.get(e.edgeId)!;
          return { ...e, curve: { ...e.curve!, mode: "automatic" as const, bandOffsets: authored.bandOffsets, endBandOffsets: authored.endBandOffsets, surfaceType: authored.surfaceType } };
        });

        graphPatch = {
          nodes: movedNodes,
          removedEdgeIds: [splitEdge.edgeId, ...automaticEdges.map((e) => e.edgeId)],
          edges: [edgeA, edgeB, ...automaticEdges],
        };
      } else {
        const movedNodes = [{ id: input.targetId, position: input.position }];
        const moved = new Map(movedNodes.map((n) => [n.id, n]));
        const movedCloud = spineComponent({ nodes: source.nodes.map((n) => moved.get(n.id) ?? n), edges: source.edges }, [input.targetId]);
        const automatic = new Map(movedCloud.edges.filter((e) => e.curve?.mode === "automatic").map((e) => [e.edgeId, e.curve!]));
        const converted = automatic.size ? withAutomaticHandles({ ...movedCloud, edges: movedCloud.edges.map((e) => automatic.has(e.edgeId) ? { ...e, curve: undefined } : e) }, input.port, [-2, 2]) : movedCloud;
        const automaticEdges = converted.edges.filter((e) => automatic.has(e.edgeId)).map((e) => {
          const authored = automatic.get(e.edgeId)!;
          return { ...e, curve: { ...e.curve!, mode: "automatic" as const, bandOffsets: authored.bandOffsets, endBandOffsets: authored.endBandOffsets, surfaceType: authored.surfaceType } };
        });
        graphPatch = { nodes: movedNodes, removedEdgeIds: automaticEdges.map((e) => e.edgeId), edges: automaticEdges };
      }
    }
  }
  // Edge edits seed both anchors even when neither anchor moved.
  const seedIds = new Set(graphPatch.edges.flatMap((e) => [e.startNodeId, e.endNodeId]));
  graphPatch = { ...graphPatch, nodes: [
    ...graphPatch.nodes, ...source.nodes.filter((n) => seedIds.has(n.id) && !graphPatch.nodes.some((p) => p.id === n.id)),
  ] };
  return { graphPatch, selectedId };
}
