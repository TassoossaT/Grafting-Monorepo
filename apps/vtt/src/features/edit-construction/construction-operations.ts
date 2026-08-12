import type { GenerateTerrainCellRequest, GenerateWallRequest } from "@/ports";

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

export interface GenerateWallOperation {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
  readonly kind: "construction.generate-wall@1";
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: GenerateWallRequest;
}

export type ConstructionOperation = GenerateTerrainCellOperation | GenerateWallOperation;

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

/** `construction.generate-wall@1`: same no-precondition shape as generate-terrain-cell. */
export function createGenerateWallOperation(
  payload: GenerateWallRequest,
  context: ConstructionOperationContext,
): GenerateWallOperation {
  const normalized = operationContext(context);
  return Object.freeze({
    ...normalized,
    kind: "construction.generate-wall@1",
    expected: Object.freeze([]),
    payload,
  });
}
