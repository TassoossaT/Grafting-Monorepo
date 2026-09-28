import type { BezierPort } from "@/ports";

import type { GlobalHandle, GlobalHandleEdit, GlobalHandleIntent, GlobalHandleProvider, GlobalHandleScene, HandleMotion } from "../../global-handles/index.ts";
import { isSpineControlNodeId, spineOwnerAt } from "../../spine/index.ts";
import { globalHandleOf } from "../../global-handles/index.ts";
import { structureTypeFor } from "../../structure-types/index.ts";
import { cloudHandleProvider } from "./cloud-handle-provider.ts";
import { endHandleProvider } from "./end-handle-provider.ts";
import { partHandleProvider } from "./part-handle-provider.ts";
import { uprightHandleProvider } from "./upright-handle-provider.ts";
import { detachHandleProvider } from "./detach-handle-provider.ts";
import { spineHandleProvider } from "./spine-handle-provider.ts";

/**
 * Every way structures are built has one provider of whole-structure
 * handles; this is the only place that lists them. What shows the handles,
 * and the gesture that drags them, only ever talk to this module.
 */
const PROVIDERS: readonly GlobalHandleProvider[] = [spineHandleProvider, cloudHandleProvider, endHandleProvider, partHandleProvider, uprightHandleProvider, detachHandleProvider];

/** Whether `handle`'s type declares its kind. */
function declared(handle: GlobalHandle): boolean {
  return structureTypeFor(handle.owner)?.globalHandles?.includes(handle.kind) === true;
}

/** Every global handle a type declares -- only those of types `owns` accepts, when given. */
export function shownGlobalHandles(scene: GlobalHandleScene, owns?: (surfaceType: string) => boolean): readonly GlobalHandle[] {
  return PROVIDERS.flatMap((provider) => provider.handles(scene)).filter((handle) => declared(handle) && (owns === undefined || owns(handle.owner)));
}

/** The shown global handle `id` names, where it stands now. */
export function shownGlobalHandleAt(scene: GlobalHandleScene, id: string): GlobalHandle | undefined {
  const named = globalHandleOf(id);
  if (!named) return undefined;
  const shown = shownGlobalHandles(scene);
  // The same id first: structures welded together share nodes, so another's
  // handle may also hold the node this one is named after.
  return shown.find((handle) => handle.id === id)
    ?? shown.find((handle) => handle.kind === named.kind && handle.nodeIds.includes(named.nodeId));
}

/** What `intent` on `handle` edits, from the provider that placed it. */
export function planGlobalHandle(scene: GlobalHandleScene, handle: GlobalHandle, intent: GlobalHandleIntent, port: Pick<BezierPort, "curveBatch">, operationId: string): GlobalHandleEdit | undefined {
  return PROVIDERS.find((provider) => provider.name === handle.provider)?.plan(scene, handle, intent, port, operationId);
}

/**
 * How the handle `id` moves while dragged, whatever it is: a whole-structure
 * handle says so itself; a spine's control point moves along the ground on a
 * spine whose owner derives its heights, and freely otherwise. `undefined`
 * for anything that is not a handle this knows.
 */
export function handleMotionAt(scene: GlobalHandleScene, id: string): HandleMotion | undefined {
  if (globalHandleOf(id)) return shownGlobalHandleAt(scene, id)?.motion;
  if (!isSpineControlNodeId(id)) return undefined;
  const owner = spineOwnerAt(scene.graph, id);
  return owner !== undefined && structureTypeFor(owner)?.spine?.planOnly === true ? { kind: "plane" } : { kind: "free" };
}
