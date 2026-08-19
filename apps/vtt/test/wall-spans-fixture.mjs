/**
 * Builds the `ConstructionRegionTopology` shape the engine reports for one
 * upright wall panel, shared by every test that used to hand-roll a map
 * projection with `orderedNodeRefs`. A region projects as its own
 * `["@region", id]` key, so a node-id array is no longer what the wall
 * helpers read -- they read the boundary itself.
 */

const WALL_HEIGHT = 3;

/**
 * @param id region id; also namespaces the panel's own edge ids
 * @param corners `{ from: {x,z}, to: {x,z} }` in world units
 * @param nodeIds optional explicit ids, so two panels meeting at a corner
 *   can share one -- exactly how position-derived corner ids weld
 */
export function panelTopology(id, corners, nodeIds, surfaceType = "wall-white") {
  const ids = nodeIds ?? {
    bottomFrom: `${id}:a-bottom`,
    bottomTo: `${id}:b-bottom`,
    topTo: `${id}:b-top`,
    topFrom: `${id}:a-top`,
  };
  // `extrude_path`'s own cycle: [bottomFrom, bottomTo, topTo, topFrom].
  const nodes = [
    { id: ids.bottomFrom, position: { x: corners.from.x, y: 0, z: corners.from.z } },
    { id: ids.bottomTo, position: { x: corners.to.x, y: 0, z: corners.to.z } },
    { id: ids.topTo, position: { x: corners.to.x, y: WALL_HEIGHT, z: corners.to.z } },
    { id: ids.topFrom, position: { x: corners.from.x, y: WALL_HEIGHT, z: corners.from.z } },
  ];
  const outerLoop = nodes.map((node, index) => ({
    edgeId: `${id}-${index}`,
    reversed: false,
    startNodeId: node.id,
    endNodeId: nodes[(index + 1) % nodes.length].id,
    geometry: { kind: "line" },
  }));
  return {
    surfaceKey: ["@region", id],
    surfaceType,
    physical: true,
    outerLoops: [outerLoop],
    holes: [],
    nodes,
  };
}

export { WALL_HEIGHT };
