"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  attachCameraNavigation,
  createEditHistoryStack,
  createTabletopRuntime,
  DEFAULT_TOOL_PARAMS,
  useConstructionPointer,
  type ConstructionToolFeedback,
  type ConstructionToolId,
  type EditHistoryStack,
  type RenderViewId,
  type TabletopRuntime,
  type TabletopRuntimeStatus,
  type ToolParamsByTool,
} from "@/composition/tabletop";
import { StatusBadge } from "@/ui";
import {
  ConstructionDock,
  ConstructionHotbar,
  SettingsDrawer,
  ToolRail,
  useKeyboardShortcuts,
  type EditTool,
  type SelectedNodeInfo,
} from "@/widgets";

export interface TabletopEntryProps {
  readonly tableId: string;
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

const TOOL_LABEL: Record<ConstructionToolId, string> = {
  "path-brush": "Caminho",
  navigate: "Navegação da Câmera",
  "edit-region": "Editar Região",
  "wall-brush": "Pincel de Parede (Livre)",
  "wall-line": "Pincel de Parede (Linha Reta)",
  "interior-wall": "Gerar Interiores",
  "tower-stamp": "Torre",
  "house-room-delete": "Apagar Cômodo",
  "terrain-sculpt": "Escultura de Terreno",
};

export function TabletopEntry({ tableId }: TabletopEntryProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<TabletopRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createTabletopRuntime({ tableId });
  }
  const runtime = runtimeRef.current;

  const historyRef = useRef<EditHistoryStack | null>(null);
  if (historyRef.current === null) historyRef.current = createEditHistoryStack();
  const history = historyRef.current;

  const viewIdRef = useRef<RenderViewId | undefined>(undefined);
  const [, forceHistoryUpdate] = useState(0);

  const [tool, setTool] = useState<EditTool>("navigate");
  const [toolParams, setToolParams] = useState<ToolParamsByTool>(DEFAULT_TOOL_PARAMS);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [editorMode, setEditorMode] = useState<"gm" | "player">("gm");
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<SelectedNodeInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolFeedback, setToolFeedback] = useState<ConstructionToolFeedback | undefined>(undefined);

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

  const handleUndo = useCallback(() => {
    const entry = history.undo();
    if (entry === undefined) return;
    if ("operationId" in entry) {
      runtime.undoPathBrush(entry.operationId, "local");
    } else {
      runtime.applyRegionEdit(entry.undo, "local", "undo");
    }
    setSelectedNodeInfo(null);
    forceHistoryUpdate((value) => value + 1);
  }, [history, runtime]);

  const handleRedo = useCallback(() => {
    const entry = history.redo();
    if (entry === undefined) return;
    if ("operationId" in entry) {
      runtime.redoPathBrush(entry.operationId, "local");
    } else {
      runtime.applyRegionEdit(entry.redo, "local", "redo");
    }
    setSelectedNodeInfo(null);
    forceHistoryUpdate((value) => value + 1);
  }, [history, runtime]);
  const handleToolParamsChange = useCallback(
    <Id extends ConstructionToolId>(toolId: Id, next: ToolParamsByTool[Id]) => {
      setToolParams((previous) => ({ ...previous, [toolId]: next }));
    },
    [],
  );

  const handleFeedbackChange = useCallback((feedback: ConstructionToolFeedback | undefined) => {
    setToolFeedback((previous) =>
      previous?.tone === feedback?.tone &&
      previous?.message === feedback?.message &&
      previous?.surfaceRef === feedback?.surfaceRef
        ? previous
        : feedback,
    );
  }, []);

  useEffect(() => setToolFeedback(undefined), [tool]);
  const pointerHandlers = useConstructionPointer({
    activeTool: tool,
    toolParams,
    runtime,
    history,
    tableId,
    viewId: viewIdRef.current,
    snapToGrid,
    onSelectionChange: (info) => setSelectedNodeInfo(info ?? null),
    onFeedbackChange: handleFeedbackChange,
  });

  useKeyboardShortcuts({
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onToolChange: setTool,
    ready: current.status === "ready",
    snapToGrid,
    onSnapToGridChange: setSnapToGrid,
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
          onPointerDown={pointerHandlers.onPointerDown}
          onPointerMove={pointerHandlers.onPointerMove}
          onPointerUp={pointerHandlers.onPointerUp}
          onPointerCancel={pointerHandlers.onPointerCancel}
          onClick={pointerHandlers.onClick}
          onContextMenu={(event) => event.preventDefault()}
        />

        <div className="gm-stage-overlay-info" role="status" aria-live="polite">
          <strong>{current.tokens.byId.size} Token Activo</strong>
          <span>| Modo: {TOOL_LABEL[tool]}</span>
          {toolFeedback !== undefined ? (
            <span
              title={toolFeedback.surfaceRef}
              style={{ color: toolFeedback.tone === "error" ? "#fca5a5" : toolFeedback.tone === "success" ? "#86efac" : "#c4b5fd" }}
            >
              | {toolFeedback.message}
            </span>
          ) : null}
        </div>

        <ToolRail
          tool={tool}
          onToolChange={setTool}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          snapToGrid={snapToGrid}
          onSnapToGridChange={setSnapToGrid}
        />

        <ConstructionDock
          ready={current.status === "ready"}
          activeTool={tool}
          onToolChange={setTool}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          snapToGrid={snapToGrid}
          onSnapToGridChange={setSnapToGrid}
          onToggleSettings={() => setSettingsOpen((prev) => !prev)}
          settingsOpen={settingsOpen}
        />

        {/* Right drawer -- settings & inspector, collapsed by default. Owns
            its own open state and handle (see `SlidingPanel`). */}
        <SettingsDrawer
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          selectedNodeInfo={selectedNodeInfo}
          activeTool={tool}
          toolParams={toolParams}
          onToolParamsChange={handleToolParamsChange}
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
            <strong>M</strong> Mover · <strong>N</strong> Navegar · <strong>T</strong> Terreno · <strong>P</strong>{" "}
            Parede · <strong>R</strong> Sala · <strong>I</strong> Escultura de Terreno · <strong>G</strong> Ímã do
            Grid · Câmera: <strong>botão direito</strong> orbita, <strong>botão do meio</strong> arrasta
          </span>
        </div>

        <div className="gm-bar-group">
          <span>Ctrl+Z / Ctrl+Y para desfazer/refazer</span>
        </div>
      </footer>
    </div>
  );
}
