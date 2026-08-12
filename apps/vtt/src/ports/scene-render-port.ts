export type ChangeOrigin = "local" | "network" | "programmatic";
export type RenderViewId = string;
export type RenderLayerKey = "tokens" | "terrain";

export interface RenderDependencyRevision {
  readonly layer: RenderLayerKey;
  readonly scopeId: string;
  readonly revision: number;
}

export interface RenderToken {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly appearance: {
    readonly label: string;
    readonly color: number;
    readonly size: number;
  };
}

export type ConfirmedTokenRenderChange =
  | {
      readonly type: "token-upserted";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly token: RenderToken;
    }
  | {
      readonly type: "token-removed";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly tokenId: string;
    };

/**
 * Packed vertex data for one piece of map geometry. Defined locally rather
 * than imported from `@grafting/render-3d`, matching how {@link RenderToken}
 * already keeps this port renderer-agnostic.
 */
export interface RenderMeshData {
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  readonly indices?: Uint16Array | Uint32Array;
}

/**
 * One spatially-bucketed unit of map geometry. `surfaceType`/`physical` echo
 * `grafting-procgen-construction-wasm`'s `Surface` fields directly -- this
 * port does not invent its own classification vocabulary.
 */
export interface RenderMapChunk {
  readonly chunkId: string;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly mesh: RenderMeshData;
}

export type ConfirmedMapChunkRenderChange =
  | {
      readonly type: "map-chunk-upserted";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly chunk: RenderMapChunk;
    }
  | {
      readonly type: "map-chunk-removed";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly chunkId: string;
    };

export type ConfirmedRenderChange = ConfirmedTokenRenderChange | ConfirmedMapChunkRenderChange;

export interface SceneRenderMetrics {
  readonly rendererCreates: number;
  readonly rendererDisposes: number;
  readonly attachedViews: number;
  readonly confirmedTokenChanges: number;
  readonly terrainUploads: number;
}

export interface SceneRenderPort {
  start(runtimeGeneration: number): Promise<void>;
  attachView(target: HTMLElement): RenderViewId;
  detachView(viewId: RenderViewId): void;
  resizeView(viewId: RenderViewId, width: number, height: number): void;
  applyConfirmed(change: ConfirmedRenderChange): void;
  /** Sets the floor-cutaway height in continuous world-space Y. `undefined` disables cutaway. */
  setFloorClipHeight(height: number | undefined): void;
  getMetrics(): SceneRenderMetrics;
  dispose(): Promise<void>;
}
