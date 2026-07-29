import type { NodeDataCell, NodeHostData } from "./contracts.js";

/** Updates selection through data observed by the generic node host. */
export function setNodeSelection(node: NodeDataCell, selected: boolean): boolean {
  const data = node.getData<NodeHostData>();
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.node !== "object" ||
    data.node === null ||
    typeof data.node.id !== "string"
  ) {
    return false;
  }

  node.setData(Object.freeze({ ...data, selected }));
  return true;
}
