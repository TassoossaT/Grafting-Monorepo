interface CanvasController {
  centerContent(): void;
  dispose(): void;
}

export function createReadOnlyCanvasHandle(
  controller: CanvasController,
  nodeCount: number,
  edgeCount: number,
) {
  return Object.freeze({
    nodeCount,
    edgeCount,
    center: () => controller.centerContent(),
    dispose: () => controller.dispose(),
  });
}
