const fs = require("fs");
const edit = (p, a, b) => { let s = fs.readFileSync(p, "utf8"); if (s.split(a).length !== 2) throw new Error(p + ": " + a); fs.writeFileSync(p, s.replace(a, b)); };

const r = "src/features/edit-construction/structure-types/roof/roof-recipe.ts";
edit(r, `/**
 * The roof \`request\` makes, as a patch named under \`operationId\`, and what
 * each face keeps, by region id: the recipe, under that name as its group,
 * its role, and that role as the key an edit finds the same face again by.
 */
export function roofGraphPatch(port: Pick<RoofPort, "generateRoof">, request: RoofSource, operationId: string): {
  readonly patch: ConstructionPatch;
  readonly faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
} {
  const { base, ...wire } = request;
  const roof: RoofPatch = port.generateRoof(wire);
  const nodeId = (index: number) => \`\${operationId}:node:\${index}\`;
  const edgeId = (index: number) => \`\${operationId}:edge:\${index}\`;
  const regionId = (index: number) => \`\${operationId}:face:\${index}\`;
  const uses = (loop: readonly (readonly [number, boolean])[]) => loop.map(([edge, reversed]) => ({ edgeId: edgeId(edge), reversed }));`, `/** How close a roof corner must stand to a standing node to be that node. */
const WELD = 1e-6;

/**
 * The roof \`request\` makes, as a patch named under \`operationId\`, and what
 * each face keeps, by region id: the recipe, under that name as its group,
 * its role, and that role as the key an edit finds the same face again by.
 *
 * Welded to what stands under it: every eave corner lying exactly on a node
 * of \`standing\` -- a floor's corner, a wall's top -- is that node, and every
 * eave between two of them that already has a side there is that side. So a
 * roof on a floor shares its corners and sides, and goes where they go.
 */
export function roofGraphPatch(port: Pick<RoofPort, "generateRoof">, request: RoofSource, operationId: string, standing: readonly ConstructionRegionTopology[] = []): {
  readonly patch: ConstructionPatch;
  readonly faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
} {
  const { base, ...wire } = request;
  const roof: RoofPatch = port.generateRoof(wire);
  const others = standing.filter((face) => face.props?.[ROOF_RECIPE_PROP] === undefined);
  const standingNodes = others.flatMap((face) => face.nodes);
  const welded = roof.nodes.map(([x, y, z]) => (Math.abs(y - request.elevation) > WELD ? undefined
    : standingNodes.find((node) => Math.abs(node.position.x - x) < WELD && Math.abs(node.position.y - y) < WELD && Math.abs(node.position.z - z) < WELD)));
  const sides = new Map(others.flatMap((face) => [...face.outerLoops, ...face.holes].flat()).map((use) => [[use.startNodeId, use.endNodeId].sort().join("\\u0000"), use] as const));
  const nodeId = (index: number) => welded[index]?.id ?? \`\${operationId}:node:\${index}\`;
  const sharedSide = (index: number) => {
    const edge = roof.edges[index]!;
    const [a, b] = [welded[edge.start], welded[edge.end]];
    return a && b ? sides.get([a.id, b.id].sort().join("\\u0000")) : undefined;
  };
  const edgeId = (index: number) => sharedSide(index)?.edgeId ?? \`\${operationId}:edge:\${index}\`;
  const regionId = (index: number) => \`\${operationId}:face:\${index}\`;
  // A shared side keeps its own direction: a use of it runs the other way when its start is the roof edge's end.
  const uses = (loop: readonly (readonly [number, boolean])[]) => loop.map(([edge, reversed]) => {
    const shared = sharedSide(edge);
    const flipped = shared !== undefined && shared.startNodeId !== nodeId(roof.edges[edge]!.start);
    return { edgeId: edgeId(edge), reversed: flipped ? !reversed : reversed };
  });`);
edit(r, `      nodes: roof.nodes.map(([x, y, z], index) => ({ id: nodeId(index), position: { x, y, z } })),
      edges: roof.edges.map((edge, index) => ({ edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end) })),`, `      nodes: roof.nodes.map(([x, y, z], index) => ({ id: nodeId(index), position: welded[index]?.position ?? { x, y, z } })),
      edges: roof.edges.map((edge, index) => {
        const shared = sharedSide(index);
        return shared
          ? { edgeId: shared.edgeId, startNodeId: shared.startNodeId, endNodeId: shared.endNodeId }
          : { edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end) };
      }),`);
edit(r, `  generate: (port, recipe, operationId) => roofGraphPatch(port, recipe as RoofRecipe, operationId),`, `  generate: (port, recipe, operationId, standing) => roofGraphPatch(port, recipe as RoofRecipe, operationId, standing),`);

const st = "src/features/edit-construction/structure-types/structure-type.ts";
edit(st, `  /** The structure \\\`recipe\\\` makes, named under \\\`operationId\\\`, with what each face keeps, by region id. */
  readonly generate: (port: GlobalHandlePort, recipe: unknown, operationId: string) => {`, `  /** The structure \\\`recipe\\\` makes, named under \\\`operationId\\\` among what is \\\`standing\\\`, with what each face keeps, by region id. */
  readonly generate: (port: GlobalHandlePort, recipe: unknown, operationId: string, standing: readonly ConstructionRegionTopology[]) => {`);

const prov = "src/features/edit-construction/orchestration/global-handles/recipe-handle-provider.ts";
edit(prov, `    const { patch, faceProps } = structure.type.generate(port, next, operationId);`, `    const { patch, faceProps } = structure.type.generate(port, next, operationId, scene.topologies);`);

// The roof's nodes no longer drag each other: it is made again, never carried corner by corner.
const rs = "src/features/edit-construction/structure-types/roof/roof-structure.ts";
let s = fs.readFileSync(rs, "utf8");
const i = s.indexOf("  motionInfluences: (topology) => {");
const j = s.indexOf("  },\n", s.indexOf("return anchor ?", i)) + 5;
if (i < 0 || j < 5) throw new Error("influences");
s = s.slice(0, i) + s.slice(j);
fs.writeFileSync(rs, s);

const t = "src/composition/tabletop/tools/roof/roof-tool.ts";
edit(t, `    const made = requests.map((request, i) => roofGraphPatch(ctx.runtime, request, requests.length === 1 ? operationId : \`\${operationId}:\${i}\`));`, `    const standing = ctx.runtime.getAllRegionTopologies();
    const made = requests.map((request, i) => roofGraphPatch(ctx.runtime, request, requests.length === 1 ? operationId : \`\${operationId}:\${i}\`, standing));`);
const f = "src/composition/tabletop/tools/roof/roof-follow-base.ts";
edit(f, `        made = roofGraphPatch(runtime, request, operationId);`, `        made = roofGraphPatch(runtime, request, operationId, topologies);`);
