import type { CanvasPortDefinition } from "../index.js";
import type { NodeViewPorts } from "./contracts.js";

/** Maps replaceable consumer ports to private X6 port metadata. */
export function createNodePorts(ports: readonly CanvasPortDefinition[]): NodeViewPorts {
  const ids = new Set<string>();
  const groups = Object.fromEntries(
    ports.map((port) => {
      if (ids.has(port.id)) throw new Error(`canvas node port is duplicated: ${port.id}`);
      ids.add(port.id);
      const appearance = port.presentation;
      const position =
        typeof port.position === "string"
          ? port.position
          : ([port.position.x, port.position.y] as [number, number]);
      return [
        port.id,
        {
          position,
          attrs: {
            circle:
              appearance === undefined
                ? {
                    r: 0,
                    magnet: port.magnet ?? false,
                    fill: "transparent",
                    stroke: "transparent",
                    strokeWidth: 0,
                    opacity: 0,
                  }
                : {
                    r: appearance.radius ?? 0,
                    magnet: port.magnet ?? false,
                    fill: appearance.fill ?? "transparent",
                    stroke: appearance.stroke ?? "transparent",
                    strokeWidth: appearance.strokeWidth ?? 0,
                    opacity: appearance.opacity ?? 1,
                  },
          },
        },
      ];
    }),
  );
  return {
    groups,
    items: ports.map((port) => ({ id: port.id, group: port.id })),
  };
}
