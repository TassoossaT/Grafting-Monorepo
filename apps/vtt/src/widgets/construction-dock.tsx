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
 * 1. 🏠 Edifícios (Pincel de Parede -- free-form, click-to-extend, no closure required)
 * 2. 🚪 Aberturas (Portas & Janelas)
 * 3. 🪜 Escadas (Conexão de elevações)
 * 4. 🛤️ Caminhos (Trilhas & química de portais)
 * 5. ⛰️ Terreno & Água (Pincel de Terreno, Terreno Irregular)
 * 6. 🌲 Vegetação (Adornos & Flora)
 * 7. 🎨 Estilo & Paleta (Materiais & Temas)
 * 8. 🔨 Demolir (Apagador de cômodos / elementos)
 *
 * The former "Pintar Casa"/"Carimbo de Sala"/"Derivar Sala" cell-grid/stamp
 * tools and the separate "Muros" branch are retired -- the owner flagged the
 * whole cell-grid-room model as the wrong idea; "Edifícios" now means
 * exactly the free-form wall brush, formerly its own "Muros" entry.
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
      tooltip: "Edifícios (Pincel de Parede livre)",
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
