"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createHeightfieldCanvas, type HeightfieldCanvas } from "@grafting/ui";
import { GridLayout, PreviewCard, type GridPanel } from "@grafting/ui";
import "react-grid-layout/css/styles.css";
import { readPreviewImage, writePreviewImage } from "../../../lab-preview-storage.ts";
import type { QuantizationWorkerRequest, QuantizationWorkerResponse } from "./quantization.worker.ts";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 64;
/** Must match the "terrain-quantization" key in `DEMO_LINKS` (research-registry-ui.ts) so the /lab/trials gallery finds this trial's captured preview. */
const CANDIDATE = "terrain-quantization";

interface QuantizationResult {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  readonly quantized: Int32Array;
}

/** Renders the discrete quantized levels through the existing heightfield renderer, mapping each integer level back to a [-1, 1] float so no new stepped-terrain visual has to be built for this test surface. */
function levelsToHeightfield(quantized: Int32Array, levels: number): Float32Array {
  const denominator = Math.max(levels - 1, 1);
  const values = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    values[i] = (quantized[i] / denominator) * 2 - 1;
  }
  return values;
}

/** Runs the real Rust-owned generate-then-quantize pipeline outside the main thread. */
function requestQuantization(seed: number, scale: number, levels: number): Promise<QuantizationResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./quantization.worker.ts", import.meta.url), { type: "module" });
    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<QuantizationWorkerResponse>) => {
      finish();
      if (event.data.type === "result") {
        resolve({
          width: event.data.width,
          height: event.data.height,
          levels: event.data.levels,
          quantized: event.data.quantized,
        });
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The terrain-quantization worker failed."));
    };
    const request: QuantizationWorkerRequest = { type: "generate", width: GRID_WIDTH, height: GRID_HEIGHT, seed, scale, levels };
    worker.postMessage(request);
  });
}

function TerrainCanvas({
  result,
  handleRef,
}: {
  result: QuantizationResult | null;
  handleRef: MutableRefObject<HeightfieldCanvas | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || result === null) return;

    const values = levelsToHeightfield(result.quantized, result.levels);
    if (handleRef.current === null) {
      handleRef.current = createHeightfieldCanvas(container, { width: result.width, height: result.height, values });
    } else {
      handleRef.current.update(values);
    }
  }, [result, handleRef]);

  useEffect(() => {
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [handleRef]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

export default function QuantizationClient() {
  const [seed, setSeed] = useState(1);
  const [scale, setScale] = useState(0.12);
  const [levels, setLevels] = useState(6);
  const [result, setResult] = useState<QuantizationResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    setPreviewImage(readPreviewImage(CANDIDATE) ?? null);
  }, []);
  const canvasHandleRef = useRef<HeightfieldCanvas | null>(null);

  const capturePreview = useCallback(() => {
    if (canvasHandleRef.current === null) return;
    const dataUrl = canvasHandleRef.current.captureImage();
    setPreviewImage(dataUrl);
    writePreviewImage(CANDIDATE, dataUrl);
  }, []);

  const generate = useCallback((nextSeed: number, nextScale: number, nextLevels: number) => {
    setStatus("loading");
    setError(null);
    requestQuantization(nextSeed, nextScale, nextLevels)
      .then((next) => {
        setResult(next);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    generate(seed, scale, levels);
  }, [generate, seed, scale, levels]);

  const panels: readonly GridPanel[] = [
    {
      placement: { id: "controls", x: 0, y: 0, width: 12, height: 3 },
      content: (
        <div style={{ padding: 12, display: "flex", gap: 16, alignItems: "center" }}>
          <label>
            Seed{" "}
            <input
              type="number"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
              style={{ width: 80 }}
            />
          </label>
          <label>
            Scale{" "}
            <input
              type="number"
              step="0.01"
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
              style={{ width: 80 }}
            />
          </label>
          <label>
            Levels{" "}
            <input
              type="number"
              min={1}
              value={levels}
              onChange={(event) => setLevels(Math.max(1, Number(event.target.value)))}
              style={{ width: 80 }}
            />
          </label>
          <button type="button" onClick={() => generate(seed, scale, levels)}>
            Regenerate
          </button>
          <button type="button" disabled={status !== "ok"} onClick={capturePreview}>
            Capture preview
          </button>
          <span data-testid="quantization-status" data-status={status}>
            {status === "loading" && "Quantizing the heightmap in Rust…"}
            {status === "ok" && result !== null && `Ready · ${result.width}×${result.height} cells · ${result.levels} levels`}
            {status === "error" && `Error: ${error}`}
          </span>
        </div>
      ),
    },
    {
      placement: { id: "terrain", x: 0, y: 3, width: 8, height: 9 },
      content: <TerrainCanvas result={result} handleRef={canvasHandleRef} />,
    },
    {
      placement: { id: "preview", x: 8, y: 3, width: 4, height: 9 },
      content: (
        <div style={{ padding: 12 }}>
          <PreviewCard
            title={`Terrain quantization · seed ${seed}`}
            description={`Heightmap quantized into ${levels} discrete elevation levels.`}
            cover={
              previewImage === null
                ? undefined
                : { src: previewImage, alt: `Rendered quantized terrain preview for seed ${seed}` }
            }
            status={status === "error" ? "error" : "success"}
            statusLabel={status === "error" ? "Error" : "Ready"}
            tags={[`seed:${seed}`, `scale:${scale}`, `levels:${levels}`]}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 12, boxSizing: "border-box" }}>
      <GridLayout
        panels={panels}
        ariaLabel="Terrain heightmap quantization test surface"
        rowHeight={32}
        draggable
        resizable
      />
    </div>
  );
}
