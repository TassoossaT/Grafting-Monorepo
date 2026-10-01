import {
  HOLD_FACTOR,
  LEVEL_REACH,
  ROUND_REACH_PIXELS,
  RULER_REACH,
  SNAP_REACH,
  baseHeight,
  catchOnAxis,
  collectLinks,
  dimensionsOf,
  editMeasureOf,
  gapCenter,
  gapsAround,
  holdsOnAxis,
  isGroundType,
  measuresOfEdit,
  resolveLevel,
  roundReach,
  roundWithin,
  snapToOutlines,
  snapTurn,
  type AxisCatch,
  type AxisMoving,
  type AxisPart,
  type AxisTarget,
  type EditMeasureKind,
  type EditMeasureName,
  type HandleMotion,
  type LinkPoint,
  type LinkRun,
  type OutlineSnap,
  type RulerGuide,
  type RulerLinks,
  type RulerMeasure,
  type SnapAnchor,
} from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { reachFor, ruleLineFor, rulePointFor, type RulePointOptions } from "./ruler-session.ts";
import type { ToolContext } from "./tool-context.ts";

export { NO_FEEDBACK, type RulerFeedback } from "./ruler-session.ts";
export type { AxisCatch, AxisMoving, AxisPart, AxisTarget, EditMeasureKind, EditMeasureName, OutlineSnap, RulerGuide, RulerLinks, RulerMeasure, SnapAnchor };

/**
 * THE ruler, as a tool sees it: the one door to everything that joins,
 * lines up, rounds or measures. A tool, a handle, a drag of any kind asks
 * here and never reaches for a resolver of its own -- so what catches, how
 * far, what is shown and what is left out are one answer for all of them.
 * (`ruler-centralized.test.mjs` holds this: nothing outside the ruler's own
 * modules may import what resolves.)
 *
 * It reads the table's choices -- whether the snap is on, how many metres a
 * pixel is, what is left out, the round number -- from the context it is
 * made of, so no caller carries any of them.
 */

/** How many pixels of the screen a catch reaches, by what is being caught. */
const PLAN_PIXELS = 14;
const LEVEL_PIXELS = 10;

export interface Ruler {
  /** Whether what the ruler catches is taken (Ctrl held places freely). */
  readonly snap: boolean;
  /** The round number, in metres, a length or a height lands on; none when the table chose none. */
  readonly step: number | undefined;
  /** `pixels` of the screen as metres; `fallback` when the scale is not known. For a reach that is not a catch -- how near a side a shape is built beside -- but should feel the same at every zoom. */
  reach(pixels: number, fallback: number): number;

  /** Everything that stands and can be lined up with or snapped onto, but the faces named (by their keys): what is being edited never links to itself. */
  linksWithout(skip: ReadonlySet<string>): RulerLinks;

  /** `value` landed on a multiple of the table's round number when near one; as it is otherwise or with the snap off. */
  round(value: number): number;
  /** The reach a catch already held keeps: wider than the one that took it, so it does not flicker at the edge. */
  held(reach: number): number;

  /** A point a tool lays out itself, on the ground: where it lands ruled. */
  point(point: ConstructionPosition, options?: Pick<RulePointOptions, "origin" | "axes">): ConstructionPosition;

  /** Anchors dragged by `delta` along `motion`, ruled onto `links`: where they land and what they caught; `undefined` when nothing is near. */
  drag(anchors: readonly SnapAnchor[], delta: ConstructionPosition, motion: HandleMotion, links: RulerLinks): OutlineSnap | undefined;

  /**
   * A handle lifted: its drawn position `dragged`, while the structure stands
   * at `standing` on a `base` it rises from. Lands the structure's height on a
   * level that stands, else on a round number above its base -- and says where
   * the handle must then be drawn.
   */
  lift(request: { readonly dragged: ConstructionPosition; readonly standing: number; readonly base: number; readonly links?: RulerLinks; readonly rounds: boolean }): { readonly y: number; readonly guides: readonly RulerGuide[] };

  /**
   * A turn of `angle` radians, `radius` out from what it turns about, landed on
   * a step of the protractor when near one -- the table's angle step, or the
   * finer one while Shift is held. The same reach as every other catch.
   */
  turn(angle: number, radius: number): { readonly angle: number; readonly turns: number | undefined };

  /** The measurement a handle declares it makes (`HANDLE_MEASUREMENT`), with what it needs. */
  named(name: EditMeasureName, using: { readonly direction: { readonly x: number; readonly z: number }; readonly base: number; readonly angle: number }): EditMeasureKind;
  /** What an edit that moved something from `from` to `at` measures. */
  measure(what: EditMeasureKind, from: ConstructionPosition, at: ConstructionPosition): readonly RulerMeasure[];
  /** The height a structure rises from: the lowest of `heights`. */
  base(heights: Iterable<number>, fallback: number): number;
  /** How big the structure `faces` make is. */
  dimensions(faces: readonly ConstructionRegionTopology[]): readonly RulerMeasure[];

  /**
   * A vertex moved to `at`, read against the sides it edits: ruled from each
   * of their fixed far ends -- `fixed` -- to where it now stands, its angles
   * parallel and square to the structure's other sides (`own`) and to what
   * stands (`links`), its lengths on the round number. Where it lands, what
   * caught, and the length of every side with the angle of the one that caught.
   * Never read from where the vertex began: that place is gone.
   */
  edge(request: { readonly at: ConstructionPosition; readonly fixed: readonly LinkPoint[]; readonly own: readonly LinkRun[]; readonly links: RulerLinks; /** False when something already joined the vertex: it stays where it is and the sides are only measured. */ readonly rule?: boolean }): { readonly position: ConstructionPosition; readonly caught: boolean; readonly guides: readonly RulerGuide[]; readonly measures: readonly RulerMeasure[] };
  /** How steeply the run to each of `fixed` climbs, to a top now at `at`. */
  grades(at: ConstructionPosition, fixed: readonly LinkPoint[]): readonly RulerMeasure[];

  /** A box on a line of its own -- an opening along its wall, or up it: the line-ups along that line. */
  axis: {
    /** The nearest line-up for the box `start`..`end`; `along` is the way a box slides, `up` the way it rises. */
    catch(start: number, end: number, moving: AxisMoving, targets: readonly AxisTarget[], way: "along" | "up"): AxisCatch | undefined;
    /** The line-ups that already hold. */
    holds(start: number, end: number, targets: readonly AxisTarget[]): readonly { readonly part: AxisPart; readonly target: AxisTarget }[];
    /** The middle of the room the box sits in, between what stands. */
    center(start: number, end: number, bounds: readonly (readonly [number, number])[], limits: readonly [number, number]): number | undefined;
    /** The room on either side of the box. */
    gaps(start: number, end: number, bounds: readonly (readonly [number, number])[], limits: readonly [number, number]): { readonly before: number; readonly after: number };
  };

  /** The one place a ruler is shown; `undefined` takes it down. */
  show(feedback: { readonly guides: readonly RulerGuide[]; readonly measures: readonly RulerMeasure[] } | undefined): void;
}

/** The ruler of `ctx`: made of what the context says -- stateless, so cheap to ask for wherever it is needed. */
export function rulerOf(ctx: ToolContext): Ruler {
  const snap = ctx.rulerSnap;
  const disabled = ctx.rulerDisabled;
  /** How near a round number a value must come to land on it: stronger than a join's reach, never beyond a share of the step. */
  const roundReachOf = (step: number): number => roundReach(step, reachFor(ctx, ROUND_REACH_PIXELS, 0.34));
  const reachOf = (way: "along" | "up"): number => (way === "along" ? reachFor(ctx, PLAN_PIXELS, RULER_REACH) : reachFor(ctx, LEVEL_PIXELS, LEVEL_REACH));
  return {
    snap,
    step: ctx.rulerLengthStep,
    reach: (pixels, fallback) => reachFor(ctx, pixels, fallback),
    round: (value) => {
      const step = ctx.rulerLengthStep;
      return snap && step !== undefined ? roundWithin(value, step, roundReachOf(step)) ?? value : value;
    },
    held: (reach) => reach * HOLD_FACTOR,

    linksWithout: (skip) => collectLinks(ctx.runtime.getAllRegionTopologies(), { skip, isGround: isGroundType }),

    point: (point, options) => rulePointFor(ctx, point, options),

    drag: (anchors, delta, motion, links) => snapToOutlines(anchors, delta, motion, links, { snap, reach: reachFor(ctx, PLAN_PIXELS, SNAP_REACH), ...(disabled ? { disabled } : {}) }),

    lift({ dragged, standing, base, links, rounds }) {
      const reach = reachOf("up");
      // A level that stands first: the structure's height, not where its handle is drawn, is what lands on it.
      const level = links && resolveLevel(standing, links, dragged, { snap, reach, ...(disabled ? { disabled } : {}) });
      if (level?.guide) return { y: snap ? dragged.y + (level.y - standing) : dragged.y, guides: [level.guide] };
      // Else a round number above where it rises from.
      const step = ctx.rulerLengthStep;
      const rounded = rounds && snap && step !== undefined ? roundWithin(standing - base, step, roundReachOf(step)) : undefined;
      if (rounded === undefined) return { y: dragged.y, guides: [] };
      const y = dragged.y + (base + rounded - standing);
      return { y, guides: [{ kind: "step", at: { ...dragged, y }, meters: rounded }] };
    },

    turn(angle, radius) {
      const step = ctx.rulerAngleStep;
      const caught = snap && step !== undefined ? snapTurn(angle, step, reachFor(ctx, PLAN_PIXELS, RULER_REACH), radius) : undefined;
      return caught ? { angle: caught.angle, turns: caught.turns } : { angle, turns: undefined };
    },

    named: (name, using) => editMeasureOf(name, using),
    edge({ at, fixed, own, links, rule = true }) {
      const merged: RulerLinks = { ...links, runs: [...links.runs, ...own] };
      const ruled = fixed.map((neighbour) => ({ neighbour, result: ruleLineFor(ctx, at, { origin: neighbour.position, links: merged, skip: new Set([neighbour.id]) }) }));
      // The side that catches nearest is the one the vertex is taken to; none caught leaves it where it is.
      const correction = (position: ConstructionPosition): number => Math.hypot(position.x - at.x, position.z - at.z);
      const chosen = ruled.filter(({ result }) => result.caught !== undefined).sort((a, b) => correction(a.result.position) - correction(b.result.position))[0] ?? ruled[0];
      const position = rule && chosen && chosen.result.caught !== undefined && snap ? chosen.result.position : at;
      const lengths: RulerMeasure[] = fixed.map((neighbour) => ({ kind: "length", from: neighbour.position, to: position, meters: Math.hypot(position.x - neighbour.position.x, position.z - neighbour.position.z) }));
      const angles = chosen ? chosen.result.measures.filter((measure) => measure.kind === "angle") : [];
      return { position, caught: chosen?.result.caught !== undefined, guides: chosen?.result.guides ?? [], measures: [...lengths, ...angles] };
    },
    grades: (at, fixed) => fixed.flatMap((neighbour) => {
      const run = Math.hypot(at.x - neighbour.position.x, at.z - neighbour.position.z);
      return run > 1e-6 ? [{ kind: "grade" as const, rise: at.y - neighbour.position.y, run }] : [];
    }),
    measure: (what, from, at) => measuresOfEdit(what, from, at),
    base: (heights, fallback) => baseHeight(heights, fallback),
    dimensions: (faces) => dimensionsOf(faces),

    axis: {
      catch: (start, end, moving, targets, way) => catchOnAxis(start, end, moving, targets, reachOf(way)),
      holds: (start, end, targets) => holdsOnAxis(start, end, targets),
      center: (start, end, bounds, limits) => gapCenter(start, end, bounds, limits),
      gaps: (start, end, bounds, limits) => gapsAround(start, end, bounds, limits),
    },

    show: (feedback) => ctx.showRuler?.(feedback),
  };
}
