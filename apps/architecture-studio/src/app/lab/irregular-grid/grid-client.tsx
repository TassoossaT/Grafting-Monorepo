"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Text } from "@grafting/ui";
import {
  createEngine,
  createVisualRegistry,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";
import { buildIrregularQuadGrid } from "../../../vtt/irregular-grid.ts";
import { quadCentres, quadOutlines, quadSurface } from "../../../vtt/irregular-grid-geometry.ts";
import { writePreviewImage } from "../../../lab-preview-storage.ts";

/** Must match the "irregular-quad-grid" key in `DEMO_LINKS` so /lab/trials finds this trial's preview. */
const CANDIDATE = "irregular-quad-grid";

const SURFACE_LAYER = "cells";
const OUTLINE_LAYER = "edges";
const CENTRE_LAYER = "centres";

interface GridControls {
  readonly seed: number;
  readonly trianglesPerSide: number;
  readonly iterations: number;
  readonly showCentres: boolean;
}

const INITIAL: GridControls = { seed: 1, trianglesPerSide: 4, iterations: 12, showCentres: false };

export default function IrregularGridClient() {
  const [controls, setControls] = useState<GridControls>(INITIAL);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  const grid = useMemo(
    () =>
      buildIrregularQuadGrid({
        trianglesPerSide: controls.trianglesPerSide,
        triangleSide: 0.5,
        seed: controls.seed,
        iterations: controls.iterations,
      }),
    [controls.seed, controls.trianglesPerSide, controls.iterations],
  );

  // One engine for the trial's lifetime. Rebuilding it per parameter change
  // would spend a graphics context on every slider drag.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const registry = createVisualRegistry();
    registry.register({
      kind: "surface",
      describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
        geometry: { shape: "mesh", data: { positions: params.positions, indices: params.indices } },
        material: { surface: "lit", color: 0xdfe6ef, doubleSided: true, flatShading: true },
      }),
    });
    registry.register({
      kind: "outline",
      describe: (params: { positions: Float32Array }) => ({
        geometry: { shape: "segments", positions: params.positions },
        material: { surface: "line", color: 0x1f3554 },
      }),
    });
    registry.register({
      kind: "centres",
      describe: (params: { positions: Float32Array }) => ({
        geometry: { shape: "mesh", data: { positions: params.positions } },
        material: { surface: "points", color: 0xc2410c, size: 0.06 },
      }),
    });

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.85 },
        { light: "directional", intensity: 0.6, direction: { x: 2, y: 6, z: 3 } },
      ],
    });

    engine.scene.defineLayer({ id: SURFACE_LAYER, order: 0 }, "engine");
    engine.scene.defineLayer({ id: OUTLINE_LAYER, order: 1 }, "engine");
    engine.scene.defineLayer({ id: CENTRE_LAYER, order: 2 }, "engine");

    const view = engine.createView({
      target: container,
      background: 0xf7f9fc,
      camera: {
        projection: "orthographic",
        extent: 2.6,
        position: { x: 0, y: 10, z: 0.001 },
        target: { x: 0, y: 0, z: 0 },
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

  // The clock never plays: nothing here animates, so frames are drawn only
  // when the grid actually changed.
  useEffect(() => {
    const engine = engineRef.current;
    const view = viewRef.current;
    if (engine === null || view === null) return;

    const surface = quadSurface(grid);
    engine.scene.batch(() => {
      engine.scene.put(
        {
          id: "surface",
          layer: SURFACE_LAYER,
          visual: { kind: "surface", params: surface },
        },
        "local",
      );
      engine.scene.put(
        {
          id: "outline",
          layer: OUTLINE_LAYER,
          visual: { kind: "outline", params: { positions: quadOutlines(grid) } },
        },
        "local",
      );
      if (controls.showCentres) {
        engine.scene.put(
          {
            id: "centres",
            layer: CENTRE_LAYER,
            visual: { kind: "centres", params: { positions: quadCentres(grid) } },
          },
          "local",
        );
      } else {
        engine.scene.remove("centres", "local");
      }
    });

    engine.frame(performance.now());
    writePreviewImage(CANDIDATE, view.capture("image/png"));
  }, [grid, controls.showCentres]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, padding: 12 }}>
      <Card ariaLabel="Grid parameters">
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
              max={8}
              value={controls.trianglesPerSide}
              onChange={(event) =>
                setControls({ ...controls, trianglesPerSide: Number(event.target.value) })
              }
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <Text content={`Relaxation passes: ${controls.iterations}`} strong />
            <input
              type="range"
              min={0}
              max={40}
              value={controls.iterations}
              onChange={(event) =>
                setControls({ ...controls, iterations: Number(event.target.value) })
              }
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={controls.showCentres}
              onChange={(event) => setControls({ ...controls, showCentres: event.target.checked })}
            />
            <Text content="Cell centres" />
          </label>

          <Text content={`${grid.quads.length} cells, ${grid.vertices.length} vertices`} />
          <Text
            content="Drag relaxation to zero to see what the pairing alone produces: the irregularity is already there, and relaxation only makes the cells usable."
            tone="muted"
          />
        </div>
      </Card>
      <div
        ref={containerRef}
        style={{ minHeight: 520, border: "1px solid #d9d9d9", borderRadius: 8, overflow: "hidden" }}
      />
    </div>
  );
}
