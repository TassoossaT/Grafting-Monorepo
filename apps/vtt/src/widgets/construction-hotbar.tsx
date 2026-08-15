"use client";

import { useState } from "react";

import { Button, FloatButton, FloatButtonGroup, Popover, TerrainShapePicker, type CornerHeights } from "@/ui";

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
 * The bottom hotbar: quick/procedural construction actions, edit-mode only.
 * Sala/Branca/Cinza are direct actions collapsed behind one square,
 * joined-block `FloatButtonGroup` trigger -- `open` is controlled here (per
 * Ant Design's own "controlled mode" contract: `open` used together with
 * `trigger`) purely so each item's own `onClick` can also close the group
 * back to its trigger, which Ant Design does not do on its own. Terreno
 * stays a standalone `FloatButton` outside that group, since its behavior
 * (opens a shape picker) is a panel toggle, not a same-shape action
 * alongside the others -- it keeps the same square outline for visual
 * consistency with the group beside it, without being part of its joined
 * block.
 */
export function ConstructionHotbar(props: ConstructionHotbarProps) {
  const [actionsOpen, setActionsOpen] = useState(false);

  const generateWall = (material?: "wall-white" | "wall-gray") => {
    props.onGenerateWall(material);
    setActionsOpen(false);
  };

  return (
    <>
      <Popover
        open={props.terrainPickerOpen}
        onClose={props.onCloseTerrainPicker}
        title="Moldar Terreno"
        placement="top"
        anchor={
          <FloatButton
            icon="T"
            tooltip="Moldar e Adicionar Célula de Terreno (tecla T gera direto)"
            tone={props.terrainPickerOpen ? "primary" : "default"}
            shape="square"
            disabled={!props.ready}
            onClick={props.onToggleTerrainPicker}
            style={{
              position: "absolute",
              left: "calc(50% - 3rem)",
              bottom: "0.75rem",
              zIndex: 15,
              insetInlineEnd: "auto",
            }}
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

      <FloatButtonGroup
        icon="W"
        placement="right"
        shape="square"
        trigger="hover"
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        style={{
          position: "absolute",
          left: "calc(50% + 0.5rem)",
          bottom: "0.75rem",
          zIndex: 15,
          insetInlineEnd: "auto",
        }}
        items={[
          {
            key: "room",
            icon: "W",
            tooltip: "Adicionar Sala (4 paredes com porta, tecla W)",
            disabled: !props.ready,
            onClick: () => generateWall(),
          },
          {
            key: "wall-white",
            icon: "▢",
            tooltip: "Preset Masmorra Branca (gera uma sala)",
            disabled: !props.ready,
            onClick: () => generateWall("wall-white"),
          },
          {
            key: "wall-gray",
            icon: "▨",
            tooltip: "Preset Masmorra Cinza (gera uma sala)",
            disabled: !props.ready,
            onClick: () => generateWall("wall-gray"),
          },
        ]}
      />
    </>
  );
}
