import type { CutFallout } from "@/features/edit-construction";

import type { TabletopRuntime } from "../tabletop-runtime.ts";
import { repairTerrainCut } from "./terrain/terrain-cut-repair.ts";

/**
 * One covered type's own answer to being cut -- `resolveCutRepair`'s
 * `"regenerate"`, made real. Pure declaration lives in `structure-types/`
 * (`CutRepair`); this is its composition-layer counterpart, since actually
 * repairing something needs a runtime that pure layer does not have.
 */
export type CutRepairExecutor = (runtime: TabletopRuntime, fallout: CutFallout, causeId: string) => number;

/**
 * Every structure type that has actually implemented `resolveCutRepair`'s
 * `"regenerate"` answer, keyed by `surfaceType`.
 *
 * `TabletopRuntime.applyPatchReplacement` is this table's only reader: it
 * already knows, from `resolveCutRepair` itself, which consumed region's
 * type is entitled to a repair -- this is only where it finds *whose* code
 * to call for one. A type absent here despite `resolveCutRepair` answering
 * `"regenerate"` for it is a declaration nobody has built yet, not a
 * contradiction; the runtime treats a missing entry as nothing to do.
 */
export const CUT_REPAIR_EXECUTORS: Readonly<Record<string, CutRepairExecutor>> = Object.freeze({
  terrain: repairTerrainCut,
  "terrain-grass": repairTerrainCut,
});
