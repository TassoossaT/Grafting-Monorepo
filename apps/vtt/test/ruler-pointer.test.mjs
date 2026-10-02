import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";
import { DEFAULT_RULER_SETTINGS, DEFAULT_TOOL_PARAMS } from "../src/features/edit-construction/index.ts";

// The real pointer hook, mounted without a DOM renderer -- the same harness as `platform-pointer.test.mjs`.
const hookUrl = new URL("../src/composition/tabletop/use-construction-pointer.ts", import.meta.url).href;
const modules = {
  react: "export const useRef=(v)=>({current:v}); export const useCallback=(f)=>f; export const useMemo=(f)=>f(); export const useEffect=(f)=>globalThis.__rulerHook.effects.push(f);",
  "@/ports": 'export const TOOL_GHOST_PREVIEW_CHANNEL="ghost";',
  "../../adapters/rendering/index.ts": "export const VIEW_FOV_DEGREES=38;",
  "./tools/index.ts": "export const toolFor=()=>globalThis.__rulerHook.tool;",
};
const hooks = registerHooks({ resolve(spec, context, next) {
  if (context.parentURL === hookUrl && modules[spec]) return { url: "data:text/javascript," + encodeURIComponent(modules[spec]), shortCircuit: true };
  return next(spec, context);
} });
const { useConstructionPointer } = await import(hookUrl);
hooks.deregister();

const HEIGHT = 1000;
const FOV = 38;
/** What the camera's lens makes a pixel, `camera` metres above the ground, on a screen `HEIGHT` tall. */
const metersPerPixel = (camera) => (2 * camera * Math.tan((FOV * Math.PI) / 360)) / HEIGHT;

/** A table with one floor 0..4 by 0..3, a probe tool that records what it is handed, and the real hook over them. */
function table({ camera = 10, anchor, ...options } = {}) {
  const mpp = metersPerPixel(camera);
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  addFace(runtime, "floor", "platform", [
    { id: "f:0", position: { x: 0, y: 0, z: 0 } }, { id: "f:1", position: { x: 4, y: 0, z: 0 } },
    { id: "f:2", position: { x: 4, y: 0, z: 3 } }, { id: "f:3", position: { x: 0, y: 0, z: 3 } },
  ]);
  const effects = [], listeners = new Map(), seen = { down: [], up: [], hover: [], shown: [], labels: [], cleared: [], cancelled: 0, scale: [] };
  // Where the tool's own line begins while it waits for its next point; settable, like a draft growing.
  const state = { anchor };
  const oldWindow = globalThis.window, oldHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = class {};
  globalThis.window = { addEventListener: (k, f) => listeners.set(k, f), removeEventListener: (k) => listeners.delete(k) };
  const tool = {
    id: "probe",
    defaultParams: () => ({}),
    previewOnHover: true,
    rulerAnchor: () => state.anchor,
    previewFor(gesture) { seen.hover.push(gesture.current); return undefined; },
    onPointerDown(ctx, sample) { seen.down.push(sample); seen.scale.push(ctx.rulerMetersPerPixel); seen.snap = ctx.rulerSnap; },
    onPointerMove() {},
    onPointerUp(_ctx, gesture) { seen.up.push(gesture.current); },
    onCancel() { seen.cancelled += 1; },
  };
  globalThis.__rulerHook = { effects, tool };
  Object.assign(runtime, {
    getSnapshot: () => ({ status: "ready", tableId: "ruler", map: { nodePositions: new Map() } }),
    subscribe: () => () => {},
    // The ground under a camera `camera` metres straight above the pointer: a pixel is as many metres as the lens makes it.
    pick: (_view, x, z) => ({ point: { x: x * mpp, y: 0, z: z * mpp }, ray: { origin: { x: x * mpp, y: camera, z: z * mpp }, direction: { x: 0, y: -1, z: 0 } } }),
    clearPreview(channel) { seen.cleared.push(channel); }, showPreview(descriptor, channel) { seen.shown.push({ descriptor, channel }); },
    showLabels(labels, channel) { seen.labels.push({ labels, channel }); },
  });
  const target = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, height: HEIGHT }),
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
  };
  const readouts = [];
  const handlers = useConstructionPointer({
    activeTool: "probe", toolParams: DEFAULT_TOOL_PARAMS, runtime, history: fixture.ctx.history, tableId: "ruler", viewId: "view",
    measureUnit: "m", structureEditParams: { mode: "shape" }, onSelectionChange() {}, onFeedbackChange() {},
    onRulerReadout: (readout) => readouts.push(readout), ...options,
  });
  const cleanups = effects.map((effect) => effect());
  /** A pointer event at `x`, `z` metres of the ground -- the pixels that put it there. */
  const event = (x, z, extra = {}) => ({ button: 0, pointerId: 1, currentTarget: target, clientX: x / mpp, clientY: z / mpp, ...extra });
  const key = (name) => { let prevented = false; listeners.get("keydown")({ key: name, preventDefault() { prevented = true; } }); return prevented; };
  const done = () => {
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
    globalThis.window = oldWindow; globalThis.HTMLElement = oldHTMLElement; delete globalThis.__rulerHook;
    session.free();
  };
  return { handlers, event, key, seen, readouts, done, mpp, state, runtimeOf: () => runtime };
}

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message ?? ""} ${a} != ${b}`);

test("a press near a corner lands on it before the tool sees it, and Ctrl places freely", () => {
  const t = table();
  try {
    // 4.05 m, 0.04 m: a few pixels off the floor's corner at (4, 0).
    t.handlers.onPointerDown(t.event(4.05, 0.04));
    near(t.seen.down[0].point.x, 4); near(t.seen.down[0].point.z, 0);
    t.handlers.onPointerUp(t.event(4.05, 0.04));
    t.handlers.onPointerDown(t.event(4.05, 0.04, { ctrlKey: true }));
    near(t.seen.down[1].point.x, 4.05, "Ctrl: where the pointer is"); near(t.seen.down[1].point.z, 0.04);
    assert.equal(t.seen.snap, false);
    // Cmd does the same, for those who have no Ctrl to hold.
    t.handlers.onPointerUp(t.event(4.05, 0.04, { ctrlKey: true }));
    t.handlers.onPointerDown(t.event(4.05, 0.04, { metaKey: true }));
    near(t.seen.down[2].point.x, 4.05);
  } finally { t.done(); }
});

test("the reach is a few pixels of the screen: the same spot catches zoomed out and not zoomed in", () => {
  // (4.2, 0.3) is 0.36 m from the corner at (4, 0): 52 pixels close up, 13 pixels from far away.
  const close = table({ camera: 10 });
  try {
    close.handlers.onPointerDown(close.event(4.2, 0.3));
    near(close.seen.down[0].point.x, 4.2, "52 pixels off: out of reach");
    near(close.seen.scale[0], close.mpp, "the pixel's size is what the lens makes it");
  } finally { close.done(); }
  const far = table({ camera: 40 });
  try {
    far.handlers.onPointerDown(far.event(4.2, 0.3));
    near(far.seen.down[0].point.x, 4, "13 pixels off: caught");
    near(far.seen.down[0].point.z, 0);
  } finally { far.done(); }
});

test("a line drawn near a step of the protractor is turned onto it, keeping its length; Shift offers the finer five degrees", () => {
  const t = table();
  try {
    const heading = (44 * Math.PI) / 180;
    // Far from the floor: 10 m out, 44 degrees round from the east.
    t.handlers.onPointerDown(t.event(10, 10));
    const end = { x: 10 + 10 * Math.cos(heading), z: 10 + 10 * Math.sin(heading) };
    t.handlers.onPointerMove(t.event(end.x, end.z));
    t.handlers.onPointerUp(t.event(end.x, end.z));
    const made = t.seen.up[0].point;
    near(Math.atan2(made.z - 10, made.x - 10), Math.PI / 4, "on a step of 15 degrees: 45");
    near(Math.hypot(made.x - 10, made.z - 10), 10, "as long as it was");
    // 20.8 degrees is on no step of 15; with Shift the steps are 5, and 20 is one.
    const off = (20.8 * Math.PI) / 180;
    const aim = { x: 10 + 10 * Math.cos(off), z: 10 + 10 * Math.sin(off) };
    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerUp(t.event(aim.x, aim.z));
    near(Math.atan2(t.seen.up[1].point.z - 10, t.seen.up[1].point.x - 10), off, "no step of 15 near 20.8 degrees");
    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerUp(t.event(aim.x, aim.z, { shiftKey: true }));
    near(Math.atan2(t.seen.up[2].point.z - 10, t.seen.up[2].point.x - 10), (20 * Math.PI) / 180, "Shift: the 20 degree step");
  } finally { t.done(); }
});

test("a length typed while drawing sets exactly how long the line is, the way the pointer points", () => {
  const t = table();
  try {
    t.handlers.onPointerDown(t.event(10, 10));
    // Pointing east, 3 m out; then 5 is typed.
    t.handlers.onPointerMove(t.event(13, 10));
    assert.equal(t.key("5"), true, "a digit is taken, not left to the tool");
    t.handlers.onPointerUp(t.event(13, 10));
    near(t.seen.up[0].point.x, 15); near(t.seen.up[0].point.z, 10);
    // The number says what it is, ahead of the rest.
    assert.ok(t.readouts.filter(Boolean).some((r) => r.labels[0] === "digitando 5m"), JSON.stringify(t.readouts));
  } finally { t.done(); }
});

test("typed digits build a decimal, Backspace takes the last off, Escape clears it without cancelling the tool", () => {
  const t = table();
  try {
    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerMove(t.event(13, 10));
    for (const k of ["2", ",", "5"]) t.key(k);
    t.handlers.onPointerUp(t.event(13, 10));
    near(t.seen.up[0].point.x, 12.5, "2.5 m, a comma read as the point");

    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerMove(t.event(13, 10));
    for (const k of ["2", "0", "Backspace"]) t.key(k);
    t.handlers.onPointerUp(t.event(13, 10));
    near(t.seen.up[1].point.x, 12, "20, less its last digit, is 2");

    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerMove(t.event(13, 10));
    t.key("9");
    assert.equal(t.key("Escape"), true, "Escape clears the number");
    assert.equal(t.seen.cancelled, 0, "and does not cancel the tool");
    t.handlers.onPointerUp(t.event(13, 10));
    near(t.seen.up[2].point.x, 13, "with nothing typed the line is where the pointer put it");
  } finally { t.done(); }
});

test("with nothing being drawn, digits are not a length: they are left to everything else", () => {
  const t = table();
  try {
    assert.equal(t.key("5"), false);
  } finally { t.done(); }
});

test("the table's unit is what a typed number means", () => {
  const t = table({ measureUnit: "ft" });
  try {
    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerMove(t.event(13, 10));
    t.key("1"); t.key("0");
    t.handlers.onPointerUp(t.event(13, 10));
    near(t.seen.up[0].point.x, 10 + 10 * 0.3048, "ten feet, in metres");
  } finally { t.done(); }
});

test("a way of catching the table left out does not catch", () => {
  const t = table({ rulerSettings: { ...DEFAULT_RULER_SETTINGS, disabled: new Set(["corner", "midpoint", "side", "square", "align", "intersection"]) } });
  try {
    t.handlers.onPointerDown(t.event(4.05, 0.04));
    near(t.seen.down[0].point.x, 4.05, "no corner, no side, no lines: the pointer stays");
  } finally { t.done(); }
});

test("the table's angle step is what the protractor offers: five degrees catches what fifteen does not", () => {
  const aim = (degrees) => ({ x: 10 + 10 * Math.cos((degrees * Math.PI) / 180), z: 10 + 10 * Math.sin((degrees * Math.PI) / 180) });
  const by15 = table();
  try {
    by15.handlers.onPointerDown(by15.event(10, 10));
    by15.handlers.onPointerUp(by15.event(aim(20.2).x, aim(20.2).z));
    near(Math.atan2(by15.seen.up[0].point.z - 10, by15.seen.up[0].point.x - 10), (20.2 * Math.PI) / 180, "20 is no step of 15");
  } finally { by15.done(); }
  const by5 = table({ rulerSettings: { ...DEFAULT_RULER_SETTINGS, angleStep: 5 } });
  try {
    by5.handlers.onPointerDown(by5.event(10, 10));
    by5.handlers.onPointerUp(by5.event(aim(20.2).x, aim(20.2).z));
    near(Math.atan2(by5.seen.up[0].point.z - 10, by5.seen.up[0].point.x - 10), (20 * Math.PI) / 180, "but it is one of 5");
  } finally { by5.done(); }
});

test("a round number chosen by the table is what a length lands on: whole units, or fives, in the table's unit", () => {
  const whole = table({ rulerSettings: { ...DEFAULT_RULER_SETTINGS, lengthStep: 1 } });
  try {
    whole.handlers.onPointerDown(whole.event(10, 10));
    // Far from the floor's own sides (3 and 4 m), so only the round number can catch.
    whole.handlers.onPointerUp(whole.event(16.04, 10));
    near(whole.seen.up[0].point.x, 16, "6.04 m lands on 6");
    whole.handlers.onPointerDown(whole.event(10, 10));
    whole.handlers.onPointerUp(whole.event(16.5, 10));
    near(whole.seen.up[1].point.x, 16.5, "6.5 m is no whole number: left alone");
  } finally { whole.done(); }
  // In feet, by fives: 19.97 ft is a hair short of twenty.
  const feet = table({ measureUnit: "ft", rulerSettings: { ...DEFAULT_RULER_SETTINGS, lengthStep: 5 } });
  try {
    feet.handlers.onPointerDown(feet.event(10, 10));
    feet.handlers.onPointerUp(feet.event(10 + 19.97 * 0.3048, 10));
    near(feet.seen.up[0].point.x, 10 + 20 * 0.3048, "twenty feet, by fives");
  } finally { feet.done(); }
  // Off: lengths are as drawn.
  const off = table();
  try {
    off.handlers.onPointerDown(off.event(10, 10));
    off.handlers.onPointerUp(off.event(16.04, 10));
    near(off.seen.up[0].point.x, 16.04);
  } finally { off.done(); }
});

test("the line that follows the pointer between clicks is ruled like one dragged: counted from the tool's own anchor, no button down", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 } });
  try {
    const heading = (44 * Math.PI) / 180;
    // No press: the pointer only moves, 10 m out and 44 degrees round from the anchor.
    t.handlers.onPointerMove(t.event(10 + 10 * Math.cos(heading), 10 + 10 * Math.sin(heading)));
    const seen = t.seen.hover.at(-1).point;
    near(Math.atan2(seen.z - 10, seen.x - 10), Math.PI / 4, "on the 45 degree step of the line from the anchor");
    near(Math.hypot(seen.x - 10, seen.z - 10), 10, "as long as it was");
  } finally { t.done(); }
});

test("that line has its teeth and its protractor, drawn on the ruler's own channel", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 }, rulerSettings: { ...DEFAULT_RULER_SETTINGS, lengthStep: 1 } });
  try {
    t.handlers.onPointerMove(t.event(16.5, 10));
    const drawn = t.seen.shown.filter((entry) => entry.channel === "ruler-guides").at(-1);
    assert.ok(drawn, "the ruler drew");
    // Six teeth along 6.5 m, whole metres, and the protractor's marks round the anchor: well over the teeth alone.
    assert.ok(drawn.descriptor.positions.length / 6 > 6 + 18, `segments: ${drawn.descriptor.positions.length / 6}`);
    assert.ok(t.readouts.filter(Boolean).some((r) => r.labels.some((label) => label.includes("6.50 m"))), JSON.stringify(t.readouts));
  } finally { t.done(); }
});

test("a length typed between clicks shapes the line to the pointer, and the click that follows lands exactly there", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 } });
  try {
    t.handlers.onPointerMove(t.event(13, 10));
    // No gesture: the tool's anchor is what says a line is under way, and the digit is its length.
    assert.equal(t.key("5"), true, "taken as the length of the line");
    near(t.seen.hover.at(-1).point.x, 15, "applied at once, with the pointer still");
    t.handlers.onPointerDown(t.event(13, 10));
    near(t.seen.down.at(-1).point.x, 15, "the click lands where the typed length put it");
    t.handlers.onPointerUp(t.event(13, 10));
    // The number is spent with the click: the next line is free again.
    t.handlers.onPointerDown(t.event(13, 10));
    near(t.seen.down.at(-1).point.x, 13);
  } finally { t.done(); }
});

test("with the tool's anchor gone, the line is no longer counted from it, and digits are left alone", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 } });
  try {
    t.state.anchor = undefined;
    const heading = (44 * Math.PI) / 180;
    t.handlers.onPointerMove(t.event(10 + 10 * Math.cos(heading), 10 + 10 * Math.sin(heading)));
    near(Math.atan2(t.seen.hover.at(-1).point.z - 10, t.seen.hover.at(-1).point.x - 10), heading, "no step: nothing to count from");
    assert.equal(t.key("5"), false);
  } finally { t.done(); }
});

test("the numbers are written on the map, beside the one at the pointer: the value at the teeth, the length along the line", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 }, rulerSettings: { ...DEFAULT_RULER_SETTINGS, lengthStep: 1 } });
  try {
    t.handlers.onPointerMove(t.event(16.5, 10));
    const written = t.seen.labels.at(-1);
    assert.equal(written.channel, "ruler-labels");
    const texts = written.labels.map((label) => label.text);
    // 6.5 m: a number at the fifth tooth, and the length along the line -- which the pointer's readout says as well.
    assert.ok(texts.includes("5"), texts.join(" "));
    assert.ok(texts.some((text) => text.includes("6.50 m")), texts.join(" "));
    // They are on the map, in the same few pixels of height at any zoom.
    for (const label of written.labels) assert.ok(label.height > 0);
    assert.ok(t.readouts.filter(Boolean).some((r) => r.labels.some((label) => label.includes("6.50 m"))), "and the readout at the pointer still says it");
  } finally { t.done(); }
});

test("with the numbers turned off the map carries none -- and the pointer's readout stays", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 }, rulerSettings: { ...DEFAULT_RULER_SETTINGS, numbers: false } });
  try {
    t.handlers.onPointerMove(t.event(16.5, 10));
    assert.equal(t.seen.labels.length, 0);
    assert.ok(t.seen.cleared.includes("ruler-labels"));
    assert.ok(t.readouts.filter(Boolean).length > 0);
  } finally { t.done(); }
});

test("the numbers come down with the ruler: when the gesture ends, and when the tool changes", () => {
  const t = table({ anchor: { x: 10, y: 0, z: 10 } });
  try {
    t.handlers.onPointerMove(t.event(16.5, 10));
    t.seen.cleared.length = 0;
    t.handlers.onPointerDown(t.event(16.5, 10));
    t.handlers.onPointerUp(t.event(16.5, 10));
    assert.ok(t.seen.cleared.includes("ruler-labels"), "taken down with the gesture");
  } finally { t.done(); }
});

test("what the ruler shows is never worth the gesture: if drawing it fails, the tool still gets the pointer", () => {
  const t = table();
  const oldError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    t.handlers.onPointerDown(t.event(10, 10));
    // From here on, the ruler's lines cannot be put up.
    t.seen.shown.length = 0;
    // The runtime is the fixture's: make its preview refuse the ruler's channel.
    const refuse = (descriptor, channel) => { if (channel === "ruler-guides") throw new Error("the renderer is gone"); };
    t.runtimeOf().showPreview = refuse;
    t.handlers.onPointerMove(t.event(13, 10));
    t.handlers.onPointerUp(t.event(13, 10));
    near(t.seen.up[0].point.x, 13, "the release still reached the tool");
    assert.ok(errors.length > 0, "and the failure was said, not swallowed");
  } finally { console.error = oldError; t.done(); }
});

test("a unit left unnamed is the default one in every figure the ruler writes, and nothing throws", async () => {
  const { formatLength, fromMetres, toMetres } = await import("../src/features/edit-construction/index.ts");
  assert.equal(formatLength(3.048, undefined), "3.05 m");
  near(fromMetres(2, undefined), 2);
  near(toMetres(2, undefined), 2);
  near(fromMetres(1.524, "sq"), 1);
});

test("by default the table rounds a length to an easy number that follows the zoom: no 2.99, no 2.97", () => {
  // The defaults the app starts with: the automatic step. A camera ten metres up makes it a quarter of a metre.
  const t = table({ rulerSettings: DEFAULT_RULER_SETTINGS });
  try {
    t.handlers.onPointerDown(t.event(10, 10));
    // Far from the floor's own sides (3 and 4 m): 5.91 m out lands on 6; 5.97 as well; and 6.12 -- between two quarters -- is left as drawn.
    t.handlers.onPointerUp(t.event(15.91, 10));
    near(t.seen.up[0].point.x, 16, "5.91 m is 6");
    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerUp(t.event(15.97, 10));
    near(t.seen.up[1].point.x, 16, "5.97 m is 6");
    t.handlers.onPointerDown(t.event(10, 10));
    t.handlers.onPointerUp(t.event(16.12, 10));
    near(t.seen.up[2].point.x, 16.12, "6.12 m, between two quarters, stays free");
    // Zoomed out the step is coarser: from forty metres up it is a metre -- 5.9 lands on 6, and 5.6 does not.
    const far = table({ camera: 40, rulerSettings: DEFAULT_RULER_SETTINGS });
    try {
      far.handlers.onPointerDown(far.event(10, 10));
      far.handlers.onPointerUp(far.event(15.9, 10));
      near(far.seen.up[0].point.x, 16);
      far.handlers.onPointerDown(far.event(10, 10));
      far.handlers.onPointerUp(far.event(15.55, 10));
      near(far.seen.up[1].point.x, 15.55, "not near a round number");
    } finally { far.done(); }
  } finally { t.done(); }
});

test("a table that turned the round number off, or never gave settings, gets lengths as drawn", () => {
  for (const options of [{ rulerSettings: { ...DEFAULT_RULER_SETTINGS, lengthStep: 0 } }, {}]) {
    const t = table(options);
    try {
      t.handlers.onPointerDown(t.event(10, 10));
      t.handlers.onPointerUp(t.event(16.04, 10));
      near(t.seen.up[0].point.x, 16.04);
    } finally { t.done(); }
  }
});
