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

### `interface architecture-studio.quantization.worker.QuantizationWorkerRequest`

### `property architecture-studio.quantization.worker.QuantizationWorkerRequest.height: number`

### `property architecture-studio.quantization.worker.QuantizationWorkerRequest.levels: number`

### `property architecture-studio.quantization.worker.QuantizationWorkerRequest.scale: number`

### `property architecture-studio.quantization.worker.QuantizationWorkerRequest.seed: number`

### `property architecture-studio.quantization.worker.QuantizationWorkerRequest.type: "generate"`

### `property architecture-studio.quantization.worker.QuantizationWorkerRequest.width: number`

### `type architecture-studio.quantization.worker.QuantizationWorkerResponse = { continuous: Float32Array; height: number; levels: number; quantized: Int32Array; type: "result"; width: number } | { message: string; type: "error" }`

### `type architecture-studio.bench-composition.BenchNodeStatus = "idle" | "evaluated" | "reused" | "waiting" | "failed"`

What the last evaluation pass did with one node.

### `variable architecture-studio.bench-composition.BENCH_CANVAS_VIEWS: Readonly<{ edge: Readonly<{ value: "bench.value" }>; node: Readonly<{ element: "bench.element" }> }>`

View identifiers this surface registers with the canvas.

### `variable architecture-studio.bench-composition.BENCH_ELEMENT_NODE_VIEW: CanvasNodeViewDefinition`

Node view mounting a Grafting UI component as the element's full boundary.

### `variable architecture-studio.bench-composition.BENCH_NODE_SIZE: Readonly<{ height: 96; width: 208 }>`

Rendered size of one element node.

### `function architecture-studio.bench-composition.benchPorts(kind: BenchNodeKind): readonly CanvasPortDefinition[]`

Projects an element's declared ports into canvas ports.

### `function architecture-studio.bench-composition.colorForDataType(dataType: string): string`

Resolves the color a value kind is drawn in.

### `function architecture-studio.bench-composition.describeParams(kind: BenchNodeKind, params: BenchParamValues): readonly string[]`

Renders a node's parameters as short chips.

### `function architecture-studio.bench-composition.presentBenchEdge(context: { edge: CanvasEdge; selected: boolean }): CanvasEdgePresentation`

Draws a connection in the color of the value it carries.

### `function architecture-studio.bench-composition.toCanvasEdge(edge: BenchEdge, graph: BenchGraph): CanvasEdge`

Projects one authored connection into canvas presentation data.

### `function architecture-studio.bench-composition.toCanvasNode(node: BenchNode, status: BenchNodeStatus): CanvasNode`

Projects one authored node into canvas presentation data.

### `interface architecture-studio.bench-graph.BenchEdge`

One value flowing from an output port to an input port.

### `property architecture-studio.bench-graph.BenchEdge.id: string`

Identity unique within the graph.

### `property architecture-studio.bench-graph.BenchEdge.source: { nodeId: string; portId: string }`

Producing node and port.

### `property architecture-studio.bench-graph.BenchEdge.target: { nodeId: string; portId: string }`

Consuming node and port.

### `interface architecture-studio.bench-graph.BenchGraph`

The complete authored graph.

### `property architecture-studio.bench-graph.BenchGraph.edges: readonly BenchEdge[]`

Connections between them.

### `property architecture-studio.bench-graph.BenchGraph.nodes: readonly BenchNode[]`

Placed elements.

### `property architecture-studio.bench-graph.BenchGraph.sequence: number`

Monotonic counter behind generated identities, kept in state so edits stay deterministic.

### `interface architecture-studio.bench-graph.BenchNode`

One placed element instance.

### `property architecture-studio.bench-graph.BenchNode.id: string`

Identity unique within the graph.

### `property architecture-studio.bench-graph.BenchNode.kindId: string`

Registered element this instance is of.

### `property architecture-studio.bench-graph.BenchNode.params: BenchParamValues`

This instance's own parameter values.

### `property architecture-studio.bench-graph.BenchNode.x: number`

Horizontal placement on the surface.

### `property architecture-studio.bench-graph.BenchNode.y: number`

Vertical placement on the surface.

### `type architecture-studio.bench-graph.BenchConnectionRefusal = "unknown-port" | "type-mismatch" | "input-occupied"`

Why the bench refused a connection the canvas already found structurally sound.

### `variable architecture-studio.bench-graph.EMPTY_BENCH_GRAPH: BenchGraph`

An empty bench.

### `function architecture-studio.bench-graph.addBenchEdge(graph: BenchGraph, source: { nodeId: string; portId: string }, target: { nodeId: string; portId: string }): { edge: BenchEdge; graph: BenchGraph; refusal?: undefined } | { edge?: undefined; graph?: undefined; refusal: BenchConnectionRefusal }`

Connects two ports after the product's own rules accept them.

### `function architecture-studio.bench-graph.addBenchNode(graph: BenchGraph, kindId: string, position: { x: number; y: number }): { graph: BenchGraph; nodeId: string }`

Places a new instance of a registered element.

### `function architecture-studio.bench-graph.checkBenchConnection(graph: BenchGraph, source: { nodeId: string; portId: string }, target: { nodeId: string; portId: string }): BenchConnectionRefusal | null`

Applies the product's own connection rules.

The canvas has already checked direction, capacity, self-connection, and
duplicates. What remains is domain knowledge the canvas cannot have: whether
the two value kinds match.

### `function architecture-studio.bench-graph.duplicateBenchNode(graph: BenchGraph, nodeId: string, offset: { x: number; y: number }): { graph: BenchGraph; nodeId: string }`

Copies a placed node, parameter values included, without its connections.

Copying the values is the point: it is how a user compares two settings of
the same element side by side. Connections are deliberately not copied,
since the copy is a variant to wire deliberately, not a silent second
consumer of the original's inputs.

### `function architecture-studio.bench-graph.moveBenchNode(graph: BenchGraph, nodeId: string, position: { x: number; y: number }): BenchGraph`

Records a node's new placement after a user moves it.

### `function architecture-studio.bench-graph.removeBenchEdge(graph: BenchGraph, edgeId: string): BenchGraph`

Removes one connection.

### `function architecture-studio.bench-graph.removeBenchNode(graph: BenchGraph, nodeId: string): { graph: BenchGraph; removedEdgeIds: readonly string[] }`

Removes a node and every connection touching it.

### `function architecture-studio.bench-graph.setBenchParam(graph: BenchGraph, nodeId: string, paramId: string, raw: unknown): BenchGraph`

Changes one parameter of one node instance.

### `interface architecture-studio.evaluation-client.EvaluationOutcome`

What one pass produced.

### `property architecture-studio.evaluation-client.EvaluationOutcome.evaluated: readonly string[]`

Nodes that actually ran.

### `property architecture-studio.evaluation-client.EvaluationOutcome.failures: Readonly<Record<string, string>>`

Node identity to the message explaining why it failed, when one did.

### `property architecture-studio.evaluation-client.EvaluationOutcome.previews: Readonly<Record<string, EvaluationPreview>>`

Requested previews, by node identity.

### `property architecture-studio.evaluation-client.EvaluationOutcome.reused: readonly string[]`

Nodes served from cache without running.

### `interface architecture-studio.evaluation-client.EvaluationPreview`

A node's result, flattened into something the heightfield renderer accepts.

### `property architecture-studio.evaluation-client.EvaluationPreview.dataType: string`

The value kind this preview was flattened from.

### `property architecture-studio.evaluation-client.EvaluationPreview.height: number`

Cells along the vertical axis.

### `property architecture-studio.evaluation-client.EvaluationPreview.values: Float32Array`

Normalized to zero-to-one so any value kind renders on the same scale.

### `property architecture-studio.evaluation-client.EvaluationPreview.width: number`

Cells along the horizontal axis.

### `interface architecture-studio.evaluation-client.EvaluationRequest`

One evaluation pass and the previews the surface wants back.

### `property architecture-studio.evaluation-client.EvaluationRequest.plan: EvaluationPlan`

Executions in dependency order.

### `property architecture-studio.evaluation-client.EvaluationRequest.previewNodeIds: readonly string[]`

Nodes whose results should be returned for rendering.

### `interface architecture-studio.evaluation-client.EvaluationWorkerRequest`

Message sent to the evaluation worker.

### `property architecture-studio.evaluation-client.EvaluationWorkerRequest.id: number`

### `property architecture-studio.evaluation-client.EvaluationWorkerRequest.request: EvaluationRequest`

### `property architecture-studio.evaluation-client.EvaluationWorkerRequest.type: "evaluate"`

### `type architecture-studio.evaluation-client.EvaluationWorkerResponse = { id: number; outcome: EvaluationOutcome; type: "result" } | { id: number; message: string; type: "error" }`

Message returned by the evaluation worker.

### `function architecture-studio.evaluation-client.disposeEvaluation(): void`

Discards the worker and everything it has cached.

Called when the bench unmounts so a long session does not keep whole grids
alive behind a page the user has left.

### `function architecture-studio.evaluation-client.requestEvaluation(request: EvaluationRequest): Promise<EvaluationOutcome>`

Runs one evaluation pass in the long-lived bench worker.

### `interface architecture-studio.evaluation-order-client.EvaluationOrderEdge`

One directed connection described for the ordering request.

### `property architecture-studio.evaluation-order-client.EvaluationOrderEdge.id: string`

Stable connection identity.

### `property architecture-studio.evaluation-order-client.EvaluationOrderEdge.source: string`

Producing node.

### `property architecture-studio.evaluation-order-client.EvaluationOrderEdge.target: string`

Consuming node.

### `interface architecture-studio.evaluation-order-client.EvaluationOrderRequest`

Batched ordering request.

### `property architecture-studio.evaluation-order-client.EvaluationOrderRequest.edges: readonly EvaluationOrderEdge[]`

Every connection between them.

### `property architecture-studio.evaluation-order-client.EvaluationOrderRequest.nodes: readonly string[]`

Every node identity in the graph.

### `interface architecture-studio.evaluation-order-client.EvaluationOrderWorkerRequest`

Message sent to the ordering worker.

### `property architecture-studio.evaluation-order-client.EvaluationOrderWorkerRequest.request: EvaluationOrderRequest`

### `property architecture-studio.evaluation-order-client.EvaluationOrderWorkerRequest.type: "order"`

### `type architecture-studio.evaluation-order-client.EvaluationOrderResult = { order: readonly string[]; outcome: "ordered" } | { blocked: readonly string[]; outcome: "cyclic" }`

Rust's answer.

A cycle is a normal authoring state rather than a failure, so it arrives as
a result the surface can explain by naming the blocked nodes.

### `type architecture-studio.evaluation-order-client.EvaluationOrderWorkerResponse = { result: EvaluationOrderResult; type: "result" } | { message: string; type: "error" }`

Message returned by the ordering worker.

### `function architecture-studio.evaluation-order-client.requestEvaluationOrder(request: EvaluationOrderRequest): Promise<EvaluationOrderResult>`

Runs one Rust-owned evaluation ordering outside the browser UI thread.

### `interface architecture-studio.evaluation-plan.EvaluationPlan`

A complete evaluation pass.

### `property architecture-studio.evaluation-plan.EvaluationPlan.hashes: Readonly<Record<string, string>>`

Node identity to its result hash, for every node that will run.

### `property architecture-studio.evaluation-plan.EvaluationPlan.skipped: readonly SkippedEvaluation[]`

Nodes left out of this pass.

### `property architecture-studio.evaluation-plan.EvaluationPlan.steps: readonly EvaluationStep[]`

Executions in dependency order.

### `interface architecture-studio.evaluation-plan.EvaluationStep`

One node execution, with everything needed to run it and to cache it.

### `property architecture-studio.evaluation-plan.EvaluationStep.hash: string`

Identity of this exact result: same hash means same value.

### `property architecture-studio.evaluation-plan.EvaluationStep.inputs: Readonly<Record<string, string>>`

Input port to the hash of the value feeding it.

### `property architecture-studio.evaluation-plan.EvaluationStep.kindId: string`

Element the node instantiates.

### `property architecture-studio.evaluation-plan.EvaluationStep.nodeId: string`

Node this step evaluates.

### `property architecture-studio.evaluation-plan.EvaluationStep.params: BenchParamValues`

The node instance's parameter values.

### `interface architecture-studio.evaluation-plan.SkippedEvaluation`

A node that cannot run yet, and why.

### `property architecture-studio.evaluation-plan.SkippedEvaluation.missingInputs: readonly string[]`

Input ports with nothing connected, or fed by a node that itself cannot run.

### `property architecture-studio.evaluation-plan.SkippedEvaluation.nodeId: string`

Node that will not run.

### `function architecture-studio.evaluation-plan.buildEvaluationPlan(graph: BenchGraph, order: readonly string[]): EvaluationPlan`

Builds an evaluation pass from an authored graph and a Rust-supplied order.

Nodes whose inputs are not all connected are skipped rather than run with a
missing value, and anything downstream of a skipped node is skipped too — a
partially wired graph is the normal state while a user is still building it.

### `function architecture-studio.evaluation-plan.computeStepHash(kindId: string, params: BenchParamValues, inputHashes: Readonly<Record<string, string>>): string`

Computes the identity of one node's result.

### `function architecture-studio.evaluation-status.resolveNodeStatuses(plan: EvaluationPlan, outcome: EvaluationOutcome | null, cyclicNodeIds: readonly string[]): Readonly<Record<string, BenchNodeStatus>>`

Decides what badge each node wears after one evaluation pass.

Kept apart from the React component so the precedence between overlapping
signals is a testable rule rather than a rendering accident.

### `function architecture-studio.evaluation-status.resolvePreviewTarget(viewportNodeIds: readonly string[], selectedNodeId: string | null): string | null`

Chooses which node's result the 3D panel should show.

A viewport element exists to be watched, so it wins over the selection; that
is what lets a user click around a chain while the render keeps showing the
end of it. Without one, the selected node is previewed, which is how a single
element is inspected in isolation.

### `interface architecture-studio.evaluators.BenchWasm`

The Rust entry points the laboratory elements are built on.

### `method architecture-studio.evaluators.BenchWasm.discretize(values: Float32Array, levels: number): Int32Array`

Collapses continuous values into discrete level indices.

### `method architecture-studio.evaluators.BenchWasm.generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array`

Generates a Perlin heightmap.

### `interface architecture-studio.evaluators.HeightmapValue`

A continuous grid of floating-point heights.

### `property architecture-studio.evaluators.HeightmapValue.dataType: "heightmap"`

### `property architecture-studio.evaluators.HeightmapValue.height: number`

### `property architecture-studio.evaluators.HeightmapValue.values: Float32Array`

### `property architecture-studio.evaluators.HeightmapValue.width: number`

### `interface architecture-studio.evaluators.LevelsValue`

A grid of discrete level indices.

### `property architecture-studio.evaluators.LevelsValue.dataType: "levels"`

### `property architecture-studio.evaluators.LevelsValue.height: number`

### `property architecture-studio.evaluators.LevelsValue.indices: Int32Array`

### `property architecture-studio.evaluators.LevelsValue.levelCount: number`

### `property architecture-studio.evaluators.LevelsValue.width: number`

### `type architecture-studio.evaluators.BenchEvaluator = (inputs: Readonly<Record<string, BenchValue>>, params: BenchParamValues) => BenchValue`

Runs one element.

### `type architecture-studio.evaluators.BenchValue = HeightmapValue | LevelsValue`

Any value that may travel along a connection.

### `function architecture-studio.evaluators.createBenchEvaluators(wasm: BenchWasm): ReadonlyMap<string, BenchEvaluator>`

Builds the evaluator for every registered element.

### `function architecture-studio.evaluators.evaluatorCoverage(evaluators: ReadonlyMap<string, BenchEvaluator>): { withoutEvaluator: readonly string[]; withoutKind: readonly string[] }`

Reports which registered elements have no evaluator, and vice versa.

An element that renders but cannot run, or an evaluator for an element the
menu never offers, are both silent failures; this makes them assertable.

### `interface architecture-studio.node-kind.BenchEnumOption`

One choice offered by an enumerated parameter.

### `property architecture-studio.node-kind.BenchEnumOption.label: string`

Human-readable text shown in the control.

### `property architecture-studio.node-kind.BenchEnumOption.value: string`

Stored value.

### `interface architecture-studio.node-kind.BenchNodeKind`

Complete declaration of one laboratory element.

### `property architecture-studio.node-kind.BenchNodeKind.category: string`

Menu grouping.

### `property architecture-studio.node-kind.BenchNodeKind.description: string`

One sentence explaining what the element does.

### `property architecture-studio.node-kind.BenchNodeKind.id: string`

Stable identity referenced by node instances and by the evaluation engine.

### `property architecture-studio.node-kind.BenchNodeKind.inputs: readonly BenchPortSpec[]`

Values the element consumes.

### `property architecture-studio.node-kind.BenchNodeKind.outputs: readonly BenchPortSpec[]`

Values the element produces.

### `property architecture-studio.node-kind.BenchNodeKind.params: readonly BenchParamSpec[]`

Parameters a user may edit per node instance.

### `property architecture-studio.node-kind.BenchNodeKind.title: string`

Human-readable name shown in the element menu and on the node.

### `interface architecture-studio.node-kind.BenchPortSpec`

One input or output of an element.

### `property architecture-studio.node-kind.BenchPortSpec.capacity?: number`

Maximum number of connections this port accepts.

Inputs default to one, because an element consumes a single value per
input; outputs default to unlimited, because one result may feed many
elements.

### `property architecture-studio.node-kind.BenchPortSpec.dataType: string`

Opaque value kind used to decide whether a connection makes sense.

### `property architecture-studio.node-kind.BenchPortSpec.id: string`

Identity, unique within the element's own inputs or outputs.

### `property architecture-studio.node-kind.BenchPortSpec.label: string`

Human-readable text rendered beside the port.

### `type architecture-studio.node-kind.BenchParamSpec = { defaultValue: number; description?: string; id: string; kind: "number"; label: string; max?: number; min?: number; step?: number } | { defaultValue: number; description?: string; id: string; kind: "integer"; label: string; max?: number; min?: number } | { defaultValue: boolean; description?: string; id: string; kind: "boolean"; label: string } | { defaultValue: string; description?: string; id: string; kind: "enum"; label: string; options: readonly BenchEnumOption[] } | { defaultValue: number; description?: string; id: string; kind: "seed"; label: string }`

Declarative description of one editable parameter.

The bench derives its whole control surface from this, which is what makes
adding an element a registration rather than a UI change.

### `type architecture-studio.node-kind.BenchParamValue = number | boolean | string`

A value a user may edit for one node instance.

### `type architecture-studio.node-kind.BenchParamValues = Readonly<Record<string, BenchParamValue>>`

Parameter values held by one node instance.

### `function architecture-studio.node-kind.coerceParamValue(spec: BenchParamSpec, raw: unknown): BenchParamValue`

Brings a user-supplied value into the range its parameter declares.

Controls can emit values a spec forbids — an empty numeric field, a slider
dragged past a bound, a stale option — so every edit passes through here
before it reaches node state.

### `function architecture-studio.node-kind.defaultParamValues(kind: BenchNodeKind): BenchParamValues`

Builds the starting parameter values for a new node instance.

### `function architecture-studio.node-kind.portCapacity(port: BenchPortSpec, side: "output" | "input"): number | undefined`

Resolves how many connections a port accepts.

### `interface architecture-studio.node-refresh.NodeStatusChange`

One node whose badge on the surface no longer matches the last pass.

### `property architecture-studio.node-refresh.NodeStatusChange.node: BenchNode`

Node to refresh.

### `property architecture-studio.node-refresh.NodeStatusChange.status: BenchNodeStatus`

Badge it should now carry.

### `function architecture-studio.node-refresh.diffNodeStatuses(nodes: readonly BenchNode[], statuses: Readonly<Record<string, BenchNodeStatus>>, rendered: Readonly<Record<string, BenchNodeStatus>>): { changed: readonly NodeStatusChange[]; next: Readonly<Record<string, BenchNodeStatus>> }`

Compares the statuses a pass produced against what the surface last rendered.

The returned record is the complete new baseline, not a patch: it holds an
entry for every current node and none for nodes that have been removed. That
matters because the previous baseline stored only the nodes a pass had
touched, so an untouched node compared `undefined` against `"idle"` forever
and was refreshed on every single render.

### `function architecture-studio.preview.toEvaluationPreview(value: BenchValue): EvaluationPreview`

Projects one element result into something the heightfield renderer accepts.

### `variable architecture-studio.registry.BENCH_DATA_TYPES: Readonly<{ any: "any"; heightmap: "heightmap"; levels: "levels" }>`

Opaque value kinds exchanged between elements.

These are product vocabulary, not canvas concepts — `@grafting/ui` carries
the string through and never reads it.

### `variable architecture-studio.registry.BENCH_NODE_KINDS: readonly BenchNodeKind[]`

Every element the bench offers, in menu order.

### `function architecture-studio.registry.findNodeKind(id: string): BenchNodeKind`

Looks up a registered element.

### `function architecture-studio.registry.nodeKindsByCategory(): readonly { category: string; kinds: readonly BenchNodeKind[] }[]`

Groups the registered elements for the menu.

### `variable architecture-studio.canvas-composition.ARCHITECTURE_CANVAS_COMPOSITION: CanvasOptions`

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

### `function architecture-studio.lab-preview-storage.readPreviewImage(candidate: string): string | undefined`

Reads a previously captured preview image for `candidate`, if any. Safe to call during SSR (returns `undefined`).

### `function architecture-studio.lab-preview-storage.writePreviewImage(candidate: string, dataUrl: string): void`

Persists a captured preview image (a data URL) for `candidate`, so the /lab gallery can show it as a cover.

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
