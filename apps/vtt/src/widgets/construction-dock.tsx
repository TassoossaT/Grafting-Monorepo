"use client";

import { ActionDock, type ActionDockItem } from "@/ui";
import type { ConstructionToolId, OpeningParams, TerrainSculptMode } from "@/features/edit-construction";

export interface ConstructionDockProps {
  readonly ready: boolean;
  readonly activeTool: ConstructionToolId;
  readonly onToolChange: (tool: ConstructionToolId) => void;
  /** Which opening preset the Aberturas blocks show as picked. */
  readonly openingKind: OpeningParams["openingKind"];
  /** Picks the opening preset and activates the opening tool. */
  readonly onOpeningKindChange: (kind: OpeningParams["openingKind"]) => void;
  /** Which terrain stroke the Terreno blocks show as picked. */
  readonly terrainMode: TerrainSculptMode;
  /** Picks the terrain stroke and activates the terrain tool. */
  readonly onTerrainModeChange: (mode: TerrainSculptMode) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
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
 * 3. 🪜 Rampas (Conexão de elevações -- Rampa reta, arrastada do início ao
 *    fim; Rampa curva, nos modos de criação compartilhados de espinha; e
 *    Espiral, centro-início-fim. Degraus são dos assets, não da estrutura)
 * 4. 🛤️ Caminhos (Trilhas & química de portais)
 * 5. ⛰️ Terreno & Água (Escultura de Terreno)
 * 6. 🌲 Vegetação (Adornos & Flora)
 * 7. 🎨 Estilo & Paleta (Materiais & Temas)
 * 8. 🔨 Demolir (click or brush)
 */
export function ConstructionDock(props: ConstructionDockProps) {
  const {
    ready,
    activeTool,
    onToolChange,
    openingKind,
    onOpeningKindChange,
    terrainMode,
    onTerrainModeChange,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onToggleSettings,
    settingsOpen,
  } = props;

  const isTerrainSculptActive = activeTool === "terrain-sculpt";
  // "elevate" and "lower" are the older names of the same two strokes.
  const terrainStroke = terrainMode === "elevate" ? "add" : terrainMode === "lower" ? "dig" : terrainMode;

  const isWallBrushActive = activeTool === "wall-brush";
  const isWallLineActive = activeTool === "wall-line";
  const isTowerStampActive = activeTool === "tower-stamp";
  const isRoofActive = activeTool === "roof";
  const isPlatformActive = activeTool === "platform-contour";
  const isWallChildActive = isWallLineActive || isTowerStampActive || isPlatformActive || isRoofActive;
  const isRampActive = activeTool === "slope-ramp";
  const isSpiralActive = activeTool === "slope-spiral";
  const isCurveRampActive = activeTool === "slope-curve";
  const isOpeningActive = activeTool === "opening";

  const items: ActionDockItem[] = [
    {
      key: "building",
      label: "Edifícios",
      icon: "🏠",
      tooltip: "Edifícios (paredes e plataformas)",
      active: isWallLineActive,
      childActive: isWallChildActive,
      disabled: !ready,
      onClick: () => onToolChange("wall-line"),
      subItems: [
        { key: "roof", label: "Telhado", icon: "?", tooltip: "Criar cobertura retangular ou circular", active: isRoofActive, disabled: !ready, onClick: () => onToolChange("roof") },
        { key: "platform", label: "Plataforma", icon: "▱", tooltip: "Pisos, tetos e bases: criar, ampliar ou recortar", active: isPlatformActive, disabled: !ready, onClick: () => onToolChange("platform-contour") },
        {
          key: "wall-line",
          label: "Parede",
          icon: "📏",
          tooltip: "Parede reta ou curva: arraste para desenhar",
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
      key: "wall-brush",
      label: "Muros",
      icon: "🖌️",
      tooltip: "Muros: desenhe livremente com o pincel (P)",
      shortcut: "P",
      active: isWallBrushActive,
      disabled: !ready,
      onClick: () => onToolChange("wall-brush"),
    },
    {
      key: "openings",
      label: "Aberturas",
      icon: "🚪",
      tooltip: "Portas & Janelas -- clique numa parede para abrir uma nova; numa existente, arraste as alças para mover ou redimensionar, clique para selecionar e Delete apaga",
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
      label: "Rampas",
      icon: "🪜",
      tooltip: "Rampas e desníveis: reta, curva e espiral",
      active: isRampActive,
      childActive: isRampActive || isSpiralActive || isCurveRampActive,
      disabled: !ready,
      onClick: () => onToolChange("slope-ramp"),
      subItems: [
        { key: "slope-ramp", label: "Rampa", icon: "⟋", tooltip: "Rampa reta: arraste do início ao fim", active: isRampActive, disabled: !ready, onClick: () => onToolChange("slope-ramp") },
        { key: "slope-curve", label: "Rampa curva", icon: "⤴", tooltip: "Rampa curva: por pontos, reta, arco, ligar pontas ou espiral (R troca o modo)", active: isCurveRampActive, disabled: !ready, onClick: () => onToolChange("slope-curve") },
        { key: "slope-spiral", label: "Espiral", icon: "🌀", tooltip: "Espiral: clique o centro, o início, gire e clique o fim", active: isSpiralActive, disabled: !ready, onClick: () => onToolChange("slope-spiral") },
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
      childActive: isTerrainSculptActive,
      disabled: !ready,
      onClick: () => onToolChange("terrain-sculpt"),
      subItems: [
        { key: "terrain-add", label: "Adicionar", icon: "⛰️", tooltip: "Adicionar terreno: arraste para erguer o chão", active: isTerrainSculptActive && terrainStroke === "add", disabled: !ready, onClick: () => onTerrainModeChange("add") },
        { key: "terrain-dig", label: "Remover", icon: "⛏️", tooltip: "Remover terreno: arraste para cavar", active: isTerrainSculptActive && terrainStroke === "dig", disabled: !ready, onClick: () => onTerrainModeChange("dig") },
        { key: "terrain-flatten", label: "Aplainar", icon: "▬", tooltip: "Aplainar: arraste para nivelar o chão", active: isTerrainSculptActive && terrainStroke === "flatten", disabled: !ready, onClick: () => onTerrainModeChange("flatten") },
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
      tooltip: "Demolir elemento (clique ou arraste para remover)",
      active: activeTool === "demolish",
      disabled: !ready,
      onClick: () => onToolChange("demolish"),
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
