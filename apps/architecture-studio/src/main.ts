import {
  createReadOnlyCanvas,
  type CanvasEntityReference,
  type ReadOnlyCanvas,
} from "@grafting/x6-canvas";
import graphData from "../../../docs/generated/grafting.graph.json";
import { requestGraphLayout } from "./layout-client.js";
import {
  assertGraphIrV1,
  findEntity,
  isGraphIrEdge,
  toCanvasPresentation,
  toEntityReference,
  toLayoutRequest,
  type GraphIrDocument,
  type GraphIrEntity,
} from "./presentation.js";
import "./style.css";

const requireElement = <ElementType extends HTMLElement>(selector: string) => {
  const element = document.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Architecture Studio shell is missing ${selector}`);
  return element;
};

const graphContainer = requireElement<HTMLElement>("#graph");
const entityList = requireElement<HTMLUListElement>("#entity-list");
const inspector = requireElement<HTMLElement>("#inspector-content");
const status = requireElement<HTMLElement>("#status");
const graphIdentity = requireElement<HTMLElement>("#graph-identity");
const graphCounts = requireElement<HTMLElement>("#graph-counts");
const center = requireElement<HTMLButtonElement>("#center");
const reset = requireElement<HTMLButtonElement>("#reset");
const selectionButtons = new Map<string, HTMLButtonElement>();

let view: ReadOnlyCanvas | undefined;
let selected: CanvasEntityReference | null = null;

const setStatus = (message: string, state = "ready") => {
  status.textContent = message;
  status.dataset.status = state;
};

const createText = (tag: keyof HTMLElementTagNameMap, text: string, className?: string) => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className !== undefined) element.className = className;
  return element;
};

const addCopyAction = (container: HTMLElement, label: string, value: string) => {
  const row = document.createElement("div");
  row.className = "copy-row";
  const description = document.createElement("dd");
  description.append(createText("span", value));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = "Copy";
  button.setAttribute("aria-label", `Copy ${label}`);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`Copied ${label}.`);
    } catch {
      setStatus(`Could not copy ${label}; clipboard permission was denied.`, "warning");
    }
  });
  description.append(button);
  row.append(createText("dt", label), description);
  container.append(row);
};

const addField = (container: HTMLElement, label: string, value: string) => {
  const row = document.createElement("div");
  row.className = "field-row";
  row.append(createText("dt", label), createText("dd", value));
  container.append(row);
};

const renderEvidence = (entity: GraphIrEntity) => {
  const section = document.createElement("section");
  section.className = "inspector-section";
  section.append(createText("h3", `Evidence (${entity.provenance.evidence.length})`));

  entity.provenance.evidence.forEach((evidence, index) => {
    const card = document.createElement("article");
    card.className = "evidence-card";
    card.append(createText("h4", `${index + 1}. ${evidence.kind}`));
    const details = document.createElement("dl");
    addCopyAction(details, "Path", evidence.path);
    if (evidence.pointer !== undefined) addCopyAction(details, "JSON pointer", evidence.pointer);
    if (evidence.symbol !== undefined) addCopyAction(details, "Symbol", evidence.symbol);
    addCopyAction(details, "SHA-256", evidence.sha256);
    card.append(details);
    section.append(card);
  });
  return section;
};

const activateEntity = (reference: CanvasEntityReference, updateCanvas: boolean) => {
  const entity = findEntity(graphData as GraphIrDocument, reference);
  if (entity === undefined) {
    setStatus(`Selection is no longer present: ${reference.id}`, "warning");
    return;
  }

  selected = Object.freeze({ ...reference });
  for (const [id, button] of selectionButtons) {
    button.setAttribute("aria-pressed", String(id === selected.id));
  }
  selectionButtons.get(selected.id)?.scrollIntoView({ block: "nearest" });

  inspector.replaceChildren();
  inspector.append(createText("p", isGraphIrEdge(entity) ? "Relation" : "Entity", "eyebrow"));
  inspector.append(createText("h2", isGraphIrEdge(entity) ? entity.kind : entity.label));
  const details = document.createElement("dl");
  addCopyAction(details, "Stable ID", entity.id);
  addField(details, "Kind", entity.kind);
  if (isGraphIrEdge(entity)) {
    addField(details, "Relation class", entity.relationClass);
    addCopyAction(details, "Source", entity.source);
    addCopyAction(details, "Target", entity.target);
  } else {
    addField(details, "Authority", entity.authorityClass);
    if (entity.level !== undefined) addField(details, "Level", entity.level);
    addField(details, "Tags", entity.tags.length === 0 ? "None" : entity.tags.join(" · "));
  }
  addField(details, "Confidence", entity.provenance.confidence.toFixed(2));
  addField(
    details,
    "Extractor",
    `${entity.provenance.extractor.id} ${entity.provenance.extractor.version}`,
  );
  addCopyAction(details, "Source revision", entity.provenance.sourceRevision);
  inspector.append(details, renderEvidence(entity));
  setStatus(`Selected ${reference.kind} ${reference.id}.`);
  if (updateCanvas) view?.setSelection(selected);
};

const clearSelection = () => {
  selected = null;
  view?.setSelection(null);
  for (const button of selectionButtons.values()) button.setAttribute("aria-pressed", "false");
  inspector.replaceChildren(
    createText("p", "Inspector", "eyebrow"),
    createText("h2", "Choose an entity"),
    createText(
      "p",
      "Activate a node or relation from the list or canvas to inspect its complete provenance.",
      "muted",
    ),
  );
};

const addEntityButton = (entity: GraphIrEntity) => {
  const reference = toEntityReference(entity);
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entity-button";
  button.setAttribute("aria-pressed", "false");
  button.append(
    createText("span", isGraphIrEdge(entity) ? entity.kind : entity.label, "entity-label"),
    createText("span", `${reference.kind} · ${entity.id}`, "entity-meta"),
  );
  button.addEventListener("click", () => activateEntity(reference, true));
  item.append(button);
  entityList.append(item);
  selectionButtons.set(entity.id, button);
};

const start = async () => {
  assertGraphIrV1(graphData);
  const graph = graphData as GraphIrDocument;
  setStatus("Calculating the grouped projection in Rust…", "loading");
  const layout = await requestGraphLayout(toLayoutRequest(graph));
  const presentation = toCanvasPresentation(graph, layout);

  graphIdentity.textContent = `${graph.graphId} · ${graph.sourceRevision.slice(0, 16)}…`;
  graphIdentity.title = graph.sourceRevision;
  graphCounts.textContent = `${graph.nodes.length} nodes · ${graph.edges.length} edges`;
  graph.nodes.forEach(addEntityButton);
  graph.edges.forEach(addEntityButton);

  view = createReadOnlyCanvas(graphContainer, presentation.nodes, presentation.edges, {
    onActivate: (reference) => activateEntity(reference, false),
  });
  center.addEventListener("click", () => view?.center());
  reset.addEventListener("click", () => {
    clearSelection();
    view?.center();
    setStatus("Presentation reset; Graph IR was not changed.");
  });
  window.addEventListener("beforeunload", () => view?.dispose(), { once: true });

  clearSelection();
  document.body.dataset.readonly = "true";
  document.body.dataset.state = "ready";
  setStatus(
    `Ready · ${view.nodeCount} nodes · ${view.edgeCount} edges · freshness unknown`,
  );
};

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.dataset.state = "invalid";
  graphContainer.replaceChildren(createText("p", message, "canvas-error"));
  setStatus(message, message.startsWith("Unsupported") ? "unsupported" : "invalid");
});
