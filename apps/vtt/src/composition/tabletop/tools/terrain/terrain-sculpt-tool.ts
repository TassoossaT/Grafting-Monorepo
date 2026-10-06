import { DEFAULT_TOOL_PARAMS, deriveFaceSize, hasTrait } from "../../../../features/edit-construction/index.ts";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type { ConstructionVolumeShape } from "@/ports";

import { capsuleWireframe } from "../shapes/preview-shapes.ts";
import { carveShape, commitTerrainVolumeEdit, fillShape, levelShapes, moundShape } from "../../terrain/terrain-volume-edit.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "../core/tool-context.ts";

/**
 * The terrain brush: every mode an edit of the ground's volume (note 0012).
 *
 * - **Adicionar** lays a layer of earth along the stroke, **Remover** takes
 *   one off: `elevationStep` deep where the stroke ran, thinning to nothing
 *   at the brush's radius, over the ground it lies on.
 * - **Aplainar** levels the ground under the stroke at the height it starts
 *   on: filled up to it and cut down to it, a few metres either way and no
 *   further.
 * - **Cavar 3D** and **Erguer 3D** push a bore into the ground or raise an
 *   arch of earth over it.
 *
 * The engine lays the result on the ground's own surface (`edit_surface`):
 * one mesh, irregular cells, the ring of ground round it kept. Nothing here
 * reads a height per point of the plane, so a cave's floor and the hill over
 * it never mix. A fill where no ground stands rests on the table.
 */

/** The wire a stroke's volume is ghosted in: the light grey the walls already use, which reads over any ground. */
const VOLUME_GHOST_COLOR = 0xe2e8f0;

/** The table's height: new ground laid on the bare table rests on it. */
const TABLE_HEIGHT = 0;

/** How far above and below its level a levelling stroke reaches, at least. */
const LEVEL_REACH_STEPS = 2;

function strokeFaceSize(params: TerrainSculptParams): number {
  return deriveFaceSize(params.brushRadius, params.faceSize);
}

/** The shapes a stroke carves or fills, in order. */
function strokeShapes(params: TerrainSculptParams, points: Parameters<typeof carveShape>[0]): readonly ConstructionVolumeShape[] {
  const step = params.elevationStep ?? 2;
  switch (params.mode ?? "add") {
    case "carve": {
      const shape = carveShape(points, params.brushRadius);
      return shape ? [shape] : [];
    }
    case "fill": {
      const shape = fillShape(points, params.brushRadius, step);
      return shape ? [shape] : [];
    }
    case "flatten":
      return levelShapes(points, params.brushRadius, Math.max(step * LEVEL_REACH_STEPS, params.brushRadius));
    case "dig":
    case "lower": {
      const shape = moundShape("lower", points, params.brushRadius, step);
      return shape ? [shape] : [];
    }
    default: {
      const shape = moundShape("raise", points, params.brushRadius, step);
      return shape ? [shape] : [];
    }
  }
}

/** Whether a stroke only takes ground away -- it never rests anything on the table. */
const takesAway = (params: TerrainSculptParams) => params.mode === "carve" || params.mode === "dig" || params.mode === "lower";

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  usesRuler: false,
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  // Every stroke shows the volume it would take or add under the pointer before it starts.
  previewOnHover: () => true,

  previewFor(gesture: ToolGesture, params: TerrainSculptParams) {
    const shapes = strokeShapes(params, gesture.samples.map((sample) => sample.point));
    const shape = shapes[0];
    if (!shape) return undefined;
    const path = shape.path.map(([x, y, z]) => ({ x, y, z }));
    // A level is drawn as the level itself, a layer as the reach of the
    // brush along the ground: the stroke's plan, flat.
    const flat = shape.column !== undefined || shape.effect === "raise" || shape.effect === "lower";
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
  flatten: "aplainado",
};

/**
 * One stroke as an edit of the ground's own mesh (`terrain/terrain-volume-edit.ts`):
 * the faces within reach laid again, irregular cells over the new surface,
 * the ring round them kept.
 */
function volumeStroke(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
  const shapes = strokeShapes(params, gesture.samples.map((sample) => sample.point));
  if (shapes.length === 0) {
    ctx.reportFeedback({ tone: "info", message: "Nada a cavar ou erguer aqui." });
    return;
  }
  const surfaceType = params.targetSurface && hasTrait(params.targetSurface, "ground") ? params.targetSurface : "terrain";
  try {
    const { faces } = commitTerrainVolumeEdit(ctx, shapes, {
      seed: Math.floor(params.seed ?? 1) || 1,
      surfaceType,
      emptyFaceSide: strokeFaceSize(params),
      ...(takesAway(params) ? {} : { table: TABLE_HEIGHT }),
    });
    if (faces === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nada a cavar aqui." });
      return;
    }
    ctx.reportFeedback({ tone: "success", message: `Terreno ${DONE[params.mode ?? "add"] ?? "editado"}: ${faces} faces refeitas.` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: `Terreno preservado: ${error instanceof Error ? error.message : String(error)}` });
  }
}
