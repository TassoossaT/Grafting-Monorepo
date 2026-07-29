import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outputPath = resolve(root, "docs/generated/grafting.graph.spike.json");
const check = process.argv.includes("--check");

const readText = (relative) => readFile(resolve(root, relative), "utf8");
const readJson = async (relative) => JSON.parse(await readText(relative));
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

const nxText = await readText("docs/generated/project-graph.json");
const agentsText = await readText(".ai/registry/agents.yaml");
const taskNames = (await readdir(resolve(root, ".ai/state/tasks")))
  .filter((name) => name.endsWith(".json"))
  .sort();
const taskTexts = await Promise.all(taskNames.map((name) => readText(`.ai/state/tasks/${name}`)));
const inputHash = createHash("sha256")
  .update(nxText)
  .update(agentsText)
  .update(taskTexts.join(""))
  .digest("hex");

const nx = JSON.parse(nxText).graph;
const agents = JSON.parse(agentsText).agents;
const tasks = taskTexts.map(JSON.parse);
const nodes = [];
const edges = [];

for (const [name, node] of Object.entries(nx.nodes).sort(([left], [right]) => left.localeCompare(right))) {
  nodes.push({
    id: `project:${name}`,
    kind: "project",
    label: name,
    tags: [...(node.data.tags ?? [])].sort(),
    source: node.data.root ? `${node.data.root}/project.json` : "package.json",
  });
}

for (const agent of [...agents].sort((left, right) => left.id.localeCompare(right.id))) {
  nodes.push({
    id: `agent:${agent.id}`,
    kind: "agent",
    label: agent.id,
    tags: [`provider:${agent.provider}`],
    source: ".ai/registry/agents.yaml",
  });
}

for (const task of [...tasks].sort((left, right) => left.task_id.localeCompare(right.task_id))) {
  nodes.push({
    id: `task:${task.task_id}`,
    kind: "task",
    label: task.task_id,
    tags: [`status:${task.status}`],
    source: `.ai/state/tasks/${task.task_id}.json`,
  });
  if (task.owner) {
    edges.push({
      id: `task:${task.task_id}->agent:${task.owner}:owned_by`,
      kind: "owned_by",
      source: `task:${task.task_id}`,
      target: `agent:${task.owner}`,
      evidence: `.ai/state/tasks/${task.task_id}.json#/owner`,
    });
  }
}

for (const [source, dependencies] of Object.entries(nx.dependencies).sort(([left], [right]) => left.localeCompare(right))) {
  for (const dependency of [...dependencies].sort((left, right) => left.target.localeCompare(right.target))) {
    edges.push({
      id: `project:${source}->project:${dependency.target}:depends_on:${dependency.type}`,
      kind: "depends_on",
      source: `project:${source}`,
      target: `project:${dependency.target}`,
      evidence: `docs/generated/project-graph.json#${dependency.type}`,
    });
  }
}

nodes.sort((left, right) => left.id.localeCompare(right.id));
edges.sort((left, right) => left.id.localeCompare(right.id));
const graph = {
  schemaVersion: "0.1-spike",
  generator: { id: "grafting-graph-ir-spike", version: 1 },
  inputHash,
  nodes,
  edges,
};

const nodeIds = new Set(nodes.map((node) => node.id));
if (nodeIds.size !== nodes.length) throw new Error("duplicate Graph IR node ID");
const edgeIds = new Set(edges.map((edge) => edge.id));
if (edgeIds.size !== edges.length) throw new Error("duplicate Graph IR edge ID");
for (const edge of edges) {
  if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
    throw new Error(`edge ${edge.id} references a missing node`);
  }
}

const rendered = canonical(graph);
if (check) {
  const existing = await readFile(outputPath, "utf8");
  if (existing !== rendered) throw new Error("Graph IR candidate is stale; run graph:generate");
  console.log(`Graph IR candidate is current: ${nodes.length} nodes, ${edges.length} edges`);
} else {
  await writeFile(outputPath, rendered);
  console.log(`Generated ${outputPath}: ${nodes.length} nodes, ${edges.length} edges`);
}
