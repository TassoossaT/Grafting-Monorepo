import { AppTabletopRuntime, type TabletopRuntime } from "./tabletop-runtime.ts";

export interface CreateTabletopRuntimeInput {
  readonly tableId: string;
}

export function createTabletopRuntime(
  input: CreateTabletopRuntimeInput,
): TabletopRuntime {
  return new AppTabletopRuntime(input.tableId);
}
