"use client";

import { Button, IconButton, Popover, TerrainShapePicker, type CornerHeights } from "@/ui";

import type { SurfaceStyle } from "./surface-style.ts";

export interface ConstructionHotbarProps {
  readonly ready: boolean;
  readonly activeMaterial: SurfaceStyle;
  readonly onGenerateWall: (material?: "wall-white" | "wall-gray") => void;
  readonly terrainPickerOpen: boolean;
  readonly onToggleTerrainPicker: () => void;
  readonly onCloseTerrainPicker: () => void;
  readonly terrainShape: CornerHeights;
  readonly onTerrainShapeChange: (shape: CornerHeights) => void;
  readonly onGenerateTerrainCell: () => void;
}

/**
 * The bottom hotbar: bigger blocks for quick/procedural construction --
 * generate a room, shape and generate a terrain cell (via a popover
 * anchored to its own trigger button), or generate a room with a specific
 * wall preset.
 */
export function ConstructionHotbar(props: ConstructionHotbarProps) {
  return (
    <div className="gm-hotbar" role="toolbar" aria-label="Construção Rápida">
      <IconButton
        className="gm-hotbar-block"
        icon="W"
        label="Sala"
        title="Adicionar Sala (4 paredes com porta, tecla W)"
        disabled={!props.ready}
        onClick={() => props.onGenerateWall()}
      />

      <Popover
        open={props.terrainPickerOpen}
        onClose={props.onCloseTerrainPicker}
        title="Moldar Terreno"
        placement="top"
        anchor={
          <IconButton
            className="gm-hotbar-block"
            icon="T"
            label="Terreno"
            title="Moldar e Adicionar Célula de Terreno (tecla T gera direto)"
            disabled={!props.ready}
            selected={props.terrainPickerOpen}
            onClick={props.onToggleTerrainPicker}
          />
        }
      >
        <div className="gm-terrain-popover-body">
          <TerrainShapePicker cornerHeights={props.terrainShape} onChange={props.onTerrainShapeChange} />
          <div className="gm-terrain-popover-actions">
            <Button label="Nivelar" onClick={() => props.onTerrainShapeChange([1, 1, 1, 1])} />
            <Button
              label="Gerar Terreno"
              tone="accent"
              onClick={() => {
                props.onGenerateTerrainCell();
                props.onCloseTerrainPicker();
              }}
            />
          </div>
        </div>
      </Popover>

      <IconButton
        className="gm-hotbar-block"
        icon="▢"
        label="Branca"
        title="Preset Masmorra Branca (gera uma sala)"
        disabled={!props.ready}
        selected={props.activeMaterial === "wall-white"}
        onClick={() => props.onGenerateWall("wall-white")}
      />
      <IconButton
        className="gm-hotbar-block"
        icon="▨"
        label="Cinza"
        title="Preset Masmorra Cinza (gera uma sala)"
        disabled={!props.ready}
        selected={props.activeMaterial === "wall-gray"}
        onClick={() => props.onGenerateWall("wall-gray")}
      />
    </div>
  );
}
