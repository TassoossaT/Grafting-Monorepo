import type { GlobalHandleKind } from "../../features/edit-construction/index.ts";
import type { RenderHandleGlyph } from "../../ports/index.ts";

/**
 * Every handle the scene shows, by what it is for, and the glyph it is drawn
 * with -- the one place a handle's look is chosen. The images themselves
 * live with the renderer, one per glyph (`adapters/rendering`); changing how
 * a kind of handle looks is changing its line here or its glyph's image
 * there, never the code that places it.
 */
export const HANDLE_GLYPHS = {
  /** A point of a structure's own outline. */
  vertex: "point",
  /** A control point of a spine. */
  anchor: "point",
  /** A span's midpoint: bend it, or click to insert a point. */
  midpoint: "midpoint",
  /** A wall run's own height widget. */
  panelHeight: "height",
} as const satisfies Readonly<Record<string, RenderHandleGlyph>>;

/** A whole-structure handle's glyph, by its kind. */
export const GLOBAL_HANDLE_GLYPHS: Readonly<Record<GlobalHandleKind, RenderHandleGlyph>> = {
  pivot: "move", rotate: "rotate", height: "height", turns: "turns",
};
