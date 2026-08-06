import type { BenchGraph } from "./bench-graph.ts";
import type { BenchParamValues } from "./node-kind.ts";
import { findNodeKind } from "./registry.ts";

// Turns an authored graph plus a Rust-supplied order into a flat list of
// executions, and gives every execution a hash of everything that can change
// its result. The hash is what makes re-evaluation incremental: a node whose
// hash is unchanged is served from cache, so editing one parameter only
// recomputes that node and what lies downstream of it (ADR-0019).

/** One node execution, with everything needed to run it and to cache it. */
export interface EvaluationStep {
  /** Node this step evaluates. */
  readonly nodeId: string;
  /** Element the node instantiates. */
  readonly kindId: string;
  /** Identity of this exact result: same hash means same value. */
  readonly hash: string;
  /** The node instance's parameter values. */
  readonly params: BenchParamValues;
  /** Input port to the hash of the value feeding it. */
  readonly inputs: Readonly<Record<string, string>>;
}

/** A node that cannot run yet, and why. */
export interface SkippedEvaluation {
  /** Node that will not run. */
  readonly nodeId: string;
  /** Input ports with nothing connected, or fed by a node that itself cannot run. */
  readonly missingInputs: readonly string[];
}

/** A complete evaluation pass. */
export interface EvaluationPlan {
  /** Executions in dependency order. */
  readonly steps: readonly EvaluationStep[];
  /** Nodes left out of this pass. */
  readonly skipped: readonly SkippedEvaluation[];
  /** Node identity to its result hash, for every node that will run. */
  readonly hashes: Readonly<Record<string, string>>;
}

/**
 * Hashes a string into a short stable hexadecimal digest.
 *
 * FNV-1a is used deliberately over Web Crypto: this must run synchronously in
 * a pure function that is unit-tested outside a browser, and the requirement
 * is collision-resistance between a handful of parameter sets on one canvas,
 * not cryptographic strength.
 */
function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Renders parameter values in a key order that does not depend on insertion.
 *
 * Two nodes with the same values must hash the same even when their parameter
 * objects were built in a different order.
 */
function canonicalParams(params: BenchParamValues): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join(",");
}

/**
 * Computes the identity of one node's result.
 *
 * @param kindId - Element being run.
 * @param params - The node instance's values.
 * @param inputHashes - Input port to the hash of the value feeding it.
 * @returns A digest that changes whenever the result could change.
 */
export function computeStepHash(
  kindId: string,
  params: BenchParamValues,
  inputHashes: Readonly<Record<string, string>>,
): string {
  const inputs = Object.keys(inputHashes)
    .sort()
    .map((port) => `${port}<${inputHashes[port]}`)
    .join(",");
  return digest(`${kindId}|${canonicalParams(params)}|${inputs}`);
}

/**
 * Builds an evaluation pass from an authored graph and a Rust-supplied order.
 *
 * Nodes whose inputs are not all connected are skipped rather than run with a
 * missing value, and anything downstream of a skipped node is skipped too — a
 * partially wired graph is the normal state while a user is still building it.
 *
 * @param graph - The authored graph.
 * @param order - Node identities in dependency order, from `grafting-graph-core`.
 * @returns Executions in order, plus the nodes left out and why.
 */
export function buildEvaluationPlan(
  graph: BenchGraph,
  order: readonly string[],
): EvaluationPlan {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const steps: EvaluationStep[] = [];
  const skipped: SkippedEvaluation[] = [];
  const hashes: Record<string, string> = {};

  for (const nodeId of order) {
    const node = nodesById.get(nodeId);
    if (node === undefined) continue;
    const kind = findNodeKind(node.kindId);

    const inputs: Record<string, string> = {};
    const missingInputs: string[] = [];
    for (const port of kind.inputs) {
      const edge = graph.edges.find(
        (candidate) => candidate.target.nodeId === nodeId && candidate.target.portId === port.id,
      );
      const producerHash = edge === undefined ? undefined : hashes[edge.source.nodeId];
      if (producerHash === undefined) missingInputs.push(port.id);
      else inputs[port.id] = producerHash;
    }

    if (missingInputs.length > 0) {
      skipped.push(Object.freeze({ nodeId, missingInputs: Object.freeze(missingInputs) }));
      continue;
    }

    const hash = computeStepHash(kind.id, node.params, inputs);
    hashes[nodeId] = hash;
    steps.push(
      Object.freeze({
        nodeId,
        kindId: kind.id,
        hash,
        params: node.params,
        inputs: Object.freeze(inputs),
      }),
    );
  }

  return Object.freeze({
    steps: Object.freeze(steps),
    skipped: Object.freeze(skipped),
    hashes: Object.freeze(hashes),
  });
}
