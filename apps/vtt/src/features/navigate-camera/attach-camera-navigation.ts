import type { CameraControlHandle, CameraControlOptions, RenderViewId } from "@/ports";

/**
 * The minimum a target needs for this feature to drive its camera. A
 * structural type, not `TabletopRuntime` itself -- `composition` depends on
 * `features`, not the other way around, so this module cannot import the
 * concrete runtime type and instead accepts anything shaped like it.
 */
export interface CameraControllable {
  attachCameraControls(
    viewId: RenderViewId,
    element: HTMLElement,
    options?: CameraControlOptions,
  ): CameraControlHandle;
}

/**
 * This board's one fixed camera control scheme, chosen so the left mouse
 * button stays exclusively available to construction tools (`edit-construction`
 * already claims it for drag-to-move): right-button orbits, middle-button
 * pans, and an orbit-drag re-centers on whatever is under the cursor first --
 * the Tiny Glade convention from `docs/research/vtt-board-construction-mode-ui-references.md`.
 */
const CAMERA_SCHEME: CameraControlOptions = {
  orbitButton: 2,
  panButton: 1,
  pivot: "cursor",
};

/**
 * Wires camera navigation for one attached view. Returns a detach function --
 * callers MUST invoke it on unmount/view-detach, the same lifecycle discipline
 * `TabletopRuntime.attachView`'s own callers already follow.
 */
export function attachCameraNavigation(
  target: CameraControllable,
  viewId: RenderViewId,
  element: HTMLElement,
): () => void {
  const handle = target.attachCameraControls(viewId, element, CAMERA_SCHEME);
  return () => handle.dispose();
}
