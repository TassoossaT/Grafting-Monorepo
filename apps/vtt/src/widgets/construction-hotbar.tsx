"use client";

import { FloatButtonTree, type FloatButtonTreeLeaf } from "@/ui";
import type { ConstructionToolId } from "@/features/edit-construction";

export interface ConstructionHotbarProps {
  readonly ready: boolean;
  readonly activeTool: ConstructionToolId;
  readonly onToolChange: (tool: ConstructionToolId) => void;
}

const CONSTRUCTION_TOOLS: readonly { readonly id: ConstructionToolId; readonly icon: string; readonly tooltip: string }[] = [
  { id: "path-brush", icon: "⌁", tooltip: "Rua Bézier (criar e ajustar pontos)" },
  { id: "wall-brush", icon: "W", tooltip: "Pincel de Parede (clique livremente, tecla P)" },
  { id: "terrain-sculpt", icon: "◆", tooltip: "Escultura de Terreno (clique ou arraste, tecla I)" },
];

/**
 * The bottom hotbar: selects the active construction tool only -- it never
 * generates geometry itself. A tool's own parameters live in
 * `ConstructionToolParamsPanel` (the right drawer); what a selected tool
 * does with the pointer lives in `composition/tabletop/tools/*.ts` via
 * `useConstructionPointer`. One root {@link FloatButtonTree} branch
 * ("Construir") expands into one leaf per tool. Editing an existing
 * structure is not a tool of its own: every construction tool grabs and
 * edits whatever it owns (`composition/tabletop/tools/core/structure-edit-behavior.ts`).
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
        tone: props.activeTool === "navigate" ? "default" : "primary",
        children: leaves,
      }}
    />
  );
}
