import { createElement } from "react";
import { IconCutaway } from "./icons.ts";

export interface FloorSlicerProps {
  readonly height: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly onChange: (newHeight: number) => void;
}

export function FloorSlicer({
  height,
  minHeight = 0,
  maxHeight = 15,
  onChange,
}: FloorSlicerProps) {
  const presets = [
    { label: "B1", value: 0 },
    { label: "Térreo", value: 3 },
    { label: "1º Andar", value: 6 },
    { label: "Telhado", value: 12 },
  ];

  return createElement("div", { className: "gm-floor-slicer-card" },
    createElement("div", { className: "gm-floor-slicer-header" },
      createElement(IconCutaway),
      createElement("span", null, "Corte de Altura (Camera Clip Y)"),
      createElement("strong", { className: "gm-floor-slicer-val" }, `${height.toFixed(1)}m`)
    ),
    createElement("div", { className: "gm-floor-slicer-body" },
      createElement("input", {
        type: "range",
        min: minHeight,
        max: maxHeight,
        step: 0.5,
        value: height,
        onChange: (e) => onChange(parseFloat((e.target as HTMLInputElement).value)),
        className: "gm-floor-slider-input",
      }),
      createElement("div", { className: "gm-floor-presets" },
        ...presets.map((preset) =>
          createElement("button", {
            key: preset.label,
            type: "button",
            className: `gm-floor-preset-btn ${
              Math.abs(height - preset.value) < 0.2 ? "gm-floor-preset-btn--active" : ""
            }`,
            onClick: () => onChange(preset.value),
          }, preset.label)
        )
      )
    )
  );
}
