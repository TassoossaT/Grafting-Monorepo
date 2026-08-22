import type { ConstructionToolId } from "@/features/edit-construction";

import type { ConstructionTool } from "./tool-context.ts";
import { houseRoomDeleteTool } from "../house/house-room-delete-tool.ts";
import { interiorWallTool } from "../house/interior-wall-tool.ts";
import { editRegionTool } from "./edit-region-tool.ts";
import { navigateTool } from "./navigate-tool.ts";
import { pathBrushTool } from "../paths/path-brush-tool.ts";
import { terrainSculptTool } from "../terrain/terrain-sculpt-tool.ts";
import { towerStampTool } from "../tower/tower-stamp-tool.ts";
import { wallBrushTool } from "../walls/wall-brush-tool.ts";
import { wallLineTool } from "../walls/wall-line-tool.ts";

/**
 * The single place that knows "which tool is which." Every other file in
 * `composition/tabletop/` (and `use-construction-pointer.ts` above it) looks
 * up a tool here rather than switching on `ConstructionToolId` itself.
 */
const TOOL_REGISTRY: { readonly [Id in ConstructionToolId]: ConstructionTool<Id> } = {
  navigate: navigateTool,
  "path-brush": pathBrushTool,
  "edit-region": editRegionTool,
  "wall-brush": wallBrushTool,
  "wall-line": wallLineTool,
  "interior-wall": interiorWallTool,
  "tower-stamp": towerStampTool,
  "house-room-delete": houseRoomDeleteTool,
  "terrain-sculpt": terrainSculptTool,
};

export function toolFor<Id extends ConstructionToolId>(id: Id): ConstructionTool<Id> {
  return TOOL_REGISTRY[id];
}
