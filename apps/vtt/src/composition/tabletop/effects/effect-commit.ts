// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ConstructionGraphSnapshot,
  ApplyPatchReplacementRequest,
  ChangeOrigin,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  RegionEditOutcome,
} from "@/ports";
import type { AtomicEditOp, Effect, Reaction, ReactionId, ReactionRecord, ShapeChange } from "@/features/edit-construction";
import type { TransactionResult } from "../tabletop-runtime.ts";

import { EMPTY_OUTCOME, hasTrait, mergeOutcomes, runEffects, settlePatch, simplifyCollinearVertices } from "../../../features/edit-construction/index.ts";
import { timePhase } from "../commit-timing.ts";
import { TABLETOP_REACTIONS, type TabletopReactionRuntime } from "./reactions.ts";
import { shapeChangeOfRemoval, shapeChangeOfReplacement, topologiesOf } from "./shape-change.ts";

/**
 * The one way a construction change reaches other clouds.
 *
 * A committed change runs inside one transaction: the change itself, then the
 * effects it emits, then every reaction those effects chain into. Any refusal
 * or failure rolls all of it back; success is one undo entry named after the
 * transaction. Nothing here knows which types are involved -- reach comes from
 * the effect definitions, answers from the types' declared reactions.
 */

/** What committing needs of the runtime. */
export interface EffectCommitRuntime extends TabletopReactionRuntime {
  transact<T>(transactionId: string, origin: ChangeOrigin, work: () => T): TransactionResult<T>;
  applyPatchReplacement(request: ApplyPatchReplacementRequest, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome;
  removeSurface(request: { readonly surfaceKey: ConstructionSurfaceKey }, origin: ChangeOrigin, causeId: string): RegionEditOutcome;
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  getGraphSnapshot(): Pick<ConstructionGraphSnapshot, "nodes" | "edges">;
}

export type TabletopReactions = Readonly<Record<ReactionId, Reaction<TabletopReactionRuntime>>>;

/** Dispatches `effects` against the live state. Call inside a transaction. */
export function dispatchEffects(
  runtime: EffectCommitRuntime,
  effects: readonly Effect[],
  reactions: TabletopReactions = TABLETOP_REACTIONS,
): readonly ReactionRecord[] {
  // Every shape change is also a reshape, for what stands on the changed cloud to follow.
  const reshaped = effects.flatMap((effect): Effect[] => (effect.kind === "cut" ? [effect, { ...effect, kind: "reshape" }] : [effect]));
  return timePhase("reações", () => runEffects(runtime, {
    regionsNear: (bounds) => typeof runtime.getRegionTopologiesInBounds === "function"
      ? runtime.getRegionTopologiesInBounds(bounds)
      : runtime.getAllRegionTopologies(),
  }, reshaped, reactions));
}

export interface CommitOptions {
  /** Names the transaction and its undo entry; reactions mint their ids from it. */
  readonly transactionId: string;
  readonly origin?: ChangeOrigin;
  /** The preset the change was made with, when its type has presets. */
  readonly subtype?: string;
  readonly reactions?: TabletopReactions;
}

/**
 * Runs `work` -- every mutation one gesture makes -- as one transaction, then
 * lets every cloud the reported change reaches answer it inside that same
 * transaction. Throwing anywhere rolls all of it back.
 */
export function commitChange<T>(
  runtime: EffectCommitRuntime,
  options: CommitOptions,
  work: () => { readonly value: T; readonly change?: ShapeChange },
): TransactionResult<T> {
  const origin = options.origin ?? "local";
  return runtime.transact(options.transactionId, origin, () => {
    const { value, change } = work();
    if (change !== undefined) {
      dispatchEffects(runtime, [{ kind: "cut", causeId: options.transactionId, change }], options.reactions);
    }
    return value;
  });
}

/** Replaces regions with a patch and lets every cloud the change reaches answer it, atomically. */
export function commitPatchReplacement(
  runtime: EffectCommitRuntime,
  request: ApplyPatchReplacementRequest,
  options: CommitOptions & {
    /** Faces the replacement moves without replacing them -- carried along; each type answers its own move. */
    readonly carries?: readonly ConstructionSurfaceKey[];
    /** More of the same change, once the replacement stands and before anything answers it. */
    readonly afterward?: (outcome: ConstructionPatchOutcome) => void;
  },
): TransactionResult<ConstructionPatchOutcome> {
  const origin = options.origin ?? "local";
  return commitChange(runtime, options, () => {
    const before = topologiesOf(runtime, request.sourceSurfaceKeys);
    const carriedBefore = topologiesOf(runtime, options.carries ?? []);
    // Whatever made the patch, each face it declares keeps its type's law.
    const settled = { ...request, patch: settlePatch(request.patch, runtime.getGraphSnapshot()) };
    const outcome = runtime.applyPatchReplacement(settled, origin, options.transactionId);
    options.afterward?.(outcome);
    if (carriedBefore.length > 0) dispatchEffects(runtime, movedEffects(runtime, carriedBefore, outcome.removedNodeIds, [], options.transactionId), options.reactions);
    return { value: outcome, change: shapeChangeOfReplacement(runtime, request, before, outcome, options.subtype) };
  });
}

/** One cut per type among `before`, each from how its faces stood to how they stand now. */
function movedEffects(runtime: EffectCommitRuntime, before: readonly ConstructionRegionTopology[], removedNodeIds: readonly string[], declaredPositions: readonly ConstructionPosition[], causeId: string): Effect[] {
  const after = new Map(topologiesOf(runtime, before.map((topology) => topology.surfaceKey)).map((topology) => [topology.surfaceKey.join("\u0000"), topology]));
  return [...new Set(before.map((topology) => topology.surfaceType))].map((surfaceType): Effect => {
    const was = before.filter((topology) => topology.surfaceType === surfaceType);
    const now = was.flatMap((topology) => after.get(topology.surfaceKey.join("\u0000")) ?? []);
    return { kind: "cut", causeId, change: { surfaceType, before: was, after: now, removedNodeIds, declaredPositions } };
  });
}

/**
 * Applies region edit ops -- a finished drag, a turn, a raise -- and lets
 * every cloud the edit reaches answer it, atomically: a grounded platform
 * moved or resized re-cuts the ground it left and the ground it now covers,
 * exactly as drawing it did. Each type the edit moved emits its own change;
 * a type that cuts nothing reaches nothing.
 */
export function commitRegionEdit(
  runtime: EffectCommitRuntime & { applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome },
  ops: readonly AtomicEditOp[],
  options: CommitOptions,
): TransactionResult<RegionEditOutcome> {
  const origin = options.origin ?? "local";
  const moved = new Set(ops.flatMap((op) => (op.kind === "move-vertex" ? [op.nodeId] : [])));
  const before = runtime.getAllRegionTopologies().filter((topology) => topology.nodes.some((node) => moved.has(node.id)));
  return runtime.transact(options.transactionId, origin, () => {
    const outcome = runtime.applyRegionEdit(ops, origin, options.transactionId);
    const declaredPositions = ops.flatMap((op) => (op.kind === "move-vertex" ? [op.position] : []));
    const effects = movedEffects(runtime, before, outcome.removedNodeIds, declaredPositions, options.transactionId);
    if (effects.length > 0) dispatchEffects(runtime, effects, options.reactions);
    if (typeof runtime.getRegionTopology === "function" && typeof runtime.applyRegionEdit === "function") {
      const tableId = typeof runtime.getSnapshot === "function" ? runtime.getSnapshot().tableId : "table";
      for (const topology of before) {
        if (hasTrait(topology.surfaceType, "floor")) {
          const live = runtime.getRegionTopology(topology.surfaceKey);
          if (live) simplifyCollinearVertices(runtime, live, tableId, options.transactionId);
        }
      }
    }
    return outcome;
  });
}

/**
 * A region edit in stages, as one transaction: `before` changes the table
 * first -- a weld paused -- the ops are then worked out on the table as
 * `before` left it and applied, every cloud they reach answers them, and
 * `after` finishes the change -- the weld made again. Throwing anywhere
 * rolls all of it back.
 */
export function commitStagedRegionEdit(
  runtime: EffectCommitRuntime & { applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome },
  stages: { readonly before?: () => void; readonly ops: () => readonly AtomicEditOp[]; readonly after?: () => void },
  options: CommitOptions,
): TransactionResult<RegionEditOutcome> {
  const origin = options.origin ?? "local";
  return runtime.transact(options.transactionId, origin, () => {
    stages.before?.();
    const ops = stages.ops();
    const moved = new Set(ops.flatMap((op) => (op.kind === "move-vertex" ? [op.nodeId] : [])));
    const before = runtime.getAllRegionTopologies().filter((topology) => topology.nodes.some((node) => moved.has(node.id)));
    const outcome = runtime.applyRegionEdit(ops, origin, options.transactionId);
    const declaredPositions = ops.flatMap((op) => (op.kind === "move-vertex" ? [op.position] : []));
    const effects = movedEffects(runtime, before, outcome.removedNodeIds, declaredPositions, options.transactionId);
    if (effects.length > 0) dispatchEffects(runtime, effects, options.reactions);
    if (typeof runtime.getRegionTopology === "function" && typeof runtime.applyRegionEdit === "function") {
      const tableId = typeof runtime.getSnapshot === "function" ? runtime.getSnapshot().tableId : "table";
      for (const topology of before) {
        if (hasTrait(topology.surfaceType, "floor")) {
          const live = runtime.getRegionTopology(topology.surfaceKey);
          if (live) simplifyCollinearVertices(runtime, live, tableId, options.transactionId);
        }
      }
    }
    stages.after?.();
    return outcome;
  });
}

/** Deletes surfaces and lets their own clouds and every cloud they had cut answer, atomically. */
export function commitSurfaceRemoval(
  runtime: EffectCommitRuntime,
  surfaceKey: ConstructionSurfaceKey | readonly ConstructionSurfaceKey[],
  options: CommitOptions,
): TransactionResult<RegionEditOutcome> {
  const origin = options.origin ?? "local";
  const keys: readonly ConstructionSurfaceKey[] =
    typeof surfaceKey[0] === "string"
      ? [surfaceKey as ConstructionSurfaceKey]
      : (surfaceKey as readonly ConstructionSurfaceKey[]);

  return runtime.transact(options.transactionId, origin, () => {
    const removed = topologiesOf(runtime, keys);
    let outcome = EMPTY_OUTCOME;
    for (const key of keys) {
      const res = runtime.removeSurface({ surfaceKey: key }, origin, options.transactionId);
      outcome = mergeOutcomes(outcome, res);
    }
    const byType = new Map<string, ConstructionRegionTopology[]>();
    for (const topology of removed) {
      const list = byType.get(topology.surfaceType) ?? [];
      list.push(topology);
      byType.set(topology.surfaceType, list);
    }
    for (const [, group] of byType) {
      const change = shapeChangeOfRemoval(group, outcome.removedNodeIds);
      if (change !== undefined) {
        dispatchEffects(
          runtime,
          [
            { kind: "remove", causeId: options.transactionId, change },
            { kind: "cut", causeId: options.transactionId, change },
          ],
          options.reactions,
        );
      }
    }
    return outcome;
  });
}
