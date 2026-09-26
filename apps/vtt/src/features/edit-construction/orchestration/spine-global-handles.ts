import type { ConstructionGraphSnapshot } from "@/ports";

import { spineGlobalHandleAt, spineGlobalHandles, type SpineGlobalHandle } from "../spine/index.ts";
import { structureTypeFor } from "../structure-types/index.ts";

/** Whether `handle`'s spine owner declares its kind. */
function declared(handle: SpineGlobalHandle): boolean {
  return handle.owner !== undefined && structureTypeFor(handle.owner)?.spine?.globalHandles?.includes(handle.kind) === true;
}

/** Every global handle a spine's owner declares -- what the scene shows and a spine tool may grab. */
export function shownSpineGlobalHandles(graph: ConstructionGraphSnapshot): readonly SpineGlobalHandle[] {
  return spineGlobalHandles(graph).filter(declared);
}

/** The global handle `id` names, where it stands now, if its owner declares it. */
export function shownSpineGlobalHandleAt(graph: ConstructionGraphSnapshot, id: string): SpineGlobalHandle | undefined {
  const handle = spineGlobalHandleAt(graph, id);
  return handle && declared(handle) ? handle : undefined;
}
