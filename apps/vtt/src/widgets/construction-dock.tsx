"use client";

import { ActionDock, type ActionDockItem } from "@/ui";
import type { ConstructionToolId } from "@/features/edit-construction";

export interface ConstructionDockProps {
  readonly ready: boolean;
  readonly activeTool: ConstructionToolId;
  readonly onToolChange: (tool: ConstructionToolId) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly snapToGrid: boolean;
  readonly onSnapToGridChange: (snap: boolean) => void;
  readonly onToggleSettings?: () => void;
  readonly settingsOpen?: boolean;
}

/**
 * The primary bottom ActionDock inspired by Tiny Glade's reactive construction model
 * and `docs/research/vtt-reactive-construction-and-tiny-glade-ui-model.md`.
 *
 * Houses the 8 core construction verbs in a centered, glassmorphic dock:
 * 1. 🏠 Edifícios (Pincel Livre, Linha Reta -- manual free-form/exact
 *    point-to-point walls; Gerar Interiores -- one click inside an
 *    already-enclosed space auto-generates its interior partition via the
 *    same region-partition algorithm the retired "Pintar Casa" brush used;
 *    Torre -- one click stamps a closed circular footprint at a known
 *    preset radius, never freehand-drawn, see `tower-stamp-tool.ts`)
 * 2. 🚪 Aberturas (Portas & Janelas -- one click on a wall panel opens it
 *    and stands a face in the opening, see `opening-tool.ts`)
 * 3. 🪜 Escadas (Conexão de elevações)
 * 4. 🛤️ Caminhos (Trilhas & química de portais)
 * 5. ⛰️ Terreno & Água (Escultura de Terreno)
 * 6. 🌲 Vegetação (Adornos & Flora)
 * 7. 🎨 Estilo & Paleta (Materiais & Temas)
 * 8. 🔨 Demolir (Apagador de cômodos / elementos)
 *
 * The former "Pintar Casa"/"Carimbo de Sala"/"Derivar Sala" cell-grid/stamp
 * tools and the separate "Muros" branch are retired -- the owner flagged the
 * whole cell-grid-room model as the wrong idea; "Edifícios" now means the
 * wall tools, formerly their own "Muros" entry.
 */
export function ConstructionDock(props: ConstructionDockProps) {
  const {
    ready,
    activeTool,
    onToolChange,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    snapToGrid,
    onSnapToGridChange,
    onToggleSettings,
    settingsOpen,
  } = props;

  const isTerrainSculptActive = activeTool === "terrain-sculpt";

  const isWallBrushActive = activeTool === "wall-brush";
  const isWallLineActive = activeTool === "wall-line";
  const isInteriorWallActive = activeTool === "interior-wall";
  const isTowerStampActive = activeTool === "tower-stamp";
  const isWallChildActive = isWallBrushActive || isWallLineActive || isInteriorWallActive || isTowerStampActive;
  const isOpeningActive = activeTool === "opening";
  const isDemolishActive = activeTool === "house-room-delete";

  const items: ActionDockItem[] = [
    {
      key: "building",
      label: "Edifícios",
      icon: "🏠",
      tooltip: "Edifícios (paredes)",
      shortcut: "P",
      active: isWallBrushActive,
      childActive: isWallChildActive,
      disabled: !ready,
      onClick: () => onToolChange("wall-brush"),
      subItems: [
        {
          key: "wall-brush",
          label: "Pincel Livre",
          icon: "🖌️",
          tooltip: "Pincel Livre (arraste continuamente, tecla P)",
          shortcut: "P",
          active: isWallBrushActive,
          disabled: !ready,
          onClick: () => onToolChange("wall-brush"),
        },
        {
          key: "wall-line",
          label: "Linha Reta",
          icon: "📏",
          tooltip: "Linha Reta (clique de um ponto a outro)",
          active: isWallLineActive,
          disabled: !ready,
          onClick: () => onToolChange("wall-line"),
        },
        {
          key: "interior-wall",
          label: "Gerar Interiores",
          icon: "🧩",
          tooltip: "Gerar Interiores (clique dentro de um local já fechado para calcular os cômodos automaticamente)",
          active: isInteriorWallActive,
          disabled: !ready,
          onClick: () => onToolChange("interior-wall"),
        },
        {
          key: "tower-stamp",
          label: "Torre",
          icon: "🗼",
          tooltip: "Torre (clique para carimbar um contorno circular de raio conhecido)",
          active: isTowerStampActive,
          disabled: !ready,
          onClick: () => onToolChange("tower-stamp"),
        },
      ],
    },
    {
      key: "openings",
      label: "Aberturas",
      icon: "🚪",
      tooltip: "Portas & Janelas (clique sobre uma parede para abrir)",
      active: isOpeningActive,
      disabled: !ready,
      onClick: () => onToolChange("opening"),
    },
    {
      key: "stairs",
      label: "Escadas",
      icon: "🪜",
      tooltip: "Escadas e Desníveis",
      disabled: true,
    },
    {
      key: "paths",
      label: "Caminhos",
      icon: "⌁",
      tooltip: "Pincel de Caminhos",
      active: activeTool === "path-brush",
      disabled: !ready,
      onClick: () => onToolChange("path-brush"),
    },
    {
      key: "terrain",
      label: "Escultura de Terreno",
      icon: "⛰️",
      tooltip: "Escultura de Terreno (tecla I)",
      shortcut: "I",
      active: isTerrainSculptActive,
      disabled: !ready,
      onClick: () => onToolChange("terrain-sculpt"),
    },
    {
      key: "foliage",
      label: "Vegetação",
      icon: "🌲",
      tooltip: "Pincel de Flora e Vegetação",
      disabled: true,
    },
    {
      key: "palette",
      label: "Paleta",
      icon: "🎨",
      tooltip: "Estilos, Materiais e Temas",
      active: settingsOpen,
      onClick: onToggleSettings,
    },
    {
      key: "demolish",
      label: "Demolir",
      icon: "🔨",
      tooltip: "Apagar cômodos ou elementos",
      active: isDemolishActive,
      disabled: !ready,
      onClick: () => onToolChange("house-room-delete"),
    },
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: "1.25rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
      }}
    >
      <ActionDock
        ariaLabel="Menu de Construção Tiny Glade"
        items={items}
      />
    </div>
  );
}
