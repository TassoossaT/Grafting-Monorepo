import {
  globalHandleActions,
  planEdit,
  planGlobalHandle,
  resolveCloudTopology,
  shownGlobalHandleAt,
  type AtomicEditOp,
  type GlobalHandle,
  type GlobalHandleEdit,
  type GlobalHandleIntent,
  type GlobalHandleKind,
  type GlobalHandleScene,
} from "../../../../features/edit-construction/index.ts";
import type { ApplyPatchReplacementRequest, ConstructionEdgeGeometry, ConstructionPosition } from "../../../../ports/index.ts";
import type { CurveGesture, CurveGestureOptions } from "./curve-edit-gesture.ts";
import { commitSpineRegeneration, regenerateSpine } from "./spine-commit.ts";
import { createConstrainedDrag } from "./constrained-drag.ts";
import { floorsOf, floorUnder } from "./floor-landing.ts";
import { commitPatchReplacement, commitRegionEdit } from "../../effects/effect-commit.ts";
import type { PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

const CHANNEL = "global-handle";
const PREVIEW_COLOR = 0xffbc55;

/** What each global handle reports once its edit is committed. */
const DONE: Readonly<Record<GlobalHandleKind, string>> = {
  pivot: "Estrutura movida.", rotate: "Estrutura girada.", height: "Altura atualizada.", turns: "Voltas atualizadas.",
  origin: "Ponta movida.", destination: "Ponta movida.",
};

function sceneOf(ctx: ToolContext): GlobalHandleScene {
  return { graph: ctx.runtime.getGraphSnapshot(), topologies: ctx.runtime.getAllRegionTopologies(), cloudFor: (request) => ctx.runtime.cloudFor(request) };
}

/** The live position of every node an edit moves -- what its outline preview is drawn with. */
function movedPositions(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene): ReadonlyMap<string, ConstructionPosition> {
  if (edit.kind === "vertices") return new Map(edit.moves.map((move) => [move.nodeId, move.position]));
  if (edit.kind !== "region-move") return new Map();
  const positions = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  return new Map(handle.nodeIds.map((id) => {
    const p = positions.get(id)!;
    return [id, { x: p.x + edit.delta.x, y: p.y + edit.delta.y, z: p.z + edit.delta.z }] as const;
  }));
}

/** The outline of every face a replacement puts in place. */
function replacementOutline(request: ApplyPatchReplacementRequest): Float32Array {
  const positions = new Map(request.patch.nodes.map((node) => [node.id, node.position]));
  const edges = new Map(request.patch.edges.map((edge) => [edge.edgeId, edge]));
  const segments: number[] = [];
  for (const use of request.patch.regions.flatMap((region) => [region.boundary, ...(region.holes ?? [])]).flat()) {
    const edge = edges.get(use.edgeId);
    const a = edge && positions.get(edge.startNodeId), b = edge && positions.get(edge.endNodeId);
    if (a && b) segments.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
  }
  return Float32Array.from(segments);
}

/** An edit's preview: the owner's regenerated spine, the faces a replacement puts in place, or the moved outline of the structure's faces. */
function previewOf(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene, operationId: string): Float32Array | undefined {
  if (edit.kind === "spine") {
    const spine = regenerateSpine(ctx, scene.graph, edit.owner, edit.graphPatch, operationId, { keepsWelds: edit.carries !== undefined })?.preview;
    if (!spine || !edit.carries?.length) return spine;
    // The floors it carries, where they will stand.
    const moved = new Map(edit.graphPatch.nodes.map((node) => [node.id, node.position]));
    const carried = new Set(edit.carries.map((key) => key.join("\u0000")));
    const segments = [...spine];
    for (const topology of scene.topologies.filter((candidate) => carried.has(candidate.surfaceKey.join("\u0000")))) {
      const at = (id: string) => moved.get(id) ?? topology.nodes.find((node) => node.id === id)!.position;
      for (const use of topology.outerLoops.flat()) {
        const a = at(use.startNodeId), b = at(use.endNodeId);
        segments.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
      }
    }
    return Float32Array.from(segments);
  }
  if (edit.kind === "replace") return replacementOutline(edit.request);
  const moved = movedPositions(ctx, handle, edit, scene);
  // Every face the edit moves a node of -- more than the handle's own structure when it carries what is joined to it.
  const nodes = new Set([...handle.nodeIds, ...moved.keys()]);
  const segments: number[] = [];
  for (const topology of scene.topologies) {
    if (!topology.nodes.some((node) => nodes.has(node.id))) continue;
    const standing = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      const a = moved.get(use.startNodeId) ?? standing.get(use.startNodeId), b = moved.get(use.endNodeId) ?? standing.get(use.endNodeId);
      if (a && b) segments.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
    }
  }
  return Float32Array.from(segments);
}

/** Applies `ops` as one transaction, so what the edit reaches -- the ground a grounded platform cuts -- answers with it, and undo takes both back. */
function applyRecorded(ctx: ToolContext, ops: readonly AtomicEditOp[], label: string): void {
  const transactionId = `${label}:${ctx.nextSequence()}`;
  const { recorded } = commitRegionEdit(ctx.runtime, ops, { transactionId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId });
}

/** Carries out `edit`: a spine regenerated by its owner, a cloud moved through its own role, or placed nodes. */
function commitEdit(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene, operationId: string): void {
  if (edit.kind === "spine") {
    const regenerated = regenerateSpine(ctx, scene.graph, edit.owner, edit.graphPatch, operationId, { keepsWelds: edit.carries !== undefined });
    if (regenerated) commitSpineRegeneration(ctx, regenerated.request, operationId, edit.carries);
    return;
  }
  if (edit.kind === "replace") {
    const { recorded } = commitPatchReplacement(ctx.runtime, edit.request, { transactionId: operationId });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    return;
  }
  if (edit.kind === "region-move") {
    const cloud = resolveCloudTopology(ctx.runtime, edit.seed);
    if (!cloud) return;
    const plan = planEdit(cloud, { surfaceKey: edit.seed, target: { kind: "region" }, delta: edit.delta }, scene.graph, ctx.runtime);
    if (plan.kind !== "apply") throw new Error(plan.reason);
    applyRecorded(ctx, plan.ops, `global-handle:${handle.kind}`);
    return;
  }
  applyRecorded(ctx, [
    ...edit.moves.map((move) => ({ kind: "move-vertex" as const, nodeId: move.nodeId, position: move.position })),
    ...edit.retypes.map((retype) => ({ kind: "retype-edge" as const, edgeId: retype.edgeId, geometry: retype.geometry })),
  ], `global-handle:${handle.kind}`);
}

/**
 * Drags any global handle of any structure (`global-handles/`). The gesture
 * only turns the pointer into an intent -- a move, a turn round the pivot, a
 * height, a winding -- and asks the handle's provider what it edits.
 *
 * The handle stays on its own path while dragged -- its `HandleMotion`,
 * through `constrained-drag.ts` -- never loose under the pointer, and the
 * structure is previewed as the edit would leave it. The motion gives the
 * path; the handle's kind gives what the path means.
 */
export function beginGlobalHandleGesture(ctx: ToolContext, sample: PointerSample, ownsType: (surfaceType: string) => boolean, params?: CurveGestureOptions): CurveGesture | undefined {
  const scene = sceneOf(ctx);
  const handle = sample.nodeId ? shownGlobalHandleAt(scene, sample.nodeId) : undefined;
  if (!handle || !ownsType(handle.owner)) return undefined;
  const operationId = `global-${handle.kind}:${ctx.nextSequence()}`;
  const drag = createConstrainedDrag(handle.motion, handle.position, sample, {
    spatialTarget: params?.spatialTarget, elevation: params?.mode === "elevation", pointerOrigin: params?.pointerOrigin,
  });
  let edit: GlobalHandleEdit | undefined;
  let ended = false;

  /** Where the handle stands on its path, and what that asks of the structure. */
  function intentOf(gesture: ToolGesture): { readonly intent: GlobalHandleIntent; readonly at: ConstructionPosition; readonly readout?: string } {
    const { position: at, angle = 0 } = drag.at(gesture);
    const delta = { x: at.x - handle!.position.x, y: at.y - handle!.position.y, z: at.z - handle!.position.z };
    switch (handle!.kind) {
      case "pivot": return { intent: { kind: "move", delta }, at };
      case "height": return { intent: { kind: "height", dy: delta.y }, at, readout: `altura ${delta.y >= 0 ? "+" : ""}${delta.y.toFixed(2)} m` };
      case "rotate": return { intent: { kind: "rotate", angle }, at, readout: `rotação ${((angle * 180) / Math.PI).toFixed(0)}°` };
      case "turns": return { intent: { kind: "wind", angle }, at, readout: `voltas ${angle >= 0 ? "+" : ""}${(angle / (2 * Math.PI)).toFixed(2)}` };
      case "origin":
      case "destination": {
        const under = floorUnder(floorsOf(ctx), gesture.current)?.surfaceKey;
        return { intent: { kind: "place", at, ...(under ? { under } : {}) }, at };
      }
    }
  }

  return {
    move(gesture) {
      if (ended) return;
      if (params?.dragThreshold && sample.screenX !== undefined && gesture.current.screenX !== undefined && sample.screenY !== undefined && gesture.current.screenY !== undefined
        && Math.hypot(gesture.current.screenX - sample.screenX, gesture.current.screenY - sample.screenY) < params.dragThreshold) return;
      try {
        const { intent, at, readout } = intentOf(gesture);
        ctx.runtime.previewNodeHandle?.(handle.id, at);
        edit = planGlobalHandle(scene, handle, intent, ctx.runtime, operationId);
        if (readout) ctx.reportFeedback({ tone: "info", message: readout });
        const preview = edit && previewOf(ctx, handle, edit, scene, operationId);
        if (preview) ctx.runtime.showPreview({ kind: "segments", positions: preview, color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        edit = undefined;
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    commit() {
      if (ended) return;
      ended = true;
      ctx.runtime.clearPreview(CHANNEL);
      ctx.runtime.previewNodeHandle?.(handle.id, undefined);
      if (!edit) return;
      try {
        commitEdit(ctx, handle, edit, scene, operationId);
        // Named after a node the edit keeps, so the same id finds it where it now stands.
        const moved = shownGlobalHandleAt(sceneOf(ctx), handle.id);
        ctx.reportSelection(moved ? { id: moved.id, point: moved.position } : undefined);
        ctx.reportFeedback({ tone: "success", message: DONE[handle.kind] });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Estrutura preservada: ${error instanceof Error ? error.message : String(error)}` });
      }
    },
    cancel() {
      ended = true;
      ctx.runtime.clearPreview(CHANNEL);
      ctx.runtime.previewNodeHandle?.(handle.id, undefined);
    },
  };
}

/**
 * Runs the action `actionId` a picked global handle offers -- disconnecting
 * an end, say -- as one undoable edit. `false` when the handle offers no
 * such action now.
 */
export function runGlobalHandleAction(ctx: ToolContext, handleId: string, actionId: string): boolean {
  const scene = sceneOf(ctx);
  const handle = shownGlobalHandleAt(scene, handleId);
  const action = handle && globalHandleActions(scene, handleId).find((candidate) => candidate.id === actionId);
  if (!handle || !action) return false;
  const operationId = `global-${action.id}:${ctx.nextSequence()}`;
  try {
    const edit = planGlobalHandle(scene, handle, action.intent, ctx.runtime, operationId);
    if (!edit) return false;
    commitEdit(ctx, handle, edit, scene, operationId);
    const standing = shownGlobalHandleAt(sceneOf(ctx), handle.id);
    ctx.reportSelection(standing ? { id: standing.id, point: standing.position } : undefined);
    ctx.reportFeedback({ tone: "success", message: `${action.label}: feito.` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: `Estrutura preservada: ${error instanceof Error ? error.message : String(error)}` });
  }
  return true;
}

/** What the picked global handle `handleId` offers besides dragging it, for a panel or toolbar to show. */
export function globalHandleActionsAt(ctx: ToolContext, handleId: string): readonly { readonly id: string; readonly label: string }[] {
  return globalHandleActions(sceneOf(ctx), handleId).map(({ id, label }) => ({ id, label }));
}
