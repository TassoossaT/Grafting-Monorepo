"use client";

import { useCallback, useState } from "react";
import type { SelectedNodeInfo } from "./settings-drawer.tsx";

export interface InCanvasPropertyPopoverProps {
  readonly selectedNodeInfo: SelectedNodeInfo | null;
  readonly onHeightChange: (nextY: number) => void;
  readonly onClose: () => void;
}

const MATERIAL_OPTIONS = [
  { id: "stone", label: "🪨 Pedra Rústica" },
  { id: "brick", label: "🧱 Tijolo" },
  { id: "timber", label: "🪵 Enxaimel" },
  { id: "plaster", label: "🏛️ Reboco" },
] as const;

/**
 * Contextual in-canvas property popover floating directly above the selected
 * 3D element (Tiny Glade style), allowing direct adjustment of height,
 * materials, and elevation without opening side panels.
 */
export function InCanvasPropertyPopover(props: InCanvasPropertyPopoverProps) {
  const { selectedNodeInfo, onHeightChange, onClose } = props;
  const [selectedMaterial, setSelectedMaterial] = useState<string>("stone");

  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(event.target.value);
      if (Number.isFinite(val)) {
        onHeightChange(val);
      }
    },
    [onHeightChange],
  );

  const handleHeightStep = useCallback(
    (delta: number) => {
      if (!selectedNodeInfo) return;
      const nextY = Math.max(0, Math.round((selectedNodeInfo.point.y + delta) * 2) / 2);
      onHeightChange(nextY);
    },
    [selectedNodeInfo, onHeightChange],
  );

  if (selectedNodeInfo === null) return null;

  return (
    <div className="vtt-in-canvas-popover" role="dialog" aria-label="Propriedades do Elemento">
      <div className="vtt-in-canvas-popover__header">
        <div className="vtt-in-canvas-popover__title">
          <span className="vtt-in-canvas-popover__icon">📐</span>
          <span className="vtt-in-canvas-popover__label">Ajuste da Estrutura</span>
        </div>
        <button
          type="button"
          className="vtt-in-canvas-popover__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>

      <div className="vtt-in-canvas-popover__section">
        <div className="vtt-in-canvas-popover__row">
          <span className="vtt-in-canvas-popover__field-label">Altura (Y):</span>
          <span className="vtt-in-canvas-popover__field-value">
            {selectedNodeInfo.point.y.toFixed(1)}m
          </span>
        </div>

        <div className="vtt-in-canvas-popover__stepper-row">
          <button
            type="button"
            className="vtt-in-canvas-popover__step-btn"
            onClick={() => handleHeightStep(-0.5)}
            title="Diminuir altura em 0.5m"
          >
            −
          </button>
          <input
            type="range"
            min="0"
            max="12"
            step="0.25"
            value={selectedNodeInfo.point.y}
            onChange={handleSliderChange}
            className="vtt-in-canvas-popover__slider"
            aria-label="Ajustar Altura"
          />
          <button
            type="button"
            className="vtt-in-canvas-popover__step-btn"
            onClick={() => handleHeightStep(0.5)}
            title="Aumentar altura em 0.5m"
          >
            +
          </button>
        </div>
      </div>

      <div className="vtt-in-canvas-popover__section">
        <span className="vtt-in-canvas-popover__field-label">Material da Fachada</span>
        <div className="vtt-in-canvas-popover__chips">
          {MATERIAL_OPTIONS.map((mat) => (
            <button
              key={mat.id}
              type="button"
              className={`vtt-in-canvas-popover__chip ${
                selectedMaterial === mat.id ? "vtt-in-canvas-popover__chip--active" : ""
              }`}
              onClick={() => setSelectedMaterial(mat.id)}
            >
              {mat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="vtt-in-canvas-popover__footer">
        <span className="vtt-in-canvas-popover__coord">
          X: {selectedNodeInfo.point.x.toFixed(1)} | Z: {selectedNodeInfo.point.z.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
