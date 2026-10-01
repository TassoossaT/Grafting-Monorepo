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
  "./tools/core/edge-overlay.ts": "export const edgeOverlayOf=()=>[]; export const edgeOverlayChannel=(v)=>v; export const edgeOverlayDescriptor=(v)=>v;",
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
function table({ camera = 10, ...options } = {}) {
  const mpp = metersPerPixel(camera);
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  addFace(runtime, "floor", "platform", [
    { id: "f:0", position: { x: 0, y: 0, z: 0 } }, { id: "f:1", position: { x: 4, y: 0, z: 0 } },
    { id: "f:2", position: { x: 4, y: 0, z: 3 } }, { id: "f:3", position: { x: 0, y: 0, z: 3 } },
  ]);
  const effects = [], listeners = new Map(), seen = { down: [], up: [], cancelled: 0, scale: [] };
  const oldWindow = globalThis.window, oldHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = class {};
  globalThis.window = { addEventListener: (k, f) => listeners.set(k, f), removeEventListener: (k) => listeners.delete(k) };
  const tool = {
    id: "probe",
    defaultParams: () => ({}),
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
    clearPreview() {}, showPreview() {},
  });
  const target = {
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
  return { handlers, event, key, seen, readouts, done, mpp };
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
