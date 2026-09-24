import type { ConstructionToolId, StructureEditParams } from "@/features/edit-construction";

import { beginCurveGesture } from "./curve-edit-gesture.ts";
import {
  describeHandle,
  panelHeightWidgetPick,
  planEdit,
  refreshCloudTopology,
  resolveCloudTopology,
  resolvePolicy,
} from "../../../../features/edit-construction/index.ts";
import type { AtomicEditOp, CloudTopology, EditHandle, EditTarget } from "../../../../features/edit-construction/index.ts";
import type {
  ConstructionGraphSnapshot,
  ConstructionNodeSnapshot,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";

import { resolveIntent, type EditIntent } from "./edit-intent.ts";
import { elevationRise, gestureDragged } from "./tool-context.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

/**
 * Editing an *existing* structure through its edit handles -- a vertex, a
 * curve handle or a panel's height widget -- filtered to whichever types
 * `options.ownsType` accepts. A face, an edge or open ground is never
 * grabbed: a press there always belongs to the wrapped tool's creation.
 *
 * The tool composing this still contains **no** per-type behaviour: the
 * `ownsType` filter is the only thing that varies between callers, and it
 * asks a trait or a type's own identity constant, never a type name --
 * `no-type-name-comparisons.test.mjs` holds here exactly as it does
 * everywhere else `hasTrait` is the question to ask.
 */

export interface StructureEditOptions {
  /** Only a handle of a structure whose surface type this accepts is edited; a press anywhere else falls through to the wrapped tool's own creation gesture. */
  readonly ownsType: (surfaceType: string) => boolean;
}

interface GrabbedTarget {
  readonly seedKey: ConstructionSurfaceKey;
  readonly target: EditTarget;
}

function grabbedTarget(ctx: ToolContext, sample: PointerSample, handle: EditHandle, elevation: boolean): GrabbedTarget | undefined {
  const faces = handle.owners.flatMap((owner) => {
    const topology = owner.surfaceKey === undefined ? undefined : ctx.runtime.getRegionTopology(owner.surfaceKey);
    return topology === undefined ? [] : [topology];
  });

  const widget = panelHeightWidgetPick(handle.id);
  if (widget !== undefined) {
    const face = faces[0];
    return face === undefined ? undefined : { seedKey: face.surfaceKey, target: { kind: "edge-zone", edgeId: widget.edgeId, zone: widget.zone } };
  }

  const target: EditTarget = { kind: "vertex", nodeId: handle.id };
  const face: ConstructionRegionTopology | undefined = faces.find((candidate) => sample.surfaceRef === surfaceRefFromNodeSet(candidate.surfaceKey))
    ?? (elevation ? faces.find((candidate) => resolvePolicy(candidate, target).axes.includes("y")) : undefined)
    ?? faces[0];
  return face === undefined ? undefined : { seedKey: face.surfaceKey, target };
}

/** Every node of the cloud whose position differs from the captured snapshot -- what an undo has to put back. */
function restoreOps(
  before: ReadonlyMap<string, ConstructionPosition>,
  after: ReadonlyMap<string, ConstructionNodeSnapshot>,
): { readonly undo: readonly AtomicEditOp[]; readonly redo: readonly AtomicEditOp[] } {
  const undo: AtomicEditOp[] = [];
  const redo: AtomicEditOp[] = [];
  for (const [nodeId, original] of before) {
    const node = after.get(nodeId);
    if (node === undefined) continue;
    if (
      Math.abs(original.x - node.position.x) < 1e-6 &&
      Math.abs(original.y - node.position.y) < 1e-6 &&
      Math.abs(original.z - node.position.z) < 1e-6
    ) {
      continue;
    }
    undo.push({ kind: "move-vertex", nodeId, position: original });
    redo.push({ kind: "move-vertex", nodeId, position: node.position });
  }
  return { undo, redo };
}

interface ActiveDrag {
  readonly cloud: CloudTopology;
  readonly target: EditTarget;
  readonly before: Map<string, ConstructionPosition>;
  /** The graph as of the press, kept current from the drag's own moves -- so a tick never re-reads the whole graph. */
  readonly nodes: Map<string, ConstructionNodeSnapshot>;
  readonly edges: ConstructionGraphSnapshot["edges"];
  previous: ConstructionPosition;
  screenY?: number;
}

export interface StructureEditBehavior {
  /** What a press at `sample` would do for this behaviour's types, resolved from the live session. */
  intentAt(ctx: ToolContext, sample: PointerSample): EditIntent;
  /** Starts an edit through `handle`; `true` means the rest of this pointer gesture belongs to this behaviour. */
  grab(ctx: ToolContext, sample: PointerSample, handle: EditHandle, editParams: StructureEditParams): boolean;
  /** {@link intentAt} then {@link grab}: `false` when `sample` hit no handle this behaviour owns. */
  tryGrab(ctx: ToolContext, sample: PointerSample, editParams: StructureEditParams): boolean;
  onPointerMove(ctx: ToolContext, gesture: ToolGesture, editParams: StructureEditParams): void;
  onPointerUp(ctx: ToolContext, gesture: ToolGesture): void;
  onCancel(): void;
  /** Whether a drag is currently under this behaviour's control. */
  isActive(): boolean;
}

function withPositions(nodes: Map<string, ConstructionNodeSnapshot>, moved: Iterable<{ readonly id: string; readonly position: ConstructionPosition }>): void {
  for (const { id, position } of moved) {
    const node = nodes.get(id);
    nodes.set(id, node === undefined ? { id, position } : { ...node, position });
  }
}

/** The grab-and-edit half of `withStructureEditing`, usable on its own by a tool that composes its own pointer lifecycle. */
export function createStructureEditBehavior(options: StructureEditOptions): StructureEditBehavior {
  let active: ActiveDrag | undefined;
  let curveGesture: ReturnType<typeof beginCurveGesture>;

  function intentAt(ctx: ToolContext, sample: PointerSample): EditIntent {
    return resolveIntent(sample, options.ownsType, (id) => describeHandle(ctx.runtime, id, sample.point));
  }

  function grab(ctx: ToolContext, sample: PointerSample, handle: EditHandle, editParams: StructureEditParams): boolean {
    active = undefined;
    curveGesture?.cancel();
    curveGesture = beginCurveGesture(ctx, sample, editParams);
    if (curveGesture) return true;
    const grabbed = grabbedTarget(ctx, sample, handle, editParams.mode === "elevation");
    const cloud = grabbed === undefined ? undefined : resolveCloudTopology(ctx.runtime, grabbed.seedKey);
    if (grabbed === undefined || cloud === undefined) {
      ctx.reportSelection(undefined);
      return false;
    }
    const snapshot = ctx.runtime.getGraphSnapshot();
    active = {
      cloud,
      target: grabbed.target,
      before: new Map(),
      nodes: new Map(snapshot.nodes.map((node) => [node.id, node])),
      edges: snapshot.edges,
      previous: sample.point,
      screenY: sample.screenY,
    };
    if (grabbed.target.kind === "vertex") {
      ctx.reportSelection({ id: grabbed.target.nodeId, point: sample.point });
    }
    return true;
  }

  function tryGrab(ctx: ToolContext, sample: PointerSample, editParams: StructureEditParams): boolean {
    const intent = intentAt(ctx, sample);
    return intent.kind === "edit" && grab(ctx, sample, intent.target, editParams);
  }

  function onPointerMove(ctx: ToolContext, gesture: ToolGesture, editParams: StructureEditParams): void {
    if (curveGesture) { curveGesture.move(gesture); return; }
    if (active === undefined) return;
    // Per-tick delta, not gesture-total: every op the plan produces applies
    // on top of the cloud's *current* state, so a cumulative delta would
    // move everything again on each tick.
    const rise = editParams.mode === "elevation" ? elevationRise(active.screenY, gesture.current.screenY) : undefined;
    const step = rise !== undefined
      ? { x: 0, y: rise, z: 0 }
      : { x: gesture.current.point.x - active.previous.x, y: gesture.current.point.y - active.previous.y, z: gesture.current.point.z - active.previous.z };
    active.screenY = gesture.current.screenY;
    if (step.x === 0 && step.y === 0 && step.z === 0) return;
    active.previous = gesture.current.point;

    // Positions are re-read every tick; membership is not. A drag that welds
    // onto a neighbour must not silently enlarge what it is dragging.
    const cloud = refreshCloudTopology(ctx.runtime, active.cloud.cloud);
    if (cloud === undefined) return;
    withPositions(active.nodes, cloud.members.flatMap((member) => member.nodes));

    const snapshot: ConstructionGraphSnapshot = { nodes: [...active.nodes.values()], edges: active.edges };
    const plan = planEdit(cloud, {
      surfaceKey: cloud.cloud.seed,
      target: active.target,
      delta: step,
    }, snapshot, ctx.runtime);
    if (plan.kind === "deny") {
      ctx.reportFeedback({ tone: "error", message: plan.reason });
      return;
    }
    if (plan.kind === "regenerate") {
      ctx.reportFeedback({ tone: "info", message: plan.reason });
      return;
    }
    try {
      ctx.runtime.applyRegionEdit(plan.ops, "local", `edit:${plan.role}`);
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: String(error) });
      return;
    }
    const moves = plan.ops.flatMap((op) => (op.kind === "move-vertex" ? [op] : []));
    for (const op of moves) {
      if (active.before.has(op.nodeId)) continue;
      const original = active.nodes.get(op.nodeId)?.position;
      if (original) active.before.set(op.nodeId, original);
    }
    withPositions(active.nodes, moves.map((op) => ({ id: op.nodeId, position: op.position })));

    // The handle-design notes call out that a drag gives no signal of how
    // much it is about to affect. The plan already knows, so say it.
    ctx.reportFeedback({
      tone: "info",
      message:
        plan.scope === "cloud"
          ? `${cloud.cloud.surfaceType}: movendo ${plan.surfaceCount} ${plan.surfaceCount === 1 ? "superficie" : "superficies"} da nuvem.`
          : `${cloud.cloud.surfaceType}: ${plan.role}.`,
    });
    if (active.target.kind === "vertex") {
      ctx.reportSelection({ id: active.target.nodeId, point: gesture.current.point });
    }
  }

  function onPointerUp(ctx: ToolContext, gesture: ToolGesture): void {
    if (curveGesture) { curveGesture.commit(gestureDragged(gesture)); curveGesture = undefined; return; }
    const drag = active;
    active = undefined;
    if (drag === undefined) return;
    const { undo, redo } = restoreOps(drag.before, drag.nodes);
    if (undo.length === 0) return;
    ctx.history.record({ kind: "region-edit", undo, redo });
  }

  function onCancel(): void {
    curveGesture?.cancel();
    curveGesture = undefined;
    active = undefined;
  }

  return {
    intentAt,
    grab,
    tryGrab,
    onPointerMove,
    onPointerUp,
    onCancel,
    isActive: () => active !== undefined || curveGesture !== undefined,
  };
}

/**
 * Composes a creation tool with {@link createStructureEditBehavior}: a press
 * on an edit handle of a structure this tool owns edits it (drag to
 * move/resize, release commits); every other press is the tool's own
 * creation gesture, unchanged. The dispatcher resolves which from the hover
 * (`editableType`), so the handle that lights up is the one a press grabs.
 */
export function withStructureEditing<Id extends ConstructionToolId>(
  tool: ConstructionTool<Id>,
  options: StructureEditOptions,
): ConstructionTool<Id> {
  const behavior = createStructureEditBehavior(options);
  return {
    ...tool,
    previewOnHover: true,
    editableType: options.ownsType,

    previewFor(gesture, params, ctx) {
      if (behavior.isActive()) return undefined;
      return tool.previewFor?.(gesture, params, ctx);
    },

    onPointerDown(ctx, sample, params, intent) {
      const resolved = intent ?? behavior.intentAt(ctx, sample);
      if (resolved.kind === "edit" && behavior.grab(ctx, sample, resolved.target, ctx.structureEditParams)) return;
      ctx.reportSelection(undefined);
      ctx.reportFeedback(undefined);
      tool.onPointerDown?.(ctx, sample, params, resolved);
    },

    onPointerMove(ctx, gesture, params) {
      if (behavior.isActive()) { behavior.onPointerMove(ctx, gesture, ctx.structureEditParams); return; }
      tool.onPointerMove?.(ctx, gesture, params);
    },

    onPointerUp(ctx, gesture, params) {
      if (behavior.isActive()) { behavior.onPointerUp(ctx, gesture); return; }
      tool.onPointerUp?.(ctx, gesture, params);
    },

    onCancel(ctx) {
      behavior.onCancel();
      tool.onCancel?.(ctx);
    },
  };
}
