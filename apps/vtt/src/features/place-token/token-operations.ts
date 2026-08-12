import {
  createTokenProjection,
  type SceneId,
  type SubjectRef,
  type TokenAppearance,
  type TokenId,
  type TokenPosition,
} from "../../entities/token/index.ts";

export type OperationId = string;
export type ParticipantId = string;

export interface RevisionPrecondition {
  readonly scope: string;
  readonly revision: number;
}

export interface TokenOperationContext {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
}

export interface PlaceTokenIntent {
  readonly tokenId: TokenId;
  readonly sceneId: SceneId;
  readonly position: TokenPosition;
  readonly appearance: TokenAppearance;
  readonly subjectRef?: SubjectRef;
}

export interface PlaceTokenOperation {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly sceneId: SceneId;
  readonly initiatedBy: ParticipantId;
  readonly kind: "token.place@1";
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: PlaceTokenIntent;
}

export interface BindTokenSubjectIntent {
  readonly tokenId: TokenId;
  readonly subjectRef: SubjectRef | null;
  readonly expectedTokenRevision: number;
}

export interface BindTokenSubjectOperation {
  readonly operationId: OperationId;
  readonly tableId: string;
  readonly initiatedBy: ParticipantId;
  readonly kind: "token.bind-subject@1";
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: {
    readonly tokenId: TokenId;
    readonly subjectRef: SubjectRef | null;
  };
}

export type TokenOperation = PlaceTokenOperation | BindTokenSubjectOperation;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty`);
  return normalized;
}

function operationContext(context: TokenOperationContext): TokenOperationContext {
  return Object.freeze({
    operationId: required(context.operationId, "operationId"),
    tableId: required(context.tableId, "tableId"),
    initiatedBy: required(context.initiatedBy, "initiatedBy"),
  });
}

export function createPlaceTokenOperation(
  intent: PlaceTokenIntent,
  context: TokenOperationContext,
): PlaceTokenOperation {
  const normalized = operationContext(context);
  const token = createTokenProjection({ ...intent, id: intent.tokenId, revision: 0 });
  return Object.freeze({
    ...normalized,
    sceneId: token.sceneId,
    kind: "token.place@1",
    expected: Object.freeze([]),
    payload: Object.freeze({
      tokenId: token.id,
      sceneId: token.sceneId,
      position: token.position,
      appearance: token.appearance,
      ...(token.subjectRef === undefined ? {} : { subjectRef: token.subjectRef }),
    }),
  });
}

export function createBindTokenSubjectOperation(
  intent: BindTokenSubjectIntent,
  context: TokenOperationContext,
): BindTokenSubjectOperation {
  if (!Number.isInteger(intent.expectedTokenRevision) || intent.expectedTokenRevision < 0) {
    throw new Error("expectedTokenRevision must be a non-negative integer");
  }
  const normalized = operationContext(context);
  return Object.freeze({
    ...normalized,
    kind: "token.bind-subject@1",
    expected: Object.freeze([
      Object.freeze({
        scope: `token:${required(intent.tokenId, "tokenId")}`,
        revision: intent.expectedTokenRevision,
      }),
    ]),
    payload: Object.freeze({
      tokenId: required(intent.tokenId, "tokenId"),
      subjectRef:
        intent.subjectRef === null ? null : required(intent.subjectRef, "subjectRef"),
    }),
  });
}
