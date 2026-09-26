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
  curveEdgesOf,
  describeSpineChain,
  planSpineChainEdit,
  planSpineTranslate,
  prospectiveGraph,
  resolveCurves,
  reverseGeometry,
  shownSpineGlobalHandleAt,
  spineGlobalHandleOf,
  spineOwnerAt,
  structureTypeFor,
} from "../../../../features/edit-construction/index.ts";
import type { AtomicEditOp, StructureEditParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionCurvedEdge, ConstructionEdgeGeometry, ConstructionPosition, ConstructionSurfaceKey, CubicBezier } from "../../../../ports/index.ts";
import type { PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { commitSpineRegeneration, regenerateSpine } from "./spine-commit.ts";

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

/**
 * How a dragged spine anchor snaps onto something else -- a road onto another
 * road's node or span, say -- and how the snap is shown. A tool supplies its
 * own; the gesture only asks it.
 */
export interface AnchorSnap {
  find(ctx: ToolContext, sample: PointerSample, excludeNodeId?: string): PointerSample | undefined;
  /** Shows `target` as the snap, or clears it when absent. */
  show(ctx: ToolContext, target?: PointerSample): void;
}

export type CurveGestureOptions = StructureEditParams & {
  /** How a dragged anchor snaps; absent, it never does. */
  readonly snap?: AnchorSnap;
  /** A scene manipulator supplies an authoritative XYZ target, unlike a ground pointer. */
  readonly spatialTarget?: boolean;
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
  if (params?.spatialTarget) return gesture.current.point;
  if (params?.mode === "elevation" && sample.screenY !== undefined && gesture.current.screenY !== undefined) {
    return { ...sample.point, y: sample.point.y + (sample.screenY - gesture.current.screenY) / 40 };
  }
  const pick = sample.nodeId ? curvePick(sample.nodeId) : undefined;
  const isTangentHandle = pick !== undefined && pick.index !== "midpoint";
  const y = isTangentHandle ? sample.point.y : gesture.current.point.y;
  if (params?.pointerOrigin) {
    return {
      x: sample.point.x + gesture.current.point.x - params.pointerOrigin.x,
      y,
      z: sample.point.z + gesture.current.point.z - params.pointerOrigin.z,
    };
  }
  return { ...gesture.current.point, y };
}

/** Starts a curve gesture on the handle `sample` landed on, when the curve belongs to a type `ownsType` accepts. */
export function beginCurveGesture(
  ctx: ToolContext,
  sample: PointerSample,
  ownsTypeOrParams?: ((surfaceType: string) => boolean) | CurveGestureOptions,
  params?: CurveGestureOptions,
): CurveGesture | undefined {
  const ownsType = typeof ownsTypeOrParams === "function" ? ownsTypeOrParams : () => true;
  const actualParams = typeof ownsTypeOrParams === "function" ? params : ownsTypeOrParams;
  if (!sample.nodeId) return undefined;
  const snapshot = ctx.runtime.getGraphSnapshot();
  if (spineGlobalHandleOf(sample.nodeId)) {
    const owner = shownSpineGlobalHandleAt(snapshot, sample.nodeId)?.owner;
    return owner !== undefined && ownsType(owner) ? globalHandleGesture(ctx, sample, actualParams) : undefined;
  }
  const contour = ctx.runtime.getCurvedEdges();
  if (!isBezierEditTarget(snapshot, sample.nodeId, contour)) return undefined;
  const pick = curvePick(sample.nodeId);
  const contourEdge = pick === undefined ? undefined : contour.find((edge) => edge.edgeId === pick.edgeId);
  if (pick !== undefined && contourEdge !== undefined && !snapshot.edges.some((edge) => edge.edgeId === pick.edgeId && edge.curve)) {
    const face = ctx.runtime.getAllRegionTopologies().find((topology) => ownsType(topology.surfaceType)
      && [...topology.outerLoops, ...topology.holes].some((loop) => loop.some((use) => use.edgeId === contourEdge.edgeId)));
    return face === undefined ? undefined : contourGesture(ctx, sample, actualParams, contourEdge, pick.index, face.surfaceKey);
  }
  const owner = spineOwnerAt(snapshot, pick?.edgeId ?? sample.nodeId);
  return owner !== undefined && ownsType(owner) ? spineGesture(ctx, sample, actualParams, structureTypeFor(owner)?.spine?.planOnly === true) : undefined;
}

function spineGesture(ctx: ToolContext, sample: PointerSample, params: CurveGestureOptions | undefined, planOnly: boolean): CurveGesture {
  const snapshot = ctx.runtime.getGraphSnapshot();
  const targetId = sample.nodeId!;
  const operationId = `curve-edit:${ctx.nextSequence()}`;
  const topologies = ctx.runtime.getAllRegionTopologies();
  let target: ConstructionPosition = sample.point;
  let moved = false;
  let dragged = false;
  let ended = false;
  let lastRenderedTarget: ConstructionPosition | undefined;
  const pick = curvePick(targetId);
  const isWidthDrag = params?.curveAction === "width";
  let currentWidth = params?.curveWidth ?? 4;
  let resolvedCurve: CubicBezier | undefined;

  if (isWidthDrag && pick) {
    const edge = snapshot.edges.find((e) => e.edgeId === pick.edgeId);
    if (edge && edge.curve) {
      const startPos = snapshot.nodes.find((n) => n.id === edge.startNodeId)?.position;
      const endPos = snapshot.nodes.find((n) => n.id === edge.endNodeId)?.position;
      if (startPos && endPos) {
        const res = resolveCurves(ctx.runtime, [{ handles: edge.curve, start: startPos, end: endPos }], 0.025)[0];
        resolvedCurve = res?.curves[0];
      }
    }
  }

  const input = (insert = false) => ({
    field: ctx.runtime,
    snapshot,
    topologies,
    port: ctx.runtime,
    targetId,
    position: target,
    operationId,
    tableId: ctx.tableId,
    insert,
    allowShapeChange: params?.allowShapeChange,
    parameter: params?.parameter,
    mode: params?.curveMode,
    action: isWidthDrag ? ("width" as const) : params?.curveAction,
    width: currentWidth,
    endWidth: params?.curveEndWidth,
  });

  return {
    move(gesture) {
      if (ended) return;
      if (!dragged && !crossedThreshold(sample, gesture, params)) return;
      target = targetOf(sample, gesture, params);
      // A plan-only spine's heights are its owner's: a pointer on the ground
      // never lends its height. The scene manipulator's vertical arrow and
      // elevation mode move it on purpose.
      if (planOnly && params?.mode !== "elevation" && !params?.spatialTarget) target = { ...target, y: sample.point.y };
      if (!curvePick(targetId) && !planOnly && params?.snap) {
        const snap = params.snap.find(ctx, { point: target }, targetId);
        if (snap) target = snap.point;
        params.snap.show(ctx, snap);
      }
      moved = target.x !== sample.point.x || target.y !== sample.point.y || target.z !== sample.point.z;
      dragged ||= moved;
      if (lastRenderedTarget &&
          Math.hypot(target.x - lastRenderedTarget.x, target.z - lastRenderedTarget.z) < 0.015 &&
          Math.abs(target.y - lastRenderedTarget.y) < 0.015) {
        return;
      }
      lastRenderedTarget = { ...target };

      if (isWidthDrag && resolvedCurve) {
        const near = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "nearest", curve: resolvedCurve, point: [target.x, target.y, target.z] }] })[0];
        if (near && near.parameter !== null && near.parameter !== undefined) {
          const t = Math.max(0.000001, Math.min(0.999999, near.parameter));
          const ev = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "split", curve: resolvedCurve, t }] })[0];
          const pt = ev?.curves[0]?.points[3];
          if (pt) {
            const dist = Math.hypot(target.x - pt[0], target.z - pt[2]);
            currentWidth = Math.max(0.5, Math.round(dist * 2 * 4) / 4);
          }
        }
      }

      try {
        if (isWidthDrag && resolvedCurve) {
          const ribbon = ctx.runtime.curveBatch({
            tolerance: 0.05,
            commands: [{ kind: "ribbon", curve: resolvedCurve, offsets: [-currentWidth / 2, currentWidth / 2] as const }],
          })[0]?.ribbon;
          if (ribbon && ribbon.outer.length >= 2) {
            const positions: number[] = [];
            for (let i = 0; i < ribbon.outer.length; i++) {
              const a = ribbon.outer[i]!;
              const b = ribbon.outer[(i + 1) % ribbon.outer.length]!;
              positions.push(a[0], a[1] + 0.05, a[2], b[0], b[1] + 0.05, b[2]);
            }
            ctx.runtime.showPreview({ kind: "segments", positions: Float32Array.from(positions), color: PREVIEW_COLOR, opacity: 0.95 }, CHANNEL);
          }
        } else {
          const draft = previewBezierEdit(input());
          if (draft) ctx.runtime.showPreview({ kind: "segments", positions: draft, color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
        }
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit() {
      if (ended) return;
      ended = true;
      params?.snap?.show(ctx);
      ctx.runtime.clearPreview(CHANNEL);
      if (dragged && !moved) return;
      if (!dragged && params?.insertOnClick === false) return;
      if (!moved && curvePick(targetId)?.index !== "midpoint" && (!params?.curveAction || params.curveAction === "edit")) return;
      try {
        const draft = planBezierEdit(input(!moved && (!params?.curveAction || params.curveAction === "edit")));
        if (!draft) return;
        commitSpineRegeneration(ctx, draft.request, operationId);
        ctx.reportSelection(isBezierEditTarget(ctx.runtime.getGraphSnapshot(), draft.selectedId) ? { id: draft.selectedId, point: target } : undefined);
        const msg = isWidthDrag
          ? `Largura ajustada para ${currentWidth.toFixed(2)}m.`
          : params?.curveAction && params.curveAction !== "edit"
          ? "Curva atualizada."
          : moved
          ? "Curva atualizada."
          : "Ponto inserido sem alterar a curva.";
        ctx.reportFeedback({ tone: "success", message: msg });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Curva preservada: ${String(error)}` });
      }
    },
    cancel() { ended = true; params?.snap?.show(ctx); ctx.runtime.clearPreview(CHANNEL); },
  };
}

/**
 * A spine's global handles (`spine-global-handles.ts`), one gesture for all
 * of them. Each plans a spine graph patch, and the spine's owner
 * regenerates from it -- previewed while dragging, committed on release:
 *
 * - pivot: moves the whole spine along the ground, up and down in
 *   elevation mode, or anywhere with the scene manipulator;
 * - height: dragged up or down, sets the far end's height;
 * - turns: dragged round a spiral's centre, winds it on in its own direction
 *   or back the other way, keeping what its owner's `windKeeps` says.
 */
function globalHandleGesture(ctx: ToolContext, sample: PointerSample, params?: CurveGestureOptions): CurveGesture | undefined {
  const snapshot = ctx.runtime.getGraphSnapshot();
  const handle = shownSpineGlobalHandleAt(snapshot, sample.nodeId!);
  if (!handle) return undefined;
  const operationId = `spine-${handle.kind}:${ctx.nextSequence()}`;
  const far = handle.ends && snapshot.nodes.find((node) => node.id === handle.ends![1])!.position;
  const shape = handle.kind === "turns" ? describeSpineChain(snapshot, handle.id) : undefined;
  const keeps = structureTypeFor(handle.owner!)?.spine?.windKeeps ?? "grade";
  let lastAngle = handle.center && Math.atan2(handle.position.z - handle.center[1], handle.position.x - handle.center[0]);
  let wound = 0;
  let patch: import("../../../../ports/index.ts").ConstructionGraphPatch | undefined;
  let ended = false;

  function planned(gesture: ToolGesture) {
    const target = targetOf({ ...sample, point: handle!.position }, gesture, params);
    if (handle!.kind === "pivot") {
      // Along the ground the spine keeps its heights; they change on purpose only.
      const y = params?.spatialTarget || params?.mode === "elevation" ? target.y : handle!.position.y;
      return planSpineTranslate(snapshot, handle!, { x: target.x - handle!.position.x, y: y - handle!.position.y, z: target.z - handle!.position.z });
    }
    if (handle!.kind === "height" && far) {
      const y = params?.spatialTarget
        ? gesture.current.point.y - (handle!.position.y - far.y)
        : sample.screenY !== undefined && gesture.current.screenY !== undefined
          ? far.y + (sample.screenY - gesture.current.screenY) / 40
          : gesture.current.point.y;
      ctx.reportFeedback({ tone: "info", message: `altura do fim ${y.toFixed(2)} m` });
      return { nodes: [{ id: handle!.ends![1], position: { ...far, y } }], edges: [] };
    }
    if (handle!.kind !== "turns" || !shape?.spiral || !handle!.center) return undefined;
    const [cx, cz] = handle!.center;
    const angle = Math.atan2(gesture.current.point.z - cz, gesture.current.point.x - cx);
    let step = angle - lastAngle!;
    while (step > Math.PI) step -= 2 * Math.PI;
    while (step <= -Math.PI) step += 2 * Math.PI;
    wound += step;
    lastAngle = angle;
    // Round the way the spiral already turns winds it on; the other way, back.
    const turns = Math.max(0.05, shape.spiral.turns + (shape.spiral.positive ? wound : -wound) / (2 * Math.PI));
    const endHeight = keeps === "height" ? shape.endHeight : shape.startHeight + ((shape.endHeight - shape.startHeight) * turns) / shape.spiral.turns;
    ctx.reportFeedback({ tone: "info", message: `voltas ${turns.toFixed(2)} · altura do fim ${endHeight.toFixed(2)} m` });
    return planSpineChainEdit(snapshot, ctx.runtime, handle!.id, { ...shape, endHeight, spiral: { ...shape.spiral, turns } }, operationId);
  }

  return {
    move(gesture) {
      if (ended || !crossedThreshold(sample, gesture, params)) return;
      try {
        patch = planned(gesture);
        const preview = patch && regenerateSpine(ctx, snapshot, handle.owner, patch, operationId)?.preview;
        if (preview) ctx.runtime.showPreview({ kind: "segments", positions: preview, color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: String(error) });
      }
    },
    commit() {
      if (ended) return;
      ended = true;
      ctx.runtime.clearPreview(CHANNEL);
      if (!patch) return;
      try {
        const regenerated = regenerateSpine(ctx, snapshot, handle.owner, patch, operationId);
        if (!regenerated) return;
        commitSpineRegeneration(ctx, regenerated.request, operationId);
        const moved = shownSpineGlobalHandleAt(ctx.runtime.getGraphSnapshot(), handle.id);
        ctx.reportSelection(moved ? { id: moved.id, point: moved.position } : undefined);
        ctx.reportFeedback({ tone: "success", message: handle.kind === "pivot" ? "Estrutura movida." : handle.kind === "turns" ? "Voltas atualizadas." : "Altura atualizada." });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Estrutura preservada: ${String(error)}` });
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
  faceKey: ConstructionSurfaceKey,
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
      const cloud = resolveCloudTopology(ctx.runtime, faceKey);
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
