"use client";

import { useEffect, useRef } from "react";
import {
  createReadOnlyCanvas,
  type CanvasEntityReference,
  type ReadOnlyCanvas,
} from "@grafting/x6-canvas";
import graphData from "../../../../docs/generated/grafting.graph.json";
import { ARCHITECTURE_CANVAS_COMPOSITION } from "../canvas-composition.ts";
import { requestGraphLayout } from "../layout-client.ts";
import {
  assertGraphIrV1,
  findEntity,
  isGraphIrEdge,
  toCanvasPresentation,
  toEntityReference,
  toLayoutRequest,
  type GraphIrDocument,
  type GraphIrEntity,
} from "../presentation.ts";

const createText = (tag: keyof HTMLElementTagNameMap, text: string, className?: string) => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className !== undefined) element.className = className;
  return element;
};

/**
 * Ports the app's previous plain-DOM `main.ts` entry point into a client
 * component. The imperative DOM-manipulation functions below are unchanged
 * from that port; only the element lookup (refs instead of
 * `document.querySelector`) and the mount point (a React effect instead of a
 * top-level script) differ, to keep this migration behavior-identical.
 */
export default function ExplorerClient() {
  const graphContainerRef = useRef<HTMLElement>(null);
  const entityListRef = useRef<HTMLUListElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const graphIdentityRef = useRef<HTMLSpanElement>(null);
  const graphCountsRef = useRef<HTMLSpanElement>(null);
  const centerRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const graphContainer = graphContainerRef.current;
    const entityList = entityListRef.current;
    const inspector = inspectorRef.current;
    const status = statusRef.current;
    const graphIdentity = graphIdentityRef.current;
    const graphCounts = graphCountsRef.current;
    const center = centerRef.current;
    const reset = resetRef.current;
    if (
      graphContainer === null ||
      entityList === null ||
      inspector === null ||
      status === null ||
      graphIdentity === null ||
      graphCounts === null ||
      center === null ||
      reset === null
    ) {
      throw new Error("Architecture Studio shell is missing a required element");
    }

    const selectionButtons = new Map<string, HTMLButtonElement>();
    let view: ReadOnlyCanvas | undefined;
    let selected: CanvasEntityReference | null = null;

    const setStatus = (message: string, state = "ready") => {
      status.textContent = message;
      status.dataset.status = state;
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
        ...ARCHITECTURE_CANVAS_COMPOSITION,
        onActivate: (reference) => activateEntity(reference, false),
      });
      center.addEventListener("click", () => view?.center());
      reset.addEventListener("click", () => {
        clearSelection();
        view?.center();
        setStatus("Presentation reset; Graph IR was not changed.");
      });

      clearSelection();
      document.body.dataset.readonly = "true";
      document.body.dataset.state = "ready";
      setStatus(`Ready · ${view.nodeCount} nodes · ${view.edgeCount} edges · freshness unknown`);
    };

    void start().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      document.body.dataset.state = "invalid";
      graphContainer.replaceChildren(createText("p", message, "canvas-error"));
      setStatus(message, message.startsWith("Unsupported") ? "unsupported" : "invalid");
    });

    return () => {
      view?.dispose();
    };
  }, []);

  return (
    <div className="explorer-shell">
      <header className="topbar">
        <div className="identity">
          <strong>Grafting Architecture Studio</strong>
          <span ref={graphIdentityRef}>Loading Graph IR v1…</span>
        </div>
        <div className="toolbar">
          <span>Drag: pan | Click: inspect | Ctrl/Cmd + wheel: zoom</span>
          <span ref={graphCountsRef}>Loading…</span>
          <span className="freshness" title="Runtime freshness evidence is not available yet">
            Unknown freshness
          </span>
          <button ref={centerRef} type="button">
            Center
          </button>
          <button ref={resetRef} type="button">
            Reset view
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="explorer" aria-labelledby="explorer-title">
          <p className="eyebrow">Explorer</p>
          <h1 id="explorer-title">Repository entities</h1>
          <p className="muted">Keyboard-accessible Graph IR v1 nodes and relations.</p>
          <ul ref={entityListRef} className="entity-list" />
        </aside>
        <main
          ref={graphContainerRef}
          id="graph"
          data-testid="graph"
          aria-label="Read-only repository graph canvas"
        />
        <aside className="inspector" aria-label="Selected entity inspector">
          <div ref={inspectorRef} id="inspector-content">
            <p className="eyebrow">Inspector</p>
            <h2>Loading…</h2>
          </div>
        </aside>
      </div>
      <footer ref={statusRef} id="status" data-testid="status" role="status" aria-live="polite">
        Loading Graph IR v1…
      </footer>
    </div>
  );
}
