import type { ReactElement } from "react";

/** Material option entry for swatch selection. */
export interface MaterialSwatchOption {
  /**
   * Unique material identifier.
   * @example "wall-white"
   */
  readonly id: string;
  /**
   * Display name of the material or prototype block.
   * @example "Bloco Branco"
   */
  readonly name: string;
  /**
   * Color hex code or preview styling.
   * @example "#e2e8f0"
   */
  readonly colorHex: string;
  /** Optional material category. */
  readonly category?: string;
}

/** Default material options for prototype blocks. */
export const DEFAULT_SWATCH_MATERIALS: readonly MaterialSwatchOption[] = [
  { id: "wall-white", name: "Bloco Branco (Std)", colorHex: "#e2e8f0", category: "prototype" },
  { id: "wall-gray", name: "Bloco Cinza (Pedra)", colorHex: "#64748b", category: "prototype" },
  { id: "terrain-dark", name: "Grid Terreno", colorHex: "#334155", category: "terrain" },
  { id: "terrain-grass", name: "Grama VTT", colorHex: "#4a7a4a", category: "terrain" },
];

/** Public inputs for Material Swatch Palette Grid component. */
export interface MaterialSwatchGridProps {
  /**
   * Currently active material swatch ID.
   * @example "wall-white"
   */
  readonly activeMaterialId: string;
  /** Optional array of available material swatches. */
  readonly materials?: readonly MaterialSwatchOption[];
  /**
   * Callback when a material is chosen.
   * @example (id) => console.log(id)
   */
  readonly onSelectMaterial: (id: string) => void;
  /** Optional custom CSS class name. */
  readonly className?: string;
}

/**
 * Material Swatch Palette Grid molecule for block and surface styling.
 *
 * @layer molecule
 * @status stable
 */
export function MaterialSwatchGrid(props: MaterialSwatchGridProps): ReactElement {
  const {
    activeMaterialId,
    materials = DEFAULT_SWATCH_MATERIALS,
    onSelectMaterial,
    className = "",
  } = props;

  return (
    <div className={`gm-material-palette-card ${className}`}>
      <div className="gm-panel-card-title">Estilo & Material do Bloco</div>
      <div className="gm-material-grid">
        {materials.map((mat) => {
          const isSelected = mat.id === activeMaterialId;
          return (
            <button
              key={mat.id}
              className={`gm-material-chip ${isSelected ? "gm-material-chip--selected" : ""}`}
              onClick={() => onSelectMaterial(mat.id)}
              type="button"
            >
              <div className="gm-swatch" style={{ backgroundColor: mat.colorHex }} />
              <span>{mat.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
