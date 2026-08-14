"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  attachCameraNavigation,
  buildGenerateTerrainCellOperation,
  buildGenerateWallOperation,
  createMoveNodeHistoryStack,
  createTabletopRuntime,
  type ConstructionPosition,
  type MoveNodeHistoryStack,
  type RenderViewId,
  type TabletopRuntime,
} from "@/composition/tabletop";

export interface TabletopEntryProps {
  readonly tableId: string;
}

type EditTool = "navigate" | "move-node";
type SurfaceStyle = "wall-white" | "wall-gray" | "terrain" | "terrain-grass";

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
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<{ id: string; point: ConstructionPosition } | null>(null);
  // Settings/inspector drawer starts closed -- it must float over the map,
  // not reserve space beside it, so it opens only on request.
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      { name: "flat", cornerHeights: [1, 1, 1, 1] },
      activeMaterial === "terrain-grass" ? "terrain-grass" : "terrain",
    );
    runtime.generateTerrainCell(operation.payload, "local", operation.operationId);
  }, [runtime, tableId, activeMaterial]);

  const handleGenerateWall = useCallback(() => {
    generateCountRef.current += 1;
    const offset = 2 + generateCountRef.current * 2;
    const wallKind = activeMaterial === "wall-gray" ? "wall-gray" : "wall-white";
    const operation = buildGenerateWallOperation(
      tableId,
      `edit-${generateCountRef.current}`,
      { operationId: `${tableId}:edit:wall:${generateCountRef.current}`, tableId, initiatedBy: "local" },
      { start: { x: offset, y: 0, z: 0 }, end: { x: offset, y: 0, z: 4 }, height: 3 },
      undefined,
      wallKind,
      wallKind,
    );
    runtime.generateWall(operation.payload, "local", operation.operationId);
  }, [runtime, tableId, activeMaterial]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (historyState.canUndo) handleUndo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (historyState.canRedo) handleRedo();
      } else if (e.key.toLowerCase() === "m") {
        setTool("move-node");
      } else if (e.key.toLowerCase() === "n" || e.key === "Escape") {
        setTool("navigate");
      } else if (e.key.toLowerCase() === "w") {
        if (current.status === "ready") handleGenerateWall();
      } else if (e.key.toLowerCase() === "t") {
        if (current.status === "ready") handleGenerateTerrainCell();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyState.canUndo, historyState.canRedo, handleUndo, handleRedo, current.status, handleGenerateWall, handleGenerateTerrainCell]);

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
          <span className={`gm-badge ${current.status === "ready" ? "gm-badge--ready" : ""}`}>
            Engine WASM: {current.status}
          </span>

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

        {/* Left rail -- small, specific, powerful tools */}
        <aside className="gm-rail-left" role="toolbar" aria-label="Ferramentas de Construção do Mestre">
          <button
            type="button"
            className={`gm-rail-btn ${tool === "navigate" ? "gm-rail-btn--active" : ""}`}
            onClick={() => setTool("navigate")}
            title="Navegar / Pan (tecla N)"
          >
            N
          </button>
          <button
            type="button"
            className={`gm-rail-btn ${tool === "move-node" ? "gm-rail-btn--active" : ""}`}
            onClick={() => setTool("move-node")}
            title="Mover Node do Grafo (tecla M)"
          >
            M
          </button>
          <div className="gm-rail-divider" />
          <button
            type="button"
            className="gm-rail-btn"
            onClick={handleUndo}
            disabled={!historyState.canUndo}
            title="Desfazer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="gm-rail-btn"
            onClick={handleRedo}
            disabled={!historyState.canRedo}
            title="Refazer (Ctrl+Y)"
          >
            ↷
          </button>
        </aside>

        {/* Bottom hotbar -- bigger blocks for quick/procedural construction */}
        <div className="gm-hotbar" role="toolbar" aria-label="Construção Rápida">
          <button
            type="button"
            className="gm-hotbar-block"
            onClick={handleGenerateWall}
            disabled={current.status !== "ready"}
            title="Adicionar Parede (tecla W)"
          >
            <span className="gm-hotbar-block-icon" aria-hidden="true">W</span>
            <span>Parede</span>
          </button>
          <button
            type="button"
            className="gm-hotbar-block"
            onClick={handleGenerateTerrainCell}
            disabled={current.status !== "ready"}
            title="Adicionar Célula de Terreno (tecla T)"
          >
            <span className="gm-hotbar-block-icon" aria-hidden="true">T</span>
            <span>Terreno</span>
          </button>
          <button
            type="button"
            className={`gm-hotbar-block ${activeMaterial === "wall-white" ? "gm-hotbar-block--selected" : ""}`}
            onClick={() => {
              setActiveMaterial("wall-white");
              handleGenerateWall();
            }}
            disabled={current.status !== "ready"}
            title="Preset Masmorra Branca"
          >
            <span className="gm-hotbar-block-icon" aria-hidden="true">▢</span>
            <span>Branca</span>
          </button>
          <button
            type="button"
            className={`gm-hotbar-block ${activeMaterial === "wall-gray" ? "gm-hotbar-block--selected" : ""}`}
            onClick={() => {
              setActiveMaterial("wall-gray");
              handleGenerateWall();
            }}
            disabled={current.status !== "ready"}
            title="Preset Masmorra Cinza"
          >
            <span className="gm-hotbar-block-icon" aria-hidden="true">▨</span>
            <span>Cinza</span>
          </button>
        </div>

        {/* Right drawer -- settings & inspector, collapsed by default */}
        <button
          type="button"
          className={`gm-drawer-toggle ${drawerOpen ? "gm-drawer-toggle--open" : ""}`}
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          aria-controls="gm-settings-drawer"
          title={drawerOpen ? "Fechar painel de configurações" : "Abrir painel de configurações"}
        >
          {drawerOpen ? "×" : "☰"}
        </button>

        <aside
          id="gm-settings-drawer"
          className={`gm-drawer-right ${drawerOpen ? "gm-drawer-right--open" : ""}`}
          aria-hidden={!drawerOpen}
        >
          <div className="gm-panel-card">
            <span className="gm-panel-card-title">Inspector de Seleção</span>
            {selectedNodeInfo !== null ? (
              <div style={{ display: "grid", gap: "0.4rem", fontSize: "0.78rem" }}>
                <div className="gm-stat-row">
                  <span>Node ID:</span>
                  <span className="gm-stat-value">{selectedNodeInfo.id}</span>
                </div>
                <div className="gm-stat-row">
                  <span>Posição X:</span>
                  <span className="gm-stat-value">{selectedNodeInfo.point.x.toFixed(2)}m</span>
                </div>
                <div className="gm-stat-row">
                  <span>Posição Y:</span>
                  <span className="gm-stat-value">{selectedNodeInfo.point.y.toFixed(2)}m</span>
                </div>
                <div className="gm-stat-row">
                  <span>Posição Z:</span>
                  <span className="gm-stat-value">{selectedNodeInfo.point.z.toFixed(2)}m</span>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b" }}>
                Clique em uma alça de node (esfera amarela) com a ferramenta <em>Mover Node</em> (M) ativada para inspecionar.
              </p>
            )}
          </div>

          <div className="gm-panel-card">
            <span className="gm-panel-card-title">Estilo de Bloco & Material</span>
            <div className="gm-material-grid">
              <button
                type="button"
                className={`gm-material-chip ${activeMaterial === "wall-white" ? "gm-material-chip--selected" : ""}`}
                onClick={() => setActiveMaterial("wall-white")}
              >
                <div className="gm-swatch gm-swatch--wall-white" />
                <span>Bloco Branco</span>
              </button>
              <button
                type="button"
                className={`gm-material-chip ${activeMaterial === "wall-gray" ? "gm-material-chip--selected" : ""}`}
                onClick={() => setActiveMaterial("wall-gray")}
              >
                <div className="gm-swatch gm-swatch--wall-gray" />
                <span>Bloco Cinza</span>
              </button>
              <button
                type="button"
                className={`gm-material-chip ${activeMaterial === "terrain" ? "gm-material-chip--selected" : ""}`}
                onClick={() => setActiveMaterial("terrain")}
              >
                <div className="gm-swatch gm-swatch--terrain" />
                <span>Grid Terreno</span>
              </button>
              <button
                type="button"
                className={`gm-material-chip ${activeMaterial === "terrain-grass" ? "gm-material-chip--selected" : ""}`}
                onClick={() => setActiveMaterial("terrain-grass")}
              >
                <div className="gm-swatch gm-swatch--terrain-grass" />
                <span>Terreno Grama</span>
              </button>
            </div>
          </div>

          <div className="gm-panel-card">
            <span className="gm-panel-card-title">Métricas da Cena</span>
            <div className="gm-stat-row">
              <span>Tokens no Mapa:</span>
              <span className="gm-stat-value">{current.tokens.byId.size}</span>
            </div>
            <div className="gm-stat-row">
              <span>Snap ao Grid:</span>
              <span className="gm-stat-value">Ativado (1.0m)</span>
            </div>
            <div className="gm-stat-row">
              <span>Iluminação:</span>
              <span className="gm-stat-value">Direcional + Amb</span>
            </div>
          </div>
        </aside>
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
