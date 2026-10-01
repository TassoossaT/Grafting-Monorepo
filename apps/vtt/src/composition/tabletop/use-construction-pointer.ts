"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { ConstructionToolId, EditHistoryStack, MeasureUnitId, RulerSettings, StructureEditParams, ToolParamsByTool } from "@/features/edit-construction";
import { TOOL_GHOST_PREVIEW_CHANNEL } from "@/ports";
import type { ConstructionPosition, RenderViewId } from "@/ports";
import type { SelectedNodeInfo } from "@/widgets";

import { VIEW_FOV_DEGREES } from "../../adapters/rendering/index.ts";
import type { TabletopRuntime } from "./tabletop-runtime.ts";
import { nodeByGeometry } from "./tools/core/node-identity.ts";
import { metersPerPixelAt } from "./tools/core/pointer-scale.ts";
import { createRulerSession } from "./tools/core/ruler-session.ts";
import { NO_FEEDBACK, rulerOf, type RulerFeedback } from "./tools/core/ruler.ts";
import { RULER_PREVIEW_CHANNEL, rulerLabels, rulerPreview } from "./tools/core/ruler-preview.ts";
import { mapLabelsOf } from "./tools/core/ruler-labels.ts";
import { toolFor } from "./tools/index.ts";
import { beginCurveGesture, type CurveGesture } from "./tools/core/curve-edit-gesture.ts";
import { DEFAULT_RULER_SETTINGS, FINE_ANGLE_STEP, HANDLE_REFERENCE, MEASURE_UNITS, lengthStepOf, carriesArrows, faceKey, globalHandleOf, handleMotionAt, shownGlobalHandleAt, toMetres } from "../../features/edit-construction/index.ts";
import { gestureMoved, nextClickRun, type ClickRun } from "./tools/core/tool-context.ts";
import { withFacePlane } from "./tools/core/pointer-ray.ts";
import { handleFocusAt, NO_FOCUS, sameFocus } from "./tools/core/handle-focus.ts";
import type { HandleFocus } from "../../features/edit-construction/index.ts";
import {
  edgeOverlayChannel,
  edgeOverlayDescriptor,
  edgeOverlayOf,
} from "./tools/core/edge-overlay.ts";
import type { ConstructionToolFeedback, PointerSample, ToolContext } from "./tools/index.ts";

/**
 * A handle the scene's free 3D arrows can sit on -- one whose own motion is
 * free (`HandleMotion`) -- where it is now. A handle kept to a path gets none.
 */
function spineHandleAt(runtime: Pick<TabletopRuntime, "getGraphSnapshot" | "getAllRegionTopologies" | "cloudFor">, id: string): { readonly id: string; readonly position: { x: number; y: number; z: number } } | undefined {
  const graph = runtime.getGraphSnapshot();
  const scene = { graph, topologies: runtime.getAllRegionTopologies(), cloudFor: (request: Parameters<TabletopRuntime["cloudFor"]>[0]) => runtime.cloudFor(request) };
  const motion = handleMotionOf(runtime, id);
  if (!motion || !carriesArrows(motion)) return undefined;
  if (globalHandleOf(id)) {
    const handle = shownGlobalHandleAt(scene, id);
    return handle && { id: handle.id, position: handle.position };
  }
  const node = graph.nodes.find((n) => n.id === id);
  return node && { id: node.id, position: node.position };
}

/** How the handle `id` may move, as the scene stands. */
function handleMotionOf(runtime: Pick<TabletopRuntime, "getGraphSnapshot" | "getAllRegionTopologies" | "cloudFor">, id: string): ReturnType<typeof handleMotionAt> {
  const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (request: Parameters<TabletopRuntime["cloudFor"]>[0]) => runtime.cloudFor(request) };
  return handleMotionAt(scene, id);
}

/** Caps how often a continuous tool's `onPointerMove` commits during an active drag -- the preview ghost still updates on every raw event, only the (comparatively expensive) generate/mutate call is rate-limited. */
const MOVE_COMMIT_THROTTLE_MS = 32;
const PREVIEW_THROTTLE_MS = 32;
/** How often hovering re-reads which structure's handles show. */
const FOCUS_THROTTLE_MS = 50;

/** The ruler's words for the point under the pointer, with where the pointer is on screen. */
export interface RulerReadout {
  readonly labels: readonly string[];
  readonly x: number;
  readonly y: number;
}

/** How soon the ruler is asked again while the pointer merely hovers, in milliseconds. */
const RULER_HOVER_MS = 32;
const DEGREE = Math.PI / 180;
/** The round number as a ruling option -- nothing when the table chose none. */
const lengthStepOption = (setting: typeof DEFAULT_RULER_SETTINGS.lengthStep, metersPerPixel: number | undefined, unit: MeasureUnitId): { lengthStep?: number } => {
  const step = lengthStepOf(setting, metersPerPixel, unit);
  return step === undefined ? {} : { lengthStep: step };
};

/** What the ruler offers when no settings are given: the table's defaults, but no round number -- the app always gives settings, so this is the harness. */
const UNSET_RULER_SETTINGS = { ...DEFAULT_RULER_SETTINGS, lengthStep: 0 } as const;
/** The channel the numbers written on the map go to, beside the ruler's lines. */
const RULER_LABELS_CHANNEL = "ruler-labels";

export interface UseConstructionPointerOptions {
  readonly activeTool: ConstructionToolId;
  readonly toolParams: ToolParamsByTool;
  readonly runtime: TabletopRuntime;
  readonly history: EditHistoryStack;
  readonly tableId: string;
  readonly viewId: RenderViewId | undefined;
  /** The unit the ruler writes its distances in -- the table's own choice. */
  readonly measureUnit: MeasureUnitId;
  /** What the table asks of its ruler: what catches, the angle's step and the round number a length lands on. */
  readonly rulerSettings?: RulerSettings;
  /** What the ruler says in words, and where the pointer is on screen; `undefined` when there is nothing to say. */
  readonly onRulerReadout?: (readout: RulerReadout | undefined) => void;
  /** How a grab on an existing structure behaves -- ambient across every construction tool, not one tool's own params. See `ToolContext.structureEditParams`. */
  readonly structureEditParams: StructureEditParams;
  /** Whether the table's edges are drawn, role by role: a view for reading the topology, which changes no tool. Drawn when absent. */
  readonly edgeOverlay?: boolean;
  readonly onSelectionChange: (info: SelectedNodeInfo | undefined) => void;
  readonly onFeedbackChange: (feedback: ConstructionToolFeedback | undefined) => void;
  /** Lets a tool rewrite its own params, e.g. to show its selection's settings in the panel. */
  readonly onToolParamsUpdate?: <Id extends ConstructionToolId>(toolId: Id, update: (current: ToolParamsByTool[Id]) => ToolParamsByTool[Id]) => void;
}

export interface ConstructionPointerHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly captureTarget: HTMLElement;
  readonly start: PointerSample;
  /** Whether the ruler counts from where this gesture began: yes for a line drawn, and for a handle that moves freely; no for one held to a line. */
  readonly rulesFrom: boolean;
  last: PointerSample;
  readonly samples: PointerSample[];
}

function pointerOffset(event: { currentTarget: HTMLElement; clientX: number; clientY: number }): {
  x: number;
  y: number;
} {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * The generic pointer/effect dispatcher: owns the pointer gesture lifecycle
 * (down/move/up/cancel/click) and the active tool's preview, but never
 * branches on *which* tool is active -- it only resolves what the pointer
 * hit, looks the active tool up in `tools/tool-registry.ts`, and calls
 * whichever lifecycle hook that tool defines. Per-tool behavior (what a
 * stroke or a click actually generates) lives entirely in `tools/*.ts`.
 */
export function useConstructionPointer(options: UseConstructionPointerOptions): ConstructionPointerHandlers {
  const gestureRef = useRef<ActiveGesture | null>(null);
  const suppressClickRef = useRef(false);
  /** The run of quick clicks the last releases made -- what tells a double-click. */
  const clickRunRef = useRef<ClickRun | undefined>(undefined);
  const sequenceRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const lastPreviewAtRef = useRef(0);
  /** Whose handles show, for a tool that edits only by handles -- `undefined` for any other tool. */
  const focusRef = useRef<HandleFocus | undefined>(undefined);
  const lastFocusAtRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** What stands, as links -- read once until the table changes. */
  const ruler = useMemo(() => createRulerSession(() => optionsRef.current.runtime.getAllRegionTopologies()), []);
  /** What the ruler shows for the point it last ruled. */
  const feedbackRef = useRef<RulerFeedback>(NO_FEEDBACK);
  useEffect(() => ruler.invalidate(), [ruler, options.runtime]);
  const lastRulerAtRef = useRef(0);
  /** Ctrl held: the pointer places freely, what the ruler catches shown but not taken. */
  const freeHandRef = useRef(false);
  /** How many metres a pixel of the screen is at the pointer: what the ruler's reach is worked out from. */
  const metersPerPixelRef = useRef<number | undefined>(undefined);
  /** The angular step the protractor is offering now, in radians: the table's, or the finer one while Shift is held. */
  const angleStepRef = useRef(DEFAULT_RULER_SETTINGS.angleStep * DEGREE);
  /** The length typed while drawing, as the digits written so far. */
  const typedRef = useRef("");
  /** Takes a key as a digit of that length; `true` when it was one. Set below, where the pointer's own move is known. */
  const typeKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  /** Where the pointer last was on screen, for what a tool asks the ruler to show. */
  const pointerAtRef = useRef({ clientX: 0, clientY: 0 });

  /** Draws what the ruler caught for the last point it ruled, and says its distances. */
  const showRuler = useCallback((event: { clientX: number; clientY: number }): void => {
    try {
      drawRuler(event);
    } catch (error) {
      // What the ruler shows is never worth the gesture: say so, and carry on.
      console.error("ruler: could not be drawn", error);
    }
  }, []);

  const drawRuler = (event: { clientX: number; clientY: number }): void => {
    const { runtime, measureUnit, onRulerReadout } = optionsRef.current;
    const feedback = feedbackRef.current;
    const settings = optionsRef.current.rulerSettings ?? UNSET_RULER_SETTINGS;
    const step = lengthStepOf(settings.lengthStep, metersPerPixelRef.current, measureUnit);
    const view = {
      unit: measureUnit,
      ...(step !== undefined ? { lengthStep: step } : {}),
      angleStep: angleStepRef.current,
      protractor: !settings.disabled.has("polar"),
      numbers: settings.numbers,
    };
    const descriptor = rulerPreview(feedback, metersPerPixelRef.current, view);
    if (descriptor) runtime.showPreview(descriptor, RULER_PREVIEW_CHANNEL);
    else runtime.clearPreview(RULER_PREVIEW_CHANNEL);
    // The same lines, numbered where they are: the values at the teeth, along the line, round the protractor.
    const written = mapLabelsOf(feedback, metersPerPixelRef.current, view);
    if (written.length > 0) runtime.showLabels?.(written, RULER_LABELS_CHANNEL);
    else runtime.clearPreview(RULER_LABELS_CHANNEL);
    // What is being typed leads: it is what the next release will draw.
    const typed = typedRef.current === "" ? [] : [`digitando ${typedRef.current}${(MEASURE_UNITS[measureUnit] ?? MEASURE_UNITS.m).symbol}`];
    const labels = [...typed, ...rulerLabels(feedback, measureUnit)];
    onRulerReadout?.(labels.length > 0 ? { labels, x: event.clientX, y: event.clientY } : undefined);
  };

  const clearRuler = useCallback((): void => {
    feedbackRef.current = NO_FEEDBACK;
    typedRef.current = "";
    ruler.release();
    optionsRef.current.runtime.clearPreview(RULER_PREVIEW_CHANNEL);
    optionsRef.current.runtime.clearPreview(RULER_LABELS_CHANNEL);
    optionsRef.current.onRulerReadout?.(undefined);
  }, [ruler]);
  /** Channels the edge overlay currently occupies, so a redraw clears exactly what it drew. */
  const shownEdgeChannels = useRef(new Set<string>());
  const manipulatorGesture = useRef<CurveGesture | undefined>(undefined);
  const selectedPoint = useRef<string | undefined>(undefined);

  const nextSequence = useCallback(() => ++sequenceRef.current, []);

  useEffect(() => {
    const active = gestureRef.current;
    if (active?.captureTarget.hasPointerCapture(active.pointerId)) active.captureTarget.releasePointerCapture(active.pointerId);
    gestureRef.current = null;
    lastCommitAtRef.current = 0;
    lastPreviewAtRef.current = 0;
    options.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
    clearRuler();
  }, [options.activeTool, options.runtime, clearRuler]);



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
      // The ruler is always on while building and what it catches is taken; holding Ctrl places freely.
      get rulerSnap() {
        return !freeHandRef.current;
      },
      get rulerMetersPerPixel() {
        return metersPerPixelRef.current;
      },
      get rulerDisabled() {
        return optionsRef.current.rulerSettings?.disabled;
      },
      get rulerAngleStep() {
        return angleStepRef.current;
      },
      get rulerLengthStep() {
        const { rulerSettings, measureUnit } = optionsRef.current;
        return rulerSettings ? lengthStepOf(rulerSettings.lengthStep, metersPerPixelRef.current, measureUnit) : undefined;
      },
      get structureEditParams() {
        return optionsRef.current.structureEditParams;
      },
      nextSequence,
      showRuler: (feedback) => {
        feedbackRef.current = feedback ?? NO_FEEDBACK;
        showRuler(pointerAtRef.current);
      },
      reportSelection: (info) => {
        const { runtime, viewId, activeTool } = optionsRef.current;
        optionsRef.current.onSelectionChange(info);
        if (viewId === undefined) return;
        const node = info && toolFor(activeTool).handlePresentation === "spine-points" ? spineHandleAt(runtime, info.id) : undefined;
        selectedPoint.current = node?.id;
        runtime.setPointManipulator?.(viewId, node ? {
          id: node.id, position: node.position,
          onChange(phase, position) {
            if (phase === "start") {
              manipulatorGesture.current?.cancel();
              const snap = toolFor(optionsRef.current.activeTool).anchorSnap;
              manipulatorGesture.current = beginCurveGesture(ctx, { nodeId: node.id, point: position }, { mode: "shape", insertOnClick: false, spatialTarget: true, ...(snap ? { snap } : {}) });
            } else if (phase === "move") {
              const sample = { nodeId: node.id, point: position };
              manipulatorGesture.current?.move({ start: sample, current: sample, samples: [sample] });
            } else {
              const gesture = manipulatorGesture.current;
              manipulatorGesture.current = undefined;
              if (phase === "end") gesture?.commit(); else gesture?.cancel();
              // Refresh from confirmed state after success, rejection or cancellation.
              const current = spineHandleAt(runtime, node.id);
              if (selectedPoint.current === node.id) ctx.reportSelection(current ? { id: current.id, point: current.position } : undefined);
              refreshEdgeOverlay();
            }
          },
        } : undefined);
      },
      reportFeedback: (feedback) => {
        optionsRef.current.onFeedbackChange(feedback);
      },
      updateToolParams: (toolId, update) => optionsRef.current.onToolParamsUpdate?.(toolId, update as never),
    }),
    [nextSequence],
  );

  const lastParamsRef = useRef<{ readonly tool: ConstructionToolId; readonly params: unknown } | undefined>(undefined);
  useEffect(() => {
    const params = options.toolParams[options.activeTool];
    const last = lastParamsRef.current;
    lastParamsRef.current = { tool: options.activeTool, params };
    if (last === undefined || last.tool !== options.activeTool || last.params === params) return;
    toolFor(options.activeTool).onParamsChange?.(ctx, params as never, last.params as never);
  }, [options.activeTool, options.toolParams, ctx]);

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
    const tool = toolFor(optionsRef.current.activeTool);
    const presentation = tool.handlePresentation;
    runtime.setConstructionHandlePresentation?.(presentation ?? "all");
    runtime.setGlobalHandleOwners?.(tool.editsType);
    if (!tool.handlesOnHover) runtime.setHandleFocus?.(undefined);
    else if (!focusRef.current) { focusRef.current = NO_FOCUS; runtime.setHandleFocus?.(NO_FOCUS); }
    for (const channel of shownEdgeChannels.current) runtime.clearPreview(channel);
    shownEdgeChannels.current.clear();
    if (optionsRef.current.edgeOverlay === false) return;
    for (const group of edgeOverlayOf(runtime, runtime.getAllRegionTopologies(), runtime.getGraphSnapshot(), runtime)) {
      if (group.positions.length === 0 || (presentation === "spine-points" && group.role !== "path-spine-edge")) continue;
      const channel = edgeOverlayChannel(group.role);
      runtime.showPreview(edgeOverlayDescriptor(group), channel);
      shownEdgeChannels.current.add(channel);
    }
  }, []);

  // Runs on a tool switch, never on a change of the active tool's params: a
  // tool that mirrors its selection into its own params (an opening, a
  // picked ramp) would otherwise be cancelled -- selection, manipulator and
  // gesture all dropped -- by the very update that shows what it picked.
  useEffect(() => {
    const tool = toolFor(options.activeTool);
    // Bind cleanup to the runtime that owns this draft, even after a table switch.
    const ownedContext: ToolContext = { ...ctx, runtime: options.runtime, history: options.history, tableId: options.tableId };
    const release = () => {
      const active = gestureRef.current;
      if (active?.captureTarget.hasPointerCapture(active.pointerId)) active.captureTarget.releasePointerCapture(active.pointerId);
      gestureRef.current = null;
      suppressClickRef.current = true;
      options.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
      // While a line is being drawn, digits are its length -- and come before the tool's own keys.
      // (A line begun by a click is as much under way as one dragged: the tool says so by giving its anchor.)
      if ((gestureRef.current !== null || tool.rulerAnchor?.(ownedContext, optionsRef.current.toolParams[optionsRef.current.activeTool] as never) !== undefined) && typeKeyRef.current(event)) return;
      if (event.key === "Escape" && tool.onCancel) {
        tool.onCancel(ownedContext); release(); event.preventDefault(); return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && tool.onDeleteKey) {
        tool.onDeleteKey(ownedContext);
      }
      if (gestureRef.current) return;
      const { toolParams, activeTool } = optionsRef.current;
      if (tool.onKeyDown?.(ownedContext, event.key, toolParams[activeTool] as never)) {
        event.preventDefault();
        refreshEdgeOverlay();
      }
    };
    refreshEdgeOverlay();
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      selectedPoint.current = undefined;
      manipulatorGesture.current?.cancel();
      manipulatorGesture.current = undefined;
      if (options.viewId !== undefined) options.runtime.setPointManipulator?.(options.viewId, undefined);
      tool.onCancel?.(ownedContext);
      options.runtime.setConstructionHandlePresentation?.("all");
      options.runtime.setGlobalHandleOwners?.(undefined);
      focusRef.current = undefined;
      options.runtime.setHandleFocus?.(undefined);
      release();
    };
  }, [options.activeTool, options.runtime, options.history, options.tableId, options.viewId, ctx, refreshEdgeOverlay]);

  // Switching the edge view on or off draws or clears it at once, not at the next commit.
  useEffect(() => { refreshEdgeOverlay(); }, [options.edgeOverlay, refreshEdgeOverlay]);

  // Draw what is already standing as soon as the table is live, not only
  // after the first commit -- an edge that was there before this session
  // began is exactly as worth seeing as one just drawn. The runtime is still
  // loading at mount, so this waits for it rather than asking too early.
  useEffect(() => {
    const { runtime } = optionsRef.current;
    refreshEdgeOverlay();
    let drawn = runtime.getSnapshot().status === "ready";
    const unsubscribe = runtime.subscribe(() => {
      ruler.invalidate();
      if (selectedPoint.current && !manipulatorGesture.current) {
        const node = spineHandleAt(runtime, selectedPoint.current);
        ctx.reportSelection(node ? { id: node.id, point: node.position } : undefined);
      }
      if (drawn || runtime.getSnapshot().status !== "ready") return;
      drawn = true;
      refreshEdgeOverlay();
    });
    return unsubscribe;
  }, [options.runtime, refreshEdgeOverlay, ctx, ruler]);

  /**
   * `ruledSample` with the length typed so far: from where the drawing began,
   * the way the pointer points -- already turned onto whatever it caught -- and
   * exactly that long, in the table's unit. `undefined` while nothing is typed.
   */
  const typedLengthAt = useCallback((ruledSample: PointerSample, origin: ConstructionPosition, raw: PointerSample): { readonly sample: PointerSample; readonly feedback: RulerFeedback } | undefined => {
    const value = Number.parseFloat(typedRef.current);
    if (!(value > 0)) return undefined;
    const meters = toMetres(value, optionsRef.current.measureUnit);
    const dx = ruledSample.point.x - origin.x, dz = ruledSample.point.z - origin.z;
    const length = Math.hypot(dx, dz);
    const direction = length > 1e-9 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
    const point = { x: origin.x + direction.x * meters, y: ruledSample.point.y, z: origin.z + direction.z * meters };
    return {
      sample: { ...ruledSample, point, ruled: { x: point.x - raw.point.x, z: point.z - raw.point.z } },
      feedback: { guides: [], measures: [{ kind: "length", from: origin, to: point, meters }] },
    };
  }, []);

  const sampleAt = useCallback(
    (event: { currentTarget: HTMLElement; clientX: number; clientY: number; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): PointerSample | undefined => {
      const { viewId, runtime, activeTool, rulerSettings, measureUnit } = optionsRef.current;
      const settings = rulerSettings ?? UNSET_RULER_SETTINGS;
      if (viewId === undefined) return undefined;
      const { x, y } = pointerOffset(event);
      const hit = runtime.pick(viewId, x, y);
      if (hit === undefined) return undefined;
      const tool = toolFor(activeTool);
      const placed = withFacePlane(hit, runtime.getAllRegionTopologies());
      // Ctrl (Cmd) places freely: what the ruler catches is shown, not taken.
      const free = event.ctrlKey === true || event.metaKey === true;
      freeHandRef.current = free;
      // Shift asks for the protractor's own graduation: five degrees.
      angleStepRef.current = (event.shiftKey ? FINE_ANGLE_STEP : settings.angleStep) * DEGREE;
      metersPerPixelRef.current = metersPerPixelAt(placed, event.currentTarget.getBoundingClientRect().height, VIEW_FOV_DEGREES);
      // A tool that lays itself out on a surface, or in a frame of its own, is not ruled by position here.
      // The line being drawn runs from where the tool says it begins -- the last corner or end it was given, so the line that follows
      // the pointer between clicks is ruled like one dragged -- else from where the gesture began. A handle is moved, not drawn from:
      // only one that moves freely is ruled from where it was grabbed, for how far and which way it goes.
      const drawing = gestureRef.current;
      const anchor = tool.rulerAnchor?.(ctx, optionsRef.current.toolParams[activeTool] as never);
      const origin = anchor ?? (drawing && drawing.rulesFrom ? drawing.start.point : undefined);
      let ruled = tool.snapsToSurface || tool.usesRuler === false
        ? { sample: placed, feedback: NO_FEEDBACK }
        : ruler.ruleSample(placed, {
          snap: !free,
          ...(origin ? { origin, polar: angleStepRef.current, ...lengthStepOption(settings.lengthStep, metersPerPixelRef.current, measureUnit) } : {}),
          ...(metersPerPixelRef.current !== undefined ? { metersPerPixel: metersPerPixelRef.current } : {}),
          ...(settings.disabled.size > 0 ? { disabled: settings.disabled } : {}),
        });
      // A length typed while drawing wins over every catch: the line runs where the pointer points, exactly that long.
      const typed = origin && !(tool.snapsToSurface || tool.usesRuler === false) ? typedLengthAt(ruled.sample, origin, placed) : undefined;
      if (typed) ruled = typed;
      feedbackRef.current = ruled.feedback;
      pointerAtRef.current = { clientX: event.clientX, clientY: event.clientY };
      // The node under the pointer, by geometry: what a tool reads "the node here" from, drawn dots or not.
      const node = nodeByGeometry(placed, runtime.getGraphSnapshot().nodes, metersPerPixelRef.current);
      return { ...ruled.sample, ...(node ? { node } : {}), screenY: event.clientY, screenX: event.clientX, shiftKey: event.shiftKey };
    },
    [ruler, typedLengthAt, ctx],
  );

  /**
   * Shows the preview for the very first sample of a gesture, right as it
   * starts (`onPointerDown`) -- never for idle hovering. A preview that also
   * ran on passive `pointermove` (no button down) used to recompute and
   * reappear every time the pointer merely rested near a spot the brush
   * could still reach -- including right around a stroke you'd already
   * committed, since the brush footprint is wider than the thin path it
   * actually carves. That looked exactly like a "stuck" ghost that outlived
   * the stroke, even though `clearPreview` was firing correctly on every
   * commit and tool switch. See the tool-switch reset effect above for the
   * only other place `clearPreview` is expected to run outside a gesture.
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
      const sample = sampleAt(event);
      if (sample === undefined) return;

      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;
      lastPreviewAtRef.current = 0;

      // Only tools that actually react to a drag capture the pointer --
      // a click-only tool leaves the native click gesture alone.
      if (tool.onPointerMove !== undefined || tool.onPointerUp !== undefined) {
        const motion = sample.nodeId === undefined ? undefined : handleMotionOf(optionsRef.current.runtime, sample.nodeId);
        // The ruler counts from where a handle was grabbed only for one that declares it is read by how far it went: a vertex is read by the sides it edits instead.
        const declared = sample.nodeId === undefined ? undefined : globalHandleOf(sample.nodeId);
        const rulesFrom = sample.nodeId === undefined || ((declared === undefined || HANDLE_REFERENCE[declared.kind] === "grab") && (motion?.kind === "free" || motion?.kind === "plane"));
        gestureRef.current = { pointerId: event.pointerId, captureTarget: event.currentTarget, start: sample, rulesFrom, last: sample, samples: [sample] };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      tool.onPointerDown?.(ctx, sample, params);
      showStartPreview(sample);
    },
    [ctx, sampleAt, showStartPreview],
  );

  /** The last pointer move, kept so a length typed while the pointer is still can be applied at once. */
  const lastMoveRef = useRef<ReactPointerEvent<HTMLDivElement> | undefined>(undefined);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      lastMoveRef.current = { currentTarget: event.currentTarget, clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, pointerId: event.pointerId } as unknown as ReactPointerEvent<HTMLDivElement>;
      const gesture = gestureRef.current;
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;

      // Most brushes preview only an active drag. Contour tools may opt in
      // to a circle footprint or unfinished polygon preview between clicks.
      if (gesture === null || gesture.pointerId !== event.pointerId) {
        const hover = typeof tool.previewOnHover === "function" ? tool.previewOnHover(params) : tool.previewOnHover;
        const sample = hover || tool.handlesOnHover ? sampleAt(event) : undefined;
        // The ruler is there whenever something is being built, hovering or not.
        if (activeTool !== "navigate" && !tool.snapsToSurface && tool.usesRuler !== false) {
          const at = performance.now();
          if (at - lastRulerAtRef.current >= RULER_HOVER_MS) {
            lastRulerAtRef.current = at;
            if (!sample) sampleAt(event);
            // What is pointed at says how big it is, without being touched: its height and its extent.
            const focus = tool.handlesOnHover ? focusRef.current : undefined;
            if (focus && focus.faces.size > 0) {
              const faces = optionsRef.current.runtime.getAllRegionTopologies().filter((topology) => focus.faces.has(faceKey(topology)));
              feedbackRef.current = { guides: feedbackRef.current.guides, measures: [...feedbackRef.current.measures, ...rulerOf(ctx).dimensions(faces)] };
            }
            showRuler(event);
          }
        }
        // The structure under the pointer shows its handles.
        if (tool.handlesOnHover && tool.editsType && focusRef.current) {
          const now = performance.now();
          if (now - lastFocusAtRef.current >= FOCUS_THROTTLE_MS) {
            lastFocusAtRef.current = now;
            const focus = handleFocusAt(ctx, sample, focusRef.current, tool.editsType);
            if (!sameFocus(focus, focusRef.current)) {
              focusRef.current = focus;
              optionsRef.current.runtime.setHandleFocus?.(focus);
            }
          }
        }
        event.currentTarget.style.cursor = sample?.nodeId ? "grab" : "";
        const descriptor = sample ? tool.previewFor?.({ start: sample,current: sample,samples: [sample] },params,ctx) : undefined;
        if (descriptor) optionsRef.current.runtime.showPreview(descriptor,TOOL_GHOST_PREVIEW_CHANNEL);
        else optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
        return;
      }

      const sample = sampleAt(event);
      if (sample === undefined) return; // pointer strayed off pickable geometry -- freeze at the last resolved position, same posture as before this refactor.
      // A handle dragged shows its own guides -- through `ctx.showRuler` -- so the pointer's do not wipe them.
      if (gesture.start.nodeId === undefined) showRuler(event);
      gesture.last = sample;
      const previous = gesture.samples[gesture.samples.length - 1];
      if (previous === undefined || previous.point.x !== sample.point.x || previous.point.y !== sample.point.y || previous.point.z !== sample.point.z) {
        gesture.samples.push(sample);
      }
      const activeGesture = { start: gesture.start, current: sample, samples: gesture.samples };

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
    [ctx, sampleAt, showRuler],
  );

  // Digits typed while drawing set the exact length of what is being drawn, in the table's unit -- SketchUp's measurements box.
  // Read by the tool's own key handler, ahead of its keys: Backspace here edits the number and Escape clears it.
  typeKeyRef.current = (event) => {
    const typed = typedRef.current;
    let next: string | undefined;
    if (/^[0-9]$/.test(event.key)) next = typed + event.key;
    else if ((event.key === "." || event.key === ",") && !typed.includes(".")) next = `${typed === "" ? "0" : typed}.`;
    else if (event.key === "Backspace" && typed !== "") next = typed.slice(0, -1);
    else if (event.key === "Escape" && typed !== "") next = "";
    if (next === undefined) return false;
    event.preventDefault();
    typedRef.current = next;
    // Applied at once, to where the pointer stands: no need to move it to see the number take.
    const move = lastMoveRef.current;
    if (move) onPointerMove(move);
    return true;
  };

  const finishGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (gesture === null || gesture.pointerId !== event.pointerId) return;
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;

      const released = sampleAt(event);
      if (released && (released.point.x !== gesture.last.point.x || released.point.y !== gesture.last.point.y || released.point.z !== gesture.last.point.z)) {
        gesture.last = released; gesture.samples.push(released);
      }
      const moved = gestureMoved(gesture.start, gesture.samples);
      suppressClickRef.current = moved;
      clickRunRef.current = moved ? undefined : nextClickRun(clickRunRef.current, gesture.start, performance.now());
      const clicks = clickRunRef.current?.count ?? 0;
      tool.onPointerUp?.(ctx, { start: gesture.start, current: gesture.last, samples: gesture.samples, moved, clicks }, params);
      gestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
      clearRuler();
      refreshEdgeOverlay();
    },
    [ctx, refreshEdgeOverlay, sampleAt, clearRuler],
  );

  const cancelGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    toolFor(optionsRef.current.activeTool).onCancel?.(ctx);
    suppressClickRef.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    optionsRef.current.runtime.clearPreview(TOOL_GHOST_PREVIEW_CHANNEL);
    clearRuler();
  }, [ctx, clearRuler]);
  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      if (tool.onClick === undefined) return;
      const sample = sampleAt(event);
      if (sample === undefined) return;
      tool.onClick(ctx, sample, toolParams[activeTool] as never);
      refreshEdgeOverlay();
    },
    [ctx, refreshEdgeOverlay, sampleAt],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishGesture,
    onPointerCancel: cancelGesture,
    onClick,
  };
}
