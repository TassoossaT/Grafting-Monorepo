import { createPathBrushEffect, pathFormationFor, DEFAULT_TOOL_PARAMS, PATH_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ConstructionTool, type ToolContext, type PointerSample, type ToolGesture } from "../core/tool-context.ts";
import { createSpineEditBehavior } from "../core/spine-edit-behavior.ts";
import { pathStrokeTool } from "./path-stroke-tool.ts";
import { roadAnchorSnap, roadSnapTarget, roadSnapIsCurrent, showRoadSnap, type RoadSnapTarget } from "./road-body-target.ts";
import { createFastRoadPreview } from "./road-preview-mesh.ts";

const CHANNEL = "road-points";
const xyz = (p: ConstructionPosition) => [p.x, p.y, p.z] as const;
const equal = (a: ConstructionPosition, b: ConstructionPosition) => a.x === b.x && a.y === b.y && a.z === b.z;
type Draft = { points: ConstructionPosition[]; params: PathBrushParams };
type Gesture = { kind: "edit" } | { kind: "stroke"; origin?: PointerSample } | { kind: "point"; point: ConstructionPosition; snapTarget?: RoadSnapTarget } | { kind: "selection" };
const drafts = new WeakMap<ToolContext["runtime"], Draft>();
const gestures = new WeakMap<ToolContext["runtime"], Gesture>();
/** Editing a standing road by its points -- the spine editor every spine-built type shares. */
const spine = createSpineEditBehavior({ ownsSpine: (surfaceType) => surfaceType === PATH_SURFACE_TYPE, snap: roadAnchorSnap });

function seededGesture<G extends ToolGesture>(gesture: G, origin?: PointerSample): G {
  return origin ? { ...gesture, start: origin, samples: [origin, ...gesture.samples.slice(1)] } : gesture;
}

function curves(ctx: ToolContext, points: readonly ConstructionPosition[]): readonly CubicBezier[] {
  return ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "automatic", points: points.map(xyz) }] })[0]!.curves;
}

/** Prunes accidental duplicate or jitter points (< 0.1m) from a draft spine. */
export function prunePoints(points: readonly ConstructionPosition[]): ConstructionPosition[] {
  return points.filter((p, i, all) => {
    if (i === 0 || i === all.length - 1) return true;
    const prev = all[i - 1]!;
    return Math.hypot(p.x - prev.x, p.z - prev.z) >= 0.1;
  });
}

function preview(ctx: ToolContext, draft: Draft, cursor?: ConstructionPosition): void {
  ctx.runtime.showPreview(
    createFastRoadPreview(draft.points, draft.params.bedWidth, cursor),
    CHANNEL,
  );
}
function safely(ctx: ToolContext, work: () => void): void {
  try { work(); } catch (error) {
    spine.abort(ctx);
    gestures.delete(ctx.runtime);
    pathStrokeTool.onCancel?.(ctx);
    ctx.reportFeedback({ tone: "error", message: `Caminho preservado: ${String(error)}` });
  }
}
function commitDraft(ctx: ToolContext, draft: Draft): void {
  const points = prunePoints(draft.points);
  if (points.length < 2) return;
  const operationId = scopedToolId(ctx, "road-points", ctx.nextSequence());
  const effect = createPathBrushEffect({
    brushShape: { kind: "circle", radius: 0.025 }, brushRegion: { samples: points },
    authoredCurves: curves(ctx, points), curveMode: "automatic", parameters: pathFormationFor(draft.params),
  }, { operationId, tableId: ctx.tableId, initiatedBy: "road-points" });
  if (commitPathCloudIntent(ctx, effect, 0.025)) {
    drafts.delete(ctx.runtime);
    ctx.runtime.clearPreview(CHANNEL);
    showRoadSnap(ctx);
  }
}

function startBranch(ctx: ToolContext, id: string | undefined, params: PathBrushParams): boolean {

    const node = ctx.runtime.getGraphSnapshot().nodes.find(n => n.id === id);
    if (!node || !spine.pick(ctx, { nodeId: node.id, point: node.position })) return false;
    const draft: Draft = { points: [{ ...node.position }], params: { ...params, creationMode: "points" } };
    showRoadSnap(ctx);
    drafts.set(ctx.runtime, draft);
    spine.select(ctx);
    preview(ctx, draft);
    ctx.reportFeedback({ tone: "info", message: "Posicione a nova rua com o mouse. Clique num encaixe para finalizar, ou adicione pontos livres; Enter confirma e Esc cancela." });
    return true;
}

/** A road is drawn freely or through explicit points, and edited by its spine points. */
export const pathPointsTool: ConstructionTool<"path-brush"> = {
  id: "path-brush",
  handlePresentation: "spine-points",
  anchorSnap: roadAnchorSnap,
  useGridSnap: false,
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  previewOnHover: true,
  previewFor(g, _params, ctx) {
    const draft = drafts.get(ctx.runtime);
    if (draft?.points.length && !gestures.has(ctx.runtime)) {
      const target = roadSnapTarget(ctx, g.current);
      showRoadSnap(ctx, target);
      preview(ctx, draft, target?.point ?? g.current.point);
    }
    return undefined;
  },
  onPointerDown(ctx, sample, params) {
    safely(ctx, () => {
      if (gestures.has(ctx.runtime)) return;
      if (sample.constructionAction?.kind === "branch") {
        if (!drafts.has(ctx.runtime)) startBranch(ctx, sample.constructionAction.nodeId, params);
        return;
      }
      const snap = drafts.has(ctx.runtime) ? roadSnapTarget(ctx, sample) : undefined;
      if (snap) sample = snap;
      if (!drafts.get(ctx.runtime)?.points.length) {
        const picked = spine.pick(ctx, sample);
        const origin = picked?.sample;
        if (sample.shiftKey && origin) {
          spine.select(ctx);
          if (drafts.has(ctx.runtime) || (params.creationMode && params.creationMode !== "brush")) {
            gestures.set(ctx.runtime, { kind: "point", point: { ...origin.point } });
          } else {
            gestures.set(ctx.runtime, { kind: "stroke", origin });
            pathStrokeTool.onPointerDown?.(ctx, origin, params);
          }
          return;
        }
        if (picked) {
          if (spine.begin(ctx, picked)) gestures.set(ctx.runtime, { kind: "edit" });
          return;
        }
        if (spine.isHandle(ctx, sample)) {
          spine.select(ctx);
          gestures.set(ctx.runtime, { kind: "selection" });
          return;
        }
        spine.select(ctx);
      }
      if (drafts.has(ctx.runtime) || (params.creationMode && params.creationMode !== "brush")) {
        gestures.set(ctx.runtime, { kind: "point", point: { ...sample.point }, snapTarget: snap });
      } else {
        gestures.set(ctx.runtime, { kind: "stroke" });
        pathStrokeTool.onPointerDown?.(ctx, sample, params);
      }
    });
  },
  onPointerMove(ctx, g, params) {
    safely(ctx, () => {
      const active = gestures.get(ctx.runtime);
      if (active?.kind === "edit") spine.move(ctx, g);
      else if (active?.kind === "stroke") pathStrokeTool.onPointerMove?.(ctx, seededGesture(g, active.origin), params);
      else if (active?.kind === "point") {
        const draft = drafts.get(ctx.runtime);
        if (draft?.points.length) {
          // A click confirms the proposal latched on pointer-down, even with hand jitter on release.
          preview(ctx, draft, active.point);
        }
      }
    });
  },
  onPointerUp(ctx, g, params) {
    safely(ctx, () => {
      const active = gestures.get(ctx.runtime);
      gestures.delete(ctx.runtime);
      if (active?.kind === "edit") spine.end(ctx, g);
      else if (active?.kind === "stroke") pathStrokeTool.onPointerUp?.(ctx, seededGesture(g, active.origin), params);
      else if (active?.kind === "point") {
        if (active.snapTarget && !roadSnapIsCurrent(ctx, active.snapTarget)) {
          showRoadSnap(ctx);
          throw new Error("O alvo de encaixe mudou. Aproxime o mouse novamente antes de confirmar.");
        }
        const draft = drafts.get(ctx.runtime) ?? { points: [], params: { ...params } };
        const last = draft.points.at(-1);
        if (!last || Math.hypot(active.point.x - last.x, active.point.z - last.z) >= 0.1 || Math.abs(active.point.y - last.y) >= 0.05) {
          draft.points.push(active.point);
        } else {
          draft.points[draft.points.length - 1] = active.point;
        }
        drafts.set(ctx.runtime, draft);
        if (active.snapTarget && draft.points.length >= 2) commitDraft(ctx, draft);
        else preview(ctx, draft);
      }
    });
  },
  onSelectionAction(ctx, action, params) {
    if (action !== "branch" || gestures.has(ctx.runtime) || drafts.has(ctx.runtime)) return false;
    return startBranch(ctx, spine.selected(ctx), params);
  },
  onKeyDown(ctx, key) {
    if (gestures.has(ctx.runtime)) return false;
    const draft = drafts.get(ctx.runtime);
    if (draft?.points.length) {
      if (key !== "Enter" && key !== "Backspace") return false;
      safely(ctx, () => {
        if (key === "Backspace") {
          draft.points.pop();
          if (draft.points.length) preview(ctx, draft);
          else { drafts.delete(ctx.runtime); ctx.runtime.clearPreview(CHANNEL); showRoadSnap(ctx); }
        } else if (draft.points.length >= 2) {
          commitDraft(ctx, draft);
        }
      });
      return true;
    }
    if (!spine.selected(ctx) || (key !== "Delete" && key !== "Backspace")) return false;
    let removed = true;
    safely(ctx, () => { removed = spine.removeSelected(ctx); });
    return removed;
  },
  onCancel(ctx) {
    gestures.delete(ctx.runtime);
    drafts.delete(ctx.runtime);
    pathStrokeTool.onCancel?.(ctx);
    ctx.runtime.clearPreview(CHANNEL);
    showRoadSnap(ctx);
    spine.cancel(ctx);
  },
};
