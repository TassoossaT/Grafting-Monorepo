"use client";

import { Card, Collapse, SelectableChip, type CollapsePanel } from "@/ui";
import type {
  ConstructionToolId,
  IrregularTerrainParams,
  TerrainBrushParams,
  ToolParamsByTool,
  WallBrushParams,
} from "@/features/edit-construction";

export interface ConstructionToolParamsPanelProps {
  readonly activeTool: ConstructionToolId;
  readonly params: ToolParamsByTool;
  readonly onParamsChange: <Id extends ConstructionToolId>(toolId: Id, next: ToolParamsByTool[Id]) => void;
}

function sliderRow(label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void) {
  return (
    <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.78rem" }}>
      <span className="gm-stat-row">
        <span>{label}</span>
        <span className="gm-stat-value">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function TerrainBrushFields(props: {
  readonly params: TerrainBrushParams;
  readonly onChange: (next: TerrainBrushParams) => void;
}) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid">
        <SelectableChip
          label="Terreno"
          swatchColor="#334155"
          selected={params.targetSurface === "terrain"}
          onSelect={() => onChange({ ...params, targetSurface: "terrain" })}
        />
        <SelectableChip
          label="Grama"
          swatchColor="#4a7a4a"
          selected={params.targetSurface === "terrain-grass"}
          onSelect={() => onChange({ ...params, targetSurface: "terrain-grass" })}
        />
      </div>
      {sliderRow("Tamanho do pincel", params.radius, 0.5, 4, 0.25, (radius) => onChange({ ...params, radius }))}
      {sliderRow("Força", params.strength, 0.1, 1, 0.05, (strength) => onChange({ ...params, strength }))}
      {sliderRow("Seed", params.seed, 1, 999, 1, (seed) => onChange({ ...params, seed }))}
    </div>
  );
}

function WallBrushFields(props: {
  readonly params: WallBrushParams;
  readonly onChange: (next: WallBrushParams) => void;
}) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid">
        <SelectableChip
          label="Bloco Branco"
          swatchColor="#e2e8f0"
          selected={params.wallType === "wall-white"}
          onSelect={() => onChange({ ...params, wallType: "wall-white" })}
        />
        <SelectableChip
          label="Bloco Cinza"
          swatchColor="#64748b"
          selected={params.wallType === "wall-gray"}
          onSelect={() => onChange({ ...params, wallType: "wall-gray" })}
        />
      </div>
      {sliderRow("Seed", params.seed, 1, 999, 1, (seed) => onChange({ ...params, seed }))}
    </div>
  );
}

function IrregularTerrainFields(props: {
  readonly params: IrregularTerrainParams;
  readonly onChange: (next: IrregularTerrainParams) => void;
}) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid">
        <SelectableChip
          label="Terreno"
          swatchColor="#334155"
          selected={params.targetSurface === "terrain"}
          onSelect={() => onChange({ ...params, targetSurface: "terrain" })}
        />
        <SelectableChip
          label="Grama"
          swatchColor="#4a7a4a"
          selected={params.targetSurface === "terrain-grass"}
          onSelect={() => onChange({ ...params, targetSurface: "terrain-grass" })}
        />
      </div>
      {sliderRow("Alcance da pincelada", params.trianglesPerSide, 4, 25, 1, (trianglesPerSide) =>
        onChange({ ...params, trianglesPerSide }),
      )}
      {sliderRow("Irregularidade", params.irregularity, 0, 1, 0.05, (irregularity) =>
        onChange({ ...params, irregularity }),
      )}
      {sliderRow("Altura", params.heightScale, 0, 5, 0.25, (heightScale) => onChange({ ...params, heightScale }))}
      {sliderRow("Suavidade do relevo", params.noiseScale, 0.02, 0.4, 0.01, (noiseScale) =>
        onChange({ ...params, noiseScale }),
      )}
      {sliderRow("Seed", params.seed, 1, 999, 1, (seed) => onChange({ ...params, seed }))}
    </div>
  );
}

const TOOL_LABELS: Partial<Record<ConstructionToolId, string>> = {
  "terrain-brush": "Parâmetros: Terreno",
  "wall-brush": "Parâmetros: Parede (Pincel Livre)",
  "wall-line": "Parâmetros: Parede (Linha Reta)",
  "irregular-terrain-stamp": "Parâmetros: Terreno Irregular",
};

/**
 * The right-panel half of the hotbar/panel sync: which fields show is driven
 * entirely by `activeTool` (set by `ConstructionHotbar`/`ToolRail`), and
 * editing a field here only ever updates `params[activeTool]` -- it never
 * knows how a tool turns its own parameters into geometry, that lives in
 * `composition/tabletop/tools/*.ts`.
 */
export function ConstructionToolParamsPanel(props: ConstructionToolParamsPanelProps) {
  const { activeTool, params, onParamsChange } = props;
  const label = TOOL_LABELS[activeTool];

  if (label === undefined) {
    return (
      <Card className="gm-panel-card" backgroundColor="#182234" accentColor="#1e293b">
        <span className="gm-panel-card-title">Parâmetros</span>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b" }}>
          Selecione uma ferramenta de construção (Terreno, Parede, Apagar Cômodo ou Terreno Irregular) no hotbar
          para ajustar seus parâmetros.
        </p>
      </Card>
    );
  }

  const panel: CollapsePanel = {
    key: activeTool,
    header: label,
    content:
      activeTool === "terrain-brush" ? (
        <TerrainBrushFields
          params={params["terrain-brush"]}
          onChange={(next) => onParamsChange("terrain-brush", next)}
        />
      ) : activeTool === "wall-brush" ? (
        <WallBrushFields params={params["wall-brush"]} onChange={(next) => onParamsChange("wall-brush", next)} />
      ) : activeTool === "wall-line" ? (
        <WallBrushFields params={params["wall-line"]} onChange={(next) => onParamsChange("wall-line", next)} />
      ) : (
        <IrregularTerrainFields
          params={params["irregular-terrain-stamp"]}
          onChange={(next) => onParamsChange("irregular-terrain-stamp", next)}
        />
      ),
  };

  return <Collapse panels={[panel]} bordered={false} />;
}
