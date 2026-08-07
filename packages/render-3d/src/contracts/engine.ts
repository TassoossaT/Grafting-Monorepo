import type { Animator } from "./animation.js";
import type { Clock, ClockTick } from "./clock.js";
import type { Scene } from "./scene.js";
import type { Vec3 } from "./space.js";
import type { VisualRegistry } from "./visual.js";
import type { View, ViewOptions } from "./view.js";

/** Scene lighting, as data. The engine ships no default lighting rig of its own. */
export type LightDescriptor =
  | { readonly light: "ambient"; readonly color?: number; readonly intensity?: number }
  | {
      readonly light: "directional";
      readonly color?: number;
      readonly intensity?: number;
      readonly direction: Vec3;
    }
  | {
      readonly light: "point";
      readonly color?: number;
      readonly intensity?: number;
      readonly position: Vec3;
      readonly distance?: number;
    };

/** What the engine did during one frame. Reported for measurement, not for control flow. */
export interface FrameReport {
  readonly tick: ClockTick;
  /** Views actually redrawn this frame. */
  readonly viewsDrawn: number;
  /** Views skipped because nothing they draw had changed. */
  readonly viewsSkipped: number;
  /** Item visuals rebuilt this frame. */
  readonly visualsRebuilt: number;
}

/** Called after every frame the engine runs. */
export type FrameObserver = (report: FrameReport) => void;

/** Everything needed to stand an engine up. */
export interface EngineOptions {
  /** Shared visual kinds. A private empty registry is created when omitted. */
  readonly registry?: VisualRegistry;
  /** Initial lighting. Unlit materials do not require any. */
  readonly lights?: readonly LightDescriptor[];
  /** Device pixel ratio ceiling. Defaults to `2`. */
  readonly maxPixelRatio?: number;
  /** Whether the clock starts running. Defaults to `true`; a turn-based caller passes `false`. */
  readonly autoplay?: boolean;
}

/**
 * One graphics context, one world, many views.
 *
 * The engine owns the frame loop and decides what is worth redrawing. It has
 * no opinion about what the world contains: every drawable thing arrives
 * through a visual kind registered from outside, every draw group is named by
 * the caller, and every unit of time comes from a clock the caller can pause
 * or step by hand.
 */
export interface RenderEngine {
  /** The mutable world. */
  readonly scene: Scene;
  /** The time authority. */
  readonly clock: Clock;
  /** Time-driven writers into the scene. */
  readonly animator: Animator;
  /** Visual kinds available to this engine's items. */
  readonly registry: VisualRegistry;

  /** Replaces the lighting. Marks every lit view dirty. */
  setLights(lights: readonly LightDescriptor[]): void;

  /** Opens a view. Every view shares this engine's single graphics context. */
  createView(options: ViewOptions): View;
  /** Every open view, in creation order. */
  views(): readonly View[];

  /** Begins driving frames from the host's animation frames. */
  start(): void;
  /** Stops driving frames. Views keep their last drawn output. */
  stop(): void;
  /**
   * Runs exactly one frame at the given real-time reading.
   *
   * The way to drive the engine from a host-owned loop, from a fixed-step
   * simulation, or from a test that needs frames to be deterministic rather
   * than however often the browser felt like scheduling one.
   */
  frame(realNow: number): FrameReport;

  /** Subscribes to frame reports. Returns an unsubscribe function. */
  observeFrames(observer: FrameObserver): () => void;

  /** Stops the loop and releases the graphics context, every view, and every built visual. */
  dispose(): void;
}
