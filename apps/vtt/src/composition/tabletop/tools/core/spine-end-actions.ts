import { detachSpineEnd, isSpineControlNodeId, spineEndWelded, spineOwnerAt, structureTypeFor, type SpineGeneration } from "../../../../features/edit-construction/index.ts";
import { commitSpineRegeneration } from "./spine-commit.ts";
import { scopedToolId, type ToolContext } from "./tool-context.ts";

/**
 * What a picked spine end offers besides dragging it: disconnecting it from
 * the floor it is welded into, for any owner whose ends weld
 * (`SpineGeneration.endRung`). Moving it connects and disconnects already.
 */

const DISCONNECT = { id: "disconnect", label: "Desconectar" } as const;

function generationAt(ctx: ToolContext, nodeId: string): SpineGeneration | undefined {
  if (!isSpineControlNodeId(nodeId)) return undefined;
  const owner = spineOwnerAt(ctx.runtime.getGraphSnapshot(), nodeId);
  return owner === undefined ? undefined : structureTypeFor(owner)?.spine;
}

/** The actions the spine end `nodeId` offers now -- none for anything else. */
export function spineEndActionsAt(ctx: ToolContext, nodeId: string): readonly { readonly id: string; readonly label: string }[] {
  const generation = generationAt(ctx, nodeId);
  return generation && spineEndWelded(generation, nodeId, ctx.runtime.getAllRegionTopologies()) ? [DISCONNECT] : [];
}

/** Runs `action` on the spine end `nodeId`; `false` when it offers no such action. */
export function runSpineEndAction(ctx: ToolContext, nodeId: string, action: string): boolean {
  const generation = generationAt(ctx, nodeId);
  if (action !== DISCONNECT.id || !generation) return false;
  const operationId = scopedToolId(ctx, "spine-detach", ctx.nextSequence());
  const request = detachSpineEnd(generation, nodeId, ctx.runtime.getAllRegionTopologies(), operationId);
  if (!request) return false;
  try {
    commitSpineRegeneration(ctx, request, operationId);
    ctx.reportFeedback({ tone: "success", message: "Ponta desconectada." });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: `Estrutura preservada: ${error instanceof Error ? error.message : String(error)}` });
  }
  return true;
}
