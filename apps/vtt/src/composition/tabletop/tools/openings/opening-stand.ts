import type { OpeningShape } from "@/features/edit-construction";
import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { ToolContext } from "../core/tool-context.ts";
import type { OpeningCommit } from "./opening-shared.ts";

/** An opening's size and outline, in world units, as a stand is asked to hold it. */
export interface StandLook {
  readonly width: number;
  readonly height: number;
  readonly shape: OpeningShape;
  readonly isDoor: boolean;
}

/**
 * A face an opening cannot be cut into as it lies -- a sloped leaf -- but
 * that can raise an upright stand to hold one: the stand exists only for
 * its opening, follows it when it moves or changes size, and goes with it.
 * Each call is one transaction, the stand and the opening together.
 */
export interface OpeningStand {
  /** Whether a press on `face` raises a stand there. */
  raisesOn(face: ConstructionRegionTopology): boolean;
  /** The outline, in world space, an opening of `look` raised on `face` at `at` would stand on. */
  outline(face: ConstructionRegionTopology, at: ConstructionPosition, look: StandLook): readonly ConstructionPosition[] | undefined;
  /** Raises a stand on `face` at `at` and places an opening of `look` in it. */
  raise(ctx: ToolContext, causeId: string, face: ConstructionRegionTopology, at: ConstructionPosition, look: StandLook): OpeningCommit;
  /** Whether the face `host` is one of this kind's stands. */
  holds(ctx: ToolContext, host: ConstructionSurfaceKey): boolean;
  /** Remakes the stand at `host` for its opening, now `look`, moved by `shift` in plan. */
  refit(ctx: ToolContext, causeId: string, pieces: readonly ConstructionSurfaceKey[], host: ConstructionSurfaceKey, look: StandLook, shift: { readonly x: number; readonly z: number }): OpeningCommit;
  /** Removes the opening and the stand at `host` holding it. */
  drop(ctx: ToolContext, causeId: string, pieces: readonly ConstructionSurfaceKey[], host: ConstructionSurfaceKey): OpeningCommit;
}
