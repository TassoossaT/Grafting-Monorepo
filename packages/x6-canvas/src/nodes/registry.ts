import { register } from "@antv/x6-react-shape";

import { CanvasNodeHost } from "./host-component.js";
import { X6_NODE_HOST_SHAPE } from "./shape.js";

let registered = false;

/** Registers the single presentation-neutral node host once. */
export function ensureNodeHostRegistered(): void {
  if (registered) return;
  register({
    shape: X6_NODE_HOST_SHAPE,
    width: 1,
    height: 1,
    effect: ["data"],
    component: CanvasNodeHost,
  });
  registered = true;
}
