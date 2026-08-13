import { createElement } from "react";
import { IconPalette } from "./icons.ts";

export interface MaterialOption {
  readonly id: string;
  readonly name: string;
  readonly colorHex: string;
  readonly classStyle: string;
}

export const DEFAULT_MATERIALS: readonly MaterialOption[] = [
  { id: "wall-white", name: "Bloco Branco", colorHex: "#e2e8f0", classStyle: "gm-swatch--wall-white" },
  { id: "wall-gray", name: "Bloco Cinza", colorHex: "#64748b", classStyle: "gm-swatch--wall-gray" },
  { id: "terrain", name: "Grid Terreno", colorHex: "#334155", classStyle: "gm-swatch--terrain" },
  { id: "terrain-grass", name: "Grama VTT", colorHex: "#4a7a4a", classStyle: "gm-swatch--terrain-grass" },
];

export interface MaterialPaletteProps {
  readonly activeMaterialId: string;
  readonly materials?: readonly MaterialOption[];
  readonly onSelectMaterial: (id: string) => void;
}

export function MaterialPalette({
  activeMaterialId,
  materials = DEFAULT_MATERIALS,
  onSelectMaterial,
}: MaterialPaletteProps) {
  return createElement("div", { className: "gm-material-palette-card" },
    createElement("div", { className: "gm-panel-card-title" },
      createElement("span", { style: { display: "flex", alignItems: "center", gap: "0.4rem" } },
        createElement(IconPalette),
        "Estilo de Bloco & Material"
      )
    ),
    createElement("div", { className: "gm-material-grid" },
      ...materials.map((mat) => {
        const isSelected = mat.id === activeMaterialId;
        return createElement("button", {
          key: mat.id,
          type: "button",
          className: `gm-material-chip ${isSelected ? "gm-material-chip--selected" : ""}`,
          onClick: () => onSelectMaterial(mat.id),
        },
          createElement("div", { className: `gm-swatch ${mat.classStyle}`, style: { backgroundColor: mat.colorHex } }),
          createElement("span", null, mat.name)
        );
      })
    )
  );
}
