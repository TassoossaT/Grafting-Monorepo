"use client";

import { useState } from "react";

import { Card, SelectableChip, SlidingPanel } from "@/ui";

import type { SurfaceStyle } from "./surface-style.ts";

export interface SelectedNodeInfo {
  readonly id: string;
  /** A plain `{x,y,z}` shape rather than importing `ConstructionPosition` -- `widgets/` may not import `ports` (see `test/architecture-boundaries.test.mjs`), and this widget only ever reads three numbers. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

const MATERIAL_CHOICES: readonly { readonly value: SurfaceStyle; readonly label: string; readonly swatchColor: string }[] = [
  { value: "wall-white", label: "Bloco Branco", swatchColor: "#e2e8f0" },
  { value: "wall-gray", label: "Bloco Cinza", swatchColor: "#64748b" },
  { value: "terrain", label: "Grid Terreno", swatchColor: "#334155" },
  { value: "terrain-grass", label: "Terreno Grama", swatchColor: "#4a7a4a" },
];

const PANEL_WIDTH = 280;

export interface SettingsDrawerProps {
  readonly selectedNodeInfo: SelectedNodeInfo | null;
  readonly activeMaterial: SurfaceStyle;
  readonly onSelectMaterial: (material: SurfaceStyle) => void;
  readonly tokenCount: number;
}

/**
 * The right-side settings/inspector drawer: selection inspector, material
 * picker, and scene metrics -- floats over the map, collapsed by default.
 * Built on the shared `SlidingPanel` molecule, which owns the slide
 * animation and the fused open/close handle; this widget only supplies the
 * product-specific content.
 */
export function SettingsDrawer(props: SettingsDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <SlidingPanel open={open} onOpenChange={setOpen} edge="right" width={PANEL_WIDTH} title="Configurações">
      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Inspector de Seleção</span>
        {props.selectedNodeInfo !== null ? (
          <div style={{ display: "grid", gap: "0.4rem", fontSize: "0.78rem" }}>
            <div className="gm-stat-row">
              <span>Node ID:</span>
              <span className="gm-stat-value">{props.selectedNodeInfo.id}</span>
            </div>
            <div className="gm-stat-row">
              <span>Posição X:</span>
              <span className="gm-stat-value">{props.selectedNodeInfo.point.x.toFixed(2)}m</span>
            </div>
            <div className="gm-stat-row">
              <span>Posição Y:</span>
              <span className="gm-stat-value">{props.selectedNodeInfo.point.y.toFixed(2)}m</span>
            </div>
            <div className="gm-stat-row">
              <span>Posição Z:</span>
              <span className="gm-stat-value">{props.selectedNodeInfo.point.z.toFixed(2)}m</span>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b" }}>
            Clique em uma alça de node (esfera amarela) com a ferramenta <em>Mover Node</em> (M) ativada para
            inspecionar.
          </p>
        )}
      </Card>

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Estilo de Bloco & Material</span>
        <div className="gm-material-grid">
          {MATERIAL_CHOICES.map((choice) => (
            <SelectableChip
              key={choice.value}
              label={choice.label}
              swatchColor={choice.swatchColor}
              selected={props.activeMaterial === choice.value}
              onSelect={() => props.onSelectMaterial(choice.value)}
            />
          ))}
        </div>
      </Card>

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Métricas da Cena</span>
        <div className="gm-stat-row">
          <span>Tokens no Mapa:</span>
          <span className="gm-stat-value">{props.tokenCount}</span>
        </div>
        <div className="gm-stat-row">
          <span>Snap ao Grid:</span>
          <span className="gm-stat-value">Ativado (1.0m)</span>
        </div>
        <div className="gm-stat-row">
          <span>Iluminação:</span>
          <span className="gm-stat-value">Direcional + Amb</span>
        </div>
      </Card>
    </SlidingPanel>
  );
}
