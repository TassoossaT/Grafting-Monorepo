import type { CanvasEntityReference, ReadOnlyCanvas } from "../index.js";
import type { CanvasController } from "../contracts/canvas.js";

/** Builds the immutable public handle around a private canvas controller. */
export function createReadOnlyCanvasHandle(
  controller: CanvasController,
  nodeCount: number,
  edgeCount: number,
  onActivate?: (entity: CanvasEntityReference) => void,
  selectOnActivate = false,
): ReadOnlyCanvas {
  let disposed = false;
  const assertActive = () => {
    if (disposed) {
      throw new Error("read-only canvas has been disposed");
    }
  };
  const copyEntity = (entity: CanvasEntityReference) =>
    Object.freeze({ kind: entity.kind, id: entity.id });
  const unsubscribeActivation = controller.subscribeActivation((entity) => {
    if (disposed) return;

    const publicEntity = copyEntity(entity);
    try {
      if (selectOnActivate) controller.setSelection(publicEntity);
    } finally {
      onActivate?.(publicEntity);
    }
  });

  return Object.freeze({
    nodeCount,
    edgeCount,
    center: () => {
      assertActive();
      controller.centerContent();
    },
    setSelection: (selection: CanvasEntityReference | null) => {
      assertActive();
      controller.setSelection(selection === null ? null : copyEntity(selection));
    },
    dispose: () => {
      if (disposed) return;

      disposed = true;
      try {
        unsubscribeActivation();
      } finally {
        controller.dispose();
      }
    },
  });
}
