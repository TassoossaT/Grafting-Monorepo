# architecture-studio

### `variable architecture-studio.route.runtime: "nodejs"`

### `function architecture-studio.route.DELETE(request: Request): Promise<Response>`

### `reference architecture-studio.route.GET`

### `reference architecture-studio.route.POST`

### `function architecture-studio.server.createMcpServer(): McpServer`

Minimal, real MCP server validating raw `@modelcontextprotocol/sdk` end to
end, per ADR-0016's license-risk policy (validate the raw SDK before
picking Mastra/VoltAgent). One tool, `list_architecture_entities`, queries
the same already-public, read-only Graph IR v1 artifact the explorer
surface renders -- no write/execute authority over any canonical source
is granted here.

### `interface architecture-studio.generation.worker.HeightmapWorkerRequest`

### `property architecture-studio.generation.worker.HeightmapWorkerRequest.height: number`

### `property architecture-studio.generation.worker.HeightmapWorkerRequest.scale: number`

### `property architecture-studio.generation.worker.HeightmapWorkerRequest.seed: number`

### `property architecture-studio.generation.worker.HeightmapWorkerRequest.type: "generate"`

### `property architecture-studio.generation.worker.HeightmapWorkerRequest.width: number`

### `type architecture-studio.generation.worker.HeightmapWorkerResponse = { height: number; type: "result"; values: Float32Array; width: number } | { message: string; type: "error" }`

### `variable architecture-studio.canvas-composition.ARCHITECTURE_CANVAS_COMPOSITION: ReadOnlyCanvasOptions`

Complete product-owned composition consumed by the generic canvas package.

### `function architecture-studio.canvas-composition.presentArchitectureEdge(context: CanvasEdgeRenderContext): CanvasEdgePresentation`

Product-owned edge projection, including curves, arrows, labels, and selection effects.

### `interface architecture-studio.canvas-views.ArchitectureEdgeViewData`

Product-owned data consumed by the Architecture Studio edge presenter.

### `property architecture-studio.canvas-views.ArchitectureEdgeViewData.label?: string`

### `property architecture-studio.canvas-views.ArchitectureEdgeViewData.treatment: ArchitectureEdgeTreatment`

### `interface architecture-studio.canvas-views.ArchitectureNodeViewData`

Product-owned data consumed by the Architecture Studio node component.

### `property architecture-studio.canvas-views.ArchitectureNodeViewData.description: string`

### `property architecture-studio.canvas-views.ArchitectureNodeViewData.tags: readonly string[]`

### `property architecture-studio.canvas-views.ArchitectureNodeViewData.title: string`

### `property architecture-studio.canvas-views.ArchitectureNodeViewData.treatment: ArchitectureNodeTreatment`

### `type architecture-studio.canvas-views.ArchitectureEdgeTreatment = "hierarchy" | "dependency" | "reference"`

Product-owned visual treatments derived from Graph IR relation kinds.

### `type architecture-studio.canvas-views.ArchitectureNodeTreatment = "project" | "target" | "other"`

Product-owned visual treatments derived from Graph IR node kinds.

### `variable architecture-studio.canvas-views.ARCHITECTURE_CANVAS_VIEWS: Readonly<{ edge: Readonly<{ relation: "architecture.relation" }>; node: Readonly<{ entitySummary: "architecture.entity-summary" }> }>`

Stable application-owned identifiers for canvas composition.

### `variable architecture-studio.canvas-views.ARCHITECTURE_NODE_SIZE: Readonly<{ height: 84; width: 288 }>`

One authored node size shared with the Rust layout request and node view.

### `function architecture-studio.canvas-views.readArchitectureEdgeViewData(value: unknown): ArchitectureEdgeViewData`

Narrows opaque edge data at the application composition boundary.

### `function architecture-studio.canvas-views.readArchitectureNodeViewData(value: unknown): ArchitectureNodeViewData`

Narrows opaque canvas data at the application composition boundary.

### `interface architecture-studio.layout-client.GraphLayoutEdge`

### `property architecture-studio.layout-client.GraphLayoutEdge.id: string`

### `property architecture-studio.layout-client.GraphLayoutEdge.source: string`

### `property architecture-studio.layout-client.GraphLayoutEdge.target: string`

### `interface architecture-studio.layout-client.GraphLayoutOptions`

### `property architecture-studio.layout-client.GraphLayoutOptions.groupColumns: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.groupGap: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.horizontalGap: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.memberColumns: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.nodeHeight: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.nodeWidth: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.padding: number`

### `property architecture-studio.layout-client.GraphLayoutOptions.verticalGap: number`

### `interface architecture-studio.layout-client.GraphLayoutPosition`

### `property architecture-studio.layout-client.GraphLayoutPosition.id: string`

### `property architecture-studio.layout-client.GraphLayoutPosition.x: number`

### `property architecture-studio.layout-client.GraphLayoutPosition.y: number`

### `interface architecture-studio.layout-client.GraphLayoutRequest`

### `property architecture-studio.layout-client.GraphLayoutRequest.edges: readonly GraphLayoutEdge[]`

### `property architecture-studio.layout-client.GraphLayoutRequest.groupingEdgeIds: readonly string[]`

### `property architecture-studio.layout-client.GraphLayoutRequest.nodes: readonly string[]`

### `property architecture-studio.layout-client.GraphLayoutRequest.options: GraphLayoutOptions`

### `interface architecture-studio.layout-client.GraphLayoutSnapshot`

### `property architecture-studio.layout-client.GraphLayoutSnapshot.height: number`

### `property architecture-studio.layout-client.GraphLayoutSnapshot.positions: readonly GraphLayoutPosition[]`

### `property architecture-studio.layout-client.GraphLayoutSnapshot.width: number`

### `interface architecture-studio.layout-client.GraphLayoutWorkerRequest`

### `property architecture-studio.layout-client.GraphLayoutWorkerRequest.request: GraphLayoutRequest`

### `property architecture-studio.layout-client.GraphLayoutWorkerRequest.type: "layout"`

### `type architecture-studio.layout-client.GraphLayoutWorkerResponse = { snapshot: GraphLayoutSnapshot; type: "result" } | { message: string; type: "error" }`

### `function architecture-studio.layout-client.requestGraphLayout(request: GraphLayoutRequest): Promise<GraphLayoutSnapshot>`

Runs one Rust-owned graph layout operation outside the browser UI thread.

### `interface architecture-studio.presentation.GraphIrDocument`

### `property architecture-studio.presentation.GraphIrDocument.edges: readonly GraphIrEdge[]`

### `property architecture-studio.presentation.GraphIrDocument.generator: { id: string; inputHash: string; version: string }`

### `property architecture-studio.presentation.GraphIrDocument.graphId: string`

### `property architecture-studio.presentation.GraphIrDocument.nodes: readonly GraphIrNode[]`

### `property architecture-studio.presentation.GraphIrDocument.schemaVersion: "1.0.0"`

### `property architecture-studio.presentation.GraphIrDocument.sourceRevision: string`

### `interface architecture-studio.presentation.GraphIrEdge`

### `property architecture-studio.presentation.GraphIrEdge.id: string`

### `property architecture-studio.presentation.GraphIrEdge.kind: string`

### `property architecture-studio.presentation.GraphIrEdge.provenance: GraphIrProvenance`

### `property architecture-studio.presentation.GraphIrEdge.relationClass: string`

### `property architecture-studio.presentation.GraphIrEdge.source: string`

### `property architecture-studio.presentation.GraphIrEdge.target: string`

### `interface architecture-studio.presentation.GraphIrEvidence`

### `property architecture-studio.presentation.GraphIrEvidence.kind: string`

### `property architecture-studio.presentation.GraphIrEvidence.path: string`

### `property architecture-studio.presentation.GraphIrEvidence.pointer?: string`

### `property architecture-studio.presentation.GraphIrEvidence.sha256: string`

### `property architecture-studio.presentation.GraphIrEvidence.symbol?: string`

### `interface architecture-studio.presentation.GraphIrNode`

### `property architecture-studio.presentation.GraphIrNode.authorityClass: string`

### `property architecture-studio.presentation.GraphIrNode.id: string`

### `property architecture-studio.presentation.GraphIrNode.kind: string`

### `property architecture-studio.presentation.GraphIrNode.label: string`

### `property architecture-studio.presentation.GraphIrNode.level?: string`

### `property architecture-studio.presentation.GraphIrNode.provenance: GraphIrProvenance`

### `property architecture-studio.presentation.GraphIrNode.tags: readonly string[]`

### `interface architecture-studio.presentation.GraphIrProvenance`

### `property architecture-studio.presentation.GraphIrProvenance.confidence: number`

### `property architecture-studio.presentation.GraphIrProvenance.evidence: readonly GraphIrEvidence[]`

### `property architecture-studio.presentation.GraphIrProvenance.extractor: { id: string; version: string }`

### `property architecture-studio.presentation.GraphIrProvenance.sourceRevision: string`

### `interface architecture-studio.presentation.GraphPresentation`

### `property architecture-studio.presentation.GraphPresentation.edges: readonly CanvasEdge[]`

### `property architecture-studio.presentation.GraphPresentation.nodes: readonly CanvasNode[]`

### `type architecture-studio.presentation.GraphIrEntity = GraphIrNode | GraphIrEdge`

### `variable architecture-studio.presentation.PROJECTION: Readonly<{ groupingEdgeKinds: readonly string[]; layout: Readonly<{ groupColumns: 3; groupGap: 120; horizontalGap: 32; memberColumns: 2; nodeHeight: 84; nodeWidth: 288; padding: 72; verticalGap: 28 }>; node: Readonly<{ height: 84; width: 288 }> }>`

Single authored configuration for the Rust-owned layout projection.

### `function architecture-studio.presentation.assertGraphIrV1(value: unknown): asserts value is GraphIrDocument`

### `function architecture-studio.presentation.findEntity(graph: GraphIrDocument, reference: CanvasEntityReference): GraphIrEntity | undefined`

### `function architecture-studio.presentation.isGraphIrEdge(entity: GraphIrEntity): entity is GraphIrEdge`

### `function architecture-studio.presentation.toCanvasPresentation(graph: GraphIrDocument, layout: GraphLayoutSnapshot): GraphPresentation`

### `function architecture-studio.presentation.toEntityReference(entity: GraphIrEntity): CanvasEntityReference`

### `function architecture-studio.presentation.toLayoutRequest(graph: GraphIrDocument): GraphLayoutRequest`

### `interface architecture-studio.research-registry.RegistryRow`

### `property architecture-studio.research-registry.RegistryRow.candidate: string`

### `property architecture-studio.research-registry.RegistryRow.license: string`

### `property architecture-studio.research-registry.RegistryRow.note: string`

### `property architecture-studio.research-registry.RegistryRow.statusId: StatusId`

### `property architecture-studio.research-registry.RegistryRow.statusLabel: string`

### `property architecture-studio.research-registry.RegistryRow.statusQualifier: string | null`

Free-text qualifier after the matched status, e.g. "top pick" -- null when the cell was an exact status match.

### `interface architecture-studio.research-registry.RegistrySection`

### `property architecture-studio.research-registry.RegistrySection.rows: readonly RegistryRow[]`

### `property architecture-studio.research-registry.RegistrySection.sourceDoc: string | null`

Repository-relative path to the research document this section summarizes, when the registry names one.

### `property architecture-studio.research-registry.RegistrySection.title: string`

### `type architecture-studio.research-registry.StatusId = "adopted" | "decided" | "in-development" | "in-review" | "standby" | "discarded" | "reference-only"`

Canonical status vocabulary, matching the registry's own "Status legend" section.

### `variable architecture-studio.research-registry.STATUS_DEFINITIONS: readonly StatusDefinition[]`

### `function architecture-studio.research-registry.parseResearchRegistry(markdown: string): readonly RegistrySection[]`

Parses the registry's Markdown into topic sections, skipping any `##` section with no table (e.g. the legend itself).

### `interface architecture-studio.research-registry-ui.LocatedRow`

### `property architecture-studio.research-registry-ui.LocatedRow.row: RegistryRow`

### `property architecture-studio.research-registry-ui.LocatedRow.sectionTitle: string`

### `variable architecture-studio.research-registry-ui.DEMO_LINKS: Readonly<Record<string, string>>`

Candidate name -> a live, interactive trial of it under /lab.
Deliberately a small hard-coded map, not something inferred from the
registry itself -- only one candidate has a real trial today.

### `variable architecture-studio.research-registry-ui.SEMANTIC_STATUS: Readonly<Record<StatusId, UiStatus>>`

### `function architecture-studio.research-registry-ui.findRowByCandidate(sections: readonly RegistrySection[], candidate: string): LocatedRow | undefined`

Finds a candidate's row (and which topic section it lives in) across every section.

### `function architecture-studio.research-registry-ui.inProgressRows(sections: readonly RegistrySection[]): readonly LocatedRow[]`

Every row across every section whose status is "in-development" or "in-review".

### `function architecture-studio.research-registry-ui.statusLabelFor(row: RegistryRow): string`
