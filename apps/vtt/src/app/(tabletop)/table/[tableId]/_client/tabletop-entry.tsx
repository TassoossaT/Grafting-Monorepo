"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  attachCameraNavigation,
  buildGenerateRoomOperations,
  buildGenerateTerrainCellOperation,
  createMoveNodeHistoryStack,
  createTabletopRuntime,
  layoutNextRoomOrigin,
  roomVariantForIndex,
  type ConstructionPosition,
  type MoveNodeHistoryStack,
  type RenderViewId,
  type TabletopRuntime,
  type TabletopRuntimeStatus,
} from "@/composition/tabletop";
import { StatusBadge, type CornerHeights } from "@/ui";
import {
  ConstructionHotbar,
  SettingsDrawer,
  ToolRail,
  useKeyboardShortcuts,
  type EditTool,
  type SelectedNodeInfo,
  type SurfaceStyle,
} from "@/widgets";

export interface TabletopEntryProps {
  readonly tableId: string;
}

interface DragState {
  readonly nodeId: string;
  readonly pointerId: number;
  readonly from: ConstructionPosition;
  last: ConstructionPosition;
}

function pointerOffset(event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Maps this app's own runtime lifecycle onto the generic `UiStatus` vocabulary `StatusBadge` expects. */
function statusToUiStatus(status: TabletopRuntimeStatus): "neutral" | "info" | "success" | "error" {
  switch (status) {
    case "idle":
      return "neutral";
    case "starting":
      return "info";
    case "ready":
      return "success";
    case "disposed":
      return "error";
  }
}

export function TabletopEntry({ tableId }: TabletopEntryProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<TabletopRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createTabletopRuntime({ tableId });
  }
  const runtime = runtimeRef.current;

  const historyRef = useRef<MoveNodeHistoryStack | null>(null);
  if (historyRef.current === null) historyRef.current = createMoveNodeHistoryStack();
  const history = historyRef.current;

  const viewIdRef = useRef<RenderViewId | undefined>(undefined);
  const dragRef = useRef<DragState | null>(null);
  const generateCountRef = useRef(0);

  const [tool, setTool] = useState<EditTool>("navigate");
  const [activeMaterial, setActiveMaterial] = useState<SurfaceStyle>("wall-white");
  const [editorMode, setEditorMode] = useState<"gm" | "player">("gm");
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<SelectedNodeInfo | null>(null);
  const [terrainShape, setTerrainShape] = useState<CornerHeights>([1, 1, 1, 1]);
  const [terrainPickerOpen, setTerrainPickerOpen] = useState(false);
  const [, forceHistoryUpdate] = useState(0);

  const historyState = history.getState();
  const current = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useEffect(() => {
    let active = true;
    let viewId: RenderViewId | undefined;
    let detachCamera: (() => void) | undefined;
    void runtime.start().then(() => {
      if (!active || viewportRef.current === null) return;
      viewId = runtime.attachView(viewportRef.current);
      viewIdRef.current = viewId;
      detachCamera = attachCameraNavigation(runtime, viewId, viewportRef.current);
    });
    return () => {
      active = false;
      detachCamera?.();
      if (viewId !== undefined) runtime.detachView(viewId);
      viewIdRef.current = undefined;
      void runtime.dispose();
    };
  }, [runtime]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // The right and middle buttons are reserved for camera orbit/pan
      // (see features/navigate-camera) -- only the left button drives tools.
      if (event.button !== 0 || tool !== "move-node" || viewIdRef.current === undefined) return;
      const { x, y } = pointerOffset(event);
      const hit = runtime.pick(viewIdRef.current, x, y);
      if (hit?.nodeId === undefined) return;

      setSelectedNodeInfo({ id: hit.nodeId, point: hit.point });
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { nodeId: hit.nodeId, pointerId: event.pointerId, from: hit.point, last: hit.point };
    },
    [runtime, tool],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId || viewIdRef.current === undefined) return;
      const { x, y } = pointerOffset(event);
      const hit = runtime.pick(viewIdRef.current, x, y);
      if (hit === undefined) return;

      drag.last = hit.point;
      setSelectedNodeInfo({ id: drag.nodeId, point: hit.point });
      runtime.moveNode(drag.nodeId, hit.point, "local", `drag:${drag.nodeId}`);
    },
    [runtime],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      history.record({ nodeId: drag.nodeId, from: drag.from, to: drag.last });
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      forceHistoryUpdate((value) => value + 1);
    },
    [history],
  );

  const handleUndo = useCallback(() => {
    const entry = history.undo();
    if (entry === undefined) return;
    runtime.moveNode(entry.nodeId, entry.from, "local", "undo");
    setSelectedNodeInfo({ id: entry.nodeId, point: entry.from });
    forceHistoryUpdate((value) => value + 1);
  }, [history, runtime]);

  const handleRedo = useCallback(() => {
    const entry = history.redo();
    if (entry === undefined) return;
    runtime.moveNode(entry.nodeId, entry.to, "local", "redo");
    setSelectedNodeInfo({ id: entry.nodeId, point: entry.to });
    forceHistoryUpdate((value) => value + 1);
  }, [history, runtime]);

  const handleGenerateTerrainCell = useCallback(() => {
    generateCountRef.current += 1;
    const cell = (generateCountRef.current % 3) + 1;
    const operation = buildGenerateTerrainCellOperation(
      tableId,
      `edit-${generateCountRef.current}`,
      { operationId: `${tableId}:edit:terrain-cell:${generateCountRef.current}`, tableId, initiatedBy: "local" },
      cell,
      { name: "custom", cornerHeights: terrainShape },
      activeMaterial === "terrain-grass" ? "terrain-grass" : "terrain",
    );
    runtime.generateTerrainCell(operation.payload, "local", operation.operationId);
  }, [runtime, tableId, activeMaterial, terrainShape]);

  const handleGenerateWall = useCallback(
    (materialOverride?: "wall-white" | "wall-gray") => {
      generateCountRef.current += 1;
      const index = generateCountRef.current;
      const wallKind = materialOverride ?? (activeMaterial === "wall-gray" ? "wall-gray" : "wall-white");
      if (materialOverride !== undefined) setActiveMaterial(materialOverride);
      const operations = buildGenerateRoomOperations(
        tableId,
        `edit-${index}`,
        { operationId: `${tableId}:edit:room:${index}`, tableId, initiatedBy: "local" },
        layoutNextRoomOrigin(index),
        roomVariantForIndex(index),
        wallKind,
        wallKind,
      );
      for (const operation of operations) {
        runtime.generateWall(operation.payload, "local", operation.operationId);
      }
    },
    [runtime, tableId, activeMaterial],
  );

  useKeyboardShortcuts({
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onToolChange: setTool,
    ready: current.status === "ready",
    onGenerateWall: () => handleGenerateWall(),
    onGenerateTerrainCell: handleGenerateTerrainCell,
  });

  return (
    <div className="gm-studio-app">
      {/* Header Bar -- thin, crops the map on purpose */}
      <header className="gm-header">
        <div className="gm-brand">
          <div className="gm-logo">G</div>
          <div className="gm-title-group">
            <h1>Grafting VTT Map Studio</h1>
            <span className="gm-subtitle">Mesa de Construção RPG • {current.tableId}</span>
          </div>
        </div>

        <div className="gm-header-actions">
          <StatusBadge className="gm-badge" status={statusToUiStatus(current.status)} label={`Engine WASM: ${current.status}`} />

          <div className="gm-mode-toggle">
            <button
              type="button"
              className={`gm-mode-btn ${editorMode === "gm" ? "gm-mode-btn--active" : ""}`}
              onClick={() => setEditorMode("gm")}
            >
              Mestre
            </button>
            <button
              type="button"
              className={`gm-mode-btn ${editorMode === "player" ? "gm-mode-btn--active" : ""}`}
              onClick={() => setEditorMode("player")}
            >
              Jogador
            </button>
          </div>
        </div>
      </header>

      {/* Stage -- the map fills this whole area; every panel below floats over it */}
      <section className="gm-stage" aria-label="Viewport 3D do Mapa">
        <div
          className="gm-viewport-canvas"
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={(event) => event.preventDefault()}
        />

        <div className="gm-stage-overlay-info">
          <strong>{current.tokens.byId.size} Token Activo</strong>
          <span>| Modo: {tool === "move-node" ? "Arrastar Node 3D" : "Navegação da Câmera"}</span>
        </div>

          <ToolRail
            tool={tool}
            onToolChange={setTool}
            canUndo={historyState.canUndo}
            canRedo={historyState.canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />

        <ConstructionHotbar
          ready={current.status === "ready"}
          activeMaterial={activeMaterial}
          onGenerateWall={handleGenerateWall}
          terrainPickerOpen={terrainPickerOpen}
          onToggleTerrainPicker={() => setTerrainPickerOpen((open) => !open)}
          onCloseTerrainPicker={() => setTerrainPickerOpen(false)}
          terrainShape={terrainShape}
          onTerrainShapeChange={setTerrainShape}
          onGenerateTerrainCell={handleGenerateTerrainCell}
        />

        {/* Right drawer -- settings & inspector, collapsed by default. Owns
            its own open state and handle (see `SlidingPanel`). */}
        <SettingsDrawer
          selectedNodeInfo={selectedNodeInfo}
          activeMaterial={activeMaterial}
          onSelectMaterial={setActiveMaterial}
          tokenCount={current.tokens.byId.size}
        />
      </section>

      {/* Bottom Bar -- thin, crops the map on purpose */}
      <footer className="gm-bottom-bar">
        <div className="gm-bar-group">
          <span>Grafting Monorepo Engine v1.0</span>
        </div>

        <div>
          <span>
            <strong>M</strong> Mover · <strong>N</strong> Navegar · <strong>W</strong> Parede · <strong>T</strong> Terreno · Câmera:{" "}
            <strong>botão direito</strong> orbita, <strong>botão do meio</strong> arrasta
          </span>
        </div>

        <div className="gm-bar-group">
          <span>Ctrl+Z / Ctrl+Y para desfazer/refazer</span>
        </div>
      </footer>
    </div>
  );
}
