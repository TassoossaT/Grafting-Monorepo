import { createRender3dSceneAdapter } from "../../adapters/rendering/index.ts";
import {
  createTokenProjection,
  type TokenProjection,
} from "../../entities/token/index.ts";
import type { SceneRenderPort } from "@/ports";

import { AppTabletopRuntime, type TabletopRuntime } from "./tabletop-runtime.ts";

export interface CreateTabletopRuntimeInput {
  readonly tableId: string;
  readonly initialTokens?: readonly TokenProjection[];
  readonly renderPort?: SceneRenderPort;
}

export function createTabletopRuntime(
  input: CreateTabletopRuntimeInput,
): TabletopRuntime {
  const tableId = input.tableId.trim();
  const initialTokens =
    input.initialTokens ??
    [
      createTokenProjection({
        id: `${tableId}:guide`,
        sceneId: `${tableId}:scene`,
        position: { x: 0, y: 1.15, z: 0 },
        appearance: {
          label: "Guide token",
          color: 0x72d69e,
          size: 1.7,
        },
        revision: 1,
      }),
    ];
  return new AppTabletopRuntime(
    tableId,
    input.renderPort ?? createRender3dSceneAdapter(),
    initialTokens,
  );
}
