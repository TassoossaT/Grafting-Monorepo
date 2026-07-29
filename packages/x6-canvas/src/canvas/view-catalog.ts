import type { CanvasEdgeViewDefinition, CanvasNodeViewDefinition } from "../index.js";

function createCatalog<Definition extends { readonly id: string }>(
  kind: string,
  definitions: readonly Definition[],
): ReadonlyMap<string, Definition> {
  const catalog = new Map<string, Definition>();
  for (const definition of definitions) {
    if (definition.id.trim().length === 0) {
      throw new Error(`canvas ${kind} view id must not be empty`);
    }
    if (catalog.has(definition.id)) {
      throw new Error(`canvas ${kind} view is duplicated: ${definition.id}`);
    }
    catalog.set(definition.id, definition);
  }
  return catalog;
}

/** Creates an immutable lookup for consumer-supplied node views. */
export function createNodeViewCatalog(
  definitions: readonly CanvasNodeViewDefinition[],
): ReadonlyMap<string, CanvasNodeViewDefinition> {
  return createCatalog("node", definitions);
}

/** Creates an immutable lookup for consumer-supplied edge views. */
export function createEdgeViewCatalog(
  definitions: readonly CanvasEdgeViewDefinition[],
): ReadonlyMap<string, CanvasEdgeViewDefinition> {
  return createCatalog("edge", definitions);
}

/** Resolves one required consumer view with a stable error. */
export function resolveCanvasView<Definition>(
  kind: "node" | "edge",
  catalog: ReadonlyMap<string, Definition>,
  id: string,
): Definition {
  const definition = catalog.get(id);
  if (definition === undefined) {
    throw new Error(`canvas ${kind} view is not registered: ${id}`);
  }
  return definition;
}
