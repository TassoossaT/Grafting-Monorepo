import type { ConstructionPatch, ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";
import type { RoofDormer, RoofFootprint, RoofPatch, RoofPort, RoofRequest } from "../../../../ports/cap-port.ts";

import { insideRingXZ } from "../../topology/plan-geometry.ts";
import { faceArea } from "../../topology/plan-overlap.ts";
import { hasTrait } from "../registry.ts";
import { RECIPE_ROLE_PROP } from "../structure-type.ts";
import { ringsOf, ROOF_FACE_PROP, ROOF_RECIPE_PROP, type Point, type RoofFaceRole, type RoofRecipe, type RoofSource } from "./roof-recipe.ts";

/** The name a dormer's faces are known by across regeneration: its own, or -- one made before dormers had names -- its place. */
function dormerKey(dormers: readonly RoofDormer[] | undefined, index: number | null): string {
  return index === null ? "-" : dormers?.[index]?.id ?? String(index);
}

/** How close a roof corner must stand to a standing node to be that node. */
const WELD = 1e-6;

/**
 * The roof `request` makes, as a patch named under `operationId`, and what
 * each face keeps, by region id: the recipe, under that name as its group,
 * its role, and that role as the key an edit finds the same face again by.
 *
 * Welded to what stands under it: every eave corner lying exactly on a node
 * of `standing` -- a floor's corner, a wall's top -- is that node, and every
 * eave between two of them that already has a side there is that side. So a
 * roof on a floor shares its corners and sides, and goes where they go.
 */
export function roofGraphPatch(port: Pick<RoofPort, "generateRoof">, request: RoofSource, operationId: string, standing: readonly ConstructionRegionTopology[] = []): {
  readonly patch: ConstructionPatch;
  readonly faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
} {
  const { base, anchors, ...wire } = request;
  const plan = (ring: readonly { readonly x: number; readonly z: number }[]): Point[] => ring.map(({ x, z }) => [x, z]);
  // A floor placed inside a roof's rise replaces the leaves beneath its own
  // boundary. Its live edges supply the cut each time either structure changes.
  // A floor at the eaves is the roof's base, so it does not cut its own roof.
  const platformCuts: NonNullable<RoofRequest["platform_cuts"]>[number][] = standing.flatMap((face) => {
    if (!hasTrait(face.surfaceType, "floor") || face.nodes.length === 0) return [];
    const level = face.nodes[0]!.position.y;
    if (!face.nodes.every((node) => Math.abs(node.position.y - level) < 1e-4)
      || level <= request.elevation + 1e-4 || level > request.elevation + request.height + 1e-4) return [];
    const area = faceArea(face);
    const holes = area.holes.map(plan);
    return area.outers.map(plan).filter((outer) => outer.length >= 3).map((outer) => ({
      elevation: level,
      footprint: { outer, holes: holes.filter((hole) => hole.length >= 3 && insideRingXZ(outer, { x: hole[0]![0], z: hole[0]![1] })) },
    }));
  });
  // What cuts is pinned onto a face, not built beside it: never welded to --
  // an opening filling a front shares its corners without being structure.
  const others = standing.filter((face) => face.props?.[ROOF_RECIPE_PROP] === undefined && !hasTrait(face.surfaceType, "cuts"));
  // Roof-generated upright closures can support another roof at a different
  // elevation. Share their vertices, while each roof keeps its own recipe.
  const supports = standing.filter((face) => hasTrait(face.surfaceType, "partition") && hasTrait(face.surfaceType, "roof-generated"));
  const standingNodes = [...others, ...supports].flatMap((face) => face.nodes);
  const supportedNodes = standing.filter((face) => hasTrait(face.surfaceType, "partition")).flatMap((face) => face.nodes);
  const inferAnchors = (footprints: readonly RoofFootprint[], elevation: number) => ringsOf(footprints).flatMap((ring, r) => ring.points.flatMap(([x, z], corner) => {
    const node = supportedNodes.find((candidate) => Math.abs(candidate.position.y - elevation) < WELD && Math.abs(candidate.position.x - x) < WELD && Math.abs(candidate.position.z - z) < WELD);
    return node ? [{ ring: r, corner, nodeId: node.id }] : [];
  }));
  const inferredAnchors = base ? [] : inferAnchors(request.footprints, request.elevation);
  const generate = (children: readonly RoofSource[]): RoofPatch => port.generateRoof({ ...wire, subroofs: children.map(({ base: _, anchors: __, ...child }) => child), platform_cuts: platformCuts });
  /** Tops of this roof's own upright closures, by plan position: where a subroof can stand. */
  const wallTops = (made: RoofPatch) => {
    const upright = new Set(made.faces.filter((face) => face.upright && face.subroof === null)
      .flatMap((face) => [face.boundary, ...face.holes].flat().flatMap(([edge]) => [made.edges[edge]!.start, made.edges[edge]!.end])));
    return (x: number, z: number) => [...upright].filter((index) => Math.abs(made.nodes[index]![0] - x) < WELD && Math.abs(made.nodes[index]![2] - z) < WELD);
  };
  let subroofs: RoofSource[] = (request.subroofs ?? []).map((child) => ({ ...child, anchors: child.anchors ?? inferAnchors(child.footprints, child.elevation) }));
  let roof: RoofPatch = generate(subroofs);
  // A subroof standing on this roof's own walls rises and falls with their
  // tops: a wall pushed out up the slope lifts the eaves it carries.
  const lifted = subroofs.map((child) => {
    if (!child.anchors?.length) return child;
    const rings = ringsOf(child.footprints);
    const at = wallTops(roof);
    const levels = child.anchors.flatMap(({ ring, corner }) => {
      const point = rings[ring]?.points[corner];
      const tops = point ? at(point[0], point[1]).map((index) => roof.nodes[index]![1]) : [];
      // Generated nodes come back in single precision; an eave a hair below
      // the wall top would leave a sliver between it and the slope it meets.
      return tops.length ? [Math.round(Math.max(...tops) * 1e6) / 1e6] : [];
    });
    return levels.length && levels.every((level) => Math.abs(level - levels[0]!) < 1e-4) && Math.abs(levels[0]! - child.elevation) > 1e-6
      ? { ...child, elevation: levels[0]! } : child;
  });
  if (lifted.some((child, k) => child !== subroofs[k])) {
    subroofs = lifted;
    roof = generate(subroofs);
  }
  const welded = roof.nodes.map(([x, y, z]) => standingNodes.find((node) => Math.abs(node.position.x - x) < WELD && Math.abs(node.position.y - y) < WELD && Math.abs(node.position.z - z) < WELD));
  const sides = new Map(others.flatMap((face) => [...face.outerLoops, ...face.holes].flat()).map((use) => [[use.startNodeId, use.endNodeId].sort().join("\u0000"), use] as const));
  const nodeId = (index: number) => welded[index]?.id ?? `${operationId}:node:${index}`;
  const sharedSide = (index: number) => {
    const edge = roof.edges[index]!;
    const [a, b] = [welded[edge.start], welded[edge.end]];
    return a && b ? sides.get([a.id, b.id].sort().join("\u0000")) : undefined;
  };
  const edgeId = (index: number) => sharedSide(index)?.edgeId ?? `${operationId}:edge:${index}`;
  const regionId = (index: number) => `${operationId}:face:${index}`;
  /** A shared side as it is stored, whichever way the face standing on it walks it. */
  const stored = (use: ConstructionRegionEdge) => (use.reversed ? { start: use.endNodeId, end: use.startNodeId } : { start: use.startNodeId, end: use.endNodeId });
  /** Where a roof loop's use of edge `edge` starts walking. */
  const walkStart = (edge: number, reversed: boolean) => nodeId(reversed ? roof.edges[edge]!.end : roof.edges[edge]!.start);
  // A side two faces share is walked one way by each: welded to a floor, the
  // roof takes the side it leaves free -- the whole roof wound the other way
  // round when it would walk a shared side the way the floor does.
  const turned = roof.faces.some((face) => [face.boundary, ...face.holes].flat().some(([edge, reversed]) => {
    const shared = sharedSide(edge);
    return shared !== undefined && walkStart(edge, reversed) === shared.startNodeId;
  }));
  const uses = (loop: readonly (readonly [number, boolean])[]) => {
    const walked = (turned ? [...loop].reverse().map(([edge, reversed]) => [edge, !reversed] as const) : loop);
    return walked.map(([edge, reversed]) => {
      const shared = sharedSide(edge);
      return { edgeId: edgeId(edge), reversed: shared ? walkStart(edge, reversed) !== stored(shared).start : reversed };
    });
  };
  const keptAnchors = anchors ?? inferredAnchors;
  // This roof's own nodes are named anew each time it is made: a subroof on
  // its walls re-anchors to the tops just made; one on another roof keeps its nodes.
  const tops = wallTops(roof);
  subroofs = subroofs.map((child) => {
    const rings = ringsOf(child.footprints);
    const own = (child.anchors ?? []).flatMap(({ ring, corner, nodeId: kept }) => {
      const point = rings[ring]?.points[corner];
      const top = point ? tops(point[0], point[1]).find((index) => Math.abs(roof.nodes[index]![1] - child.elevation) < 1e-4) : undefined;
      return [{ ring, corner, nodeId: top === undefined ? kept : nodeId(top) }];
    });
    return { ...child, anchors: own };
  });
  const recipe: RoofRecipe = { elevation: request.elevation, height: request.height, footprints: request.footprints, slopes: request.slopes, dormers: request.dormers ?? [], cutouts: request.cutouts ?? [], subroofs, ...(base ? { base } : {}), ...(keptAnchors.length ? { anchors: keptAnchors } : {}), group: operationId };
  const faceProps = new Map<string, Readonly<Record<string, unknown>>>();
  roof.faces.forEach((face, index) => {
    const role: RoofFaceRole = { side: face.side, upright: face.upright, ...(face.dormer === null ? {} : { dormer: face.dormer }), ...(face.subroof === null ? {} : { subroof: face.subroof }) };
    const dormer = dormerKey(face.subroof === null ? request.dormers : request.subroofs?.[face.subroof]?.dormers, face.dormer);
    faceProps.set(regionId(index), { [ROOF_RECIPE_PROP]: recipe, [ROOF_FACE_PROP]: role, [RECIPE_ROLE_PROP]: `${face.subroof ?? "-"}:${dormer}:${face.side}:${face.upright ? "upright" : "leaf"}` });
  });
  return {
    patch: {
      nodes: roof.nodes.map(([x, y, z], index) => ({ id: nodeId(index), position: welded[index]?.position ?? { x, y, z } })),
      edges: roof.edges.map((edge, index) => {
        const shared = sharedSide(index);
        return shared
          ? { edgeId: shared.edgeId, startNodeId: stored(shared).start, endNodeId: stored(shared).end }
          : { edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end) };
      }),
      regions: roof.faces.map((face, index) => ({
        regionId: regionId(index), surfaceType: face.upright ? "roof-transition" : "roof", physical: true,
        boundary: uses(face.boundary), ...(face.holes.length > 0 ? { holes: face.holes.map(uses) } : {}),
      })),
    },
    faceProps,
  };
}
