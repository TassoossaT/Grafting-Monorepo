"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createHeightfieldCanvas, type HeightfieldCanvas } from "@grafting/three-canvas";
import { GridLayout, PreviewCard, type GridPanel } from "@grafting/ui";
import "react-grid-layout/css/styles.css";
import type { HeightmapWorkerRequest, HeightmapWorkerResponse } from "./generation.worker.ts";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 64;

interface Heightmap {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

/** Runs one real Rust-owned heightmap generation outside the main thread. */
function requestHeightmap(seed: number, scale: number): Promise<Heightmap> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./generation.worker.ts", import.meta.url), { type: "module" });
    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<HeightmapWorkerResponse>) => {
      finish();
      if (event.data.type === "result") {
        resolve({ width: event.data.width, height: event.data.height, values: event.data.values });
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The heightmap generation worker failed."));
    };
    const request: HeightmapWorkerRequest = { type: "generate", width: GRID_WIDTH, height: GRID_HEIGHT, seed, scale };
    worker.postMessage(request);
  });
}

/** Renders real Rust-computed heightmap output via `@grafting/three-canvas` -- no `three` import here, per this repo's package-boundary convention (`@antv/x6` behind `@grafting/x6-canvas`, `antd` behind `@grafting/ui`). */
function TerrainCanvas({
  heightmap,
  handleRef,
}: {
  heightmap: Heightmap | null;
  handleRef: MutableRefObject<HeightfieldCanvas | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || heightmap === null) return;

    if (handleRef.current === null) {
      handleRef.current = createHeightfieldCanvas(container, {
        width: heightmap.width,
        height: heightmap.height,
        values: heightmap.values,
      });
    } else {
      handleRef.current.update(heightmap.values);
    }
  }, [heightmap, handleRef]);

  useEffect(() => {
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [handleRef]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

export default function GenerationClient() {
  const [seed, setSeed] = useState(1);
  const [scale, setScale] = useState(0.12);
  const [heightmap, setHeightmap] = useState<Heightmap | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const canvasHandleRef = useRef<HeightfieldCanvas | null>(null);

  const capturePreview = useCallback(() => {
    if (canvasHandleRef.current === null) return;
    setPreviewImage(canvasHandleRef.current.captureImage());
  }, []);

  const generate = useCallback((nextSeed: number, nextScale: number) => {
    setStatus("loading");
    setError(null);
    requestHeightmap(nextSeed, nextScale)
      .then((result) => {
        setHeightmap(result);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    generate(seed, scale);
  }, [generate, seed, scale]);

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
          <button type="button" onClick={() => generate(seed, scale)}>
            Regenerate
          </button>
          <button type="button" disabled={status !== "ok"} onClick={capturePreview}>
            Capture preview
          </button>
          <span data-testid="generation-status" data-status={status}>
            {status === "loading" && "Calculating the heightmap in Rust…"}
            {status === "ok" && heightmap !== null && `Ready · ${heightmap.width}×${heightmap.height} cells`}
            {status === "error" && `Error: ${error}`}
          </span>
        </div>
      ),
    },
    {
      placement: { id: "terrain", x: 0, y: 3, width: 8, height: 9 },
      content: <TerrainCanvas heightmap={heightmap} handleRef={canvasHandleRef} />,
    },
    {
      placement: { id: "preview", x: 8, y: 3, width: 4, height: 9 },
      content: (
        <div style={{ padding: 12 }}>
          <PreviewCard
            title={`Heightmap · seed ${seed}`}
            description={`Perlin-noise procedural terrain, scale ${scale}.`}
            cover={
              previewImage === null
                ? undefined
                : { src: previewImage, alt: `Rendered heightmap preview for seed ${seed}` }
            }
            status={status === "error" ? "error" : "success"}
            statusLabel={status === "error" ? "Error" : "Ready"}
            tags={[`seed:${seed}`, `scale:${scale}`]}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 12, boxSizing: "border-box" }}>
      <GridLayout
        panels={panels}
        ariaLabel="Procedural heightmap generation test surface"
        rowHeight={32}
        draggable
        resizable
      />
    </div>
  );
}
