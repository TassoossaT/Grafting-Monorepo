"use client";

import { useState } from "react";

import { Card, SlidingPanel } from "@/ui";
import type { ConstructionToolId, ToolParamsByTool } from "@/features/edit-construction";

import { ConstructionToolParamsPanel } from "./construction-tool-params-panel.tsx";

export interface SelectedNodeInfo {
  readonly id: string;
  /** A plain `{x,y,z}` shape rather than importing `ConstructionPosition` -- `widgets/` may not import `ports` (see `test/architecture-boundaries.test.mjs`), and this widget only ever reads three numbers. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

const PANEL_WIDTH = 280;

export interface SettingsDrawerProps {
  readonly selectedNodeInfo: SelectedNodeInfo | null;
  readonly activeTool: ConstructionToolId;
  readonly toolParams: ToolParamsByTool;
  readonly onToolParamsChange: <Id extends ConstructionToolId>(toolId: Id, next: ToolParamsByTool[Id]) => void;
  readonly tokenCount: number;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * The right-side settings/inspector drawer: selection inspector, the active
 * construction tool's parameters, and scene metrics -- floats over the map,
 * collapsed by default.
 * Built on the shared `SlidingPanel` molecule, which owns the slide
 * animation and the fused open/close handle; this widget only supplies the
 * product-specific content.
 */
export function SettingsDrawer(props: SettingsDrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = props.open ?? uncontrolledOpen;
  const setOpen = props.onOpenChange ?? setUncontrolledOpen;

  return (
    <SlidingPanel open={isOpen} onOpenChange={setOpen} edge="right" width={PANEL_WIDTH}>
      <span className="gm-panel-card-title" style={{ padding: "0.75rem 1rem 0" }}>
        Configurações
      </span>

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

      <ConstructionToolParamsPanel
        activeTool={props.activeTool}
        params={props.toolParams}
        onParamsChange={props.onToolParamsChange}
      />

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
