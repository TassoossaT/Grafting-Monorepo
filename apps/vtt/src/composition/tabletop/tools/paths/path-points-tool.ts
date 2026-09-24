import { createPathBrushEffect, pathFormationFor, DEFAULT_TOOL_PARAMS, curvePick, structureTypeFor } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ConstructionTool, type ToolContext, type PointerSample, type ToolGesture } from "../core/tool-context.ts";
import { beginCurveGesture, type CurveGesture, type CurveGestureOptions } from "../core/curve-edit-gesture.ts";
import { pathStrokeTool } from "./path-stroke-tool.ts";
import { roadBodyTarget, roadSnapTarget, showRoadSnap } from "./road-body-target.ts";

const CHANNEL = "road-points";
const xyz = (p: ConstructionPosition) => [p.x, p.y, p.z] as const;
const equal = (a: ConstructionPosition, b: ConstructionPosition) => a.x === b.x && a.y === b.y && a.z === b.z;
type Draft = { points: ConstructionPosition[]; params: PathBrushParams };
type Gesture = { kind: "edit"; edit: CurveGesture } | { kind: "stroke"; origin?: PointerSample } | { kind: "point"; point: ConstructionPosition } | { kind: "selection" };
const drafts = new WeakMap<ToolContext["runtime"], Draft>();
const gestures = new WeakMap<ToolContext["runtime"], Gesture>();
const selections = new WeakMap<ToolContext["runtime"], string>();

function seededGesture(gesture: ToolGesture, origin?: PointerSample): ToolGesture {
  return origin ? { ...gesture, start: origin, samples: [origin, ...gesture.samples.slice(1)] } : gesture;
}

function curves(ctx: ToolContext, points: readonly ConstructionPosition[]): readonly CubicBezier[] {
  return ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "automatic", points: points.map(xyz) }] })[0]!.curves;
}
function preview(ctx: ToolContext, draft: Draft, cursor?: ConstructionPosition): void {
  const points = cursor && !equal(cursor, draft.points.at(-1)!) ? [...draft.points, cursor] : draft.points;
  const lines: number[] = [];
  let color = 0x4ade80;
  try {
    if (points.length > 1) {
      const path = curves(ctx, points);
      const sampled = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "sample", curves: path }] })[0]!;
      for (const span of sampled.samples) for (let i = 1; i < span.length; i++) lines.push(...span[i - 1]!.position, ...span[i]!.position);
      const ribbons = ctx.runtime.curveBatch({ tolerance: 0.05, commands: path.map(curve => ({ kind: "ribbon" as const, curve, offsets: [-draft.params.bedWidth / 2, draft.params.bedWidth / 2] as const })) });
      for (const ribbon of ribbons) {
        const outline = ribbon.ribbon!.outer;
        for (let i = 0; i < outline.length; i++) lines.push(...outline[i]!, ...outline[(i + 1) % outline.length]!);
      }
    }
  } catch {
    color = 0xf87171;
    lines.length = 0;
    for (let i = 1; i < points.length; i++) lines.push(...xyz(points[i - 1]!), ...xyz(points[i]!));
  }
  for (const p of draft.points) lines.push(p.x - 0.12, p.y + 0.02, p.z, p.x + 0.12, p.y + 0.02, p.z, p.x, p.y + 0.02, p.z - 0.12, p.x, p.y + 0.02, p.z + 0.12);
  ctx.runtime.showPreview({ kind: "segments", positions: Float32Array.from(lines), color, opacity: 0.95 }, CHANNEL);
}
function safely(ctx: ToolContext, work: () => void): void {
  try { work(); } catch (error) {
    const active = gestures.get(ctx.runtime);
    if (active?.kind === "edit") active.edit.cancel();
    gestures.delete(ctx.runtime);
    pathStrokeTool.onCancel?.(ctx);
    ctx.reportFeedback({ tone: "error", message: `Caminho preservado: ${String(error)}` });
  }
}
function select(ctx: ToolContext, sample?: PointerSample): void {
  if (sample?.nodeId) selections.set(ctx.runtime, sample.nodeId); else selections.delete(ctx.runtime);
  ctx.reportSelection(sample?.nodeId ? { id: sample.nodeId, point: sample.point } : undefined);
}
function beginEdit(ctx: ToolContext, sample: PointerSample, options: CurveGestureOptions) {
  return beginCurveGesture({ ...ctx, reportSelection(info) {
    if (info) selections.set(ctx.runtime, info.id); else selections.delete(ctx.runtime);
    ctx.reportSelection(info);
  } }, sample, options);
}
function editTarget(ctx: ToolContext, sample: PointerSample): PointerSample | undefined {
  if (!sample.nodeId) return;
  const graph = ctx.runtime.getGraphSnapshot();
  const edges = graph.edges.filter(e => e.curve?.surfaceType && structureTypeFor(e.curve.surfaceType)?.spine);
  const pick = curvePick(sample.nodeId);
  if (pick) {
    if (pick.index !== "midpoint") return;
    const edge = edges.find(e => e.edgeId === pick.edgeId);
    if (!edge) return;
    const a = graph.nodes.find(n => n.id === edge.startNodeId)!;
    const b = graph.nodes.find(n => n.id === edge.endNodeId)!;
    const resolved = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "resolve", handles: edge.curve!, start: xyz(a.position), end: xyz(b.position) }] })[0]!;
    const p = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "split", curve: resolved.curves[0]!, t: 0.5 }] })[0]!.curves[0]!.points[3];
    return { ...sample, point: { x: p[0], y: p[1], z: p[2] } };
  }
  if (!edges.some(e => e.startNodeId === sample.nodeId || e.endNodeId === sample.nodeId)) return;
  const node = graph.nodes.find(n => n.id === sample.nodeId);
  return node && { ...sample, point: node.position };
}

function startBranch(ctx: ToolContext, id: string | undefined, params: PathBrushParams): boolean {

    const node = ctx.runtime.getGraphSnapshot().nodes.find(n => n.id === id);
    if (!node || !editTarget(ctx, { nodeId: node.id, point: node.position })) return false;
    const draft: Draft = { points: [{ ...node.position }], params: { ...params, creationMode: "points" } };
    drafts.set(ctx.runtime, draft);
    select(ctx);
    preview(ctx, draft);
    ctx.reportFeedback({ tone: "info", message: "Posicione a nova rua com o mouse. Clique para adicionar pontos; Enter confirma e Esc cancela." });
    return true;
}

/** A road is drawn freely or through explicit points, and edited by its spine points. */
export const pathPointsTool: ConstructionTool<"path-brush"> = {
  id: "path-brush",
  handlePresentation: "spine-points",
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
      if (drafts.has(ctx.runtime)) sample = roadSnapTarget(ctx, sample) ?? sample;
      if (!drafts.get(ctx.runtime)?.points.length) {
        const target = editTarget(ctx, sample);
        const body = target ? undefined : roadBodyTarget(ctx, sample);
        const origin = target ?? body?.sample;
        if (sample.shiftKey && origin) {
          select(ctx);
          if (drafts.has(ctx.runtime) || (params.creationMode && params.creationMode !== "brush")) {
            gestures.set(ctx.runtime, { kind: "point", point: { ...origin.point } });
          } else {
            gestures.set(ctx.runtime, { kind: "stroke", origin });
            pathStrokeTool.onPointerDown?.(ctx, origin, params);
          }
          return;
        }
        if (target) {
          select(ctx, target);
          const midpoint = curvePick(target.nodeId!)?.index === "midpoint";
          if (midpoint) {
            const edit = beginEdit(ctx, target, { mode: "shape", curveMode: "free", insertOnClick: true, dragThreshold: 5, pointerOrigin: sample.point });
            if (edit) gestures.set(ctx.runtime, { kind: "edit", edit });
          } else {
            const edit = beginEdit(ctx, target, { mode: "shape", insertOnClick: false, dragThreshold: 5, pointerOrigin: sample.point });
            if (edit) gestures.set(ctx.runtime, { kind: "edit", edit });
          }
          return;
        }
        if (body) {
          select(ctx, body.sample);
          const edit = beginEdit(ctx, body.sample, { ...body.options, curveMode: "free", insertOnClick: curvePick(body.sample.nodeId!)?.index === "midpoint" });
          if (edit) gestures.set(ctx.runtime, { kind: "edit", edit });
          return;
        }
        if (sample.nodeId && curvePick(sample.nodeId)) {
          select(ctx);
          gestures.set(ctx.runtime, { kind: "selection" });
          return;
        }
        select(ctx);
      }
      if (drafts.has(ctx.runtime) || (params.creationMode && params.creationMode !== "brush")) {
        gestures.set(ctx.runtime, { kind: "point", point: { ...sample.point } });
      } else {
        gestures.set(ctx.runtime, { kind: "stroke" });
        pathStrokeTool.onPointerDown?.(ctx, sample, params);
      }
    });
  },
  onPointerMove(ctx, g, params) {
    safely(ctx, () => {
      const active = gestures.get(ctx.runtime);
      if (active?.kind === "edit") active.edit.move(g);
      else if (active?.kind === "stroke") pathStrokeTool.onPointerMove?.(ctx, seededGesture(g, active.origin), params);
      else if (active?.kind === "point") {
        const draft = drafts.get(ctx.runtime);
        if (draft?.points.length) {
          const target = roadSnapTarget(ctx, g.current);
          showRoadSnap(ctx, target);
          preview(ctx, draft, target?.point ?? g.current.point);
        }
      }
    });
  },
  onPointerUp(ctx, g, params) {
    safely(ctx, () => {
      const active = gestures.get(ctx.runtime);
      gestures.delete(ctx.runtime);
      if (active?.kind === "edit") { active.edit.move(g); active.edit.commit(); }
      else if (active?.kind === "stroke") pathStrokeTool.onPointerUp?.(ctx, seededGesture(g, active.origin), params);
      else if (active?.kind === "point") {
        const draft = drafts.get(ctx.runtime) ?? { points: [], params: { ...params } };
        if (!draft.points.length || !equal(draft.points.at(-1)!, active.point)) draft.points.push(active.point);
        drafts.set(ctx.runtime, draft);
        preview(ctx, draft);
      }
    });
  },
  onSelectionAction(ctx, action, params) {
    if (action !== "branch" || gestures.has(ctx.runtime) || drafts.has(ctx.runtime)) return false;
    return startBranch(ctx, selections.get(ctx.runtime), params);
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
          const operationId = scopedToolId(ctx, "road-points", ctx.nextSequence());
          const effect = createPathBrushEffect({
            brushShape: { kind: "circle", radius: 0.025 }, brushRegion: { samples: draft.points },
            authoredCurves: curves(ctx, draft.points), curveMode: "automatic", parameters: pathFormationFor(draft.params),
          }, { operationId, tableId: ctx.tableId, initiatedBy: "road-points" });
          if (commitPathCloudIntent(ctx, effect, 0.025)) {
            drafts.delete(ctx.runtime);
            ctx.runtime.clearPreview(CHANNEL);
            showRoadSnap(ctx);
          }
        }
      });
      return true;
    }
    const id = selections.get(ctx.runtime);
    if (!id || (key !== "Delete" && key !== "Backspace")) return false;
    const node = ctx.runtime.getGraphSnapshot().nodes.find(n => n.id === id);
    if (!node) { select(ctx); return false; }
    safely(ctx, () => {
      beginEdit(ctx, { nodeId: id, point: node.position }, { mode: "shape", curveAction: "remove-anchor", allowShapeChange: true })?.commit();
      select(ctx);
    });
    return true;
  },
  onCancel(ctx) {
    const active = gestures.get(ctx.runtime);
    if (active?.kind === "edit") active.edit.cancel();
    gestures.delete(ctx.runtime);
    drafts.delete(ctx.runtime);
    selections.delete(ctx.runtime);
    pathStrokeTool.onCancel?.(ctx);
    ctx.runtime.clearPreview(CHANNEL);
    showRoadSnap(ctx);
    select(ctx);
  },
};
