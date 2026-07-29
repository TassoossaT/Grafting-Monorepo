import type { Graph, Node, NodeMetadata } from "@antv/x6";

import type { CanvasNode, CanvasNodeViewDefinition } from "../index.js";

/** Private immutable data observed by the generic React-shape host. */
export interface NodeHostData {
  readonly node: CanvasNode;
  readonly definition: CanvasNodeViewDefinition;
  readonly selected: boolean;
}

/** Private props supplied by the X6 React-shape adapter. */
export interface NodeHostComponentProps {
  readonly node: Node;
  readonly graph: Graph;
}

/** Private X6 port metadata created from neutral port definitions. */
export type NodeViewPorts = NonNullable<NodeMetadata["ports"]>;

/** Small X6 data boundary required for selection changes. */
export interface NodeDataCell {
  getData<Data>(): Data;
  setData(data: NodeHostData): unknown;
}
