import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

/**
 * One completed drag: the node moved, its position before, its position
 * after. Undo re-applies `from`; redo re-applies `to` -- the caller (the
 * pointer-capture UI layer) owns actually calling
 * `TabletopRuntime.moveNode` with whichever position this returns, this
 * stack only tracks which one is next. Adapted from `vtt-brush`'s
 * `undoStack`/`redoStack` pattern, rewritten against a construction
 * `NodeId`/position delta instead of that lab trial's stale
 * `TerrainCellPatch`/`BoundaryPatch` data model.
 */
export interface MoveNodeHistoryEntry {
  readonly nodeId: ConstructionNodeId;
  readonly from: ConstructionPosition;
  readonly to: ConstructionPosition;
}

export interface MoveNodeHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface MoveNodeHistoryStack {
  /** Records a completed move. Clears any redo history, per standard undo-stack semantics. */
  record(entry: MoveNodeHistoryEntry): void;
  /** Pops the most recent move and returns it for the caller to re-apply at `from`, or `undefined` if there is nothing to undo. */
  undo(): MoveNodeHistoryEntry | undefined;
  /** Pops the most recently undone move and returns it for the caller to re-apply at `to`, or `undefined` if there is nothing to redo. */
  redo(): MoveNodeHistoryEntry | undefined;
  getState(): MoveNodeHistoryState;
}

export function createMoveNodeHistoryStack(): MoveNodeHistoryStack {
  let undoStack: MoveNodeHistoryEntry[] = [];
  let redoStack: MoveNodeHistoryEntry[] = [];

  return {
    record(entry: MoveNodeHistoryEntry): void {
      undoStack = [...undoStack, entry];
      redoStack = [];
    },
    undo(): MoveNodeHistoryEntry | undefined {
      const entry = undoStack.at(-1);
      if (entry === undefined) return undefined;
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, entry];
      return entry;
    },
    redo(): MoveNodeHistoryEntry | undefined {
      const entry = redoStack.at(-1);
      if (entry === undefined) return undefined;
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, entry];
      return entry;
    },
    getState(): MoveNodeHistoryState {
      return Object.freeze({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
    },
  };
}
