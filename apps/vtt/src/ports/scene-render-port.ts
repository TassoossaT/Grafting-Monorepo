export type ChangeOrigin = "local" | "network" | "programmatic";
export type RenderViewId = string;

export interface RenderDependencyRevision {
  readonly layer: "tokens";
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
  applyConfirmed(change: ConfirmedTokenRenderChange): void;
  getMetrics(): SceneRenderMetrics;
  dispose(): Promise<void>;
}
