"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
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
    void runtime.start().then(() => {
      if (!active || viewportRef.current === null) return;
      viewId = runtime.attachView(viewportRef.current);
      viewIdRef.current = viewId;
    });
    return () => {
      active = false;
      if (viewId !== undefined) runtime.detachView(viewId);
      viewIdRef.current = undefined;
      void runtime.dispose();
    };
  }, [runtime]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (tool !== "move-node" || viewIdRef.current === undefined) return;
      const { x, y } = pointerOffset(event);
      const hit = runtime.pick(viewIdRef.current, x, y);
      if (hit?.nodeId === undefined) return;

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
    forceHistoryUpdate((value) => value + 1);
  }, [history, runtime]);

  const handleRedo = useCallback(() => {
    const entry = history.redo();
    if (entry === undefined) return;
    runtime.moveNode(entry.nodeId, entry.to, "local", "redo");
    forceHistoryUpdate((value) => value + 1);
  }, [history, runtime]);

  const handleGenerateTerrainCell = useCallback(() => {
    generateCountRef.current += 1;
    const cell = (generateCountRef.current % 3) + 1; // cell 0 is the seeded one; cycle the remaining 1..3
    const operation = buildGenerateTerrainCellOperation(
      tableId,
      `edit-${generateCountRef.current}`,
      { operationId: `${tableId}:edit:terrain-cell:${generateCountRef.current}`, tableId, initiatedBy: "local" },
      cell,
      { name: "flat", cornerHeights: [1, 1, 1, 1] },
      "terrain",
    );
    runtime.generateTerrainCell(operation.payload, "local", operation.operationId);
  }, [runtime, tableId]);

  const handleGenerateWall = useCallback(() => {
    generateCountRef.current += 1;
    const offset = 2 + generateCountRef.current * 2;
    const operation = buildGenerateWallOperation(
      tableId,
      `edit-${generateCountRef.current}`,
      { operationId: `${tableId}:edit:wall:${generateCountRef.current}`, tableId, initiatedBy: "local" },
      { start: { x: offset, y: 0, z: 0 }, end: { x: offset, y: 0, z: 4 }, height: 3 },
      undefined,
      "wall",
      "wall",
    );
    runtime.generateWall(operation.payload, "local", operation.operationId);
  }, [runtime, tableId]);

  return (
    <main className="tabletop-shell">
      <header className="tabletop-header">
        <div>
          <p className="eyebrow">Open table</p>
          <h1>{current.tableId}</h1>
        </div>
        <span className={`runtime-status runtime-status--${current.status}`} aria-live="polite">
          Runtime: {current.status}
        </span>
      </header>

      <div className="tabletop-toolbar" role="toolbar" aria-label="Edit-mode tools">
        <button
          type="button"
          aria-pressed={tool === "move-node"}
          onClick={() => setTool((value) => (value === "move-node" ? "navigate" : "move-node"))}
        >
          {tool === "move-node" ? "Move node: on" : "Move node: off"}
        </button>
        <button type="button" onClick={handleUndo} disabled={!historyState.canUndo}>
          Undo
        </button>
        <button type="button" onClick={handleRedo} disabled={!historyState.canRedo}>
          Redo
        </button>
        <button type="button" onClick={handleGenerateTerrainCell} disabled={current.status !== "ready"}>
          Generate terrain cell
        </button>
        <button type="button" onClick={handleGenerateWall} disabled={current.status !== "ready"}>
          Generate wall
        </button>
      </div>

      <section className="tabletop-stage" aria-label="3D tabletop viewport">
        <div
          className="tabletop-viewport"
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        <div className="tabletop-stage__caption">
          <strong>{current.tokens.byId.size} token</strong>
          <span>Billboard 2.5D em um mundo 3D</span>
        </div>
      </section>
    </main>
  );
}
