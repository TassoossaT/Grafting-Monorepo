import { DEFAULT_TOOL_PARAMS, deriveFaceSize, hasTrait } from "../../../../features/edit-construction/index.ts";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type { ConstructionPosition, ConstructionVolumeShape } from "@/ports";

import { capsuleWireframe, discWireframe } from "../shapes/preview-shapes.ts";
import { brushWay, carveShape, commitTerrainVolumeEdit, fillShape, levelShapes, moundShape, noiseShape, smoothShape, type TerrainBrush } from "../../terrain/terrain-volume-edit.ts";
import { timeCommit } from "../../commit-timing.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "../core/tool-context.ts";

/**
 * The terrain brush: every mode an edit of the ground's volume (note 0012).
 *
 * A terrain editor's brush (Flax's sculpt tools): `brushRadius` wide, its
 * effect fading over `falloff` of it by `falloffType`, `strength` the share
 * of the way to its target a smooth, a flatten or noise takes.
 *
 * - **Adicionar** lays a layer of earth along the stroke, **Remover** takes
 *   one off: `elevationStep` deep where the stroke ran, fading by the brush,
 *   over the ground it lies on -- a hillside, a cave's floor, its wall.
 *   Like a sculptor's draw brush (Blender's Draw), it pushes the way the
 *   surface under it faces -- the mean of its faces' normals round where the
 *   stroke starts, the faces facing the camera only: on a hilltop up, out of
 *   a cliff sideways. Painted again on the tip, the ground grows on into a
 *   ledge, an overhang, a bridge; dug again into a wall, a hole goes on into
 *   a cave and through.
 * - **Suavizar** draws the ground toward its mean height round each point,
 *   read over `filterRadius` of the brush.
 * - **Aplainar** levels the ground under the stroke at the height it starts
 *   on: filled up to it and cut down to it, a few metres either way and no
 *   further.
 * - **Ruído** lays Perlin noise on it, `heightScale` high, a wave every
 *   `1 / noiseScale` metres.
 *
 * The engine lays the result on the ground's own surface -- a layer or a
 * level by moving it (`layer_surface`), a bore or an arch through the volume
 * (`edit_surface`): one mesh, irregular cells, the ring of ground round it kept. Nothing here
 * reads a height per point of the plane, so a cave's floor and the hill over
 * it never mix. A fill where no ground stands rests on the table.
 */

/** The wire a stroke's volume is ghosted in: the light grey the walls already use, which reads over any ground. */
const VOLUME_GHOST_COLOR = 0xe2e8f0;

/** The table's height: new ground laid on the bare table rests on it. */
const TABLE_HEIGHT = 0;

/** How far round where a stroke starts the faces it reads its way off reach, as a share of the brush's radius. */
const WAY_REACH = 0.5;

/**
 * How far up a brush's way has to point for it to push straight up, as the
 * ground always did: less far up -- a cliff, ground steeper than 60° -- it
 * pushes out of it. Pushed out of every slope past 32°, strokes from above
 * on a hill pushed sideways and the ground grew three times the faces. The
 * engine's own (`layer.rs::UPRIGHT`).
 */
const UPRIGHT = 0.5;

/** How far round where a stroke starts the faces it reads its way off reach, at least. */
const WAY_REACH_LEAST = 0.75;

/**
 * The way a raise or a lower drawn from `sample` pushes: out of the ground
 * round it, toward the camera; `undefined` -- straight up -- on ground facing
 * up, or where no ground is.
 */
function wayOf(ctx: ToolContext, sample: PointerSample | undefined, radius: number): ConstructionPosition | undefined {
  const facing = outwardOf(sample);
  if (!sample || !facing) return undefined;
  const way = brushWay(ctx.runtime, sample.point, Math.max(WAY_REACH_LEAST, radius * WAY_REACH), facing) ?? facing;
  return way.y < UPRIGHT ? way : undefined;
}

/** How far above and below its level a levelling stroke reaches, at least. */
const LEVEL_REACH_STEPS = 2;

function strokeFaceSize(params: TerrainSculptParams): number {
  return deriveFaceSize(params.brushRadius, params.faceSize);
}

/**
 * Out of the face a sample is on, toward the camera: the side of it the
 * pointer sees. `undefined` where the sample knows no face.
 */
function outwardOf(sample: PointerSample | undefined): ConstructionPosition | undefined {
  const normal = sample?.face?.normal;
  if (!normal) return undefined;
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < 1e-9) return undefined;
  const looking = sample?.ray?.direction ?? sample?.forward;
  // With no view to say, the side the ground faces: up.
  const facing = looking ? normal.x * looking.x + normal.y * looking.y + normal.z * looking.z : -normal.y;
  const sign = (facing > 0 ? -1 : 1) / length;
  return { x: normal.x * sign, y: normal.y * sign, z: normal.z * sign };
}

/** Whether a stroke adds ground -- the one stroke that rests new ground on the bare table; every other only reworks or takes away the ground there is. */
const addsGround = (params: TerrainSculptParams) => params.mode === undefined || params.mode === "add" || params.mode === "elevate" || params.mode === "fill";

/** The brush a stroke is laid with, off the tool's params. */
const brushOf = (params: TerrainSculptParams): TerrainBrush => ({
  strength: params.strength ?? 0.5,
  falloff: params.falloff ?? 0.5,
  falloffType: params.falloffType ?? "smooth",
});

/**
 * The shapes a stroke lays, in order. "carve" and "fill" -- a bore pushed
 * level into the ground from where the stroke starts, an arch from where it
 * starts to where it ends -- are kept for whoever asks for them by name; the
 * dock offers the brush.
 */
function strokeShapes(params: TerrainSculptParams, samples: readonly PointerSample[], ctx: ToolContext): readonly ConstructionVolumeShape[] {
  const points = samples.map((sample) => sample.point);
  const step = params.elevationStep ?? 2;
  const pushes = ["add", "elevate", "dig", "lower"].includes(params.mode ?? "add");
  const direction = pushes ? wayOf(ctx, samples[0], params.brushRadius) : undefined;
  const brush = { ...brushOf(params), ...(direction ? { direction } : {}) };
  const one = (shape: ConstructionVolumeShape | undefined) => (shape ? [shape] : []);
  switch (params.mode ?? "add") {
    case "add":
    case "elevate":
      return one(moundShape("raise", points, params.brushRadius, step, brush));
    case "dig":
    case "lower":
      return one(moundShape("lower", points, params.brushRadius, step, brush));
    case "smooth":
      return one(smoothShape(points, params.brushRadius, params.filterRadius ?? 0.4, brush));
    case "noise":
      // One wave every 1 / noiseScale metres: the panel's "smoothness of the relief".
      return one(noiseShape(points, params.brushRadius, params.heightScale, 1 / Math.max(0.01, params.noiseScale), Math.floor(params.seed ?? 1) || 1, brush));
    case "carve": {
      const shape = carveShape(points, params.brushRadius);
      return shape ? [shape] : [];
    }
    case "fill": {
      const shape = fillShape(points, params.brushRadius, step, outwardOf(samples[0]));
      return shape ? [shape] : [];
    }
    default:
      return levelShapes(points, params.brushRadius, Math.max(step * LEVEL_REACH_STEPS, params.brushRadius), brush);
  }
}

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  usesRuler: false,
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  // Every stroke shows the volume it would take or add under the pointer before it starts.
  previewOnHover: () => true,

  previewFor(gesture: ToolGesture, params: TerrainSculptParams, ctx: ToolContext) {
    const shapes = strokeShapes(params, gesture.samples, ctx);
    const shape = shapes[0];
    if (!shape) return undefined;
    const path = shape.path.map(([x, y, z]) => ({ x, y, z }));
    // A brush pushing out of a wall is drawn as its disc, square to its way.
    if (shape.direction) return discWireframe(path, shape.radius, { x: shape.direction[0], y: shape.direction[1], z: shape.direction[2] }, VOLUME_GHOST_COLOR, 0.75);
    // The brush is drawn as its reach along the ground: the stroke's plan,
    // flat; a bore or an arch as its own volume.
    const flat = shape.column !== undefined || shape.effect === "raise" || shape.effect === "lower" || shape.effect === "smooth" || shape.effect === "noise";
    return capsuleWireframe(path, shape.radius, VOLUME_GHOST_COLOR, 0.75, flat ? 0 : shape.squash ?? 1);
  },

  // Presence of this hook makes the generic dispatcher capture and sample the drag; the ground is only ever laid on release.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
    volumeStroke(ctx, gesture, params);
  },
};

const DONE: Record<string, string> = {
  add: "erguido", elevate: "erguido", fill: "erguido",
  dig: "cavado", lower: "cavado", carve: "cavado",
  flatten: "aplainado", smooth: "suavizado", noise: "com ruído",
};

/**
 * One stroke as an edit of the ground's own mesh (`terrain/terrain-volume-edit.ts`):
 * the faces within reach laid again, irregular cells over the new surface,
 * the ring round them kept.
 */
function volumeStroke(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
  const shapes = strokeShapes(params, gesture.samples, ctx);
  if (shapes.length === 0) {
    ctx.reportFeedback({ tone: "info", message: "Nada a cavar ou erguer aqui." });
    return;
  }
  const surfaceType = params.targetSurface && hasTrait(params.targetSurface, "ground") ? params.targetSurface : "terrain";
  const options = {
    seed: Math.floor(params.seed ?? 1) || 1,
    surfaceType,
    // The brush's own face size, every stroke: read off the ground it lays,
    // each stroke would lay finer than the last.
    faceSide: strokeFaceSize(params),
    ...(addsGround(params) ? { table: TABLE_HEIGHT } : {}),
  };
  try {
    // Timed whole -- engine, graph and render -- so the debug panel shows what the stroke cost.
    const { faces } = timeCommit(`terreno: ${params.mode ?? "add"}`, () => commitTerrainVolumeEdit(ctx, shapes, options));
    if (faces === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nada a cavar aqui." });
      return;
    }
    ctx.reportFeedback({ tone: "success", message: `Terreno ${DONE[params.mode ?? "add"] ?? "editado"}: ${faces} faces refeitas.` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: `Terreno preservado: ${error instanceof Error ? error.message : String(error)}` });
  }
}
