"use client";

import { FloatButtonGroup } from "@/ui";

export type EditTool = "navigate" | "move-node";

export interface ToolRailProps {
  readonly tool: EditTool;
  readonly onToolChange: (tool: EditTool) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

/**
 * The left rail: navigate/move-node tool selection plus undo/redo, always
 * visible as a plain button column (no separate open/close trigger),
 * edit-mode only.
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
