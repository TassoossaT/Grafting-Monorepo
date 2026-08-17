import type { ConstructionToolId } from "@/features/edit-construction";

import type { ConstructionTool } from "./tool-context.ts";
import { houseRoomDeleteTool } from "./house-room-delete-tool.ts";
import { interiorWallTool } from "./interior-wall-tool.ts";
import { irregularTerrainTool } from "./irregular-terrain-tool.ts";
import { moveNodeTool } from "./move-node-tool.ts";
import { navigateTool } from "./navigate-tool.ts";
import { terrainBrushTool } from "./terrain-brush-tool.ts";
import { towerStampTool } from "./tower-stamp-tool.ts";
import { wallBrushTool } from "./wall-brush-tool.ts";
import { wallLineTool } from "./wall-line-tool.ts";

/**
 * The single place that knows "which tool is which." Every other file in
 * `composition/tabletop/` (and `use-construction-pointer.ts` above it) looks
 * up a tool here rather than switching on `ConstructionToolId` itself.
 */
const TOOL_REGISTRY: { readonly [Id in ConstructionToolId]: ConstructionTool<Id> } = {
  navigate: navigateTool,
  "move-node": moveNodeTool,
  "terrain-brush": terrainBrushTool,
  "wall-brush": wallBrushTool,
  "wall-line": wallLineTool,
  "interior-wall": interiorWallTool,
  "tower-stamp": towerStampTool,
  "house-room-delete": houseRoomDeleteTool,
  "irregular-terrain-stamp": irregularTerrainTool,
};

export function toolFor<Id extends ConstructionToolId>(id: Id): ConstructionTool<Id> {
  return TOOL_REGISTRY[id];
}
