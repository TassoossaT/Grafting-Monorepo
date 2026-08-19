"use client";

import { Card, Collapse, SelectableChip, type CollapsePanel } from "@/ui";
import type {
  BrushShapeParams,
  ConstructionToolId,
  InteriorGenerateParams,
  IrregularTerrainParams,
  PathBrushParams,
  ToolParamsByTool,
  TowerStampParams,
  WallBrushParams,
} from "@/features/edit-construction";
import { TOWER_RADIUS_PRESETS } from "@/features/edit-construction";

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

function BrushShapeFields<Params extends BrushShapeParams>(props: {
  readonly params: Params;
  readonly radiusMin: number;
  readonly radiusMax: number;
  readonly onChange: (next: Params) => void;
}) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid">
        <SelectableChip label="Círculo" swatchColor="#c084fc" selected={params.shape === "circle"} onSelect={() => onChange({ ...params, shape: "circle" })} />
        <SelectableChip label="Quadrado" swatchColor="#a78bfa" selected={params.shape === "square"} onSelect={() => onChange({ ...params, shape: "square" })} />
        <SelectableChip label="Hexágono" swatchColor="#8b5cf6" selected={params.shape === "hexagon"} onSelect={() => onChange({ ...params, shape: "hexagon" })} />
      </div>
      {sliderRow(params.shape === "square" ? "Meio tamanho" : "Raio", params.radius, props.radiusMin, props.radiusMax, 0.05, (radius) => onChange({ ...params, radius }))}
      {params.shape === "circle" ? null : sliderRow("Rotação", params.rotationDegrees, 0, 180, 5, (rotationDegrees) => onChange({ ...params, rotationDegrees }))}
    </div>
  );
}

function PathBrushFields(props: { readonly params: PathBrushParams; readonly onChange: (next: PathBrushParams) => void }) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <BrushShapeFields params={params} radiusMin={0.15} radiusMax={3} onChange={onChange} />
      {sliderRow("Profundidade", params.depth, 0.05, 1.5, 0.05, (depth) => onChange({ ...params, depth }))}
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
    </div>
  );
}

function InteriorGenerateFields(props: {
  readonly params: InteriorGenerateParams;
  readonly onChange: (next: InteriorGenerateParams) => void;
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
      {sliderRow("Tamanho da célula", params.cellSize, 1.5, 4, 0.5, (cellSize) => onChange({ ...params, cellSize }))}
      {sliderRow("Máx. células por cômodo", params.maxRegionCells, 2, 16, 1, (maxRegionCells) => onChange({ ...params, maxRegionCells }))}
      {sliderRow("Seed", params.seed, 1, 999, 1, (seed) => onChange({ ...params, seed }))}
    </div>
  );
}

const TOWER_RADIUS_LABELS: Readonly<Record<(typeof TOWER_RADIUS_PRESETS)[number], string>> = {
  [TOWER_RADIUS_PRESETS[0]]: "Pequena",
  [TOWER_RADIUS_PRESETS[1]]: "Média",
  [TOWER_RADIUS_PRESETS[2]]: "Grande",
};

/** Radius is a closed preset catalog, not a slider -- see `TowerStampParams`'s own doc on why a tower's geometry must stay one of a few known sizes. */
function TowerStampFields(props: {
  readonly params: TowerStampParams;
  readonly onChange: (next: TowerStampParams) => void;
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
      <div className="gm-material-grid">
        {TOWER_RADIUS_PRESETS.map((radius) => (
          <SelectableChip
            key={radius}
            label={TOWER_RADIUS_LABELS[radius]}
            swatchColor="#94a3b8"
            selected={params.radius === radius}
            onSelect={() => onChange({ ...params, radius })}
          />
        ))}
      </div>
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
  "path-brush": "Parâmetros: Caminho",
  "wall-brush": "Parâmetros: Parede (Pincel Livre)",
  "wall-line": "Parâmetros: Parede (Linha Reta)",
  "interior-wall": "Parâmetros: Parede (Gerar Interiores)",
  "tower-stamp": "Parâmetros: Torre",
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
          Selecione uma ferramenta de construção (Caminho, Parede, Apagar Cômodo ou Terreno Irregular) no hotbar
          para ajustar seus parâmetros.
        </p>
      </Card>
    );
  }

  const panel: CollapsePanel = {
    key: activeTool,
    header: label,
    content:
      activeTool === "path-brush" ? (<PathBrushFields params={params["path-brush"]} onChange={(next) => onParamsChange("path-brush", next)} />) : activeTool === "wall-brush" ? (
        <WallBrushFields params={params["wall-brush"]} onChange={(next) => onParamsChange("wall-brush", next)} />
      ) : activeTool === "wall-line" ? (
        <WallBrushFields params={params["wall-line"]} onChange={(next) => onParamsChange("wall-line", next)} />
      ) : activeTool === "interior-wall" ? (
        <InteriorGenerateFields params={params["interior-wall"]} onChange={(next) => onParamsChange("interior-wall", next)} />
      ) : activeTool === "tower-stamp" ? (
        <TowerStampFields params={params["tower-stamp"]} onChange={(next) => onParamsChange("tower-stamp", next)} />
      ) : (
        <IrregularTerrainFields
          params={params["irregular-terrain-stamp"]}
          onChange={(next) => onParamsChange("irregular-terrain-stamp", next)}
        />
      ),
  };

  return <Collapse panels={[panel]} bordered={false} />;
}
