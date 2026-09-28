import type { ConstructionSurfaceKey } from "../../../../ports/index.ts";
import type { ToolContext } from "./tool-context.ts";

/** A region-backed face's key names it as `["@region", regionId]`. */
const regionIdOf = (key: ConstructionSurfaceKey): string | undefined => (key.length === 2 && key[0] === "@region" ? key[1] : undefined);

/** Gives each face a patch just made the properties its generator named for its region. */
export function keepFaceProps(runtime: ToolContext["runtime"], created: readonly ConstructionSurfaceKey[], faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>): void {
  for (const key of created) {
    const regionId = regionIdOf(key);
    const props = regionId === undefined ? undefined : faceProps.get(regionId);
    if (props) runtime.setRegionProps([key], props);
  }
}
