import { describeSpineChain, planSpineChainEdit, planSpineTransform, spineGlobalHandles, type SpineGlobalHandle } from "../../spine/index.ts";
import { structureTypeFor } from "../../structure-types/index.ts";
import type { GlobalHandleProvider } from "../../global-handles/index.ts";

/**
 * Global handles of structures built from a spine: every intent becomes a
 * spine graph patch the spine's owner regenerates from.
 */
export const spineHandleProvider: GlobalHandleProvider = {
  name: "spine",
  handles: (scene) => spineGlobalHandles(scene.graph).filter((handle) => structureTypeFor(handle.owner)?.spine !== undefined),
  plan(scene, generic, intent, port, operationId) {
    const handle = generic as SpineGlobalHandle;
    const graphPatch = (() => {
      switch (intent.kind) {
        case "move": return planSpineTransform(scene.graph, handle, { delta: intent.delta });
        case "rotate": return planSpineTransform(scene.graph, handle, { rotation: { pivot: handle.pivot, angle: intent.angle } });
        case "height": {
          const far = handle.ends && scene.graph.nodes.find((node) => node.id === handle.ends![1]);
          return far ? { nodes: [{ id: far.id, position: { ...far.position, y: far.position.y + intent.dy } }], edges: [] } : undefined;
        }
        case "wind": {
          const shape = describeSpineChain(scene.graph, handle.id);
          if (!shape?.spiral) return undefined;
          // Round the way the spiral already turns winds it on; the other way, back.
          const turns = Math.max(0.05, shape.spiral.turns + (shape.spiral.positive ? intent.angle : -intent.angle) / (2 * Math.PI));
          const keeps = structureTypeFor(handle.owner)?.spine?.windKeeps ?? "grade";
          const endHeight = keeps === "height" ? shape.endHeight : shape.startHeight + ((shape.endHeight - shape.startHeight) * turns) / shape.spiral.turns;
          return planSpineChainEdit(scene.graph, port, handle.id, { ...shape, endHeight, spiral: { ...shape.spiral, turns } }, operationId);
        }
      }
    })();
    return graphPatch && { kind: "spine", owner: handle.owner, graphPatch };
  },
};
