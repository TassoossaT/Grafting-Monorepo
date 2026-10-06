import type { BezierPort, ConstructionCurvedEdge, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { GlobalHandleKind } from "../global-handles/index.ts";
import { spineWidthHandles } from "../spine/spine-handles.ts";
import { spineDefaultOffsets } from "../structure-types/index.ts";
import { curveEdgesOf, curveHandles, curveMidframes, curveAnchorId, curveActionId, curvePickId, curveEndWidthId } from "../topology/curve-handles.ts";
import { spanOffsets } from "../spine/spine-ribbons.ts";
import { openSpineChain } from "../spine/spine-open-chain.ts";
import { spineComponent } from "../spine/spine-owner.ts";
import { openingHandles, type OpeningRunPort } from "../topology/opening-handles.ts";
import { panelHeightWidgets } from "../topology/panel-height-widget.ts";
import { shownGlobalHandles } from "./global-handles/index.ts";

/**
 * Every edit handle the scene shows, in one list: what each one is for --
 * its kind, which is also what its look is chosen by -- and where it stands.
 * The one place that says which handles exist; whatever shows them only
 * draws this list.
 *
 * - anchor: a spine's control point;
 * - midpoint: a span's midpoint -- bend it, or double-click to insert a point;
 * - width: on the edge of a spine span's band -- widen or narrow the span;
 * - panelHeight: a wall run's own height widget;
 * - corner and side: the corners and sides of the focused opening, which
 *   resize it (`topology/opening-handles.ts`);
 * - every whole-structure handle, by its own kind (`global-handles/`).
 */
export type SceneHandleKind = "anchor" | "midpoint" | "width" | "panelHeight" | "disconnect" | "deleteSegment" | "closeCurve" | GlobalHandleKind;

export interface SceneHandle {
  readonly id: string;
  readonly kind: SceneHandleKind;
  readonly position: ConstructionPosition;
}

/**
 * The one structure whose handles show -- the one under the pointer: its
 * faces, by surface key joined with NUL, or, for a spine, its control nodes.
 */
export interface HandleFocus {
  readonly faces: ReadonlySet<string>;
  readonly spineNodes: ReadonlySet<string>;
  /** The way the viewer looks, in plan: of a handle standing off each side of a face, only the side facing it shows. */
  readonly viewer?: { readonly x: number; readonly z: number };
}

/** Whether `handle` belongs to the focused structure. */
function focused(handle: { readonly nodeIds: readonly string[]; readonly faces?: readonly string[] }, focus: HandleFocus): boolean {
  return handle.faces ? handle.faces.some((face) => focus.faces.has(face)) : handle.nodeIds.some((id) => focus.spineNodes.has(id));
}

export interface SceneHandleInput {
  readonly selected?: string;
  readonly graph: ConstructionGraphSnapshot;
  readonly topologies: readonly ConstructionRegionTopology[];
  /** The session's curved contour edges, whose midpoints are handles too. */
  readonly contour: readonly ConstructionCurvedEdge[];
  /** Absent without the curve engine: then no curve has a handle. */
  readonly port?: Pick<BezierPort, "curveBatch">;
  /** Places an opening's handles on its whole box along the walls it crosses; absent, on the part on its first wall. */
  readonly runs?: OpeningRunPort;
  readonly cloudFor: (request: { readonly seed: ConstructionSurfaceKey; readonly surfaceType: string }) => { readonly surfaceKeys: readonly ConstructionSurfaceKey[] };
  /** A tool editing spines by their points: only spines' points and midpoints, never contours' or walls'. */
  readonly pointsOnly: boolean;
  /** The types whose whole-structure handles show -- the active tool's; none when absent. */
  readonly owns?: (surfaceType: string) => boolean;
  /** Only the focused structure's handles and spine points show; absent, every one does. */
  readonly focus?: HandleFocus;
}

export function sceneHandles(input: SceneHandleInput): readonly SceneHandle[] {
  const handles: SceneHandle[] = [];
  if (input.port) {
    const edges = curveEdgesOf(input.graph, input.contour, input.port);
    const spines = input.pointsOnly ? edges.filter((edge) => edge.store === "spine") : edges;
    const { focus } = input;
    const shown = focus ? spines.filter((edge) => edge.store !== "spine" || (focus.spineNodes.has(edge.startNodeId) && focus.spineNodes.has(edge.endNodeId))) : spines;
    // One split per span places both the handles standing on its middle.
    const frames = curveMidframes(shown, input.port);
    if (input.pointsOnly) {
      const anchors = new Set(shown.flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
      for (const node of input.graph.nodes) if (anchors.has(node.id)) handles.push({ id: curveAnchorId(node.id), kind: "anchor", position: node.position });
      for (const handle of spineWidthHandles(frames, input.graph, spineDefaultOffsets)) handles.push({ id: handle.id, kind: "width", position: handle.position });
      for (const frame of frames) {
        const span = input.graph.edges.find((edge) => edge.edgeId === frame.edge.edgeId);
        const defaults = span?.curve?.surfaceType ? spineDefaultOffsets(span.curve.surfaceType) : undefined;
        if (!span?.curve || !defaults) continue;
        const { endOffsets } = spanOffsets(span.curve, defaults);
        const [, , before, end] = frame.edge.curve.points;
        const length = Math.hypot(end[0] - before[0], end[2] - before[2]);
        if (length > 1e-9) handles.push({ id: curveEndWidthId(span.edgeId), kind: "width", position: { x: end[0] - (end[2] - before[2]) / length * endOffsets[1], y: end[1], z: end[2] + (end[0] - before[0]) / length * endOffsets[1] } });
        const midpointId = curvePickId(span.edgeId, "midpoint");
        if (input.selected === midpointId) handles.push({ id: curveActionId(midpointId, "delete-segment"), kind: "deleteSegment", position: { ...frame.position, y: frame.position.y + 0.6 } });
      }
      const node = input.graph.nodes.find((node) => node.id === input.selected && anchors.has(node.id));
      if (node) {
        const graph = { ...input.graph, edges: input.graph.edges.filter((edge) => shown.some((span) => span.edgeId === edge.edgeId)) };
        const component = spineComponent(graph, [node.id]);
        const incident = component.edges.filter((edge) => edge.startNodeId === node.id || edge.endNodeId === node.id);
        if (incident.length > 1) handles.push({ id: curveActionId(node.id, "disconnect"), kind: "disconnect", position: { ...node.position, y: node.position.y + 0.6 } });
        const chain = openSpineChain(component.edges);
        if (incident.length === 1 && chain && component.edges.length >= 2) handles.push({ id: curveActionId(node.id, "close"), kind: "closeCurve", position: { ...node.position, y: node.position.y + 0.6 } });
      }
    }
    for (const handle of curveHandles(frames)) handles.push({ id: handle.id, kind: "midpoint", position: handle.position });
  }
  if (!input.pointsOnly) {
    // With a focus, only the focused structure's own.
    const widgetFaces = input.focus ? input.topologies.filter((topology) => input.focus!.faces.has(topology.surfaceKey.join("\u0000"))) : input.topologies;
    for (const widget of panelHeightWidgets(widgetFaces)) handles.push({ id: widget.id, kind: "panelHeight", position: widget.position });
  }
  // The focused opening's own: a corner resizes it in both, a side moves that side.
  if (input.owns && input.focus) {
    for (const handle of openingHandles(input.topologies, input.focus.faces, input.owns, input.runs)) handles.push({ id: handle.id, kind: handle.kind, position: handle.position });
  }
  if (input.owns) {
    for (const handle of shownGlobalHandles({ graph: input.graph, topologies: input.topologies, cloudFor: input.cloudFor }, input.owns)) {
      if (input.focus && !focused(handle, input.focus)) continue;
      // The side of a face turned away from the viewer.
      const viewer = input.focus?.viewer;
      if (viewer && handle.facing && handle.facing.x * viewer.x + handle.facing.z * viewer.z > 0) continue;
      handles.push({ id: handle.id, kind: handle.kind, position: handle.position });
    }
  }
  return handles;
}
