import type { GlobalHandleKind, SceneHandleKind } from "../../features/edit-construction/index.ts";
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
  /** One end up or down alone: how steeply the structure climbs. */
  originHeight: "tilt",
  destinationHeight: "tilt",
  /** Just outside a side or a corner: pushes that part. */
  side: "side",
  corner: "corner",
  /** An upright post: where it stands, and how high that side rises. */
  foot: "corner",
  top: "height",
  /** Let go of what the structure is joined to. */
  detach: "unlink",
  /** How high a structure grown from its base rises. */
  rise: "height",
  /** How steeply one face, or the two along a seam, climb. */
  slope: "tilt",
  seam: "tilt",
  /** A new corner pulled out of a side. */
  insert: "midpoint",
};

/** What each whole-structure handle reports once its edit is committed -- said here, with how it looks. */
export const HANDLE_DONE: Readonly<Record<GlobalHandleKind, string>> = {
  pivot: "Estrutura movida.", rotate: "Estrutura girada.", height: "Altura atualizada.", turns: "Voltas atualizadas.",
  radius: "Raio atualizado.", origin: "Ponta movida.", destination: "Ponta movida.",
  originHeight: "Inclinação atualizada.", destinationHeight: "Inclinação atualizada.",
  side: "Lado ajustado.", corner: "Canto ajustado.",
  foot: "Coluna movida.", top: "Altura atualizada.", detach: "Estrutura solta.",
  rise: "Altura atualizada.", slope: "Inclinação atualizada.", seam: "Inclinação atualizada.", insert: "Canto inserido.",
};
