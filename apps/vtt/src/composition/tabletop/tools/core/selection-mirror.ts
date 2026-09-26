import type { ConstructionToolId, ToolParamsFor } from "../../../../features/edit-construction/index.ts";
import type { ToolContext } from "./tool-context.ts";

/**
 * A tool's picked structure, mirrored into the tool's own params so its
 * panel shows it, and edited back from them: a changed value is applied to
 * what was picked. Nothing here knows what is picked or how it is edited --
 * the options say how to read it, compare it, apply a change and where in
 * the params it lives.
 *
 * Wire `onSelect` to whatever reports a pick (`undefined` for none) and
 * `onParamsChange` to the tool's own hook.
 */
export interface SelectionMirrorOptions<Id extends ConstructionToolId, Value> {
  readonly id: Id;
  /** What `selectedId` is as a whole, or `undefined` when it is nothing this mirror edits. */
  readonly describe: (ctx: ToolContext, selectedId: string) => Value | undefined;
  readonly same: (a: Value, b: Value) => boolean;
  /** Edits the picked structure to `next`; returns the id that names it afterwards. Throws to refuse. */
  readonly apply: (ctx: ToolContext, selectedId: string, next: Value) => string | undefined;
  readonly read: (params: ToolParamsFor<Id>) => Value | undefined;
  readonly write: (params: ToolParamsFor<Id>, value: Value | undefined) => ToolParamsFor<Id>;
  /** Said when a change was applied, and when one was refused. */
  readonly messages: { readonly applied: string; readonly refused: string };
}

export interface SelectionMirror<Id extends ConstructionToolId> {
  onSelect(ctx: ToolContext, selectedId: string | undefined): void;
  onParamsChange(ctx: ToolContext, next: ToolParamsFor<Id>): void;
}

export function createSelectionMirror<Id extends ConstructionToolId, Value>(options: SelectionMirrorOptions<Id, Value>): SelectionMirror<Id> {
  const picked = new WeakMap<ToolContext["runtime"], { readonly selectedId: string; readonly value: Value }>();

  function mirror(ctx: ToolContext, selectedId: string | undefined): void {
    const value = selectedId === undefined ? undefined : options.describe(ctx, selectedId);
    // Nothing was picked and nothing is: the panel has nothing to change.
    if (value === undefined && !picked.has(ctx.runtime)) return;
    if (selectedId !== undefined && value !== undefined) picked.set(ctx.runtime, { selectedId, value });
    else picked.delete(ctx.runtime);
    ctx.updateToolParams?.(options.id, (params) => options.write(params, value));
  }

  return {
    onSelect: mirror,
    onParamsChange(ctx, next) {
      const current = picked.get(ctx.runtime);
      const wanted = options.read(next);
      if (!current || wanted === undefined || options.same(wanted, current.value)) return;
      try {
        mirror(ctx, options.apply(ctx, current.selectedId, wanted) ?? current.selectedId);
        ctx.reportFeedback({ tone: "success", message: options.messages.applied });
      } catch (error) {
        mirror(ctx, current.selectedId);
        ctx.reportFeedback({ tone: "error", message: `${options.messages.refused}: ${error instanceof Error ? error.message : String(error)}` });
      }
    },
  };
}
