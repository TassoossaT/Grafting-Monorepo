import type { SceneHandleKind } from "../../features/edit-construction/index.ts";
import type { RenderHandleGlyph } from "../../ports/index.ts";

/**
 * Every handle the scene shows, by what it is for, and the glyph it is drawn
 * with -- the one place a handle's look is chosen. Which handles exist is
 * the scene handle registry's (`orchestration/scene-handles.ts`); the images
 * themselves live with the renderer, one per glyph (`adapters/rendering`).
 * Changing how a kind of handle looks is changing its line here or its
 * glyph's image there, never the code that places it.
 */
export const HANDLE_GLYPHS: Readonly<Record<SceneHandleKind | "vertex", RenderHandleGlyph>> = {
  /** A point of a structure's own outline -- the graph's own node dots. */
  vertex: "point",
  /** A control point of a spine. */
  anchor: "point",
  /** A span's midpoint: bend it, or click to insert a point. */
  midpoint: "midpoint",
  /** A wall run's own height widget. */
  panelHeight: "height",
  /** Whole-structure handles. */
  pivot: "move",
  rotate: "rotate",
  height: "height",
  turns: "turns",
  radius: "radius",
  origin: "link",
  destination: "link",
  originHeight: "height",
  destinationHeight: "height",
};
