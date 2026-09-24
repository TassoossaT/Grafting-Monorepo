import {
  contourCurve,
  contourGeometry,
  curvePick,
  curveSegments,
  isBezierEditTarget,
  planBezierEdit,
  planEdgeReshape,
  reshapeCurve,
  resolveCloudTopology,
  reverseGeometry,
} from "../../../../features/edit-construction/index.ts";
import type { AtomicEditOp, StructureEditParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionCurvedEdge, ConstructionEdgeGeometry, ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
import { elevationRise } from "./tool-context.ts";
import type { PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";

/**
 * One curve-handle gesture for every curve on the table.
 *
 * The handle is the same wherever the curve is kept. What differs is only how
 * the reshaped curve is committed: a spine span is a graph edge its owner
 * regenerates a surface from, so it goes through the spine edit and the
 * effect commit; a contour edge *is* the surface's boundary, so its new
 * geometry goes through the grabbed edge's role, which decides whether it may
 * curve and what reshapes with it.
 */

const CHANNEL = "curve-edit";
const PREVIEW_COLOR = 0xffbc55;

export interface CurveGesture {
  move(gesture: ToolGesture): void;
  /** `dragged` is the dispatcher's click-versus-drag decision: a click on a curve's midpoint inserts a point there. */
  commit(dragged: boolean): void;
  cancel(): void;
}

/** Where the pointer is taking the handle: along the ground, or up and down in elevation mode. */
function targetOf(sample: PointerSample, gesture: ToolGesture, params?: StructureEditParams): ConstructionPosition {
  const rise = params?.mode === "elevation" ? elevationRise(sample.screenY, gesture.current.screenY) : undefined;
  return rise !== undefined
    ? { ...sample.point, y: sample.point.y + rise }
    : { ...gesture.current.point, y: sample.point.y };
}

export function beginCurveGesture(ctx: ToolContext, sample: PointerSample, params?: StructureEditParams): CurveGesture | undefined {
  if (!sample.nodeId) return undefined;
  const snapshot = ctx.runtime.getGraphSnapshot();
  const contour = ctx.runtime.getCurvedEdges();
  if (!isBezierEditTarget(snapshot, sample.nodeId, contour)) return undefined;
  const pick = curvePick(sample.nodeId);
  const contourEdge = pick === undefined ? undefined : contour.find((edge) => edge.edgeId === pick.edgeId);
  if (pick !== undefined && contourEdge !== undefined && !snapshot.edges.some((edge) => edge.edgeId === pick.edgeId && edge.curve)) {
    return contourGesture(ctx, sample, params, contourEdge, pick.index);
  }
  return spineGesture(ctx, sample, params);
}

function spineGesture(ctx: ToolContext, sample: PointerSample, params?: StructureEditParams): CurveGesture {
  const snapshot = ctx.runtime.getGraphSnapshot();
  const targetId = sample.nodeId!;
  const operationId = `curve-edit:${ctx.nextSequence()}`;
  const topologies = ctx.runtime.getAllRegionTopologies();
  let target: ConstructionPosition = sample.point;
  const plan = (insert = false) => planBezierEdit({
    field: ctx.runtime,
    snapshot, topologies, port: ctx.runtime, targetId, position: target, operationId, tableId: ctx.tableId, insert, mode: params?.curveMode, action: params?.curveAction, width: params?.curveWidth ?? 4, endWidth: params?.curveEndWidth,
  });
  return {
    move(gesture) {
      target = targetOf(sample, gesture, params);
      try {
        const draft = plan();
        if (draft) ctx.runtime.showPreview({ kind: "segments", positions: draft.preview, color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit(moved) {
      ctx.runtime.clearPreview(CHANNEL);
      if (!moved && curvePick(targetId)?.index !== "midpoint" && (!params?.curveAction || params.curveAction === "edit")) return;
      try {
        const draft = plan(!moved && (!params?.curveAction || params.curveAction === "edit"));
        if (!draft) return;
        const { recorded } = commitPatchReplacement(ctx.runtime, draft.request, { transactionId: operationId });
        if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
        ctx.reportSelection(isBezierEditTarget(ctx.runtime.getGraphSnapshot(), draft.selectedId) ? { id: draft.selectedId, point: target } : undefined);
        ctx.reportFeedback({ tone: "success", message: params?.curveAction && params.curveAction !== "edit" ? "Curva atualizada." : moved ? "Curva atualizada." : "Ponto inserido sem alterar a curva." });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Curva preservada: ${String(error)}` });
      }
    },
    cancel() { ctx.runtime.clearPreview(CHANNEL); },
  };
}

function contourGesture(
  ctx: ToolContext,
  sample: PointerSample,
  params: StructureEditParams | undefined,
  edge: ConstructionCurvedEdge,
  index: 1 | 2 | "midpoint",
): CurveGesture {
  const original = contourCurve(edge);
  let reshaped: CubicBezier | undefined;
  return {
    move(gesture) {
      try {
        reshaped = reshapeCurve(ctx.runtime, original, index, targetOf(sample, gesture, params));
        ctx.runtime.showPreview({ kind: "segments", positions: curveSegments(ctx.runtime, reshaped), color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit() {
      ctx.runtime.clearPreview(CHANNEL);
      if (reshaped === undefined) return;
      const face = ctx.runtime.getAllRegionTopologies().find((topology) =>
        [...topology.outerLoops, ...topology.holes].some((loop) => loop.some((use) => use.edgeId === edge.edgeId)));
      const cloud = face && resolveCloudTopology(ctx.runtime, face.surfaceKey);
      if (cloud === undefined) return;
      const plan = planEdgeReshape(cloud, edge.edgeId, contourGeometry(reshaped));
      if (plan.kind !== "apply") {
        ctx.reportFeedback({ tone: "error", message: plan.reason });
        return;
      }
      const standing = new Map<string, ConstructionEdgeGeometry>();
      for (const member of cloud.members) {
        // Retype names the edge itself, so the undo keeps the geometry in the
        // edge's own direction rather than the loop's.
        for (const use of [...member.outerLoops, ...member.holes].flat()) {
          standing.set(use.edgeId, use.reversed ? reverseGeometry(use.geometry) : use.geometry);
        }
      }
      const undo: AtomicEditOp[] = plan.ops.flatMap((op) => {
        if (op.kind !== "retype-edge") return [];
        const before = standing.get(op.edgeId);
        return before === undefined ? [] : [{ kind: "retype-edge" as const, edgeId: op.edgeId, geometry: before }];
      });
      try {
        ctx.runtime.applyRegionEdit(plan.ops, "local", `curve-edit:${plan.role}`);
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Curva preservada: ${String(error)}` });
        return;
      }
      ctx.history.record({ kind: "region-edit", undo, redo: plan.ops });
      ctx.reportFeedback({ tone: "success", message: "Curva atualizada." });
    },
    cancel() { ctx.runtime.clearPreview(CHANNEL); },
  };
}
