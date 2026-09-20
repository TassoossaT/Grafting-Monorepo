import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { hasTrait } from "../structure-types/registry.ts";

/**
 * One double-arrow widget per top run of every `"partition"`-trait panel on
 * the table -- a wall's own height widget, per `structure-types/panel`.
 *
 * The widget is a presentation projection, not a graph anchor, exactly like
 * a curve handle (`curve-handles.ts`): its two zones are pickable positions
 * an id encodes, resolved back to an `EditTarget` by whichever tool grabbed
 * one, never a node the engine itself knows about.
 */

const GROUP = "panel-height-widget:group:";
const SINGLE = "panel-height-widget:single:";

export type PanelHeightWidgetZone = "group" | "single";

export function panelHeightWidgetPickId(edgeId: string, zone: PanelHeightWidgetZone): string {
  return (zone === "group" ? GROUP : SINGLE) + encodeURIComponent(edgeId);
}

export function panelHeightWidgetPick(id: string): { readonly edgeId: string; readonly zone: PanelHeightWidgetZone } | undefined {
  if (id.startsWith(GROUP)) return { edgeId: decodeURIComponent(id.slice(GROUP.length)), zone: "group" };
  if (id.startsWith(SINGLE)) return { edgeId: decodeURIComponent(id.slice(SINGLE.length)), zone: "single" };
  return undefined;
}

/** Offset between the widget's two zones, small enough to read as one widget, large enough not to collide with the bezier midpoint handle sharing the same edge. */
const ZONE_OFFSET = 0.22;

/** Every top-run widget's two zone positions, across every partition panel `topologies` holds. */
export function panelHeightWidgets(
  topologies: readonly ConstructionRegionTopology[],
): readonly { readonly id: string; readonly position: ConstructionPosition }[] {
  const items: { readonly id: string; readonly position: ConstructionPosition }[] = [];
  const seen = new Set<string>();
  for (const topology of topologies) {
    if (!hasTrait(topology.surfaceType, "partition")) continue;
    const base = Math.min(...topology.nodes.map((node) => node.position.y));
    const positionOf = (id: string) => topology.nodes.find((node) => node.id === id)?.position;
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const edge of loop) {
        if (seen.has(edge.edgeId)) continue;
        seen.add(edge.edgeId);
        const start = positionOf(edge.startNodeId);
        const end = positionOf(edge.endNodeId);
        if (start === undefined || end === undefined) continue;
        // Only a genuine top run carries the widget -- a bottom run or a
        // post has no height of its own to raise.
        if (Math.abs(start.y - base) < 1e-3 || Math.abs(end.y - base) < 1e-3) continue;
        const mid: ConstructionPosition = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
        items.push({ id: panelHeightWidgetPickId(edge.edgeId, "group"), position: { ...mid, y: mid.y + ZONE_OFFSET } });
        items.push({ id: panelHeightWidgetPickId(edge.edgeId, "single"), position: { ...mid, y: mid.y - ZONE_OFFSET } });
      }
    }
  }
  return items;
}
