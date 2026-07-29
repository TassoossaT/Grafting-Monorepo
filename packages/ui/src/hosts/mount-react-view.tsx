import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

import type { UiMountHandle } from "../index.js";

/** Minimal private root boundary used to test lifecycle independently of the DOM. */
export interface ReactViewRoot {
  render(element: ReactElement): void;
  unmount(): void;
}

/** Builds the deterministic update/dispose lifecycle around an existing React root. */
export function createReactViewHandle<Props>(
  root: ReactViewRoot,
  initialProps: Props,
  render: (props: Props) => ReactElement,
): UiMountHandle<Props> {
  let disposed = false;
  const update = (props: Props) => {
    if (disposed) throw new Error("UI mount has been disposed");
    root.render(render(props));
  };
  update(initialProps);
  return Object.freeze({
    update,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  });
}

/** Private ReactDOM bridge shared by DOM-mountable Grafting UI components. */
export function mountReactView<Props>(
  host: HTMLElement,
  initialProps: Props,
  render: (props: Props) => ReactElement,
): UiMountHandle<Props> {
  const root = createRoot(host);
  return createReactViewHandle(root, initialProps, render);
}
