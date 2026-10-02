import type { ConstructionNodeSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSessionPort } from "@/ports";

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
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const keyOf = (key: readonly string[]): string => key.join("\u0000");

/** What placing the handles on the run of walls an opening crosses needs from the engine. */
export type OpeningRunPort = Pick<ConstructionSessionPort, "panelRun" | "resolveOnHost">;

/** Where an opening's box puts a point: `fu` across it, left to right, `fv` up it, both from 0 to 1. */
interface OpeningBox {
  readonly at: (fu: number, fv: number) => ConstructionPosition;
  readonly standsOnFloor: boolean;
}

type PinnedNode = ConstructionNodeSnapshot & { readonly pin: NonNullable<ConstructionNodeSnapshot["pin"]> };

/**
 * The box of a group's pinned nodes in the frame the opening tool edits it
 * in: along the run of walls the first piece's wall belongs to -- `s`, its
 * arc length, in the run's own direction, so "left" is the side the tool
 * moves as its start -- and up it, in fractions of the local height. Every
 * piece counts, whatever wall it is on, so an opening crossing a seam has
 * its handles on its whole box, not on the part on one wall. `undefined`
 * when the wall is in no run.
 */
function boxOnRun(pinned: readonly PinnedNode[], runs: OpeningRunPort): OpeningBox | undefined {
  let run;
  try {
    run = runs.panelRun(pinned[0]!.pin.hostSurfaceKey);
  } catch {
    return undefined;
  }
  const panels = run.panels.filter((panel) => panel.length > 1e-9).sort((a, b) => a.offset - b.offset);
  if (panels.length === 0) return undefined;
  const byKey = new Map(panels.map((panel) => [keyOf(panel.surfaceKey), panel]));
  const points = pinned.flatMap((node) => {
    const panel = byKey.get(keyOf(node.pin.hostSurfaceKey));
    return panel === undefined ? [] : [{ s: panel.offset + (panel.reversed ? 1 - node.pin.u : node.pin.u) * panel.length, v: node.pin.v }];
  });
  if (points.length < 2) return undefined;
  const start = panels[0]!.offset;
  const period = Math.max(...panels.map((panel) => panel.offset + panel.length)) - start;
  let ss = points.map((point) => point.s).sort((a, b) => a - b);
  // Round a closed run, the box starts after the widest stretch it leaves free.
  if (run.closed) {
    let first = 0;
    let widest = ss[0]! + period - ss[ss.length - 1]!;
    for (let index = 1; index < ss.length; index += 1) {
      const gap = ss[index]! - ss[index - 1]!;
      if (gap > widest) { widest = gap; first = index; }
    }
    ss = [...ss.slice(first), ...ss.slice(0, first).map((s) => s + period)];
  }
  const s0 = ss[0]!, s1 = ss[ss.length - 1]!;
  const v0 = Math.min(...points.map((point) => point.v)), v1 = Math.max(...points.map((point) => point.v));
  if (s1 - s0 < MIN_SPAN || v1 - v0 < MIN_SPAN) return undefined;
  const wrap = (s: number) => (run.closed ? start + ((((s - start) % period) + period) % period) : s);
  return {
    standsOnFloor: v0 < FLOOR,
    at(fu, fv) {
      const s = wrap(lerp(s0, s1, fu));
      const panel = panels.find((candidate) => s <= candidate.offset + candidate.length) ?? panels[panels.length - 1]!;
      const t = (s - panel.offset) / panel.length;
      return runs.resolveOnHost({ hostSurfaceKey: panel.surfaceKey, uv: [[clamp01(panel.reversed ? 1 - t : t), lerp(v0, v1, fv)]] })[0]!;
    },
  };
}

/**
 * The box of a group's nodes pinned to its first piece's wall, by their own
 * positions: without the engine to place it on the run, the part of the
 * opening on that one wall.
 */
function boxOnFirstWall(nodes: readonly PinnedNode[]): OpeningBox | undefined {
  const host = keyOf(nodes[0]!.pin.hostSurfaceKey);
  const pinned = nodes.filter((node) => keyOf(node.pin.hostSurfaceKey) === host);
  if (pinned.length < 2) return undefined;
  const by = (axis: "u" | "v", pick: "min" | "max") => pinned.reduce((best, node) => ((pick === "min" ? node.pin[axis] < best.pin[axis] : node.pin[axis] > best.pin[axis]) ? node : best));
  const left = by("u", "min"), right = by("u", "max"), low = by("v", "min"), high = by("v", "max");
  if (right.pin.u - left.pin.u < MIN_SPAN || high.pin.v - low.pin.v < MIN_SPAN) return undefined;
  // Along the wall the nodes pin the way: a straight line between the ends; up it, the heights of the lowest and highest.
  return {
    standsOnFloor: low.pin.v < FLOOR,
    at: (fu, fv) => ({
      x: lerp(left.position.x, right.position.x, fu), z: lerp(left.position.z, right.position.z, fu),
      y: lerp(low.position.y, high.position.y, fv),
    }),
  };
}

/**
 * The handles of every opening group among `topologies` that `focus` holds a
 * piece of; none without a focus. With `runs`, they stand on the group's
 * whole box along the run of walls it crosses, as the opening tool reads it.
 */
export function openingHandles(
  topologies: readonly ConstructionRegionTopology[],
  focus: ReadonlySet<string> | undefined,
  isOpening: (surfaceType: string) => boolean,
  runs?: OpeningRunPort,
): readonly OpeningHandle[] {
  if (!focus) return [];
  const groups = new Map<string, ConstructionRegionTopology[]>();
  for (const topology of topologies) {
    if (!isOpening(topology.surfaceType)) continue;
    const group = topology.props?.group;
    const key = typeof group === "string" ? group : keyOf(topology.surfaceKey);
    groups.set(key, [...(groups.get(key) ?? []), topology]);
  }
  const handles: OpeningHandle[] = [];
  for (const pieces of groups.values()) {
    if (!pieces.some((piece) => focus.has(keyOf(piece.surfaceKey)))) continue;
    const pinned = pieces.flatMap((piece) => piece.nodes).filter((node): node is PinnedNode => node.pin !== undefined);
    if (pinned.length < 2) continue;
    const box = (runs === undefined ? undefined : boxOnRun(pinned, runs)) ?? boxOnFirstWall(pinned);
    if (box === undefined) continue;
    const { at, standsOnFloor } = box;
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
