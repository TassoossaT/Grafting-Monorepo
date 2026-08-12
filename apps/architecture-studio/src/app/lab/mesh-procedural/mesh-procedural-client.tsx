"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Text } from "@grafting/ui";
import {
  attachOrbit,
  createEngine,
  createVisualRegistry,
  orbitFromCamera,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";
import { writePreviewImage } from "../../../lab-preview-storage.ts";


const CANDIDATE = "mesh-procedural";
const MESH_LAYER = "mesh-layer";

const CAMERA = {
  projection: "perspective" as const,
  fov: 45,
  position: { x: 4, y: 10, z: 8 },
  target: { x: 0, y: 0, z: 0.5 },
  far: 100,
};

interface MeshControls {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly primitive: number; // 0 = Passage, 1 = Boundary, 2 = Surface
  readonly deformationXY: number;
  readonly deformationZ: number;
  readonly vertexShiftX: number; // Freeform corner X shift (Trapézio)
  readonly vertexShiftY: number; // Freeform corner Y shift (Enviesamento)
  readonly vertexShiftZ: number; // Freeform corner Z shift (Triângulo / Rampa / Cunha)
  readonly renderMode: "surface-patches" | "volumetric";
}

const INITIAL: MeshControls = {
  width: 4,
  height: 4,
  layers: 1,
  primitive: 2,
  deformationXY: 0.0,
  deformationZ: 0.0,
  vertexShiftX: 0.0,
  vertexShiftY: 0.0,
  vertexShiftZ: 0.0,
  renderMode: "surface-patches",
};


export default function MeshProceduralClient() {
  const [controls, setControls] = useState<MeshControls>(INITIAL);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  // Compute 3D prism grid vertices and triangles in TS / WebGL
  const meshData = useMemo(() => {
    const { width, height, layers: rawLayers, primitive, deformationXY, deformationZ, vertexShiftX, vertexShiftY, vertexShiftZ, renderMode } = controls;
    const layers = renderMode === "surface-patches" ? 1 : rawLayers;
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

          // Standard ground plan coordinates (gx, gy)
          let gx = (x - width / 2) * 1.2;
          let gy = (y - height / 2) * 1.2;
          let gz = zBase;

          // 1. Freeform corner vertex manipulation (DEC-060 Geometria Livre em Coordenadas de Mundo)
          // Shifts corner vertices to form Trapezoids, Triangles, Wedges, and Slanted Ramps
          const cornerFactorX = x / width;
          const cornerFactorY = y / height;
          gx += cornerFactorX * cornerFactorY * vertexShiftX;
          gy += cornerFactorX * cornerFactorY * vertexShiftY;
          if (l > 0) {
            gz += cornerFactorX * cornerFactorY * vertexShiftZ;
          }

          // 2. Planar XY deformation (strictly 0 when deformationXY = 0)
          if (deformationXY > 0 && x > 0 && x < width && y > 0 && y < height) {
            gx += Math.sin(x * 1.3 + y * 0.7) * 0.4 * deformationXY;
            gy += Math.cos(x * 0.9 - y * 1.1) * 0.4 * deformationXY;
          }

          // 3. Vertical Z deformation and topological shaping (strictly 0 when deformationZ = 0)
          if (deformationZ > 0) {
            if (primitive === 0) {
              // PASSAGE (0): Corridor / Walkable Channel. Flat walkable floor in the center, side walls at edges.
              const normX = Math.abs((x - width / 2) / (width / 2));
              const corridorSideWall = normX > 0.4 ? (normX - 0.4) * 2.5 : 0;
              gz += corridorSideWall * deformationZ;
            } else if (primitive === 1) {

              // BOUNDARY (1): Jagged Wall / Cliff boundary. Stepped vertical wall blocks.
              const step = Math.floor(x / 2) * 1.4;
              gz += (step + Math.sin(x * 3.1 + y * 2.7) * 0.6) * deformationZ;
            } else {
              // SURFACE (2): Continuous Rolling Terrain hill slopes
              gz += (Math.sin(x * 0.8) + Math.cos(y * 0.8)) * 0.8 * deformationZ;
            }
          }

          // Map World (gx, gy, gz) -> Three.js (X = gx, Y = gz [UP], Z = gy [DEPTH])
          positions[idx] = gx;
          positions[idx + 1] = gz; // Three.js Y is UP
          positions[idx + 2] = gy;
        }
      }
    }

    // Build triangular faces for surface patches
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

          if (controls.renderMode === "surface-patches") {
            // Pure Surface Mesh: ONLY top surface quads (zero side walls, zero skirts, zero vertical faces)
            indicesList.push(v4, v6, v5, v4, v7, v6);
          } else {

            // Volumetric Closed Solid Mode
            indicesList.push(v0, v1, v2, v0, v2, v3); // Bottom quad
            indicesList.push(v4, v6, v5, v4, v7, v6); // Top quad
            indicesList.push(v0, v4, v5, v0, v5, v1);
            indicesList.push(v1, v5, v6, v1, v6, v2);
            indicesList.push(v2, v6, v7, v2, v7, v3);
            indicesList.push(v3, v7, v4, v3, v4, v0);
          }
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
    const surfaceKind = (kindName: string, color: number) => ({
      kind: kindName,
      describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
        geometry: { shape: "mesh" as const, data: { positions: params.positions, indices: params.indices } },
        material: { surface: "lit" as const, color, doubleSided: true, flatShading: true },
      }),
    });

    registry.register(surfaceKind("prism-passage", 0x3498db));  // Blue
    registry.register(surfaceKind("prism-boundary", 0x7f8c8d)); // Dark Slate Wall
    registry.register(surfaceKind("prism-surface", 0x4a7c59));  // Green Floor

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.85 },
        { light: "directional", intensity: 0.8, direction: { x: 4, y: 8, z: 5 } },
      ],
    });

    engine.scene.defineLayer({ id: MESH_LAYER, order: 0 }, "engine");

    const view = engine.createView({
      target: container,
      background: 0x111827,
      camera: CAMERA,
    });

    engineRef.current = engine;
    viewRef.current = view;

    const detachOrbit = attachOrbit(container, view, orbitFromCamera(CAMERA.position, CAMERA.target), {
      fov: CAMERA.fov,
      far: CAMERA.far,
      onChange: () => engine.frame(performance.now()),
    });

    const handleResize = () => {
      if (containerRef.current) {
        view.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        engine.frame(performance.now());
      }
    };
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

  useEffect(() => {
    const engine = engineRef.current;
    const view = viewRef.current;
    if (engine === null || view === null) return;

    const kindMap: Record<number, string> = {
      0: "prism-passage",
      1: "prism-boundary",
      2: "prism-surface",
    };

    const visualKind = kindMap[controls.primitive] ?? "prism-surface";

    engine.scene.put(
      {
        id: "mesh-01",
        layer: MESH_LAYER,
        visual: {
          kind: visualKind,
          params: {
            positions: meshData.positions,
            indices: meshData.indices,
          },
        },
      },
      "local",
    );

    engine.frame(performance.now());
    writePreviewImage(CANDIDATE, view.capture("image/png"));
  }, [meshData, controls.primitive]);

  const shapeType = useMemo(() => {
    const { vertexShiftX, vertexShiftY, vertexShiftZ } = controls;
    if (vertexShiftZ !== 0 && vertexShiftX !== 0) return "Cunha / Triângulo 3D Inclinado";
    if (vertexShiftZ !== 0) return "Rampa / Cunha 3D (Triangular Z)";
    if (vertexShiftX !== 0 || vertexShiftY !== 0) return "Trapézio / Polígono Irregular";
    return "Paralelepípedo Prismático Reto";
  }, [controls]);

  return (
    <div style={{ display: "flex", gap: "16px", padding: "16px", minHeight: "80vh" }}>
      <div style={{ flex: "0 0 340px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <Card ariaLabel="3D Mesh Parameters">
          <Text content="3D Mesh & Freeform Generator" strong />
          <div style={{ marginTop: "4px" }}>
            <Text content="Geometria Livre (DEC-060 / ADR-0022): Mova os vértices para criar Trapézios, Triângulos, Rampas e Polígonos no espaço 3D." tone="muted" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            <div style={{ padding: "8px", background: "rgba(52, 152, 219, 0.15)", borderRadius: "4px" }}>
              <Text content={`Forma Geométrica: ${shapeType}`} strong />
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Deslocar Canto X (Trapézio): {controls.vertexShiftX.toFixed(2)}</span>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={controls.vertexShiftX}
                onChange={(e) => setControls((prev) => ({ ...prev, vertexShiftX: parseFloat(e.target.value) }))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Deslocar Canto Y (Enviesamento): {controls.vertexShiftY.toFixed(2)}</span>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={controls.vertexShiftY}
                onChange={(e) => setControls((prev) => ({ ...prev, vertexShiftY: parseFloat(e.target.value) }))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Deslocar Canto Z (Triângulo / Rampa / Cunha): {controls.vertexShiftZ.toFixed(2)}</span>
              <input
                type="range"
                min="-3"
                max="3"
                step="0.1"
                value={controls.vertexShiftZ}
                onChange={(e) => setControls((prev) => ({ ...prev, vertexShiftZ: parseFloat(e.target.value) }))}
              />
            </label>

            <hr style={{ border: 0, borderTop: "1px solid rgba(0,0,0,0.1)", margin: "4px 0" }} />

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
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Modo de Representação</span>
              <select
                value={controls.renderMode}
                onChange={(e) => setControls((prev) => ({ ...prev, renderMode: e.target.value as "surface-patches" | "volumetric" }))}
                style={{ padding: "6px", borderRadius: "4px", background: "#f8fafc", border: "1px solid #cbd5e1" }}
              >
                <option value="surface-patches">Malhas de Superfície Indep. (Superfícies)</option>
                <option value="volumetric">Blocos Prismáticos Fechados (Sólido)</option>
              </select>
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
              <Text content={`Células Totais: ${meshData.cellCount}`} />
              <Text content={`Vértices 3D: ${meshData.positions.length / 3}`} />
              <Text content={`Triângulos: ${meshData.indices.length / 3}`} />
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

