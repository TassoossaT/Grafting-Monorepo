"use client";

import { useState } from "react";

import { Card, SlidingPanel } from "@/ui";
import { ANGLE_STEPS, AUTO_LENGTH_STEP, LENGTH_STEPS, MEASURE_UNITS, RULER_KINDS, formatLength, isMeasureUnitId, type ConstructionToolId, type MeasureUnitId, type RulerKind, type RulerSettings, type StructureEditParams, type ToolParamsByTool } from "@/features/edit-construction";

import { ConstructionToolParamsPanel } from "./construction-tool-params-panel.tsx";

export interface SelectedNodeInfo {
  readonly id: string;
  /** A plain `{x,y,z}` shape rather than importing `ConstructionPosition` -- `widgets/` may not import `ports` (see `test/architecture-boundaries.test.mjs`), and this widget only ever reads three numbers. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

const PANEL_WIDTH = 280;

/** How high the cut slider reaches, in metres, and the step it moves by; the first height it offers when the cut is switched on. */
const HEIGHT_CUT_MAX = 30;
const HEIGHT_CUT_STEP = 0.25;
const HEIGHT_CUT_DEFAULT = 3;

const selectStyle = { background: "#0f172a", color: "inherit", border: "1px solid #1e293b", borderRadius: "0.25rem", padding: "0.15rem 0.3rem" } as const;

/** What each way the ruler catches is called, and what it does. */
const RULER_KIND_LABELS: Readonly<Record<RulerKind, string>> = {
  corner: "Cantos",
  midpoint: "Meio das arestas",
  side: "Ao longo das arestas",
  square: "90° e prolongamento das arestas",
  align: "Alinhar com cantos",
  intersection: "Cruzamento de guias",
  angle: "Mesma direção das arestas",
  polar: "Transferidor (marcas de 5°)",
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
  /** What the table asks of its ruler: what catches, the angle's step and the round number a length lands on. */
  readonly rulerSettings: RulerSettings;
  readonly onRulerSettingsChange: (settings: RulerSettings) => void;
  /** Whether the dots on the graph's nodes are drawn: a debug view, which changes no tool. */
  readonly graphOverlay: boolean;
  readonly onGraphOverlayChange: (visible: boolean) => void;
  /** The height above which the map is hidden, to see and edit inside roofed or upper-floored structures; `undefined` shows it all. */
  readonly heightCut: number | undefined;
  readonly onHeightCutChange: (height: number | undefined) => void;
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
  // The slider remembers where it was left when the cut is switched off and on again.
  const [cutHeight, setCutHeight] = useState(props.heightCut ?? HEIGHT_CUT_DEFAULT);
  const cutOn = props.heightCut !== undefined;

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
        <span className="gm-panel-card-title">Corte de altura</span>
        <div style={{ display: "grid", gap: "0.3rem", fontSize: "0.78rem" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={cutOn} onChange={(event) => props.onHeightCutChange(event.target.checked ? cutHeight : undefined)} />
            <span>Esconder o que passa da altura</span>
          </label>
          <label className="gm-stat-row" style={{ alignItems: "center" }}>
            <input
              type="range"
              min={0}
              max={HEIGHT_CUT_MAX}
              step={HEIGHT_CUT_STEP}
              value={cutHeight}
              disabled={!cutOn}
              onChange={(event) => {
                const height = Number(event.target.value);
                setCutHeight(height);
                props.onHeightCutChange(height);
              }}
              style={{ flex: 1 }}
            />
            <span className="gm-stat-value">{formatLength(cutHeight, props.measureUnit)}</span>
          </label>
          <p style={{ margin: "0.2rem 0 0", color: "#64748b", fontSize: "0.72rem" }}>
            Só a visão: esconde telhados e andares de cima para editar dentro. Não muda a construção.
          </p>
        </div>
      </Card>

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Depuração</span>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.78rem" }}>
          <input type="checkbox" checked={props.graphOverlay} onChange={(event) => props.onGraphOverlayChange(event.target.checked)} />
          <span>Pontos do grafo (só visualização)</span>
        </label>
      </Card>

      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Régua: o que encaixa</span>
        <div style={{ display: "grid", gap: "0.3rem", fontSize: "0.78rem" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={props.rulerSettings.numbers} onChange={(event) => props.onRulerSettingsChange({ ...props.rulerSettings, numbers: event.target.checked })} />
            <span>Números no mapa</span>
          </label>
          <label className="gm-stat-row" style={{ alignItems: "center" }}>
            <span>Passo do ângulo:</span>
            <select value={props.rulerSettings.angleStep} onChange={(event) => props.onRulerSettingsChange({ ...props.rulerSettings, angleStep: Number(event.target.value) })} style={selectStyle}>
              {ANGLE_STEPS.map((step) => <option key={step} value={step}>{step}°</option>)}
            </select>
          </label>
          <label className="gm-stat-row" style={{ alignItems: "center" }}>
            <span>Número fechado:</span>
            <select value={props.rulerSettings.lengthStep} onChange={(event) => props.onRulerSettingsChange({ ...props.rulerSettings, lengthStep: event.target.value === AUTO_LENGTH_STEP ? AUTO_LENGTH_STEP : Number(event.target.value) })} style={selectStyle}>
              <option value={AUTO_LENGTH_STEP}>Automático (segue o zoom)</option>
              {LENGTH_STEPS.map((step) => <option key={step} value={step}>{step === 0 ? "Desligado" : `de ${step} em ${step} ${MEASURE_UNITS[props.measureUnit].symbol}`}</option>)}
            </select>
          </label>
          {RULER_KINDS.map((kind) => (
            <label key={kind} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!props.rulerSettings.disabled.has(kind)}
                onChange={(event) => {
                  const next = new Set(props.rulerSettings.disabled);
                  if (event.target.checked) next.delete(kind); else next.add(kind);
                  props.onRulerSettingsChange({ ...props.rulerSettings, disabled: next });
                }}
              />
              <span>{RULER_KIND_LABELS[kind]}</span>
            </label>
          ))}
          <p style={{ margin: "0.2rem 0 0", color: "#64748b", fontSize: "0.72rem" }}>
            Ctrl: posiciona sem encaixe. Shift: marcas de 5°. Digite um número ao desenhar para fixar o comprimento.
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
