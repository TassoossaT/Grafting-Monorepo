import type { SceneItem, Transform } from "@grafting/render-3d";

import type { RenderToken } from "@/ports";

export const TOKEN_LAYER_ID = "tokens";
export const TOKEN_VISUAL_KIND = "vtt-token-billboard";

export interface TokenVisualParams {
  readonly color: number;
}

export function tokenTransform(token: RenderToken): Transform {
  return {
    position: token.position,
    scale: token.appearance.size,
  };
}

export function tokenSceneItem(token: RenderToken): SceneItem<TokenVisualParams> {
  return {
    id: `token:${token.id}`,
    layer: TOKEN_LAYER_ID,
    visual: {
      kind: TOKEN_VISUAL_KIND,
      params: { color: token.appearance.color },
    },
    transform: tokenTransform(token),
    data: Object.freeze({ entity: "token", tokenId: token.id }),
  };
}
