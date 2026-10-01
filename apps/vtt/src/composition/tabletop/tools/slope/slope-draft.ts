import { adoptsEnds, endJointNear, type ConstructionToolId, type EndJoint, type PreviewDescriptor, type ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology, CubicBezier } from "../../../../ports/index.ts";
import { floorLandingAt, floorLandingToward, floorsOf, floorUnder } from "../core/floor-landing.ts";
import { pointerAtHeight } from "../core/pointer-ray.ts";
import { createSpineDraftTool, type DraftEnd, type DraftKit, type FinishedSpineDraft, type SpineDraftTool } from "../core/spine-draft.ts";
import { SPINE_DRAFT_MODES, spineDraftModes, type SpineDraftModeName } from "../core/spine-draft-modes.ts";
import type { PointerSample, ToolContext } from "../core/tool-context.ts";
import { createRibbonMeshPreview } from "../shapes/ribbon-mesh-preview.ts";

/**
 * A sloped platform drawn as a spine, in the shared draft modes
 * (`core/spine-draft.ts`): its ends land on floors' edges and on the free
 * ends of structures that take ends over, its end climbs a set rise above
 * its start unless it lands on a floor -- Shift and a vertical pointer move
 * change that rise in quarter steps -- and live readouts say the length,
 * rise, grade, and what the mode adds.
 */
export interface SlopeDraftOptions<Id extends ConstructionToolId> {
  readonly id: Id;
  readonly defaultParams: () => ToolParamsFor<Id>;
  /** The mode this tool draws in now. */
  readonly modeOf: (params: ToolParamsFor<Id>) => SpineDraftModeName;
  /** Whether R cycles the mode, and how the tool stores the next one. */
  readonly withMode?: (params: ToolParamsFor<Id>, mode: SpineDraftModeName) => ToolParamsFor<Id>;
  /** The default climb from start to end when the end is not on a floor. */
  readonly riseOf: (params: ToolParamsFor<Id>) => number;
  readonly commit: (ctx: ToolContext, draft: FinishedSpineDraft, params: ToolParamsFor<Id>) => void;
  /** The width the preview band is drawn at. */
  readonly widthOf: (params: ToolParamsFor<Id>) => number;
  readonly color: number;
}

interface SlopeDraftState {
  /** The floors on the table, read once per click rather than on every pointer move. */
  floors: readonly ConstructionRegionTopology[];
  /** The free end of a structure that takes nodes over (a straight ramp's) the pointer is at, if any -- read with the floors. */
  jointAt: (sample: PointerSample) => EndJoint | undefined;
  /** A rise set with Shift, overriding the tool's own. */
  rise?: number;
  shift?: { readonly screenY: number; readonly base: number };
  /** The last preview and what it was drawn for, so a pointer that has not moved costs nothing. */
  last?: { readonly key: string; readonly preview: PreviewDescriptor | undefined };
  readout?: string;
  readoutAt?: number;
}

const READOUT_INTERVAL_MS = 150;
const PREVIEW_OPACITY = 0.55;

/** What the draft reads of the table once per click: its floors, and the free ends a spine's end may run on from. */
function tableOf(ctx: ToolContext): Pick<SlopeDraftState, "floors" | "jointAt"> {
  const graph = ctx.runtime.getGraphSnapshot();
  const topologies = ctx.runtime.getAllRegionTopologies();
  return {
    floors: floorsOf(ctx),
    jointAt: (sample) => endJointNear(graph, topologies, (height) => pointerAtHeight(sample, height), { accept: adoptsEnds }),
  };
}

/**
 * A click's end: at a straight ramp's free end, running straight on from it;
 * else dropped anywhere on a floor coming `from` somewhere, at the edge it
 * crosses to get there; else where the pointer is at `height`.
 */
function endAt(state: SlopeDraftState, sample: PointerSample, height: number, from?: ConstructionPosition): DraftEnd {
  const joint = state.jointAt(sample);
  if (joint) return { point: joint.mid, sample, out: joint.out, joint: true };
  const landing = floorLandingToward(state.floors, sample, from);
  return landing ? { point: landing.point, sample, out: landing.out } : { point: pointerAtHeight(sample, height), sample };
}

export function createSlopeDraftTool<Id extends ConstructionToolId>(options: SlopeDraftOptions<Id>): SpineDraftTool<Id> {
  const widthOf = (params: ToolParamsFor<Id>) => Math.max(0.1, options.widthOf(params));

  /** The draft's plan as cubics, for the preview and the readout. */
  function curvesOf(kit: DraftKit<Id, SlopeDraftState>, cursor: PointerSample): readonly CubicBezier[] {
    const sketched = kit.mode.sketch?.(kit, cursor);
    if (sketched) return sketched;
    const draft = kit.mode.plan(kit, cursor);
    if (!draft) return [];
    if (draft.kind === "spans") return draft.spans.map((span) => span.curve);
    if (draft.points.length < 2) return [];
    return kit.ctx.runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "automatic", points: draft.points.map((p) => [p.x, p.y, p.z] as const) }] })[0]!.curves;
  }

  function report(kit: DraftKit<Id, SlopeDraftState>, curves: readonly CubicBezier[], lengths: readonly number[]): void {
    const extra = kit.mode.readout ? kit.mode.readout(kit) : [];
    if (extra === undefined || curves.length === 0) return;
    const state = kit.draft.tool;
    const run = lengths.reduce((sum, length) => sum + length, 0);
    const rise = curves.at(-1)!.points[3][1] - curves[0]!.points[0][1];
    const message = [`comprimento ${run.toFixed(1)} m`, `subida ${rise.toFixed(2)} m`, `inclinação ${run > 0 ? ((Math.abs(rise) / run) * 100).toFixed(0) : "0"}%`, ...extra].join(" · ");
    const now = Date.now();
    // Updating the panel re-renders it: never more than a few times a second.
    if (message === state.readout || (state.readoutAt !== undefined && now - state.readoutAt < READOUT_INTERVAL_MS)) return;
    state.readout = message;
    state.readoutAt = now;
    kit.ctx.reportFeedback({ tone: "info", message });
  }

  /** The band the draft would build, filled at its real width, with a disk at each end and at the pointer. */
  function drawn(kit: DraftKit<Id, SlopeDraftState>, current: PointerSample, width: number): PreviewDescriptor {
    const anchors = kit.draft.ends.map((end) => end.point);
    const curves = curvesOf(kit, current);
    const ribbons = curves.length === 0 ? [] : kit.ctx.runtime.curveBatch({ tolerance: 0.08, commands: curves.map((curve) => ({ kind: "ribbon" as const, curve, offsets: [-width / 2, width / 2] as const })) });
    report(kit, curves, ribbons.map((r) => r.lengths[0] ?? 0));
    return createRibbonMeshPreview({
      ribbons,
      fallbackPoints: [anchors.at(-1)!, pointerAtHeight(current, anchors.at(-1)!.y)],
      anchors,
      cursor: current.point,
      width,
      color: options.color,
      opacity: PREVIEW_OPACITY,
    });
  }

  return createSpineDraftTool<Id, SlopeDraftState>({
    id: options.id,
    defaultParams: options.defaultParams,
    modes: spineDraftModes<Id, SlopeDraftState>(),
    modeOf: options.modeOf,
    ...(options.withMode ? { cycle: { modes: SPINE_DRAFT_MODES, withMode: (params: ToolParamsFor<Id>, mode: string) => options.withMode!(params, mode as SpineDraftModeName) } } : {}),
    begin: (ctx) => tableOf(ctx),
    refresh(ctx, state) {
      Object.assign(state, tableOf(ctx));
      state.last = undefined;
    },
    endAt: (_ctx, state, sample, height, from) => endAt(state, sample, height, from),
    endHeight(kit, sample) {
      const state = kit.draft.tool;
      return floorLandingAt(state.floors, sample)?.height ?? floorUnder(state.floors, sample)?.nodes[0]?.position.y ?? kit.startHeight() + (state.rise ?? options.riseOf(kit.params));
    },
    // Before the first click: only where it would start.
    idle: (_ctx, cursor, params) => createRibbonMeshPreview({ anchors: [], cursor: cursor.point, width: widthOf(params), color: options.color, opacity: PREVIEW_OPACITY }),
    preview(kit, current) {
      const state = kit.draft.tool;
      const width = widthOf(kit.params);
      if (current.shiftKey && current.screenY !== undefined) {
        state.shift ??= { screenY: current.screenY, base: state.rise ?? options.riseOf(kit.params) };
        state.rise = state.shift.base + Math.round((state.shift.screenY - current.screenY) / 40 / 0.25) * 0.25;
      } else {
        state.shift = undefined;
      }
      const key = [current.point.x.toFixed(2), current.point.z.toFixed(2), state.rise ?? "", current.surfaceRef ?? "", kit.mode.key?.(kit) ?? "", kit.draft.ends.length, width].join("|");
      if (state.last?.key === key) return state.last.preview;
      const preview = drawn(kit, current, width);
      state.last = { key, preview };
      return preview;
    },
    commit(ctx, finished, params) {
      // A points draft ends on the point clicked last: its height is the end height.
      options.commit(ctx, finished, params);
      return undefined;
    },
    tooShort: "Desenho curto demais: afaste mais o fim do começo.",
  });
}
