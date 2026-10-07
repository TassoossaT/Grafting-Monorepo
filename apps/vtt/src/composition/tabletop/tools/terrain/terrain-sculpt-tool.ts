import { DEFAULT_TOOL_PARAMS, deriveFaceSize, hasTrait } from "../../../../features/edit-construction/index.ts";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type { ConstructionPosition, ConstructionVolumeShape } from "@/ports";

import { capsuleWireframe } from "../shapes/preview-shapes.ts";
import { ballPath, ballShape, carveShape, commitTerrainVolumeEdit, fillShape, groundRunOn, levelShapes } from "../../terrain/terrain-volume-edit.ts";
import { timeCommit } from "../../commit-timing.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "../core/tool-context.ts";

/**
 * The terrain brush: every mode an edit of the ground's volume (note 0012).
 *
 * - **Adicionar** and **Remover** are one ball of earth, `brushRadius` round,
 *   rolled along the stroke on the ground it touches: added standing
 *   `elevationStep` out of the surface under the pointer, or dug that deep
 *   into it -- out of whichever side of it the pointer sees, so a ball set on
 *   a hillside grows it sideways, one set on the last ball bridges a gap, one
 *   dug into a cliff bores a tunnel, ball by ball. On the bare table it rests
 *   on the table. Where the stroke runs over ground facing up and the ball
 *   stands no higher than it is round, it is a cap of earth on the ground --
 *   laid as a layer, the ground's own surface moved; anywhere else it goes
 *   through the ground's volume.
 * - **Aplainar** levels the ground under the stroke at the height it starts
 *   on: filled up to it and cut down to it, a few metres either way and no
 *   further.
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

/** How far past a ball, in faces, the ground is run on over the bare table under it: past what the volume edit lays again round it. */
const EDGE_REACH_FACES = 3;

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

/** Whether a stroke only takes ground away -- it never rests anything on the table. */
const takesAway = (params: TerrainSculptParams) => params.mode === "carve" || params.mode === "dig" || params.mode === "lower";

/** The ball's way -- added or dug -- or `undefined` for a stroke that is no ball. "elevate" and "lower" are the older names of the same two. */
function ballOf(params: TerrainSculptParams): "add" | "dig" | undefined {
  switch (params.mode ?? "add") {
    case "add":
    case "elevate":
      return "add";
    case "dig":
    case "lower":
      return "dig";
    default:
      return undefined;
  }
}

/** Each sample as the ball rolls on it: where, and out of which side of the surface. */
const rolled = (samples: readonly PointerSample[]) => samples.map((sample) => ({ point: sample.point, outward: outwardOf(sample) }));

/**
 * The shapes a stroke carves or fills, in order. "carve" and "fill" -- a bore
 * pushed level into the ground from where the stroke starts, an arch from
 * where it starts to where it ends -- are kept for whoever asks for them by
 * name; the dock offers the ball.
 */
function strokeShapes(params: TerrainSculptParams, samples: readonly PointerSample[]): readonly ConstructionVolumeShape[] {
  const points = samples.map((sample) => sample.point);
  const step = params.elevationStep ?? 2;
  const ball = ballOf(params);
  if (ball) {
    const shape = ballShape(ball, rolled(samples), params.brushRadius, step);
    return shape ? [shape] : [];
  }
  switch (params.mode) {
    case "carve": {
      const shape = carveShape(points, params.brushRadius);
      return shape ? [shape] : [];
    }
    case "fill": {
      const shape = fillShape(points, params.brushRadius, step, outwardOf(samples[0]));
      return shape ? [shape] : [];
    }
    default:
      return levelShapes(points, params.brushRadius, Math.max(step * LEVEL_REACH_STEPS, params.brushRadius));
  }
}

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  usesRuler: false,
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  // Every stroke shows the volume it would take or add under the pointer before it starts.
  previewOnHover: () => true,

  previewFor(gesture: ToolGesture, params: TerrainSculptParams) {
    const shapes = strokeShapes(params, gesture.samples);
    const shape = shapes[0];
    if (!shape) return undefined;
    // The ball as the ball, rolled along the stroke -- whichever way the
    // engine lays it; a level as the level itself, flat.
    const ball = ballOf(params);
    if (ball) return capsuleWireframe(ballPath(ball, rolled(gesture.samples), params.brushRadius, params.elevationStep ?? 2), params.brushRadius, VOLUME_GHOST_COLOR, 0.75, 1);
    const path = shape.path.map(([x, y, z]) => ({ x, y, z }));
    return capsuleWireframe(path, shape.radius, VOLUME_GHOST_COLOR, 0.75, shape.column !== undefined ? 0 : shape.squash ?? 1);
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
  flatten: "aplainado",
};

/**
 * One stroke as an edit of the ground's own mesh (`terrain/terrain-volume-edit.ts`):
 * the faces within reach laid again, irregular cells over the new surface,
 * the ring round them kept.
 */
function volumeStroke(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
  const shapes = strokeShapes(params, gesture.samples);
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
    ...(takesAway(params) ? {} : { table: TABLE_HEIGHT }),
  };
  try {
    // A ball added through the volume over the ground's edge: the ground run
    // on over the bare table under it first, so it is set on ground all round.
    const ball = ballOf(params) === "add" && shapes[0]?.effect === "fill"
      ? groundRunOn(ctx.runtime, rolled(gesture.samples), params.brushRadius + EDGE_REACH_FACES * strokeFaceSize(params))
      : undefined;
    if (ball) timeCommit("terreno: chão sob a bola", () => commitTerrainVolumeEdit(ctx, [ball], options));
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
