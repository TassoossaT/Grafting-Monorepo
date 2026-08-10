"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Card, Text } from "@grafting/ui";
import {
  attachOrbit,
  createEngine,
  createVisualRegistry,
  orbitFromCamera,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";
export enum CellRole {
  Surface = 0,
  Boundary = 1,
  Passage = 2,
  Opening = 3,
}
import { writePreviewImage } from "../../../lab-preview-storage.ts";

const CANDIDATE = "vtt-brush";
const MAP_LAYER = "vtt-map-layer";

const CAMERA = {
  projection: "perspective" as const,
  fov: 45,
  position: { x: 8, y: 14, z: 12 },
  target: { x: 0, y: 0, z: 0 },
  far: 100,
};

export interface CellPatch {
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly previousRole: CellRole;
  readonly newRole: CellRole;
  readonly timestamp: number;
}

export type BrushMode = "wall" | "floor" | "passage" | "opening" | "erase";

interface GridState {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  // 3D cell roles grid: index = level * (width * height) + y * width + x
  readonly cells: Uint8Array;
}

const BRUSH_ROLE_MAP: Record<Exclude<BrushMode, "erase">, CellRole> = {
  wall: CellRole.Boundary,
  floor: CellRole.Surface,
  passage: CellRole.Passage,
  opening: CellRole.Opening,
};

const ROLE_COLORS: Record<CellRole, number> = {
  [CellRole.Surface]: 0x3b82f6,  // Blue Stone Floor
  [CellRole.Boundary]: 0xef4444, // Red Solid Wall
  [CellRole.Passage]: 0x10b981,  // Emerald Walkable Corridor
  [CellRole.Opening]: 0xf59e0b,  // Amber Doorway/Opening
};

const ROLE_NAMES: Record<CellRole, string> = {
  [CellRole.Surface]: "Surface (Floor)",
  [CellRole.Boundary]: "Boundary (Wall)",
  [CellRole.Passage]: "Passage (Corridor)",
  [CellRole.Opening]: "Opening (Door/Arch)",
};

export default function VttBrushClient() {
  const [width, setWidth] = useState<number>(8);
  const [height, setHeight] = useState<number>(8);
  const [levels, setLevels] = useState<number>(3);
  const [activeLevel, setActiveLevel] = useState<number>(1);
  const [clipLevel, setClipLevel] = useState<number>(3);
  const [brushMode, setBrushMode] = useState<BrushMode>("wall");
  const [brushSize, setBrushSize] = useState<1 | 3>(1);

  // Map state grid
  const [grid, setGrid] = useState<GridState>(() => {
    const size = 8 * 8 * 3;
    const cells = new Uint8Array(size);
    // Initialize ground level (level 0) as Surface floor
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        cells[y * 8 + x] = CellRole.Surface;
      }
    }
    // Add outer boundary walls on level 0
    for (let x = 0; x < 8; x++) {
      cells[0 * 8 + x] = CellRole.Boundary;
      cells[7 * 8 + x] = CellRole.Boundary;
    }
    for (let y = 0; y < 8; y++) {
      cells[y * 8 + 0] = CellRole.Boundary;
      cells[y * 8 + 7] = CellRole.Boundary;
    }
    // Add an opening door
    cells[3 * 8 + 0] = CellRole.Opening;
    return { width: 8, height: 8, levels: 3, cells };
  });

  // Undo / Redo patch stacks
  const [undoStack, setUndoStack] = useState<readonly CellPatch[]>([]);
  const [redoStack, setRedoStack] = useState<readonly CellPatch[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  // Apply a brush paint stroke at (x, y) on active level
  const applyPaintStroke = useCallback((targetX: number, targetY: number) => {
    setGrid((prev) => {
      const { width: w, height: h, levels: l, cells: prevCells } = prev;
      if (targetX < 0 || targetX >= w || targetY < 0 || targetY >= h) return prev;

      const targetRole = brushMode === "erase" ? CellRole.Surface : BRUSH_ROLE_MAP[brushMode];
      const nextCells = new Uint8Array(prevCells);
      const patches: CellPatch[] = [];

      const minX = brushSize === 3 ? Math.max(0, targetX - 1) : targetX;
      const maxX = brushSize === 3 ? Math.min(w - 1, targetX + 1) : targetX;
      const minY = brushSize === 3 ? Math.max(0, targetY - 1) : targetY;
      const maxY = brushSize === 3 ? Math.min(h - 1, targetY + 1) : targetY;

      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const idx = (activeLevel - 1) * (w * h) + cy * w + cx;
          const prevRole = nextCells[idx] as CellRole;
          if (prevRole !== targetRole) {
            nextCells[idx] = targetRole;
            patches.push({
              x: cx,
              y: cy,
              level: activeLevel,
              previousRole: prevRole,
              newRole: targetRole,
              timestamp: Date.now(),
            });
          }
        }
      }

      if (patches.length > 0) {
        setUndoStack((u) => [...u, ...patches]);
        setRedoStack([]);
      }

      return { width: w, height: h, levels: l, cells: nextCells };
    });
  }, [activeLevel, brushMode, brushSize]);

  // Undo last patch
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastPatch = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, lastPatch]);

    setGrid((prev) => {
      const nextCells = new Uint8Array(prev.cells);
      const idx = (lastPatch.level - 1) * (prev.width * prev.height) + lastPatch.y * prev.width + lastPatch.x;
      nextCells[idx] = lastPatch.previousRole;
      return { ...prev, cells: nextCells };
    });
  }, [undoStack]);

  // Redo last undone patch
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const patchToRedo = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, patchToRedo]);

    setGrid((prev) => {
      const nextCells = new Uint8Array(prev.cells);
      const idx = (patchToRedo.level - 1) * (prev.width * prev.height) + patchToRedo.y * prev.width + patchToRedo.x;
      nextCells[idx] = patchToRedo.newRole;
      return { ...prev, cells: nextCells };
    });
  }, [redoStack]);

  // Reset grid
  const handleClearMap = useCallback(() => {
    const size = width * height * levels;
    const cells = new Uint8Array(size);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        cells[y * width + x] = CellRole.Surface;
      }
    }
    setGrid({ width, height, levels, cells });
    setUndoStack([]);
    setRedoStack([]);
  }, [width, height, levels]);

  // Generate 3D geometry from current grid state with clip plane filtering (level <= clipLevel)
  const meshData = useMemo(() => {
    const { width: w, height: h, cells } = grid;
    const visibleLevels = Math.min(clipLevel, grid.levels);

    const positionsList: number[] = [];
    const indicesList: number[] = [];
    const colorsList: number[] = [];
    let vertCount = 0;

    const cellSize = 1.0;
    const halfW = (w * cellSize) / 2;
    const halfH = (h * cellSize) / 2;

    for (let l = 0; l < visibleLevels; l++) {
      const yLevelBase = l * 1.2;

      for (let cy = 0; cy < h; cy++) {
        for (let cx = 0; cx < w; cx++) {
          const idx = l * (w * h) + cy * w + cx;
          const role = cells[idx] as CellRole;
          const hexColor = ROLE_COLORS[role] ?? 0x3b82f6;

          // Convert hex color to RGB floats [0, 1]
          const r = ((hexColor >> 16) & 0xff) / 255;
          const g = ((hexColor >> 8) & 0xff) / 255;
          const b = (hexColor & 0xff) / 255;

          const minX = cx * cellSize - halfW;
          const maxX = (cx + 1) * cellSize - halfW;
          const minZ = cy * cellSize - halfH;
          const maxZ = (cy + 1) * cellSize - halfH;

          let minY = yLevelBase;
          let maxY = yLevelBase + (role === CellRole.Boundary ? 1.0 : role === CellRole.Opening ? 0.6 : 0.15);

          // 8 box vertices
          // 0: minX, minY, minZ
          // 1: maxX, minY, minZ
          // 2: maxX, minY, maxZ
          // 3: minX, minY, maxZ
          // 4: minX, maxY, minZ
          // 5: maxX, maxY, minZ
          // 6: maxX, maxY, maxZ
          // 7: minX, maxY, maxZ
          const v = [
            minX, minY, minZ,
            maxX, minY, minZ,
            maxX, minY, maxZ,
            minX, minY, maxZ,
            minX, maxY, minZ,
            maxX, maxY, minZ,
            maxX, maxY, maxZ,
            minX, maxY, maxZ,
          ];

          for (let i = 0; i < 8; i++) {
            positionsList.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
            colorsList.push(r, g, b);
          }

          const base = vertCount;
          // Quads: Top face (4,6,5, 4,7,6)
          indicesList.push(base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
          // Front, Back, Left, Right faces if solid block
          if (role === CellRole.Boundary || role === CellRole.Opening) {
            indicesList.push(base + 0, base + 1, base + 5, base + 0, base + 5, base + 4);
            indicesList.push(base + 1, base + 2, base + 6, base + 1, base + 6, base + 5);
            indicesList.push(base + 2, base + 3, base + 7, base + 2, base + 7, base + 6);
            indicesList.push(base + 3, base + 0, base + 4, base + 3, base + 4, base + 7);
          }

          vertCount += 8;
        }
      }
    }

    return {
      positions: new Float32Array(positionsList),
      indices: new Uint32Array(indicesList),
      colors: new Float32Array(colorsList),
    };
  }, [grid, clipLevel]);

  // Setup WebGL engine
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const registry = createVisualRegistry();
    registry.register({
      kind: "vtt-map-mesh",
      describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
        geometry: { shape: "mesh" as const, data: { positions: params.positions, indices: params.indices } },
        material: { surface: "lit" as const, color: 0x3b82f6, doubleSided: true, flatShading: true },
      }),
    });

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.9 },
        { light: "directional", intensity: 0.8, direction: { x: 5, y: 10, z: 6 } },
      ],
    });

    engine.scene.defineLayer({ id: MAP_LAYER, order: 0 }, "engine");

    const view = engine.createView({
      target: container,
      background: 0x0f172a,
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

  // Update render engine mesh when meshData updates
  useEffect(() => {
    const engine = engineRef.current;
    const view = viewRef.current;
    if (engine === null || view === null) return;

    engine.scene.put(
      {
        id: "vtt-map-mesh-01",
        layer: MAP_LAYER,
        visual: {
          kind: "vtt-map-mesh",
          params: {
            positions: meshData.positions,
            indices: meshData.indices,
          },
        },
      },
      "engine"
    );
    engine.frame(performance.now());
  }, [meshData]);

  // Capture canvas preview
  const handleCapturePreview = useCallback(() => {
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector("canvas");
      if (canvas) {
        const dataUrl = canvas.toDataURL("image/png");
        writePreviewImage(CANDIDATE, dataUrl);
      }
    }
  }, []);

  // Role counters
  const roleCounts = useMemo(() => {
    const counts = { [CellRole.Surface]: 0, [CellRole.Boundary]: 0, [CellRole.Passage]: 0, [CellRole.Opening]: 0 };
    for (let i = 0; i < grid.cells.length; i++) {
      const r = grid.cells[i] as CellRole;
      counts[r] = (counts[r] || 0) + 1;
    }
    return counts;
  }, [grid]);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, color: "#f8fafc" }}>
      <div>
        <Text content="VTT Interactive 3D Map Construction Brush (/lab/vtt-brush)" strong />
        <br />
        <Text
          content="Phase 4 implementation: Interactive 3D Brush tools (Wall, Floor, Corridor, Doorway, Erase), reactive CellStatePatch Undo/Redo, and Y-clip floor cutaway navigation."
          tone="muted"
        />
      </div>

      {/* Main split view: Left Control Panels, Center 3D Viewport & Interactive Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 280px", gap: 16 }}>
        {/* Left Toolbar Panel */}
        <Card ariaLabel="Brush Control Toolbar">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
            <Text content="1. Brush Tool Selection" strong />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(["wall", "floor", "passage", "opening", "erase"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setBrushMode(mode)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: brushMode === mode ? "2px solid #3b82f6" : "1px solid #334155",
                    backgroundColor: brushMode === mode ? "#1e293b" : "#0f172a",
                    color: brushMode === mode ? "#60a5fa" : "#94a3b8",
                    fontWeight: brushMode === mode ? "bold" : "normal",
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {mode === "wall" && "🧱 Wall"}
                  {mode === "floor" && "🟨 Floor"}
                  {mode === "passage" && "🟩 Corridor"}
                  {mode === "opening" && "🚪 Door"}
                  {mode === "erase" && "🧹 Erase"}
                </button>
              ))}
            </div>

            <Text content="2. Brush Size" strong />
            <div style={{ display: "flex", gap: 8 }}>
              {([1, 3] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setBrushSize(sz)}
                  style={{
                    flex: 1,
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: brushSize === sz ? "2px solid #3b82f6" : "1px solid #334155",
                    backgroundColor: brushSize === sz ? "#1e293b" : "#0f172a",
                    color: brushSize === sz ? "#60a5fa" : "#94a3b8",
                    cursor: "pointer",
                  }}
                >
                  {sz}x{sz} Brush
                </button>
              ))}
            </div>

            <Text content="3. Active Floor Level (Editing)" strong />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min={1}
                max={grid.levels}
                value={activeLevel}
                onChange={(e) => setActiveLevel(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontWeight: "bold", width: 60 }}>Lvl {activeLevel}</span>
            </div>

            <Text content="4. WebGL Floor Cutaway Shader (Clip Y <= Limit)" strong />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min={1}
                max={grid.levels}
                value={clipLevel}
                onChange={(e) => setClipLevel(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontWeight: "bold", width: 60 }}>Clip: {clipLevel}</span>
            </div>

            <Text content="5. History & Reactive Mutation Ledger" strong />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: undoStack.length > 0 ? "#3b82f6" : "#1e293b",
                  color: undoStack.length > 0 ? "#ffffff" : "#64748b",
                  cursor: undoStack.length > 0 ? "pointer" : "not-allowed",
                }}
              >
                ↰ Undo ({undoStack.length})
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: redoStack.length > 0 ? "#3b82f6" : "#1e293b",
                  color: redoStack.length > 0 ? "#ffffff" : "#64748b",
                  cursor: redoStack.length > 0 ? "pointer" : "not-allowed",
                }}
              >
                ↱ Redo ({redoStack.length})
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                onClick={handleClearMap}
                style={{
                  flex: 1,
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #dc2626",
                  backgroundColor: "#450a0a",
                  color: "#fca5a5",
                  cursor: "pointer",
                }}
              >
                Reset Map
              </button>
              <button
                onClick={handleCapturePreview}
                style={{
                  flex: 1,
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #059669",
                  backgroundColor: "#064e3b",
                  color: "#6ee7b7",
                  cursor: "pointer",
                }}
              >
                Capture Preview
              </button>
            </div>
          </div>
        </Card>

        {/* Center Canvas & Interactive 2D Grid Painting Canvas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 3D WebGL Viewport */}
          <div
            ref={containerRef}
            style={{
              width: "100%",
              height: "400px",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid #334155",
              position: "relative",
              backgroundColor: "#0f172a",
            }}
          />

          {/* Interactive 2D Painter Grid for Active Level */}
          <Card ariaLabel="2D Grid Brush Painter">
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text content={`Interactive Paint Grid (Level ${activeLevel}) — Click cells to paint`} strong />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Mode: {brushMode.toUpperCase()} ({brushSize}x{brushSize})</span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${grid.width}, 1fr)`,
                  gap: 2,
                  backgroundColor: "#1e293b",
                  padding: 4,
                  borderRadius: 6,
                  border: "1px solid #334155",
                  maxWidth: 500,
                  margin: "0 auto",
                }}
              >
                {Array.from({ length: grid.height }).map((_, gy) =>
                  Array.from({ length: grid.width }).map((_, gx) => {
                    const idx = (activeLevel - 1) * (grid.width * grid.height) + gy * grid.width + gx;
                    const role = grid.cells[idx] as CellRole;
                    const hex = ROLE_COLORS[role] ?? 0x3b82f6;
                    const colorCss = `#${hex.toString(16).padStart(6, "0")}`;

                    return (
                      <button
                        key={`${gx}-${gy}`}
                        onClick={() => applyPaintStroke(gx, gy)}
                        style={{
                          aspectRatio: "1",
                          backgroundColor: colorCss,
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 2,
                          cursor: "pointer",
                          transition: "transform 0.1s, filter 0.1s",
                        }}
                        title={`Cell (${gx}, ${gy}) Lvl ${activeLevel}: ${ROLE_NAMES[role]}`}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Right Stats & Patch Log Panel */}
        <Card ariaLabel="Patch Log and Metrics">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
            <Text content="6. Cell Role Breakdown" strong />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#60a5fa" }}>🟦 Surface (Floor):</span>
                <span>{roleCounts[CellRole.Surface]}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#f87171" }}>🟥 Boundary (Wall):</span>
                <span>{roleCounts[CellRole.Boundary]}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#34d399" }}>🟩 Passage (Corridor):</span>
                <span>{roleCounts[CellRole.Passage]}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#fbbf24" }}>🟨 Opening (Door):</span>
                <span>{roleCounts[CellRole.Opening]}</span>
              </div>
            </div>

            <Text content="7. Live Mutation Ledger Log" strong />
            <div
              style={{
                maxHeight: 280,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontFamily: "monospace",
                fontSize: 11,
                backgroundColor: "#0f172a",
                padding: 8,
                borderRadius: 6,
                border: "1px solid #1e293b",
              }}
            >
              {undoStack.length === 0 ? (
                <span style={{ color: "#64748b" }}>No patches applied yet. Click grid to paint walls/doors.</span>
              ) : (
                [...undoStack].reverse().slice(0, 15).map((p, i) => (
                  <div key={`${p.timestamp}-${i}`} style={{ color: "#cbd5e1" }}>
                    Patch #{undoStack.length - i}: L{p.level} ({p.x},{p.y}) &rarr; {ROLE_NAMES[p.newRole].split(" ")[0]}
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
