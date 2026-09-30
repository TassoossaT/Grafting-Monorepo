import type { ConstructionToolId, ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { AnchorSnap } from "./curve-edit-gesture.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

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
  /** Shows the pending origin, and the straight span to `to` when there is a pointer to reach. */
  readonly showSpan: (ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition | undefined, params: ToolParamsFor<Id>) => void;
  readonly clearSpan: (ctx: ToolContext) => void;
  /** Lays one straight span; false when it was refused, which keeps the origin. */
  readonly commitSpan: (ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition, params: ToolParamsFor<Id>) => boolean;
  readonly stroke: SpineSketchStroke<Id>;
}

export interface SpineSketchTool<Id extends ConstructionToolId> extends ConstructionTool<Id> {
  /** Whether a straight run is waiting for its next click -- presses then belong to it, even on a handle. */
  readonly drafting: (ctx: ToolContext) => boolean;
}

interface Press {
  readonly at: PointerSample;
  /** The standing structure it landed on, when it did. */
  readonly target?: PointerSample;
}

/**
 * Whether the pointer has travelled far enough from the press to be drawing
 * a stroke rather than clicking -- the tolerance that keeps a shaky click a
 * click: 5 px on screen, or 0.15 m in the world when there is no screen.
 */
export function isStroke(gesture: ToolGesture): boolean {
  const { start } = gesture;
  return [...gesture.samples, gesture.current].some((sample) =>
    sample.screenX !== undefined && sample.screenY !== undefined && start.screenX !== undefined && start.screenY !== undefined
      ? Math.hypot(sample.screenX - start.screenX, sample.screenY - start.screenY) >= 5
      : Math.hypot(sample.point.x - start.point.x, sample.point.z - start.point.z) >= 0.15);
}

const samePlace = (a: ConstructionPosition, b: ConstructionPosition) => a.x === b.x && a.y === b.y && a.z === b.z;

/** `gesture` begun at `origin` rather than where the pointer went down. */
function from(gesture: ToolGesture, origin: PointerSample): ToolGesture {
  return { ...gesture, start: origin, samples: [origin, ...gesture.samples.slice(1)] };
}

export function createSpineSketchTool<Id extends ConstructionToolId>(options: SpineSketchOptions<Id>): SpineSketchTool<Id> {
  const origins = new WeakMap<ToolContext["runtime"], PointerSample>();
  const presses = new WeakMap<ToolContext["runtime"], Press>();
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
    if (!options.commitSpan(ctx, origin.point, press.at.point, params)) {
      options.showSpan(ctx, origin.point, undefined, params);
      return;
    }
    // Joining a standing structure ends the run; open ground carries it on.
    if (press.target) { end(ctx); return; }
    origins.set(ctx.runtime, press.at);
    snap.show(ctx);
    options.showSpan(ctx, press.at.point, undefined, params);
  }

  return {
    id: options.id,
    defaultParams: options.defaultParams,
    previewOnHover: true,
    drafting: (ctx) => origins.has(ctx.runtime),
    previewFor(gesture, params, ctx) {
      const origin = origins.get(ctx.runtime);
      if (origin && !presses.has(ctx.runtime)) {
        const target = snap.find(ctx, gesture.current);
        snap.show(ctx, target);
        options.showSpan(ctx, origin.point, (target ?? gesture.current).point, params);
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
