import type { ConstructionTool } from "./tool-context.ts";

/**
 * No-op: in `navigate` mode the pointer drives camera orbit/pan
 * (`attachCameraNavigation`, wired independently in `tabletop-entry.tsx`),
 * not any construction effect. Exists so `tool-registry.ts` has an entry for
 * every `ConstructionToolId` and `use-construction-pointer.ts` never needs a
 * "no tool selected" special case.
 */
export const navigateTool: ConstructionTool<"navigate"> = {
  id: "navigate",
  defaultParams: () => ({}),
};
