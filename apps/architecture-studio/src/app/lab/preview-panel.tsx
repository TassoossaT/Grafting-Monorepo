"use client";

import { useEffect, useRef } from "react";
import { Text, createHeightfieldCanvas, type HeightfieldCanvas } from "@grafting/ui";
import type { EvaluationPreview } from "../../bench/evaluation-client.ts";

/** Inputs for the 3D panel that renders one node's result. */
export interface PreviewPanelProps {
  /** Result to render, or `null` when nothing has been computed yet. */
  readonly preview: EvaluationPreview | null;
  /** Human-readable name of the node being shown. */
  readonly label: string | null;
}

/**
 * Renders one element's result in 3D.
 *
 * The heightfield element fixes its grid dimensions when it is created and its
 * update path only accepts new values, so a preview whose shape changed forces
 * a fresh canvas while a preview that only changed in content updates in place.
 * Recreating on every frame would restart the camera and lose the comparison a
 * user is in the middle of making.
 */
export default function PreviewPanel({ preview, label }: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HeightfieldCanvas | null>(null);
  const shapeRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    if (preview === null) {
      canvasRef.current?.dispose();
      canvasRef.current = null;
      shapeRef.current = null;
      return;
    }

    const shape = `${preview.width}x${preview.height}`;
    if (canvasRef.current === null || shapeRef.current !== shape) {
      canvasRef.current?.dispose();
      canvasRef.current = createHeightfieldCanvas(container, {
        width: preview.width,
        height: preview.height,
        values: preview.values,
      });
      shapeRef.current = shape;
    } else {
      canvasRef.current.update(preview.values);
    }
  }, [preview]);

  useEffect(
    () => () => {
      canvasRef.current?.dispose();
      canvasRef.current = null;
    },
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, height: "100%", minHeight: 0 }}>
      <Text
        content={label === null ? "Nothing to render yet" : `Rendering ${label}`}
        tone="muted"
      />
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}
      />
    </div>
  );
}
