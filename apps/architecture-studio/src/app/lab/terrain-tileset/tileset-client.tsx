"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Text } from "@grafting/ui";
import {
  attachOrbit,
  createEngine,
  createVisualRegistry,
  orbitFromCamera,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";
import { buildIrregularQuadGrid } from "../../../vtt/irregular-grid.ts";
import { normaliseWinding } from "../../../vtt/grid-adjacency.ts";
import { cellCentres } from "../../../vtt/stacked-terrain.ts";
import { LATERAL_FACES } from "../../../vtt/quad-cell-graph.ts";
import { buildShellCellGraph, pinCells } from "../../../vtt/shell-cell-graph.ts";
import { placeModule } from "../../../vtt/module-placement.ts";
import {
  EMPTY_MODULE_NAME,
  MODULE_FACES,
  SOCKET,
  STARTING_COMPATIBILITY,
  STARTING_TILESET,
  edgeProfile,
  flattenCompatibility,
  flattenModules,
  moduleMesh,
  type TerrainModule,
} from "../../../vtt/terrain-modules.ts";

import { writePreviewImage } from "../../../lab-preview-storage.ts";
import type {
  TerrainWorkerRequest,
  TerrainWorkerResponse,
} from "../stacked-terrain/terrain.worker.ts";
import type { TilesetWorkerRequest, TilesetWorkerResponse } from "./tileset.worker.ts";

/** Must match the "terrain-tileset" key in `DEMO_LINKS` so /lab/trials finds this trial's preview. */
const CANDIDATE = "terrain-tileset";

const TERRAIN_LAYER = "terrain";
const FIELD_SIZE = 64;
const LEVEL_HEIGHT = 0.22;
const BASE_HEIGHT = -0.6;
const SOCKET_NAMES = ["low", "high", "rise", "fall", "ground", "sky", "air"];
const FACE_NAMES = ["side 0", "side 1", "side 2", "side 3", "up", "down"];

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
  readonly solveSeed: number;
}

const INITIAL: Controls = { seed: 1, trianglesPerSide: 4, levels: 4, scale: 0.12, solveSeed: 1 };

/** Stage 2's pipeline, unchanged: the tileset pass consumes its levels. */
function requestLevels(centres: Float32Array, controls: Controls): Promise<Int32Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../stacked-terrain/terrain.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => {
      worker.terminate();
      if (event.data.type === "result") resolve(event.data.levels);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
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

function requestSolve(request: TilesetWorkerRequest): Promise<TilesetWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./tileset.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<TilesetWorkerResponse>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The tileset worker failed."));
    };
    worker.postMessage(request);
  });
}

interface SolveResult {
  readonly sources: Uint32Array;
  readonly turns: Uint32Array;
  readonly variantCount: number;
  readonly elapsedMs: number;
}

export default function TerrainTilesetClient() {
  const [controls, setControls] = useState<Controls>(INITIAL);
  const [modules, setModules] = useState<readonly TerrainModule[]>(STARTING_TILESET);
  const [compatibility, setCompatibility] =
    useState<readonly (readonly [number, number])[]>(STARTING_COMPATIBILITY);
  const [levels, setLevels] = useState<Int32Array | null>(null);
  const [solution, setSolution] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const viewRef = useRef<View | null>(null);

  const grid = useMemo(
    () =>
      normaliseWinding(
        buildIrregularQuadGrid({
          trianglesPerSide: controls.trianglesPerSide,
          triangleSide: 0.5,
          seed: controls.seed,
        }),
      ),
    [controls.seed, controls.trianglesPerSide],
  );

  // A quad at level `n` holds `n + 1` boxes of terrain, so even the lowest
  // ground is solid rather than nothing. The shell graph then keeps only the
  // boxes that meet air, and materialises the air they meet.
  const graph = useMemo(() => {
    if (levels === null || levels.length !== grid.quads.length) return null;
    return buildShellCellGraph(grid, [...levels].map((level) => Math.max(0, level) + 1));
  }, [grid, levels]);

  const emptyIndex = useMemo(
    () => modules.findIndex((module) => module.name === EMPTY_MODULE_NAME),
    [modules],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const registry = createVisualRegistry();
    registry.register({
      kind: "terrain",
      describe: (params: { positions: Float32Array; indices: Uint32Array; colour: number }) => ({
        geometry: {
          shape: "mesh" as const,
          data: { positions: params.positions, indices: params.indices },
        },
        material: { surface: "lit" as const, color: params.colour, flatShading: true },
      }),
    });

    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.7 },
        { light: "directional", intensity: 0.9, direction: { x: 4, y: 8, z: 5 } },
      ],
    });
    engine.scene.defineLayer({ id: TERRAIN_LAYER, order: 0 }, "engine");

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

  const solve = useCallback(() => {
    if (graph === null) return;
    if (emptyIndex < 0) {
      setError(`The tileset has no "${EMPTY_MODULE_NAME}" module for air cells to be pinned to.`);
      return;
    }
    let flattened: { sockets: Uint32Array; weights: Float32Array };
    try {
      flattened = flattenModules(modules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    setSolving(true);
    setError(null);
    requestSolve({
      type: "solve",
      cellCount: graph.cellCount,
      facesPerCell: graph.facesPerCell,
      links: graph.links,
      sockets: flattened.sockets,
      weights: flattened.weights,
      compatible: flattenCompatibility(compatibility),
      // Only the lateral faces rotate. Including 4 or 5 here would let a
      // module land on its side.
      rotationCycle: Uint32Array.from(LATERAL_FACES),
      // Air is not decided, it is stated. Pinning it is what turns a face that
      // used to have no link at all into a constraint on the terrain beside it.
      pinned: pinCells(graph.airCells, emptyIndex),
      seed: controls.solveSeed,
    })
      .then((response) => {
        setSolving(false);
        if (response.type === "error") {
          setSolution(null);
          setError(response.message);
          return;
        }
        setSolution(response);
      })
      .catch((cause: unknown) => {
        setSolving(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [graph, modules, compatibility, controls.solveSeed, emptyIndex]);

  useEffect(() => {
    setSolution(null);
    solve();
  }, [solve]);

  useEffect(() => {
    const engine = engineRef.current;
    const view = viewRef.current;
    if (engine === null || view === null || graph === null || solution === null) return;
    if (solution.sources.length !== graph.cellCount) return;

    // One batch per module, so a solved map is legible by colour and the
    // renderer sees a handful of meshes rather than one per cell.
    const perModule = modules.map(() => ({ positions: [] as number[], indices: [] as number[] }));

    // Only the top of each column draws a surface. Drawing every shell cell's
    // top was what put a `hollow` exactly on the plane of the `flat` below it,
    // and two coplanar surfaces are a z-fight, not a decision the depth buffer
    // can make. The cliff faces below come from this cell's own skirt.
    for (const cell of graph.topCells) {
      const source = solution.sources[cell] as number;
      const module = modules[source];
      const bucket = perModule[source];
      if (module === undefined || bucket === undefined || !module.visible) continue;

      const layer = graph.layerOfCell[cell] as number;
      const unit = moduleMesh(module, solution.turns[cell] as number, { skirtBottom: -layer });
      const scaled = {
        vertices: unit.vertices.map((vertex) => ({
          u: vertex.u,
          v: vertex.v,
          height: vertex.height * LEVEL_HEIGHT,
        })),
        indices: unit.indices,
      };
      const placed = placeModule(scaled, grid, graph.quadOfCell[cell] as number, {
        baseHeight: BASE_HEIGHT + (graph.layerOfCell[cell] as number) * LEVEL_HEIGHT,
      });

      const offset = bucket.positions.length / 3;
      for (const value of placed.positions) bucket.positions.push(value);
      for (const index of placed.indices) bucket.indices.push(index + offset);
    }

    engine.scene.batch(() => {
      perModule.forEach((bucket, index) => {
        engine.scene.put(
          {
            id: `module-${index}`,
            layer: TERRAIN_LAYER,
            visual: {
              kind: "terrain",
              params: {
                positions: Float32Array.from(bucket.positions),
                indices: Uint32Array.from(bucket.indices),
                colour: modules[index]?.colour ?? 0x888888,
              },
            },
          },
          "local",
        );
      });
    });

    engine.frame(performance.now());
    writePreviewImage(CANDIDATE, view.capture("image/png"));
  }, [grid, graph, solution, modules]);

  const setSocket = (moduleIndex: number, face: number, socket: number) => {
    setModules((current) =>
      current.map((module, index) =>
        index === moduleIndex
          ? { ...module, sockets: module.sockets.map((s, f) => (f === face ? socket : s)) }
          : module,
      ),
    );
  };

  const setWeight = (moduleIndex: number, weight: number) => {
    setModules((current) =>
      current.map((module, index) => (index === moduleIndex ? { ...module, weight } : module)),
    );
  };

  const socketIds = Object.values(SOCKET);
  const meets = (a: number, b: number) =>
    compatibility.some(([left, right]) => (left === a && right === b) || (left === b && right === a));

  const toggleMeets = (a: number, b: number) => {
    setCompatibility((current) =>
      meets(a, b)
        ? current.filter(([left, right]) => !((left === a && right === b) || (left === b && right === a)))
        : [...current, [a, b] as const],
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "460px 1fr", gap: 16, padding: 12 }}>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <Card ariaLabel="Grid parameters">
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <Text content="Grid seed" strong />
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
                max={6}
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
                min={1}
                max={6}
                value={controls.levels}
                onChange={(event) => setControls({ ...controls, levels: Number(event.target.value) })}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <Text content="Solve seed" strong />
              <input
                type="number"
                value={controls.solveSeed}
                onChange={(event) =>
                  setControls({ ...controls, solveSeed: Number(event.target.value) })
                }
              />
            </label>
            <Text
              content={
                graph === null
                  ? "Waiting for elevation…"
                  : `${grid.quads.length} quads, ${graph.cellCount} shell cells (${graph.airCells.length} of them air) against ${graph.volumeCellCount} boxes of solid, ${graph.links.length / 4} links`
              }
            />
            {solution !== null ? (
              <Text
                content={`Solved in ${solution.elapsedMs.toFixed(1)} ms; ${modules.length} modules expanded to ${solution.variantCount} orientations.`}
                tone="muted"
              />
            ) : null}
            {solving ? <Text content="Solving…" tone="muted" /> : null}
            <Text content="Drag the view to orbit, scroll to zoom." tone="muted" />
            {error !== null ? <Text content={error} tone="danger" /> : null}
          </div>
        </Card>

        <Card ariaLabel="Modules">
          <div style={{ display: "grid", gap: 8 }}>
            <Text content="Modules" strong />
            <Text
              content="A socket per face, then a weight. Sides 0–3 rotate; up and down do not. Sockets are authored, not derived from the shape — a face labelled inconsistently with its corner heights is flagged, and left alone, so you can see what a wrong scheme does."
              tone="muted"
            />
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }} />
                  {FACE_NAMES.map((face) => (
                    <th key={face} style={{ padding: "0 4px" }}>
                      {face}
                    </th>
                  ))}
                  <th style={{ padding: "0 4px" }}>weight</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((module, moduleIndex) => (
                  <tr key={module.name}>
                    <th style={{ textAlign: "left", paddingRight: 6 }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          marginRight: 5,
                          background: `#${module.colour.toString(16).padStart(6, "0")}`,
                        }}
                      />
                      {module.name}
                    </th>
                    {Array.from({ length: MODULE_FACES }, (_, face) => {
                      // An invisible module draws nothing, so its lateral
                      // sockets describe exposure rather than corner heights
                      // and cannot disagree with geometry it does not have.
                      const consistent =
                        face >= 4 ||
                        !module.visible ||
                        labelFor(edgeProfile(module, face)) === module.sockets[face];
                      return (
                        <td key={face} style={{ padding: "1px 3px" }}>
                          <select
                            value={module.sockets[face]}
                            onChange={(event) =>
                              setSocket(moduleIndex, face, Number(event.target.value))
                            }
                            style={{
                              width: 62,
                              border: consistent ? undefined : "2px solid #c0392b",
                            }}
                            title={
                              consistent
                                ? undefined
                                : `This face's corner heights are ${edgeProfile(module, face).join(" → ")}, which this socket does not describe.`
                            }
                          >
                            {socketIds.map((socket) => (
                              <option key={socket} value={socket}>
                                {SOCKET_NAMES[socket]}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                    <td style={{ padding: "1px 3px" }}>
                      <input
                        type="number"
                        min={0.1}
                        step={0.5}
                        value={module.weight}
                        onChange={(event) => setWeight(moduleIndex, Number(event.target.value))}
                        style={{ width: 54 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card ariaLabel="Socket compatibility">
          <div style={{ display: "grid", gap: 8 }}>
            <Text content="Which sockets may meet" strong />
            <Text
              content="Symmetric, so only one half is shown. Emptying a row is the quickest way to make the tileset unsatisfiable — the solver reports which link failed rather than searching."
              tone="muted"
            />
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th />
                  {socketIds.map((socket) => (
                    <th key={socket} style={{ padding: "0 4px" }}>
                      {SOCKET_NAMES[socket]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {socketIds.map((left) => (
                  <tr key={left}>
                    <th style={{ textAlign: "left", paddingRight: 6 }}>{SOCKET_NAMES[left]}</th>
                    {socketIds.map((right) => (
                      <td key={right} style={{ textAlign: "center" }}>
                        {right >= left ? (
                          <input
                            type="checkbox"
                            checked={meets(left, right)}
                            onChange={() => toggleMeets(left, right)}
                            aria-label={`${SOCKET_NAMES[left]} meets ${SOCKET_NAMES[right]}`}
                          />
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div
        ref={containerRef}
        style={{ minHeight: 620, border: "1px solid #d9d9d9", borderRadius: 8, overflow: "hidden" }}
      />
    </div>
  );
}

/** The socket a face's corner heights would imply, for the consistency hint. */
function labelFor([from, to]: readonly [number, number]): number {
  if (from === to) return from >= 1 ? SOCKET.HIGH : SOCKET.LOW;
  return to > from ? SOCKET.RISE : SOCKET.FALL;
}
