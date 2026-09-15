// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ApplyPatchReplacementRequest,
  ChangeOrigin,
  ConstructionPatchOutcome,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  RegionEditOutcome,
} from "@/ports";
import type { Effect, Reaction, ReactionId, ReactionRecord } from "@/features/edit-construction";
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

/** Replaces regions with a patch and lets every cloud the change reaches answer it, atomically. */
export function commitPatchReplacement(
  runtime: EffectCommitRuntime,
  request: ApplyPatchReplacementRequest,
  options: CommitOptions,
): TransactionResult<ConstructionPatchOutcome> {
  const origin = options.origin ?? "local";
  return runtime.transact(options.transactionId, origin, () => {
    const before = topologiesOf(runtime, request.sourceSurfaceKeys);
    const outcome = runtime.applyPatchReplacement(request, origin, options.transactionId);
    const change = shapeChangeOfReplacement(runtime, request, before, outcome, options.subtype);
    if (change !== undefined) {
      dispatchEffects(runtime, [{ kind: "cut", causeId: options.transactionId, change }], options.reactions);
    }
    return outcome;
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
