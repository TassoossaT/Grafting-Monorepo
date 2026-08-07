import type { Animator, AnimationTrack, RunningTrack, TrackId } from "../contracts/animation.js";
import type { Scene } from "../contracts/scene.js";

interface TrackState {
  readonly track: AnimationTrack;
  elapsedMs: number;
}

/**
 * Creates the driver that turns simulated time into scene writes.
 *
 * It never reads a real clock. Everything it does is a pure function of the
 * interval it is handed, so the same track produces the same result whether
 * that interval arrived as sixty small real-time steps or as one deliberate
 * turn-sized step.
 */
export function createAnimator(scene: Scene): Animator {
  const running = new Map<TrackId, TrackState>();

  function applyAt(state: TrackState, linearProgress: number): void {
    const eased = state.track.easing ? state.track.easing(linearProgress) : linearProgress;
    state.track.apply(eased, scene);
  }

  return {
    origin: "engine",

    play(track: AnimationTrack) {
      if (!Number.isFinite(track.durationMs) || track.durationMs <= 0) {
        throw new RangeError(
          `Track "${track.id}" needs a positive, finite durationMs; received ${track.durationMs}`,
        );
      }
      running.set(track.id, { track, elapsedMs: 0 });
    },

    stop(id: TrackId, settle = false) {
      const state = running.get(id);
      if (state === undefined) return false;
      running.delete(id);
      if (settle) {
        applyAt(state, 1);
        state.track.onComplete?.(scene);
      }
      return true;
    },

    isPlaying(id: TrackId) {
      return running.has(id);
    },

    running(): readonly RunningTrack[] {
      return [...running.values()].map((state) => ({
        id: state.track.id,
        elapsedMs: state.elapsedMs,
        progress: Math.min(1, state.elapsedMs / state.track.durationMs),
      }));
    },

    advance(simDeltaMs: number) {
      if (!Number.isFinite(simDeltaMs) || simDeltaMs <= 0 || running.size === 0) return;

      // One batch for the whole pass: a turn that moves twenty things should
      // notify once and redraw once, not twenty times.
      scene.batch(() => {
        for (const state of [...running.values()]) {
          state.elapsedMs += simDeltaMs;
          const { track } = state;

          if (state.elapsedMs < track.durationMs) {
            applyAt(state, state.elapsedMs / track.durationMs);
            continue;
          }

          if (track.loop === true) {
            // Carry the remainder instead of resetting to zero, so a looping
            // track does not drift slower than its stated duration.
            state.elapsedMs %= track.durationMs;
            applyAt(state, state.elapsedMs / track.durationMs);
            continue;
          }

          applyAt(state, 1);
          running.delete(track.id);
          track.onComplete?.(scene);
        }
      }, "engine");
    },

    clear() {
      running.clear();
    },
  };
}
