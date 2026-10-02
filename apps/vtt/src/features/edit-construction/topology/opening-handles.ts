import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

/**
 * The handles of an opening laid on a wall, the only way it is edited: one in
 * its middle, which moves it whole; one on each corner, which resizes it in
 * width and height at once, keeping its shape; and one on the middle of each
 * side, which moves that side alone. Read off the nodes the opening's pieces
 * are pinned with, on the wall they are pinned to: where along it, and how
 * high -- never off what shape the opening is. A door stands on the floor, so
 * its bottom has none.
 */

export type OpeningHandlePart = "center" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface OpeningHandle {
  readonly id: string;
  readonly part: OpeningHandlePart;
  /** The middle moves the whole opening; a corner moves two sides at once; a side, one. */
  readonly kind: "pivot" | "corner" | "side";
  readonly position: ConstructionPosition;
  /** The node the handle is named after -- one of the opening's own -- by which the opening is found again. */
  readonly nodeId: string;
}

const PREFIX = "opening-handle:";
const PARTS: readonly OpeningHandlePart[] = ["center", "left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"];

export const openingHandleId = (part: OpeningHandlePart, nodeId: string): string => `${PREFIX}${part}:${nodeId}`;

/** Which opening handle `id` names, and after which node; `undefined` for any other id. */
export function openingHandlePick(id: string): { readonly part: OpeningHandlePart; readonly nodeId: string } | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  const rest = id.slice(PREFIX.length);
  const part = PARTS.find((candidate) => rest.startsWith(`${candidate}:`));
  return part && { part, nodeId: rest.slice(part.length + 1) };
}

/** A door stands on the floor: its sill is at the very foot of the wall. */
const FLOOR = 1e-6;
/** An opening narrower or lower than this, in the wall's own fractions, has nothing to hold. */
const MIN_SPAN = 1e-6;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The handles of every opening group among `topologies` that `focus` holds a piece of; none without a focus. */
export function openingHandles(
  topologies: readonly ConstructionRegionTopology[],
  focus: ReadonlySet<string> | undefined,
  isOpening: (surfaceType: string) => boolean,
): readonly OpeningHandle[] {
  if (!focus) return [];
  const groups = new Map<string, ConstructionRegionTopology[]>();
  for (const topology of topologies) {
    if (!isOpening(topology.surfaceType)) continue;
    const group = topology.props?.group;
    const key = typeof group === "string" ? group : topology.surfaceKey.join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), topology]);
  }
  const handles: OpeningHandle[] = [];
  for (const pieces of groups.values()) {
    if (!pieces.some((piece) => focus.has(piece.surfaceKey.join("\u0000")))) continue;
    const nodes = pieces.flatMap((piece) => piece.nodes).filter((node) => node.pin !== undefined);
    const host = nodes[0]?.pin?.hostSurfaceKey.join("\u0000");
    const pinned = nodes.filter((node) => node.pin!.hostSurfaceKey.join("\u0000") === host);
    if (pinned.length < 2) continue;
    const by = (axis: "u" | "v", pick: "min" | "max") => pinned.reduce((best, node) => ((pick === "min" ? node.pin![axis] < best.pin![axis] : node.pin![axis] > best.pin![axis]) ? node : best));
    const left = by("u", "min"), right = by("u", "max"), low = by("v", "min"), high = by("v", "max");
    const u0 = left.pin!.u, u1 = right.pin!.u, v0 = low.pin!.v, v1 = high.pin!.v;
    if (u1 - u0 < MIN_SPAN || v1 - v0 < MIN_SPAN) continue;
    const standsOnFloor = v0 < FLOOR;
    // Along the wall the nodes pin the way: a straight line between the ends; up it, the heights of the lowest and highest.
    const at = (fu: number, fv: number): ConstructionPosition => ({
      x: lerp(left.position.x, right.position.x, fu), z: lerp(left.position.z, right.position.z, fu),
      y: lerp(low.position.y, high.position.y, fv),
    });
    const name = pinned[0]!.id;
    const place = (part: OpeningHandlePart, kind: OpeningHandle["kind"], fu: number, fv: number): void => {
      handles.push({ id: openingHandleId(part, name), part, kind, position: at(fu, fv), nodeId: name });
    };
    place("center", "pivot", 0.5, 0.5);
    place("left", "side", 0, 0.5);
    place("right", "side", 1, 0.5);
    place("top", "side", 0.5, 1);
    place("top-left", "corner", 0, 1);
    place("top-right", "corner", 1, 1);
    if (!standsOnFloor) {
      place("bottom", "side", 0.5, 0);
      place("bottom-left", "corner", 0, 0);
      place("bottom-right", "corner", 1, 0);
    }
  }
  return handles;
}
