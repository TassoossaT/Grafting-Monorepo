import type { MoveNodeHistoryStack } from "@/features/edit-construction";
import type { ConstructionToolId, PreviewDescriptor, ToolParamsFor } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { TabletopRuntime } from "../tabletop-runtime.ts";

/** What the pointer resolved to at one instant -- `nodeId` present only when it hit a node handle. */
export interface PointerSample {
  readonly point: ConstructionPosition;
  readonly nodeId?: string;
}

/** A gesture in progress (or, for a stationary hover, one where `start === current`). */
export interface ToolGesture {
  readonly start: PointerSample;
  readonly current: PointerSample;
}

/** What every tool implementation is handed to act -- the runtime to call, undo/redo history for the one tool that uses it, and a salt generator so repeated commits never collide (mirrors `tabletop-entry.tsx`'s retired `generateCountRef`). */
export interface ToolContext {
  readonly runtime: TabletopRuntime;
  readonly history: MoveNodeHistoryStack;
  readonly tableId: string;
  /** A fresh integer each call, monotonically increasing for the runtime's lifetime -- feeds id-namespacing salts and cell/room indices, mirroring `tabletop-entry.tsx`'s retired `generateCountRef`. */
  nextSequence(): number;
  /** Reports the node a tool just selected/moved, for `SettingsDrawer`'s inspector. `undefined` clears the inspector. */
  reportSelection(info: { readonly id: string; readonly point: ConstructionPosition } | undefined): void;
}

/**
 * One construction tool's behavior, generic over its own parameter shape.
 * Every hook is optional -- a tool implements only the lifecycle stages it
 * actually uses (e.g. `room-stamp-tool.ts` has no `onPointerUp`, it commits
 * on `onClick`). `composition/tabletop/use-construction-pointer.ts` is the
 * only caller and never branches on `id` -- it just invokes whichever hook
 * the active tool defines.
 */
export interface ConstructionTool<Id extends ConstructionToolId> {
  readonly id: Id;
  defaultParams(): ToolParamsFor<Id>;
  /** The tool's not-yet-committed ghost for the current gesture (or stationary hover, when `gesture.start === gesture.current`). */
  previewFor?(gesture: ToolGesture, params: ToolParamsFor<Id>): PreviewDescriptor | undefined;
  /** Left-button press. Continuous tools (brushes, move-node) start their gesture here. */
  onPointerDown?(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void;
  /** Called while a gesture is active (left button held). Brushes that paint continuously (terrain) commit here, throttled by the dispatcher. */
  onPointerMove?(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** Gesture end. Tools that commit a single shape from a drag (wall, move-node's history entry) act here. */
  onPointerUp?(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** A press+release with no intervening drag. Batch/stamp tools (room) commit here instead of `onPointerUp`. */
  onClick?(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void;
}
