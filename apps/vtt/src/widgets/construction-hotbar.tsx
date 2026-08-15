"use client";

import { FloatButtonTree, type FloatButtonTreeLeaf } from "@/ui";
import type { ConstructionToolId } from "@/features/edit-construction";

export interface ConstructionHotbarProps {
  readonly ready: boolean;
  readonly activeTool: ConstructionToolId;
  readonly onToolChange: (tool: ConstructionToolId) => void;
}

const CONSTRUCTION_TOOLS: readonly { readonly id: ConstructionToolId; readonly icon: string; readonly tooltip: string }[] = [
  { id: "terrain-brush", icon: "T", tooltip: "Pincel de Terreno (tecla T)" },
  { id: "wall-brush", icon: "W", tooltip: "Pincel de Parede (arraste para desenhar, tecla P)" },
  { id: "room-stamp", icon: "R", tooltip: "Carimbo de Sala (clique para gerar, tecla R)" },
  { id: "irregular-terrain-stamp", icon: "◆", tooltip: "Pincel de Terreno Irregular (clique ou arraste, tecla I)" },
];

/**
 * The bottom hotbar: selects the active construction tool only -- it never
 * generates geometry itself. A tool's own parameters live in
 * `ConstructionToolParamsPanel` (the right drawer); what a selected tool
 * does with the pointer lives in `composition/tabletop/tools/*.ts` via
 * `useConstructionPointer`. One root {@link FloatButtonTree} branch
 * ("Construir") expands into one leaf per tool, replacing the former
 * direct-action buttons.
 */
export function ConstructionHotbar(props: ConstructionHotbarProps) {
  const leaves: FloatButtonTreeLeaf[] = CONSTRUCTION_TOOLS.map((tool) => ({
    key: tool.id,
    icon: tool.icon,
    tooltip: tool.tooltip,
    tone: props.activeTool === tool.id ? "primary" : "default",
    disabled: !props.ready,
    onClick: () => props.onToolChange(tool.id),
  }));

  return (
    <FloatButtonTree
      shape="square"
      placement="top"
      style={{
        position: "absolute",
        left: "50%",
        bottom: "0.75rem",
        transform: "translateX(-50%)",
        zIndex: 15,
      }}
      root={{
        key: "construction-tools",
        icon: "C",
        tooltip: "Construir",
        tone: props.activeTool === "navigate" || props.activeTool === "move-node" ? "default" : "primary",
        children: leaves,
      }}
    />
  );
}
