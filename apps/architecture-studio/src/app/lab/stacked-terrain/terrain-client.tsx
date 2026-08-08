"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Text } from "@grafting/ui";
import { createEngine, createVisualRegistry, type RenderEngine, type View } from "@grafting/render-3d";
import { buildIrregularQuadGrid } from "../../../vtt/irregular-grid.ts";
import { buildStackedTerrain, cellCentres } from "../../../vtt/stacked-terrain.ts";
import { attachOrbit, orbitFromCamera } from "../../../lab-orbit-camera.ts";
import { writePreviewImage } from "../../../lab-preview-storage.ts";
import type { TerrainWorkerRequest, TerrainWorkerResponse } from "./terrain.worker.ts";

/** Must match the "stacked-terrain" key in `DEMO_LINKS` so /lab/trials finds this trial's preview. */
const CANDIDATE = "stacked-terrain";

const TOP_LAYER = "tops";
const WALL_LAYER = "walls";
const FIELD_SIZE = 64;

/** Starting framing. Orbiting recovers its yaw, pitch and distance from this. */
const CAMERA = {
  projection: "perspective",
  fov: 40,
  position: { x: 4.5, y: 4.5, z: 5.5 },
  target: { x: 0, y: 0.3, z: 0 },
  far: 100,
} as const;

interface Controls {
  readonly seed: number;
  readonly trianglesPerSide: number;
  readonly levels: number;
  readonly scale: number;
  readonly levelHeight: number;
}

/**
 * `scale` multiplies integer sample coordinates before they reach Perlin, and
 * Perlin is exactly zero at every integer lattice point. A whole-number scale
 * therefore lands every sample on a lattice point and returns a field of pure
 * zeros — a perfectly flat map. A half-step is no better: it zeros every other
 * sample and saturates the rest at the extremes, which is aliasing, not
 * terrain. Usable values are well below one, matching the crate's own doc
 * comment and its tests.
 */
const SCALE_RANGE = { min: 0.02, max: 0.4, step: 0.01, initial: 0.12 } as const;

const INITIAL: Controls = {
  seed: 1,
  trianglesPerSide: 5,
  levels: 5,
  scale: SCALE_RANGE.initial,
  levelHeight: 0.22,
};

/** Runs the real Rust generate-sample-quantize pipeline off the main thread. */
function requestLevels(centres: Float32Array, controls: Controls): Promise<Int32Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => {
      finish();
      if (event.data.type === "result") resolve(event.data.levels);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The stacked-terrain worker failed."));
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

export default function StackedTerrainClient() {
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

  // One engine for the trial's lifetime; a graphics context per slider drag
  // is exactly what the engine exists to avoid.
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
    registry.register({ ...surface(0x9c8365), kind: "wall" });

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.7 },
        { light: "directional", intensity: 0.9, direction: { x: 4, y: 8, z: 5 } },
      ],
    });

    engine.scene.defineLayer({ id: TOP_LAYER, order: 0 }, "engine");
    engine.scene.defineLayer({ id: WALL_LAYER, order: 1 }, "engine");

    const view = engine.createView({
      target: container,
      background: 0xeef2f7,
      camera: CAMERA,
    });

    engineRef.current = engine;
    viewRef.current = view;

    // A generated surface seen from one angle hides exactly the defects a
    // trial exists to expose, so the camera is drivable rather than fixed.
    const detachOrbit = attachOrbit(container, view, orbitFromCamera(CAMERA.position, CAMERA.target), {
      fov: CAMERA.fov,
      far: CAMERA.far,
      onChange: () => engine.frame(performance.now()),
    });

    const handleResize = () => view.resize(container.clientWidth, container.clientHeight);
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      detachOrbit();
      engine.dispose();
      engineRef.current = null;
      viewRef.current = null;
    };
  }, []);

  // Elevation comes from Rust, so it arrives asynchronously; the grid itself
  // is synchronous and already drawn by the time it lands.
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

    const terrain = buildStackedTerrain(grid, levels, {
      levelHeight: controls.levelHeight,
      baseHeight: -0.6,
    });

    engine.scene.batch(() => {
      engine.scene.put(
        {
          id: "tops",
          layer: TOP_LAYER,
          visual: { kind: "top", params: { positions: terrain.positions, indices: terrain.topIndices } },
        },
        "local",
      );
      engine.scene.put(
        {
          id: "walls",
          layer: WALL_LAYER,
          visual: { kind: "wall", params: { positions: terrain.positions, indices: terrain.wallIndices } },
        },
        "local",
      );
    });

    engine.frame(performance.now());
    writePreviewImage(CANDIDATE, view.capture("image/png"));
  }, [grid, levels, controls.levelHeight]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, padding: 12 }}>
      <Card ariaLabel="Terrain parameters">
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
            <Text content={`Noise scale: ${controls.scale.toFixed(2)}`} strong />
            <input
              type="range"
              min={SCALE_RANGE.min}
              max={SCALE_RANGE.max}
              step={SCALE_RANGE.step}
              value={controls.scale}
              onChange={(event) => setControls({ ...controls, scale: Number(event.target.value) })}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <Text content={`Level height: ${controls.levelHeight.toFixed(2)}`} strong />
            <input
              type="range"
              min={0.05}
              max={0.6}
              step={0.01}
              value={controls.levelHeight}
              onChange={(event) =>
                setControls({ ...controls, levelHeight: Number(event.target.value) })
              }
            />
          </label>

          <Text content={`${grid.quads.length} cells`} />
          {error !== null ? <Text content={error} tone="danger" /> : null}
          <Text
            content="Elevation is per cell, so neighbours at different levels meet at a hard vertical step. Smoothing those steps is the next stage, not a defect here."
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
