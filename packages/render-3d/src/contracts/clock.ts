/**
 * The engine's time authority.
 *
 * Nothing time-driven may read `performance.now` or drive itself from
 * `requestAnimationFrame` directly. Everything reads simulation time from a
 * clock, which is what makes pausing, slow motion, and discrete turn stepping
 * a property of the engine rather than a feature each caller reimplements.
 *
 * Real time and simulation time are deliberately separate. A paused clock
 * still reports real time advancing, so a camera can keep moving, a hover
 * highlight can keep responding, and a frame can still be drawn while the
 * simulated world is frozen.
 */

/** How a clock is currently producing simulation time. */
export type ClockMode =
  /** Simulation time follows real time, scaled by {@link Clock.rate}. */
  | "running"
  /** Simulation time is frozen. Only {@link Clock.advance} moves it. */
  | "paused";

/** One observation of time, handed to every listener on a frame. */
export interface ClockTick {
  /** Monotonic frame counter, incremented once per {@link Clock.sample}. */
  readonly frame: number;
  /** Wall-clock milliseconds since the clock was created. Advances while paused. */
  readonly realElapsed: number;
  /** Wall-clock milliseconds since the previous sample. Advances while paused. */
  readonly realDelta: number;
  /** Simulated milliseconds since the clock was created. Frozen while paused. */
  readonly simElapsed: number;
  /**
   * Simulated milliseconds since the previous sample. Always `0` while paused,
   * except on the sample that follows an explicit {@link Clock.advance}.
   */
  readonly simDelta: number;
}

/** Time source shared by animation, simulation, and any caller-owned stepping. */
export interface Clock {
  /** Current mode. */
  readonly mode: ClockMode;
  /** Simulation-time multiplier while running. `1` is real time; `0.25` is quarter speed. */
  readonly rate: number;
  /** The most recent tick, or the zero tick before the first sample. */
  readonly last: ClockTick;

  /** Resumes simulation time. No-op when already running. */
  play(): void;
  /** Freezes simulation time. Real time keeps advancing. No-op when already paused. */
  pause(): void;
  /** Sets the simulation-time multiplier. Must be finite and non-negative. */
  setRate(rate: number): void;
  /**
   * Injects a fixed simulation step, independent of mode and rate.
   *
   * This is the turn-based entry point: a caller that never calls
   * {@link Clock.play} drives the whole world by resolving a turn into a
   * single `advance`, and gets identical animation behaviour to a real-time
   * caller without the engine knowing which it is.
   */
  advance(simMilliseconds: number): void;
  /**
   * Produces the next tick from a real-time reading, in milliseconds.
   *
   * Called once per frame by whoever owns the frame loop. Any simulation time
   * queued by {@link Clock.advance} is released into this tick's `simDelta`.
   */
  sample(realNow: number): ClockTick;
}
