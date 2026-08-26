import type { PathBrushEffect } from "../../modes/surface-edit-contract.ts";
import type { ConstructionPosition } from "@/ports";
import type { SweptArc } from "../../topology/index.ts";

import { pathCorridorId } from "./path-corridor.ts";

/**
 * The path-owned input to contour generation.
 *
 * A brush effect is intent; this is the semantic spine it creates from the
 * resolved reference line. Keeping the corridor identity and cross-section
 * here prevents an interaction tool or the contour engine from inventing
 * their own path model.
 */
export interface PathSpineDraft {
  readonly corridorId: string;
  readonly controlPoints: readonly ConstructionPosition[];
  readonly bandOffsets: readonly number[];
  readonly miterLimit: number;
  /** The true circle (if any) each span of `controlPoints` runs on -- {@link referenceLineFrom}'s own reading of the stroke fit, carried rather than re-derived. */
  readonly arcs: readonly (SweptArc | undefined)[];
}

/**
 * Resolves the path-specific spine and profile from an immutable effect.
 *
 * The caller owns fitting a gesture into a reference line; this type owns
 * what that line means as a path corridor and which bands it must generate.
 */
export function pathSpineDraftFor(
  effect: PathBrushEffect,
  controlPoints: readonly ConstructionPosition[],
  arcs: readonly (SweptArc | undefined)[] = [],
): PathSpineDraft | undefined {
  if (controlPoints.length < 2) return undefined;
  return Object.freeze({
    corridorId: pathCorridorId(effect.operationId, effect.parameters.kind),
    controlPoints: Object.freeze([...controlPoints]),
    bandOffsets: Object.freeze(effect.parameters.profile.map((point) => point.lateralOffset)),
    miterLimit: effect.parameters.miterLimit,
    arcs: Object.freeze([...arcs]),
  });
}
