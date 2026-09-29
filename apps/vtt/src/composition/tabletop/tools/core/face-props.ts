import { RECIPE_ROLE_PROP, type AtomicEditOp } from "../../../../features/edit-construction/index.ts";
import type { ChangeOrigin, ConstructionPinRequest, ConstructionRegionTopology, ConstructionSurfaceKey, RegionEditOutcome } from "../../../../ports/index.ts";

/** What keeping a regenerated structure's properties and pins needs of the runtime. */
export interface FacePropsRuntime {
  setRegionProps(surfaceKeys: readonly ConstructionSurfaceKey[], props: Readonly<Record<string, unknown>> | null): unknown;
  pinNodes(pins: readonly ConstructionPinRequest[], origin: ChangeOrigin, causeId: string): unknown;
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome;
}

/** A region-backed face's key names it as `["@region", regionId]`. */
const regionIdOf = (key: ConstructionSurfaceKey): string | undefined => (key.length === 2 && key[0] === "@region" ? key[1] : undefined);
const keyText = (key: ConstructionSurfaceKey) => key.join("\u0000");

/** What was pinned to faces about to be regenerated, by the role of the face each is pinned to. */
export interface PinnedToRoles {
  readonly pins: readonly { readonly nodeId: string; readonly role: string; readonly u: number; readonly v: number }[];
}

/** Reads, before `sources` are replaced, every node pinned to one of them whose face names its role -- pins ride on the faces' nodes. */
export function pinnedToRoles(topologies: readonly ConstructionRegionTopology[], sources: readonly ConstructionSurfaceKey[]): PinnedToRoles {
  const replaced = new Set(sources.map(keyText));
  const roles = new Map(topologies
    .filter((face) => replaced.has(keyText(face.surfaceKey)) && typeof face.props?.[RECIPE_ROLE_PROP] === "string")
    .map((face) => [keyText(face.surfaceKey), face.props![RECIPE_ROLE_PROP] as string]));
  const pins = new Map<string, PinnedToRoles["pins"][number]>();
  for (const node of topologies.flatMap((face) => face.nodes)) {
    const role = node.pin && roles.get(keyText(node.pin.hostSurfaceKey));
    if (role && node.pin) pins.set(node.id, { nodeId: node.id, role, u: node.pin.u, v: node.pin.v });
  }
  return { pins: [...pins.values()] };
}

/**
 * Gives each face a patch just made the properties its generator named for
 * its region, and pins what was pinned to a replaced face onto the new face
 * with the same role, where it stood on it -- a window stays in its gable.
 * What was pinned to a face with no successor goes with it: a window in a
 * dormer the roof no longer has, or in a roof taken away whole.
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
  const pins: ConstructionPinRequest[] = [];
  const stranded = new Set<string>();
  for (const pin of pinned?.pins ?? []) {
    const host = byRole.get(pin.role);
    if (host) pins.push({ nodeId: pin.nodeId, hostSurfaceKey: host, u: pin.u, v: pin.v });
    else stranded.add(pin.nodeId);
  }
  if (pins.length > 0) runtime.pinNodes(pins, "local", causeId);
  const gone = runtime.getAllRegionTopologies().filter((region) => region.nodes.some((node) => stranded.has(node.id)));
  if (gone.length > 0) runtime.applyRegionEdit(gone.map((region) => ({ kind: "delete-region" as const, surfaceKey: region.surfaceKey })), "local", causeId);
}
