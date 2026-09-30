import { createPathBrushEffect, isSpineControlNodeId, curvePick, pathFormationFor, pathHalfWidth, DEFAULT_TOOL_PARAMS, PATH_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { gestureMoved, scopedToolId, type ConstructionTool, type ToolContext, type PointerSample, type ToolGesture } from "../core/tool-context.ts";
import { createSpineEditBehavior } from "../core/spine-edit-behavior.ts";
import { finishPathStroke, pathStrokeTool } from "./path-stroke-tool.ts";
import { roadAnchorSnap, roadSnapTarget, roadSnapIsCurrent, showRoadSnap, type RoadSnapTarget } from "./road-body-target.ts";
import { createRoadMeshPreview, showRoadSpinePreview, ROAD_ERROR_COLOR, ROAD_ERROR_OPACITY } from "./road-preview-mesh.ts";

const CHANNEL = "road-points";
const xyz = (p: ConstructionPosition) => [p.x, p.y, p.z] as const;
const equal = (a: ConstructionPosition, b: ConstructionPosition) => a.x === b.x && a.y === b.y && a.z === b.z;
type Draft = { points: ConstructionPosition[]; params: PathBrushParams };
type Gesture = { kind: "edit" } | { kind: "stroke"; origin?: PointerSample } | { kind: "point"; point: ConstructionPosition; snapTarget?: RoadSnapTarget } | { kind: "selection" };
const drafts = new WeakMap<ToolContext["runtime"], Draft>();
const gestures = new WeakMap<ToolContext["runtime"], Gesture>();
const DRAFT_HANDLE_ID = "path-draft-continuation";

function clearDraft(ctx: ToolContext): void {
  drafts.delete(ctx.runtime);
  ctx.runtime.clearPreview(CHANNEL);
  ctx.runtime.clearPreview("road-draft-spine");
  ctx.runtime.setCreationHandle?.(undefined);
}
/** Editing a standing road by its points -- the spine editor every spine-built type shares. */
const spine = createSpineEditBehavior({ ownsSpine: (surfaceType) => surfaceType === PATH_SURFACE_TYPE, snap: roadAnchorSnap,
  selectBodyOnClick: true,
  panelActions: false,
  onSelect(ctx) {
    const selection = spine.selection(ctx);
    ctx.runtime.clearPreview("road-selection");
    if (!selection) return;
    ctx.updateToolParams?.("path-brush", current => current.bedWidth === selection.width ? current : { ...current, bedWidth: selection.width });
    const graph = ctx.runtime.getGraphSnapshot();
    const edgeId = curvePick(selection.id)?.edgeId;
    const edges = graph.edges.filter(e => e.curve?.surfaceType === PATH_SURFACE_TYPE &&
      (edgeId ? e.edgeId === edgeId : e.startNodeId === selection.id || e.endNodeId === selection.id));
    const nodes = new Map(graph.nodes.map(n => [n.id, n.position]));
    const samples = ctx.runtime.curveBatch({ tolerance: 0.025, commands: edges.map(e => ({ kind: "resolve" as const, handles: e.curve!, start: xyz(nodes.get(e.startNodeId)!), end: xyz(nodes.get(e.endNodeId)!) })) });
    showRoadSpinePreview(ctx, samples.flatMap(result => result.curves), "road-selection");
  },
});

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
  const last = draft.points.at(-1);
  ctx.runtime.setCreationHandle?.(last ? { id: DRAFT_HANDLE_ID, position: last } : undefined);
  const points = cursor && (!draft.points.length || !equal(draft.points.at(-1)!, cursor))
    ? [...draft.points, cursor] : draft.points;
  const halfWidth = pathHalfWidth(draft.params);
  const options = { anchors: points, bedWidth: halfWidth * 2 };
  try {
    const authored = points.length < 2 ? [] : curves(ctx, points);
    showRoadSpinePreview(ctx, authored, "road-draft-spine");
    const ribbons = ctx.runtime.curveBatch({
      tolerance: 0.025,
      commands: authored.map((curve) => ({ kind: "ribbon" as const, curve,
        offsets: [-halfWidth, halfWidth] as const })),
    });
    ctx.runtime.showPreview(createRoadMeshPreview({ ...options, ribbons }), CHANNEL);
  } catch {
    ctx.runtime.clearPreview("road-draft-spine");
    // Invalid hover is visible but never replaces the confirmed draft or
    // commits the previous valid preview. Confirmation validates again.
    ctx.runtime.showPreview(createRoadMeshPreview({ ...options, fallbackPoints: points,
      color: ROAD_ERROR_COLOR, opacity: ROAD_ERROR_OPACITY }), CHANNEL);
  }
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
  const points = draft.points;
  if (points.length < 2) return;
  const operationId = scopedToolId(ctx, "road-points", ctx.nextSequence());
  const effect = createPathBrushEffect({
    brushShape: { kind: "circle", radius: 0.025 }, brushRegion: { samples: points },
    authoredCurves: curves(ctx, points), curveMode: "automatic", parameters: pathFormationFor(draft.params),
  }, { operationId, tableId: ctx.tableId, initiatedBy: "road-points" });
  if (commitPathCloudIntent(ctx, effect, 0.025)) {
    clearDraft(ctx);
    showRoadSnap(ctx);
  }
}

function startBranch(ctx: ToolContext, id: string | undefined, params: PathBrushParams): boolean {
    const node = ctx.runtime.getGraphSnapshot().nodes.find(n => n.id === id);
    if (!node || !spine.pick(ctx, { nodeId: node.id, point: node.position })) return false;
    const draft: Draft = { points: [{ ...node.position }], params: { ...params } };
    showRoadSnap(ctx);
    drafts.set(ctx.runtime, draft);
    spine.select(ctx);
    preview(ctx, draft);
    ctx.reportFeedback({ tone: "info", message: params.creationMode === "points" ? "Adicione pontos para continuar a espinha. Enter confirma e Esc cancela." : "Arraste o + para desenhar a ramificação. Solte para confirmar; Esc cancela." });
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
  onParamsChange(ctx, next, previous) {
    safely(ctx, () => {
      if (next.creationMode !== previous.creationMode) { this.onCancel?.(ctx); return; }
      const draft = drafts.get(ctx.runtime);
      if (draft) { draft.params = { ...next }; preview(ctx, draft); return; }
      if (next.bedWidth !== previous.bedWidth) spine.resizeSelected(ctx, next.bedWidth);
    });
  },
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
      if (sample.constructionAction?.kind === "continue") {
        const draft = drafts.get(ctx.runtime);
        if (sample.constructionAction.nodeId !== DRAFT_HANDLE_ID || !draft?.points.length) return;
        if (!params.creationMode || params.creationMode === "brush") {
          const origin = { ...sample, point: draft.points.at(-1)!, constructionAction: undefined };
          gestures.set(ctx.runtime, { kind: "stroke", origin });
          pathStrokeTool.onPointerDown?.(ctx, origin, params);
        }
        return;
      }
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
      const draft = drafts.get(ctx.runtime);
      if (draft && (!params.creationMode || params.creationMode === "brush")) {
        const origin = { ...sample, point: draft.points.at(-1)! };
        gestures.set(ctx.runtime, { kind: "stroke", origin });
        pathStrokeTool.onPointerDown?.(ctx, origin, params);
      } else if (draft || (params.creationMode && params.creationMode !== "brush")) {
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
      else if (active?.kind === "stroke") {
        const moved = g.moved ?? gestureMoved(g.start, [...g.samples, g.current]);
        if (!moved) {
          pathStrokeTool.onCancel?.(ctx);
          const draft = drafts.get(ctx.runtime) ?? { points: [{ ...g.start.point }], params: { ...params } };
          drafts.set(ctx.runtime, draft);
          preview(ctx, draft);
          ctx.reportFeedback({ tone: "info", message: "Ponto inicial posicionado. Arraste o + para continuar a espinha; Esc cancela." });
        } else if (finishPathStroke(ctx, seededGesture(g, active.origin), params)) clearDraft(ctx);
        else { const draft = drafts.get(ctx.runtime); if (draft) preview(ctx, draft); }
      }
      else if (active?.kind === "point") {
        if (active.snapTarget && !roadSnapIsCurrent(ctx, active.snapTarget)) {
          showRoadSnap(ctx);
          throw new Error("O alvo de encaixe mudou. Aproxime o mouse novamente antes de confirmar.");
        }
        const draft = drafts.get(ctx.runtime) ?? { points: [], params: { ...params } };
        const last = draft.points.at(-1);
        const next = { ...draft, points: last && equal(last, active.point)
          ? draft.points : [...draft.points, active.point] };
        // Rust validates the authored chain before it replaces the draft. An
        // invalid click must not silently remove a point or change its height.
        if (next.points.length >= 2) curves(ctx, next.points);
        drafts.set(ctx.runtime, next);
        if (active.snapTarget && next.points.length >= 2) commitDraft(ctx, next);
        else preview(ctx, next);
      }
    });
  },
  selectionActions: (_ctx, selectedId) => (isSpineControlNodeId(selectedId) ? [{ id: "branch", label: "Ramificar pela espinha" }] : []),
  onKeyDown(ctx, key) {
    if (gestures.has(ctx.runtime)) return false;
    const draft = drafts.get(ctx.runtime);
    if (draft?.points.length) {
      if (key !== "Enter" && key !== "Backspace") return false;
      safely(ctx, () => {
        if (key === "Backspace") {
          draft.points.pop();
          if (draft.points.length) preview(ctx, draft);
          else { clearDraft(ctx); showRoadSnap(ctx); }
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
    clearDraft(ctx);
    pathStrokeTool.onCancel?.(ctx);
    showRoadSnap(ctx);
    spine.cancel(ctx);
  },
};
