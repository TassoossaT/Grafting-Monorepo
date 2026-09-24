"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { ConstructionToolId, EditHandle, EditHistoryStack, StructureEditParams, ToolParamsByTool } from "@/features/edit-construction";
import { TOOL_GHOST_PREVIEW_CHANNEL } from "@/ports";
import type { RenderViewId } from "@/ports";
import type { SelectedNodeInfo } from "@/widgets";

import { GRID_SNAP_UNIT } from "../../adapters/rendering/index.ts";
import { surfaceRefFromNodeSet } from "../../entities/map/index.ts";
import { describeHandle } from "../../features/edit-construction/index.ts";
import type { TabletopRuntime } from "./tabletop-runtime.ts";
import { toolFor } from "./tools/index.ts";
import {
  edgeOverlayChannel,
  edgeOverlayDescriptor,
  edgeOverlayOf,
} from "./tools/core/edge-overlay.ts";
import { CREATE_INTENT, resolveIntent, type EditIntent } from "./tools/core/edit-intent.ts";
import { gestureDragged } from "./tools/core/tool-context.ts";
import type { ConstructionTool, ConstructionToolFeedback, PointerSample, ToolContext } from "./tools/index.ts";

/** Caps how often a continuous tool's `onPointerMove` commits during an active drag -- the preview ghost still updates on every raw event, only the (comparatively expensive) generate/mutate call is rate-limited. */
const MOVE_COMMIT_THROTTLE_MS = 32;
const PREVIEW_THROTTLE_MS = 32;
/** How long a face keeps its handles after the pointer leaves it, so a handle sitting just off the face can still be reached. */
const FOCUS_GRACE_MS = 400;

export interface UseConstructionPointerOptions {
  readonly activeTool: ConstructionToolId;
  readonly toolParams: ToolParamsByTool;
  readonly runtime: TabletopRuntime;
  readonly history: EditHistoryStack;
  readonly tableId: string;
  readonly viewId: RenderViewId | undefined;
  /** When true, a resolved point (other than an existing node handle -- those stay precise) snaps to the nearest grid intersection before any tool sees it, so a new terrain cell/wall/room lands centered on the grid instead of wherever the pointer happened to be. */
  readonly snapToGrid: boolean;
  /** How a grab on an existing structure behaves -- ambient across every construction tool, not one tool's own params. See `ToolContext.structureEditParams`. */
  readonly structureEditParams: StructureEditParams;
  readonly onSelectionChange: (info: SelectedNodeInfo | undefined) => void;
  readonly onFeedbackChange: (feedback: ConstructionToolFeedback | undefined) => void;
}

function snappedTo(value: number, unit: number): number {
  return Math.round(value / unit) * unit;
}

/** A node-handle hit is never snapped -- moving an existing node stays precise; only newly-resolved ground points snap. */
function applySnap(sample: PointerSample, snapToGrid: boolean): PointerSample {
  if (!snapToGrid || sample.nodeId !== undefined) return sample;
  return {
    ...sample,
    point: { x: snappedTo(sample.point.x, GRID_SNAP_UNIT), y: sample.point.y, z: snappedTo(sample.point.z, GRID_SNAP_UNIT) },
  };
}

export interface ConstructionPointerHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** What a press at the pointer would do right now -- for a cursor that shows it. */
  readonly intent: () => EditIntent["kind"];
}

interface PointerPosition {
  readonly x: number;
  readonly y: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly captureTarget: HTMLElement;
  readonly start: PointerSample;
  last: PointerSample;
  readonly samples: PointerSample[];
  readonly intent: EditIntent;
  dragged: boolean;
}

/** The last hover, resolved once per frame: a press at the same spot on the same table executes it as is. */
interface ResolvedHover {
  readonly clientX: number;
  readonly clientY: number;
  readonly revision: number;
  readonly sample: PointerSample | undefined;
  readonly intent: EditIntent;
}

/** Which faces show their handles: the one under the pointer, the one being dragged, and the one just edited. */
interface HandleFocusState {
  hovered?: string;
  hoveredAt: number;
  grabbed?: string;
  lastEdited?: string;
}

function positionOf(event: { currentTarget: HTMLElement; clientX: number; clientY: number }): PointerPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY };
}

function faceOf(handle: EditHandle): string | undefined {
  const key = handle.owners.find((owner) => owner.surfaceKey !== undefined)?.surfaceKey;
  return key === undefined ? undefined : surfaceRefFromNodeSet(key);
}

/**
 * The generic pointer/effect dispatcher: owns the pointer gesture lifecycle
 * (down/move/up/cancel/click), the one click-versus-drag decision, the
 * hover's edit-or-create intent and the active tool's preview, but never
 * branches on *which* tool is active -- it only resolves what the pointer
 * hit, looks the active tool up in `tools/tool-registry.ts`, and calls
 * whichever lifecycle hook that tool defines. Per-tool behavior (what a
 * stroke or a click actually generates) lives entirely in `tools/*.ts`.
 */
export function useConstructionPointer(options: UseConstructionPointerOptions): ConstructionPointerHandlers {
  const gestureRef = useRef<ActiveGesture | null>(null);
  const suppressClickRef = useRef(false);
  const sequenceRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const lastPreviewAtRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** Channels the edge overlay currently occupies, so a redraw clears exactly what it drew. */
  const shownEdgeChannels = useRef(new Set<string>());
  const hoverRef = useRef<ResolvedHover | undefined>(undefined);
  const pendingHoverRef = useRef<PointerPosition | undefined>(undefined);
  const hoverFrameRef = useRef<number | undefined>(undefined);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusRef = useRef<HandleFocusState>({ hoveredAt: 0 });
  const describedRef = useRef<{ revision: number | undefined; handles: Map<string, EditHandle | undefined> }>({ revision: undefined, handles: new Map() });

  const nextSequence = useCallback(() => ++sequenceRef.current, []);

  const cancelHover = useCallback(() => {
    if (hoverFrameRef.current !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(hoverFrameRef.current);
    hoverFrameRef.current = undefined;
    pendingHoverRef.current = undefined;
    if (graceTimerRef.current !== undefined) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = undefined;
  }, []);

  const pushFocus = useCallback((highlighted?: string) => {
    const { hovered, grabbed, lastEdited } = focusRef.current;
    const surfaceRefs = [...new Set([hovered, grabbed, lastEdited].filter((ref): ref is string => ref !== undefined))];
    optionsRef.current.runtime.setHandleFocus?.({ surfaceRefs, highlighted });
  }, []);

  useEffect(() => {
    const active = gestureRef.current;
    if (active?.captureTarget.hasPointerCapture(active.pointerId)) active.captureTarget.releasePointerCapture(active.pointerId);
    gestureRef.current = null;
    lastCommitAtRef.current = 0;
    lastPreviewAtRef.current = 0;
    hoverRef.current = undefined;
    focusRef.current = { hoveredAt: 0 };
    options.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
    if (options.runtime.getSnapshot().status === "ready") pushFocus();
    return cancelHover;
  }, [options.activeTool, options.runtime, cancelHover, pushFocus]);

  const ctx = useMemo<ToolContext>(
    () => ({
      get runtime() {
        return optionsRef.current.runtime;
      },
      get history() {
        return optionsRef.current.history;
      },
      get tableId() {
        return optionsRef.current.tableId;
      },
      get snapToGrid() {
        return optionsRef.current.snapToGrid;
      },
      get structureEditParams() {
        return optionsRef.current.structureEditParams;
      },
      nextSequence,
      reportSelection: (info) => optionsRef.current.onSelectionChange(info),
      reportFeedback: (feedback) => optionsRef.current.onFeedbackChange(feedback),
    }),
    [nextSequence],
  );

  useEffect(() => {
    const tool = toolFor(options.activeTool);
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && tool.onCancel) {
        tool.onCancel(ctx);
        const active = gestureRef.current;
        if (active?.captureTarget.hasPointerCapture(active.pointerId)) active.captureTarget.releasePointerCapture(active.pointerId);
        gestureRef.current = null;
        suppressClickRef.current = true;
        focusRef.current.grabbed = undefined;
        options.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && tool.onDeleteKey) {
        tool.onDeleteKey(ctx);
      }
    };
    window.addEventListener("keydown",cancel);
    return () => {
      window.removeEventListener("keydown",cancel); tool.onCancel?.(ctx);
      const active = gestureRef.current;
      if (active?.captureTarget.hasPointerCapture(active.pointerId)) active.captureTarget.releasePointerCapture(active.pointerId);
      gestureRef.current = null;
    };
  },[options.activeTool,options.runtime,ctx]);

  /**
   * Redraws the construction-edge overlay from whatever is now standing.
   *
   * Here rather than inside any one tool: an edge belongs to the table, not
   * to whichever tool happened to draw it, so a wall's posts show while the
   * path brush is selected and vice versa. Refreshed after a commit and on
   * tool change -- nothing about the graph moves in between -- and each role
   * gets its own channel, which leaves the tool's own ghost untouched.
   */
  const refreshEdgeOverlay = useCallback((): void => {
    const { runtime } = optionsRef.current;
    // Nothing to read, and nothing to draw on, until the table is live. The
    // mount effect below runs before the runtime finishes loading, and asking
    // it for topologies then is an error rather than an empty answer.
    if (runtime.getSnapshot().status !== "ready") return;
    for (const channel of shownEdgeChannels.current) runtime.clearPreview(channel);
    shownEdgeChannels.current.clear();
    for (const group of edgeOverlayOf(runtime, runtime.getAllRegionTopologies(), runtime.getGraphSnapshot(), runtime)) {
      if (group.positions.length === 0) continue;
      const channel = edgeOverlayChannel(group.role);
      runtime.showPreview(edgeOverlayDescriptor(group), channel);
      shownEdgeChannels.current.add(channel);
    }
  }, []);

  // Draw what is already standing as soon as the table is live, not only
  // after the first commit -- an edge that was there before this session
  // began is exactly as worth seeing as one just drawn. The runtime is still
  // loading at mount, so this waits for it rather than asking too early.
  useEffect(() => {
    const { runtime } = optionsRef.current;
    refreshEdgeOverlay();
    let drawn = runtime.getSnapshot().status === "ready";
    const unsubscribe = runtime.subscribe(() => {
      if (drawn || runtime.getSnapshot().status !== "ready") return;
      drawn = true;
      refreshEdgeOverlay();
    });
    return unsubscribe;
  }, [options.runtime, refreshEdgeOverlay]);

  const sampleAt = useCallback(
    (position: PointerPosition): PointerSample | undefined => {
      const { viewId, runtime, snapToGrid, activeTool } = optionsRef.current;
      if (viewId === undefined) return undefined;
      const hit = runtime.pick(viewId, position.x, position.y);
      if (hit === undefined) return undefined;
      const snap = snapToGrid && !toolFor(activeTool).snapsToSurface;
      return { ...applySnap(hit, snap), screenY: position.clientY, screenX: position.clientX };
    },
    [],
  );

  /** What a press at `sample` does with `tool`: a handle's description is read once per table revision. */
  const intentFor = useCallback((tool: ConstructionTool<ConstructionToolId>, sample: PointerSample): EditIntent => {
    const { runtime } = optionsRef.current;
    return resolveIntent(sample, tool.editableType, (id) => {
      const described = describedRef.current;
      const revision = runtime.getSnapshot().revision;
      if (described.revision !== revision) {
        described.revision = revision;
        described.handles.clear();
      }
      if (!described.handles.has(id)) described.handles.set(id, describeHandle(runtime, id, sample.point));
      return described.handles.get(id);
    });
  }, []);

  /** The face `sample` landed on, when the active tool edits its type. */
  const ownedFaceAt = useCallback((tool: ConstructionTool<ConstructionToolId>, sample: PointerSample | undefined): string | undefined => {
    const surfaceRef = sample?.surfaceRef;
    if (tool.editableType === undefined || surfaceRef === undefined) return undefined;
    const type = optionsRef.current.runtime.getSnapshot().map.byId?.get(surfaceRef)?.type;
    return type !== undefined && tool.editableType(type) ? surfaceRef : undefined;
  }, []);

  const scheduleHover = useCallback((position: PointerPosition) => {
    pendingHoverRef.current = position;
    if (hoverFrameRef.current !== undefined) return;
    const run = () => {
      hoverFrameRef.current = undefined;
      const pending = pendingHoverRef.current;
      pendingHoverRef.current = undefined;
      if (pending !== undefined) resolveHover(pending);
    };
    if (typeof requestAnimationFrame === "function") hoverFrameRef.current = requestAnimationFrame(run);
    else run();
  }, []);

  /**
   * Decides, once per frame, what a press here would do, and shows it: the
   * handle it would grab lights up with no creation ghost, or the creation
   * ghost shows with no handle lit. The press then executes exactly this.
   */
  const resolveHover = useCallback((position: PointerPosition): void => {
    const { runtime, activeTool, toolParams } = optionsRef.current;
    const tool = toolFor(activeTool);
    const sample = sampleAt(position);
    const intent = sample === undefined ? CREATE_INTENT : intentFor(tool, sample);
    hoverRef.current = { clientX: position.clientX, clientY: position.clientY, revision: runtime.getSnapshot().revision, sample, intent };

    const focus = focusRef.current;
    const now = performance.now();
    const face = intent.kind === "edit" ? faceOf(intent.target) ?? focus.hovered : ownedFaceAt(tool, sample);
    if (graceTimerRef.current !== undefined) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = undefined;
    if (face !== undefined) {
      focus.hovered = face;
      focus.hoveredAt = now;
    } else if (focus.hovered !== undefined && now - focus.hoveredAt >= FOCUS_GRACE_MS) {
      focus.hovered = undefined;
    } else if (focus.hovered !== undefined) {
      graceTimerRef.current = setTimeout(() => scheduleHover(position), FOCUS_GRACE_MS);
    }
    pushFocus(intent.kind === "edit" ? intent.target.id : undefined);

    const descriptor = intent.kind === "create" && tool.previewOnHover && sample !== undefined
      ? tool.previewFor?.({ start: sample, current: sample, samples: [sample] }, toolParams[activeTool] as never, ctx)
      : undefined;
    if (descriptor) runtime.showPreview(descriptor, TOOL_GHOST_PREVIEW_CHANNEL);
    else runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
  }, [ctx, intentFor, ownedFaceAt, pushFocus, sampleAt, scheduleHover]);

  /**
   * Shows the preview for the very first sample of a gesture, right as it
   * starts (`onPointerDown`). Idle hovering has its own path above
   * (`resolveHover`), which only a tool that opts into `previewOnHover` or
   * edits a type ever takes.
   */
  const showStartPreview = useCallback((sample: PointerSample | undefined) => {
    const { runtime, activeTool, toolParams } = optionsRef.current;
    const tool = toolFor(activeTool);
    if (sample === undefined || tool.previewFor === undefined) {
      runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
      return;
    }
    const now = performance.now();
    if (now - lastPreviewAtRef.current < PREVIEW_THROTTLE_MS) return;
    lastPreviewAtRef.current = now;
    const params = toolParams[activeTool];
    const descriptor = tool.previewFor({ start: sample, current: sample, samples: [sample] }, params as never, ctx);
    if (descriptor === undefined) runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
    else runtime.showPreview(descriptor, TOOL_GHOST_PREVIEW_CHANNEL);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // The right and middle buttons are reserved for camera orbit/pan
      // (see `features/navigate-camera`) -- only the left button drives tools.
      if (event.button !== 0) return;
      suppressClickRef.current = false;
      cancelHover();
      const position = positionOf(event);
      const sample = sampleAt(position);
      if (sample === undefined) return;

      const { activeTool, toolParams, runtime } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;
      lastPreviewAtRef.current = 0;

      const hover = hoverRef.current;
      const intent = hover !== undefined
        && hover.clientX === position.clientX && hover.clientY === position.clientY
        && hover.revision === runtime.getSnapshot().revision
        && hover.sample?.nodeId === sample.nodeId
        ? hover.intent
        : intentFor(tool, sample);
      if (intent.kind === "edit") {
        focusRef.current.grabbed = faceOf(intent.target) ?? focusRef.current.hovered;
        pushFocus(intent.target.id);
      }

      // Only tools that actually react to a drag capture the pointer --
      // a click-only tool leaves the native click gesture alone.
      if (tool.onPointerMove !== undefined || tool.onPointerUp !== undefined) {
        gestureRef.current = { pointerId: event.pointerId, captureTarget: event.currentTarget, start: sample, last: sample, samples: [sample], intent, dragged: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      tool.onPointerDown?.(ctx, sample, params, intent);
      showStartPreview(sample);
    },
    [cancelHover, ctx, intentFor, pushFocus, sampleAt, showStartPreview],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;

      if (gesture === null || gesture.pointerId !== event.pointerId) {
        if (!tool.previewOnHover && tool.editableType === undefined) {
          optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
          return;
        }
        scheduleHover(positionOf(event));
        return;
      }

      const sample = sampleAt(positionOf(event));
      if (sample === undefined) return; // pointer strayed off pickable geometry -- freeze at the last resolved position, same posture as before this refactor.
      gesture.last = sample;
      const previous = gesture.samples[gesture.samples.length - 1];
      if (previous === undefined || previous.point.x !== sample.point.x || previous.point.y !== sample.point.y || previous.point.z !== sample.point.z) {
        gesture.samples.push(sample);
      }
      gesture.dragged ||= gestureDragged({ start: gesture.start, current: sample, samples: [] });
      const activeGesture = { start: gesture.start, current: sample, samples: gesture.samples, dragged: gesture.dragged };

      const now = performance.now();
      if (now - lastPreviewAtRef.current >= PREVIEW_THROTTLE_MS) {
        lastPreviewAtRef.current = now;
        const descriptor = tool.previewFor?.(activeGesture, params, ctx);
        if (descriptor === undefined) optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
        else optionsRef.current.runtime.showPreview(descriptor, TOOL_GHOST_PREVIEW_CHANNEL);
      }
      if (now - lastCommitAtRef.current < MOVE_COMMIT_THROTTLE_MS) return;
      lastCommitAtRef.current = now;
      tool.onPointerMove?.(ctx, activeGesture, params);
    },
    [ctx, sampleAt, scheduleHover],
  );

  const finishGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (gesture === null || gesture.pointerId !== event.pointerId) return;
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;

      const position = positionOf(event);
      const released = sampleAt(position);
      if (released && (released.point.x !== gesture.last.point.x || released.point.y !== gesture.last.point.y || released.point.z !== gesture.last.point.z)) {
        gesture.last = released; gesture.samples.push(released);
      }
      gesture.dragged ||= gestureDragged({ start: gesture.start, current: gesture.last, samples: gesture.samples });
      // A press that edited owns its trailing click too, drag or not.
      suppressClickRef.current = gesture.dragged || gesture.intent.kind === "edit";
      tool.onPointerUp?.(ctx, { start: gesture.start, current: gesture.last, samples: gesture.samples, dragged: gesture.dragged }, params);
      gestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const focus = focusRef.current;
      if (gesture.intent.kind === "edit") {
        focus.lastEdited = focus.grabbed;
        focus.grabbed = undefined;
      }
      optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
      refreshEdgeOverlay();
      if (tool.previewOnHover || tool.editableType !== undefined) scheduleHover(position);
    },
    [ctx, refreshEdgeOverlay, sampleAt, scheduleHover],
  );

  const cancelGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    toolFor(optionsRef.current.activeTool).onCancel?.(ctx);
    suppressClickRef.current = true;
    focusRef.current.grabbed = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
  }, [ctx]);

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      if (tool.onClick === undefined) return;
      const sample = sampleAt(positionOf(event));
      if (sample === undefined) return;
      tool.onClick(ctx, sample, toolParams[activeTool] as never);
      refreshEdgeOverlay();
    },
    [ctx, refreshEdgeOverlay, sampleAt],
  );

  const intent = useCallback(() => hoverRef.current?.intent.kind ?? "create", []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishGesture,
    onPointerCancel: cancelGesture,
    onClick,
    intent,
  };
}
