"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Text } from "@grafting/ui";
import { createEngine, createVisualRegistry, type RenderEngine, type View } from "@grafting/render-3d";
import { buildIrregularQuadGrid } from "../../../vtt/irregular-grid.ts";
import { buildStackedTerrain, cellCentres } from "../../../vtt/stacked-terrain.ts";
import { buildTransitionTerrain } from "../../../vtt/transition-shapes.ts";
import { writePreviewImage } from "../../../lab-preview-storage.ts";
import type {
  TerrainWorkerRequest,
  TerrainWorkerResponse,
} from "../stacked-terrain/terrain.worker.ts";

/** Must match the "terrain-transitions" key in `DEMO_LINKS` so /lab/trials finds this trial's preview. */
const CANDIDATE = "terrain-transitions";

const TOP_LAYER = "tops";
const SIDE_LAYER = "sides";
const FIELD_SIZE = 64;
const LEVEL_HEIGHT = 0.22;
const BASE_HEIGHT = -0.6;

interface Controls {
  readonly seed: number;
  readonly trianglesPerSide: number;
  readonly levels: number;
  readonly scale: number;
  /** False shows stage 2's hard steps, for a direct comparison. */
  readonly smooth: boolean;
}

const INITIAL: Controls = { seed: 1, trianglesPerSide: 5, levels: 5, scale: 3, smooth: true };

/** Runs the same Rust generate-sample-quantize pipeline stage 2's trial uses. */
function requestLevels(centres: Float32Array, controls: Controls): Promise<Int32Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../stacked-terrain/terrain.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => {
      finish();
      if (event.data.type === "result") resolve(event.data.levels);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The terrain worker failed."));
    };

    const request: TerrainWorkerRequest = {
      type: "elevate",
      centres,
      fieldSize: FIELD_SIZE,
      seed: controls.seed,
      scale: controls.scale,
      levels: controls.levels,
    };
    worker.postMessage(request, [centres.buffer]);
  });
}

export default function TerrainTransitionsClient() {
  const [controls, setControls] = useState<Controls>(INITIAL);
  const [levels, setLevels] = useState<Int32Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  const grid = useMemo(
    () =>
      buildIrregularQuadGrid({
        trianglesPerSide: controls.trianglesPerSide,
        triangleSide: 0.5,
        seed: controls.seed,
      }),
    [controls.seed, controls.trianglesPerSide],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const registry = createVisualRegistry();
    const surface = (color: number) => ({
      kind: "",
      describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
        geometry: { shape: "mesh" as const, data: { positions: params.positions, indices: params.indices } },
        material: { surface: "lit" as const, color, flatShading: true },
      }),
    });
    registry.register({ ...surface(0x7fa86a), kind: "top" });
    registry.register({ ...surface(0x9c8365), kind: "side" });

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.7 },
        { light: "directional", intensity: 0.9, direction: { x: 4, y: 8, z: 5 } },
      ],
    });

    engine.scene.defineLayer({ id: TOP_LAYER, order: 0 }, "engine");
    engine.scene.defineLayer({ id: SIDE_LAYER, order: 1 }, "engine");

    const view = engine.createView({
      target: container,
      background: 0xeef2f7,
      camera: {
        projection: "perspective",
        fov: 40,
        position: { x: 4.5, y: 4.5, z: 5.5 },
        target: { x: 0, y: 0.3, z: 0 },
        far: 100,
      },
    });

    engineRef.current = engine;
    viewRef.current = view;

    const handleResize = () => view.resize(container.clientWidth, container.clientHeight);
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      engine.dispose();
      engineRef.current = null;
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const { centres, min, max } = cellCentres(grid);
    const spanX = max.x - min.x || 1;
    const spanY = max.y - min.y || 1;

    const normalised = new Float32Array(centres.length * 2);
    centres.forEach((centre, index) => {
      normalised[index * 2] = (centre.x - min.x) / spanX;
      normalised[index * 2 + 1] = (centre.y - min.y) / spanY;
    });

    setError(null);
    requestLevels(normalised, controls)
      .then((result) => {
        if (!cancelled) setLevels(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [grid, controls.seed, controls.levels, controls.scale]);

  useEffect(() => {
    const engine = engineRef.current;
    const view = viewRef.current;
    if (engine === null || view === null || levels === null) return;
    if (levels.length !== grid.quads.length) return;

    const options = { levelHeight: LEVEL_HEIGHT, baseHeight: BASE_HEIGHT };
    let positions: Float32Array;
    let tops: Uint32Array;
    let sides: Uint32Array;

    if (controls.smooth) {
      const terrain = buildTransitionTerrain(grid, levels, options);
      positions = terrain.positions;
      tops = terrain.topIndices;
      // The skirt is the same material as the transitions; only the shading
      // split cares about the distinction.
      sides = new Uint32Array(terrain.sideIndices.length + terrain.skirtIndices.length);
      sides.set(terrain.sideIndices, 0);
      sides.set(terrain.skirtIndices, terrain.sideIndices.length);
    } else {
      const terrain = buildStackedTerrain(grid, levels, options);
      positions = terrain.positions;
      tops = terrain.topIndices;
      sides = terrain.wallIndices;
    }

    engine.scene.batch(() => {
      engine.scene.put(
        { id: "tops", layer: TOP_LAYER, visual: { kind: "top", params: { positions, indices: tops } } },
        "local",
      );
      engine.scene.put(
        { id: "sides", layer: SIDE_LAYER, visual: { kind: "side", params: { positions, indices: sides } } },
        "local",
      );
    });

    engine.frame(performance.now());
    writePreviewImage(CANDIDATE, view.capture("image/png"));
  }, [grid, levels, controls.smooth]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, padding: 12 }}>
      <Card ariaLabel="Transition parameters">
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <Text content="Seed" strong />
            <input
              type="number"
              value={controls.seed}
              onChange={(event) => setControls({ ...controls, seed: Number(event.target.value) })}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <Text content={`Triangles per hexagon side: ${controls.trianglesPerSide}`} strong />
            <input
              type="range"
              min={2}
              max={7}
              value={controls.trianglesPerSide}
              onChange={(event) =>
                setControls({ ...controls, trianglesPerSide: Number(event.target.value) })
              }
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <Text content={`Discrete levels: ${controls.levels}`} strong />
            <input
              type="range"
              min={2}
              max={12}
              value={controls.levels}
              onChange={(event) => setControls({ ...controls, levels: Number(event.target.value) })}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <Text content={`Noise scale: ${controls.scale}`} strong />
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={controls.scale}
              onChange={(event) => setControls({ ...controls, scale: Number(event.target.value) })}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={controls.smooth}
              onChange={(event) => setControls({ ...controls, smooth: event.target.checked })}
            />
            <Text content="Smooth the steps" strong />
          </label>

          <Text content={`${grid.quads.length} cells`} />
          {error !== null ? <Text content={error} tone="danger" /> : null}
          <Text
            content="Both views use the same levels. Unticking falls back to stage 2's per-cell boxes, so the difference on screen is the change from cell occupancy to corner-column occupancy — not a different heightmap."
            tone="muted"
          />
        </div>
      </Card>
      <div
        ref={containerRef}
        style={{ minHeight: 560, border: "1px solid #d9d9d9", borderRadius: 8, overflow: "hidden" }}
      />
    </div>
  );
}
