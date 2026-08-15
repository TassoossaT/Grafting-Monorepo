import type { ConstructionToolId } from "@/features/edit-construction";

import type { ConstructionTool } from "./tool-context.ts";
import { irregularTerrainTool } from "./irregular-terrain-tool.ts";
import { moveNodeTool } from "./move-node-tool.ts";
import { navigateTool } from "./navigate-tool.ts";
import { roomStampTool } from "./room-stamp-tool.ts";
import { terrainBrushTool } from "./terrain-brush-tool.ts";
import { wallBrushTool } from "./wall-brush-tool.ts";

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
  "room-stamp": roomStampTool,
  "irregular-terrain-stamp": irregularTerrainTool,
};

export function toolFor<Id extends ConstructionToolId>(id: Id): ConstructionTool<Id> {
  return TOOL_REGISTRY[id];
}
