import type { ConstructionToolId, PreviewDescriptor, ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier, CurveHandles } from "../../../../ports/index.ts";
import { graphNodeOf } from "./node-identity.ts";
import { gestureMoved, type ConstructionTool, type PointerSample, type PointerSlop, type ToolContext, type ToolGesture } from "./tool-context.ts";

/**
 * Drawing a new spine -- the one gesture every spine-built tool shares,
 * whatever it builds: clicks lay ends down until the mode has what it
 * needs, the next click finishes it; a press dragged away draws a stroke,
 * for a tool that draws them; Backspace takes the last end back, Enter
 * finishes or ends a run, Esc drops it all, R moves on to the next mode.
 *
 * What differs from tool to tool is configuration, never a second copy of
 * the gesture:
 *
 * - its **modes** ({@link SpineDraftMode}): how ends become spans -- a
 *   straight span, an arc, a run through points, a spiral...;
 * - how the mode is **chosen**: one fixed, from the params, cycled with R;
 * - where an **end lands** and at what height -- on a floor's edge, on
 *   another road -- and what the preview shows;
 * - what **finishing** commits, and whether its end **carries the run on**.
 *
 * The geometry is the engine's; this module only keeps the gesture's state.
 */

/** A laid-down end: where it stands, the click that put it there, and what it landed on. */
export interface DraftEnd {
  readonly point: ConstructionPosition;
  readonly sample: PointerSample;
  /** Plan direction it leaves square to the edge it landed on -- a floor's -- pointing off it. */
  readonly out?: { readonly x: number; readonly z: number };
  /** Whether it runs on from another structure's end: `out` is then the way on, never turned back. */
  readonly joint?: boolean;
  /** The standing structure it snapped onto, as found when it was placed. */
  readonly target?: PointerSample;
}

/** A finished draft: laid-out spans, or the points a smooth run passes through. Ends carry their heights. */
export type FinishedSpineDraft =
  | { readonly kind: "spans"; readonly spans: readonly { readonly curve: CubicBezier; readonly handles: CurveHandles }[]; readonly joins?: PointerSample }
  | { readonly kind: "points"; readonly points: readonly ConstructionPosition[]; readonly joins?: PointerSample };

/** One draft under way: its mode, its ends, the tool's own state for it, and the mode's. */
export interface SpineDraft<S> {
  readonly mode: string;
  readonly ends: DraftEnd[];
  readonly tool: S;
  modeState?: unknown;
}

/** What a mode and a tool's hooks are handed: the draft, and the tool's own answers about ends and heights. */
export interface DraftKit<Id extends ConstructionToolId, S> {
  readonly ctx: ToolContext;
  readonly draft: SpineDraft<S>;
  readonly params: ToolParamsFor<Id>;
  readonly mode: SpineDraftMode<Id, S>;
  /** Where a click at `sample` lands at `height`, coming from `from`. */
  endAt(sample: PointerSample, height: number, from?: ConstructionPosition): DraftEnd;
  /** The height an end clicked at `sample` takes when it is an end the structure climbs to. */
  endHeight(sample: PointerSample): number;
  /** The height the draft started at. */
  startHeight(): number;
}

/** One way of laying a spine out from clicks. */
export interface SpineDraftMode<Id extends ConstructionToolId, S> {
  /** How it is named to the person drawing. */
  readonly label: string;
  /** What each click asks for, in order -- the last repeats; absent, nothing is said. */
  readonly hints?: readonly string[];
  /** How many ends it takes before the next click finishes it; `Infinity` finishes on demand. */
  readonly needs: number;
  /** The height a click past the first lands at; the start's, absent. */
  readonly clickHeight?: (kit: DraftKit<Id, S>, sample: PointerSample) => number;
  /** A click this mode places its own way -- `null` ignores it, `undefined` leaves it to the tool's landing. */
  readonly place?: (kit: DraftKit<Id, S>, sample: PointerSample) => DraftEnd | null | undefined;
  /** Follows the pointer between clicks -- what a spiral counts its turns by. */
  readonly hover?: (kit: DraftKit<Id, S>, cursor: PointerSample) => void;
  /** Runs just before a click finishes the draft. */
  readonly beforeFinish?: (kit: DraftKit<Id, S>, sample: PointerSample) => void;
  /** What finishing now would build, with `cursor` as the last click; `undefined` when it would build nothing. */
  readonly plan: (kit: DraftKit<Id, S>, cursor: PointerSample) => FinishedSpineDraft | undefined;
  /** What to preview before the plan can say -- curves, or `undefined` to preview the plan. */
  readonly sketch?: (kit: DraftKit<Id, S>, cursor: PointerSample) => readonly CubicBezier[] | undefined;
  /** What the mode adds to a readout of the draft; `undefined` when there is nothing to read out yet. */
  readonly readout?: (kit: DraftKit<Id, S>) => readonly string[] | undefined;
  /** What, beyond the pointer and the ends, changes the preview -- so an unchanged one is not redrawn. */
  readonly key?: (kit: DraftKit<Id, S>) => string;
}

/** A tool's own answer for where a draft is and what it would build. */
export interface SpineDraftStroke<Id extends ConstructionToolId> {
  begin(ctx: ToolContext, origin: PointerSample, params: ToolParamsFor<Id>): void;
  /** The stroke so far, once it is one ({@link isStroke}) -- its first sample is the origin. */
  move(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** Lays the finished stroke; false when nothing was laid. */
  finish(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): boolean;
  cancel(ctx: ToolContext): void;
}

export interface SpineDraftOptions<Id extends ConstructionToolId, S> {
  readonly id: Id;
  readonly defaultParams: () => ToolParamsFor<Id>;
  readonly modes: Readonly<Record<string, SpineDraftMode<Id, S>>>;
  /** The mode a click draws in now. */
  readonly modeOf: (params: ToolParamsFor<Id>) => string;
  /** The modes R steps through, and how the tool stores the next; absent, R does nothing. */
  readonly cycle?: { readonly modes: readonly string[]; readonly withMode: (params: ToolParamsFor<Id>, mode: string) => ToolParamsFor<Id> };
  /** The tool's own state for a new draft -- what it reads of the table. */
  readonly begin: (ctx: ToolContext) => S;
  /** Rereads the table before each click; absent, the state stays as begun. */
  readonly refresh?: (ctx: ToolContext, state: S) => void;
  /** Where a click lands, at `height`, coming from `from`. */
  readonly endAt: (ctx: ToolContext, state: S, sample: PointerSample, height: number, from?: ConstructionPosition) => DraftEnd;
  /** The height an end the structure climbs to takes; the start's, absent. */
  readonly endHeight?: (kit: Omit<DraftKit<Id, S>, "endHeight">, sample: PointerSample) => number;
  /** Whether an end placed on a press still stands as found when the click lands; absent, always. */
  readonly holds?: (ctx: ToolContext, end: DraftEnd) => boolean;
  /** The preview between clicks, once a draft has an end. */
  readonly preview: (kit: DraftKit<Id, S>, cursor: PointerSample) => PreviewDescriptor | undefined;
  /** The preview before the first click; absent, none. */
  readonly idle?: (ctx: ToolContext, cursor: PointerSample, params: ToolParamsFor<Id>) => PreviewDescriptor | undefined;
  /** Clears whatever the tool shows on its own channels when a draft ends. */
  readonly cleared?: (ctx: ToolContext) => void;
  /** Shows a draft just placed an end, on the tool's own channels; absent, the next hover does. */
  readonly shown?: (kit: DraftKit<Id, S>) => void;
  /**
   * Commits a finished draft and answers where it ended and whether it
   * joined what it was aimed at; `undefined` when nothing was laid.
   */
  readonly commit: (ctx: ToolContext, finished: FinishedSpineDraft, params: ToolParamsFor<Id>) => { readonly end: ConstructionPosition; readonly joined: boolean } | undefined;
  /** Whether a finished span's end begins the next, until Enter or a join -- a road run on click by click. */
  readonly chain?: boolean;
  /** Said when a click would finish a draft that builds nothing; absent, the click is ignored. */
  readonly tooShort?: string;
  /** What a press dragged away draws; absent, the tool only clicks. */
  readonly stroke?: SpineDraftStroke<Id>;
}

export interface SpineDraftTool<Id extends ConstructionToolId> extends ConstructionTool<Id> {
  /** Whether a draft is under way -- presses then belong to drawing, though a handle still edits and drops it. */
  readonly drafting: (ctx: ToolContext) => boolean;
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

const planDistance = (a: ConstructionPosition, b: ConstructionPosition) => Math.hypot(a.x - b.x, a.z - b.z);

/** `gesture` begun at `origin` rather than where the pointer went down. */
function from(gesture: ToolGesture, origin: PointerSample): ToolGesture {
  return { ...gesture, start: origin, samples: [origin, ...gesture.samples.slice(1)] };
}

export function createSpineDraftTool<Id extends ConstructionToolId, S>(options: SpineDraftOptions<Id, S>): SpineDraftTool<Id> {
  const drafts = new WeakMap<ToolContext["runtime"], SpineDraft<S>>();
  /** A press that may become a stroke, and the end it landed as. */
  const presses = new WeakMap<ToolContext["runtime"], DraftEnd>();

  function draftOf(ctx: ToolContext, params: ToolParamsFor<Id>): SpineDraft<S> {
    const mode = options.modeOf(params);
    let draft = drafts.get(ctx.runtime);
    if (!draft || draft.mode !== mode) {
      draft = { mode, ends: [], tool: options.begin(ctx) };
      drafts.set(ctx.runtime, draft);
    }
    return draft;
  }

  function clear(ctx: ToolContext): void {
    drafts.delete(ctx.runtime);
    options.cleared?.(ctx);
  }

  function kitOf(ctx: ToolContext, draft: SpineDraft<S>, params: ToolParamsFor<Id>): DraftKit<Id, S> {
    const mode = options.modes[draft.mode]!;
    const base = {
      ctx, draft, params, mode,
      endAt: (sample: PointerSample, height: number, start?: ConstructionPosition) => options.endAt(ctx, draft.tool, sample, height, start),
      startHeight: () => draft.ends[0]?.point.y ?? 0,
    };
    return { ...base, endHeight: (sample) => options.endHeight?.(base, sample) ?? base.startHeight() };
  }

  function hint(kit: DraftKit<Id, S>): void {
    const list = kit.mode.hints;
    if (list?.length) kit.ctx.reportFeedback({ tone: "info", message: list[Math.min(kit.draft.ends.length, list.length - 1)]! });
  }

  function finish(kit: DraftKit<Id, S>, sample: PointerSample): void {
    const { ctx, params } = kit;
    const finished = kit.mode.plan(kit, sample);
    if (!finished) {
      // A run waiting for its next end keeps waiting; a draft is over.
      if (options.chain) return;
      clear(ctx);
      if (options.tooShort) ctx.reportFeedback({ tone: "error", message: options.tooShort });
      return;
    }
    if (!options.chain) clear(ctx);
    const laid = options.commit(ctx, finished, params);
    if (!options.chain || !laid) return;
    // Joining a standing structure ends the run; open ground -- or a span
    // stopped short of what it was aimed at -- carries it on from its end.
    if (laid.joined) { clear(ctx); return; }
    const next: SpineDraft<S> = { mode: kit.draft.mode, ends: [{ point: laid.end, sample: { ...sample, point: laid.end } }], tool: kit.draft.tool };
    drafts.set(ctx.runtime, next);
    options.shown?.(kitOf(ctx, next, params));
  }

  /** A click, landed as `pressed` when a press already placed it. */
  function click(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>, pressed?: DraftEnd): void {
    const draft = draftOf(ctx, params);
    options.refresh?.(ctx, draft.tool);
    const kit = kitOf(ctx, draft, params);
    const { mode } = kit;
    try {
      const last = draft.ends.at(-1);
      // On demand: the last end clicked again finishes it.
      if (mode.needs === Infinity && last && draft.ends.length >= 2 && planDistance(sample.point, last.point) < 0.25) {
        finish(kitOf(ctx, { ...draft, ends: draft.ends.slice(0, -1) }, params), last.sample);
        return;
      }
      if (draft.ends.length >= mode.needs) {
        if (pressed && options.holds && !options.holds(ctx, pressed)) {
          ctx.reportFeedback({ tone: "error", message: "O alvo de encaixe mudou. Aproxime o mouse novamente antes de confirmar." });
          options.cleared?.(ctx);
          return;
        }
        mode.beforeFinish?.(kit, sample);
        finish(kit, pressed?.sample ?? sample);
        return;
      }
      let placed = mode.place?.(kit, sample);
      if (placed === null) return;
      if (placed === undefined) {
        // The first click takes the height of what it hit; later ones, the mode's.
        const nodeId = graphNodeOf(sample);
        const node = nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === nodeId) : undefined;
        const height = draft.ends.length === 0 ? node?.position.y ?? sample.point.y : mode.clickHeight?.(kit, sample) ?? kit.startHeight();
        if (last && planDistance(sample.point, last.point) < 0.1) return;
        placed = pressed ?? kit.endAt(sample, height, last?.point);
      }
      draft.ends.push(placed);
      hint(kit);
      options.shown?.(kit);
    } catch (error) {
      clear(ctx);
      ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const tool: SpineDraftTool<Id> = {
    id: options.id,
    previewOnHover: true,
    defaultParams: options.defaultParams,
    startFrom(ctx, sample, params) { presses.delete(ctx.runtime); options.stroke?.cancel(ctx); clear(ctx); click(ctx, sample, params); },
    drafting: (ctx) => (drafts.get(ctx.runtime)?.ends.length ?? 0) > 0,
    // The next stretch runs from the last end clicked.
    rulerAnchor: (ctx) => drafts.get(ctx.runtime)?.ends.at(-1)?.point,
    previewFor(gesture, params, ctx) {
      if (presses.has(ctx.runtime)) return undefined;
      const draft = draftOf(ctx, params);
      if (draft.ends.length === 0) return options.idle?.(ctx, gesture.current, params);
      const kit = kitOf(ctx, draft, params);
      try {
        kit.mode.hover?.(kit, gesture.current);
        return options.preview(kit, gesture.current);
      } catch {
        return undefined;
      }
    },
    onKeyDown(ctx, key, params) {
      if ((key === "r" || key === "R") && options.cycle && ctx.updateToolParams) {
        const { modes, withMode } = options.cycle;
        const next = modes[(modes.indexOf(options.modeOf(params)) + 1) % modes.length]!;
        ctx.updateToolParams(options.id, (current) => withMode(current, next));
        clear(ctx);
        const mode = options.modes[next]!;
        ctx.reportFeedback({ tone: "info", message: `Modo: ${mode.label}.${mode.hints?.[0] ? ` ${mode.hints[0]}` : ""}` });
        return true;
      }
      const draft = drafts.get(ctx.runtime);
      if (!draft?.ends.length || presses.has(ctx.runtime)) return false;
      if (key === "Backspace") {
        draft.ends.pop();
        if (draft.ends.length === 0) clear(ctx); else hint(kitOf(ctx, draft, params));
        return true;
      }
      if (key !== "Enter") return false;
      const mode = options.modes[draft.mode]!;
      if (mode.needs === Infinity && draft.ends.length >= 2) {
        finish(kitOf(ctx, { ...draft, ends: draft.ends.slice(0, -1) }, params), draft.ends.at(-1)!.sample);
        return true;
      }
      if (options.chain) { clear(ctx); return true; }
      return false;
    },
    onCancel(ctx) {
      presses.delete(ctx.runtime);
      options.stroke?.cancel(ctx);
      clear(ctx);
    },
  };

  const stroke = options.stroke;
  if (!stroke) {
    // Clicks only: the dispatcher hands them over whole.
    return { ...tool, onClick: (ctx, sample, params) => click(ctx, sample, params) };
  }
  // With strokes, a press decides on release whether it was a click or a drag.
  return {
    ...tool,
    onPointerDown(ctx, sample, params) {
      const draft = drafts.get(ctx.runtime);
      const end = options.endAt(ctx, draft?.tool ?? options.begin(ctx), sample, sample.point.y);
      presses.set(ctx.runtime, end);
      stroke.begin(ctx, { ...end.sample, point: end.point }, params);
    },
    onPointerMove(ctx, gesture, params) {
      const pressed = presses.get(ctx.runtime);
      if (!pressed || !isStroke(gesture)) return;
      // A drag is a stroke of its own: a draft waiting for a click is dropped.
      if (drafts.has(ctx.runtime)) clear(ctx);
      stroke.move(ctx, from(gesture, { ...pressed.sample, point: pressed.point }), params);
    },
    onPointerUp(ctx, gesture, params) {
      const pressed = presses.get(ctx.runtime);
      presses.delete(ctx.runtime);
      if (!pressed) return;
      if (isStroke(gesture)) { stroke.finish(ctx, from(gesture, { ...pressed.sample, point: pressed.point }), params); return; }
      stroke.cancel(ctx);
      click(ctx, gesture.start, params, pressed);
    },
  };
}
