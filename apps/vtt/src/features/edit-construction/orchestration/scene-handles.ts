import type { BezierPort, ConstructionCurvedEdge, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { GlobalHandleKind } from "../global-handles/index.ts";
import { spineWidthHandles } from "../spine/spine-handles.ts";
import { spineDefaultOffsets } from "../structure-types/index.ts";
import { curveEdgesOf, curveHandles, curveMidframes } from "../topology/curve-handles.ts";
import { panelHeightWidgets } from "../topology/panel-height-widget.ts";
import { shownGlobalHandles } from "./global-handles/index.ts";

/**
 * Every edit handle the scene shows, in one list: what each one is for --
 * its kind, which is also what its look is chosen by -- and where it stands.
 * The one place that says which handles exist; whatever shows them only
 * draws this list. (The graph's own node dots are its debug view, not edit
 * handles, and are not here.)
 *
 * - anchor: a spine's control point;
 * - midpoint: a span's midpoint -- bend it, or double-click to insert a point;
 * - width: on the edge of a spine span's band -- widen or narrow the span;
 * - panelHeight: a wall run's own height widget;
 * - every whole-structure handle, by its own kind (`global-handles/`).
 */
export type SceneHandleKind = "anchor" | "midpoint" | "width" | "panelHeight" | GlobalHandleKind;

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
  readonly graph: ConstructionGraphSnapshot;
  readonly topologies: readonly ConstructionRegionTopology[];
  /** The session's curved contour edges, whose midpoints are handles too. */
  readonly contour: readonly ConstructionCurvedEdge[];
  /** Absent without the curve engine: then no curve has a handle. */
  readonly port?: Pick<BezierPort, "curveBatch">;
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
      for (const node of input.graph.nodes) if (anchors.has(node.id)) handles.push({ id: node.id, kind: "anchor", position: node.position });
      for (const handle of spineWidthHandles(frames, input.graph, spineDefaultOffsets)) handles.push({ id: handle.id, kind: "width", position: handle.position });
    }
    for (const handle of curveHandles(frames)) handles.push({ id: handle.id, kind: "midpoint", position: handle.position });
  }
  if (!input.pointsOnly) {
    // With a focus, only the focused structure's own.
    const widgetFaces = input.focus ? input.topologies.filter((topology) => input.focus!.faces.has(topology.surfaceKey.join("\u0000"))) : input.topologies;
    for (const widget of panelHeightWidgets(widgetFaces)) handles.push({ id: widget.id, kind: "panelHeight", position: widget.position });
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
