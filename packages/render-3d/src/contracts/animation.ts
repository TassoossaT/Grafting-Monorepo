import type { ChangeOrigin, Scene } from "./scene.js";

/**
 * Animation is defined as "a function of simulated progress that writes to the
 * scene", and nothing more.
 *
 * That definition is what makes pause, slow motion, and discrete turns free
 * rather than special cases: a track never reads real time, so it cannot tell
 * whether its progress came from a real-time frame or from a single
 * {@link Clock.advance} resolving an entire turn at once.
 */
export type TrackId = string;

/** Maps linear progress to eased progress. Both in `0..1`. */
export type Easing = (t: number) => number;

/** One time-driven change to the scene. */
export interface AnimationTrack {
  readonly id: TrackId;
  /** Simulated milliseconds from start to completion. Must be greater than zero. */
  readonly durationMs: number;
  /** Whether the track restarts on completion instead of finishing. Defaults to `false`. */
  readonly loop?: boolean;
  /** Applied to progress before {@link AnimationTrack.apply}. Linear when omitted. */
  readonly easing?: Easing;
  /**
   * Writes this track's state for the given eased progress.
   *
   * Called with `1` exactly once on completion, so a track never has to
   * defend against ending slightly short of its final value.
   */
  apply(progress: number, scene: Scene): void;
  /** Called once after the final `apply`, for a track that needs to clean up. */
  onComplete?(scene: Scene): void;
}

/** A track in flight. */
export interface RunningTrack {
  readonly id: TrackId;
  /** Simulated milliseconds elapsed within the track. */
  readonly elapsedMs: number;
  /** Linear progress in `0..1`, before easing. */
  readonly progress: number;
}

/** Drives tracks from simulated time and writes their results into a scene. */
export interface Animator {
  /**
   * Starts a track, replacing any running track with the same id.
   *
   * Replacement rather than stacking is deliberate: two tracks writing the
   * same property is a bug that is very hard to see and trivial to cause.
   */
  play(track: AnimationTrack): void;
  /** Stops a track. `settle` applies its final value first. Returns whether it was running. */
  stop(id: TrackId, settle?: boolean): boolean;
  /** Whether a track is currently running. */
  isPlaying(id: TrackId): boolean;
  /** Every track in flight. */
  running(): readonly RunningTrack[];
  /**
   * Advances every track by a simulated interval and applies the results.
   *
   * The engine calls this once per frame with the clock's `simDelta`, which is
   * `0` while paused. Callers driving their own loop may call it directly.
   */
  advance(simDeltaMs: number): void;
  /** Stops every track without settling. */
  clear(): void;
  /** The origin recorded for scene writes made by tracks. Always `"engine"`. */
  readonly origin: ChangeOrigin;
}
