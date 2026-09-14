import { isBezierEditTarget, planBezierEdit } from "../../../features/edit-construction/index.ts";
import type { ToolParamsFor } from "../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../ports/index.ts";
import type { PointerSample, ToolContext, ToolGesture } from "../tools/core/tool-context.ts";

const CHANNEL = "bezier-edit";
export function beginBezierGesture(ctx: ToolContext, sample: PointerSample, params?: ToolParamsFor<"edit-region">) {
  const snapshot = ctx.runtime.getGraphSnapshot();
  if (!sample.nodeId || !isBezierEditTarget(snapshot, sample.nodeId)) return undefined;
  const targetId = sample.nodeId;
  const operationId = `bezier-edit:${ctx.nextSequence()}`;
  const topologies = ctx.runtime.getAllRegionTopologies();
  let target: ConstructionPosition = sample.point;
  let moved = false;
  const plan = (insert = false) => planBezierEdit({
    snapshot, topologies, port: ctx.runtime, targetId, position: target, operationId, tableId: ctx.tableId, insert, mode: params?.curveMode, action: params?.curveAction, width: params?.curveWidth ?? 4, endWidth: params?.curveEndWidth,
  });
  return {
    move(gesture: ToolGesture) {
      target = params?.mode === "elevation" && sample.screenY !== undefined && gesture.current.screenY !== undefined
        ? { ...sample.point, y: sample.point.y + (sample.screenY - gesture.current.screenY) / 40 }
        : { ...gesture.current.point, y: sample.point.y };
      moved ||= target.x !== sample.point.x || target.y !== sample.point.y || target.z !== sample.point.z;
      try {
        const draft = plan();
        if (draft) ctx.runtime.showPreview({ kind: "segments", positions: draft.preview, color: 0xffbc55, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit() {
      ctx.runtime.clearPreview(CHANNEL);
      if (!moved && !targetId.startsWith("bezier-midpoint:") && (!params?.curveAction || params.curveAction === "edit")) return;
      try {
        const draft = plan(!moved && (!params?.curveAction || params.curveAction === "edit"));
        if (!draft) return;
        ctx.runtime.applyPatchReplacement(draft.request, "local", operationId);
        ctx.history.record({ kind: "path-brush", operationId });
        ctx.reportSelection(isBezierEditTarget(ctx.runtime.getGraphSnapshot(), draft.selectedId) ? { id: draft.selectedId, point: target } : undefined);
        ctx.reportFeedback({ tone: "success", message: params?.curveAction && params.curveAction !== "edit" ? "Rua atualizada." : moved ? "Curva atualizada." : "Ponto inserido sem alterar a curva." });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Curva preservada: ${String(error)}` });
      }
    },
    cancel() { ctx.runtime.clearPreview(CHANNEL); },
  };
}
