"use client";

import { useState } from "react";

import { Card, SlidingPanel } from "@/ui";
import { MEASURE_UNITS, RULER_KINDS, formatLength, isMeasureUnitId, type ConstructionToolId, type MeasureUnitId, type RulerKind, type StructureEditParams, type ToolParamsByTool } from "@/features/edit-construction";

import { ConstructionToolParamsPanel } from "./construction-tool-params-panel.tsx";

export interface SelectedNodeInfo {
  readonly id: string;
  /** A plain `{x,y,z}` shape rather than importing `ConstructionPosition` -- `widgets/` may not import `ports` (see `test/architecture-boundaries.test.mjs`), and this widget only ever reads three numbers. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

const PANEL_WIDTH = 280;

/** What each way the ruler catches is called, and what it does. */
const RULER_KIND_LABELS: Readonly<Record<RulerKind, string>> = {
  corner: "Cantos",
  midpoint: "Meio das arestas",
  side: "Ao longo das arestas",
  square: "90° e prolongamento das arestas",
  align: "Alinhar com cantos",
  intersection: "Cruzamento de guias",
  angle: "Mesma direção das arestas",
  polar: "Passos de 45° (Shift: 15°)",
  length: "Comprimento igual ao de uma aresta",
  level: "Alturas iguais",
};

export interface SettingsDrawerProps {
  readonly selectedNodeInfo: SelectedNodeInfo | null;
  readonly activeTool: ConstructionToolId;
  readonly toolParams: ToolParamsByTool;
  readonly onToolParamsChange: <Id extends ConstructionToolId>(toolId: Id, next: ToolParamsByTool[Id]) => void;
  readonly structureEditParams: StructureEditParams;
  readonly onStructureEditParamsChange: (next: StructureEditParams) => void;
  readonly tokenCount: number;
  /** The unit the table writes every distance in. */
  readonly measureUnit: MeasureUnitId;
  readonly onMeasureUnitChange: (unit: MeasureUnitId) => void;
  /** The ways of catching the table leaves out of its ruler. */
  readonly rulerDisabled: ReadonlySet<RulerKind>;
  readonly onRulerDisabledChange: (disabled: ReadonlySet<RulerKind>) => void;
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
              <span className="gm-stat-value">{formatLength(props.selectedNodeInfo.point.x, props.measureUnit)}</span>
            </div>
            <div className="gm-stat-row">
              <span>Posição Y:</span>
              <span className="gm-stat-value">{formatLength(props.selectedNodeInfo.point.y, props.measureUnit)}</span>
            </div>
            <div className="gm-stat-row">
              <span>Posição Z:</span>
              <span className="gm-stat-value">{formatLength(props.selectedNodeInfo.point.z, props.measureUnit)}</span>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b" }}>
            Clique em uma alça de node (esfera amarela) de uma estrutura já existente, com a ferramenta que a criou
            ativa, para inspecionar.
          </p>
        )}
      </Card>

      <ConstructionToolParamsPanel
        activeTool={props.activeTool}
        params={props.toolParams}
        onParamsChange={props.onToolParamsChange}
        structureEditParams={props.structureEditParams}
        onStructureEditParamsChange={props.onStructureEditParamsChange}
      />

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Mesa</span>
        <label className="gm-stat-row" style={{ alignItems: "center" }}>
          <span>Unidade de medida:</span>
          <select
            value={props.measureUnit}
            onChange={(event) => { if (isMeasureUnitId(event.target.value)) props.onMeasureUnitChange(event.target.value); }}
            style={{ background: "#0f172a", color: "inherit", border: "1px solid #1e293b", borderRadius: "0.25rem", padding: "0.15rem 0.3rem" }}
          >
            {Object.values(MEASURE_UNITS).map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </label>
      </Card>

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Régua: o que encaixa</span>
        <div style={{ display: "grid", gap: "0.3rem", fontSize: "0.78rem" }}>
          {RULER_KINDS.map((kind) => (
            <label key={kind} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!props.rulerDisabled.has(kind)}
                onChange={(event) => {
                  const next = new Set(props.rulerDisabled);
                  if (event.target.checked) next.delete(kind); else next.add(kind);
                  props.onRulerDisabledChange(next);
                }}
              />
              <span>{RULER_KIND_LABELS[kind]}</span>
            </label>
          ))}
          <p style={{ margin: "0.2rem 0 0", color: "#64748b", fontSize: "0.72rem" }}>
            Segure Ctrl para posicionar sem encaixe. Digite um número ao desenhar para fixar o comprimento.
          </p>
        </div>
      </Card>

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Métricas da Cena</span>
        <div className="gm-stat-row">
          <span>Tokens no Mapa:</span>
          <span className="gm-stat-value">{props.tokenCount}</span>
        </div>
        <div className="gm-stat-row">
          <span>Iluminação:</span>
          <span className="gm-stat-value">Direcional + Amb</span>
        </div>
      </Card>
    </SlidingPanel>
  );
}
