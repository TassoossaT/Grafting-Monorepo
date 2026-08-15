"use client";

import { useEffect } from "react";

import type { EditTool } from "./tool-rail.tsx";

export interface KeyboardShortcutsOptions {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onToolChange: (tool: EditTool) => void;
  readonly ready: boolean;
  readonly onGenerateWall: () => void;
  readonly onGenerateTerrainCell: () => void;
}

/**
 * Global keyboard shortcuts for the GM studio: Ctrl+Z/Ctrl+Y for undo/redo,
 * M/N to switch tools, W/T to trigger the same generation actions as their
 * hotbar buttons. Ignored while an `<input>`/`<textarea>` has focus, so
 * typing in a settings field never triggers a shortcut.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const { canUndo, canRedo, onUndo, onRedo, onToolChange, ready, onGenerateWall, onGenerateTerrainCell } = options;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (canUndo) onUndo();
      } else if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        if (canRedo) onRedo();
      } else if (event.key.toLowerCase() === "m") {
        onToolChange("move-node");
      } else if (event.key.toLowerCase() === "n" || event.key === "Escape") {
        onToolChange("navigate");
      } else if (event.key.toLowerCase() === "w") {
        if (ready) onGenerateWall();
      } else if (event.key.toLowerCase() === "t") {
        if (ready) onGenerateTerrainCell();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo, onToolChange, ready, onGenerateWall, onGenerateTerrainCell]);
}
