import type { BezierPort, ConstructionEdgeGeometry, ConstructionGraphSnapshot, RegionEditOutcome, ConstructionSessionPort, ConstructionPosition } from "@/ports";

import type { AtomicEditOp, EditGesture } from "./atomic-edit.ts";
import { addPosition, constrainToAxes } from "./atomic-edit.ts";
import type { CloudTopology } from "../topology/construction-cloud.ts";
import { cloudNodes } from "../topology/construction-cloud.ts";
import { resolvePolicy, structureTypeFor } from "../structure-types/index.ts";
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
  graphSnapshot?: ConstructionGraphSnapshot,
): readonly AtomicEditOp[] {
  switch (gesture.target.kind) {
    case "vertex": {
      const nodeId = gesture.target.nodeId;
      const node = cloudNodes(cloud, graphSnapshot).find((candidate) => candidate.id === nodeId);
      if (node === undefined) return [];
      return [{ kind: "move-vertex", nodeId: node.id, position: addPosition(node.position, delta) }];
    }
    case "edge":
    case "edge-zone":
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
      return cloudNodes(cloud, graphSnapshot).map((node) => ({
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
export function planEdit(
  cloud: CloudTopology,
  gesture: EditGesture,
  graphSnapshot?: ConstructionGraphSnapshot,
  source?: Pick<ConstructionSessionPort, "planMotion" | "getAllRegionTopologies"> & Partial<Pick<BezierPort, "curveBatch">>,
): EditPlan {
  const policy = resolvePolicy(cloud.seed, gesture.target);
  if (policy.resolve.kind === "deny") {
    return { kind: "deny", role: policy.role, reason: policy.resolve.reason };
  }
  if (policy.resolve.kind === "regenerate") {
    return { kind: "regenerate", role: policy.role, reason: policy.resolve.reason };
  }

  const axisDelta = constrainToAxes(gesture.delta, policy.axes);
  const delta = policy.constrain?.({ topology: cloud.seed, target: gesture.target, delta: axisDelta }) ?? axisDelta;
  const primary = primaryOps(cloud, gesture, policy.scope, delta, graphSnapshot);
  if (primary.length === 0) {
    return {
      kind: "deny",
      role: policy.role,
      reason: `the gesture's target is not part of the ${cloud.cloud.surfaceType} cloud seeded at ${cloud.cloud.seed.join(":")}`,
    };
  }
  if (source !== undefined) {
    try {
      const topologies = source.getAllRegionTopologies();
      const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
      for (const node of graphSnapshot?.nodes ?? []) positions.set(node.id, node.position);
      const seeds: { nodeId: string; delta: ConstructionPosition }[] = [];
      const primarySet = new Set(primary);
      const structural = structureTypeFor(cloud.seed.surfaceType)?.motionInfluences ? []
        : policy.cascade?.({ cloud, topology: cloud.seed, target: gesture.target, delta, graphSnapshot }) ?? [];
      const grouped = policy.groupCascade?.({ cloud, topology: cloud.seed, target: gesture.target, delta, graphSnapshot, allTopologies: topologies }) ?? [];
      const extras = [...structural, ...grouped];
      for (const op of [...primary, ...extras]) {
        if (op.kind === "move-vertex") {
          const before = positions.get(op.nodeId);
          if (!before) throw new Error(`Vertice ausente: ${op.nodeId}`);
          // Primary displacement is copied, not reconstructed from rounded coordinates.
          seeds.push({ nodeId: op.nodeId, delta: primarySet.has(op) ? delta : { x: op.position.x - before.x, y: op.position.y - before.y, z: op.position.z - before.z } });
        } else if (op.kind === "move-edge") {
          const edge = cloud.members.flatMap((member) => [...member.outerLoops, ...member.holes].flat()).find((candidate) => candidate.edgeId === op.edgeId);
          if (!edge) throw new Error(`Aresta ausente: ${op.edgeId}`);
          seeds.push({ nodeId: edge.startNodeId, delta: op.delta }, { nodeId: edge.endNodeId, delta: op.delta });
        } else if (op.kind === "move-region") {
          for (const node of cloud.seed.nodes) seeds.push({ nodeId: node.id, delta: op.delta });
        } else throw new Error("A resposta de movimento deve produzir apenas deslocamentos.");
      }
      // `policy.transport` is the *grabbed type's own* declaration, so it
      // reaches only topologies of that same type: broadcasting it would let
      // one type's flag flip an unrelated type's `motionInfluences`. It is not
      // limited to the grabbed cloud either -- a platform's whole-body drag
      // deliberately reaches other platform clouds bridged only by walls.
      const influences = topologies.flatMap((topology) => structureTypeFor(topology.surfaceType)?.motionInfluences?.(
        topology,
        policy.transport === true && topology.surfaceType === cloud.seed.surfaceType,
      ) ?? []);
      const resolved = source.planMotion({ seeds, influences });
      const moved = new Map(resolved.moves.map((move) => [move.nodeId, move.position]));
      const resolvedMoves = new Map(moved);
      for (const surfaceType of new Set(topologies.map((topology) => topology.surfaceType))) {
        const derive = structureTypeFor(surfaceType)?.deriveMotion;
        if (!derive) continue;
        for (const [nodeId, position] of derive(topologies.filter((topology) => topology.surfaceType === surfaceType), resolvedMoves, {
          graphSnapshot,
          port: source.curveBatch ? source as Pick<BezierPort, "curveBatch"> : undefined,
        })) {
          if (!moved.has(nodeId)) moved.set(nodeId, position);
        }
      }
      let surfaceCount = 0;
      for (const topology of topologies) {
        if (!topology.nodes.some((node) => moved.has(node.id))) continue;
        surfaceCount += 1;
        const reason = structureTypeFor(topology.surfaceType)?.validateMotion?.(topology, moved);
        if (reason) return { kind: "deny", role: policy.role, reason };
      }
      return { kind: "apply", role: policy.role, scope: policy.scope, surfaceCount,
        ops: [...moved].map(([nodeId, position]) => ({ kind: "move-vertex", nodeId, position })) };
    } catch (error) {
      return { kind: "deny", role: policy.role, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  const solverBound = structureTypeFor(cloud.seed.surfaceType);
  if (solverBound?.requiresMotionSolver === true) {
    // Named by its own label, never by its surface type: the reader is told
    // which structure refused, and the message still costs the type nothing
    // in self-knowledge -- a label is what a type already says about itself.
    return { kind: "deny", role: policy.role, reason: `${solverBound.label} requer o resolvedor estrutural da sessao.` };
  }
  const cascade = policy.cascade?.({ cloud, topology: cloud.seed, target: gesture.target, delta, graphSnapshot }) ?? [];
  // Without a session the grabbed cloud is all of the table this plan can see.
  const grouped = policy.groupCascade?.({ cloud, topology: cloud.seed, target: gesture.target, delta, graphSnapshot, allTopologies: cloud.members }) ?? [];
  return {
    kind: "apply",
    role: policy.role,
    scope: policy.scope,
    surfaceCount: policy.scope === "cloud" ? cloud.members.length : 1,
    ops: [...primary, ...cascade, ...grouped],
  };
}

/**
 * Reshapes one edge's curve -- a curve handle dragged on a contour edge --
 * against the grabbed edge's own role. The role decides whether the edge may
 * curve at all and what reshapes with it; the ops set geometry and move no
 * node.
 */
export function planEdgeReshape(cloud: CloudTopology, edgeId: string, geometry: ConstructionEdgeGeometry): EditPlan {
  const policy = resolvePolicy(cloud.seed, { kind: "edge", edgeId });
  if (policy.resolve.kind !== "allow") {
    return { kind: "deny", role: policy.role, reason: policy.resolve.reason };
  }
  if (policy.reshape === undefined) {
    return { kind: "deny", role: policy.role, reason: "Esta aresta nao pode ser curvada." };
  }
  const ops: AtomicEditOp[] = [{ kind: "retype-edge", edgeId, geometry }, ...policy.reshape({ cloud, edgeId, geometry })];
  return { kind: "apply", role: policy.role, scope: "surface", surfaceCount: 1, ops };
}

/** The slice of `ConstructionSessionPort` an edit plan actually needs. */
export interface EditOpSink {
  moveVertices(moves: readonly { readonly nodeId: string; readonly position: ConstructionPosition }[]): RegionEditOutcome;
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
    geometry: ConstructionEdgeGeometry,
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

/** Folds two outcomes, so a whole transaction reports one combined result. */
export function mergeOutcomes(left: RegionEditOutcome, right: RegionEditOutcome): RegionEditOutcome {
  return {
    affectedSurfaceKeys: mergeKeys(left.affectedSurfaceKeys, right.affectedSurfaceKeys),
    createdSurfaceKeys: mergeKeys(left.createdSurfaceKeys, right.createdSurfaceKeys),
    removedSurfaceKeys: mergeKeys(left.removedSurfaceKeys, right.removedSurfaceKeys),
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
  if (plan.kind !== "apply" || plan.ops.length === 0) return EMPTY_OUTCOME;
  const movements = plan.ops.filter((op) => op.kind === "move-vertex");
  if (movements.length === plan.ops.length) return sink.moveVertices(movements);
  return plan.ops.reduce(
    (outcome, op) => mergeOutcomes(outcome, applyEditOp(sink, op)),
    EMPTY_OUTCOME,
  );
}
