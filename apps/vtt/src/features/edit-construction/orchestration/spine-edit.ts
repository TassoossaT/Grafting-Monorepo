import type { ConstructionRegionTopology } from "@/ports";

import { curvePick, planSpineEditPatch, spineOwnerAt, type SpineEditInput } from "../spine/index.ts";
import { structureTypeFor } from "../structure-types/index.ts";
import type { FieldPort } from "../structure-types/path/contour/curve-projection.ts";

/**
 * One spine gesture, end to end: the spine module says what the gesture does
 * to the curve, and the structure type that owns the spine regenerates its
 * surface from that. A road, a sloped platform and any future curve-built
 * type are edited by exactly the same handles; only the last step differs.
 */
export function planBezierEdit(input: SpineEditInput & {
  readonly topologies: readonly ConstructionRegionTopology[];
  /** The engine, which elevates every contour vertex the plan-view union hands back flat. */
  readonly field: FieldPort;
  readonly tableId: string;
}): { request: import("@/ports").ApplyPatchReplacementRequest; preview: Float32Array; selectedId: string } | undefined {
  const owner = spineOwnerAt(input.snapshot, curvePick(input.targetId)?.edgeId ?? input.targetId);
  const generation = owner === undefined ? undefined : structureTypeFor(owner)?.spine;
  if (generation === undefined) return undefined;
  const snapshot = generation.prepare?.(input.snapshot, input.port) ?? input.snapshot;
  const edit = planSpineEditPatch({ ...input, snapshot });
  if (edit === undefined) return undefined;
  const regenerated = generation.regenerate({
    snapshot, graphPatch: edit.graphPatch, topologies: input.topologies, port: input.port, field: input.field, operationId: input.operationId, tableId: input.tableId,
  });
  return regenerated && { ...regenerated, selectedId: edit.selectedId };
}
