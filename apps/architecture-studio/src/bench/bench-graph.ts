import {
  allInputPorts,
  coerceParamValue,
  defaultParamValues,
  type BenchNodeKind,
  type BenchParamValue,
  type BenchParamValues,
} from "./node-kind.ts";
import { BENCH_DATA_TYPES, findNodeKind } from "./registry.ts";

// The authored graph, as plain immutable data with no renderer involved. Every
// bench edit is a function from one graph to the next, which keeps the rules
// testable without a DOM and keeps React holding state rather than deriving it
// from the canvas.

/** One placed element instance. */
export interface BenchNode {
  /** Identity unique within the graph. */
  readonly id: string;
  /** Registered element this instance is of. */
  readonly kindId: string;
  /** Horizontal placement on the surface. */
  readonly x: number;
  /** Vertical placement on the surface. */
  readonly y: number;
  /** This instance's own parameter values. */
  readonly params: BenchParamValues;
  /** Rendered width, when the instance overrides its element's default. */
  readonly width?: number;
  /** Rendered height, when the instance overrides its element's default. */
  readonly height?: number;
}

/** One value flowing from an output port to an input port. */
export interface BenchEdge {
  /** Identity unique within the graph. */
  readonly id: string;
  /** Producing node and port. */
  readonly source: { readonly nodeId: string; readonly portId: string };
  /** Consuming node and port. */
  readonly target: { readonly nodeId: string; readonly portId: string };
}

/** The complete authored graph. */
export interface BenchGraph {
  /** Placed elements. */
  readonly nodes: readonly BenchNode[];
  /** Connections between them. */
  readonly edges: readonly BenchEdge[];
  /** Monotonic counter behind generated identities, kept in state so edits stay deterministic. */
  readonly sequence: number;
}

/** An empty bench. */
export const EMPTY_BENCH_GRAPH: BenchGraph = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  sequence: 0,
});

const findNode = (graph: BenchGraph, nodeId: string): BenchNode => {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) throw new Error(`Bench node not found: ${nodeId}`);
  return node;
};

/**
 * Places a new instance of a registered element.
 *
 * @param graph - Current graph.
 * @param kindId - Element to instantiate.
 * @param position - Where to place it.
 * @returns The next graph and the identity of the placed node.
 */
export function addBenchNode(
  graph: BenchGraph,
  kindId: string,
  position: { readonly x: number; readonly y: number },
): { readonly graph: BenchGraph; readonly nodeId: string } {
  const kind = findNodeKind(kindId);
  const nodeId = `node-${graph.sequence + 1}`;
  const node: BenchNode = Object.freeze({
    id: nodeId,
    kindId: kind.id,
    x: position.x,
    y: position.y,
    params: defaultParamValues(kind),
  });
  return {
    graph: Object.freeze({
      nodes: Object.freeze([...graph.nodes, node]),
      edges: graph.edges,
      sequence: graph.sequence + 1,
    }),
    nodeId,
  };
}

/**
 * Copies a placed node, parameter values included, without its connections.
 *
 * Copying the values is the point: it is how a user compares two settings of
 * the same element side by side. Connections are deliberately not copied,
 * since the copy is a variant to wire deliberately, not a silent second
 * consumer of the original's inputs.
 *
 * @param graph - Current graph.
 * @param nodeId - Node to copy.
 * @param offset - Placement offset applied to the copy.
 * @returns The next graph and the identity of the copy.
 */
export function duplicateBenchNode(
  graph: BenchGraph,
  nodeId: string,
  offset: { readonly x: number; readonly y: number } = { x: 32, y: 32 },
): { readonly graph: BenchGraph; readonly nodeId: string } {
  const source = findNode(graph, nodeId);
  const copyId = `node-${graph.sequence + 1}`;
  const copy: BenchNode = Object.freeze({
    id: copyId,
    kindId: source.kindId,
    x: source.x + offset.x,
    y: source.y + offset.y,
    params: source.params,
  });
  return {
    graph: Object.freeze({
      nodes: Object.freeze([...graph.nodes, copy]),
      edges: graph.edges,
      sequence: graph.sequence + 1,
    }),
    nodeId: copyId,
  };
}

/**
 * Removes a node and every connection touching it.
 *
 * @param graph - Current graph.
 * @param nodeId - Node to remove.
 * @returns The next graph and the connections that were removed with it.
 */
export function removeBenchNode(
  graph: BenchGraph,
  nodeId: string,
): { readonly graph: BenchGraph; readonly removedEdgeIds: readonly string[] } {
  findNode(graph, nodeId);
  const removedEdgeIds = graph.edges
    .filter((edge) => edge.source.nodeId === nodeId || edge.target.nodeId === nodeId)
    .map((edge) => edge.id);
  return {
    graph: Object.freeze({
      nodes: Object.freeze(graph.nodes.filter((node) => node.id !== nodeId)),
      edges: Object.freeze(graph.edges.filter((edge) => !removedEdgeIds.includes(edge.id))),
      sequence: graph.sequence,
    }),
    removedEdgeIds: Object.freeze(removedEdgeIds),
  };
}

/**
 * Changes one parameter of one node instance.
 *
 * @param graph - Current graph.
 * @param nodeId - Node whose parameter changes.
 * @param paramId - Parameter to change.
 * @param raw - Value produced by the control, coerced against its spec.
 * @returns The next graph.
 * @throws If the node's element declares no such parameter.
 */
export function setBenchParam(
  graph: BenchGraph,
  nodeId: string,
  paramId: string,
  raw: unknown,
): BenchGraph {
  const node = findNode(graph, nodeId);
  const kind = findNodeKind(node.kindId);
  const spec = kind.params.find((candidate) => candidate.id === paramId);
  if (spec === undefined) throw new Error(`Bench element ${kind.id} declares no parameter ${paramId}`);
  const value: BenchParamValue = coerceParamValue(spec, raw);
  const params: Record<string, BenchParamValue> = { ...node.params, [paramId]: value };
  return Object.freeze({
    nodes: Object.freeze(
      graph.nodes.map((candidate) =>
        candidate.id === nodeId ? Object.freeze({ ...candidate, params: Object.freeze(params) }) : candidate,
      ),
    ),
    edges: graph.edges,
    sequence: graph.sequence,
  });
}

/** Why the bench refused a connection the canvas already found structurally sound. */
export type BenchConnectionRefusal = "unknown-port" | "type-mismatch" | "input-occupied";

/**
 * Applies the product's own connection rules.
 *
 * The canvas has already checked direction, capacity, self-connection, and
 * duplicates. What remains is domain knowledge the canvas cannot have: whether
 * the two value kinds match.
 *
 * @param graph - Current graph.
 * @param source - Producing node and port.
 * @param target - Consuming node and port.
 * @returns The violated rule, or `null` when the connection is allowed.
 */
export function checkBenchConnection(
  graph: BenchGraph,
  source: { readonly nodeId: string; readonly portId: string },
  target: { readonly nodeId: string; readonly portId: string },
): BenchConnectionRefusal | null {
  const sourceKind: BenchNodeKind = findNodeKind(findNode(graph, source.nodeId).kindId);
  const targetKind: BenchNodeKind = findNodeKind(findNode(graph, target.nodeId).kindId);
  const output = sourceKind.outputs.find((port) => port.id === source.portId);
  const input = allInputPorts(targetKind).find((port) => port.id === target.portId);
  if (output === undefined || input === undefined) return "unknown-port";
  // An input may declare that it takes anything, which is how a viewport shows
  // whatever it is pointed at. An output never may: something downstream has to
  // be able to decide whether to accept what it produces.
  if (input.dataType !== BENCH_DATA_TYPES.any && output.dataType !== input.dataType) {
    return "type-mismatch";
  }
  const occupied = graph.edges.some(
    (edge) => edge.target.nodeId === target.nodeId && edge.target.portId === target.portId,
  );
  return occupied ? "input-occupied" : null;
}

/**
 * Connects two ports after the product's own rules accept them.
 *
 * @param graph - Current graph.
 * @param source - Producing node and port.
 * @param target - Consuming node and port.
 * @returns The next graph and the new connection, or the rule that refused it.
 */
export function addBenchEdge(
  graph: BenchGraph,
  source: { readonly nodeId: string; readonly portId: string },
  target: { readonly nodeId: string; readonly portId: string },
):
  | { readonly graph: BenchGraph; readonly edge: BenchEdge; readonly refusal?: undefined }
  | { readonly refusal: BenchConnectionRefusal; readonly graph?: undefined; readonly edge?: undefined } {
  const refusal = checkBenchConnection(graph, source, target);
  if (refusal !== null) return { refusal };
  const edge: BenchEdge = Object.freeze({
    id: `edge-${graph.sequence + 1}`,
    source: Object.freeze({ ...source }),
    target: Object.freeze({ ...target }),
  });
  return {
    graph: Object.freeze({
      nodes: graph.nodes,
      edges: Object.freeze([...graph.edges, edge]),
      sequence: graph.sequence + 1,
    }),
    edge,
  };
}

/**
 * Removes one connection.
 *
 * @param graph - Current graph.
 * @param edgeId - Connection to remove.
 * @returns The next graph, unchanged when the connection is already gone.
 */
export function removeBenchEdge(graph: BenchGraph, edgeId: string): BenchGraph {
  if (!graph.edges.some((edge) => edge.id === edgeId)) return graph;
  return Object.freeze({
    nodes: graph.nodes,
    edges: Object.freeze(graph.edges.filter((edge) => edge.id !== edgeId)),
    sequence: graph.sequence,
  });
}

/**
 * Summarises everything about a graph that can change what it computes.
 *
 * Position and size are deliberately absent: moving or resizing a node cannot
 * alter a single value, yet a drag commits a new graph on every pointer move.
 * Keying evaluation on this instead of on the graph keeps a drag from
 * scheduling a pass — and from redrawing every viewport — for nothing.
 *
 * @param graph - Graph to summarise.
 * @returns A string that changes exactly when a result could.
 */
export function benchEvaluationKey(graph: BenchGraph): string {
  const nodes = graph.nodes
    .map((node) => {
      const params = Object.keys(node.params)
        .sort()
        .map((key) => `${key}=${String(node.params[key])}`)
        .join(",");
      return `${node.id}:${node.kindId}(${params})`;
    })
    .sort()
    .join("|");
  const edges = graph.edges
    .map((edge) => `${edge.source.nodeId}.${edge.source.portId}>${edge.target.nodeId}.${edge.target.portId}`)
    .sort()
    .join("|");
  return `${nodes}||${edges}`;
}

/**
 * Resizes one node.
 *
 * A node that draws something — a viewport above all — is unreadable at the
 * size that suits a node that only shows a title, so size belongs to the
 * instance rather than to the element.
 *
 * @param graph - Current graph.
 * @param nodeId - Node to resize.
 * @param size - New rendered size in CSS pixels, clamped to something usable.
 * @returns The next graph.
 */
export function resizeBenchNode(
  graph: BenchGraph,
  nodeId: string,
  size: { readonly width: number; readonly height: number },
): BenchGraph {
  findNode(graph, nodeId);
  const width = Math.min(720, Math.max(140, Math.round(size.width)));
  const height = Math.min(720, Math.max(90, Math.round(size.height)));
  return Object.freeze({
    nodes: Object.freeze(
      graph.nodes.map((node) => (node.id === nodeId ? Object.freeze({ ...node, width, height }) : node)),
    ),
    edges: graph.edges,
    sequence: graph.sequence,
  });
}

/**
 * Records a node's new placement after a user moves it.
 *
 * @param graph - Current graph.
 * @param nodeId - Node that moved.
 * @param position - Where it now sits.
 * @returns The next graph.
 */
export function moveBenchNode(
  graph: BenchGraph,
  nodeId: string,
  position: { readonly x: number; readonly y: number },
): BenchGraph {
  return Object.freeze({
    nodes: Object.freeze(
      graph.nodes.map((node) =>
        node.id === nodeId ? Object.freeze({ ...node, x: position.x, y: position.y }) : node,
      ),
    ),
    edges: graph.edges,
    sequence: graph.sequence,
  });
}
