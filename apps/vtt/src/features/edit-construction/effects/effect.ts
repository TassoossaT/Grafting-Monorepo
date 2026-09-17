import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

/**
 * What can happen to a cloud that other clouds may have to answer.
 *
 * The vocabulary is closed and each kind is defined once, in
 * `effect-pipeline.ts`: who it reaches, and nothing else. How a cloud answers
 * is its type's declared reaction (`StructureTypeDefinition.reactions`), so a
 * new effect never edits a type and a new type never edits an effect.
 */
export type EffectKind =
  /**
   * A cloud's shape changed: it claimed the ground under `after` and left
   * whatever of `before` it no longer covers. Reaches the clouds the changed
   * type's own creation interaction cuts.
   */
  | "cut"
  /**
   * Faces were deleted from a cloud outright. Reaches the rest of that same
   * cloud, which answers for the hole the deletion left.
   */
  | "remove";

/**
 * A declared reaction, by name. The type registry names reactions as data;
 * the implementation behind each name lives with the runtime that can execute
 * it, and must exist for every name here.
 */
export type ReactionId =
  /** Regenerates an irregular lattice around the change, pinned to what now bounds it. */
  | "lattice-regenerate";

/** What changed about one cloud, in the terms every reaction reads. */
export interface ShapeChange {
  /** The type of the cloud whose shape changed. */
  readonly surfaceType: string;
  /** The preset the change was made with, when its type has presets at all. */
  readonly subtype?: string;
  /** The faces the change replaced or deleted, as they were. */
  readonly before: readonly ConstructionRegionTopology[];
  /** The faces the change produced, as they are now. */
  readonly after: readonly ConstructionRegionTopology[];
  /** The XZ outline the change explicitly claimed, when it had one. */
  readonly footprintOutline?: readonly (readonly [number, number])[];
  /** Nodes the engine reported as destroyed by the change. */
  readonly removedNodeIds: readonly ConstructionNodeId[];
  /** Positions the change declared outside its faces (patch and spine nodes). */
  readonly declaredPositions: readonly ConstructionPosition[];
}

export interface Effect {
  readonly kind: EffectKind;
  /** The transaction's cause id; reactions mint their own ids from it. */
  readonly causeId: string;
  readonly change: ShapeChange;
  /** The reaction that emitted this effect, excluded from receiving it. Absent for the first effect. */
  readonly emittedBy?: ReactionId;
}

/** How a reaction answered. */
export type ReactionOutcome =
  | {
      readonly kind: "done";
      /** Follow-up effects for the pipeline to dispatch in the same transaction. */
      readonly emitted?: readonly Effect[];
    }
  /** Aborts the whole transaction, every earlier step included. */
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * One declared reaction's implementation.
 *
 * It receives every hit face whose type declares this reaction for the
 * effect's kind -- a family answers once, across all its types -- and it may
 * mutate only through `context`, inside the pipeline's transaction. It never
 * calls another cloud's reaction: anything it causes elsewhere, it emits.
 */
export type Reaction<Context> = (
  context: Context,
  effect: Effect,
  hits: readonly ConstructionRegionTopology[],
) => ReactionOutcome;
