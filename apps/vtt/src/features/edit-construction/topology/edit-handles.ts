import type {
  BezierPort,
  ConstructionCurvedEdge,
  ConstructionGraphSnapshot,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  ConstructionTopologyBoundsQuery,
} from "@/ports";

import { isSpineEdge, spineOwnerAt, spineOwnerOf } from "../spine/spine-owner.ts";
import { reverseGeometry } from "./boundary-edges.ts";
import { contourCurve, curveEdgesOf, curveHandles, curvePick, type CurveEdge } from "./curve-handles.ts";
import { panelHeightWidgetPick, panelHeightWidgets } from "./panel-height-widget.ts";

/**
 * The edit handles drawn on a structure: its vertices, its curve handles and
 * its panels' height widgets -- the only places a press edits instead of
 * creating. Each handle names the faces (or, for a spine, the type) it edits,
 * so whoever asks can tell whether the active tool owns it.
 */

export type EditHandleRole = "vertex" | "curve" | "height";

export interface EditHandleOwner {
  readonly surfaceType: string;
  /** Absent for a handle kept on a spine rather than on a face. */
  readonly surfaceKey?: ConstructionSurfaceKey;
}

export interface EditHandle {
  readonly id: string;
  readonly role: EditHandleRole;
  readonly position: ConstructionPosition;
  readonly owners: readonly EditHandleOwner[];
}

export interface EditHandleSource extends Pick<BezierPort, "curveBatch"> {
  getRegionTopologiesInBounds(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[];
  getGraphSnapshot(): ConstructionGraphSnapshot;
  getCurvedEdges(): readonly ConstructionCurvedEdge[];
}

/** How far around a handle's position the faces it may belong to are looked up. */
const OWNER_REACH = 0.5;
/** How far outside a face's own footprint a spine anchor still counts as that face's. */
const SPINE_REACH = 1;

const faceOwner = (topology: ConstructionRegionTopology): EditHandleOwner => ({
  surfaceType: topology.surfaceType,
  surfaceKey: topology.surfaceKey,
});

function usesEdge(topology: ConstructionRegionTopology, edgeId: string): boolean {
  return [...topology.outerLoops, ...topology.holes].some((loop) => loop.some((edge) => edge.edgeId === edgeId));
}

class HandleSet {
  readonly #byId = new Map<string, { role: EditHandleRole; position: ConstructionPosition; owners: EditHandleOwner[] }>();

  add(id: string, role: EditHandleRole, position: ConstructionPosition, owner: EditHandleOwner): void {
    const existing = this.#byId.get(id);
    if (existing === undefined) {
      this.#byId.set(id, { role, position, owners: [owner] });
      return;
    }
    const duplicate = existing.owners.some((known) =>
      known.surfaceType === owner.surfaceType && known.surfaceKey?.join() === owner.surfaceKey?.join());
    if (!duplicate) existing.owners.push(owner);
  }

  list(): readonly EditHandle[] {
    return [...this.#byId].map(([id, handle]) => ({ id, ...handle }));
  }
}

/** A face's curved boundary edges, each walked in the edge's own direction, as its curve handles are placed. */
function contourEdgesOf(topology: ConstructionRegionTopology): readonly CurveEdge[] {
  const positionOf = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const edges: CurveEdge[] = [];
  for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
    if (use.geometry.kind !== "bezier") continue;
    const startNodeId = use.reversed ? use.endNodeId : use.startNodeId;
    const endNodeId = use.reversed ? use.startNodeId : use.endNodeId;
    const start = positionOf.get(startNodeId);
    const end = positionOf.get(endNodeId);
    const geometry = use.reversed ? reverseGeometry(use.geometry) : use.geometry;
    if (start === undefined || end === undefined || geometry.kind !== "bezier") continue;
    edges.push({
      edgeId: use.edgeId,
      store: "contour",
      startNodeId,
      endNodeId,
      curve: contourCurve({ edgeId: use.edgeId, startNodeId, endNodeId, start, end, handle1: geometry.handle1, handle2: geometry.handle2 }),
    });
  }
  return edges;
}

/** Every handle drawn on `faces`: their vertices, their panels' height widgets and their curved edges' handles. */
export function faceHandles(
  faces: readonly ConstructionRegionTopology[],
  port: Partial<Pick<BezierPort, "curveBatch">>,
): readonly EditHandle[] {
  const handles = new HandleSet();
  for (const face of faces) {
    const owner = faceOwner(face);
    for (const node of face.nodes) handles.add(node.id, "vertex", node.position, owner);
    for (const widget of panelHeightWidgets([face])) handles.add(widget.id, "height", widget.position, owner);
  }
  if (typeof port.curveBatch === "function") {
    const curved = faces.flatMap((face) => contourEdgesOf(face).map((edge) => ({ face, edge })));
    const unique = [...new Map(curved.map((entry) => [entry.edge.edgeId, entry.edge])).values()];
    const placed = new Map(curveHandles(unique, port as Pick<BezierPort, "curveBatch">).map((handle) => [handle.id, handle.position]));
    for (const { face, edge } of curved) {
      for (const [id, position] of placed) {
        if (curvePick(id)?.edgeId === edge.edgeId) handles.add(id, "curve", position, faceOwner(face));
      }
    }
  }
  return handles.list();
}

/**
 * The spine anchors and curve handles belonging to `faces`: spans their own
 * type generates, with an anchor inside one of their footprints. A spine is
 * kept on the graph, not on the face it generates, so this is the one lookup
 * that has to read the whole graph -- run it when the focus changes, not per
 * drag tick.
 */
export function spineHandles(
  faces: readonly ConstructionRegionTopology[],
  snapshot: ConstructionGraphSnapshot,
  port: Partial<Pick<BezierPort, "curveBatch">>,
): readonly EditHandle[] {
  if (faces.length === 0 || typeof port.curveBatch !== "function") return [];
  const positions = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
  const footprints = faces.map((face) => {
    const xs = face.nodes.map((node) => node.position.x);
    const zs = face.nodes.map((node) => node.position.z);
    return {
      surfaceType: face.surfaceType,
      minX: Math.min(...xs) - SPINE_REACH,
      maxX: Math.max(...xs) + SPINE_REACH,
      minZ: Math.min(...zs) - SPINE_REACH,
      maxZ: Math.max(...zs) + SPINE_REACH,
    };
  });
  const inside = (owner: string, id: string) => {
    const at = positions.get(id);
    return at !== undefined && footprints.some((box) =>
      box.surfaceType === owner && at.x >= box.minX && at.x <= box.maxX && at.z >= box.minZ && at.z <= box.maxZ);
  };
  const spans = snapshot.edges.filter((edge) => {
    const owner = spineOwnerOf(edge);
    return edge.curve !== undefined && isSpineEdge(edge) && owner !== undefined
      && (inside(owner, edge.startNodeId) || inside(owner, edge.endNodeId));
  });
  if (spans.length === 0) return [];
  const handles = new HandleSet();
  const ownerOfSpan = new Map(spans.map((span) => [span.edgeId, spineOwnerOf(span)!]));
  for (const span of spans) {
    for (const id of [span.startNodeId, span.endNodeId]) {
      const at = positions.get(id);
      if (at !== undefined) handles.add(id, "curve", at, { surfaceType: ownerOfSpan.get(span.edgeId)! });
    }
  }
  const edges = curveEdgesOf({ nodes: snapshot.nodes, edges: spans }, [], port as Pick<BezierPort, "curveBatch">);
  for (const handle of curveHandles(edges, port as Pick<BezierPort, "curveBatch">)) {
    const owner = ownerOfSpan.get(curvePick(handle.id)?.edgeId ?? "");
    if (owner !== undefined) handles.add(handle.id, "curve", handle.position, { surfaceType: owner });
  }
  return handles.list();
}

function facesNear(source: EditHandleSource, point: ConstructionPosition): readonly ConstructionRegionTopology[] {
  return source.getRegionTopologiesInBounds({
    minX: point.x - OWNER_REACH,
    minZ: point.z - OWNER_REACH,
    maxX: point.x + OWNER_REACH,
    maxZ: point.z + OWNER_REACH,
  });
}

/**
 * What the handle `id` the pointer hit at `point` edits, read from the live
 * session -- `undefined` when `id` names no edit handle. Asked only when the
 * pointer is actually over a handle, so the lookups stay local to it.
 */
export function describeHandle(source: EditHandleSource, id: string, point: ConstructionPosition): EditHandle | undefined {
  const widget = panelHeightWidgetPick(id);
  if (widget !== undefined) {
    const owners = facesNear(source, point).filter((face) => usesEdge(face, widget.edgeId)).map(faceOwner);
    return owners.length === 0 ? undefined : { id, role: "height", position: point, owners };
  }

  const curve = curvePick(id);
  if (curve !== undefined) {
    const span = source.getGraphSnapshot().edges.find((edge) => edge.edgeId === curve.edgeId && edge.curve);
    if (span !== undefined) {
      const owner = spineOwnerOf(span);
      return owner === undefined ? undefined : { id, role: "curve", position: point, owners: [{ surfaceType: owner }] };
    }
    const contour = source.getCurvedEdges().find((edge) => edge.edgeId === curve.edgeId);
    if (contour === undefined) return undefined;
    const owners = facesNear(source, contour.start).filter((face) => usesEdge(face, curve.edgeId)).map(faceOwner);
    return owners.length === 0 ? undefined : { id, role: "curve", position: point, owners };
  }

  const faces = facesNear(source, point).filter((face) => face.nodes.some((node) => node.id === id));
  if (faces.length > 0) return { id, role: "vertex", position: point, owners: faces.map(faceOwner) };
  const spineOwner = spineOwnerAt(source.getGraphSnapshot(), id);
  return spineOwner === undefined ? undefined : { id, role: "curve", position: point, owners: [{ surfaceType: spineOwner }] };
}
