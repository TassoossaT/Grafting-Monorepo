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
  readonly snapToGrid: boolean;
  readonly onSnapToGridChange: (snap: boolean) => void;
}

/**
 * Global keyboard shortcuts for the GM studio: Ctrl+Z/Ctrl+Y for undo/redo,
 * N/M/T/P/R select tools (mirroring the hotbar/rail's own tooltips) --
 * nothing here generates geometry directly anymore, a key just changes
 * `activeTool` the same way clicking its hotbar button would. Ignored while
 * an `<input>`/`<textarea>` has focus, so typing in a settings field never
 * triggers a shortcut.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const { canUndo, canRedo, onUndo, onRedo, onToolChange, ready, snapToGrid, onSnapToGridChange } = options;

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
      } else if (event.key.toLowerCase() === "t") {
        if (ready) onToolChange("terrain-brush");
      } else if (event.key.toLowerCase() === "p") {
        if (ready) onToolChange("wall-brush");
      } else if (event.key.toLowerCase() === "r") {
        if (ready) onToolChange("room-stamp");
      } else if (event.key.toLowerCase() === "i") {
        if (ready) onToolChange("irregular-terrain-stamp");
      } else if (event.key.toLowerCase() === "g") {
        onSnapToGridChange(!snapToGrid);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo, onToolChange, ready, snapToGrid, onSnapToGridChange]);
}
