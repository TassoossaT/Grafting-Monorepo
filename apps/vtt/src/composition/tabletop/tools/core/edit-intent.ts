import type { EditHandle } from "../../../../features/edit-construction/index.ts";

import type { PointerSample } from "./tool-context.ts";

/**
 * What a press at the pointer would do: edit through the handle it is over,
 * or create. Decided once, from the hover, so what the pointer shows before
 * the press is exactly what the press does.
 */
export type EditIntent =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly target: EditHandle };

export const CREATE_INTENT: EditIntent = Object.freeze({ kind: "create" });

/**
 * Edit only when the sample hit an edit handle of a structure `ownsType`
 * accepts; anything else -- a face, an edge, open ground, another type's
 * handle -- creates. `describe` says what a hit handle id edits.
 */
export function resolveIntent(
  sample: Pick<PointerSample, "nodeId">,
  ownsType: ((surfaceType: string) => boolean) | undefined,
  describe: (handleId: string) => EditHandle | undefined,
): EditIntent {
  if (ownsType === undefined || sample.nodeId === undefined) return CREATE_INTENT;
  const handle = describe(sample.nodeId);
  if (handle === undefined) return CREATE_INTENT;
  const owners = handle.owners.filter((owner) => ownsType(owner.surfaceType));
  if (owners.length === 0) return CREATE_INTENT;
  return { kind: "edit", target: owners.length === handle.owners.length ? handle : { ...handle, owners } };
}
