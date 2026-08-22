import { createConstructionSessionAdapter, createTerrainNoiseAdapter } from "../../adapters/construction/index.ts";
import { createRender3dSceneAdapter } from "../../adapters/rendering/index.ts";
import {
  createTokenProjection,
  type TokenProjection,
} from "../../entities/token/index.ts";
import type { ConstructionSessionPort, SceneRenderPort, TerrainNoisePort } from "@/ports";

import { AppTabletopRuntime, type TabletopRuntime } from "./tabletop-runtime.ts";

export interface CreateTabletopRuntimeInput {
  readonly tableId: string;
  readonly initialTokens?: readonly TokenProjection[];
  readonly renderPort?: SceneRenderPort;
  readonly constructionPort?: ConstructionSessionPort;
  readonly terrainNoisePort?: TerrainNoisePort;
}

export function createTabletopRuntime(
  input: CreateTabletopRuntimeInput,
): TabletopRuntime {
  const tableId = input.tableId.trim();
  const initialTokens = input.initialTokens ?? [];
  return new AppTabletopRuntime(
    tableId,
    input.renderPort ?? createRender3dSceneAdapter(),
    input.constructionPort ?? createConstructionSessionAdapter(),
    input.terrainNoisePort ?? createTerrainNoiseAdapter(),
    initialTokens,
  );
}
