import type { CanvasPortDefinition } from "./contracts.js";

/** One end of a connection a user is drawing, resolved against the rendered graph. */
export interface ConnectionCandidate {
  /** Stable identity of the node the port belongs to. */
  readonly nodeId: string;
  /** The port the pointer picked up or released on. */
  readonly port: CanvasPortDefinition;
  /** Which socket of that port the pointer used. */
  readonly side: "input" | "output";
  /** How many connections the socket already holds. */
  readonly connectionCount: number;
}

/**
 * Why the canvas refused a user-drawn connection on its own.
 *
 * Every value here is verifiable without domain knowledge. Value-kind
 * compatibility is deliberately absent: only a product knows whether two
 * `dataType` strings may be joined.
 */
export type ConnectionRefusal =
  | "same-side"
  | "self-connection"
  | "direction"
  | "capacity"
  | "duplicate";

/**
 * Applies the structural connection rules the canvas owns.
 *
 * @param source - End the connection was drawn from.
 * @param target - End the connection was dropped on.
 * @param alreadyConnected - Whether these two exact ports are joined already.
 * @returns The first violated rule, or `null` when the canvas has no objection.
 */
export function checkCanvasConnection(
  source: ConnectionCandidate,
  target: ConnectionCandidate,
  alreadyConnected: boolean,
): ConnectionRefusal | null {
  if (source.side === target.side) return "same-side";
  if (source.nodeId === target.nodeId) return "self-connection";
  if ((source.port.direction ?? "both") === "in") return "direction";
  if ((target.port.direction ?? "both") === "out") return "direction";
  if (alreadyConnected) return "duplicate";
  if (source.port.capacity !== undefined && source.connectionCount >= source.port.capacity) {
    return "capacity";
  }
  if (target.port.capacity !== undefined && target.connectionCount >= target.port.capacity) {
    return "capacity";
  }
  return null;
}
