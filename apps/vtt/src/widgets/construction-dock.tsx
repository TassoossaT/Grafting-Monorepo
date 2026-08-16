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

  // Active category detection
  const isBuildingActive =
    activeTool === "house-brush" ||
    activeTool === "room-stamp" ||
    activeTool === "room-derive";

  const isTerrainActive =
    activeTool === "terrain-brush" || activeTool === "irregular-terrain-stamp";

  const isWallActive = activeTool === "wall-brush";
  const isDemolishActive = activeTool === "house-room-delete";

  const items: ActionDockItem[] = [
    {
      key: "building",
      label: "Edifícios",
      icon: "🏠",
      tooltip: "Edifícios & Casas procedurais",
      active: isBuildingActive,
      disabled: !ready,
      onClick: () => onToolChange("house-brush"),
      subItems: [
        {
          key: "house-brush",
          label: "Pintar Casa",
          icon: "🏠",
          tooltip: "Pintar Casa (arraste continuamente, divide em cômodos)",
          shortcut: "H",
          active: activeTool === "house-brush",
          disabled: !ready,
          onClick: () => onToolChange("house-brush"),
        },
        {
          key: "room-stamp",
          label: "Carimbo de Sala",
          icon: "◻",
          tooltip: "Carimbo de Sala (clique para gerar sala pronta)",
          shortcut: "R",
          active: activeTool === "room-stamp",
          disabled: !ready,
          onClick: () => onToolChange("room-stamp"),
        },
        {
          key: "room-derive",
          label: "Derivar Sala",
          icon: "📐",
          tooltip: "Derivar Sala (clique dentro de paredes fechadas)",
          active: activeTool === "room-derive",
          disabled: !ready,
          onClick: () => onToolChange("room-derive"),
        },
      ],
    },
    {
      key: "wall",
      label: "Muros",
      icon: "🧱",
      tooltip: "Muros e Cercas livres (arraste para desenhar)",
      shortcut: "P",
      active: isWallActive,
      disabled: !ready,
      onClick: () => onToolChange("wall-brush"),
    },
    {
      key: "openings",
      label: "Aberturas",
      icon: "🚪",
      tooltip: "Portas & Janelas contextuais em paredes",
      disabled: true, // Upcoming procedural opening tool
    },
    {
      key: "stairs",
      label: "Escadas",
      icon: "🪜",
      tooltip: "Escadas entre desníveis de terreno e pisos",
      disabled: true, // Upcoming stairs tool
    },
    {
      key: "paths",
      label: "Caminhos",
      icon: "🛤️",
      tooltip: "Caminhos de terra/pedra que geram arcos em muros",
      disabled: true, // Upcoming path spline tool
    },
    {
      key: "terrain",
      label: "Terreno",
      icon: "⛰️",
      tooltip: "Escultura de Terreno e Elevação",
      shortcut: "T",
      active: isTerrainActive,
      disabled: !ready,
      onClick: () => onToolChange("terrain-brush"),
      subItems: [
        {
          key: "terrain-brush",
          label: "Pincel Circular",
          icon: "⚪",
          tooltip: "Pincel de Terreno Contínuo (tecla T)",
          shortcut: "T",
          active: activeTool === "terrain-brush",
          disabled: !ready,
          onClick: () => onToolChange("terrain-brush"),
        },
        {
          key: "irregular-terrain-stamp",
          label: "Terreno Irregular",
          icon: "◆",
          tooltip: "Pincel de Terreno Hex/Irregular (tecla I)",
          shortcut: "I",
          active: activeTool === "irregular-terrain-stamp",
          disabled: !ready,
          onClick: () => onToolChange("irregular-terrain-stamp"),
        },
      ],
    },
    {
      key: "foliage",
      label: "Vegetação",
      icon: "🌲",
      tooltip: "Pincel de Flora, Arbustos e Adornos",
      disabled: true, // Upcoming foliage brush
    },
    {
      key: "palette",
      label: "Paleta",
      icon: "🎨",
      tooltip: "Estilos, Materiais e Temas Arquitetônicos",
      active: settingsOpen,
      onClick: onToggleSettings,
    },
    {
      key: "demolish",
      label: "Demolir",
      icon: "🔨",
      tooltip: "Apagar cômodos ou elementos selecionados",
      active: isDemolishActive,
      disabled: !ready,
      onClick: () => onToolChange("house-room-delete"),
    },
  ];

  const leadingAccessories = (
    <>
      <button
        type="button"
        onClick={() => onToolChange("navigate")}
        title="Navegar / Pan (tecla N)"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2rem",
          height: "2rem",
          border: activeTool === "navigate" ? "1px solid #72d69e" : "1px solid transparent",
          borderRadius: "9999px",
          background: activeTool === "navigate" ? "rgba(114, 214, 158, 0.16)" : "transparent",
          color: activeTool === "navigate" ? "#72d69e" : "#94a3b8",
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 700,
          transition: "all 0.15s ease",
        }}
      >
        N
      </button>

      <button
        type="button"
        onClick={() => onToolChange("move-node")}
        title="Mover Nó 3D / Vértice (tecla M)"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2rem",
          height: "2rem",
          border: activeTool === "move-node" ? "1px solid #72d69e" : "1px solid transparent",
          borderRadius: "9999px",
          background: activeTool === "move-node" ? "rgba(114, 214, 158, 0.16)" : "transparent",
          color: activeTool === "move-node" ? "#72d69e" : "#94a3b8",
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 700,
          transition: "all 0.15s ease",
        }}
      >
        M
      </button>

      <button
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        title="Desfazer (Ctrl+Z)"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2rem",
          height: "2rem",
          border: "1px solid transparent",
          borderRadius: "9999px",
          background: "transparent",
          color: "#94a3b8",
          cursor: canUndo ? "pointer" : "not-allowed",
          opacity: canUndo ? 1 : 0.35,
          fontSize: "1rem",
          transition: "all 0.15s ease",
        }}
      >
        ↶
      </button>

      <button
        type="button"
        disabled={!canRedo}
        onClick={onRedo}
        title="Refazer (Ctrl+Y)"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2rem",
          height: "2rem",
          border: "1px solid transparent",
          borderRadius: "9999px",
          background: "transparent",
          color: "#94a3b8",
          cursor: canRedo ? "pointer" : "not-allowed",
          opacity: canRedo ? 1 : 0.35,
          fontSize: "1rem",
          transition: "all 0.15s ease",
        }}
      >
        ↷
      </button>
    </>
  );

  const trailingAccessories = (
    <>
      <button
        type="button"
        onClick={() => onSnapToGridChange(!snapToGrid)}
        title={snapToGrid ? "Ímã do Grid: Ativado (tecla G)" : "Ímã do Grid: Desativado (tecla G)"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2rem",
          height: "2rem",
          border: snapToGrid ? "1px solid #72d69e" : "1px solid transparent",
          borderRadius: "9999px",
          background: snapToGrid ? "rgba(114, 214, 158, 0.16)" : "transparent",
          color: snapToGrid ? "#72d69e" : "#94a3b8",
          cursor: "pointer",
          fontSize: "0.95rem",
          transition: "all 0.15s ease",
        }}
      >
        🧲
      </button>

      {onToggleSettings && (
        <button
          type="button"
          onClick={onToggleSettings}
          title="Abrir Painel de Parâmetros e Configurações"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "2rem",
            height: "2rem",
            border: settingsOpen ? "1px solid #72d69e" : "1px solid transparent",
            borderRadius: "9999px",
            background: settingsOpen ? "rgba(114, 214, 158, 0.16)" : "transparent",
            color: settingsOpen ? "#72d69e" : "#94a3b8",
            cursor: "pointer",
            fontSize: "0.95rem",
            transition: "all 0.15s ease",
          }}
        >
          ⚙️
        </button>
      )}
    </>
  );

  return (
    <ActionDock
      ariaLabel="Barra de Ferramentas de Construção Tiny Glade"
      items={items}
      leadingAccessories={leadingAccessories}
      trailingAccessories={trailingAccessories}
      style={{
        position: "absolute",
        left: "50%",
        bottom: "0.85rem",
        transform: "translateX(-50%)",
        zIndex: 25,
      }}
    />
  );
}
