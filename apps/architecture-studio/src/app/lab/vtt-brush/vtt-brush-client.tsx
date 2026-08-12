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

// Centralized helper for 3D cell index calculation
export function cellIndex(x: number, y: number, level: number, width: number, height: number): number {
  const lvlIdx = Math.max(0, level - 1);
  return lvlIdx * (width * height) + y * width + x;
}

// Distance from point (px, pz) to line segment (x1, z1)-(x2, z2) in world space
export function distanceToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.0001) return Math.hypot(px - x1, pz - z1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const projX = x1 + t * dx;
  const projZ = z1 + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

// DEC-060 & ADR-0022: Per-cell terrain floor module surface assignment
export enum TerrainSurfaceKind {
  StoneFloor = 0,
  WoodDeck = 1,
  DirtGround = 2,
  GrassTile = 3,
}

// DEC-060 & ADR-0022: Free-geometry boundary kind carrying behavioral flags
export type BoundaryKind = "wall" | "door" | "window" | "opening";

export interface Vec3World {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// DEC-060 & ADR-0022: BoundarySegment stored as free geometry in world coordinates with a stable id
export interface BoundarySegment {
  readonly id: string; // Stable UUID/string id, NEVER a CellId or grid index
  readonly level: number;
  readonly start: Vec3World; // World coordinate start position
  readonly end: Vec3World;   // World coordinate end position
  readonly height: number;  // Vertical extent in world units
  readonly kind: BoundaryKind;
  readonly blocksMovement: boolean;
  readonly blocksVision: boolean;
}

// Terrain cell patch for individual cell edits
export interface TerrainCellPatch {
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly previousSurface: TerrainSurfaceKind;
  readonly newSurface: TerrainSurfaceKind;
}

// Terrain stroke patch grouping full brush stroke
export interface TerrainStrokePatch {
  readonly type: "terrain-stroke";
  readonly patches: readonly TerrainCellPatch[];
  readonly timestamp: number;
}

// Free-geometry boundary patch for walls/doors (keyed by stable segment ID)
export interface BoundaryPatch {
  readonly type: "boundary";
  readonly id: string; // Segment ID
  readonly action: "add" | "remove";
  readonly segment: BoundarySegment;
  readonly timestamp: number;
}

export type HistoryAction = TerrainStrokePatch | BoundaryPatch;

export type ToolMode = "wall" | "door" | "window" | "opening" | "floor" | "erase";

// Registered 3D visual kinds mapping
const VISUAL_KINDS: Record<string, { kind: string; color: number }> = {
  "stone-floor": { kind: "vtt-stone-floor", color: 0x3b82f6 },
  "wood-deck": { kind: "vtt-wood-deck", color: 0x854d0e },
  "dirt-ground": { kind: "vtt-dirt-ground", color: 0x78350f },
  "grass-tile": { kind: "vtt-grass-tile", color: 0x15803d },
  wall: { kind: "vtt-boundary-wall", color: 0xdc2626 },
  door: { kind: "vtt-boundary-door", color: 0xf59e0b },
  window: { kind: "vtt-boundary-window", color: 0x06b6d4 },
  opening: { kind: "vtt-boundary-opening", color: 0x64748b },
};

const SURFACE_KIND_KEYS: Record<TerrainSurfaceKind, string> = {
  [TerrainSurfaceKind.StoneFloor]: "stone-floor",
  [TerrainSurfaceKind.WoodDeck]: "wood-deck",
  [TerrainSurfaceKind.DirtGround]: "dirt-ground",
  [TerrainSurfaceKind.GrassTile]: "grass-tile",
};

const SURFACE_COLORS: Record<TerrainSurfaceKind, number> = {
  [TerrainSurfaceKind.StoneFloor]: 0x3b82f6, // Blue Stone
  [TerrainSurfaceKind.WoodDeck]: 0x854d0e,   // Brown Wood
  [TerrainSurfaceKind.DirtGround]: 0x78350f, // Dark Dirt
  [TerrainSurfaceKind.GrassTile]: 0x15803d,  // Green Grass
};

const BOUNDARY_COLORS: Record<BoundaryKind, number> = {
  wall: 0xdc2626,    // Crimson Wall
  door: 0xf59e0b,    // Amber Door
  window: 0x06b6d4,  // Cyan Window
  opening: 0x64748b, // Archway Gray
};

const BOUNDARY_HEIGHTS: Record<BoundaryKind, number> = {
  wall: 1.2,
  door: 1.0,
  window: 0.8,
  opening: 1.2,
};

export default function VttBrushClient() {
  const [width, setWidth] = useState<number>(8);
  const [height, setHeight] = useState<number>(8);
  const [levels, setLevels] = useState<number>(3);
  const [activeLevel, setActiveLevel] = useState<number>(1);
  const [clipLevel, setClipLevel] = useState<number>(3);
  const [toolMode, setToolMode] = useState<ToolMode>("wall");
  const [brushSize, setBrushSize] = useState<1 | 3>(1);
  const [activeSurface, setActiveSurface] = useState<TerrainSurfaceKind>(TerrainSurfaceKind.StoneFloor);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);

  // Per-cell terrain floor grid: indexed via cellIndex(x, y, level, width, height)
  const [terrainGrid, setTerrainGrid] = useState<Uint8Array>(() => {
    const cells = new Uint8Array(8 * 8 * 3);
    cells.fill(TerrainSurfaceKind.StoneFloor);
    return cells;
  });

  // Free-geometry boundary segments stored in world space with stable IDs (ADR-0022)
  const [boundaries, setBoundaries] = useState<readonly BoundarySegment[]>(() => {
    const initialSegments: BoundarySegment[] = [
      {
        id: "b-outer-north",
        level: 1,
        start: { x: -4, y: 0, z: -4 },
        end: { x: 4, y: 0, z: -4 },
        height: 1.2,
        kind: "wall",
        blocksMovement: true,
        blocksVision: true,
      },
      {
        id: "b-outer-west",
        level: 1,
        start: { x: -4, y: 0, z: -4 },
        end: { x: -4, y: 0, z: 4 },
        height: 1.2,
        kind: "wall",
        blocksMovement: true,
        blocksVision: true,
      },
      {
        id: "b-door-south",
        level: 1,
        start: { x: -1, y: 0, z: 4 },
        end: { x: 1, y: 0, z: 4 },
        height: 1.0,
        kind: "door",
        blocksMovement: true,
        blocksVision: false,
      },
      {
        id: "b-window-east",
        level: 1,
        start: { x: 4, y: 0, z: -2 },
        end: { x: 4, y: 0, z: 2 },
        height: 0.8,
        kind: "window",
        blocksMovement: true,
        blocksVision: false,
      },
    ];
    return initialSegments;
  });

  // Drawing state for free-geometry boundary placement
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);

  // Unified Undo/Redo stack for both terrain stroke patches and boundary patches
  const [undoStack, setUndoStack] = useState<readonly HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<readonly HistoryAction[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  // Ref tracking previous grid dimensions for accurate sequential resizing
  const prevDimsRef = useRef<{ width: number; height: number; levels: number }>({
    width: 8,
    height: 8,
    levels: 3,
  });

  // Resize terrain grid buffer when width, height, or levels change
  useEffect(() => {
    const prevDims = prevDimsRef.current;
    if (prevDims.width === width && prevDims.height === height && prevDims.levels === levels) {
      return;
    }

    setTerrainGrid((prev) => {
      const newSize = width * height * levels;
      const next = new Uint8Array(newSize);
      next.fill(TerrainSurfaceKind.StoneFloor);

      const minL = Math.min(levels, prevDims.levels);
      const minH = Math.min(height, prevDims.height);
      const minW = Math.min(width, prevDims.width);

      for (let l = 1; l <= minL; l++) {
        for (let y = 0; y < minH; y++) {
          for (let x = 0; x < minW; x++) {
            const oldIdx = cellIndex(x, y, l, prevDims.width, prevDims.height);
            const newIdx = cellIndex(x, y, l, width, height);
            if (oldIdx < prev.length) {
              next[newIdx] = prev[oldIdx];
            }
          }
        }
      }
      return next;
    });

    prevDimsRef.current = { width, height, levels };
  }, [width, height, levels]);

  // Auto-clamp activeLevel and clipLevel when levels setting decreases
  useEffect(() => {
    if (activeLevel > levels) setActiveLevel(levels);
    if (clipLevel > levels) setClipLevel(levels);
  }, [levels, activeLevel, clipLevel]);

  // Handle terrain floor painting with stroke batching and no updater side-effects
  const handleCellClick = useCallback((cx: number, cy: number) => {
    if (toolMode !== "floor") return;

    const minX = brushSize === 3 ? Math.max(0, cx - 1) : cx;
    const maxX = brushSize === 3 ? Math.min(width - 1, cx + 1) : cx;
    const minY = brushSize === 3 ? Math.max(0, cy - 1) : cy;
    const maxY = brushSize === 3 ? Math.min(height - 1, cy + 1) : cy;

    const cellPatches: TerrainCellPatch[] = [];
    const nextGrid = new Uint8Array(terrainGrid);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const idx = cellIndex(px, py, activeLevel, width, height);
        const prevKind = nextGrid[idx] as TerrainSurfaceKind;
        if (prevKind !== activeSurface) {
          nextGrid[idx] = activeSurface;
          cellPatches.push({
            x: px,
            y: py,
            level: activeLevel,
            previousSurface: prevKind,
            newSurface: activeSurface,
          });
        }
      }
    }

    if (cellPatches.length > 0) {
      const strokePatch: TerrainStrokePatch = {
        type: "terrain-stroke",
        patches: cellPatches,
        timestamp: Date.now(),
      };

      setTerrainGrid(nextGrid);
      setUndoStack((u) => [...u, strokePatch]);
      setRedoStack([]);
    }
  }, [activeLevel, activeSurface, brushSize, height, terrainGrid, toolMode, width]);

  // Handle free-geometry boundary drawing and instant single-click erasing
  const handleNodeClick = useCallback((nx: number, ny: number) => {
    if (toolMode === "floor") return;

    const cellSize = 1.0;
    const halfW = (width * cellSize) / 2;
    const halfH = (height * cellSize) / 2;
    const clickWorldX = snapToGrid ? nx * cellSize - halfW : nx;
    const clickWorldZ = snapToGrid ? ny * cellSize - halfH : ny;

    if (toolMode === "erase") {
      // Single-click erase: find closest segment on activeLevel matching click point or line
      let closest: BoundarySegment | null = null;
      let minDistance = 0.8; // Distance threshold in world units

      for (const b of boundaries) {
        if (b.level !== activeLevel) continue;
        const dist = distanceToSegment(clickWorldX, clickWorldZ, b.start.x, b.start.z, b.end.x, b.end.z);
        if (dist < minDistance) {
          minDistance = dist;
          closest = b;
        }
      }

      if (closest !== null) {
        const patch: BoundaryPatch = {
          type: "boundary",
          id: closest.id,
          action: "remove",
          segment: closest,
          timestamp: Date.now(),
        };
        setBoundaries((prev) => prev.filter((b) => b.id !== closest!.id));
        setUndoStack((u) => [...u, patch]);
        setRedoStack([]);
      }
      setDrawStart(null);
      return;
    }

    // 2-step click drawing for boundary segments (wall / door / window / opening)
    if (drawStart === null) {
      setDrawStart({ x: nx, y: ny });
    } else {
      if (drawStart.x !== nx || drawStart.y !== ny) {
        const worldStartX = snapToGrid ? drawStart.x * cellSize - halfW : drawStart.x;
        const worldStartZ = snapToGrid ? drawStart.y * cellSize - halfH : drawStart.y;
        const worldEndX = clickWorldX;
        const worldEndZ = clickWorldZ;

        const levelY = (activeLevel - 1) * 1.2;
        const kind = toolMode;
        const segId = `b-seg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const newSegment: BoundarySegment = {
          id: segId,
          level: activeLevel,
          start: { x: worldStartX, y: levelY, z: worldStartZ },
          end: { x: worldEndX, y: levelY, z: worldEndZ },
          height: BOUNDARY_HEIGHTS[kind] ?? 1.2,
          kind,
          blocksMovement: kind === "wall" || kind === "door" || kind === "window",
          blocksVision: kind === "wall",
        };

        const patch: BoundaryPatch = {
          type: "boundary",
          id: newSegment.id,
          action: "add",
          segment: newSegment,
          timestamp: Date.now(),
        };
        setBoundaries((prev) => [...prev, newSegment]);
        setUndoStack((u) => [...u, patch]);
        setRedoStack([]);
      }
      setDrawStart(null);
    }
  }, [activeLevel, boundaries, drawStart, height, snapToGrid, toolMode, width]);

  // Undo action: reverts entire stroke or boundary patch at once
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, lastAction]);

    if (lastAction.type === "terrain-stroke") {
      const next = new Uint8Array(terrainGrid);
      for (const patch of lastAction.patches) {
        const idx = cellIndex(patch.x, patch.y, patch.level, width, height);
        next[idx] = patch.previousSurface;
      }
      setTerrainGrid(next);
    } else {
      if (lastAction.action === "add") {
        setBoundaries((prev) => prev.filter((b) => b.id !== lastAction.id));
      } else {
        setBoundaries((prev) => [...prev, lastAction.segment]);
      }
    }
  }, [height, terrainGrid, undoStack, width]);

  // Redo action
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const actionToRedo = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, actionToRedo]);

    if (actionToRedo.type === "terrain-stroke") {
      const next = new Uint8Array(terrainGrid);
      for (const patch of actionToRedo.patches) {
        const idx = cellIndex(patch.x, patch.y, patch.level, width, height);
        next[idx] = patch.newSurface;
      }
      setTerrainGrid(next);
    } else {
      if (actionToRedo.action === "add") {
        setBoundaries((prev) => [...prev, actionToRedo.segment]);
      } else {
        setBoundaries((prev) => prev.filter((b) => b.id !== actionToRedo.id));
      }
    }
  }, [height, redoStack, terrainGrid, width]);

  // Reset map
  const handleResetMap = useCallback(() => {
    setTerrainGrid(new Uint8Array(width * height * levels));
    setBoundaries([]);
    setUndoStack([]);
    setRedoStack([]);
    setDrawStart(null);
  }, [width, height, levels]);

  // Build 3D mesh data partitioned by visual kind for distinct WebGL material colors
  const meshDataByKind = useMemo(() => {
    const visibleLevels = Math.min(clipLevel, levels);
    const cellSize = 1.0;
    const halfW = (width * cellSize) / 2;
    const halfH = (height * cellSize) / 2;

    const map: Record<string, { positions: number[]; indices: number[] }> = {};
    for (const key of Object.keys(VISUAL_KINDS)) {
      map[key] = { positions: [], indices: [] };
    }

    // 1. Terrain floor surface quads grouped by surface material kind
    for (let l = 1; l <= visibleLevels; l++) {
      const yBase = (l - 1) * 1.2;

      for (let cy = 0; cy < height; cy++) {
        for (let cx = 0; cx < width; cx++) {
          const idx = cellIndex(cx, cy, l, width, height);
          const surfaceKind = (terrainGrid[idx] ?? TerrainSurfaceKind.StoneFloor) as TerrainSurfaceKind;
          const key = SURFACE_KIND_KEYS[surfaceKind] ?? "stone-floor";
          const group = map[key];

          const minX = cx * cellSize - halfW;
          const maxX = (cx + 1) * cellSize - halfW;
          const minZ = cy * cellSize - halfH;
          const maxZ = (cy + 1) * cellSize - halfH;

          const base = group.positions.length / 3;
          group.positions.push(
            minX, yBase, minZ,
            maxX, yBase, minZ,
            maxX, yBase, maxZ,
            minX, yBase, maxZ
          );
          group.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
    }

    // 2. Free-geometry boundary segment boxes grouped by boundary kind
    const visibleBoundaries = boundaries.filter((b) => b.level <= visibleLevels);
    for (const seg of visibleBoundaries) {
      const group = map[seg.kind] ?? map["wall"];
      const { start, end, height: wallH } = seg;
      const thickness = 0.15;

      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.001) continue;

      const nx = (-dz / len) * (thickness / 2);
      const nz = (dx / len) * (thickness / 2);

      const y0 = start.y;
      const y1 = start.y + wallH;

      const p0 = [start.x + nx, y0, start.z + nz];
      const p1 = [start.x - nx, y0, start.z - nz];
      const p2 = [end.x - nx, y0, end.z - nz];
      const p3 = [end.x + nx, y0, end.z + nz];

      const p4 = [start.x + nx, y1, start.z + nz];
      const p5 = [start.x - nx, y1, start.z - nz];
      const p6 = [end.x - nx, y1, end.z - nz];
      const p7 = [end.x + nx, y1, end.z + nz];

      const base = group.positions.length / 3;
      group.positions.push(...p0, ...p1, ...p2, ...p3, ...p4, ...p5, ...p6, ...p7);

      group.indices.push(base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
      group.indices.push(base + 0, base + 1, base + 5, base + 0, base + 5, base + 4);
      group.indices.push(base + 1, base + 2, base + 6, base + 1, base + 6, base + 5);
      group.indices.push(base + 2, base + 3, base + 7, base + 2, base + 7, base + 6);
      group.indices.push(base + 3, base + 0, base + 4, base + 3, base + 4, base + 7);
    }

    const result: Record<string, { positions: Float32Array; indices: Uint32Array }> = {};
    for (const [k, v] of Object.entries(map)) {
      result[k] = {
        positions: new Float32Array(v.positions),
        indices: new Uint32Array(v.indices),
      };
    }
    return result;
  }, [boundaries, clipLevel, height, levels, terrainGrid, width]);

  // Setup WebGL rendering engine with all registered visual kinds
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const registry = createVisualRegistry();
    for (const info of Object.values(VISUAL_KINDS)) {
      registry.register({
        kind: info.kind,
        describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
          geometry: { shape: "mesh" as const, data: { positions: params.positions, indices: params.indices } },
          material: { surface: "lit" as const, color: info.color, doubleSided: true, flatShading: true },
        }),
      });
    }

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.9 },
        { light: "directional", intensity: 0.85, direction: { x: 5, y: 10, z: 6 } },
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

  // Update WebGL scene items per visual kind when meshDataByKind updates
  useEffect(() => {
    const engine = engineRef.current;
    const view = viewRef.current;
    if (engine === null || view === null) return;

    for (const [key, data] of Object.entries(meshDataByKind)) {
      const info = VISUAL_KINDS[key];
      if (!info) continue;

      if (data.positions.length > 0) {
        engine.scene.put(
          {
            id: `vtt-mesh-${key}`,
            layer: MAP_LAYER,
            visual: {
              kind: info.kind,
              params: {
                positions: data.positions,
                indices: data.indices,
              },
            },
          },
          "engine"
        );
      } else {
        engine.scene.remove(`vtt-mesh-${key}`, "engine");
      }
    }
    engine.frame(performance.now());
  }, [meshDataByKind]);

  // Capture canvas preview using view.capture() API
  const handleCapturePreview = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      const dataUrl = view.capture();
      writePreviewImage(CANDIDATE, dataUrl);
    }
  }, []);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, color: "#f8fafc" }}>
      <div>
        <Text content="VTT Free-Geometry Boundary & Construction Studio (/lab/vtt-brush)" strong />
        <br />
        <Text
          content="ADR-0022 & DEC-060 Compliant: Free-geometry boundary segments (walls/doors/windows) in world coordinates with grid snapping, per-cell terrain modules, and reactive Undo/Redo."
          tone="muted"
        />
      </div>

      {/* Main layout: Controls Toolbar (Left), 3D Viewport & 2D Vector Canvas (Center), Metrics & Log (Right) */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 280px", gap: 16 }}>
        {/* Left Toolbar */}
        <Card ariaLabel="Construction Toolbar">
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
            <Text content="1. Tool Selection" strong />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {(["wall", "door", "window", "opening", "floor", "erase"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setToolMode(mode);
                    setDrawStart(null);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: toolMode === mode ? "2px solid #3b82f6" : "1px solid #334155",
                    backgroundColor: toolMode === mode ? "#1e293b" : "#0f172a",
                    color: toolMode === mode ? "#60a5fa" : "#94a3b8",
                    fontWeight: toolMode === mode ? "bold" : "normal",
                    cursor: "pointer",
                    textTransform: "capitalize",
                    fontSize: 13,
                  }}
                >
                  {mode === "wall" && "🧱 Wall"}
                  {mode === "door" && "🚪 Door"}
                  {mode === "window" && "🪟 Window"}
                  {mode === "opening" && "🏛️ Archway"}
                  {mode === "floor" && "🟨 Floor"}
                  {mode === "erase" && "🧹 Erase"}
                </button>
              ))}
            </div>

            {toolMode === "floor" && (
              <>
                <Text content="2. Terrain Floor Material & Brush Size" strong />
                <select
                  value={activeSurface}
                  onChange={(e) => setActiveSurface(Number(e.target.value) as TerrainSurfaceKind)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    backgroundColor: "#0f172a",
                    color: "#f8fafc",
                    border: "1px solid #334155",
                  }}
                >
                  <option value={TerrainSurfaceKind.StoneFloor}>🟦 Stone Floor</option>
                  <option value={TerrainSurfaceKind.WoodDeck}>🪵 Wood Deck</option>
                  <option value={TerrainSurfaceKind.DirtGround}>🟤 Dirt Ground</option>
                  <option value={TerrainSurfaceKind.GrassTile}>🟩 Grass Surface</option>
                </select>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {([1, 3] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setBrushSize(sz)}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: brushSize === sz ? "2px solid #3b82f6" : "1px solid #334155",
                        backgroundColor: brushSize === sz ? "#1e293b" : "#0f172a",
                        color: brushSize === sz ? "#60a5fa" : "#94a3b8",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      {sz}x{sz} Brush
                    </button>
                  ))}
                </div>
              </>
            )}

            <Text content="3. Map Grid Dimensions (Interactive)" strong />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 60 }}>Width:</span>
                <input
                  type="range"
                  min={4}
                  max={16}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontWeight: "bold", width: 30 }}>{width}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 60 }}>Height:</span>
                <input
                  type="range"
                  min={4}
                  max={16}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontWeight: "bold", width: 30 }}>{height}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 60 }}>Levels:</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={levels}
                  onChange={(e) => setLevels(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontWeight: "bold", width: 30 }}>{levels}</span>
              </div>
            </div>

            <Text content="4. Floor Level Navigation & Clip Plane Shader" strong />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              {/* Edit Level Selector */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Edit Active Level: <strong>L{activeLevel}</strong></span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Level 1..{levels}</span>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {Array.from({ length: levels }).map((_, idx) => {
                    const lvl = idx + 1;
                    const isActive = activeLevel === lvl;
                    return (
                      <button
                        key={`edit-lvl-${lvl}`}
                        onClick={() => setActiveLevel(lvl)}
                        style={{
                          flex: 1,
                          minWidth: 36,
                          padding: "6px 4px",
                          borderRadius: 6,
                          border: isActive ? "2px solid #3b82f6" : "1px solid #334155",
                          backgroundColor: isActive ? "#1e293b" : "#0f172a",
                          color: isActive ? "#60a5fa" : "#94a3b8",
                          fontWeight: isActive ? "bold" : "normal",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        L{lvl}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3D Clip Selector */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>3D Clip Shader Cutaway: <strong>Y &le; {clipLevel}</strong></span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Vis: L1..L{clipLevel}</span>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {Array.from({ length: levels }).map((_, idx) => {
                    const lvl = idx + 1;
                    const isActive = clipLevel === lvl;
                    return (
                      <button
                        key={`clip-lvl-${lvl}`}
                        onClick={() => setClipLevel(lvl)}
                        style={{
                          flex: 1,
                          minWidth: 36,
                          padding: "6px 4px",
                          borderRadius: 6,
                          border: isActive ? "2px solid #10b981" : "1px solid #334155",
                          backgroundColor: isActive ? "#064e3b" : "#0f172a",
                          color: isActive ? "#6ee7b7" : "#94a3b8",
                          fontWeight: isActive ? "bold" : "normal",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        Y &le; {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <Text content="5. Authoring Snapping (DEC-060)" strong />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
              />
              Snap Boundary Endpoints to Sub-Grid
            </label>

            <Text content="6. Reactive History Ledger (Undo/Redo)" strong />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: undoStack.length > 0 ? "#3b82f6" : "#1e293b",
                  color: undoStack.length > 0 ? "#ffffff" : "#64748b",
                  cursor: undoStack.length > 0 ? "pointer" : "not-allowed",
                  fontSize: 13,
                }}
              >
                ↰ Undo ({undoStack.length})
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: redoStack.length > 0 ? "#3b82f6" : "#1e293b",
                  color: redoStack.length > 0 ? "#ffffff" : "#64748b",
                  cursor: redoStack.length > 0 ? "pointer" : "not-allowed",
                  fontSize: 13,
                }}
              >
                ↱ Redo ({redoStack.length})
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                onClick={handleResetMap}
                style={{
                  flex: 1,
                  padding: "6px",
                  borderRadius: 6,
                  border: "1px solid #dc2626",
                  backgroundColor: "#450a0a",
                  color: "#fca5a5",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Reset Map
              </button>
              <button
                onClick={handleCapturePreview}
                style={{
                  flex: 1,
                  padding: "6px",
                  borderRadius: 6,
                  border: "1px solid #059669",
                  backgroundColor: "#064e3b",
                  color: "#6ee7b7",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Capture Preview
              </button>
            </div>
          </div>
        </Card>

        {/* Center: 3D Viewport & 2D Free-Geometry Vector Canvas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 3D WebGL Viewport */}
          <div
            ref={containerRef}
            style={{
              width: "100%",
              height: "380px",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid #334155",
              position: "relative",
              backgroundColor: "#0f172a",
            }}
          />

          {/* 2D Free Geometry Authoring Canvas */}
          <Card ariaLabel="2D Vector Boundary Authoring Canvas">
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text content={`Free-Geometry Canvas (Level ${activeLevel}) — ${toolMode.toUpperCase()} Tool`} strong />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {toolMode === "erase"
                    ? "Click boundary segment or end point to erase"
                    : drawStart !== null
                    ? `Click end point (Start: ${drawStart.x}, ${drawStart.y})`
                    : toolMode === "floor"
                    ? `Click cell to paint terrain (${brushSize}x${brushSize})`
                    : "Click start point to draw boundary"}
                </span>
              </div>

              {/* Grid Canvas with Snap Nodes and Vector Boundary Segments */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "260px",
                  backgroundColor: "#0f172a",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  overflow: "hidden",
                }}
              >
                {/* SVG Overlay for Free-Geometry Boundary Vectors */}
                <svg
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                  }}
                >
                  {boundaries
                    .filter((b) => b.level === activeLevel)
                    .map((b) => {
                      const cellSize = 1.0;
                      const halfW = (width * cellSize) / 2;
                      const halfH = (height * cellSize) / 2;

                      const svgX1 = ((b.start.x + halfW) / (width * cellSize)) * 100;
                      const svgY1 = ((b.start.z + halfH) / (height * cellSize)) * 100;
                      const svgX2 = ((b.end.x + halfW) / (width * cellSize)) * 100;
                      const svgY2 = ((b.end.z + halfH) / (height * cellSize)) * 100;

                      const hex = BOUNDARY_COLORS[b.kind] ?? 0xdc2626;
                      const strokeColor = `#${hex.toString(16).padStart(6, "0")}`;

                      return (
                        <g key={b.id}>
                          <line
                            x1={`${svgX1}%`}
                            y1={`${svgY1}%`}
                            x2={`${svgX2}%`}
                            y2={`${svgY2}%`}
                            stroke={strokeColor}
                            strokeWidth="4"
                            strokeLinecap="round"
                          />
                          <circle cx={`${svgX1}%`} cy={`${svgY1}%`} r="4" fill={strokeColor} />
                          <circle cx={`${svgX2}%`} cy={`${svgY2}%`} r="4" fill={strokeColor} />
                        </g>
                      );
                    })}
                </svg>

                {/* 2D Interactive Node Grid for Painting & Vector Snapping */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${width}, 1fr)`,
                    gap: 2,
                    padding: 4,
                    height: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  {Array.from({ length: height }).map((_, gy) =>
                    Array.from({ length: width }).map((_, gx) => {
                      const idx = cellIndex(gx, gy, activeLevel, width, height);
                      const surface = (terrainGrid[idx] ?? TerrainSurfaceKind.StoneFloor) as TerrainSurfaceKind;
                      const hex = SURFACE_COLORS[surface] ?? 0x3b82f6;
                      const bgCss = `#${hex.toString(16).padStart(6, "0")}33`; // Semi-transparent terrain floor

                      const isSelectedStart = drawStart?.x === gx && drawStart?.y === gy;

                      return (
                        <button
                          key={`${gx}-${gy}`}
                          onClick={() => {
                            if (toolMode === "floor") {
                              handleCellClick(gx, gy);
                            } else {
                              handleNodeClick(gx, gy);
                            }
                          }}
                          style={{
                            backgroundColor: isSelectedStart ? "#3b82f6" : bgCss,
                            border: isSelectedStart ? "2px solid #60a5fa" : "1px dashed rgba(255,255,255,0.1)",
                            borderRadius: 3,
                            cursor: "pointer",
                            position: "relative",
                          }}
                          title={`Cell (${gx}, ${gy}) Lvl ${activeLevel}`}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Stats & Log Panel */}
        <Card ariaLabel="Boundary & Patch Log">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
            <Text content="7. Active Free-Geometry Boundaries" strong />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#f87171" }}>🧱 Walls:</span>
                <span>{boundaries.filter((b) => b.kind === "wall").length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#fbbf24" }}>🚪 Doors:</span>
                <span>{boundaries.filter((b) => b.kind === "door").length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#38bdf8" }}>🪟 Windows:</span>
                <span>{boundaries.filter((b) => b.kind === "window").length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#94a3b8" }}>🏛️ Openings:</span>
                <span>{boundaries.filter((b) => b.kind === "opening").length}</span>
              </div>
            </div>

            <Text content="8. Boundary Segments (ADR-0022)" strong />
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontFamily: "monospace",
                fontSize: 10,
                backgroundColor: "#0f172a",
                padding: 6,
                borderRadius: 6,
                border: "1px solid #1e293b",
              }}
            >
              {boundaries.length === 0 ? (
                <span style={{ color: "#64748b" }}>No boundary segments drawn.</span>
              ) : (
                boundaries.map((b) => (
                  <div key={b.id} style={{ color: "#cbd5e1" }}>
                    [{b.kind.toUpperCase()}] L{b.level}: ({b.start.x.toFixed(1)},{b.start.z.toFixed(1)})&rarr;(
                    {b.end.x.toFixed(1)},{b.end.z.toFixed(1)})
                  </div>
                ))
              )}
            </div>

            <Text content="9. Live Mutation History Log" strong />
            <div
              style={{
                maxHeight: 160,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontFamily: "monospace",
                fontSize: 10,
                backgroundColor: "#0f172a",
                padding: 6,
                borderRadius: 6,
                border: "1px solid #1e293b",
              }}
            >
              {undoStack.length === 0 ? (
                <span style={{ color: "#64748b" }}>No actions recorded.</span>
              ) : (
                [...undoStack].reverse().slice(0, 10).map((a, i) => (
                  <div key={`${a.timestamp}-${i}`} style={{ color: "#94a3b8" }}>
                    #{undoStack.length - i}:{" "}
                    {a.type === "terrain-stroke"
                      ? `Terrain Stroke (${a.patches.length} cells)`
                      : `Boundary ${a.action.toUpperCase()} ${a.segment.kind}`}
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
