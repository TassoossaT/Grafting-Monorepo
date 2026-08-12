export type TokenId = string;
export type SceneId = string;
export type SubjectRef = string;

export interface TokenPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TokenAppearance {
  readonly label: string;
  readonly color: number;
  readonly size: number;
}

export interface TokenProjection {
  readonly id: TokenId;
  readonly sceneId: SceneId;
  readonly position: TokenPosition;
  readonly subjectRef?: SubjectRef;
  readonly appearance: TokenAppearance;
  readonly revision: number;
}

export interface TokenCollectionProjection {
  readonly byId: ReadonlyMap<TokenId, TokenProjection>;
  readonly revision: number;
}

export type TokenProjectionDelta =
  | { readonly type: "token-upserted"; readonly token: TokenProjection }
  | { readonly type: "token-removed"; readonly tokenId: TokenId; readonly revision: number };

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty`);
  return normalized;
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

export function createTokenProjection(input: TokenProjection): TokenProjection {
  const size = finite(input.appearance.size, "appearance.size");
  if (size <= 0) throw new Error("appearance.size must be positive");
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new Error("revision must be a non-negative integer");
  }

  const subjectRef =
    input.subjectRef === undefined ? undefined : nonEmpty(input.subjectRef, "subjectRef");
  return Object.freeze({
    id: nonEmpty(input.id, "tokenId"),
    sceneId: nonEmpty(input.sceneId, "sceneId"),
    position: Object.freeze({
      x: finite(input.position.x, "position.x"),
      y: finite(input.position.y, "position.y"),
      z: finite(input.position.z, "position.z"),
    }),
    ...(subjectRef === undefined ? {} : { subjectRef }),
    appearance: Object.freeze({
      label: nonEmpty(input.appearance.label, "appearance.label"),
      color: finite(input.appearance.color, "appearance.color"),
      size,
    }),
    revision: input.revision,
  });
}

export function createTokenCollection(
  tokens: readonly TokenProjection[] = [],
): TokenCollectionProjection {
  const byId = new Map<TokenId, TokenProjection>();
  for (const candidate of tokens) {
    const token = createTokenProjection(candidate);
    if (byId.has(token.id)) throw new Error(`duplicate tokenId "${token.id}"`);
    byId.set(token.id, token);
  }
  return Object.freeze({ byId, revision: 0 });
}

function sameToken(left: TokenProjection, right: TokenProjection): boolean {
  return (
    left.id === right.id &&
    left.sceneId === right.sceneId &&
    left.subjectRef === right.subjectRef &&
    left.revision === right.revision &&
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.position.z === right.position.z &&
    left.appearance.label === right.appearance.label &&
    left.appearance.color === right.appearance.color &&
    left.appearance.size === right.appearance.size
  );
}

export function applyTokenProjectionDelta(
  current: TokenCollectionProjection,
  delta: TokenProjectionDelta,
): TokenCollectionProjection {
  if (delta.type === "token-removed") {
    const previous = current.byId.get(delta.tokenId);
    if (previous === undefined) return current;
    if (!Number.isInteger(delta.revision) || delta.revision <= previous.revision) {
      throw new Error(`token "${delta.tokenId}" removal revision must increase`);
    }
    const byId = new Map(current.byId);
    byId.delete(delta.tokenId);
    return Object.freeze({ byId, revision: current.revision + 1 });
  }

  const token = createTokenProjection(delta.token);
  const previous = current.byId.get(token.id);
  if (previous !== undefined && sameToken(previous, token)) return current;
  if (previous !== undefined && token.revision <= previous.revision) {
    throw new Error(`token "${token.id}" revision must increase`);
  }

  const byId = new Map(current.byId);
  byId.set(token.id, token);
  return Object.freeze({ byId, revision: current.revision + 1 });
}
