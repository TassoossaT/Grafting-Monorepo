import assert from "node:assert/strict";
import test from "node:test";

import { createAnimator, createClock, createScene } from "../dist/index.js";

/**
 * These cover the behaviour that makes the engine usable outside a real-time
 * product at all: that simulated time is separate from real time, and that a
 * turn resolved as one step produces the same result as the same interval
 * arriving frame by frame.
 */

test("a paused clock freezes simulation time while real time keeps advancing", () => {
  const clock = createClock({ autoplay: false });

  clock.sample(0);
  const tick = clock.sample(100);

  assert.equal(tick.realDelta, 100, "real time must advance while paused");
  assert.equal(tick.simDelta, 0, "simulation time must not advance while paused");
  assert.equal(tick.simElapsed, 0);
});

test("advance injects simulated time regardless of mode, releasing it on the next sample", () => {
  const clock = createClock({ autoplay: false });
  clock.sample(0);

  clock.advance(500);
  const tick = clock.sample(16);

  assert.equal(tick.simDelta, 500, "a queued step must survive being paused");
  assert.equal(clock.sample(32).simDelta, 0, "a step must be released exactly once");
});

test("rate scales simulated time without touching real time", () => {
  const clock = createClock();
  clock.setRate(0.5);
  clock.sample(0);

  const tick = clock.sample(100);

  assert.equal(tick.realDelta, 100);
  assert.equal(tick.simDelta, 50);
});

test("a long real gap cannot become one enormous simulated step", () => {
  const clock = createClock();
  clock.sample(0);

  // What a backgrounded tab produces on resume.
  const tick = clock.sample(9000);

  assert.equal(tick.realDelta, 9000, "the real gap is reported honestly");
  assert.ok(tick.simDelta <= 250, `simulated step was clamped, got ${tick.simDelta}`);
});

test("a track reaches the same state whether stepped once or frame by frame", () => {
  const positions = [];

  const buildScene = () => {
    const scene = createScene();
    scene.defineLayer({ id: "actors", order: 0 });
    scene.put({
      id: "a",
      layer: "actors",
      visual: { kind: "marker", params: {} },
      transform: { position: { x: 0, y: 0, z: 0 } },
    });
    return scene;
  };

  const track = (scene) => ({
    id: "slide",
    durationMs: 1000,
    apply(progress) {
      scene.setTransform("a", { position: { x: progress * 10, y: 0, z: 0 } }, "engine");
    },
  });

  // One decisive step, the way a resolved turn arrives.
  const stepped = buildScene();
  const steppedAnimator = createAnimator(stepped);
  steppedAnimator.play(track(stepped));
  steppedAnimator.advance(1000);
  positions.push(stepped.get("a").transform.position.x);

  // The same interval spread across sixty-odd real-time frames.
  const smooth = buildScene();
  const smoothAnimator = createAnimator(smooth);
  smoothAnimator.play(track(smooth));
  for (let i = 0; i < 1000; i += 16) smoothAnimator.advance(16);
  smoothAnimator.advance(1000);
  positions.push(smooth.get("a").transform.position.x);

  assert.deepEqual(positions, [10, 10], "both paths must land on the final value");
});

test("a completed track settles on exactly 1 and stops running", () => {
  const scene = createScene();
  scene.defineLayer({ id: "fx", order: 0 });
  scene.put({ id: "burst", layer: "fx", visual: { kind: "marker", params: {} } });

  const seen = [];
  const animator = createAnimator(scene);
  animator.play({
    id: "burst",
    durationMs: 100,
    apply(progress) {
      seen.push(progress);
    },
  });

  animator.advance(60);
  animator.advance(60);

  assert.equal(seen.at(-1), 1, "the final apply must be exactly 1, never 0.999…");
  assert.equal(animator.isPlaying("burst"), false);
});

test("a looping track carries its remainder instead of resetting to zero", () => {
  const scene = createScene();
  scene.defineLayer({ id: "fx", order: 0 });

  const seen = [];
  const animator = createAnimator(scene);
  animator.play({
    id: "ripple",
    durationMs: 100,
    loop: true,
    apply(progress) {
      seen.push(progress);
    },
  });

  animator.advance(130);

  assert.equal(seen.at(-1), 0.3, "the 30ms past the loop point must not be lost");
  assert.equal(animator.isPlaying("ripple"), true);
});
