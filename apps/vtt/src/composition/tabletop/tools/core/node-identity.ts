import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { PointerSample } from "./tool-context.ts";

/**
 * Which graph node the pointer is on, by geometry -- never by which sprite
 * the pick met. The dots drawn on the graph's nodes are a visualization
 * with no function: a tool that wants "the node here" -- a roof taking the
 * height of the corner it was begun on, a ramp the height of its point --
 * asks this, so it reads the same whether the dots are drawn or not.
 */

/** How near the pointer's ray must pass to a node, on the screen, for the node to be what is there. */
export const NODE_PIXELS = 12;
/** What that is, in metres, when the screen's scale is unknown. */
const NODE_FALLBACK = 0.25;

export interface NodeAt {
  readonly id: string;
  readonly position: ConstructionPosition;
}

/**
 * The node of `nodes` nearest the pointer, within {@link NODE_PIXELS} of its
 * ray -- or of the point it hit, with no ray -- and not behind what was hit.
 */
export function nodeByGeometry(hit: Pick<PointerSample, "point" | "ray">, nodes: readonly NodeAt[], metersPerPixel: number | undefined): NodeAt | undefined {
  const reach = metersPerPixel !== undefined && metersPerPixel > 0 ? metersPerPixel * NODE_PIXELS : NODE_FALLBACK;
  const { ray, point } = hit;
  let best: { node: NodeAt; distance: number } | undefined;
  if (ray) {
    const d = ray.direction;
    const length = Math.hypot(d.x, d.y, d.z) || 1;
    const u = { x: d.x / length, y: d.y / length, z: d.z / length };
    // How far along the ray the surface was hit: a node much farther is behind it.
    const hitAt = (point.x - ray.origin.x) * u.x + (point.y - ray.origin.y) * u.y + (point.z - ray.origin.z) * u.z;
    for (const node of nodes) {
      const w = { x: node.position.x - ray.origin.x, y: node.position.y - ray.origin.y, z: node.position.z - ray.origin.z };
      const along = w.x * u.x + w.y * u.y + w.z * u.z;
      if (along <= 0 || along > hitAt + reach) continue;
      // The reach is on the screen: it grows with how far the node stands.
      const scale = hitAt > 0 ? along / hitAt : 1;
      const distance = Math.hypot(w.x - u.x * along, w.y - u.y * along, w.z - u.z * along);
      if (distance > reach * scale) continue;
      if (best === undefined || distance < best.distance) best = { node, distance };
    }
    return best?.node;
  }
  for (const node of nodes) {
    const distance = Math.hypot(node.position.x - point.x, node.position.y - point.y, node.position.z - point.z);
    if (distance <= reach && (best === undefined || distance < best.distance)) best = { node, distance };
  }
  return best?.node;
}

/** The graph node `sample` is on: the one geometry finds, else the one a picked dot named. */
export const graphNodeOf = (sample: Pick<PointerSample, "node" | "nodeId">): string | undefined => sample.node?.id ?? sample.nodeId;
