import type { RegionEditOutcome } from "@/ports";

import type { AtomicEditOp, EditGesture } from "./atomic-edit.ts";
import { addPosition, constrainToAxes } from "./atomic-edit.ts";
import type { CloudTopology } from "../topology/construction-cloud.ts";
import { cloudNodes } from "../topology/construction-cloud.ts";
import { resolvePolicy } from "../structure-types/index.ts";
import type { EditRole, EditScope } from "../structure-types/index.ts";

/**
 * Turns one user gesture into the exact sequence of atomic ops to issue.
 *
 * This is the TS half of the ownership split the design doc settles: Rust
 * owns the primitives and knows nothing of type, role, or policy; this layer
 * resolves which role was grabbed, constrains the op's own parameter, and
 * assembles the primary op plus whatever cascade the role declares -- all
 * before a single engine call is made.
 *
 * It plans against a **cloud**, not a face (`ADR-0022`: "editing dispatches
 * by cloud, not by individual surface"). The face the pointer landed on is
 * still what says *what was grabbed* -- a corner is a corner of a panel --
 * but how far the resulting op reaches is the role's own declaration, and a
 * cloud-scoped role fans out over every member.
 *
 * Pure on purpose. It reads topology and returns a plan; nothing here
 * touches the session. {@link applyEditPlan} performs it.
 */

export type EditPlan =
  /** Ops to apply in order, as one transaction. */
  | {
      readonly kind: "apply";
      readonly role: EditRole;
      /** How far this plan reached -- what a caller reports to the user before it commits. */
      readonly scope: EditScope;
      /** Members the plan actually addressed: one for a surface-scoped role, the whole cloud otherwise. */
      readonly surfaceCount: number;
      readonly ops: readonly AtomicEditOp[];
    }
  /** The role refuses this gesture; nothing reaches the engine. */
  | { readonly kind: "deny"; readonly role: EditRole; readonly reason: string }
  /**
   * The role has no atomic expression for this gesture and the caller must
   * re-issue the whole cloud's generation call instead -- the organic case.
   */
  | { readonly kind: "regenerate"; readonly role: EditRole; readonly reason: string };

/**
 * The op(s) the gesture itself asks for, before any cascade.
 *
 * Only a region grab produces more than one: it is the single target whose
 * meaning is "this whole thing," so a cloud-scoped region role moves every
 * member by the same delta. A vertex and an edge each name one part of the
 * graph, and naming it twice would be the same op twice.
 */
function primaryOps(
  cloud: CloudTopology,
  gesture: EditGesture,
  scope: EditScope,
  delta: { readonly x: number; readonly y: number; readonly z: number },
): readonly AtomicEditOp[] {
  switch (gesture.target.kind) {
    case "vertex": {
      const nodeId = gesture.target.nodeId;
      const node = cloudNodes(cloud).find((candidate) => candidate.id === nodeId);
      if (node === undefined) return [];
      return [{ kind: "move-vertex", nodeId: node.id, position: addPosition(node.position, delta) }];
    }
    case "edge":
      return [{ kind: "move-edge", edgeId: gesture.target.edgeId, delta }];
    case "region": {
      if (scope !== "cloud") {
        return [{ kind: "move-region", surfaceKey: cloud.seed.surfaceKey, delta }];
      }
      // Deliberately *not* one `move-region` per member. `moveRegion`
      // translates every node on the region's boundary, and the members of
      // a cloud are welded precisely by sharing nodes -- so a column two
      // panels both reference would take the delta once per panel and end
      // up twice as far as the panels around it. The run would shear open
      // at exactly the joints that make it one run.
      //
      // Addressing the cloud's distinct nodes instead moves each of them
      // once, whatever number of members happens to reference it, and says
      // in the op list what the gesture actually meant.
      return cloudNodes(cloud).map((node) => ({
        kind: "move-vertex" as const,
        nodeId: node.id,
        position: addPosition(node.position, delta),
      }));
    }
  }
}

/**
 * Resolves `gesture` against the structure type's own role table. The
 * returned ops are already constrained -- a height-only role's horizontal
 * movement is gone by this point, never clamped later or inside Rust.
 */
export function planEdit(cloud: CloudTopology, gesture: EditGesture): EditPlan {
  const policy = resolvePolicy(cloud.seed, gesture.target);
  if (policy.resolve.kind === "deny") {
    return { kind: "deny", role: policy.role, reason: policy.resolve.reason };
  }
  if (policy.resolve.kind === "regenerate") {
    return { kind: "regenerate", role: policy.role, reason: policy.resolve.reason };
  }

  const delta = constrainToAxes(gesture.delta, policy.axes);
  const primary = primaryOps(cloud, gesture, policy.scope, delta);
  if (primary.length === 0) {
    return {
      kind: "deny",
      role: policy.role,
      reason: `the gesture's target is not part of the ${cloud.cloud.surfaceType} cloud seeded at ${cloud.cloud.seed.join(":")}`,
    };
  }
  const cascade = policy.cascade?.({ cloud, topology: cloud.seed, target: gesture.target, delta }) ?? [];
  return {
    kind: "apply",
    role: policy.role,
    scope: policy.scope,
    surfaceCount: policy.scope === "cloud" ? cloud.members.length : 1,
    ops: [...primary, ...cascade],
  };
}

/** The slice of `ConstructionSessionPort` an edit plan actually needs. */
export interface EditOpSink {
  moveVertex(nodeId: string, position: { x: number; y: number; z: number }): RegionEditOutcome;
  moveEdge(edgeId: string, delta: { x: number; y: number; z: number }): RegionEditOutcome;
  moveRegion(
    surfaceKey: readonly string[],
    delta: { x: number; y: number; z: number },
  ): RegionEditOutcome;
  insertVertex(request: {
    edgeId: string;
    nodeId: string;
    position: { x: number; y: number; z: number };
    firstEdgeId: string;
    secondEdgeId: string;
  }): RegionEditOutcome;
  removeVertex(nodeId: string, weldedEdgeId: string): RegionEditOutcome;
  retypeEdge(
    edgeId: string,
    geometry: { kind: "line" } | { kind: "arc"; center: readonly [number, number]; clockwise: boolean },
  ): RegionEditOutcome;
  deleteRegion(surfaceKey: readonly string[]): RegionEditOutcome;
  duplicateRegion(request: {
    surfaceKey: readonly string[];
    suffix: string;
    offset: { x: number; y: number; z: number };
    surfaceType: string;
    physical: boolean;
  }): RegionEditOutcome;
}

/** Issues one atomic op against the session. */
export function applyEditOp(sink: EditOpSink, op: AtomicEditOp): RegionEditOutcome {
  switch (op.kind) {
    case "move-vertex":
      return sink.moveVertex(op.nodeId, op.position);
    case "insert-vertex":
      return sink.insertVertex(op);
    case "remove-vertex":
      return sink.removeVertex(op.nodeId, op.weldedEdgeId);
    case "retype-edge":
      return sink.retypeEdge(op.edgeId, op.geometry);
    case "move-edge":
      return sink.moveEdge(op.edgeId, op.delta);
    case "move-region":
      return sink.moveRegion(op.surfaceKey, op.delta);
    case "delete-region":
      return sink.deleteRegion(op.surfaceKey);
    case "duplicate-region":
      return sink.duplicateRegion(op);
  }
}

export const EMPTY_OUTCOME: RegionEditOutcome = Object.freeze({
  affectedSurfaceKeys: Object.freeze([]),
  createdSurfaceKeys: Object.freeze([]),
  removedSurfaceKeys: Object.freeze([]),
  createdNodeIds: Object.freeze([]),
  removedNodeIds: Object.freeze([]),
});

function mergeKeys(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const seen = new Set(left.map((key) => key.join(" ")));
  return [...left, ...right.filter((key) => !seen.has(key.join(" ")))];
}

function mergeIds(left: readonly string[], right: readonly string[]): readonly string[] {
  return [...new Set([...left, ...right])];
}

function without(
  keys: readonly (readonly string[])[],
  gone: ReadonlySet<string>,
): readonly (readonly string[])[] {
  return gone.size === 0 ? keys : keys.filter((key) => !gone.has(key.join(" ")));
}

/**
 * Folds two outcomes, so a whole transaction reports one combined result.
 *
 * **The later op wins the disagreement**, and the disagreement is real: two
 * faces sitting side by side are each other's neighbour, so deleting the
 * first reports the second as *affected* and deleting the second reports it
 * as *removed*. A merge that kept both leaves the caller a key it must
 * re-derive a mesh for and a key that no longer exists -- the same key. That
 * is a thrown `unknown analytic region`, in the middle of a transaction that
 * has already happened, and it is why rebuilding a junction's flank could
 * take the flank away and put nothing back.
 *
 * `left` is what the transaction has done so far and `right` is the newest
 * op, so it settles both directions: a face the newest op removed is no
 * longer affected or created, and a face it created is no longer removed.
 */
export function mergeOutcomes(left: RegionEditOutcome, right: RegionEditOutcome): RegionEditOutcome {
  const removed = new Set(right.removedSurfaceKeys.map((key) => key.join(" ")));
  const created = new Set(right.createdSurfaceKeys.map((key) => key.join(" ")));
  return {
    affectedSurfaceKeys: without(
      mergeKeys(left.affectedSurfaceKeys, right.affectedSurfaceKeys),
      removed,
    ),
    createdSurfaceKeys: without(
      mergeKeys(left.createdSurfaceKeys, right.createdSurfaceKeys),
      removed,
    ),
    removedSurfaceKeys: without(
      mergeKeys(left.removedSurfaceKeys, right.removedSurfaceKeys),
      created,
    ),
    createdNodeIds: mergeIds(left.createdNodeIds, right.createdNodeIds),
    removedNodeIds: mergeIds(left.removedNodeIds, right.removedNodeIds),
  };
}

/**
 * Applies every op in a plan in order, as one transaction, and reports the
 * merged outcome. A non-`"apply"` plan is a no-op here by design -- deciding
 * what a denial or an escalation means to the user is the caller's, not
 * this layer's.
 */
export function applyEditPlan(sink: EditOpSink, plan: EditPlan): RegionEditOutcome {
  if (plan.kind !== "apply") return EMPTY_OUTCOME;
  return plan.ops.reduce(
    (outcome, op) => mergeOutcomes(outcome, applyEditOp(sink, op)),
    EMPTY_OUTCOME,
  );
}
