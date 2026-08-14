"use client";

import { useEffect, useRef } from "react";
import { createHeightfieldCanvas, type HeightfieldCanvas } from "@grafting/ui";

export type CornerHeights = readonly [number, number, number, number];

export interface TerrainShapePickerProps {
  readonly cornerHeights: CornerHeights;
  readonly onChange: (cornerHeights: [number, number, number, number]) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 3;
const DEFAULT_STEP = 0.25;

export function TerrainShapePicker({
  cornerHeights,
  onChange,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  step = DEFAULT_STEP,
}: TerrainShapePickerProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HeightfieldCanvas | null>(null);

  useEffect(() => {
    if (previewRef.current === null) return;
    const canvas = createHeightfieldCanvas(previewRef.current, {
      width: 2,
      height: 2,
      values: Float32Array.from(cornerHeights),
      navigable: true,
      autoRotate: false,
    });
    canvasRef.current = canvas;
    return () => {
      canvas.dispose();
      canvasRef.current = null;
    };
    // Created once per mount; height edits stream through the `update` effect
    // below instead of tearing down and recreating the GPU context per drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    canvasRef.current?.update(Float32Array.from(cornerHeights));
  }, [cornerHeights]);

  const setCorner = (index: number, value: number) => {
    const next = [...cornerHeights] as [number, number, number, number];
    next[index] = value;
    onChange(next);
  };

  return (
    <div className="gm-terrain-picker">
      <div className="gm-terrain-picker-preview" ref={previewRef} />
      <div className="gm-terrain-picker-sliders">
        {cornerHeights.map((value, index) => (
          <label key={index} className="gm-terrain-picker-slider">
            <span>Canto {index + 1}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(event) => setCorner(index, Number(event.target.value))}
            />
            <span className="gm-terrain-picker-value">{value.toFixed(2)}m</span>
          </label>
        ))}
      </div>
    </div>
  );
}
