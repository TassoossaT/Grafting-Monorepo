import type { VisualDefinition, VisualRegistry } from "../contracts/visual.js";

/**
 * Creates a lookup of visual kinds.
 *
 * A registry is the whole integration surface for anything this package does
 * not know about. It is created by the caller and may be shared across engines,
 * so a separate package can populate one — defining what its own concepts look
 * like — and hand it over without either package importing the other.
 */
export function createVisualRegistry(
  definitions: readonly VisualDefinition<never>[] = [],
): VisualRegistry {
  const byKind = new Map<string, VisualDefinition<never>>();

  const registry: VisualRegistry = {
    register<TParams>(definition: VisualDefinition<TParams>) {
      const kind = definition.kind;
      if (typeof kind !== "string" || kind.length === 0) {
        throw new TypeError("A visual definition needs a non-empty kind");
      }
      if (byKind.has(kind)) {
        // Silent replacement would make a name collision between two packages
        // present itself later as the wrong shape being drawn.
        throw new Error(`Visual kind "${kind}" is already registered`);
      }
      byKind.set(kind, definition as unknown as VisualDefinition<never>);
    },

    get(kind: string) {
      return byKind.get(kind);
    },

    kinds() {
      return [...byKind.keys()];
    },
  };

  for (const definition of definitions) registry.register(definition);
  return registry;
}
