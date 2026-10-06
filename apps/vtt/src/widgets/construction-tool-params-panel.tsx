"use client";

import { useState } from "react";

import { Card, Collapse, SelectableChip, type CollapsePanel } from "@/ui";
import type {
  BrushShapeParams,
  ConstructionToolId,
  OpeningParams,
  OpeningShape,
  OpeningSide,
  PathBrushParams,
  StructureEditParams,
  TerrainSculptMode,
  TerrainSculptParams,
  ToolParamsByTool,
  TowerStampParams,
  WallBrushParams,
  WallParams,
  WallLineParams,
} from "@/features/edit-construction";
import { OPENING_KIND_COLOR, RECTANGLE_OPENING_SHAPE, TOWER_RADIUS_PRESETS, deriveFaceSize, isRectangleShape, openingPath, withOpeningKind } from "@/features/edit-construction";

export interface ConstructionToolParamsPanelProps {
  readonly activeTool: ConstructionToolId;
  readonly params: ToolParamsByTool;
  readonly onParamsChange: <Id extends ConstructionToolId>(toolId: Id, next: ToolParamsByTool[Id]) => void;
  /** How a grab on an existing structure behaves -- ambient, not tied to `activeTool`, since every construction tool can now grab and edit whatever it owns. */
}

/** The curve-handle/mode controls every construction tool's own grab-and-edit now shares -- `edit-region`'s old params, no longer tied to one retired tool. */
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
 * Every road a player draws is a `street`, and its only structural profile
 * is its width -- a raised rim is an asset's detail, not the structure's --
 * so this sets up the width of the next road and nothing else. A standing
 * road is widened by its own width handles.
 */
function PathBrushFields(props: { readonly params: PathBrushParams; readonly onChange: (next: PathBrushParams) => void }) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <strong>Rua</strong>
      {sliderRow("Largura da próxima rua", params.bedWidth, 0.5, 12, 0.25, (bedWidth) => onChange({ ...params, bedWidth }))}
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

function WallLineFields(props: { readonly params: WallLineParams; readonly onChange: (next: WallLineParams) => void }) {
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <WallFields params={props.params} onChange={props.onChange} />
      <div className="gm-material-grid">
        <SelectableChip label="Reta" swatchColor="#94a3b8" selected={props.params.mode !== "curve"} onSelect={() => props.onChange({ ...props.params, mode: "straight" })} />
        <SelectableChip label="Curva" swatchColor="#94a3b8" selected={props.params.mode === "curve"} onSelect={() => props.onChange({ ...props.params, mode: "curve" })} />
      </div>
      <p>Arraste para desenhar; use as alças para editar depois.</p>
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

  // Which stroke -- add, remove, flatten -- is picked in the dock below the map; here only how it acts.
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
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

const SIDE_LABELS: Readonly<Record<OpeningSide, string>> = { top: "Topo", right: "Direita", bottom: "Base", left: "Esquerda" };
const SHAPE_BOX = 72;
const SHAPE_PAD = 10;
const SHAPE_MAX_RADIUS = 3;

/**
 * The opening's four sides as a small clickable square: pick a side, then
 * its rounding radius (0 = straight; a radius under half the side reads as
 * half, a semicircle). The slider only applies on release, so dragging it
 * is one edit, not one per tick.
 */
function OpeningShapeFields(props: { readonly params: OpeningParams; readonly onChange: (next: OpeningParams) => void }) {
  const { params, onChange } = props;
  const shape: OpeningShape = params.shape ?? RECTANGLE_OPENING_SHAPE;
  const [side, setSide] = useState<OpeningSide>("top");
  const [draft, setDraft] = useState<number | undefined>(undefined);
  const radius = draft ?? shape.radii[side];
  const setShape = (next: OpeningShape) => onChange({ ...params, shape: next });
  const commitDraft = () => {
    if (draft === undefined) return;
    setDraft(undefined);
    setShape({ ellipse: false, radii: { ...shape.radii, [side]: draft } });
  };

  const scale = SHAPE_BOX / Math.max(params.width, params.height, 1e-6);
  const w = params.width * scale;
  const h = params.height * scale;
  const x0 = SHAPE_PAD + (SHAPE_BOX - w) / 2;
  const y0 = SHAPE_PAD + (SHAPE_BOX - h) / 2;
  const shown: OpeningShape = draft === undefined ? shape : { ellipse: false, radii: { ...shape.radii, [side]: draft } };
  const at = ([x, y]: readonly [number, number]) => `${(x0 + x * scale).toFixed(1)},${(y0 + h - y * scale).toFixed(1)}`;
  const segments = openingPath(shown, params.width, params.height);
  const outline = segments.length === 0
    ? ""
    : `M${at(segments[0]!.from)} ${segments.map((segment) => (segment.controls === undefined ? `L${at(segment.to)}` : `C${at(segment.controls[0])} ${at(segment.controls[1])} ${at(segment.to)}`)).join(" ")} Z`;
  const color = kindHex(params.openingKind);
  const edges: Readonly<Record<OpeningSide, readonly [number, number, number, number]>> = {
    top: [x0, y0, x0 + w, y0],
    right: [x0 + w, y0, x0 + w, y0 + h],
    bottom: [x0, y0 + h, x0 + w, y0 + h],
    left: [x0, y0, x0, y0 + h],
  };
  const size = SHAPE_BOX + 2 * SHAPE_PAD;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <span style={{ fontSize: "0.78rem" }}>Formato</span>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label="Lados da abertura">
          <rect x={x0} y={y0} width={w} height={h} fill="none" stroke="#475569" strokeDasharray="3 3" />
          <path d={outline} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1.5} />
          {(Object.keys(edges) as OpeningSide[]).map((key) => {
            const [ax, ay, bx, by] = edges[key];
            return (
              <g key={key} style={{ cursor: "pointer" }} onClick={() => { commitDraft(); setSide(key); }}>
                <title>{SIDE_LABELS[key]}</title>
                {side === key && !shape.ellipse ? <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#f8fafc" strokeWidth={3} /> : null}
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={12} />
              </g>
            );
          })}
        </svg>
        <div style={{ display: "grid", gap: "0.4rem", flex: 1 }}>
          <SelectableChip label="Retângulo" swatchColor="#94a3b8" selected={isRectangleShape(shape)} onSelect={() => { setDraft(undefined); setShape(RECTANGLE_OPENING_SHAPE); }} />
          <SelectableChip label="Círculo" swatchColor="#c084fc" selected={shape.ellipse} onSelect={() => { setDraft(undefined); setShape({ ...shape, ellipse: true }); }} />
        </div>
      </div>
      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.78rem" }}>
        <span className="gm-stat-row">
          <span>Raio: {SIDE_LABELS[side].toLowerCase()}</span>
          <span className="gm-stat-value">{shape.ellipse && draft === undefined ? "--" : radius > 0 ? radius.toFixed(2) : "reto"}</span>
        </span>
        <input
          type="range"
          min={0}
          max={SHAPE_MAX_RADIUS}
          step={0.05}
          value={shape.ellipse && draft === undefined ? 0 : radius}
          onChange={(event) => setDraft(Number(event.currentTarget.value))}
          onPointerUp={commitDraft}
          onKeyUp={commitDraft}
          onBlur={commitDraft}
        />
      </label>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "#ffffff" }}>Clique num lado do quadrado e ajuste o raio (0 = reto). Com uma abertura selecionada, o formato muda nela; sem seleção, vale para a próxima.</p>
    </div>
  );
}

function kindHex(kind: OpeningParams["openingKind"]): string {
  return `#${OPENING_KIND_COLOR[kind].toString(16).padStart(6, "0")}`;
}

/** A door is the same opening standing on the floor; a window stands wherever it is placed on the wall. */
function OpeningFields(props: { readonly params: OpeningParams; readonly onChange: (next: OpeningParams) => void }) {
  const { params, onChange } = props;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="gm-material-grid">
        <SelectableChip
          label="Janela"
          swatchColor={kindHex("window")}
          selected={params.openingKind === "window"}
          onSelect={() => onChange(withOpeningKind(params, "window"))}
        />
        <SelectableChip
          label="Porta"
          swatchColor={kindHex("door")}
          selected={params.openingKind === "door"}
          onSelect={() => onChange(withOpeningKind(params, "door"))}
        />
      </div>
      {sliderRow("Largura", params.width, 0.4, 4, 0.1, (width) => onChange({ ...params, width }))}
      {sliderRow("Altura", params.height, 0.4, 4, 0.1, (height) => onChange({ ...params, height }))}
      <OpeningShapeFields params={params} onChange={onChange} />
    </div>
  );
}

const TOOL_LABELS: Partial<Record<ConstructionToolId, string>> = {
  roof: "Telhado",
  "platform-contour": "Plataforma",
  "slope-ramp": "Rampa",
  "slope-spiral": "Espiral",
  "slope-curve": "Rampa curva",
  "path-brush": "Parâmetros: Caminho",
  "wall-brush": "Parâmetros: Muros",
  "wall-line": "Parâmetros: Parede",
  "tower-stamp": "Parâmetros: Torre",
  opening: "Parâmetros: Abertura",
  "terrain-sculpt": "Parâmetros: Escultura de Terreno",
  demolish: "Parâmetros: Demolir",
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
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#ffffff" }}>
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
            {(["draw", "cut", "hole", "base", "dormer"] as const).map((action, i) => <SelectableChip key={action} label={["Desenhar / fundir", "Recortar contorno", "Abrir buraco", "Sobre base", "Lucarna"][i]!} swatchColor="#b96e48" selected={params.roof.action === action} onSelect={() => onParamsChange("roof", { ...params.roof, action })} />)}
          </div>
          {(params.roof.action === "draw" || params.roof.action === "cut" || params.roof.action === "hole") && (
            <div className="gm-material-grid">
              {(["rectangle", "circle", "polygon", "freehand"] as const).map((shape, i) => <SelectableChip key={shape} label={["Retângulo", "Círculo", "Polígono", "Livre / curvas"][i]!} swatchColor="#b96e48" selected={params.roof.shape === shape} onSelect={() => onParamsChange("roof", { ...params.roof, shape })} />)}
            </div>
          )}
          {(params.roof.action === "draw" || params.roof.action === "cut" || params.roof.action === "hole") && params.roof.shape === "circle" && <div className="gm-material-grid">{TOWER_RADIUS_PRESETS.map((radius) => <SelectableChip key={radius} label={`Raio ${radius}`} swatchColor="#b96e48" selected={params.roof.radius === radius} onSelect={() => onParamsChange("roof", { ...params.roof, radius })} />)}</div>}
          {(params.roof.action === "draw" || params.roof.action === "cut" || params.roof.action === "hole") && params.roof.shape === "freehand" && <label>Correção <input type="number" min="0" max="1" step="0.05" value={params.roof.tolerance} onChange={(event) => onParamsChange("roof", { ...params.roof, tolerance: Number(event.currentTarget.value) })} /></label>}
          {(params.roof.action === "draw" || params.roof.action === "base") && <label>Altura máxima <input type="number" min="0.1" step="0.1" value={params.roof.height} onChange={(event) => onParamsChange("roof", { ...params.roof, height: Number(event.currentTarget.value) })} /></label>}
          {params.roof.action === "dormer" && <label>Largura da lucarna <input type="number" min="0.3" step="0.1" value={params.roof.dormerWidth} onChange={(event) => onParamsChange("roof", { ...params.roof, dormerWidth: Number(event.currentTarget.value) })} /></label>}
          {params.roof.action === "dormer" && <label>Altura da frente <input type="number" min="0" step="0.1" value={params.roof.dormerFront} onChange={(event) => onParamsChange("roof", { ...params.roof, dormerFront: Number(event.currentTarget.value) })} /></label>}
          {params.roof.action !== "cut" && params.roof.action !== "hole" && (
            <div className="gm-material-grid">
              {([4, 2, 1] as const).map((waters) => <SelectableChip key={waters} label={params.roof.action === "dormer" ? ["Quatro águas", "Duas águas", "Uma água"][[4, 2, 1].indexOf(waters)]! : `${waters} ${waters === 1 ? "água" : "águas"}`} swatchColor="#b96e48" selected={params.roof.waters === waters} onSelect={() => onParamsChange("roof", { ...params.roof, waters })} />)}
            </div>
          )}
          <p>Desenhar: retângulo na diagonal, círculo no centro, polígono pelos cantos, livre pelo contorno; encostando num telhado, os dois viram um só. Recortar contorno muda a planta e as águas. Abrir buraco remove apenas a superfície desenhada. Sobre base: clique na plataforma ou numa parede do cômodo. Lucarna: clique na água do telhado onde fica a frente dela.</p>
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
          <p>O terreno só é cortado onde o piso encosta nele: no chão ele ocupa o terreno embaixo; no alto, o terreno embaixo fica intacto.</p>
          <p>Para ampliar, desenhe sobre a borda e a área nova. Começar sobre uma plataforma usa a elevação dela; fora dela, vale a elevação escolhida. Vértices de outro andar não são conectados.</p>
        </div>
      ) : activeTool === "slope-ramp" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label>Largura embaixo <input type="number" min="0.1" step="0.1" value={params["slope-ramp"].bottomWidth ?? 1.5} onChange={(event) => onParamsChange("slope-ramp", { ...params["slope-ramp"], bottomWidth: Number(event.currentTarget.value) })} /></label>
          <label>Largura em cima <input type="number" min="0.1" step="0.1" value={params["slope-ramp"].topWidth ?? 1.5} onChange={(event) => onParamsChange("slope-ramp", { ...params["slope-ramp"], topWidth: Number(event.currentTarget.value) })} /></label>
          <label>Subida <input type="number" step="0.1" value={params["slope-ramp"].rise} onChange={(event) => onParamsChange("slope-ramp", { ...params["slope-ramp"], rise: Number(event.currentTarget.value) })} /></label>
          <p>Arraste do início ao fim. A rampa começa na altura de onde você clicou e sobe o valor de Subida. Uma ponta que cai na borda de uma plataforma na mesma altura é soldada a ela.</p>
          <p>Depois de criada: um canto muda a largura daquela ponta, uma lateral muda as duas larguras juntas, uma ponta muda o comprimento e a subida. Para uma rampa com curvas, use a Espiral.</p>
        </div>
      ) : activeTool === "slope-spiral" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label>Largura <input type="number" min="0.1" step="0.1" value={params["slope-spiral"].width} onChange={(event) => onParamsChange("slope-spiral", { ...params["slope-spiral"], width: Number(event.currentTarget.value) })} /></label>
          <label>Subida <input type="number" step="0.1" value={params["slope-spiral"].rise} onChange={(event) => onParamsChange("slope-spiral", { ...params["slope-spiral"], rise: Number(event.currentTarget.value) })} /></label>
          <p>Clique o centro, depois o início: a distância é o raio. Gire o cursor em volta do centro no sentido que quiser, cada volta completa soma uma volta, e clique o fim.</p>
          <p>A espiral começa na altura do início e termina na altura do piso onde você clicou o fim, ou sobe o valor de Subida. Shift e mover o mouse para cima ou para baixo ajusta a subida.</p>
        </div>
      ) : activeTool === "slope-curve" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <div className="gm-material-grid">
            {(["points", "straight", "arc", "connect", "spiral"] as const).map((mode, i) => <SelectableChip key={mode} label={["Por pontos", "Reta", "Arco", "Ligar pontas", "Espiral"][i]!} swatchColor="#79b8e8" selected={(params["slope-curve"].mode ?? "points") === mode} onSelect={() => onParamsChange("slope-curve", { ...params["slope-curve"], mode })} />)}
          </div>
          <label>Largura <input type="number" min="0.1" step="0.1" value={params["slope-curve"].width} onChange={(event) => onParamsChange("slope-curve", { ...params["slope-curve"], width: Number(event.currentTarget.value) })} /></label>
          <label>Subida <input type="number" step="0.1" value={params["slope-curve"].rise} onChange={(event) => onParamsChange("slope-curve", { ...params["slope-curve"], rise: Number(event.currentTarget.value) })} /></label>
          <p>Por pontos: clique por onde a curva passa; clique de novo no último, ou Enter. Reta: início e fim. Arco: início, fim e puxe a curva. Ligar pontas: clique na borda de um piso e depois na do outro, e a rampa sai reta de cada borda. Espiral: centro, início, gire e clique o fim. R troca o modo.</p>
          <p>A rampa começa na altura do primeiro clique e termina na altura do piso do último clique, ou sobe o valor de Subida, sempre na mesma inclinação. Shift e mover o mouse para cima ou para baixo ajusta a subida. Backspace desfaz o último clique e Esc cancela.</p>
        </div>
      ) : activeTool === "path-brush" ? (<PathBrushFields params={params["path-brush"]} onChange={(next) => onParamsChange("path-brush", next)} />) : activeTool === "wall-brush" ? (
        <WallBrushFields params={params["wall-brush"]} onChange={(next) => onParamsChange("wall-brush", next)} />
      ) : activeTool === "wall-line" ? (
        <WallLineFields params={params["wall-line"]} onChange={(next) => onParamsChange("wall-line", next)} />
      ) : activeTool === "opening" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <OpeningFields params={params.opening} onChange={(next) => onParamsChange("opening", next)} />
          <p>Clique numa parede para abrir uma abertura nova. Clique numa existente para selecionar -- com uma selecionada, ajuste os campos acima e clique na parede para mover ou redimensionar; Delete ou Backspace apaga e restaura a parede.</p>
        </div>
      ) : activeTool === "tower-stamp" ? (
        <TowerStampFields params={params["tower-stamp"]} onChange={(next) => onParamsChange("tower-stamp", next)} />
      ) : activeTool === "demolish" ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {sliderRow("Raio", params.demolish.radius, 0.1, 10, 0.05, (radius) =>
            onParamsChange("demolish", { ...params.demolish, radius })
          )}
        </div>
      ) : (
        <TerrainSculptFields
          params={params["terrain-sculpt"]}
          onChange={(next) => onParamsChange("terrain-sculpt", next)}
        />
      ),
  };

  const panels = [panel];

  // `Collapse` owns its expanded keys internally. Remount it when the tool
  // changes so its new single panel starts expanded rather than inheriting
  // the previous tool's key and appearing empty.
  return <Collapse key={activeTool} panels={panels} bordered={false} />;
}
