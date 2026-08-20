import type { AtomicEditOp } from "./atomic-edit.ts";

/**
 * One completed edit gesture, as the two op sequences that reverse and
 * replay it. Undo applies `undo`; redo applies `redo` -- the caller (the
 * pointer-capture UI layer) owns actually issuing them through
 * `TabletopRuntime.applyRegionEdit`, this stack only tracks which one is
 * next.
 *
 * Op sequences rather than a single node's before/after position, because a
 * role's cascade legitimately moves nodes the gesture never named: a wall's
 * bottom corner carries its paired top corner by the same delta, and an undo
 * that only put the grabbed corner back would leave the panel sheared. See
 * `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
 */
export interface RegionEditHistoryEntry {
  readonly kind: "region-edit";
  readonly undo: readonly AtomicEditOp[];
  readonly redo: readonly AtomicEditOp[];
}


/** One confirmed path-brush stroke; the construction session owns its before/after checkpoints. */
export interface PathBrushHistoryEntry {
  readonly kind: "path-brush";
  readonly operationId: string;
}

export type ConstructionHistoryEntry = RegionEditHistoryEntry | PathBrushHistoryEntry;
export interface EditHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface EditHistoryStack {
  /** Records a completed move. Clears any redo history, per standard undo-stack semantics. */
  record(entry: ConstructionHistoryEntry): void;
  /** Pops the most recent entry and returns it for the caller to apply its `undo` ops, or `undefined` if there is nothing to undo. */
  undo(): ConstructionHistoryEntry | undefined;
  /** Pops the most recently undone entry and returns it for the caller to apply its `redo` ops, or `undefined` if there is nothing to redo. */
  redo(): ConstructionHistoryEntry | undefined;
  getState(): EditHistoryState;
}

export function createEditHistoryStack(): EditHistoryStack {
  let undoStack: ConstructionHistoryEntry[] = [];
  let redoStack: ConstructionHistoryEntry[] = [];

  return {
    record(entry: ConstructionHistoryEntry): void {
      undoStack = [...undoStack, entry];
      redoStack = [];
    },
    undo(): ConstructionHistoryEntry | undefined {
      const entry = undoStack.at(-1);
      if (entry === undefined) return undefined;
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, entry];
      return entry;
    },
    redo(): ConstructionHistoryEntry | undefined {
      const entry = redoStack.at(-1);
      if (entry === undefined) return undefined;
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, entry];
      return entry;
    },
    getState(): EditHistoryState {
      return Object.freeze({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
    },
  };
}
