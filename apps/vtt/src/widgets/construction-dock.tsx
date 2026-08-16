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
 * Houses the 9 core construction verbs in a centered, glassmorphic dock:
 * 1. 🏠 Edifícios (Pintar Casa, Carimbo de Sala, Derivar Sala, Expandir)
 * 2. 🧱 Muros & Cercas (Pincel de Parede)
 * 3. 🚪 Aberturas (Portas & Janelas)
 * 4. 🪜 Escadas (Conexão de elevações)
 * 5. 🛤️ Caminhos (Trilhas & química de portais)
 * 6. ⛰️ Terreno & Água (Pincel de Terreno, Terreno Irregular)
 * 7. 🌲 Vegetação (Adornos & Flora)
 * 8. 🎨 Estilo & Paleta (Materiais & Temas)
 * 9. 🔨 Demolir (Apagador de cômodos / elementos)
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

  // Active category and sub-tool detection
  const isHouseBrushActive = activeTool === "house-brush";
  const isRoomStampActive = activeTool === "room-stamp";
  const isRoomDeriveActive = activeTool === "room-derive";
  const isBuildingChildActive = isHouseBrushActive || isRoomStampActive || isRoomDeriveActive;

  const isTerrainBrushActive = activeTool === "terrain-brush";
  const isIrregularTerrainActive = activeTool === "irregular-terrain-stamp";
  const isTerrainChildActive = isTerrainBrushActive || isIrregularTerrainActive;

  const isWallActive = activeTool === "wall-brush";
  const isDemolishActive = activeTool === "house-room-delete";

  const items: ActionDockItem[] = [
    {
      key: "building",
      label: "Edifícios",
      icon: "🏠",
      tooltip: "Edifícios & Casas procedurais",
      active: isHouseBrushActive,
      childActive: isBuildingChildActive,
      disabled: !ready,
      onClick: () => onToolChange("house-brush"),
      subItems: [
        {
          key: "house-brush",
          label: "Pintar Casa",
          icon: "🏠",
          tooltip: "Pintar Casa (arraste continuamente)",
          shortcut: "H",
          active: isHouseBrushActive,
          disabled: !ready,
          onClick: () => onToolChange("house-brush"),
        },
        {
          key: "room-stamp",
          label: "Carimbo de Sala",
          icon: "◻",
          tooltip: "Carimbo de Sala pronta",
          shortcut: "R",
          active: isRoomStampActive,
          disabled: !ready,
          onClick: () => onToolChange("room-stamp"),
        },
        {
          key: "room-derive",
          label: "Derivar Sala",
          icon: "📐",
          tooltip: "Derivar Sala de paredes fechadas",
          active: isRoomDeriveActive,
          disabled: !ready,
          onClick: () => onToolChange("room-derive"),
        },
      ],
    },
    {
      key: "wall",
      label: "Muros",
      icon: "🧱",
      tooltip: "Muros e Cercas livres",
      shortcut: "P",
      active: isWallActive,
      disabled: !ready,
      onClick: () => onToolChange("wall-brush"),
    },
    {
      key: "openings",
      label: "Aberturas",
      icon: "🚪",
      tooltip: "Portas & Janelas",
      disabled: true,
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
      icon: "🛤️",
      tooltip: "Caminhos e Arcos em Muros",
      disabled: true,
    },
    {
      key: "terrain",
      label: "Terreno",
      icon: "⛰️",
      tooltip: "Escultura de Terreno",
      shortcut: "T",
      active: isTerrainBrushActive,
      childActive: isTerrainChildActive,
      disabled: !ready,
      onClick: () => onToolChange("terrain-brush"),
      subItems: [
        {
          key: "terrain-brush",
          label: "Pincel Circular",
          icon: "⚪",
          tooltip: "Pincel de Terreno (tecla T)",
          shortcut: "T",
          active: isTerrainBrushActive,
          disabled: !ready,
          onClick: () => onToolChange("terrain-brush"),
        },
        {
          key: "irregular-terrain-stamp",
          label: "Terreno Irregular",
          icon: "◆",
          tooltip: "Pincel de Terreno Hex (tecla I)",
          shortcut: "I",
          active: isIrregularTerrainActive,
          disabled: !ready,
          onClick: () => onToolChange("irregular-terrain-stamp"),
        },
      ],
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
