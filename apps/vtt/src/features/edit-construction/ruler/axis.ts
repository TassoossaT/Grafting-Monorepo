/**
 * The ruler along one line: something with a start, a centre and an end
 * -- an opening along its wall, or up it -- lined up with what stands on the
 * same line. The plan ruler (`resolve.ts`) answers for a point on the ground;
 * this answers for a box laid out in a face's own frame, where "line up"
 * means an edge on an edge, a centre on a centre, or a centre in a gap.
 * Nothing here knows what the box or the line is.
 */

/** Which part of the box is the one a coordinate belongs to. */
export type AxisPart = "start" | "center" | "end";

/** What of the box may move to be lined up. `both` slides the whole box; `start`/`end` move that edge alone; `none` is held. */
export type AxisMoving = "both" | "start" | "end" | "none";

/** What a coordinate on the line can be lined up with. */
export interface AxisTarget {
  readonly value: number;
  /** An edge lines up with an edge, a centre with a centre. */
  readonly part: "edge" | "center";
  /** Where, in the caller's own frame, the target stands -- for drawing the guide to it. */
  readonly at?: { readonly s: number; readonly v: number };
}

export interface AxisCatch {
  /** How far the moving part goes to land on `target`. */
  readonly shift: number;
  readonly part: AxisPart;
  readonly target: AxisTarget;
}

/** The parts of a box at `start`..`end` that `moving` lets line up, by value. */
function partsOf(start: number, end: number, moving: AxisMoving): readonly { readonly part: AxisPart; readonly value: number }[] {
  switch (moving) {
    case "both": return [{ part: "start", value: start }, { part: "center", value: (start + end) / 2 }, { part: "end", value: end }];
    case "start": return [{ part: "start", value: start }];
    case "end": return [{ part: "end", value: end }];
    case "none": return [];
  }
}

/**
 * The nearest line-up within `reach` for a box from `start` to `end`: an edge
 * on a target edge, or its centre on a target centre. `undefined` when
 * nothing is near. Ties go to the edge: flush beats centred.
 */
export function catchOnAxis(start: number, end: number, moving: AxisMoving, targets: readonly AxisTarget[], reach: number): AxisCatch | undefined {
  let best: AxisCatch | undefined;
  for (const { part, value } of partsOf(start, end, moving)) {
    const kind = part === "center" ? "center" : "edge";
    for (const target of targets) {
      if (target.part !== kind) continue;
      const shift = target.value - value;
      if (Math.abs(shift) > reach) continue;
      const nearer = !best || Math.abs(shift) < Math.abs(best.shift) - 1e-9
        || (Math.abs(Math.abs(shift) - Math.abs(best.shift)) <= 1e-9 && kind === "edge" && best.target.part === "center");
      if (nearer) best = { shift, part, target };
    }
  }
  return best;
}

/** Every line-up that already holds, within `tolerance` -- what to draw as guides whether or not the snap was taken. */
export function holdsOnAxis(start: number, end: number, targets: readonly AxisTarget[], tolerance = 1e-6): readonly { readonly part: AxisPart; readonly target: AxisTarget }[] {
  const held: { part: AxisPart; target: AxisTarget }[] = [];
  for (const { part, value } of partsOf(start, end, "both")) {
    const kind = part === "center" ? "center" : "edge";
    for (const target of targets) if (target.part === kind && Math.abs(target.value - value) <= tolerance) held.push({ part, target });
  }
  return held;
}

/**
 * The middle of the free stretch the box `start`..`end` sits in, between what
 * stands on either side -- `bounds` are the edges of what stands (the line's
 * own ends included), as `[low, high]` pairs. A box centred there has the
 * same gap on both sides. `undefined` when it lies in no free stretch.
 */
export function gapCenter(start: number, end: number, bounds: readonly (readonly [number, number])[], limits: readonly [number, number]): number | undefined {
  const middle = (start + end) / 2;
  let low = limits[0], high = limits[1];
  for (const [from, to] of bounds) {
    if (to <= middle && to > low) low = to;
    if (from >= middle && from < high) high = from;
  }
  return high - low > end - start ? (low + high) / 2 : undefined;
}

/** The free room on each side of the box: how far to what stands, or to the line's end. */
export function gapsAround(start: number, end: number, bounds: readonly (readonly [number, number])[], limits: readonly [number, number]): { readonly before: number; readonly after: number } {
  let low = limits[0], high = limits[1];
  const middle = (start + end) / 2;
  for (const [from, to] of bounds) {
    if (to <= middle && to > low) low = to;
    if (from >= middle && from < high) high = from;
  }
  return { before: start - low, after: high - end };
}
