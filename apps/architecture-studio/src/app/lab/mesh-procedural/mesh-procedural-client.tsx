"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Text } from "@grafting/ui";
import {
  createEngine,
  createVisualRegistry,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";

const MESH_LAYER = "mesh-layer";

interface MeshControls {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly primitive: number; // 0 = Passage, 1 = Boundary, 2 = Surface
  readonly deformationXY: number;
  readonly deformationZ: number;
  readonly wireframe: boolean;
}

const INITIAL: MeshControls = {
  width: 4,
  height: 4,
  layers: 2,
  primitive: 2,
  deformationXY: 0.4,
  deformationZ: 0.3,
  wireframe: true,
};

export default function MeshProceduralClient() {
  const [controls, setControls] = useState<MeshControls>(INITIAL);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  // Compute 3D prism grid vertices and triangles in TS / WebGL
  const meshData = useMemo(() => {
    const { width, height, layers, deformationXY, deformationZ } = controls;
    const vertCols = width + 1;
    const vertRows = height + 1;
    const layerVertCount = vertCols * vertRows;
    const totalVerts = layerVertCount * (layers + 1);

    const positions = new Float32Array(totalVerts * 3);

    for (let l = 0; l <= layers; l++) {
      const zBase = l * 1.5;
      for (let y = 0; y <= height; y++) {
        for (let x = 0; x <= width; x++) {
          const idx = (l * layerVertCount + y * vertCols + x) * 3;
          let px = (x - width / 2) * 1.2;
          let py = (y - height / 2) * 1.2;
          let pz = zBase;

          if (deformationXY > 0 && x > 0 && x < width && y > 0 && y < height) {
            px += Math.sin(x * 1.3 + y * 0.7) * 0.3 * deformationXY;
            py += Math.cos(x * 0.9 - y * 1.1) * 0.3 * deformationXY;
          }

          if (deformationZ > 0) {
            pz += Math.sin(x * 0.8 + y * 1.2 + l * 0.5) * 0.6 * deformationZ;
          }

          positions[idx] = px;
          positions[idx + 1] = py;
          positions[idx + 2] = pz;
        }
      }
    }

    // Build triangular faces for all cell quad faces
    const indicesList: number[] = [];
    for (let l = 0; l < layers; l++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const lOffset = l * layerVertCount;
          const nlOffset = (l + 1) * layerVertCount;

          const v0 = lOffset + y * vertCols + x;
          const v1 = lOffset + y * vertCols + (x + 1);
          const v2 = lOffset + (y + 1) * vertCols + (x + 1);
          const v3 = lOffset + (y + 1) * vertCols + x;

          const v4 = nlOffset + y * vertCols + x;
          const v5 = nlOffset + y * vertCols + (x + 1);
          const v6 = nlOffset + (y + 1) * vertCols + (x + 1);
          const v7 = nlOffset + (y + 1) * vertCols + x;

          // Bottom quad (v0, v1, v2, v3)
          indicesList.push(v0, v1, v2, v0, v2, v3);
          // Top quad (v4, v5, v6, v7)
          indicesList.push(v4, v6, v5, v4, v7, v6);
          // Lateral quads
          indicesList.push(v0, v4, v5, v0, v5, v1);
          indicesList.push(v1, v5, v6, v1, v6, v2);
          indicesList.push(v2, v6, v7, v2, v7, v3);
          indicesList.push(v3, v7, v4, v3, v4, v0);
        }
      }
    }

    return {
      positions,
      indices: new Uint32Array(indicesList),
      cellCount: width * height * layers,
    };
  }, [controls]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const registry = createVisualRegistry();
    registry.register({
      kind: "prism-surface",
      describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
        geometry: { shape: "mesh", data: { positions: params.positions, indices: params.indices } },
        material: {
          surface: "lit",
          color: 0x4a7c59,
          doubleSided: true,
          flatShading: true,
        },
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

    engine.scene.defineLayer({ id: MESH_LAYER, order: 0 }, "engine");

    const view = engine.createView({
      target: container,
      background: 0x111827,
      camera: {
        projection: "perspective",
        fov: 45,
        position: { x: 0, y: -10, z: 8 },
        target: { x: 0, y: 0, z: 1 },
      },
    });

    engineRef.current = engine;
    viewRef.current = view;

    const handleResize = () => {
      if (containerRef.current) {
        view.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    };
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
    const engine = engineRef.current;
    if (engine === null) return;

    engine.scene.setItem(
      "mesh-01",
      MESH_LAYER,
      "prism-surface",
      {
        positions: meshData.positions,
        indices: meshData.indices,
      },
      "engine",
    );
  }, [meshData]);

  return (
    <div style={{ display: "flex", gap: "16px", padding: "16px", minHeight: "80vh" }}>
      <div style={{ flex: "0 0 320px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <Card title="3D Mesh & Procedural Generator">
          <Text size="sm" color="subtle">
            Substrato de malha prismática de 6 slots com inputs genéricos de deformação planar (XY) e vertical (Z).
          </Text>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Deformação Planar XY: {controls.deformationXY.toFixed(2)}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={controls.deformationXY}
                onChange={(e) => setControls((prev) => ({ ...prev, deformationXY: parseFloat(e.target.value) }))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Deformação Vertical Z: {controls.deformationZ.toFixed(2)}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={controls.deformationZ}
                onChange={(e) => setControls((prev) => ({ ...prev, deformationZ: parseFloat(e.target.value) }))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Primitiva Graph Role</span>
              <select
                value={controls.primitive}
                onChange={(e) => setControls((prev) => ({ ...prev, primitive: parseInt(e.target.value, 10) }))}
                style={{ padding: "6px", borderRadius: "4px" }}
              >
                <option value={0}>Passage (0)</option>
                <option value={1}>Boundary (1)</option>
                <option value={2}>Surface (2)</option>
              </select>
            </label>

            <div style={{ padding: "8px", background: "rgba(0,0,0,0.05)", borderRadius: "4px", marginTop: "8px" }}>
              <Text size="xs">Células Totais: {meshData.cellCount}</Text>
              <Text size="xs">Vértices 3D: {meshData.positions.length / 3}</Text>
              <Text size="xs">Triângulos: {meshData.indices.length / 3}</Text>
            </div>
          </div>
        </Card>
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          borderRadius: "8px",
          overflow: "hidden",
          background: "#111827",
          position: "relative",
          minHeight: "500px",
        }}
      />
    </div>
  );
}
