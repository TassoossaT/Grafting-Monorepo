import {
  LEVEL_REACH,
  RULER_REACH,
  catchOnAxis,
  gapCenter,
  gapsAround,
  hasTrait,
  holdsOnAxis,
  type AxisMoving,
  type AxisTarget,
  type RulerGuide,
  type RulerMeasure,
} from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { RulerFeedback } from "../core/ruler-session.ts";
import type { ToolContext } from "../core/tool-context.ts";
import { MARGIN, openingSpansOn, settleRect, type RunFrame, type RunRect } from "./opening-shared.ts";

/**
 * The ruler for an opening laid out on its wall. The wall is its own frame
 * -- how far along it, how high up -- so the plan ruler cannot see it; this
 * hands the opening's edges and centre to the ruler's axis resolver
 * (`features/edit-construction/ruler/axis.ts`) with what stands on the wall
 * and above the ground: the wall's ends and middle, the openings already
 * there, the room left between them, and the heights other openings -- on any
 * wall -- stand at. All it adds is the translation between frames.
 */

/** Which edges of a rect the gesture moves: only those line up; the rest are held. */
export interface Moving {
  readonly s: AxisMoving;
  readonly v: AxisMoving;
}

type Mid = { readonly s: number; readonly v: number };

const mid = (rect: RunRect): Mid => ({ s: (rect.s0 + rect.s1) / 2, v: (rect.v0 + rect.v1) / 2 });

/** Where along the wall, in its own coordinate, an opening can be lined up with. */
function alongTargets(run: RunFrame, rect: RunRect, spans: readonly RunRect[]): readonly AxisTarget[] {
  const targets: AxisTarget[] = [];
  const at = (s: number, v = 0.5) => ({ s, v });
  if (!run.closed) {
    // Flush with the wall's ends -- as near as the margin lets it -- and centred on the wall.
    targets.push({ value: run.start + MARGIN, part: "edge", at: at(run.start + MARGIN) }, { value: run.end - MARGIN, part: "edge", at: at(run.end - MARGIN) });
    targets.push({ value: (run.start + run.end) / 2, part: "center", at: at((run.start + run.end) / 2) });
  }
  for (const span of spans) {
    const m = mid(span);
    targets.push({ value: span.s0, part: "edge", at: { s: span.s0, v: m.v } }, { value: span.s1, part: "edge", at: { s: span.s1, v: m.v } }, { value: m.s, part: "center", at: m });
  }
  // Centred in the room left between what stands on either side: the same gap each way.
  if (!run.closed) {
    const centred = gapCenter(rect.s0, rect.s1, spans.map((span) => [span.s0, span.s1] as const), [run.start, run.end]);
    if (centred !== undefined) targets.push({ value: centred, part: "center", at: at(centred) });
  }
  return targets;
}

/** The heights, in the world, other openings stand at -- on this wall (where they can be pointed at) or any other. */
function upTargets(ctx: ToolContext, run: RunFrame, spans: readonly RunRect[], excluded: ReadonlySet<string>): readonly AxisTarget[] {
  const targets: AxisTarget[] = [];
  const yAt = (s: number, v: number) => run.resolveAt(s, v).y;
  for (const span of spans) {
    const m = mid(span);
    const low = yAt(m.s, span.v0), high = yAt(m.s, span.v1);
    targets.push({ value: low, part: "edge", at: { s: m.s, v: span.v0 } }, { value: high, part: "edge", at: { s: m.s, v: span.v1 } }, { value: (low + high) / 2, part: "center", at: m });
  }
  // Openings on other walls: the heights alone, with no place on this wall to draw to.
  for (const region of ctx.runtime.getAllRegionTopologies()) {
    if (!hasTrait(region.surfaceType, "cuts") || excluded.has(surfaceRefFromNodeSet(region.surfaceKey))) continue;
    if (region.nodes.some((node) => node.pin !== undefined && run.panelOf(node.pin.hostSurfaceKey) !== undefined)) continue;
    const ys = region.nodes.map((node) => node.position.y);
    if (ys.length === 0) continue;
    const low = Math.min(...ys), high = Math.max(...ys);
    targets.push({ value: low, part: "edge" }, { value: high, part: "edge" }, { value: (low + high) / 2, part: "center" });
  }
  return targets;
}

/**
 * `rect` slid, never resized, onto what it lines up with -- along the wall
 * and up it -- for the edges `moving` lets move: an edge flush with another,
 * a centre on a centre, or centred in the room between. A rect that nothing
 * is near is returned as it is. With the ruler's snap off it always is.
 */
export function alignRect(ctx: ToolContext, run: RunFrame, rect: RunRect, moving: Moving, excluded: ReadonlySet<string> = new Set()): RunRect {
  if (!ctx.rulerSnap) return rect;
  const spans = openingSpansOn(ctx, run, excluded);
  let { s0, s1, v0, v1 } = rect;
  const along = catchOnAxis(s0, s1, moving.s, alongTargets(run, rect, spans), RULER_REACH);
  if (along) {
    if (moving.s === "both") { s0 += along.shift; s1 += along.shift; }
    else if (moving.s === "start") s0 += along.shift;
    else if (moving.s === "end") s1 += along.shift;
  }
  const middle = (s0 + s1) / 2;
  const height = run.heightAt(Math.max(run.start, Math.min(run.end, middle)));
  if (!(height > 0)) return { s0, s1, v0, v1 };
  const up = catchOnAxis(run.resolveAt(middle, v0).y, run.resolveAt(middle, v1).y, moving.v, upTargets(ctx, run, spans, excluded), LEVEL_REACH);
  if (up) {
    const dv = up.shift / height;
    if (moving.v === "both") { v0 += dv; v1 += dv; }
    else if (moving.v === "start") v0 += dv;
    else if (moving.v === "end") v1 += dv;
  }
  return { s0, s1, v0, v1 };
}

/** `rect` aligned for the edges that move, then settled on the run -- the one fit a preview and its commit both read. */
export function settleAligned(ctx: ToolContext, run: RunFrame, rect: RunRect, isDoor: boolean, keepWidth: boolean, moving: Moving, excluded?: ReadonlySet<string>): RunRect | undefined {
  return settleRect(run, alignRect(ctx, run, rect, moving, excluded), isDoor, keepWidth);
}

/** What the ruler says of `rect` as it stands: the line-ups that hold, how big it is, and the room on either side of it. */
export function rectFeedback(ctx: ToolContext, run: RunFrame, rect: RunRect, excluded: ReadonlySet<string> = new Set()): RulerFeedback {
  const spans = openingSpansOn(ctx, run, excluded);
  const m = mid(rect);
  const guides: RulerGuide[] = [];
  const draw = (target: AxisTarget, mine: Mid): void => {
    if (target.at === undefined) return;
    guides.push({ kind: "align", from: run.resolveAt(target.at.s, target.at.v), to: run.resolveAt(mine.s, mine.v), node: "opening" });
  };
  for (const { part, target } of holdsOnAxis(rect.s0, rect.s1, alongTargets(run, rect, spans))) {
    draw(target, { s: part === "start" ? rect.s0 : part === "end" ? rect.s1 : m.s, v: m.v });
  }
  const yOf = (v: number) => run.resolveAt(m.s, v).y;
  for (const { part, target } of holdsOnAxis(yOf(rect.v0), yOf(rect.v1), upTargets(ctx, run, spans, excluded))) {
    const v = part === "start" ? rect.v0 : part === "end" ? rect.v1 : m.v;
    if (target.at !== undefined) draw(target, { s: m.s, v });
    else guides.push({ kind: "level", y: target.value, at: run.resolveAt(m.s, v) });
  }

  const wall = run.heightAt(m.s);
  const sill = rect.v0 * wall;
  const measures: RulerMeasure[] = [
    { kind: "size", name: "largura", meters: rect.s1 - rect.s0 },
    { kind: "size", name: "altura", meters: (rect.v1 - rect.v0) * wall },
    ...(sill > 1e-4 ? [{ kind: "size" as const, name: "peitoril", meters: sill }] : []),
  ];
  if (!run.closed) {
    const room = gapsAround(rect.s0, rect.s1, spans.map((span) => [span.s0, span.s1] as const), [run.start, run.end]);
    measures.push({ kind: "size", name: "à esquerda", meters: room.before }, { kind: "size", name: "à direita", meters: room.after });
  }
  return { guides, measures };
}
