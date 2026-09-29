import { PINS_KEEP_HEIGHT_PROP, RECIPE_ROLE_PROP } from "../../../../features/edit-construction/index.ts";
import type { ChangeOrigin, ConstructionPinRequest, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "../../../../ports/index.ts";

/** What keeping a regenerated structure's properties and pins needs of the runtime. */
export interface FacePropsRuntime {
  setRegionProps(surfaceKeys: readonly ConstructionSurfaceKey[], props: Readonly<Record<string, unknown>> | null): unknown;
  pinNodes(pins: readonly ConstructionPinRequest[], origin: ChangeOrigin, causeId: string): unknown;
  /** Where relative points of a face stand -- to set down a pin that keeps its true height. */
  resolveOnHost?(request: { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly uv: readonly (readonly [number, number])[] }): readonly ConstructionPosition[];
}

/** A region-backed face's key names it as `["@region", regionId]`. */
const regionIdOf = (key: ConstructionSurfaceKey): string | undefined => (key.length === 2 && key[0] === "@region" ? key[1] : undefined);
const keyText = (key: ConstructionSurfaceKey) => key.join("\u0000");

/** What was pinned to faces about to be regenerated, by the role of the face each is pinned to. */
export interface PinnedToRoles {
  readonly pins: readonly {
    readonly nodeId: string; readonly role: string; readonly u: number; readonly v: number;
    /** On a face whose pins keep their true height: how high above the face's foot it stands. */
    readonly rise?: number;
  }[];
}

/** Reads, before `sources` are replaced, every node pinned to one of them whose face names its role -- pins ride on the faces' nodes. */
export function pinnedToRoles(topologies: readonly ConstructionRegionTopology[], sources: readonly ConstructionSurfaceKey[]): PinnedToRoles {
  const replaced = new Set(sources.map(keyText));
  const faces = new Map(topologies
    .filter((face) => replaced.has(keyText(face.surfaceKey)) && typeof face.props?.[RECIPE_ROLE_PROP] === "string")
    .map((face) => [keyText(face.surfaceKey), face] as const));
  const pins = new Map<string, PinnedToRoles["pins"][number]>();
  for (const node of topologies.flatMap((face) => face.nodes)) {
    const host = node.pin && faces.get(keyText(node.pin.hostSurfaceKey));
    if (!host || !node.pin) continue;
    const role = host.props![RECIPE_ROLE_PROP] as string;
    const foot = Math.min(...host.nodes.map((corner) => corner.position.y));
    const rise = host.props?.[PINS_KEEP_HEIGHT_PROP] === true ? { rise: node.position.y - foot } : {};
    pins.set(node.id, { nodeId: node.id, role, u: node.pin.u, v: node.pin.v, ...rise });
  }
  return { pins: [...pins.values()] };
}

/**
 * Gives each face a patch just made the properties its generator named for
 * its region, and pins what was pinned to a replaced face onto the new face
 * with the same role, where it stood on it -- a window stays in its gable.
 */
export function keepFaceProps(runtime: FacePropsRuntime, causeId: string, created: readonly ConstructionSurfaceKey[], faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>, pinned?: PinnedToRoles): void {
  const byRole = new Map<string, ConstructionSurfaceKey>();
  for (const key of created) {
    const regionId = regionIdOf(key);
    const props = regionId === undefined ? undefined : faceProps.get(regionId);
    if (!props) continue;
    runtime.setRegionProps([key], props);
    const role = props[RECIPE_ROLE_PROP];
    if (typeof role === "string" && !byRole.has(role)) byRole.set(role, key);
  }
  const keepsHeight = new Set(created.filter((key) => {
    const regionId = regionIdOf(key);
    return regionId !== undefined && faceProps.get(regionId)?.[PINS_KEEP_HEIGHT_PROP] === true;
  }).map(keyText));
  const pins: ConstructionPinRequest[] = (pinned?.pins ?? []).flatMap((pin) => {
    const host = byRole.get(pin.role);
    if (!host) return [];
    // Its true height above the new face's foot, as a share of that face's height where it stands.
    if (pin.rise !== undefined && keepsHeight.has(keyText(host)) && runtime.resolveOnHost) {
      const [foot, top] = runtime.resolveOnHost({ hostSurfaceKey: host, uv: [[pin.u, 0], [pin.u, 1]] });
      const height = top && foot ? top.y - foot.y : 0;
      if (height > 1e-9) return [{ nodeId: pin.nodeId, hostSurfaceKey: host, u: pin.u, v: pin.rise / height }];
    }
    return [{ nodeId: pin.nodeId, hostSurfaceKey: host, u: pin.u, v: pin.v }];
  });
  if (pins.length > 0) runtime.pinNodes(pins, "local", causeId);
}
