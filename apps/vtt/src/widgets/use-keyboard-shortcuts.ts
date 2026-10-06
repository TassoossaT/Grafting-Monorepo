"use client";

import { useEffect } from "react";

import type { ConstructionToolId } from "@/features/edit-construction";

export interface KeyboardShortcutsOptions {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onToolChange: (tool: ConstructionToolId) => void;
  readonly ready: boolean;
}

/**
 * Global keyboard shortcuts for the GM studio: Ctrl+Z/Ctrl+Y for undo/redo,
 * N/P/I select tools (mirroring the hotbar/rail's own tooltips) --
 * nothing here generates geometry directly anymore, a key just changes
 * `activeTool` the same way clicking its hotbar button would. Ignored while
 * an `<input>`/`<textarea>` has focus, so typing in a settings field never
 * triggers a shortcut.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const { canUndo, canRedo, onUndo, onRedo, onToolChange, ready } = options;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (canUndo) onUndo();
      } else if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        if (canRedo) onRedo();
      } else if (event.key.toLowerCase() === "n" || event.key === "Escape") {
        onToolChange("navigate");
      } else if (event.key.toLowerCase() === "p") {
        if (ready) onToolChange("wall-brush");
      } else if (event.key.toLowerCase() === "i") {
        if (ready) onToolChange("terrain-sculpt");
      } else if (event.key.toLowerCase() === "x" || event.key.toLowerCase() === "d") {
        if (ready) onToolChange("demolish");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo, onToolChange, ready]);
}
