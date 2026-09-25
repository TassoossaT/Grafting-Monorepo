"use client";

import { ActionDock, type ActionDockItem } from "@/ui";
import type { ConstructionToolId, OpeningParams } from "@/features/edit-construction";

export interface ConstructionDockProps {
  readonly ready: boolean;
  readonly activeTool: ConstructionToolId;
  readonly onToolChange: (tool: ConstructionToolId) => void;
  /** Which opening preset the Aberturas blocks show as picked. */
  readonly openingKind: OpeningParams["openingKind"];
  /** Picks the opening preset and activates the opening tool. */
  readonly onOpeningKindChange: (kind: OpeningParams["openingKind"]) => void;
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
 *    point-to-point walls; Torre -- one click stamps a closed circular footprint at a known
 *    preset radius, never freehand-drawn, see `tower-stamp-tool.ts`)
 * 2. 🚪 Aberturas (Portas & Janelas -- one click on a wall panel opens it
 *    and stands a face in the opening, see `opening-tool.ts`)
 * 3. 🪜 Escadas (Conexão de elevações -- Rampa, arrastada do início ao fim,
 *    e Espiral, clicada no centro; both draw a sloped platform)
 * 4. 🛤️ Caminhos (Trilhas & química de portais)
 * 5. ⛰️ Terreno & Água (Escultura de Terreno)
 * 6. 🌲 Vegetação (Adornos & Flora)
 * 7. 🎨 Estilo & Paleta (Materiais & Temas)
 * 8. 🔨 Demolir (disabled until the generic delete tool exists)
 */
export function ConstructionDock(props: ConstructionDockProps) {
  const {
    ready,
    activeTool,
    onToolChange,
    openingKind,
    onOpeningKindChange,
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
  const isTowerStampActive = activeTool === "tower-stamp";
  const isRoofActive = activeTool === "roof";
  const isPlatformActive = activeTool === "platform-contour";
  const isWallChildActive = isWallBrushActive || isWallLineActive || isTowerStampActive || isPlatformActive || isRoofActive;
  const isRampActive = activeTool === "slope-ramp";
  const isSpiralActive = activeTool === "slope-spiral";
  const isOpeningActive = activeTool === "opening";

  const items: ActionDockItem[] = [
    {
      key: "building",
      label: "Edifícios",
      icon: "🏠",
      tooltip: "Edifícios (paredes e plataformas)",
      shortcut: "P",
      active: isWallBrushActive,
      childActive: isWallChildActive,
      disabled: !ready,
      onClick: () => onToolChange("wall-brush"),
      subItems: [
        { key: "roof", label: "Telhado", icon: "?", tooltip: "Criar cobertura retangular ou circular", active: isRoofActive, disabled: !ready, onClick: () => onToolChange("roof") },
        { key: "platform", label: "Plataforma", icon: "▱", tooltip: "Pisos, tetos e bases: criar, ampliar ou recortar", active: isPlatformActive, disabled: !ready, onClick: () => onToolChange("platform-contour") },
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
      tooltip: "Portas & Janelas -- clique numa parede para abrir uma nova, clique numa existente para selecionar e editar (mover/redimensionar clicando na parede de novo, Delete apaga)",
      active: isOpeningActive,
      childActive: isOpeningActive,
      disabled: !ready,
      onClick: () => onToolChange("opening"),
      subItems: [
        { key: "opening-window", label: "Janela", icon: "🪟", tooltip: "Janela: arraste numa parede, ou clique para o tamanho padrão", active: isOpeningActive && openingKind === "window", disabled: !ready, onClick: () => onOpeningKindChange("window") },
        { key: "opening-door", label: "Porta", icon: "🚪", tooltip: "Porta: arraste numa parede, ou clique para o tamanho padrão; o peitoril fica no chão", active: isOpeningActive && openingKind === "door", disabled: !ready, onClick: () => onOpeningKindChange("door") },
      ],
    },
    {
      key: "stairs",
      label: "Escadas",
      icon: "🪜",
      tooltip: "Escadas e Desníveis (rampas e espirais)",
      active: isRampActive,
      childActive: isRampActive || isSpiralActive,
      disabled: !ready,
      onClick: () => onToolChange("slope-ramp"),
      subItems: [
        { key: "slope-ramp", label: "Rampa", icon: "⟋", tooltip: "Rampa reta: arraste do início ao fim", active: isRampActive, disabled: !ready, onClick: () => onToolChange("slope-ramp") },
        { key: "slope-spiral", label: "Espiral", icon: "🌀", tooltip: "Espiral: clique no centro", active: isSpiralActive, disabled: !ready, onClick: () => onToolChange("slope-spiral") },
      ],
    },
    {
      key: "paths",
      label: "Caminhos",
      icon: "⌁",
      tooltip: "Rua Bézier: criar e ajustar pontos",
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
      tooltip: "Apagar elementos",
      disabled: true,
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
