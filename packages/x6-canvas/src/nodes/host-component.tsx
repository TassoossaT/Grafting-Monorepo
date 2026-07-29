import { useEffect, useRef } from "react";

import type { CanvasNodeRenderHandle } from "../index.js";
import type { NodeHostComponentProps, NodeHostData } from "./contracts.js";

/** Technical React-shape bridge with no visible product presentation. */
export function CanvasNodeHost({ node }: NodeHostComponentProps) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<CanvasNodeRenderHandle | undefined>(undefined);
  const data = node.getData<NodeHostData>();

  useEffect(() => {
    if (host.current === null) return undefined;
    const handle = data.definition.mount(
      host.current,
      Object.freeze({ node: data.node, selected: data.selected }),
    );
    mounted.current = handle;
    return () => {
      mounted.current = undefined;
      handle.dispose();
    };
  }, [data.definition]);

  useEffect(() => {
    mounted.current?.update(Object.freeze({ node: data.node, selected: data.selected }));
  }, [data.node, data.selected]);

  return <div ref={host} style={{ height: "100%", width: "100%" }} />;
}
