import type {
  ConstructionNodeId,
  ConstructionPosition,
  GeneratePathExtrusionRequest,
  GenerateTerrainCellRequest,
} from "@/ports";

export type OperationId = string;
export type ParticipantId = string;

export interface RevisionPrecondition {
  readonly scope: string;
  readonly revision: number;
}

export interface ConstructionOperationContext {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
}

export interface GenerateTerrainCellOperation {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
  readonly kind: "construction.generate-terrain-cell@1";
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: GenerateTerrainCellRequest;
}

export interface GeneratePathExtrusionOperation {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
  readonly kind: "construction.generate-path-extrusion@1";
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: GeneratePathExtrusionRequest;
}

export interface MoveNodePayload {
  readonly nodeId: ConstructionNodeId;
  readonly position: ConstructionPosition;
}

export interface MoveNodeOperation {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
  readonly kind: "construction.move-node@1";
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: MoveNodePayload;
}

export type ConstructionOperation = GenerateTerrainCellOperation | GeneratePathExtrusionOperation | MoveNodeOperation;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty`);
  return normalized;
}

function operationContext(context: ConstructionOperationContext): ConstructionOperationContext {
  return Object.freeze({
    operationId: required(context.operationId, "operationId"),
    tableId: required(context.tableId, "tableId"),
    initiatedBy: required(context.initiatedBy, "initiatedBy"),
  });
}

/**
 * `construction.generate-terrain-cell@1`: no revision precondition, mirroring
 * `token.place@1` -- generation creates new nodes/surfaces, it does not
 * contend with an existing revision.
 */
export function createGenerateTerrainCellOperation(
  payload: GenerateTerrainCellRequest,
  context: ConstructionOperationContext,
): GenerateTerrainCellOperation {
  const normalized = operationContext(context);
  return Object.freeze({
    ...normalized,
    kind: "construction.generate-terrain-cell@1",
    expected: Object.freeze([]),
    payload,
  });
}

/** `construction.generate-path-extrusion@1`: same no-precondition shape as generate-terrain-cell. */
export function createGeneratePathExtrusionOperation(
  payload: GeneratePathExtrusionRequest,
  context: ConstructionOperationContext,
): GeneratePathExtrusionOperation {
  const normalized = operationContext(context);
  return Object.freeze({
    ...normalized,
    kind: "construction.generate-path-extrusion@1",
    expected: Object.freeze([]),
    payload,
  });
}

/**
 * `construction.move-node@1`: moves an existing node to an absolute
 * position. `expected` defaults to no precondition -- this task's own scope
 * is single-user local editing, not multiplayer conflict resolution (see
 * `docs/architecture/vtt-roadmap.md`'s "replay determinism is deliberately
 * out of scope" note) -- but the parameter stays available for a later
 * caller that does track a node's own revision.
 */
export function createMoveNodeOperation(
  payload: MoveNodePayload,
  context: ConstructionOperationContext,
  expected: readonly RevisionPrecondition[] = [],
): MoveNodeOperation {
  const normalized = operationContext(context);
  return Object.freeze({
    ...normalized,
    kind: "construction.move-node@1",
    expected: Object.freeze([...expected]),
    payload,
  });
}
