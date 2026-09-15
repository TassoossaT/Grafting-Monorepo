import type { Reaction, ReactionId } from "@/features/edit-construction";

import { latticeRegenerateReaction, type LatticeReactionRuntime } from "../terrain/terrain-lattice-reaction.ts";

/** What every tabletop reaction may read and mutate, inside the pipeline's transaction. */
export type TabletopReactionRuntime = LatticeReactionRuntime;

/**
 * The implementation behind every reaction name the type registry can
 * declare. Keyed by reaction, never by type: a new type answering like terrain
 * names `"lattice-regenerate"` and needs nothing here.
 */
export const TABLETOP_REACTIONS: Readonly<Record<ReactionId, Reaction<TabletopReactionRuntime>>> = Object.freeze({
  "lattice-regenerate": latticeRegenerateReaction(),
});
