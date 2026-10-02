import { useEffect } from "react";

import type { TabletopRuntime } from "../tabletop-runtime.ts";
import { edgeOverlayChannel, edgeOverlayDescriptor, edgeOverlayOf } from "./edge-overlay.ts";
import { VERTEX_OVERLAY_CHANNEL, vertexOverlayDescriptor, vertexOverlayOf } from "./vertex-overlay.ts";

/** Which parts of the topology are drawn. */
export interface TopologyOverlayOptions {
  /** A dot on every vertex. */
  readonly vertices: boolean;
  /** Every edge, coloured by its role. */
  readonly edges: boolean;
}

/**
 * Draws the topology over the map for the debug panel: the vertices and the
 * edges of whatever stands, redrawn once a frame at most after the map
 * changes. It is the only thing that draws them. No tool, handle mode or
 * gesture reaches it, so what a tool shows or hides never changes it, and it
 * never changes what a tool can pick.
 */
export function useTopologyOverlay(runtime: TabletopRuntime, options: TopologyOverlayOptions): void {
  const { vertices, edges } = options;
  useEffect(() => {
    if (!vertices && !edges) return;
    let shown = new Set<string>();
    let drawnRevision: number | undefined;
    let frame = 0;

    const draw = () => {
      frame = 0;
      const snapshot = runtime.getSnapshot();
      if (snapshot.status !== "ready" || snapshot.map.revision === drawnRevision) return;
      drawnRevision = snapshot.map.revision;
      const graph = runtime.getGraphSnapshot();
      const next = new Set<string>();
      if (vertices && graph.nodes.length > 0) {
        runtime.showPreview(vertexOverlayDescriptor(vertexOverlayOf(graph)), VERTEX_OVERLAY_CHANNEL);
        next.add(VERTEX_OVERLAY_CHANNEL);
      }
      if (edges) {
        for (const group of edgeOverlayOf(runtime, runtime.getAllRegionTopologies(), graph, runtime)) {
          if (group.positions.length === 0) continue;
          const channel = edgeOverlayChannel(group.role);
          runtime.showPreview(edgeOverlayDescriptor(group), channel);
          next.add(channel);
        }
      }
      // A channel drawn last time and not this time had its last edge or vertex removed.
      for (const channel of shown) if (!next.has(channel)) runtime.clearPreview(channel);
      shown = next;
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };

    schedule();
    const unsubscribe = runtime.subscribe(schedule);
    return () => {
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
      // A runtime already torn down has nothing left to clear.
      if (runtime.getSnapshot().status === "ready") for (const channel of shown) runtime.clearPreview(channel);
    };
  }, [runtime, vertices, edges]);
}
