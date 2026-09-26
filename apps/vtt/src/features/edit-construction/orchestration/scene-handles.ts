import type { BezierPort, ConstructionCurvedEdge, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { GlobalHandleKind } from "../global-handles/index.ts";
import { curveEdgesOf, curveHandles } from "../topology/curve-handles.ts";
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
 * - midpoint: a span's midpoint -- bend it, or click to insert a point;
 * - panelHeight: a wall run's own height widget;
 * - every whole-structure handle, by its own kind (`global-handles/`).
 */
export type SceneHandleKind = "anchor" | "midpoint" | "panelHeight" | GlobalHandleKind;

export interface SceneHandle {
  readonly id: string;
  readonly kind: SceneHandleKind;
  readonly position: ConstructionPosition;
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
}

export function sceneHandles(input: SceneHandleInput): readonly SceneHandle[] {
  const handles: SceneHandle[] = [];
  if (input.port) {
    const edges = curveEdgesOf(input.graph, input.contour, input.port);
    const shown = input.pointsOnly ? edges.filter((edge) => edge.store === "spine") : edges;
    if (input.pointsOnly) {
      const anchors = new Set(shown.flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
      for (const node of input.graph.nodes) if (anchors.has(node.id)) handles.push({ id: node.id, kind: "anchor", position: node.position });
    }
    for (const handle of curveHandles(shown, input.port)) handles.push({ id: handle.id, kind: "midpoint", position: handle.position });
  }
  if (!input.pointsOnly) {
    for (const widget of panelHeightWidgets(input.topologies)) handles.push({ id: widget.id, kind: "panelHeight", position: widget.position });
  }
  if (input.owns) {
    for (const handle of shownGlobalHandles({ graph: input.graph, topologies: input.topologies, cloudFor: input.cloudFor }, input.owns)) {
      handles.push({ id: handle.id, kind: handle.kind, position: handle.position });
    }
  }
  return handles;
}
