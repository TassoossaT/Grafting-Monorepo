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

/** An opening as its stand will hold it: where its front's middle stands, and its size, already stopped by the face. */
export interface StandPlacement {
  readonly at: ConstructionPosition;
  readonly look: StandLook;
}

/**
 * A face an opening cannot be cut into as it lies -- a sloped leaf -- but
 * that can raise an upright stand to hold one: the stand exists only for
 * its opening, follows it when it moves or changes size, and goes with it.
 *
 * The face stops an opening where it has no more room, the way a wall
 * stops one at its ends: every placement comes back already stopped, and
 * the preview shows exactly what the commit makes -- never an error for
 * having gone too far.
 */
export interface OpeningStand {
  /** Whether a press on `face` raises a stand there. */
  raisesOn(face: ConstructionRegionTopology): boolean;
  /** An opening of `look` at `at` on `face`, stopped by the face; `undefined` where not even the smallest fits. */
  fitted(face: ConstructionRegionTopology, at: ConstructionPosition, look: StandLook): StandPlacement | undefined;
  /** The opening a drag from `from` to `to` over `face` draws corner to corner, as on a wall -- stopped by the face. */
  drawn(face: ConstructionRegionTopology, from: ConstructionPosition, to: ConstructionPosition, shape: OpeningShape, isDoor: boolean): StandPlacement | undefined;
  /** The world outline an opening `placed` on `face` stands on. */
  outline(face: ConstructionRegionTopology, placed: StandPlacement): readonly ConstructionPosition[] | undefined;
  /** The world outline the opening at `host` would stand on, now `look` and moved by `shift` -- stopped by its face. */
  refitOutline(ctx: ToolContext, host: ConstructionSurfaceKey, look: StandLook, shift: { readonly x: number; readonly z: number }): readonly ConstructionPosition[] | undefined;
  /** Raises a stand on `face` for the opening `placed`, and places it there. One transaction. */
  raise(ctx: ToolContext, causeId: string, face: ConstructionRegionTopology, placed: StandPlacement): OpeningCommit;
  /** Whether the face `host` is one of this kind's stands. */
  holds(ctx: ToolContext, host: ConstructionSurfaceKey): boolean;
  /** Remakes the stand at `host` for its opening, now `look` and moved by `shift` -- stopped by its face. One transaction. */
  refit(ctx: ToolContext, causeId: string, pieces: readonly ConstructionSurfaceKey[], host: ConstructionSurfaceKey, look: StandLook, shift: { readonly x: number; readonly z: number }): OpeningCommit;
  /** Removes the opening and the stand at `host` holding it. One transaction. */
  drop(ctx: ToolContext, causeId: string, pieces: readonly ConstructionSurfaceKey[], host: ConstructionSurfaceKey): OpeningCommit;
}
