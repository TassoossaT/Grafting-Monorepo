"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import init, { ConstructionSession } from "@grafting/procgen-construction-wasm";
import { attachOrbit, createEngine, createVisualRegistry, orbitFromCamera, type RenderEngine } from "@grafting/render-3d";

import { writePreviewImage } from "../../../../lab-preview-storage.ts";

/**
 * Solid ground: a height field plus shapes that carve or fill it, split into
 * pieces that are each a height over a plane of their own, every piece laid by
 * the same irregular quad grid the tabletop's ground uses. Each piece is drawn
 * in its own colour so the split can be read.
 */

type Point = [number, number, number];
type ShapeSpec = { effect: "carve" | "fill"; path: Point[]; radius: number };
type Piece = {
  facing: string;
  inFront: number;
  behind: number;
  vertices: Point[];
  faces: number[][];
  borderPoint: (number | null)[];
  error: string | null;
};
type Response = { borderPoints: Point[]; pieces: Piece[] };

const HALF = 20;
const SPACING = 0.5;
const LAYER = "solid-ground";
const CAMERA = { projection: "perspective" as const, fov: 45, position: { x: 26, y: 22, z: 30 }, target: { x: 0, y: 2, z: 0 }, far: 300 };
const PALETTE = [0x7a9a6a, 0xc98a4b, 0x5b8fc7, 0xb5657a, 0x9b7fc4, 0xd2b55b, 0x4fa79a, 0xd77a5f, 0x8a8f99, 0x6fb3d2];

const hill = (height: number, width: number) => (x: number, z: number) => height * Math.exp(-(x * x + z * z) / (2 * width * width));
const flat = () => 0;

type Scenario = { ground: "hill" | "flat"; shapes: (radius: number) => ShapeSpec[] };
const SCENARIOS: Record<string, Scenario> = {
  "Túnel atravessando o morro": { ground: "hill", shapes: (r) => [{ effect: "carve", path: [[-16, 2, 0], [16, 2, 0]], radius: r }] },
  "Túnel diagonal sem saída": { ground: "hill", shapes: (r) => [{ effect: "carve", path: [[-15, 1.8, -15], [1, 2, 1]], radius: r }] },
  "Túnel em curva": { ground: "hill", shapes: (r) => [{ effect: "carve", path: [[-16, 1.8, -4], [-4, 2, -4], [2, 2.2, 2], [4, 2.2, 16]], radius: r }] },
  "Caverna fechada": { ground: "hill", shapes: (r) => [{ effect: "carve", path: [[-2, 2.2, 0], [2, 2.2, 1]], radius: r * 0.85 }] },
  "Ponte de terra": { ground: "flat", shapes: (r) => [{ effect: "fill", path: [[-10, -1, 0], [-6, 3.5, 0], [6, 3.5, 0], [10, -1, 0]], radius: r * 0.7 }] },
  "Morro sem nada": { ground: "hill", shapes: () => [] },
};

function heights(source: (x: number, z: number) => number) {
  const count = Math.round((2 * HALF) / SPACING) + 1;
  const values: number[] = [];
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) values.push(source(-HALF + column * SPACING, -HALF + row * SPACING));
  return { originX: -HALF, originZ: -HALF, spacing: SPACING, columns: count, rows: count, heights: values };
}

/** Faces fanned into triangles, and their edges nudged off the surface so they draw over it. */
function geometry(piece: Piece) {
  const normals = piece.vertices.map(() => [0, 0, 0]);
  for (const face of piece.faces) {
    const [a, b, c] = face.map((i) => piece.vertices[i]!);
    const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
    const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    for (const i of face) for (let k = 0; k < 3; k++) normals[i]![k]! += n[k]!;
  }
  const lifted = piece.vertices.map((p, i) => {
    const n = normals[i]!;
    const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    return [p[0] + (n[0]! / length) * 0.03, p[1] + (n[1]! / length) * 0.03, p[2] + (n[2]! / length) * 0.03];
  });
  const indices: number[] = [];
  const edges: number[] = [];
  for (const face of piece.faces) {
    for (let k = 1; k + 1 < face.length; k++) indices.push(face[0]!, face[k]!, face[k + 1]!);
    for (let k = 0; k < face.length; k++) edges.push(...lifted[face[k]!]!, ...lifted[face[(k + 1) % face.length]!]!);
  }
  return { positions: new Float32Array(piece.vertices.flat()), indices: new Uint32Array(indices), edges: new Float32Array(edges) };
}

export default function SolidGroundLab() {
  const [session, setSession] = useState<ConstructionSession>();
  const [scenario, setScenario] = useState("Túnel atravessando o morro");
  const [radius, setRadius] = useState(1.8);
  const [blend, setBlend] = useState(0.6);
  const [faceSide, setFaceSide] = useState(2);
  const [steepestUp, setSteepestUp] = useState(0.5);
  const [cut, setCut] = useState(true);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const shown = useRef<string[]>([]);

  useEffect(() => {
    let disposed = false;
    let value: ConstructionSession | undefined;
    void init()
      .then(() => {
        if (disposed) return;
        value = new ConstructionSession();
        setSession(value);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      disposed = true;
      value?.free();
    };
  }, []);

  const result = useMemo(() => {
    if (!session) return undefined;
    const spec = SCENARIOS[scenario]!;
    const started = performance.now();
    try {
      const response = JSON.parse(
        session.solid_ground_json(
          JSON.stringify({
            ground: heights(spec.ground === "hill" ? hill(6, 7) : flat),
            shapes: spec.shapes(radius),
            blend,
            regionMin: [-HALF, -3, -HALF],
            regionMax: [HALF, 9, HALF],
            cell: 0.5,
            faceSide,
            steepestUp,
            seed: 7,
          }),
        ),
      ) as Response;
      return { response, millis: performance.now() - started, error: "" };
    } catch (e) {
      return { response: undefined, millis: 0, error: String(e) };
    }
  }, [session, scenario, radius, blend, faceSide, steepestUp]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const registry = createVisualRegistry();
    registry.register({
      kind: "solid-ground-piece",
      describe: (params: { positions: Float32Array; indices: Uint32Array; color: number }) => ({
        geometry: { shape: "mesh" as const, data: { positions: params.positions, indices: params.indices } },
        material: { surface: "lit" as const, color: params.color, doubleSided: true, flatShading: true, clippable: true },
      }),
    });
    registry.register({
      kind: "solid-ground-edges",
      describe: (params: { positions: Float32Array }) => ({
        geometry: { shape: "segments" as const, positions: params.positions },
        material: { surface: "line" as const, color: 0x1b2430, clippable: true },
      }),
    });
    const engine = createEngine({
      registry,
      autoplay: false,
      lights: [
        { light: "ambient", intensity: 0.75 },
        { light: "directional", intensity: 0.9, direction: { x: 6, y: 10, z: 4 } },
      ],
    });
    engine.scene.defineLayer({ id: LAYER, order: 0 }, "engine");
    const view = engine.createView({ target: container, background: 0x10161d, camera: CAMERA });
    engineRef.current = engine;
    const detachOrbit = attachOrbit(container, view, orbitFromCamera(CAMERA.position, CAMERA.target), {
      fov: CAMERA.fov,
      far: CAMERA.far,
      onChange: () => engine.frame(performance.now()),
    });
    const resize = () => {
      view.resize(container.clientWidth, container.clientHeight);
      engine.frame(performance.now());
    };
    window.addEventListener("resize", resize);
    resize();
    return () => {
      window.removeEventListener("resize", resize);
      detachOrbit();
      engine.dispose();
      engineRef.current = null;
      shown.current = [];
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) return;
    for (const id of shown.current) engine.scene.remove(id, "engine");
    shown.current = [];
    result?.response?.pieces.forEach((piece, index) => {
      if (piece.error) return;
      const { positions, indices, edges } = geometry(piece);
      const color = PALETTE[index % PALETTE.length]!;
      engine.scene.put({ id: `piece-${index}`, layer: LAYER, visual: { kind: "solid-ground-piece", params: { positions, indices, color } } }, "engine");
      engine.scene.put({ id: `edges-${index}`, layer: LAYER, visual: { kind: "solid-ground-edges", params: { positions: edges } } }, "engine");
      shown.current.push(`piece-${index}`, `edges-${index}`);
    });
    // Keeps the half of the world with z <= 0, so a tunnel along x shows its inside.
    engine.setClipPlane(cut ? { normal: { x: 0, y: 0, z: -1 }, constant: 0.01 } : undefined);
    engine.frame(performance.now());
  }, [result, cut]);

  const pieces = result?.response?.pieces ?? [];
  const faces = pieces.reduce((sum, p) => sum + p.faces.length, 0);
  const failed = pieces.filter((p) => p.error);

  return (
    <main style={{ padding: 24, maxWidth: 1280, margin: "auto", fontFamily: "system-ui" }}>
      <a href="/lab">← Laboratório</a>
      <h1>Terreno sólido: altura + formas</h1>
      <p>
        O morro vem de um mapa de altura; túneis, cavernas e pontes são formas que tiram ou somam terra. A superfície é dividida em pedaços que
        são cada um uma altura sobre o próprio plano, e cada pedaço é malhado pelo mesmo gerador irregular do terreno do VTT. Cada cor é um
        pedaço.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {Object.keys(SCENARIOS).map((name) => (
          <button key={name} disabled={!session} onClick={() => setScenario(name)} style={{ fontWeight: name === scenario ? 700 : 400 }}>
            {name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        <label>
          Raio <input type="range" min="0.8" max="3" step="0.1" value={radius} onChange={(e) => setRadius(Number(e.target.value))} /> {radius.toFixed(1)} m
        </label>
        <label>
          Arredondamento <input type="range" min="0" max="2" step="0.1" value={blend} onChange={(e) => setBlend(Number(e.target.value))} /> {blend.toFixed(1)} m
        </label>
        <label>
          Tamanho da face <input type="range" min="1" max="4" step="0.5" value={faceSide} onChange={(e) => setFaceSide(Number(e.target.value))} /> {faceSide} m
        </label>
        <label>
          Mais íngreme ainda "para cima"{" "}
          <input type="range" min="0.2" max="0.8" step="0.05" value={steepestUp} onChange={(e) => setSteepestUp(Number(e.target.value))} />{" "}
          {Math.round((Math.acos(steepestUp) * 180) / Math.PI)}°
        </label>
        <label>
          <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} /> Cortar ao meio
        </label>
      </div>
      <p role="status">
        {error ||
          result?.error ||
          (result?.response
            ? `${pieces.length} pedaços · ${faces} faces · ${result.millis.toFixed(0)} ms${failed.length ? ` · ${failed.length} falharam` : ""}`
            : "Carregando núcleo Rust…")}
      </p>
      <div ref={containerRef} style={{ width: "100%", height: 620, borderRadius: 8, overflow: "hidden" }} />
      <button
        onClick={() => {
          const canvas = containerRef.current?.querySelector("canvas");
          if (canvas) writePreviewImage("solid-ground", canvas.toDataURL("image/png"));
        }}
      >
        Salvar prévia
      </button>
      <table style={{ marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", paddingRight: 12 }}>Pedaço</th>
            <th style={{ textAlign: "left", paddingRight: 12 }}>Virado para</th>
            <th style={{ textAlign: "right", paddingRight: 12 }}>Camadas na frente</th>
            <th style={{ textAlign: "right", paddingRight: 12 }}>Camadas atrás</th>
            <th style={{ textAlign: "right" }}>Faces</th>
          </tr>
        </thead>
        <tbody>
          {pieces.map((piece, index) => (
            <tr key={index}>
              <td style={{ paddingRight: 12 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, marginRight: 6, background: `#${PALETTE[index % PALETTE.length]!.toString(16).padStart(6, "0")}` }} />
                {index}
              </td>
              <td style={{ paddingRight: 12 }}>{piece.facing}</td>
              <td style={{ textAlign: "right", paddingRight: 12 }}>{piece.inFront}</td>
              <td style={{ textAlign: "right", paddingRight: 12 }}>{piece.behind}</td>
              <td style={{ textAlign: "right" }}>{piece.error ?? piece.faces.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
