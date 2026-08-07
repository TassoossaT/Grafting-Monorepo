import type { LayerId } from "./scene.js";
import type { Vec3 } from "./space.js";

/** Caller-chosen identity for a view. */
export type ViewId = string;

/** How a view projects the world. Plain data; no renderer camera type is exposed. */
export type CameraDescriptor =
  | {
      readonly projection: "perspective";
      /** Vertical field of view in degrees. Defaults to `45`. */
      readonly fov?: number;
      readonly position: Vec3;
      readonly target: Vec3;
      readonly near?: number;
      readonly far?: number;
      readonly up?: Vec3;
    }
  | {
      readonly projection: "orthographic";
      /** Half-height of the visible volume in world units. Width follows the aspect ratio. */
      readonly extent: number;
      readonly position: Vec3;
      readonly target: Vec3;
      readonly near?: number;
      readonly far?: number;
      readonly up?: Vec3;
    };

/** What a pointer hit. */
export interface PickResult {
  /** Which item was hit. */
  readonly itemId: string;
  /** The layer that item belongs to. */
  readonly layer: LayerId;
  /** World-space intersection point. */
  readonly point: Vec3;
  /** Distance from the camera, in world units. */
  readonly distance: number;
  /** The item's opaque caller data, carried through unchanged. */
  readonly data?: unknown;
}

/** Everything needed to open a view onto the scene. */
export interface ViewOptions {
  /** Caller-chosen identity. Generated when omitted. */
  readonly id?: ViewId;
  /** Element that receives the view's output surface. Its contents are replaced. */
  readonly target: HTMLElement;
  /** How this view projects the world. */
  readonly camera: CameraDescriptor;
  /**
   * Which layers this view draws, in the scene's order.
   *
   * Omitting it draws every layer. Naming them explicitly is what lets the
   * engine skip a view entirely when the only thing that changed lives in a
   * layer this view never shows.
   */
  readonly layers?: readonly LayerId[];
  /** Background color. A transparent view is drawn when omitted. */
  readonly background?: number;
  /** Initial size in CSS pixels. Measured from `target` when omitted. */
  readonly width?: number;
  /** Initial height in CSS pixels. Measured from `target` when omitted. */
  readonly height?: number;
}

/**
 * One camera onto the scene.
 *
 * Views are the reason a scene with many rendered elements needs one engine
 * rather than many: every view in an engine shares a single graphics context,
 * so the number of views is bounded by memory rather than by the browser's cap
 * on live contexts, which is silently enforced by dropping the oldest.
 */
export interface View {
  /** This view's identity, as supplied or generated. */
  readonly id: ViewId;
  /** Current width in CSS pixels. */
  readonly width: number;
  /** Current height in CSS pixels. */
  readonly height: number;

  /** Repoints the camera. Marks only this view dirty. */
  setCamera(camera: CameraDescriptor): void;
  /** Changes which layers are drawn. Marks only this view dirty. */
  setLayers(layers: readonly LayerId[] | undefined): void;
  /**
   * Changes the output size.
   *
   * A resize is routine — a window, a panel, a zoom — so it is a first-class
   * operation rather than a reason to tear the view down and rebuild it.
   */
  resize(width: number, height: number): void;
  /** Marks the view as needing a redraw on the next frame. */
  invalidate(): void;
  /** Shows or hides the view without disposing it. A hidden view costs nothing per frame. */
  setActive(active: boolean): void;

  /** Resolves a pointer position in the view's CSS pixels to what it hit. */
  pick(x: number, y: number): PickResult | undefined;
  /** Captures the last drawn frame as a data URL. */
  capture(mimeType?: string): string;

  /** Releases the view's surface. The engine and its other views are unaffected. */
  dispose(): void;
}
