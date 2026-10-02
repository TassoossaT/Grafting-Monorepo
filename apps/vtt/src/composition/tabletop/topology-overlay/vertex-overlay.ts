import type { ConstructionGraphSnapshot, RenderPreviewDescriptor } from "@/ports";

/**
 * A dot on every vertex of the graph -- a debug view of the topology, and
 * nothing else reads it. The dots are not handles: they are drawn on a
 * channel of their own, never picked, and no tool can hide them or be told
 * apart by them.
 */

/** The preview channel the vertex dots are drawn on. */
export const VERTEX_OVERLAY_CHANNEL = "topology:vertices";

/** White leaves the dot's own colour as its texture paints it. */
const VERTEX_OVERLAY_COLOR = 0xffffff;

/** Every vertex's position, as a flat `[x, y, z, x, y, z, ...]` list. */
export function vertexOverlayOf(graph: Pick<ConstructionGraphSnapshot, "nodes">): Float32Array {
  const positions = new Float32Array(graph.nodes.length * 3);
  graph.nodes.forEach((node, index) => {
    positions[index * 3] = node.position.x;
    positions[index * 3 + 1] = node.position.y;
    positions[index * 3 + 2] = node.position.z;
  });
  return positions;
}

/** The dots as the descriptor that draws them. */
export function vertexOverlayDescriptor(positions: Float32Array): RenderPreviewDescriptor {
  return { kind: "points", positions, color: VERTEX_OVERLAY_COLOR, opacity: 1 };
}
