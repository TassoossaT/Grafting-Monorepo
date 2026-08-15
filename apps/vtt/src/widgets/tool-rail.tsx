"use client";

import { IconButton } from "@/ui";

export type EditTool = "navigate" | "move-node";

export interface ToolRailProps {
  readonly tool: EditTool;
  readonly onToolChange: (tool: EditTool) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

/** The left rail: small, specific, high-frequency tools -- navigate/move-node selection plus undo/redo. */
export function ToolRail(props: ToolRailProps) {
  return (
    <aside className="gm-rail-left" role="toolbar" aria-label="Ferramentas de Construção do Mestre">
      <IconButton
        className="gm-rail-btn"
        icon="N"
        title="Navegar / Pan (tecla N)"
        selected={props.tool === "navigate"}
        onClick={() => props.onToolChange("navigate")}
      />
      <IconButton
        className="gm-rail-btn"
        icon="M"
        title="Mover Node do Grafo (tecla M)"
        selected={props.tool === "move-node"}
        onClick={() => props.onToolChange("move-node")}
      />
      <div className="gm-rail-divider" />
      <IconButton
        className="gm-rail-btn"
        icon="↶"
        title="Desfazer (Ctrl+Z)"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      />
      <IconButton
        className="gm-rail-btn"
        icon="↷"
        title="Refazer (Ctrl+Y)"
        disabled={!props.canRedo}
        onClick={props.onRedo}
      />
    </aside>
  );
}
