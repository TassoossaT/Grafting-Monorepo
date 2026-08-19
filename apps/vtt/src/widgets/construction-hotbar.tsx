"use client";

import { FloatButtonTree, type FloatButtonTreeBranch, type FloatButtonTreeLeaf, type FloatButtonTreeNode } from "@/ui";
import type { ConstructionToolId } from "@/features/edit-construction";

export interface ConstructionHotbarProps {
  readonly ready: boolean;
  readonly activeTool: ConstructionToolId;
  readonly onToolChange: (tool: ConstructionToolId) => void;
}

const CONSTRUCTION_TOOLS: readonly { readonly id: ConstructionToolId; readonly icon: string; readonly tooltip: string }[] = [
  { id: "path-brush", icon: "⌁", tooltip: "Pincel de Caminho (clique no terreno)" },
  { id: "wall-brush", icon: "W", tooltip: "Pincel de Parede (clique livremente, tecla P)" },
  { id: "terrain-sculpt", icon: "◆", tooltip: "Escultura de Terreno (clique ou arraste, tecla I)" },
];

/** The "Casa" branch's own children. */
const HOUSE_TOOLS: readonly { readonly id: ConstructionToolId; readonly icon: string; readonly tooltip: string }[] = [
  { id: "house-room-delete", icon: "−", tooltip: "Apagar Cômodo (clique dentro de um cômodo)" },
  { id: "move-node", icon: "◇", tooltip: "Expandir Cômodo (arraste um canto -- mesma ferramenta de mover nó)" },
];

const HOUSE_TOOL_IDS: ReadonlySet<ConstructionToolId> = new Set(HOUSE_TOOLS.map((tool) => tool.id));

/**
 * The bottom hotbar: selects the active construction tool only -- it never
 * generates geometry itself. A tool's own parameters live in
 * `ConstructionToolParamsPanel` (the right drawer); what a selected tool
 * does with the pointer lives in `composition/tabletop/tools/*.ts` via
 * `useConstructionPointer`. One root {@link FloatButtonTree} branch
 * ("Construir") expands into one leaf per direct-action tool plus one
 * nested "Casa" branch -- "Expandir Cômodo" deliberately reuses the
 * `move-node` tool id rather than introducing a new one, since dragging a
 * shared corner already resizes whichever room(s) reference it with zero
 * house-specific code (`VTT-HOUSE-INCREMENTAL-EDIT`'s own finding).
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

  const houseBranch: FloatButtonTreeBranch = {
    key: "house-tools",
    icon: "H",
    tooltip: "Casa",
    tone: HOUSE_TOOL_IDS.has(props.activeTool) ? "primary" : "default",
    disabled: !props.ready,
    children: HOUSE_TOOLS.map((tool): FloatButtonTreeLeaf => ({
      key: tool.id,
      icon: tool.icon,
      tooltip: tool.tooltip,
      tone: props.activeTool === tool.id ? "primary" : "default",
      disabled: !props.ready,
      onClick: () => props.onToolChange(tool.id),
    })),
  };

  const children: FloatButtonTreeNode[] = [...leaves, houseBranch];

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
        children,
      }}
    />
  );
}
