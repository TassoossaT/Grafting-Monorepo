import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "../..");
const defaultSchemaPath = resolve(root, "docs/graph-ir/graph-ir-v1.schema.json");

export class GraphIrValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GraphIrValidationError";
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function formatSchemaErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("\n");
}

function canonicalEdgeId(edge) {
  return `edge:${encodeURIComponent(edge.source)}--${edge.kind}--${encodeURIComponent(edge.target)}`;
}

function validateSorted(records, name, errors) {
  const ids = records.map((record) => record.id);
  const sorted = [...ids].sort();
  if (ids.some((id, index) => id !== sorted[index])) {
    errors.push(`${name} must be sorted by ID`);
  }
}

function validateEvidencePath(path, location, errors) {
  const segments = path.split("/");
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    errors.push(`${location} must be a normalized repository-relative path`);
  }
}

function validateProvenance(provenance, sourceRevision, location, errors) {
  if (provenance.sourceRevision !== sourceRevision) {
    errors.push(`${location}.sourceRevision must match the graph sourceRevision`);
  }
  provenance.evidence.forEach((evidence, index) => {
    validateEvidencePath(evidence.path, `${location}.evidence[${index}].path`, errors);
  });
}

function validateSemantics(document) {
  const errors = [];
  validateSorted(document.nodes, "nodes", errors);
  validateSorted(document.edges, "edges", errors);

  document.nodes.forEach((node, index) => {
    if (!node.id.startsWith(`${node.kind}:`)) {
      errors.push(`nodes[${index}].id must start with ${node.kind}:`);
    }
    validateProvenance(node.provenance, document.sourceRevision, `nodes[${index}].provenance`, errors);
  });

  document.edges.forEach((edge, index) => {
    if (edge.id !== canonicalEdgeId(edge)) {
      errors.push(`edges[${index}].id is not canonical for its source/kind/target tuple`);
    }
    if (edge.relationClass === "declared" && edge.provenance.confidence !== 1) {
      errors.push(`edges[${index}] declared relations must have confidence 1`);
    }
    if (edge.relationClass === "approximate" && edge.provenance.confidence >= 1) {
      errors.push(`edges[${index}] approximate relations must have confidence below 1`);
    }
    validateProvenance(edge.provenance, document.sourceRevision, `edges[${index}].provenance`, errors);
  });

  if (errors.length > 0) {
    throw new GraphIrValidationError(`Graph IR semantic validation failed:\n${errors.join("\n")}`);
  }
}

export async function createGraphIrValidator(schemaPath = defaultSchemaPath) {
  const schema = await readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(schema);
}

export async function validateGraphIrDocument(document, schemaPath = defaultSchemaPath) {
  const validateSchema = await createGraphIrValidator(schemaPath);
  if (!validateSchema(document)) {
    throw new GraphIrValidationError(
      `Graph IR JSON Schema validation failed:\n${formatSchemaErrors(validateSchema.errors ?? [])}`,
    );
  }
  validateSemantics(document);
  return document;
}

export async function validateGraphIrFile(filePath, schemaPath = defaultSchemaPath) {
  const absolutePath = resolve(root, filePath);
  const document = await readJson(absolutePath);
  await validateGraphIrDocument(document, schemaPath);
  return document;
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    throw new GraphIrValidationError("provide at least one Graph IR JSON file");
  }
  for (const path of paths) {
    const document = await validateGraphIrFile(path);
    const nodeLabel = document.nodes.length === 1 ? "node" : "nodes";
    const edgeLabel = document.edges.length === 1 ? "edge" : "edges";
    console.log(
      `Graph IR v1 valid: ${path} (${document.nodes.length} ${nodeLabel}, ${document.edges.length} ${edgeLabel})`,
    );
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
