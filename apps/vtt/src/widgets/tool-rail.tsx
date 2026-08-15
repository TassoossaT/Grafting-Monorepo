"use client";

import { FloatButtonGroup } from "@/ui";
import type { ConstructionToolId } from "@/features/edit-construction";

/** `tool-rail.tsx`'s own two tools are a subset of the shared `ConstructionToolId` vocabulary -- kept as an alias (not a separate type) so both this rail and `ConstructionHotbar` write to the same piece of state. */
export type EditTool = ConstructionToolId;

export interface ToolRailProps {
  readonly tool: EditTool;
  readonly onToolChange: (tool: EditTool) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly snapToGrid: boolean;
  readonly onSnapToGridChange: (snap: boolean) => void;
}

/**
 * The left rail: navigate/move-node tool selection, the grid-snap toggle,
 * and undo/redo -- always visible as a plain button column (no separate
 * open/close trigger), edit-mode only. Grid snap sits here (not in the
 * construction hotbar) because it is not itself a tool -- it modifies every
 * construction tool's resolved point the same way, via
 * `use-construction-pointer.ts`.
 */
export function ToolRail(props: ToolRailProps) {
  return (
    <FloatButtonGroup
      alwaysExpanded
      placement="bottom"
      style={{
        position: "absolute",
        top: "0.75rem",
        left: "0.75rem",
        zIndex: 15,
      }}
      items={[
        {
          key: "navigate",
          icon: "N",
          tooltip: "Navegar / Pan (tecla N)",
          tone: props.tool === "navigate" ? "primary" : "default",
          onClick: () => props.onToolChange("navigate"),
        },
        {
          key: "move-node",
          icon: "M",
          tooltip: "Mover Node do Grafo (tecla M)",
          tone: props.tool === "move-node" ? "primary" : "default",
          onClick: () => props.onToolChange("move-node"),
        },
        {
          key: "snap-to-grid",
          icon: "🧲",
          tooltip: props.snapToGrid ? "Ímã do Grid: Ativado (tecla G)" : "Ímã do Grid: Desativado (tecla G)",
          tone: props.snapToGrid ? "primary" : "default",
          onClick: () => props.onSnapToGridChange(!props.snapToGrid),
        },
        {
          key: "undo",
          icon: "↶",
          tooltip: "Desfazer (Ctrl+Z)",
          disabled: !props.canUndo,
          onClick: props.onUndo,
        },
        {
          key: "redo",
          icon: "↷",
          tooltip: "Refazer (Ctrl+Y)",
          disabled: !props.canRedo,
          onClick: props.onRedo,
        },
      ]}
    />
  );
}
