import { Object3D, type Camera, type Scene } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { PointManipulator } from "../../contracts/view.js";

/** Official Three translation helper, driven by one view's input and frame clock. */
export function createPointManipulator(
  camera: Camera, element: HTMLCanvasElement, scene: Scene,
  initial: PointManipulator, invalidate: () => void,
) {
  // Manual pointer forwarding lets a hit consume input before the product's
  // tool/camera listeners. connect() would install competing bubble listeners.
  const controls = new TransformControls(camera);
  const proxy = new Object3D();
  const helper = controls.getHelper();
  scene.add(proxy, helper);
  controls.attach(proxy);
  let target = initial;
  let pointerId: number | undefined;
  let suppressClick = false;
  const originalTouchAction = element.style.touchAction;
  const position = () => ({ x: proxy.position.x, y: proxy.position.y, z: proxy.position.z });
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const pointer = (event: PointerEvent, button = event.button) => {
    const rect = element.getBoundingClientRect();
    // Three consumes {x,y,button} in normalized coordinates here; its external
    // declaration calls this PointerEvent although the addon passes this shape.
    return { x: (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1,
      y: -(event.clientY - rect.top) / Math.max(1, rect.height) * 2 + 1, button } as PointerEvent;
  };
  const sync = () => {
    controls.camera.updateMatrixWorld(true);
    proxy.updateMatrixWorld(true);
    helper.updateMatrixWorld(true);
  };
  const changed = () => invalidate();
  const moved = () => { if (pointerId !== undefined) target.onChange("move", position()); };
  controls.addEventListener("change", changed);
  controls.addEventListener("objectChange", moved);
  function release() {
    const id = pointerId;
    pointerId = undefined;
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    element.style.touchAction = originalTouchAction;
  }
  function cancel() {
    if (pointerId === undefined) return;
    const callback = target.onChange;
    release();
    controls.reset();
    controls.pointerUp({ x: 0, y: 0, button: 0 } as PointerEvent);
    callback("cancel", position());
    invalidate();
  }
  const down = (event: PointerEvent) => {
    if (pointerId !== undefined) { consume(event); return; }
    if (event.button !== 0) return;
    suppressClick = false;
    sync();
    controls.pointerHover(pointer(event));
    if (controls.axis === null) return;
    controls.pointerDown(pointer(event));
    if (!controls.dragging) return;
    pointerId = event.pointerId;
    suppressClick = true;
    element.style.touchAction = "none";
    element.setPointerCapture(event.pointerId);
    consume(event);
    target.onChange("start", position());
  };
  const move = (event: PointerEvent) => {
    sync();
    if (pointerId === undefined) { controls.pointerHover(pointer(event)); return; }
    if (pointerId !== event.pointerId) return;
    consume(event);
    controls.pointerMove(pointer(event, -1));
  };
  const up = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    consume(event);
    // Include the release position even if the browser omitted its last move.
    controls.pointerMove(pointer(event, -1));
    controls.pointerUp(pointer(event, 0));
    const callback = target.onChange;
    const final = position();
    release();
    callback("end", final);
    invalidate();
  };
  const lost = (event: PointerEvent) => { if (event.pointerId === pointerId) cancel(); };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && pointerId !== undefined) { consume(event); cancel(); }
  };
  const click = (event: MouseEvent) => { if (suppressClick) { suppressClick = false; consume(event); } };
  const wheel = (event: WheelEvent) => { if (pointerId !== undefined) consume(event); };
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move, true);
  element.addEventListener("pointerup", up, true);
  element.addEventListener("pointercancel", lost, true);
  element.addEventListener("lostpointercapture", lost, true);
  element.addEventListener("click", click, true);
  element.addEventListener("wheel", wheel, { capture: true, passive: false });
  element.ownerDocument.addEventListener("keydown", key, true);
  function update(next: PointManipulator) {
    if (next.id !== target.id) cancel();
    target = next;
    if (pointerId === undefined) proxy.position.set(next.position.x, next.position.y, next.position.z);
    controls.showX = next.axes.includes("x");
    controls.showY = next.axes.includes("y");
    controls.showZ = next.axes.includes("z");
    controls.size = next.size;
    invalidate();
  }
  update(initial);
  return {
    update,
    cancel,
    draw(currentCamera: Camera, visible: boolean) {
      if (visible) controls.camera = currentCamera;
      helper.visible = visible;
    },
    dispose() {
      cancel();
      element.removeEventListener("pointerdown", down, true);
      element.removeEventListener("pointermove", move, true);
      element.removeEventListener("pointerup", up, true);
      element.removeEventListener("pointercancel", lost, true);
      element.removeEventListener("lostpointercapture", lost, true);
      element.removeEventListener("click", click, true);
      element.removeEventListener("wheel", wheel, true);
      element.ownerDocument.removeEventListener("keydown", key, true);
      controls.removeEventListener("change", changed);
      controls.removeEventListener("objectChange", moved);
      controls.detach();
      // This control is manually driven, so it never connects to a DOM element.
      helper.dispose();
      scene.remove(helper, proxy);
      element.style.touchAction = originalTouchAction;
    },
  };
}
