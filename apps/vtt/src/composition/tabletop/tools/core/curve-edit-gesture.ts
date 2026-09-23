import {
  contourCurve,
  contourGeometry,
  curvePick,
  curveSegments,
  isBezierEditTarget,
  planBezierEdit,
  previewBezierEdit,
  planEdgeReshape,
  reshapeCurve,
  resolveCloudTopology,
  reverseGeometry,
} from "../../../../features/edit-construction/index.ts";
import type { AtomicEditOp, ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionCurvedEdge, ConstructionEdgeGeometry, ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
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
  commit(): void;
  cancel(): void;
}

export type CurveGestureOptions = ToolParamsFor<"edit-region"> & {
  readonly parameter?: number;
  readonly allowShapeChange?: boolean;
  readonly insertOnClick?: boolean;
  readonly pointerOrigin?: ConstructionPosition;
  readonly dragThreshold?: number;
};
function crossedThreshold(sample: PointerSample, gesture: ToolGesture, params?: CurveGestureOptions): boolean {
  if (!params?.dragThreshold) return true;
  if (sample.screenX !== undefined && sample.screenY !== undefined && gesture.current.screenX !== undefined && gesture.current.screenY !== undefined)
    return Math.hypot(gesture.current.screenX-sample.screenX,gesture.current.screenY-sample.screenY)>=params.dragThreshold;
  const origin=params.pointerOrigin??sample.point;
  return Math.hypot(gesture.current.point.x-origin.x,gesture.current.point.z-origin.z)>=0.05;
}

/** Where the pointer is taking the handle: along the ground, or up and down in elevation mode. */
function targetOf(sample: PointerSample, gesture: ToolGesture, params?: CurveGestureOptions): ConstructionPosition {
  return params?.mode === "elevation" && sample.screenY !== undefined && gesture.current.screenY !== undefined
    ? { ...sample.point, y: sample.point.y + (sample.screenY - gesture.current.screenY) / 40 }
    : params?.pointerOrigin
      ? {x:sample.point.x+gesture.current.point.x-params.pointerOrigin.x,y:sample.point.y,z:sample.point.z+gesture.current.point.z-params.pointerOrigin.z}
      : { ...gesture.current.point, y: sample.point.y };
}

export function beginCurveGesture(ctx: ToolContext, sample: PointerSample, params?: CurveGestureOptions): CurveGesture | undefined {
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

function spineGesture(ctx: ToolContext, sample: PointerSample, params?: CurveGestureOptions): CurveGesture {
  const snapshot = ctx.runtime.getGraphSnapshot();
  const targetId = sample.nodeId!;
  const operationId = `curve-edit:${ctx.nextSequence()}`;
  const topologies = ctx.runtime.getAllRegionTopologies();
  let target: ConstructionPosition = sample.point;
  let moved = false;
  let dragged = false;
  let ended = false;
  const input = (insert = false) => ({
    field: ctx.runtime,
    snapshot, topologies, port: ctx.runtime, targetId, position: target, operationId, tableId: ctx.tableId, insert, allowShapeChange: params?.allowShapeChange, parameter: params?.parameter, mode: params?.curveMode, action: params?.curveAction, width: params?.curveWidth ?? 4, endWidth: params?.curveEndWidth,
  });
  return {
    move(gesture) {
      if (ended) return;
      if (!dragged && !crossedThreshold(sample, gesture, params)) return;
      target = targetOf(sample, gesture, params);
      moved = target.x !== sample.point.x || target.y !== sample.point.y || target.z !== sample.point.z;
      dragged ||= moved;
      try {
        const draft = previewBezierEdit(input());
        if (draft) ctx.runtime.showPreview({ kind: "segments", positions: draft, color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit() {
      if (ended) return;
      ended = true;
      ctx.runtime.clearPreview(CHANNEL);
      if (dragged && !moved) return;
      if (!dragged && params?.insertOnClick === false) return;
      if (!moved && curvePick(targetId)?.index !== "midpoint" && (!params?.curveAction || params.curveAction === "edit")) return;
      try {
        const draft = planBezierEdit(input(!moved && (!params?.curveAction || params.curveAction === "edit")));
        if (!draft) return;
        const { recorded } = commitPatchReplacement(ctx.runtime, draft.request, { transactionId: operationId });
        if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
        ctx.reportSelection(isBezierEditTarget(ctx.runtime.getGraphSnapshot(), draft.selectedId) ? { id: draft.selectedId, point: target } : undefined);
        ctx.reportFeedback({ tone: "success", message: params?.curveAction && params.curveAction !== "edit" ? "Curva atualizada." : moved ? "Curva atualizada." : "Ponto inserido sem alterar a curva." });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Curva preservada: ${String(error)}` });
      }
    },
    cancel() { ended = true; ctx.runtime.clearPreview(CHANNEL); },
  };
}

function contourGesture(
  ctx: ToolContext,
  sample: PointerSample,
  params: CurveGestureOptions | undefined,
  edge: ConstructionCurvedEdge,
  index: 1 | 2 | "midpoint",
): CurveGesture {
  const original = contourCurve(edge);
  let reshaped: CubicBezier | undefined;
  let ended = false;
  return {
    move(gesture) {
      if (ended) return;
      reshaped = undefined;
      const target = targetOf(sample, gesture, params);
      if (target.x === sample.point.x && target.y === sample.point.y && target.z === sample.point.z) {
        ctx.runtime.clearPreview(CHANNEL);
        return;
      }
      try {
        reshaped = reshapeCurve(ctx.runtime, original, index, target);
        ctx.runtime.showPreview({ kind: "segments", positions: curveSegments(ctx.runtime, reshaped), color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit() {
      if (ended) return;
      ended = true;
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
    cancel() { ended = true; reshaped = undefined; ctx.runtime.clearPreview(CHANNEL); },
  };
}
