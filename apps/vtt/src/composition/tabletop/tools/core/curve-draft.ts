import { createAngleTracker } from "../../../../features/edit-construction/index.ts";
import type { ConstructionToolId, PreviewDescriptor, ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology, CubicBezier, CurveHandles, CurvePoint, CurveResult } from "../../../../ports/index.ts";
import { createRibbonMeshPreview } from "../shapes/ribbon-mesh-preview.ts";
import type { ConstructionTool, PointerSample, ToolContext } from "./tool-context.ts";
import { floorLandingAt, floorsOf, floorUnder } from "./floor-landing.ts";

/**
 * Drawing a new spine-built structure, one way of laying out its plan per
 * mode -- the same modes whatever the spine generates:
 *
 * - `straight`: start, end;
 * - `arc`: start, end, then the bulge pulled out from the chord (a two-point
 *   arc tool);
 * - `points`: clicks the curve passes through, drawn live up to the pointer
 *   (a curvature tool); the last point clicked again, or Enter, ends it;
 * - `connect`: two ends, each leaving square to the floor edge it lands on,
 *   and the curve between them follows (a curve build mode between
 *   oriented ends);
 * - `spiral`: centre, start, then turn the pointer round the centre in
 *   either direction -- every full circle adds a turn -- and click the end
 *   (a centre-ends spiral run).
 *
 * Heights are never drawn point by point: the start takes the height of
 * what it was clicked on, and the end the height of the floor it is clicked
 * on, or the tool's rise above the start. Shift and a vertical pointer move
 * change that rise in quarter steps. Everything between is the owner's to
 * derive. Live readouts say the length, rise, grade, and -- for arcs and
 * spirals -- the radius and turns.
 *
 * All the geometry is computed in Rust through the curve batch; this module
 * only keeps the gesture's state.
 */
export type CurveDraftMode = "straight" | "arc" | "points" | "connect" | "spiral";

/** Every mode a multi-mode tool cycles through with R, in order. */
export const CURVE_DRAFT_MODES: readonly CurveDraftMode[] = Object.freeze(["points", "straight", "arc", "connect", "spiral"]);

/** A finished draft: laid-out spans, or -- for `points` -- the points a smooth curve passes through. Ends carry their heights. */
export type FinishedCurveDraft =
  | { readonly kind: "spans"; readonly spans: readonly { readonly curve: CubicBezier; readonly handles: CurveHandles }[] }
  | { readonly kind: "points"; readonly points: readonly ConstructionPosition[] };

export interface CurveDraftOptions<Id extends ConstructionToolId> {
  readonly id: Id;
  readonly defaultParams: () => ToolParamsFor<Id>;
  /** The mode this tool draws in now. */
  readonly modeOf: (params: ToolParamsFor<Id>) => CurveDraftMode;
  /** Whether R cycles the mode, and how the tool stores the next one. */
  readonly withMode?: (params: ToolParamsFor<Id>, mode: CurveDraftMode) => ToolParamsFor<Id>;
  /** The default climb from start to end when the end is not on a floor. */
  readonly riseOf: (params: ToolParamsFor<Id>) => number;
  readonly commit: (ctx: ToolContext, draft: FinishedCurveDraft, params: ToolParamsFor<Id>) => void;
  /** The width the preview band is drawn at. */
  readonly widthOf: (params: ToolParamsFor<Id>) => number;
  readonly color: number;
}

/** A clicked end, with the floor edge it landed on when it did. */
interface End {
  readonly point: ConstructionPosition;
  readonly sample: PointerSample;
  /** Plan direction square to the floor edge it landed on, pointing off the floor. */
  readonly out?: { readonly x: number; readonly z: number };
}

interface DraftState {
  mode: CurveDraftMode;
  ends: End[];
  /** Spiral only: how far the pointer has turned round the centre since the start click. */
  turning?: ReturnType<typeof createAngleTracker>;
  /** A rise set with Shift, overriding the tool's own. */
  rise?: number;
  shift?: { readonly screenY: number; readonly base: number };
  /** The floors on the table, read once per click rather than on every pointer move. */
  floors: readonly ConstructionRegionTopology[];
  /** The last preview and what it was drawn for, so a pointer that has not moved costs nothing. */
  last?: { readonly key: string; readonly preview: PreviewDescriptor | undefined };
  readout?: string;
  readoutAt?: number;
}

const READOUT_INTERVAL_MS = 150;
const PREVIEW_OPACITY = 0.55;
const xyz = (p: ConstructionPosition): CurvePoint => [p.x, p.y, p.z];
const at = (p: CurvePoint): ConstructionPosition => ({ x: p[0], y: p[1], z: p[2] });

/** A click's end: near a floor's edge -- on the floor or just off it -- moved onto that edge at the floor's height, facing off the floor. */
function endAt(floors: readonly ConstructionRegionTopology[], sample: PointerSample, height: number): End {
  const landing = floorLandingAt(floors, sample);
  return landing ? { point: landing.point, sample, out: landing.out } : { point: { ...sample.point, y: height }, sample };
}

/** The spans of an arc through three points, or the straight span when they are in line -- from Rust. */
function arcThrough(ctx: ToolContext, start: ConstructionPosition, through: ConstructionPosition, end: ConstructionPosition): CurveResult {
  return ctx.runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "arcThrough", start: xyz(start), through: xyz(through), end: xyz(end) }] })[0]!;
}

function spansOf(result: CurveResult) {
  return result.curves.map((curve, i) => ({ curve, handles: result.handles[i]! }));
}

/** The free span between two ends, each leaving square to its floor edge, or along the chord when it has none. */
function connecting(start: End, end: End): { readonly curve: CubicBezier; readonly handles: CurveHandles } {
  const a = start.point, b = end.point;
  const reach = Math.hypot(b.x - a.x, b.z - a.z) / 3;
  const chord = { x: (b.x - a.x) / (3 * reach || 1), z: (b.z - a.z) / (3 * reach || 1) };
  const leave = start.out ?? chord;
  const arrive = end.out ?? { x: -chord.x, z: -chord.z };
  const dy = b.y - a.y;
  const curve: CubicBezier = { points: [
    xyz(a),
    [a.x + leave.x * reach, a.y + dy / 3, a.z + leave.z * reach],
    [b.x + arrive.x * reach, a.y + (2 * dy) / 3, b.z + arrive.z * reach],
    xyz(b),
  ] };
  const minus = (p: CurvePoint, q: CurvePoint): CurvePoint => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  return { curve, handles: { start: minus(curve.points[1], curve.points[0]), end: minus(curve.points[2], curve.points[3]), mode: "aligned", bandOffsets: [] } };
}

export interface CurveDraftTool<Id extends ConstructionToolId> extends ConstructionTool<Id> {
  /** Whether a draft is under way -- presses then belong to drawing, not to editing what stands. */
  drafting(ctx: ToolContext): boolean;
}

/** A creation tool drawing spine plans in the modes above; its owner only commits what it is handed. */
export function createCurveDraftTool<Id extends ConstructionToolId>(options: CurveDraftOptions<Id>): CurveDraftTool<Id> {
  const states = new WeakMap<ToolContext["runtime"], DraftState>();
  const stateOf = (ctx: ToolContext, params: ToolParamsFor<Id>): DraftState => {
    let state = states.get(ctx.runtime);
    const mode = options.modeOf(params);
    if (!state || state.mode !== mode) {
      state = { mode, ends: [], floors: floorsOf(ctx) };
      states.set(ctx.runtime, state);
    }
    return state;
  };
  const clear = (ctx: ToolContext) => states.delete(ctx.runtime);
  const startHeight = (state: DraftState) => state.ends[0]?.point.y ?? 0;
  const endHeight = (state: DraftState, sample: PointerSample, params: ToolParamsFor<Id>) => {
    return floorLandingAt(state.floors, sample)?.height ?? floorUnder(state.floors, sample)?.nodes[0]?.position.y ?? startHeight(state) + (state.rise ?? options.riseOf(params));
  };

  /** Where the spiral's pointer has turned it to; full circles add up. */
  const spiralTurn = (state: DraftState, cursor: ConstructionPosition) => {
    state.turning ??= createAngleTracker(state.ends[0]!.point, state.ends[1]!.point);
    return state.turning.turn(cursor);
  };

  /** What finishing now would build, with `sample` as the last click or the pointer. */
  function planned(ctx: ToolContext, state: DraftState, sample: PointerSample, params: ToolParamsFor<Id>, turned?: number): FinishedCurveDraft | undefined {
    const ends = state.ends;
    const height = endHeight(state, sample, params);
    switch (state.mode) {
      case "straight": {
        if (ends.length < 1) return undefined;
        const end = endAt(state.floors, sample, height).point;
        const a = ends[0]!.point;
        if (Math.hypot(end.x - a.x, end.z - a.z) < 0.1) return undefined;
        return { kind: "spans", spans: spansOf(arcThrough(ctx, a, { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2, z: (a.z + end.z) / 2 }, end)) };
      }
      case "arc": {
        if (ends.length < 2) return ends.length === 1 ? planned(ctx, { ...state, mode: "straight" }, sample, params) : undefined;
        const a = ends[0]!.point, b = ends[1]!.point;
        return { kind: "spans", spans: spansOf(arcThrough(ctx, a, { ...sample.point, y: (a.y + b.y) / 2 }, b)) };
      }
      case "points": {
        if (ends.length < 1) return undefined;
        return { kind: "points", points: [...ends.map((end) => end.point), endAt(state.floors, sample, height).point] };
      }
      case "connect": {
        if (ends.length < 1) return undefined;
        const end = endAt(state.floors, sample, height);
        if (Math.hypot(end.point.x - ends[0]!.point.x, end.point.z - ends[0]!.point.z) < 0.1) return undefined;
        return { kind: "spans", spans: [connecting(ends[0]!, end)] };
      }
      case "spiral": {
        if (ends.length < 2) return undefined;
        const [center, start] = ends;
        const radius = Math.hypot(start!.point.x - center!.point.x, start!.point.z - center!.point.z);
        const sweep = turned ?? state.turning?.turned ?? 0;
        if (radius < 0.1 || Math.abs(sweep) < 1e-3) return undefined;
        const startAngle = Math.atan2(start!.point.z - center!.point.z, start!.point.x - center!.point.x);
        const result = ctx.runtime.curveBatch({ tolerance: 0.01, commands: [{
          kind: "helix", center: [center!.point.x, start!.point.y, center!.point.z], radius, startAngle, sweep, rise: height - start!.point.y,
        }] })[0]!;
        return { kind: "spans", spans: spansOf(result) };
      }
    }
  }

  /** The draft's plan as cubics, for the preview and the readout. */
  function curvesOf(ctx: ToolContext, draft: FinishedCurveDraft): readonly CubicBezier[] {
    if (draft.kind === "spans") return draft.spans.map((span) => span.curve);
    if (draft.points.length < 2) return [];
    return ctx.runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "automatic", points: draft.points.map(xyz) }] })[0]!.curves;
  }

  function report(ctx: ToolContext, state: DraftState, curves: readonly CubicBezier[], lengths: readonly number[]): void {
    if (curves.length === 0) return;
    const run = lengths.reduce((sum, length) => sum + length, 0);
    const rise = curves.at(-1)!.points[3][1] - curves[0]!.points[0][1];
    const parts = [`comprimento ${run.toFixed(1)} m`, `subida ${rise.toFixed(2)} m`, `inclinação ${run > 0 ? ((Math.abs(rise) / run) * 100).toFixed(0) : "0"}%`];
    if (state.mode === "spiral" && state.ends.length >= 2) {
      const [center, start] = state.ends;
      parts.push(`raio ${Math.hypot(start!.point.x - center!.point.x, start!.point.z - center!.point.z).toFixed(2)} m`, `voltas ${(Math.abs(state.turning?.turned ?? 0) / (2 * Math.PI)).toFixed(2)}`);
    }
    const message = parts.join(" · ");
    const now = Date.now();
    // Updating the panel re-renders it: never more than a few times a second.
    if (message === state.readout || (state.readoutAt !== undefined && now - state.readoutAt < READOUT_INTERVAL_MS)) return;
    state.readout = message;
    state.readoutAt = now;
    ctx.reportFeedback({ tone: "info", message });
  }

  /** The band the draft would build, filled at its real width, with a disk at each end and at the pointer. */
  function drawn(ctx: ToolContext, state: DraftState, current: PointerSample, params: ToolParamsFor<Id>, width: number, turned: number | undefined): PreviewDescriptor {
    const anchors = state.ends.map((end) => end.point);
    let curves: readonly CubicBezier[] = [];
    if (state.mode === "spiral" && state.ends.length === 1) {
      // Centre only: the circle the start click will choose the radius of.
      const center = state.ends[0]!.point;
      const radius = Math.hypot(current.point.x - center.x, current.point.z - center.z);
      if (radius > 0.1) {
        curves = ctx.runtime.curveBatch({ tolerance: 0.05, commands: [{ kind: "helix", center: xyz(center), radius, startAngle: Math.atan2(current.point.z - center.z, current.point.x - center.x), sweep: 2 * Math.PI, rise: 0 }] })[0]!.curves;
      }
    } else {
      const draft = planned(ctx, state, current, params, turned);
      if (draft) curves = curvesOf(ctx, draft);
    }
    const ribbons = curves.length === 0 ? [] : ctx.runtime.curveBatch({ tolerance: 0.08, commands: curves.map((curve) => ({ kind: "ribbon" as const, curve, offsets: [-width / 2, width / 2] as const })) });
    if (state.mode !== "spiral" || state.ends.length >= 2) report(ctx, state, curves, ribbons.map((r) => r.lengths[0] ?? 0));
    return createRibbonMeshPreview({
      ribbons,
      fallbackPoints: [anchors.at(-1)!, { ...current.point, y: anchors.at(-1)!.y }],
      anchors,
      cursor: current.point,
      width,
      color: options.color,
      opacity: PREVIEW_OPACITY,
    });
  }

  function finish(ctx: ToolContext, state: DraftState, sample: PointerSample, params: ToolParamsFor<Id>): void {
    const draft = planned(ctx, state, sample, params);
    clear(ctx);
    if (!draft) {
      ctx.reportFeedback({ tone: "error", message: "Desenho curto demais: afaste mais o fim do começo." });
      return;
    }
    // A points draft ends on the point clicked last: its height is the end height.
    options.commit(ctx, draft, params);
  }

  /** How many clicks a mode takes before the next one finishes it; `points` finishes on demand. */
  const clicksToFinish: Record<CurveDraftMode, number> = { straight: 1, arc: 2, points: Infinity, connect: 1, spiral: 2 };

  const hints: Record<CurveDraftMode, readonly string[]> = {
    straight: ["Clique o início.", "Clique o fim."],
    arc: ["Clique o início.", "Clique o fim.", "Puxe a curva e clique."],
    points: ["Clique o início.", "Clique os pontos por onde passa; clique de novo no último, ou Enter, para terminar."],
    connect: ["Clique a primeira ponta, de preferência na borda de um piso.", "Clique a outra ponta."],
    spiral: ["Clique o centro.", "Clique o início: a distância é o raio.", "Gire em volta do centro no sentido desejado, cada volta completa soma uma volta, e clique o fim."],
  };
  const hint = (ctx: ToolContext, state: DraftState) => {
    const list = hints[state.mode];
    ctx.reportFeedback({ tone: "info", message: list[Math.min(state.ends.length, list.length - 1)]! });
  };

  return {
    id: options.id,
    previewOnHover: true,
    defaultParams: options.defaultParams,
    drafting: (ctx) => (states.get(ctx.runtime)?.ends.length ?? 0) > 0,
    previewFor(gesture, params, ctx) {
      const state = stateOf(ctx, params);
      const current = gesture.current;
      const width = Math.max(0.1, options.widthOf(params));
      // Before the first click: only where it would start.
      if (state.ends.length === 0) return createRibbonMeshPreview({ anchors: [], cursor: current.point, width, color: options.color, opacity: PREVIEW_OPACITY });
      if (current.shiftKey && current.screenY !== undefined) {
        state.shift ??= { screenY: current.screenY, base: state.rise ?? options.riseOf(params) };
        state.rise = state.shift.base + Math.round((state.shift.screenY - current.screenY) / 40 / 0.25) * 0.25;
      } else {
        state.shift = undefined;
      }
      try {
        const turned = state.mode === "spiral" && state.ends.length >= 2 ? spiralTurn(state, current.point) : undefined;
        const key = [current.point.x.toFixed(2), current.point.z.toFixed(2), state.rise ?? "", current.surfaceRef ?? "", turned?.toFixed(3) ?? "", state.ends.length, width].join("|");
        if (state.last?.key === key) return state.last.preview;
        const preview = drawn(ctx, state, current, params, width, turned);
        state.last = { key, preview };
        return preview;
      } catch {
        return undefined;
      }
    },
    onClick(ctx, sample, params) {
      const state = stateOf(ctx, params);
      state.floors = floorsOf(ctx);
      state.last = undefined;
      try {
        const needed = clicksToFinish[state.mode];
        const last = state.ends.at(-1);
        if (state.mode === "points" && last && state.ends.length >= 2 && Math.hypot(sample.point.x - last.point.x, sample.point.z - last.point.z) < 0.25) {
          const done = { ...state, ends: state.ends.slice(0, -1) };
          finish(ctx, done, last.sample, params);
          return;
        }
        if (state.ends.length >= needed) {
          if (state.mode === "spiral") spiralTurn(state, sample.point);
          finish(ctx, state, sample, params);
          return;
        }
        const node = sample.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === sample.nodeId) : undefined;
        // The first click (and a spiral's start) takes the height of what it
        // hit; an arc's second click is its end; points between are the owner's.
        const height = state.ends.length === 0 || state.mode === "spiral" ? node?.position.y ?? sample.point.y
          : state.mode === "arc" ? endHeight(state, sample, params) : startHeight(state);
        if (last && Math.hypot(sample.point.x - last.point.x, sample.point.z - last.point.z) < 0.1) return;
        state.ends.push(state.ends.length === 0 || state.mode !== "spiral" ? endAt(state.floors, sample, height) : { point: { ...sample.point, y: height }, sample });
        if (state.mode === "spiral" && state.ends.length === 2) {
          // The spiral starts at the start click's height; the centre is only a position.
          state.ends[0] = { ...state.ends[0]!, point: { ...state.ends[0]!.point, y: height } };
          state.turning = undefined;
        }
        hint(ctx, state);
      } catch (error) {
        clear(ctx);
        ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    onKeyDown(ctx, key, params) {
      const state = states.get(ctx.runtime);
      if ((key === "r" || key === "R") && options.withMode && ctx.updateToolParams) {
        const modes = CURVE_DRAFT_MODES;
        const next = modes[(modes.indexOf(options.modeOf(params)) + 1) % modes.length]!;
        ctx.updateToolParams(options.id, (current) => options.withMode!(current, next));
        clear(ctx);
        ctx.reportFeedback({ tone: "info", message: `Modo: ${MODE_LABELS[next]}. ${hints[next][0]}` });
        return true;
      }
      if (!state?.ends.length) return false;
      if (key === "Backspace") {
        state.ends.pop();
        if (state.ends.length === 0) clear(ctx); else hint(ctx, state);
        return true;
      }
      if (key === "Enter" && state.mode === "points" && state.ends.length >= 2) {
        const done = { ...state, ends: state.ends.slice(0, -1) };
        finish(ctx, done, state.ends.at(-1)!.sample, params);
        return true;
      }
      return false;
    },
    onCancel(ctx) { clear(ctx); },
  };
}

/** How each mode is named to the person drawing. */
export const MODE_LABELS: Record<CurveDraftMode, string> = {
  straight: "Reta",
  arc: "Arco",
  points: "Por pontos",
  connect: "Ligar pontas",
  spiral: "Espiral",
};
