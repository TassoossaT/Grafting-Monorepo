import type { Clock, ClockMode, ClockTick } from "../contracts/clock.js";

const ZERO_TICK: ClockTick = Object.freeze({
  frame: 0,
  realElapsed: 0,
  realDelta: 0,
  simElapsed: 0,
  simDelta: 0,
});

/**
 * Caps the simulated step a single frame may produce.
 *
 * A backgrounded tab resumes with a multi-second real delta. Without a ceiling
 * that arrives as one enormous simulation step, teleporting everything mid-flight
 * instead of animating it. Queued {@link Clock.advance} time is deliberately
 * exempt: a caller that asks for a ten-second step means it.
 */
const MAX_FRAME_SIM_DELTA_MS = 250;

/** Options for {@link createClock}. */
export interface ClockOptions {
  /** Whether simulation time starts advancing. Defaults to `true`. */
  readonly autoplay?: boolean;
  /** Initial simulation-time multiplier. Defaults to `1`. */
  readonly rate?: number;
}

/**
 * Creates the engine's time authority.
 *
 * A real-time caller calls {@link Clock.sample} once a frame and never touches
 * anything else. A turn-based caller creates the clock paused and calls
 * {@link Clock.advance} when a turn resolves. Both produce the same tick shape,
 * so nothing downstream needs to know which one it is serving.
 */
export function createClock(options: ClockOptions = {}): Clock {
  let mode: ClockMode = options.autoplay === false ? "paused" : "running";
  let rate = normalizeRate(options.rate ?? 1);
  let last: ClockTick = ZERO_TICK;
  let realOrigin: number | undefined;
  let previousReal = 0;
  let queuedSim = 0;

  return {
    get mode() {
      return mode;
    },
    get rate() {
      return rate;
    },
    get last() {
      return last;
    },

    play() {
      mode = "running";
    },

    pause() {
      mode = "paused";
    },

    setRate(next: number) {
      rate = normalizeRate(next);
    },

    advance(simMilliseconds: number) {
      if (!Number.isFinite(simMilliseconds) || simMilliseconds <= 0) return;
      queuedSim += simMilliseconds;
    },

    sample(realNow: number): ClockTick {
      if (!Number.isFinite(realNow)) return last;

      // The first sample defines the origin, so `realElapsed` measures from the
      // first frame rather than from whatever epoch the host's timer uses.
      if (realOrigin === undefined) {
        realOrigin = realNow;
        previousReal = realNow;
      }

      const realElapsed = Math.max(0, realNow - realOrigin);
      const realDelta = Math.max(0, realNow - previousReal);
      previousReal = realNow;

      let simDelta = queuedSim;
      queuedSim = 0;
      if (mode === "running") {
        simDelta += Math.min(realDelta, MAX_FRAME_SIM_DELTA_MS) * rate;
      }

      last = Object.freeze({
        frame: last.frame + 1,
        realElapsed,
        realDelta,
        simElapsed: last.simElapsed + simDelta,
        simDelta,
      });
      return last;
    },
  };
}

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError(`Clock rate must be a finite, non-negative number; received ${rate}`);
  }
  return rate;
}
