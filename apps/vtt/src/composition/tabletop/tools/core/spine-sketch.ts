import type { ConstructionToolId, ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { AnchorSnap } from "./curve-edit-gesture.ts";
import { gestureMoved, type ConstructionTool, type PointerSample, type PointerSlop, type ToolContext, type ToolGesture } from "./tool-context.ts";

/**
 * Laying a new spine by gesture alone -- there is no mode to pick:
 *
 * - a click sets an origin, and the next click lays a straight span to it;
 *   that end becomes the next origin, until Enter, Esc, Backspace, or a
 *   click landing on another structure, where the run joins it and ends;
 * - a press dragged away draws a freehand stroke, laid on release.
 *
 * Either begins wherever the press lands. On another structure's body the
 * snap moves it onto that structure, so the new spine connects there: at an
 * end it runs on, inside it branches. The tool says how a span looks, how it
 * is laid and how a stroke is drawn; this module only keeps the gesture.
 */
export interface SpineSketchStroke<Id extends ConstructionToolId> {
  /** A press that may become a stroke, at `origin`. */
  begin(ctx: ToolContext, origin: PointerSample, params: ToolParamsFor<Id>): void;
  /** The stroke so far, once it is one ({@link isStroke}) -- its first sample is the origin. */
  move(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** Lays the finished stroke; false when nothing was laid. */
  finish(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): boolean;
  cancel(ctx: ToolContext): void;
}

export interface SpineSketchOptions<Id extends ConstructionToolId> {
  readonly id: Id;
  readonly defaultParams: () => ToolParamsFor<Id>;
  /** Where a press or a click lands on a standing structure. */
  readonly snap: AnchorSnap;
  /**
   * Shows the pending origin, and the straight span toward `to` when there is
   * a pointer to reach; answers where that span ends -- short of `to` when
   * the structure's own laws stop it there.
   */
  readonly showSpan: (ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition | undefined, params: ToolParamsFor<Id>) => ConstructionPosition | undefined;
  readonly clearSpan: (ctx: ToolContext) => void;
  /** Lays one straight span toward `to`, answering where it ends; `undefined` when it was refused, which keeps the origin. */
  readonly commitSpan: (ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition, params: ToolParamsFor<Id>) => ConstructionPosition | undefined;
  readonly stroke: SpineSketchStroke<Id>;
}

export interface SpineSketchTool<Id extends ConstructionToolId> extends ConstructionTool<Id> {
  /** Whether a straight run is waiting for its next click -- presses then belong to it, though a handle still edits and drops the run. */
  readonly drafting: (ctx: ToolContext) => boolean;
}

interface Press {
  readonly at: PointerSample;
  /** The standing structure it landed on, when it did. */
  readonly target?: PointerSample;
}

/** The wander a shaky click may have and stay a click: wider than a plain click's, since here a drag draws. */
const STROKE_SLOP: PointerSlop = { pixels: 5, world: 0.15 };

/** Whether the pointer has travelled far enough from the press to be drawing a stroke rather than clicking. */
export function isStroke(gesture: ToolGesture): boolean {
  return gestureMoved(gesture.start, gesture.samples, STROKE_SLOP) || gestureMoved(gesture.start, [gesture.current], STROKE_SLOP);
}

/** Whether two positions are the same place, to within rounding through the engine. */
export function samePlace(a: ConstructionPosition, b: ConstructionPosition): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
}

/** `gesture` begun at `origin` rather than where the pointer went down. */
function from(gesture: ToolGesture, origin: PointerSample): ToolGesture {
  return { ...gesture, start: origin, samples: [origin, ...gesture.samples.slice(1)] };
}

export function createSpineSketchTool<Id extends ConstructionToolId>(options: SpineSketchOptions<Id>): SpineSketchTool<Id> {
  const origins = new WeakMap<ToolContext["runtime"], PointerSample>();
  const presses = new WeakMap<ToolContext["runtime"], Press>();
  /** Where the last hover preview was drawn from and to, so a pointer that has not moved costs nothing. */
  const hovered = new WeakMap<ToolContext["runtime"], { readonly origin: PointerSample; readonly at: ConstructionPosition }>();
  const { snap, stroke } = options;

  function end(ctx: ToolContext): void {
    origins.delete(ctx.runtime);
    options.clearSpan(ctx);
    snap.show(ctx);
  }

  function land(ctx: ToolContext, sample: PointerSample): Press {
    const target = snap.find(ctx, sample);
    return target ? { at: target, target } : { at: sample };
  }

  function click(ctx: ToolContext, press: Press, params: ToolParamsFor<Id>): void {
    const origin = origins.get(ctx.runtime);
    if (!origin) {
      origins.set(ctx.runtime, press.at);
      options.showSpan(ctx, press.at.point, undefined, params);
      return;
    }
    if (samePlace(origin.point, press.at.point)) return;
    if (press.target && snap.isCurrent && !snap.isCurrent(ctx, press.target)) {
      snap.show(ctx);
      ctx.reportFeedback({ tone: "error", message: "O alvo de encaixe mudou. Aproxime o mouse novamente antes de confirmar." });
      return;
    }
    const reached = options.commitSpan(ctx, origin.point, press.at.point, params);
    if (!reached) {
      options.showSpan(ctx, origin.point, undefined, params);
      return;
    }
    // Joining a standing structure ends the run; open ground -- or a span
    // stopped short of what it was aimed at -- carries it on from its end.
    if (press.target && samePlace(reached, press.at.point)) { end(ctx); return; }
    const next = { ...press.at, point: reached };
    origins.set(ctx.runtime, next);
    snap.show(ctx);
    options.showSpan(ctx, reached, undefined, params);
  }

  return {
    id: options.id,
    defaultParams: options.defaultParams,
    previewOnHover: true,
    drafting: (ctx) => origins.has(ctx.runtime),
    previewFor(gesture, params, ctx) {
      const origin = origins.get(ctx.runtime);
      const last = hovered.get(ctx.runtime);
      if (origin && last?.origin === origin && samePlace(last.at, gesture.current.point)) return undefined;
      if (origin && !presses.has(ctx.runtime)) {
        hovered.set(ctx.runtime, { origin, at: gesture.current.point });
        const target = snap.find(ctx, gesture.current);
        const reached = options.showSpan(ctx, origin.point, (target ?? gesture.current).point, params);
        // A target the span cannot reach is not shown as joined.
        snap.show(ctx, target && reached && samePlace(reached, target.point) ? target : undefined);
      }
      return undefined;
    },
    onPointerDown(ctx, sample, params) {
      const press = land(ctx, sample);
      presses.set(ctx.runtime, press);
      stroke.begin(ctx, press.at, params);
    },
    onPointerMove(ctx, gesture, params) {
      const press = presses.get(ctx.runtime);
      if (!press || !isStroke(gesture)) return;
      // A drag is a stroke of its own: a straight run waiting for a click is dropped.
      if (origins.has(ctx.runtime)) { origins.delete(ctx.runtime); options.clearSpan(ctx); }
      stroke.move(ctx, from(gesture, press.at), params);
    },
    onPointerUp(ctx, gesture, params) {
      const press = presses.get(ctx.runtime);
      presses.delete(ctx.runtime);
      if (!press) return;
      if (isStroke(gesture)) { stroke.finish(ctx, from(gesture, press.at), params); return; }
      stroke.cancel(ctx);
      click(ctx, press, params);
    },
    onKeyDown(ctx, key) {
      if (!origins.has(ctx.runtime) || presses.has(ctx.runtime) || (key !== "Enter" && key !== "Backspace")) return false;
      end(ctx);
      return true;
    },
    onCancel(ctx) {
      presses.delete(ctx.runtime);
      stroke.cancel(ctx);
      end(ctx);
    },
  };
}
