import { createCurvePen, type CurvePen, type CurvePenDraft } from "../../../../adapters/rendering/index.ts";
import { createPathBrushEffect, pathFormationFor, DEFAULT_TOOL_PARAMS } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier, CurvePoint } from "../../../../ports/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ConstructionTool, type ToolContext } from "../core/tool-context.ts";

const CHANNEL = "curve-pen";
const COLOR = 0xc084fc;
const point = (p: ConstructionPosition): CurvePoint => [p.x, p.y, p.z];
const position = (p: CurvePoint): ConstructionPosition => Object.freeze({ x: p[0], y: p[1], z: p[2] });
const equal = (a: ConstructionPosition, b: ConstructionPosition) => a.x === b.x && a.y === b.y && a.z === b.z;

/** Converts the authored controls to the engine wire shape, without fitting or sampling. */
function curvesFor(draft: CurvePenDraft<ConstructionPosition>): readonly CubicBezier[] {
  return draft.anchors.flatMap((anchor, i) => {
    const next = draft.anchors[i + 1] ?? (draft.closed ? draft.anchors[0] : undefined);
    return next ? [{ points: [point(anchor.point), point(anchor.outgoing), point(next.incoming), point(next.point)] as const }] : [];
  });
}

interface PenSession { readonly pen: CurvePen<ConstructionPosition>; readonly params: PathBrushParams }
const sessions = new WeakMap<ToolContext["runtime"], PenSession>();

function session(ctx: ToolContext, params: PathBrushParams): PenSession {
  const existing = sessions.get(ctx.runtime);
  if (existing) return existing;
  // Capture the recipe for this draft; a parameter change cancels through the dispatcher.
  const ownedParams = Object.freeze({ ...params });
  const pen = createCurvePen<ConstructionPosition>({
    equal,
    // Product policy: deliberate placement near the first point closes at the same elevation.
    closes: (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= 0.2 && Math.abs(a.y - b.y) <= 0.05,
    anchor(p, drag) {
      const anchor = Object.freeze({ ...p });
      if (!drag) return { point: anchor, incoming: anchor, outgoing: anchor };
      const origin = point(anchor);
      const result = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{
        kind: "handle", curve: { points: [origin, origin, origin, origin] },
        index: 1, target: point(drag), mode: "mirrored", opposite: origin,
      }] })[0]!;
      if (!result.opposite) throw new Error("O motor não retornou a tangente oposta.");
      return { point: anchor, incoming: position(result.opposite), outgoing: position(result.curves[0]!.points[1]) };
    },
    onPreview(draft) {
      if (!draft.anchors.length) { ctx.runtime.clearPreview(CHANNEL); return; }
      const curves = curvesFor(draft);
      const segments: number[] = [];
      if (curves.length) {
        const samples = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "sample", curves }] })[0]!.samples;
        for (const span of samples) for (let i = 1; i < span.length; i++) segments.push(...span[i - 1]!.position, ...span[i]!.position);
      }
      for (const anchor of draft.anchors) {
        segments.push(...point(anchor.incoming), ...point(anchor.point), ...point(anchor.point), ...point(anchor.outgoing));
        // Small scene markers keep click-only anchors visible before a second point exists.
        for (const p of [anchor.point, anchor.incoming, anchor.outgoing]) {
          segments.push(p.x - 0.08, p.y + 0.02, p.z, p.x + 0.08, p.y + 0.02, p.z,
            p.x, p.y + 0.02, p.z - 0.08, p.x, p.y + 0.02, p.z + 0.08);
        }
      }
      ctx.runtime.showPreview({ kind: "segments", positions: Float32Array.from(segments), color: COLOR, opacity: 0.95 }, CHANNEL);
    },
    onFinish(draft) {
      const operationId = scopedToolId(ctx, "curve-pen", ctx.nextSequence());
      const effect = createPathBrushEffect({
        brushShape: { kind: "circle", radius: 0.025 },
        brushRegion: { samples: draft.anchors.map((a) => a.point) },
        authoredCurves: curvesFor(draft),
        parameters: pathFormationFor(ownedParams),
      }, { operationId, tableId: ctx.tableId, initiatedBy: "curve-pen" });
      return commitPathCloudIntent(ctx, effect, 0.025);
    },
  });
  const value = { pen, params: ownedParams };
  sessions.set(ctx.runtime, value);
  return value;
}
function safely(ctx: ToolContext, work: () => void): void {
  try { work(); }
  catch (error) {
    // A failed sample must never leave a stale preview that can later be committed.
    sessions.get(ctx.runtime)?.pen.cancel();
    sessions.delete(ctx.runtime);
    ctx.runtime.clearPreview(CHANNEL);
    ctx.reportFeedback({ tone: "error", message: String(error) });
  }
}

/** VTT binding for the reusable pen; only finish changes the construction session. */
export const pathPenTool: ConstructionTool<"path-brush"> = {
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  previewOnHover: true,
  previewFor(gesture, params, ctx) {
    safely(ctx, () => sessions.get(ctx.runtime)?.pen.hover(gesture.current.point));
    return undefined;
  },
  onPointerDown(ctx, sample, params) { safely(ctx, () => session(ctx, params).pen.begin(sample.point)); },
  onPointerMove(ctx, gesture, params) { safely(ctx, () => session(ctx, params).pen.move(gesture.current.point)); },
  onPointerUp(ctx, gesture, params) { safely(ctx, () => session(ctx, params).pen.end(gesture.current.point)); },
  onKeyDown(ctx, key) {
    const active = sessions.get(ctx.runtime);
    if (!active || !["Enter", "Backspace"].includes(key)) return false;
    if (!active.pen.snapshot().anchors.length) return false;
    safely(ctx, () => { if (key === "Enter") active.pen.finish(); else active.pen.removeLast(); });
    return true;
  },
  onCancel(ctx) {
    sessions.get(ctx.runtime)?.pen.cancel();
    sessions.delete(ctx.runtime);
    ctx.runtime.clearPreview(CHANNEL);
  },
};
