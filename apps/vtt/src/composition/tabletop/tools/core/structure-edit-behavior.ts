import type { ConstructionToolId, StructureEditParams } from "@/features/edit-construction";

import { beginCurveGesture } from "./curve-edit-gesture.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import { commitRegionEdit } from "../../effects/effect-commit.ts";
import { beginGlobalHandleGesture, globalHandleActionsAt, runGlobalHandleAction } from "./global-handle-gesture.ts";
import {
  cloudNodes,
  globalHandleOf,
  panelHeightWidgetPick,
  planEdit,
  refreshCloudTopology,
  resolveCloudTopology,
  resolvePolicy,
} from "../../../../features/edit-construction/index.ts";
import type { AtomicEditOp, CloudTopology, EditTarget } from "../../../../features/edit-construction/index.ts";
import type {
  ConstructionGraphSnapshot,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";

import { distanceToSegmentXZ } from "../shapes/geometry-2d.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "./tool-context.ts";

/**
 * Grab-and-edit an *existing* structure by any of its parts -- a vertex, a
 * boundary edge, the body, a curve handle, or a type-specific handle --
 * filtered to whichever types `options.ownsType` accepts, so
 * `withStructureEditing` below can fold it into every creation tool's own
 * pointer lifecycle.
 *
 * The tool composing this still contains **no** per-type behaviour: the
 * `ownsType` filter is the only thing that varies between callers, and it
 * asks a trait or a type's own identity constant, never a type name --
 * `no-type-name-comparisons.test.mjs` holds here exactly as it does
 * everywhere else `hasTrait` is the question to ask.
 */

const EDGE_PICK_TOLERANCE = 0.35;
/** How near an edge a press on a face that is not flat -- a wall -- must land to grab the edge rather than the body. */
const ON_FACE_EDGE_TOLERANCE = 0.2;

export interface StructureEditOptions {
  /** Only a vertex/edge/body/handle whose topology's surface type this accepts is grabbed; anything else falls through to the wrapped tool's own creation gesture. */
  readonly ownsType: (surfaceType: string) => boolean;
}

interface GrabbedTarget {
  readonly seedKey: ConstructionSurfaceKey;
  readonly target: EditTarget;
}

function grabbedTarget(ctx: ToolContext, sample: PointerSample, ownsType: StructureEditOptions["ownsType"], elevation: boolean): GrabbedTarget | undefined {
  const topologies = ctx.runtime.getAllRegionTopologies().filter((topology) => ownsType(topology.surfaceType));

  const widget = sample.nodeId === undefined ? undefined : panelHeightWidgetPick(sample.nodeId);
  if (widget !== undefined) {
    const target: EditTarget = { kind: "edge-zone", edgeId: widget.edgeId, zone: widget.zone };
    const topology = topologies.find((candidate) =>
      [...candidate.outerLoops, ...candidate.holes].some((loop) => loop.some((edge) => edge.edgeId === widget.edgeId)));
    return topology === undefined ? undefined : { seedKey: topology.surfaceKey, target };
  }

  if (sample.nodeId !== undefined) {
    const target: EditTarget = { kind: "vertex", nodeId: sample.nodeId };
    const incident = topologies.filter((candidate) => candidate.nodes.some((node) => node.id === sample.nodeId));
    let topology: ConstructionRegionTopology | undefined = incident.find((candidate) => sample.surfaceRef === surfaceRefFromNodeSet(candidate.surfaceKey))
      ?? (elevation ? incident.find((candidate) => resolvePolicy(candidate, target).axes.includes("y")) : undefined)
      ?? incident[0];
    if (topology === undefined) {
      topology = topologies.find((candidate) => resolvePolicy(candidate, target).resolve.kind !== "deny");
    }
    return topology === undefined
      ? undefined
      : { seedKey: topology.surfaceKey, target };
  }

  // A flat structure's edge is grabbed from either side of it -- a press
  // just off it lands on the ground, but still means its edge.
  const edge = nearestEdge(topologies.filter(isLevel), sample);
  if (edge) return edge;
  if (sample.surfaceRef === undefined) return undefined;
  const surfaceRef = sample.surfaceRef;
  const topology = topologies.find(
    (candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === surfaceRef,
  );
  if (topology === undefined) return undefined;
  return { seedKey: topology.surfaceKey, target: isLevel(topology) ? { kind: "region" } : edgeOrBodyAt(topology, sample.point) };
}

/** Whether every node of `topology` stands at one height -- a flat face, whose edges are apart in plan. */
function isLevel(topology: ConstructionRegionTopology): boolean {
  const y = topology.nodes[0]?.position.y;
  return y !== undefined && topology.nodes.every((node) => Math.abs(node.position.y - y) < 1e-4);
}

/** The boundary edge `point` landed on, or the body when it landed on none -- for a face that is not flat, grabbed from on it. */
function edgeOrBodyAt(topology: ConstructionRegionTopology, point: ConstructionPosition): EditTarget {
  const positionOf = (id: string): ConstructionPosition | undefined =>
    topology.nodes.find((node) => node.id === id)?.position;
  let closest: { readonly edgeId: string; readonly distance: number } | undefined;
  for (const loop of [...topology.outerLoops, ...topology.holes]) {
    for (const edge of loop) {
      const start = positionOf(edge.startNodeId);
      const end = positionOf(edge.endNodeId);
      if (start === undefined || end === undefined) continue;
      const distance = distanceToSegmentXZ(point, start, end);
      if (distance > ON_FACE_EDGE_TOLERANCE) continue;
      if (closest === undefined || distance < closest.distance) closest = { edgeId: edge.edgeId, distance };
    }
  }
  return closest === undefined ? { kind: "region" } : { kind: "edge", edgeId: closest.edgeId };
}

/**
 * The boundary edge nearest the pointer among `topologies`, within reach,
 * each read where the pointer is at that structure's own height -- so a
 * raised floor's edge is grabbed where it is drawn, not where the pointer's
 * ray met the ground under it.
 */
function nearestEdge(topologies: readonly ConstructionRegionTopology[], sample: PointerSample): GrabbedTarget | undefined {
  let closest: { readonly grabbed: GrabbedTarget; readonly distance: number } | undefined;
  for (const topology of topologies) {
    const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
    const height = topology.nodes[0]?.position.y;
    const point = sample.ray && height !== undefined ? pointerAtHeight(sample, height) : sample.point;
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        const start = positions.get(use.startNodeId);
        const end = positions.get(use.endNodeId);
        if (start === undefined || end === undefined) continue;
        const distance = distanceToSegmentXZ(point, start, end);
        if (distance > EDGE_PICK_TOLERANCE || (closest && closest.distance <= distance)) continue;
        closest = { grabbed: { seedKey: topology.surfaceKey, target: { kind: "edge", edgeId: use.edgeId } }, distance };
      }
    }
  }
  return closest?.grabbed;
}

/** Where `sample` points at `height` -- along its ray when it has one, else where it hit. */
const aimOf = (sample: PointerSample, height: number): ConstructionPosition => (sample.ray ? pointerAtHeight(sample, height) : sample.point);

function delta(from: ConstructionPosition, to: ConstructionPosition): ConstructionPosition {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

/** Every node of the cloud whose position differs from the captured snapshot -- what an undo has to put back. */
function restoreOps(
  before: ReadonlyMap<string, ConstructionPosition>,
  after: CloudTopology,
  graphSnapshot?: ConstructionGraphSnapshot,
): { readonly undo: readonly AtomicEditOp[]; readonly redo: readonly AtomicEditOp[] } {
  const undo: AtomicEditOp[] = [];
  const redo: AtomicEditOp[] = [];
  for (const node of graphSnapshot?.nodes ?? cloudNodes(after)) {
    const original = before.get(node.id);
    if (original === undefined) continue;
    if (
      Math.abs(original.x - node.position.x) < 1e-6 &&
      Math.abs(original.y - node.position.y) < 1e-6 &&
      Math.abs(original.z - node.position.z) < 1e-6
    ) {
      continue;
    }
    undo.push({ kind: "move-vertex", nodeId: node.id, position: original });
    redo.push({ kind: "move-vertex", nodeId: node.id, position: node.position });
  }
  return { undo, redo };
}

interface ActiveDrag {
  readonly cloud: CloudTopology;
  readonly target: EditTarget;
  readonly before: Map<string, ConstructionPosition>;
  previous: ConstructionPosition;
  /** The height the structure was grabbed at: the pointer is read there, so what is dragged stays under the cursor. */
  readonly height: number;
  screenY?: number;
}

export interface StructureEditBehavior {
  /** Tries to start an edit gesture on whatever `sample` landed on; `true` means the rest of this pointer gesture belongs to this behaviour, not the wrapped tool's own creation gesture. */
  tryGrab(ctx: ToolContext, sample: PointerSample, editParams: StructureEditParams): boolean;
  onPointerMove(ctx: ToolContext, gesture: ToolGesture, editParams: StructureEditParams): void;
  onPointerUp(ctx: ToolContext, gesture?: ToolGesture): void;
  onCancel(): void;
  /** Whether a drag is currently under this behaviour's control. */
  isActive(): boolean;
  /** Whether the *last* `tryGrab` succeeded -- read after pointer-up, once `isActive()` has already gone back to `false`, to decide whether a plain click (no drag) belongs to this behaviour or should still fall through to the wrapped tool's own `onClick`. */
  wasGrabbed(): boolean;
}

/** The grab-and-edit half of `withStructureEditing` -- kept separate so a tool that has no meaningful "click, don't drag" case (a brush) can still use just the drag machinery. */
export function createStructureEditBehavior(options: StructureEditOptions): StructureEditBehavior {
  let active: ActiveDrag | undefined;
  let curveGesture: ReturnType<typeof beginCurveGesture>;
  let grabbedThisGesture = false;

  function tryGrab(ctx: ToolContext, sample: PointerSample, editParams: StructureEditParams): boolean {
    active = undefined;
    curveGesture?.cancel();
    grabbedThisGesture = false;
    // A whole-structure handle, or a curve handle, is its own gesture.
    curveGesture = sample.nodeId && globalHandleOf(sample.nodeId)
      ? beginGlobalHandleGesture(ctx, sample, options.ownsType, { ...editParams, dragThreshold: 5, pointerOrigin: sample.point })
      : beginCurveGesture(ctx, sample, options.ownsType, editParams);
    if (curveGesture) {
      grabbedThisGesture = true;
      return true;
    }
    const grabbed = grabbedTarget(ctx, sample, options.ownsType, editParams.mode === "elevation");
    if (grabbed === undefined) {
      ctx.reportSelection(undefined);
      ctx.reportFeedback(undefined);
      return false;
    }
    const cloud = resolveCloudTopology(ctx.runtime, grabbed.seedKey);
    if (cloud === undefined) {
      ctx.reportSelection(undefined);
      return false;
    }
    active = {
      cloud,
      target: grabbed.target,
      before: new Map(),
      previous: sample.point,
      height: sample.point.y,
      screenY: sample.screenY,
    };
    if (grabbed.target.kind === "vertex") {
      ctx.reportSelection({ id: grabbed.target.nodeId, point: sample.point });
    }
    grabbedThisGesture = true;
    return true;
  }

  function onPointerMove(ctx: ToolContext, gesture: ToolGesture, editParams: StructureEditParams): void {
    if (curveGesture) { curveGesture.move(gesture); return; }
    if (active === undefined) return;
    // Per-tick delta, not gesture-total: every op the plan produces applies
    // on top of the cloud's *current* state, so a cumulative delta would
    // move everything again on each tick.
    const step = editParams.mode === "elevation" && active.screenY !== undefined && gesture.current.screenY !== undefined
      ? { x: 0, y: (active.screenY - gesture.current.screenY) / 40, z: 0 }
      : delta(active.previous, aimOf(gesture.current, active.height));
    active.screenY = gesture.current.screenY;
    if (step.x === 0 && step.y === 0 && step.z === 0) return;
    active.previous = aimOf(gesture.current, active.height);

    // Positions are re-read every tick; membership is not. A drag that welds
    // onto a neighbour must not silently enlarge what it is dragging.
    const cloud = refreshCloudTopology(ctx.runtime, active.cloud.cloud);
    if (cloud === undefined) return;

    const snapshot = ctx.runtime.getGraphSnapshot();
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
    const beforeTick = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
    try {
      ctx.runtime.applyRegionEdit(plan.ops, "local", `edit:${plan.role}`);
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: String(error) });
      return;
    }
    for (const op of plan.ops) {
      if (op.kind !== "move-vertex" || active.before.has(op.nodeId)) continue;
      const original = beforeTick.get(op.nodeId);
      if (original) active.before.set(op.nodeId, original);
    }

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

  function onPointerUp(ctx: ToolContext, gesture?: ToolGesture): void {
    if (curveGesture) {
      if (gesture) curveGesture.move(gesture);
      curveGesture.commit();
      curveGesture = undefined;
      return;
    }
    const drag = active;
    active = undefined;
    if (drag === undefined) return;
    const cloud = refreshCloudTopology(ctx.runtime, drag.cloud.cloud);
    if (cloud === undefined) return;
    const snapshot = ctx.runtime.getGraphSnapshot();
    const { undo, redo } = restoreOps(drag.before, cloud, snapshot);
    if (undo.length === 0) return;
    // The drag moved things live, tick by tick; the finished edit is replayed
    // from where it was grabbed as one transaction, so what it reaches -- the
    // ground a grounded platform cuts -- answers once, and undoes with it.
    const transactionId = scopedToolId(ctx, "edit", ctx.nextSequence());
    ctx.runtime.applyRegionEdit(undo, "local", `${transactionId}:rewind`);
    try {
      const { recorded } = commitRegionEdit(ctx.runtime, redo, { transactionId });
      if (recorded) ctx.history.record({ kind: "transaction", transactionId });
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: `Estrutura preservada: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  function onCancel(): void {
    curveGesture?.cancel();
    curveGesture = undefined;
    active = undefined;
  }

  return {
    tryGrab,
    onPointerMove,
    onPointerUp,
    onCancel,
    isActive: () => active !== undefined || curveGesture !== undefined,
    wasGrabbed: () => grabbedThisGesture,
  };
}

/**
 * Composes a creation tool with {@link createStructureEditBehavior}: a press
 * on an existing structure this tool owns edits it (drag to move/resize,
 * release commits); a press anywhere else falls through to the tool's own
 * creation gesture, unchanged. One tool, not a second "edit mode" -- the
 * same reasoning `opening-tool.ts` already applies to openings, generalized
 * to every other construction tool via the type-filtered grab above.
 */
export function withStructureEditing<Id extends ConstructionToolId>(
  tool: ConstructionTool<Id>,
  options: StructureEditOptions,
): ConstructionTool<Id> {
  const behavior = createStructureEditBehavior(options);
  return {
    ...tool,
    editsType: options.ownsType,
    previewOnHover: true,

    previewFor(gesture, params, ctx) {
      if (behavior.isActive()) return undefined;
      return tool.previewFor?.(gesture, params, ctx);
    },

    onPointerDown(ctx, sample, params) {
      if (behavior.tryGrab(ctx, sample, ctx.structureEditParams)) return;
      tool.onPointerDown?.(ctx, sample, params);
    },

    onPointerMove(ctx, gesture, params) {
      if (behavior.isActive()) { behavior.onPointerMove(ctx, gesture, ctx.structureEditParams); return; }
      tool.onPointerMove?.(ctx, gesture, params);
    },

    onPointerUp(ctx, gesture, params) {
      const wasActive = behavior.isActive();
      if (wasActive) { behavior.onPointerUp(ctx, gesture); return; }
      tool.onPointerUp?.(ctx, gesture, params);
    },

    onCancel(ctx) {
      behavior.onCancel();
      tool.onCancel?.(ctx);
    },

    selectionActions(ctx, selectedId) {
      return [...globalHandleActionsAt(ctx, selectedId), ...(tool.selectionActions?.(ctx, selectedId) ?? [])];
    },

    onSelectionAction(ctx, action, params, selectedId) {
      if (selectedId !== undefined && runGlobalHandleAction(ctx, selectedId, action)) return true;
      return tool.onSelectionAction?.(ctx, action, params, selectedId) ?? false;
    },

    onClick(ctx, sample, params) {
      // A press that grabbed something (drag or not) already belongs to the
      // edit gesture; a plain click that grabbed nothing is the tool's own.
      if (behavior.wasGrabbed()) return;
      tool.onClick?.(ctx, sample, params);
    },
  };
}
