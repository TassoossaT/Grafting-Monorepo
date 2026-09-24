"use client";

import { Card, Collapse, SelectableChip, type CollapsePanel } from "@/ui";
import type {
  BrushShapeParams,
  ConstructionToolId,
  OpeningParams,
  PathBrushParams,
  TerrainSculptMode,
  TerrainSculptParams,
  ToolParamsByTool,
  TowerStampParams,
  WallBrushParams,
  WallParams,
} from "@/features/edit-construction";
import { TOWER_RADIUS_PRESETS, deriveFaceSize } from "@/features/edit-construction";

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

/**
 * Every path a player draws is a `street` -- `PathKind` still carries
 * `"trail" | "street" | "road" | "bridge"` for the engine and for corridors
 * committed before this panel stopped exposing the other three, but the
 * brush itself only ever writes `"street"` now. `pathFormationFor` only
 * adds a shoulder to a road's width for the other three kinds and never
 * reads `shoulderHeight` at all (no raised rim exists yet), so this only
 * shows the one slider `street`'s own profile actually answers to: bed
 * width.
 */
function PathBrushFields(props: { readonly params: PathBrushParams; readonly onChange: (next: PathBrushParams) => void }) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <label>Construção <select value={params.creationMode === "pen" ? "points" : params.creationMode ?? "brush"} onChange={(event) => onChange({ ...params, creationMode: event.currentTarget.value as "brush" | "points" })}>
        <option value="brush">Desenho livre</option>
        <option value="points">Por pontos</option>
      </select></label>
      {(!params.creationMode || params.creationMode === "brush")
        ? <p>Arraste pelo terreno e solte para construir o caminho.</p>
        : <p>Clique por onde o caminho deve passar. Enter constrói; Backspace retira o último ponto.</p>}
      <p>Arraste os pontos da espinha para editar; use o eixo Y para altura. Clique em um trecho para inserir um ponto, ou arraste o trecho para curvar. Segure Shift ao iniciar num ponto ou trecho para criar uma ramificacao (por desenho ou por pontos). Delete remove o ponto selecionado; Esc cancela.</p>
      {sliderRow("Largura do leito", params.bedWidth, 0.5, 12, 0.25, (bedWidth) => onChange({ ...params, bedWidth }))}
    </div>
  );
}

/** Type and height -- everything every wall tool shares, and all a wall carries. Height is the length of a panel's own vertical edge. */
function WallFields<Params extends WallParams>(props: {
  readonly params: Params;
  readonly onChange: (next: Params) => void;
}) {
  const { params, onChange } = props;
  return (
    <>
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
      {sliderRow("Altura", params.height, 0.5, 10, 0.5, (height) => onChange({ ...params, height }))}
    </>
  );
}

function WallLineFields(props: { readonly params: WallParams; readonly onChange: (next: WallParams) => void }) {
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <WallFields params={props.params} onChange={props.onChange} />
    </div>
  );
}

/** The brush radius here is the fitting tolerance, not a footprint -- 0 commits the drawn contour literally, wider corrects a shakier stroke into straight runs and true arcs. Hence a floor of 0, unlike the path brush. */
function WallBrushFields(props: {
  readonly params: WallBrushParams;
  readonly onChange: (next: WallBrushParams) => void;
}) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <WallFields params={params} onChange={onChange} />
      <BrushShapeFields params={params} radiusMin={0} radiusMax={2} onChange={onChange} />
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
      {sliderRow("Altura", params.height, 0.5, 10, 0.5, (height) => onChange({ ...params, height }))}
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

function TerrainSculptFields(props: {
  readonly params: TerrainSculptParams;
  readonly onChange: (next: TerrainSculptParams) => void;
}) {
  const { params, onChange } = props;
  const currentMode = params.mode ?? "add";
  const isDig = currentMode === "dig" || currentMode === "lower";
  const isAdd = currentMode === "add" || currentMode === "elevate";
  const elevationStep = params.elevationStep ?? 2.0;

  const elevationLabel = isAdd
    ? "Incremento de altura (+m)"
    : isDig
      ? "Profundidade do corte (-m)"
      : "Intensidade do nivelamento";

  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <SelectableChip
          label="Adicionar (+)"
          swatchColor="#22c55e"
          selected={isAdd}
          onSelect={() => onChange({ ...params, mode: "add" })}
        />
        <SelectableChip
          label="Cavar (-)"
          swatchColor="#ef4444"
          selected={isDig}
          onSelect={() => onChange({ ...params, mode: "dig" })}
        />
        <SelectableChip
          label="Nivelar (=)"
          swatchColor="#3b82f6"
          selected={currentMode === "flatten"}
          onSelect={() => onChange({ ...params, mode: "flatten" })}
        />
      </div>
      {sliderRow("Alcance da pincelada", params.brushRadius, 1.5, 20, 0.5, (brushRadius) =>
        onChange({ ...params, brushRadius, faceSize: deriveFaceSize(brushRadius) }),
      )}
      {sliderRow(elevationLabel, elevationStep, 0.2, 20.0, 0.2, (step) =>
        onChange({ ...params, elevationStep: step }),
      )}
      {sliderRow("Rugosidade do chão novo (ruído)", params.heightScale, 0, 5, 0.25, (heightScale) =>
        onChange({ ...params, heightScale }),
      )}
      {sliderRow("Suavidade do relevo", params.noiseScale, 0.02, 0.4, 0.01, (noiseScale) =>
        onChange({ ...params, noiseScale }),
      )}
    </div>
  );
}

/** A door is the same opening with its sill on the floor, so the type sets the sill and the sliders take it from there. */
function OpeningFields(props: { readonly params: OpeningParams; readonly onChange: (next: OpeningParams) => void }) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid">
        <SelectableChip
          label="Janela"
          swatchColor="#7dd3fc"
          selected={params.openingKind === "window"}
          onSelect={() => onChange({ ...params, openingKind: "window", sill: params.sill > 0 ? params.sill : 1 })}
        />
        <SelectableChip
          label="Porta"
          swatchColor="#d97706"
          selected={params.openingKind === "door"}
          onSelect={() => onChange({ ...params, openingKind: "door", sill: 0, height: Math.max(params.height, 2) })}
        />
      </div>
      {sliderRow("Largura", params.width, 0.4, 4, 0.1, (width) => onChange({ ...params, width }))}
      {sliderRow("Altura", params.height, 0.4, 4, 0.1, (height) => onChange({ ...params, height }))}
      {params.openingKind === "door"
        ? null
        : sliderRow("Peitoril", params.sill, 0, 3, 0.1, (sill) => onChange({ ...params, sill }))}
    </div>
  );
}

const TOOL_LABELS: Partial<Record<ConstructionToolId, string>> = {
  roof: "Telhado",
  "platform-contour": "Plataforma",
  "slope-ramp": "Rampa",
  "slope-spiral": "Espiral",
  "edit-region": "Editar estrutura",
  "path-brush": "Parâmetros: Caminho",
  "wall-brush": "Parâmetros: Parede (Pincel Livre)",
  "wall-line": "Parâmetros: Parede (Linha Reta)",
  "tower-stamp": "Parâmetros: Torre",
  opening: "Parâmetros: Abertura",
  "terrain-sculpt": "Parâmetros: Escultura de Terreno",
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
          Selecione uma ferramenta de construção (Caminho, Parede ou Escultura de Terreno) no hotbar
          para ajustar seus parâmetros.
        </p>
      </Card>
    );
  }

  const panel: CollapsePanel = {
    key: activeTool,
    header: label,
    content:
      activeTool === "roof" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <div className="gm-material-grid">
            {(["rectangle", "circle", "platform"] as const).map((shape, index) => <SelectableChip key={shape} label={["Retangular", "Circular", "Sobre plataforma"][index]!} swatchColor="#b96e48" selected={params.roof.shape === shape} onSelect={() => onParamsChange("roof", { ...params.roof, shape })} />)}
          </div>
          {params.roof.shape !== "platform" && <label>Elevação da base <input type="number" step="0.1" value={params.roof.elevation} onChange={(event) => onParamsChange("roof", { ...params.roof, elevation: Number(event.currentTarget.value) })} /></label>}
          <label>Altura máxima <input type="number" min="0.1" step="0.1" value={params.roof.height} onChange={(event) => onParamsChange("roof", { ...params.roof, height: Number(event.currentTarget.value) })} /></label>
          {params.roof.shape === "circle" && <label>Raio <input type="number" min="0.1" step="0.1" value={params.roof.radius} onChange={(event) => onParamsChange("roof", { ...params.roof, radius: Number(event.currentTarget.value) })} /></label>}
          {params.roof.curvatures.map((curvature, index) => <label key={index}>Curvatura da folha {index + 1} <input type="number" min="-1" max="1" step="0.1" value={curvature} onChange={(event) => {
            const curvatures: [number, number, number, number] = [...params.roof.curvatures];
            curvatures[index] = Number(event.currentTarget.value);
            onParamsChange("roof", { ...params.roof, curvatures });
          }} /></label>)}
          <p>Retangular: arraste entre dois cantos. Circular: clique no centro. Sobre plataforma: clique na plataforma que deseja cobrir.</p>
        </div>
      ) : activeTool === "platform-contour" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label>Elevacao <input type="number" step="0.1" value={params["platform-contour"].elevation} onChange={(event) => onParamsChange("platform-contour", { ...params["platform-contour"], elevation: Number(event.currentTarget.value) })} /></label>
          <div className="gm-material-grid">
            {(["create", "extend", "cut"] as const).map((mode, i) => <SelectableChip key={mode} label={["Criar", "Ampliar / juntar", "Recortar / separar"][i]!} swatchColor="#79b8e8" selected={params["platform-contour"].mode === mode} onSelect={() => onParamsChange("platform-contour", { ...params["platform-contour"], mode })} />)}
          </div>
          <div className="gm-material-grid">
            {(["rectangle", "circle", "polygon", "freehand"] as const).map((shape,i) => <SelectableChip key={shape} label={["Retângulo", "Círculo", "Polígono", "Livre / curvas"][i]!} swatchColor="#79b8e8" selected={(params["platform-contour"].shape ?? "rectangle") === shape} onSelect={() => onParamsChange("platform-contour",{ ...params["platform-contour"],shape })} />)}
          </div>
          {params["platform-contour"].shape === "circle" &&<div className="gm-material-grid">{TOWER_RADIUS_PRESETS.map((radius) => <SelectableChip key={radius} label={`Raio ${radius}`} swatchColor="#79b8e8" selected={(params["platform-contour"].radius ?? 2.5) === radius} onSelect={() => onParamsChange("platform-contour",{ ...params["platform-contour"],radius })} />)}</div>}
          {params["platform-contour"].shape === "freehand" && <label>Correção <input type="number" min="0" max="1" step="0.05" value={params["platform-contour"].tolerance ?? 0.15} onChange={(event) => onParamsChange("platform-contour",{ ...params["platform-contour"],tolerance:Number(event.currentTarget.value) })} /></label>}
          <p>Retângulo: arraste na diagonal. Círculo: clique no centro. Polígono: clique nos cantos e no primeiro para fechar. Livre: arraste o contorno. Esc cancela.</p>
          <p>Para ampliar, desenhe sobre a borda e a área nova. Começar sobre uma plataforma usa a elevação dela; fora dela, vale a elevação escolhida. Vértices de outro andar não são conectados.</p>
        </div>
      ) : activeTool === "slope-ramp" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label>Largura <input type="number" min="0.1" step="0.1" value={params["slope-ramp"].width} onChange={(event) => onParamsChange("slope-ramp", { ...params["slope-ramp"], width: Number(event.currentTarget.value) })} /></label>
          <label>Subida <input type="number" step="0.1" value={params["slope-ramp"].rise} onChange={(event) => onParamsChange("slope-ramp", { ...params["slope-ramp"], rise: Number(event.currentTarget.value) })} /></label>
          <p>Arraste do início ao fim. A rampa começa na altura de onde você clicou e sobe o valor de Subida. Uma ponta que cai na borda de uma plataforma na mesma altura é soldada a ela.</p>
        </div>
      ) : activeTool === "slope-spiral" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label>Largura <input type="number" min="0.1" step="0.1" value={params["slope-spiral"].width} onChange={(event) => onParamsChange("slope-spiral", { ...params["slope-spiral"], width: Number(event.currentTarget.value) })} /></label>
          <label>Raio <input type="number" min="0.5" step="0.1" value={params["slope-spiral"].radius} onChange={(event) => onParamsChange("slope-spiral", { ...params["slope-spiral"], radius: Number(event.currentTarget.value) })} /></label>
          <label>Voltas <input type="number" min="0.25" step="0.25" value={params["slope-spiral"].turns} onChange={(event) => onParamsChange("slope-spiral", { ...params["slope-spiral"], turns: Number(event.currentTarget.value) })} /></label>
          <label>Subida <input type="number" step="0.1" value={params["slope-spiral"].rise} onChange={(event) => onParamsChange("slope-spiral", { ...params["slope-spiral"], rise: Number(event.currentTarget.value) })} /></label>
          <p>Clique no centro. A espiral começa na altura de onde você clicou e sobe o valor de Subida ao longo das voltas.</p>
        </div>
      ) : activeTool === "edit-region" ? (
        <div>
          <label>Ação na rua <select value={params["edit-region"].curveAction ?? "edit"} onChange={(event) => onParamsChange("edit-region", { ...params["edit-region"], curveAction: event.currentTarget.value as "edit" | "remove-anchor" | "disconnect" | "delete-segment" | "close" | "width" })}>
            <option value="edit">Editar curva</option><option value="remove-anchor">Remover âncora</option><option value="disconnect">Desconectar junção</option><option value="delete-segment">Excluir trecho</option><option value="close">Fechar caminho</option><option value="width">Alterar largura</option>
          </select></label>
          {params["edit-region"].curveAction === "width" && <label>Largura <input type="number" min="0.1" step="0.1" value={params["edit-region"].curveWidth ?? 4} onChange={(event) => onParamsChange("edit-region", {...params["edit-region"],curveWidth:Number(event.currentTarget.value)})}/></label>}
          {params["edit-region"].curveAction === "width" && <label>Largura no fim <input type="number" min="0.1" step="0.1" value={params["edit-region"].curveEndWidth ?? params["edit-region"].curveWidth ?? 4} onChange={(event) => onParamsChange("edit-region", {...params["edit-region"],curveEndWidth:Number(event.currentTarget.value)})}/></label>}
          <p>Para remover, desconectar ou fechar, clique na âncora. Para excluir um trecho ou mudar sua largura, clique no ponto central.</p>
          <label>Alças Bézier <select value={params["edit-region"].curveMode ?? "free"} onChange={(event) => onParamsChange("edit-region", { ...params["edit-region"], curveMode: event.currentTarget.value as "automatic" | "aligned" | "mirrored" | "free" })}>
            <option value="free">Livres</option><option value="aligned">Alinhadas</option><option value="mirrored">Espelhadas</option><option value="automatic">Automáticas</option>
          </select></label>
          <p>Arraste uma alça para ajustar a curva. Arraste o ponto central para puxar o trecho; clique nele para inserir uma âncora.</p>
          <SelectableChip label="Formato / posicao" swatchColor="#79b8e8" selected={params["edit-region"].mode === "shape"} onSelect={() => onParamsChange("edit-region", { ...params["edit-region"], mode: "shape" })} />
          <SelectableChip label="Elevar / baixar" swatchColor="#79b8e8" selected={params["edit-region"].mode === "elevation"} onSelect={() => onParamsChange("edit-region", { ...params["edit-region"], mode: "elevation" })} />
          <p>No modo de elevacao, arraste para cima ou para baixo. A plataforma leva a estrutura conectada acima.</p>
        </div>
      ) : activeTool === "path-brush" ? (<PathBrushFields params={params["path-brush"]} onChange={(next) => onParamsChange("path-brush", next)} />) : activeTool === "wall-brush" ? (
        <WallBrushFields params={params["wall-brush"]} onChange={(next) => onParamsChange("wall-brush", next)} />
      ) : activeTool === "wall-line" ? (
        <WallLineFields params={params["wall-line"]} onChange={(next) => onParamsChange("wall-line", next)} />
      ) : activeTool === "opening" ? (
        <OpeningFields params={params.opening} onChange={(next) => onParamsChange("opening", next)} />
      ) : activeTool === "tower-stamp" ? (
        <TowerStampFields params={params["tower-stamp"]} onChange={(next) => onParamsChange("tower-stamp", next)} />
      ) : (
        <TerrainSculptFields
          params={params["terrain-sculpt"]}
          onChange={(next) => onParamsChange("terrain-sculpt", next)}
        />
      ),
  };

  // `Collapse` owns its expanded keys internally. Remount it when the tool
  // changes so its new single panel starts expanded rather than inheriting
  // the previous tool's key and appearing empty.
  return <Collapse key={activeTool} panels={[panel]} bordered={false} />;
}
