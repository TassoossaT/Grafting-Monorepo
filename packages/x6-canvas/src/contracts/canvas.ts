import type { CanvasEntityReference } from "../index.js";

/** Internal lifecycle contract between the vendor canvas and immutable handle. */
export interface CanvasController {
  centerContent(): void;
  setSelection(selection: CanvasEntityReference | null): void;
  subscribeActivation(listener: (entity: CanvasEntityReference) => void): () => void;
  dispose(): void;
}
