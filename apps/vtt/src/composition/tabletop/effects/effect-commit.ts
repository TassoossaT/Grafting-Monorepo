// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
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

import { runEffects } from "../../../features/edit-construction/index.ts";
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
}

export type TabletopReactions = Readonly<Record<ReactionId, Reaction<TabletopReactionRuntime>>>;

/** Dispatches `effects` against the live state. Call inside a transaction. */
export function dispatchEffects(
  runtime: EffectCommitRuntime,
  effects: readonly Effect[],
  reactions: TabletopReactions = TABLETOP_REACTIONS,
): readonly ReactionRecord[] {
  return timePhase("reações", () => runEffects(runtime, {
    regionsNear: (bounds) => typeof runtime.getRegionTopologiesInBounds === "function"
      ? runtime.getRegionTopologiesInBounds(bounds)
      : runtime.getAllRegionTopologies(),
  }, effects, reactions));
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
  },
): TransactionResult<ConstructionPatchOutcome> {
  const origin = options.origin ?? "local";
  return commitChange(runtime, options, () => {
    const before = topologiesOf(runtime, request.sourceSurfaceKeys);
    const carriedBefore = topologiesOf(runtime, options.carries ?? []);
    const outcome = runtime.applyPatchReplacement(request, origin, options.transactionId);
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
    return outcome;
  });
}

/**
 * Deletes a whole structure -- every one of `surfaceKeys` -- after `release`
 * takes it off what it is welded to, and lets every cloud it had cut answer,
 * as one transaction.
 */
export function commitStructureRemoval(
  runtime: EffectCommitRuntime,
  surfaceKeys: readonly ConstructionSurfaceKey[],
  release: ApplyPatchReplacementRequest | undefined,
  options: CommitOptions,
): TransactionResult<void> {
  const origin = options.origin ?? "local";
  return runtime.transact(options.transactionId, origin, () => {
    if (release && release.sourceSurfaceKeys.length > 0) runtime.applyPatchReplacement(release, origin, options.transactionId);
    for (const surfaceKey of surfaceKeys) {
      const removed = topologiesOf(runtime, [surfaceKey]);
      if (removed.length === 0) continue;
      const outcome = runtime.removeSurface({ surfaceKey }, origin, options.transactionId);
      const change = shapeChangeOfRemoval(removed, outcome.removedNodeIds);
      if (change !== undefined) {
        dispatchEffects(runtime, [
          { kind: "remove", causeId: options.transactionId, change },
          { kind: "cut", causeId: options.transactionId, change },
        ], options.reactions);
      }
    }
  });
}

/** Deletes one surface and lets its own cloud and every cloud it had cut answer, atomically. */
export function commitSurfaceRemoval(
  runtime: EffectCommitRuntime,
  surfaceKey: ConstructionSurfaceKey,
  options: CommitOptions,
): TransactionResult<RegionEditOutcome> {
  const origin = options.origin ?? "local";
  return runtime.transact(options.transactionId, origin, () => {
    const removed = topologiesOf(runtime, [surfaceKey]);
    const outcome = runtime.removeSurface({ surfaceKey }, origin, options.transactionId);
    const change = shapeChangeOfRemoval(removed, outcome.removedNodeIds);
    if (change !== undefined) {
      dispatchEffects(runtime, [
        { kind: "remove", causeId: options.transactionId, change },
        { kind: "cut", causeId: options.transactionId, change },
      ], options.reactions);
    }
    return outcome;
  });
}
