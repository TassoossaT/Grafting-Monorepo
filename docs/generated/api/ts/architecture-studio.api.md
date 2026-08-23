# architecture-studio

### `variable architecture-studio.route.runtime: "nodejs"`

### `function architecture-studio.route.DELETE(request: Request): Promise<Response>`

### `reference architecture-studio.route.GET -> architecture-studio.route.DELETE`

### `reference architecture-studio.route.POST -> architecture-studio.route.DELETE`

### `function architecture-studio.server.createMcpServer(): McpServer`

Minimal, real MCP server validating raw `@modelcontextprotocol/sdk` end to
end, per ADR-0016's license-risk policy (validate the raw SDK before
picking Mastra/VoltAgent). One tool, `list_architecture_entities`, queries
the same already-public, read-only Graph IR v1 artifact the explorer
surface renders -- no write/execute authority over any canonical source
is granted here.

### `interface architecture-studio.bench-composition.BenchNodeExtras`

Extra data a node view needs beyond the element's own declaration.

### `property architecture-studio.bench-composition.BenchNodeExtras.drivenParams?: readonly string[]`

Parameter ports currently fed by a connection, whose typed value is overridden.

### `property architecture-studio.bench-composition.BenchNodeExtras.onParamChange?: (paramId: string, raw: BenchParamValue) => void`

Receives an edited value, for a node whose view is itself a control.

### `property architecture-studio.bench-composition.BenchNodeExtras.preview?: EvaluationPreview | null`

Result to render, for a node whose view draws one.

### `property architecture-studio.bench-composition.BenchNodeExtras.status?: BenchNodeStatus`

What the last evaluation pass did with the node.

### `type architecture-studio.bench-composition.BenchNodeStatus = "idle" | "evaluated" | "reused" | "waiting" | "failed"`

What the last evaluation pass did with one node.

### `variable architecture-studio.bench-composition.BENCH_CANVAS_VIEWS: Readonly<{ edge: Readonly<{ value: "bench.value" }>; node: Readonly<{ control: "bench.control"; element: "bench.element"; viewport: "bench.viewport" }> }>`

View identifiers this surface registers with the canvas.

### `variable architecture-studio.bench-composition.BENCH_CONTROL_NODE_VIEW: CanvasNodeViewDefinition`

Node view that is itself a control.

The element's own parameter is edited on the node, so a value can be dialled
where it is wired rather than only in a side panel. Pointer events are kept
from bubbling, or grabbing a slider would drag the node instead.

### `variable architecture-studio.bench-composition.BENCH_ELEMENT_NODE_VIEW: CanvasNodeViewDefinition`

Node view mounting a Grafting UI component as the element's full boundary.

### `variable architecture-studio.bench-composition.BENCH_NODE_SIZE: Readonly<{ height: 96; width: 208 }>`

Rendered size of one element node.

### `variable architecture-studio.bench-composition.BENCH_VIEWPORT_NODE_VIEW: CanvasNodeViewDefinition`

Node view that renders its own input.

A viewport exists to be looked at, so it draws the value that reaches it
rather than describing it. Without this, seeing what a filter did meant
reading a panel somewhere else, which is why a filter could look like it was
doing nothing at all.

### `function architecture-studio.bench-composition.benchNodeSize(kind: BenchNodeKind, exposedParams: readonly string[]): { height: number; width: number }`

Sizes a node so every port has room.

Ports are spread evenly down a side, so a node with many ports needs more
height or they collide. The width is fixed: it is the label column that has
to stay readable, not the port column.

Sized from the ports actually shown, not from every parameter the element
declares. Sizing by the latter would make an element with a dozen settings
permanently tall even while none of them are wired, which is most of what
made those elements unusable in the first place.

### `function architecture-studio.bench-composition.benchPorts(kind: BenchNodeKind, exposedParams: readonly string[]): readonly CanvasPortDefinition[]`

Projects an element's declared ports into canvas ports.

### `function architecture-studio.bench-composition.colorForDataType(dataType: string): string`

Resolves the color a value kind is drawn in.

### `function architecture-studio.bench-composition.describeParams(kind: BenchNodeKind, params: BenchParamValues, drivenParams: readonly string[]): readonly string[]`

Renders a node's parameters as short chips.

### `function architecture-studio.bench-composition.presentBenchEdge(context: { edge: CanvasEdge; selected: boolean }): CanvasEdgePresentation`

Draws a connection in the color of the value it carries.

### `function architecture-studio.bench-composition.toCanvasEdge(edge: BenchEdge, graph: BenchGraph): CanvasEdge`

Projects one authored connection into canvas presentation data.

### `function architecture-studio.bench-composition.toCanvasNode(node: BenchNode, extras: BenchNodeExtras): CanvasNode`

### `function architecture-studio.bench-composition.viewForKind(kind: BenchNodeKind): string`

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

### `property architecture-studio.bench-graph.BenchNode.exposedParams: readonly string[]`

Parameters this instance has promoted to input ports.

Empty for a freshly placed node: a parameter is edited in the panel until
someone decides it should be driven by another element instead.

### `property architecture-studio.bench-graph.BenchNode.height?: number`

Rendered height, when the instance overrides its element's default.

### `property architecture-studio.bench-graph.BenchNode.id: string`

Identity unique within the graph.

### `property architecture-studio.bench-graph.BenchNode.kindId: string`

Registered element this instance is of.

### `property architecture-studio.bench-graph.BenchNode.params: BenchParamValues`

This instance's own parameter values.

### `property architecture-studio.bench-graph.BenchNode.width?: number`

Rendered width, when the instance overrides its element's default.

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

### `function architecture-studio.bench-graph.benchEvaluationKey(graph: BenchGraph): string`

Summarises everything about a graph that can change what it computes.

Position and size are deliberately absent: moving or resizing a node cannot
alter a single value, yet a drag commits a new graph on every pointer move.
Keying evaluation on this instead of on the graph keeps a drag from
scheduling a pass — and from redrawing every viewport — for nothing.

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

### `function architecture-studio.bench-graph.resizeBenchNode(graph: BenchGraph, nodeId: string, size: { height: number; width: number }): BenchGraph`

Resizes one node.

A node that draws something — a viewport above all — is unreadable at the
size that suits a node that only shows a title, so size belongs to the
instance rather than to the element.

### `function architecture-studio.bench-graph.setBenchParam(graph: BenchGraph, nodeId: string, paramId: string, raw: unknown): BenchGraph`

Changes one parameter of one node instance.

### `function architecture-studio.bench-graph.setParamExposed(graph: BenchGraph, nodeId: string, paramId: string, exposed: boolean): { graph: BenchGraph; removedEdges: readonly BenchEdge[] }`

Promotes a parameter to an input port, or withdraws it.

Withdrawing removes any connection feeding that port, and returns them, so
the caller can say what was disconnected. Leaving the edge in place would be
worse than either alternative: it would keep driving a parameter through a
port nobody can see, and the panel would show a value the graph ignores.

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

### `interface architecture-studio.evaluators.MeshValue`

Renderable geometry, ready for a viewport.

### `property architecture-studio.evaluators.MeshValue.dataType: "mesh"`

### `property architecture-studio.evaluators.MeshValue.indices: Uint32Array`

Triangles indexing them.

### `property architecture-studio.evaluators.MeshValue.positions: Float32Array`

Flat `xyz` triples.

### `interface architecture-studio.evaluators.NumberValue`

A single scalar travelling from a control into a parameter.

### `property architecture-studio.evaluators.NumberValue.dataType: "number"`

### `property architecture-studio.evaluators.NumberValue.value: number`

### `interface architecture-studio.evaluators.QuadMeshValue`

An irregular quad grid.

Carried whole rather than rasterised: the grid's value is precisely that it
is not on a lattice, and a raster would throw away the adjacency every later
stage is built on.

### `property architecture-studio.evaluators.QuadMeshValue.dataType: "quadmesh"`

### `property architecture-studio.evaluators.QuadMeshValue.mesh: QuadMesh`

### `type architecture-studio.evaluators.BenchEvaluator = (inputs: Readonly<Record<string, BenchValue>>, params: BenchParamValues) => BenchValue`

Runs one element.

### `type architecture-studio.evaluators.BenchValue = HeightmapValue | LevelsValue | MeshValue | NumberValue | QuadMeshValue`

Any value that may travel along a connection.

### `function architecture-studio.evaluators.createBenchEvaluators(wasm: BenchWasm): ReadonlyMap<string, BenchEvaluator>`

Builds the evaluator for every registered element.

### `function architecture-studio.evaluators.evaluatorCoverage(evaluators: ReadonlyMap<string, BenchEvaluator>): { withoutEvaluator: readonly string[]; withoutKind: readonly string[] }`

Reports which registered elements have no evaluator, and vice versa.

An element that renders but cannot run, or an evaluator for an element the
menu never offers, are both silent failures; this makes them assertable.

### `function architecture-studio.evaluators.mergeParamInputs(params: BenchParamValues, inputs: Readonly<Record<string, BenchValue>>): BenchParamValues`

Applies values that arrived over parameter ports on top of a node's own.

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

### `function architecture-studio.node-kind.allInputPorts(kind: BenchNodeKind): readonly BenchPortSpec[]`

Every input an element accepts, including one port per parameter.

Exposing parameters as ports is what lets one element drive another's
settings — a control feeding a radius, or a generator's own width feeding a
downstream element — instead of every value being typed in by hand.

### `function architecture-studio.node-kind.coerceParamValue(spec: BenchParamSpec, raw: unknown): BenchParamValue`

Brings a user-supplied value into the range its parameter declares.

Controls can emit values a spec forbids — an empty numeric field, a slider
dragged past a bound, a stale option — so every edit passes through here
before it reaches node state.

### `function architecture-studio.node-kind.defaultParamValues(kind: BenchNodeKind): BenchParamValues`

Builds the starting parameter values for a new node instance.

### `function architecture-studio.node-kind.paramIdFromPort(portId: string): string | null`

Reads the parameter a port drives.

### `function architecture-studio.node-kind.paramPortId(paramId: string): string`

Port identity that drives a parameter from a connection.

Namespaced so a parameter can never collide with a value port declared by
the element itself.

### `function architecture-studio.node-kind.portCapacity(port: BenchPortSpec, side: "output" | "input"): number | undefined`

Resolves how many connections a port accepts.

### `function architecture-studio.node-kind.visibleInputPorts(kind: BenchNodeKind, exposed: readonly string[]): readonly BenchPortSpec[]`

The inputs a node instance actually shows.

Every parameter *can* be driven by a connection, but showing all of them at
once is what makes a node with a dozen settings unreadable: the ports that
carry the element's real work get lost among a column of settings nobody
is wiring. So an element's declared inputs are always visible -- they are
how it is used at all -- and a parameter port appears only once someone asks
for it.

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

### `interface architecture-studio.preview.GeometryPreview`

Triangles in world space.

### `property architecture-studio.preview.GeometryPreview.dataType: string`

The value kind this was projected from.

### `property architecture-studio.preview.GeometryPreview.form: "geometry"`

### `property architecture-studio.preview.GeometryPreview.indices: Uint32Array`

Triangles indexing them.

### `property architecture-studio.preview.GeometryPreview.positions: Float32Array`

Flat `xyz` triples.

### `interface architecture-studio.preview.PreviewKind`

One value kind's declaration of how it is shown.

### `property architecture-studio.preview.PreviewKind.dataType: string`

The value kind this projects.

### `method architecture-studio.preview.PreviewKind.project(value: BenchValue): EvaluationPreview | null`

Reduces a value to something drawable, or `null` when it has nothing to
show. Returning `null` is a real answer -- a single scalar has no picture,
and inventing one would be worse than an empty frame.

### `interface architecture-studio.preview.RasterPreview`

A grid of samples normalized to zero-to-one.

### `property architecture-studio.preview.RasterPreview.dataType: string`

The value kind this was projected from.

### `property architecture-studio.preview.RasterPreview.form: "raster"`

### `property architecture-studio.preview.RasterPreview.height: number`

### `property architecture-studio.preview.RasterPreview.values: Float32Array`

### `property architecture-studio.preview.RasterPreview.width: number`

### `type architecture-studio.preview.EvaluationPreview = RasterPreview | GeometryPreview`

Anything the viewport can be handed.

### `type architecture-studio.preview.PreviewForm = "raster" | "geometry"`

A preview form is what a renderer knows how to draw.

Deliberately coarser than the value kinds: `mesh` and `quadmesh` are
different values that both project to geometry, and one renderer serves
both. A form is added only when something genuinely cannot be drawn by an
existing one.

### `variable architecture-studio.preview.PREVIEW_KINDS: readonly PreviewKind[]`

Every value kind's preview declaration.

Normalizing a raster per value is deliberate: it makes the *shape* of two
results comparable even when their ranges differ, which is what a user is
looking at when they add or bypass a filter.

### `function architecture-studio.preview.previewTransferables(preview: EvaluationPreview): Transferable[]`

The buffers a preview owns, so the worker can hand them over instead of
copying them.

Kept beside the forms rather than in the worker: a new form that forgot to
list its buffers would silently start copying whole grids per frame, which
is exactly the kind of regression nobody notices until it is slow.

### `function architecture-studio.preview.toEvaluationPreview(value: BenchValue): EvaluationPreview | null`

Projects one element result into something a viewport can draw.

### `variable architecture-studio.registry.BENCH_DATA_TYPES: Readonly<{ any: "any"; heightmap: "heightmap"; levels: "levels"; mesh: "mesh"; number: "number"; quadmesh: "quadmesh" }>`

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

### `interface architecture-studio.cell-occupancy.Cell`

A cell of the stacked grid: a quad, and how many layers up.

### `property architecture-studio.cell-occupancy.Cell.layer: number`

### `property architecture-studio.cell-occupancy.Cell.quad: number`

### `interface architecture-studio.cell-occupancy.Occupancy`

The occupied cells, as a layer set per quad.

Quad-major because cell numbering is, so a graph built from an occupancy
numbers its cells the same way twice running -- which is what lets a seed
reproduce a map.

### `property architecture-studio.cell-occupancy.Occupancy.layerCount: number`

One layer above the highest occupied cell; `0` when nothing is occupied.

### `property architecture-studio.cell-occupancy.Occupancy.quadCount: number`

How many quads the mesh this describes has.

### `property architecture-studio.cell-occupancy.Occupancy.size: number`

How many cells are occupied.

### `method architecture-studio.cell-occupancy.Occupancy.cells(): Iterable<Cell>`

Every occupied cell, quad-major and layer-ascending.

### `method architecture-studio.cell-occupancy.Occupancy.has(quad: number, layer: number): boolean`

Whether `(quad, layer)` holds something. Out-of-range is simply `false`.

### `method architecture-studio.cell-occupancy.Occupancy.layersOf(quad: number): readonly number[]`

The occupied layers of `quad`, ascending.

### `function architecture-studio.cell-occupancy.occupancyFromHeights(heights: readonly number[]): Occupancy`

The occupancy a height per quad describes: solid from the ground up.

This is how the elevation pass still feeds the pipeline. It is a *seed*, not
a definition -- once built, an occupancy is edited cell by cell and stops
being expressible as heights the moment anything overhangs.

### `function architecture-studio.cell-occupancy.occupancyOf(layersPerQuad: readonly (readonly number[])[]): Occupancy`

Builds an occupancy from an explicit layer set per quad.

### `function architecture-studio.cell-occupancy.runBelow(occupancy: Occupancy, quad: number, layer: number): number`

How many occupied cells sit directly below `(quad, layer)` without a gap.

What a renderer needs to know to close a cell's sides: the skirt has to reach
the top of whatever is under it, which for ordinary ground is the floor and
for an overhang is nothing at all.

### `function architecture-studio.cell-occupancy.withCell(occupancy: Occupancy, quad: number, layer: number): Occupancy`

The same occupancy with `(quad, layer)` occupied. The click that builds.

### `function architecture-studio.cell-occupancy.withoutCell(occupancy: Occupancy, quad: number, layer: number): Occupancy`

The same occupancy with `(quad, layer)` cleared. The click that digs.

### `interface architecture-studio.grid-adjacency.CompassAssignment`

The outcome of trying to label slots as four global compass directions.

### `property architecture-studio.grid-adjacency.CompassAssignment.contradictions: number`

Shared edges no rotation can satisfy. Zero means the labelling exists.

### `property architecture-studio.grid-adjacency.CompassAssignment.turns: readonly number[]`

Per quad, the rotation taking its local slots to global directions.

### `interface architecture-studio.grid-adjacency.SlotLink`

One side of a quad: which of its four edge slots, and who is across it.

### `property architecture-studio.grid-adjacency.SlotLink.neighbour: number`

### `property architecture-studio.grid-adjacency.SlotLink.theirSlot: number`

### `type architecture-studio.grid-adjacency.QuadAdjacency = readonly (readonly (SlotLink | null)[])[]`

Per quad, the four edge slots in cyclic order; `null` where the grid ends.

### `variable architecture-studio.grid-adjacency.LATERAL_DIRECTION_COUNT: 16`

How many lateral directions the slot-pair encoding uses.

### `function architecture-studio.grid-adjacency.compassAssignment(mesh: QuadMesh): CompassAssignment`

Attempts the *obvious* encoding: four global directions, `opposite(d)` being
`(d + 2) % 4`, each quad free to rotate its slot labels.

With winding normalised, rotation is the only freedom left -- a reflection
would reverse the winding -- so this search is complete, and a non-zero
`contradictions` proves no such labelling exists rather than merely that
this routine failed to find one. The obstruction is vertices of valence
other than four, which an irregular grid has by construction.

### `function architecture-studio.grid-adjacency.normaliseWinding(mesh: QuadMesh): QuadMesh`

Rewinds clockwise quads so every quad lists its corners counter-clockwise.

Slot arithmetic below is only meaningful if "slot + 1" turns the same way
everywhere, so this is a precondition of the analysis, not tidiness.

### `function architecture-studio.grid-adjacency.opposabilityViolations(table: readonly (readonly (number | null)[])[]): number`

Counts places where the solver's opposite-direction invariant is broken.

### `function architecture-studio.grid-adjacency.oppositeSlotPair(direction: number): number`

Reverses a slot-pair direction, which is exactly swapping the two slots.

### `function architecture-studio.grid-adjacency.quadAdjacency(mesh: QuadMesh): QuadAdjacency`

Builds the dual adjacency: for each quad and each of its four edge slots,
the quad across that edge and the slot it occupies over there.

Edges used by more than two quads are dropped rather than guessed at; the
grid builder is not expected to produce them, and silently picking two of
three would corrupt the solver's neighbour table.

### `function architecture-studio.grid-adjacency.slotPairDirection(mine: number, theirs: number): number`

The direction index for "leaving by my slot `mine`, arriving at their slot `theirs`".

### `function architecture-studio.grid-adjacency.slotPairNeighbours(adjacency: QuadAdjacency): readonly (readonly (number | null)[])[]`

The solver-facing neighbour table under the slot-pair encoding.

`table[quad][direction]` is the neighbour index, or `null`. Most entries are
`null` -- a quad has four neighbours spread over sixteen directions -- which
the solver permits, since a missing neighbour is already how it represents a
grid border.

### `interface architecture-studio.irregular-grid.FaceMesh`

A mesh of arbitrary faces, the intermediate form before quadrangulation.

### `property architecture-studio.irregular-grid.FaceMesh.faces: readonly Face[]`

### `property architecture-studio.irregular-grid.FaceMesh.vertices: readonly Vec2[]`

### `interface architecture-studio.irregular-grid.IrregularQuadGridOptions`

Options for buildIrregularQuadGrid.

### `property architecture-studio.irregular-grid.IrregularQuadGridOptions.iterations?: number`

Smoothing passes. Around `10`-`20` settles this grid. Defaults to `12`.

### `property architecture-studio.irregular-grid.IrregularQuadGridOptions.pinBoundary?: boolean`

Whether vertices on the outer boundary stay put. Defaults to `true`.

A single chunk relaxed without pinning rounds off, because nothing outside
pulls back. Townscaper avoids this by relaxing across overlapping
neighbourhoods instead; pinning is the honest single-chunk stand-in, and
what a chunked implementation replaces.

### `property architecture-studio.irregular-grid.IrregularQuadGridOptions.seed: number`

### `property architecture-studio.irregular-grid.IrregularQuadGridOptions.strength?: number`

Fraction of the way to the target each pass moves a vertex. Defaults to `0.5`.

### `property architecture-studio.irregular-grid.IrregularQuadGridOptions.triangleSide?: number`

Edge length of one equilateral triangle. Defaults to `0.5`.

### `property architecture-studio.irregular-grid.IrregularQuadGridOptions.trianglesPerSide: number`

Triangles along one hexagon edge. Sylves' walkthrough uses `4`.

### `interface architecture-studio.irregular-grid.QuadMesh`

The finished all-quad grid.

### `property architecture-studio.irregular-grid.QuadMesh.quads: readonly Quad[]`

### `property architecture-studio.irregular-grid.QuadMesh.vertices: readonly Vec2[]`

### `interface architecture-studio.irregular-grid.RelaxOptions`

Options for relax.

### `property architecture-studio.irregular-grid.RelaxOptions.iterations?: number`

Smoothing passes. Around `10`-`20` settles this grid. Defaults to `12`.

### `property architecture-studio.irregular-grid.RelaxOptions.pinBoundary?: boolean`

Whether vertices on the outer boundary stay put. Defaults to `true`.

A single chunk relaxed without pinning rounds off, because nothing outside
pulls back. Townscaper avoids this by relaxing across overlapping
neighbourhoods instead; pinning is the honest single-chunk stand-in, and
what a chunked implementation replaces.

### `property architecture-studio.irregular-grid.RelaxOptions.strength?: number`

Fraction of the way to the target each pass moves a vertex. Defaults to `0.5`.

### `interface architecture-studio.irregular-grid.TriangleHexOptions`

Options for buildTriangleHex.

### `property architecture-studio.irregular-grid.TriangleHexOptions.triangleSide?: number`

Edge length of one equilateral triangle. Defaults to `0.5`.

### `property architecture-studio.irregular-grid.TriangleHexOptions.trianglesPerSide: number`

Triangles along one hexagon edge. Sylves' walkthrough uses `4`.

### `interface architecture-studio.irregular-grid.Vec2`

A point on the grid plane.

### `property architecture-studio.irregular-grid.Vec2.x: number`

### `property architecture-studio.irregular-grid.Vec2.y: number`

### `type architecture-studio.irregular-grid.Face = readonly number[]`

A face as indices into a vertex list, in cyclic order.

### `type architecture-studio.irregular-grid.Quad = readonly [number, number, number, number]`

A face known to have exactly four vertices.

### `type architecture-studio.irregular-grid.Random = () => number`

Deterministic 0..1 source, so a given seed always yields the same grid.

### `function architecture-studio.irregular-grid.boundaryVertices(mesh: QuadMesh): Set<number>`

Vertices on an edge belonging to exactly one quad.

### `function architecture-studio.irregular-grid.buildIrregularQuadGrid(options: IrregularQuadGridOptions): QuadMesh`

Runs the five steps in order. The whole technique, start to finish.

### `function architecture-studio.irregular-grid.buildTriangleHex(options: TriangleHexOptions): FaceMesh`

Step 1 — a hexagon filled with equilateral triangles.

A hexagon rather than a square because hexagons tile the plane while each
one stays a self-contained chunk, which is what later lets the grid extend
indefinitely with each chunk seeded from its own coordinates.

### `function architecture-studio.irregular-grid.createRandom(seed: number): Random`

Seeded generator.

Determinism is not a convenience here. The map is replicated authoritative
state, so two hosts generating "the same" grid must produce identical
vertices, and a grid that depends on `Math.random` cannot be regenerated
from a saved seed.

### `function architecture-studio.irregular-grid.ortho(mesh: FaceMesh): QuadMesh`

Step 3 — Conway's ortho operator: every face becomes quads.

A face of `n` sides yields `n` quads, each spanning one corner, the two
adjacent edge midpoints, and the face centre. A triangle becomes three
quads and a rhombus four, so nothing has to be done about faces that never
found a partner — the mesh is all-quad regardless of how the pairing went.

### `function architecture-studio.irregular-grid.pairTriangles(mesh: FaceMesh, random: Random): FaceMesh`

Step 2 — randomly merge adjacent triangles into rhombi.

This is the step that makes the result irregular, and it is purely
aesthetic: whatever stays unpaired is handled by ortho anyway. The
matching is greedy over a shuffled order, which leaves some triangles
unpaired by construction — that variation is the point, so no attempt is
made to maximise the matching.

### `function architecture-studio.irregular-grid.relax(mesh: QuadMesh, options: RelaxOptions): QuadMesh`

Step 5 — pull every cell toward a square without regularising the grid.

For each quad the best-fit square sharing its centre is found by rotating
each corner back by its own quarter-turn and averaging: in a true square all
four land on the same point, so how far they disagree is exactly how far the
cell is from square. Corners then move toward where that square puts them.

Because every vertex is pulled by all the cells it belongs to, the result is
a compromise — cells become square-ish while the irregular layout survives.
Averaging positions toward neighbours instead (ordinary Laplacian smoothing)
would shrink the mesh and say nothing about the shape of a cell.

### `function architecture-studio.irregular-grid.weld(mesh: QuadMesh, epsilon: number): QuadMesh`

Step 4 — merge coincident vertices.

Required before relaxation rather than merely tidy: each face produced its
own copy of every shared edge midpoint, and until those are one vertex,
smoothing moves each copy independently and tears the mesh apart.

### `function architecture-studio.irregular-grid-geometry.quadCentres(mesh: QuadMesh): Float32Array`

Cell centres, useful as the anchors a later tile solve would place modules on.

### `function architecture-studio.irregular-grid-geometry.quadOutlines(mesh: QuadMesh): Float32Array`

The four edges of every cell, as line-segment pairs.

Built from the quads directly rather than derived from the triangulated
surface: a wireframe of that surface would draw each cell's diagonal too,
showing a triangulation the grid does not actually have.

### `function architecture-studio.irregular-grid-geometry.quadSurface(mesh: QuadMesh): { indices: Uint32Array; positions: Float32Array }`

Triangulated cell interiors, as a flat `xyz` position buffer with indices.

### `interface architecture-studio.module-placement.ModuleMesh`

An authored module: geometry in unit-cell coordinates.

### `property architecture-studio.module-placement.ModuleMesh.indices: Uint32Array`

### `property architecture-studio.module-placement.ModuleMesh.vertices: readonly ModuleVertex[]`

### `interface architecture-studio.module-placement.ModuleVertex`

A point in the module's own unit cell. `u` and `v` span [0, 1].

### `property architecture-studio.module-placement.ModuleVertex.height: number`

Height above the cell's base, in world units, carried through unchanged.

### `property architecture-studio.module-placement.ModuleVertex.u: number`

### `property architecture-studio.module-placement.ModuleVertex.v: number`

### `interface architecture-studio.module-placement.PlacedModule`

Where a placed module ended up, as interleaved xyz.

### `property architecture-studio.module-placement.PlacedModule.indices: Uint32Array`

### `property architecture-studio.module-placement.PlacedModule.positions: Float32Array`

### `interface architecture-studio.module-placement.PlacementOptions`

Options controlling where the module sits vertically.

### `property architecture-studio.module-placement.PlacementOptions.baseHeight?: number`

World height of the cell's floor. Defaults to `0`.

### `function architecture-studio.module-placement.placeModule(module: ModuleMesh, mesh: QuadMesh, quadIndex: number, options: PlacementOptions): PlacedModule`

Places `module` into quad `quadIndex` of `mesh`.

Throws rather than producing silent nonsense when asked for a quad the mesh
does not have, since a wrong index yields geometry that looks plausible and
is wrong.

### `interface architecture-studio.quad-cell-graph.OpenFace`

A `(cell, face)` pair with nothing across it.

### `property architecture-studio.quad-cell-graph.OpenFace.cell: number`

### `property architecture-studio.quad-cell-graph.OpenFace.face: number`

### `interface architecture-studio.quad-cell-graph.QuadCellGraph`

The grid, restated as the solver's cells and links.

### `property architecture-studio.quad-cell-graph.QuadCellGraph.cellCount: number`

### `property architecture-studio.quad-cell-graph.QuadCellGraph.facesPerCell: number`

### `property architecture-studio.quad-cell-graph.QuadCellGraph.layerOfCell: Uint32Array`

Which layer each cell sits at, indexed by cell.

### `property architecture-studio.quad-cell-graph.QuadCellGraph.links: Uint32Array`

Adjacency, LINK_STRIDE numbers each: from, fromFace, to, toFace.

### `property architecture-studio.quad-cell-graph.QuadCellGraph.quadOfCell: Uint32Array`

Which quad each cell belongs to, indexed by cell.

### `method architecture-studio.quad-cell-graph.QuadCellGraph.cellAt(quad: number, layer: number): number | null`

The cell at `(quad, layer)`, or `null` if that box does not exist.

### `variable architecture-studio.quad-cell-graph.FACE_DOWN: 5`

The face pointing at the cell below.

### `variable architecture-studio.quad-cell-graph.FACE_UP: 4`

The face pointing at the cell above.

### `variable architecture-studio.quad-cell-graph.FACES_PER_CELL: 6`

Faces per cell: four lateral slots, then up and down.

### `variable architecture-studio.quad-cell-graph.LATERAL_FACES: readonly number[]`

The lateral faces, in the cyclic order a rotation walks them.

### `variable architecture-studio.quad-cell-graph.LINK_STRIDE: 4`

Numbers per link in the flat array, matching the crate's `LINK_STRIDE`.

### `function architecture-studio.quad-cell-graph.buildQuadCellGraph(mesh: QuadMesh, layersPerQuad: readonly number[]): QuadCellGraph`

Builds the cell graph for a stacked quad grid.

`layersPerQuad[q]` is how many boxes quad `q` contributes; `0` leaves that
quad out entirely, which is how a hole or a water cell is expressed without
a special case.

The mesh is wound-normalised first, because slot order has to turn the same
way on every quad for a rotation to mean anything. That is idempotent, so
passing an already-normalised mesh costs nothing but a pass.

### `function architecture-studio.quad-cell-graph.openFaces(graph: QuadCellGraph): readonly OpenFace[]`

Every face with nothing across it: the grid's rim, the exposed sides of a
step, the top of each stack and the underside of the bottom layer.

These are the faces the solver is silent about (see this module's header),
so a caller that wants the map enclosed pins them here rather than inferring
them from the geometry a second time.

### `interface architecture-studio.shell-cell-graph.ShellCellGraph`

The occupied/empty boundary of a stacked grid, as the solver's cells.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.airCells: Uint32Array`

Every CELL_AIR cell, for the caller to pin in one pass.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.cellCount: number`

### `property architecture-studio.shell-cell-graph.ShellCellGraph.facesPerCell: number`

### `property architecture-studio.shell-cell-graph.ShellCellGraph.kindOfCell: Uint8Array`

CELL_SOLID or CELL_AIR, indexed by cell.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.layerOfCell: Uint32Array`

Which layer each cell sits at, indexed by cell.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.links: Uint32Array`

Adjacency, LINK_STRIDE numbers each: from, fromFace, to, toFace.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.occupiedCellCount: number`

How many cells the occupancy holds, shell or interior, for comparison.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.quadOfCell: Uint32Array`

Which quad each cell belongs to, indexed by cell.

### `property architecture-studio.shell-cell-graph.ShellCellGraph.roofCells: Uint32Array`

Occupied cells with nothing directly above -- the ones showing a top
surface. Under a heightfield this was the top of each column; with a
general occupancy every storey of an overhang has one.

### `method architecture-studio.shell-cell-graph.ShellCellGraph.cellAt(quad: number, layer: number): number | null`

The cell at `(quad, layer)`, or `null` if the shell does not include it.

### `variable architecture-studio.shell-cell-graph.CELL_AIR: 0`

A cell holding nothing, present only to constrain what it touches.

### `variable architecture-studio.shell-cell-graph.CELL_SOLID: 1`

A cell holding something.

### `function architecture-studio.shell-cell-graph.buildShellCellGraph(mesh: QuadMesh, occupancy: Occupancy): ShellCellGraph`

Builds the shell graph for an occupancy over `mesh`.

An empty quad takes part rather than being skipped: its neighbours' sides
face air across it, which is the whole point of materialising air.

### `function architecture-studio.shell-cell-graph.pinCells(cells: readonly number[] | Uint32Array<ArrayBufferLike>, moduleIndex: number): Uint32Array`

Packs `(cell, module)` assignments into the flat pinning array the wasm
boundary takes -- how the caller nails every air cell to its empty module.

### `interface architecture-studio.stacked-terrain.CellCentres`

Geometric centre of each cell, and the grid's extent, in one pass.

### `property architecture-studio.stacked-terrain.CellCentres.centres: readonly Vec2[]`

### `property architecture-studio.stacked-terrain.CellCentres.max: Vec2`

### `property architecture-studio.stacked-terrain.CellCentres.min: Vec2`

### `interface architecture-studio.stacked-terrain.Heightfield`

A regular grid of samples, as generate_heightmap produces.

### `property architecture-studio.stacked-terrain.Heightfield.height: number`

### `property architecture-studio.stacked-terrain.Heightfield.values: Float32Array`

Row-major samples, `width * height` of them, nominally in `[-1, 1]`.

### `property architecture-studio.stacked-terrain.Heightfield.width: number`

### `interface architecture-studio.stacked-terrain.StackedTerrain`

Triangulated terrain, split so a caller can shade tops and walls differently.

### `property architecture-studio.stacked-terrain.StackedTerrain.positions: Float32Array`

Flat `xyz` triples for every generated corner.

### `property architecture-studio.stacked-terrain.StackedTerrain.topIndices: Uint32Array`

Triangles covering the flat top of each cell.

### `property architecture-studio.stacked-terrain.StackedTerrain.wallIndices: Uint32Array`

Triangles covering the vertical faces between cells at different levels.

### `interface architecture-studio.stacked-terrain.StackedTerrainOptions`

Options for buildStackedTerrain.

### `property architecture-studio.stacked-terrain.StackedTerrainOptions.baseHeight?: number`

Y the outermost walls descend to. Defaults to `0`, which leaves a level-0
cell with no skirt at all; a negative value gives the terrain visible
thickness at the grid's edge.

### `property architecture-studio.stacked-terrain.StackedTerrainOptions.levelHeight?: number`

World height of one discrete level. Level `n` has its top at `n * levelHeight`.

### `function architecture-studio.stacked-terrain.buildStackedTerrain(mesh: QuadMesh, levels: ArrayLike<number>, options: StackedTerrainOptions): StackedTerrain`

Extrudes each cell to its own level and closes the steps between them.

A wall is emitted on an edge only where the cell on the other side is
genuinely lower, or absent at the grid boundary. Emitting one per edge
regardless would double every interior face and leave surfaces buried inside
the terrain, which cost nothing visually and everything in triangle count.

### `function architecture-studio.stacked-terrain.cellCentres(mesh: QuadMesh): CellCentres`

Cell centres plus the bounding box needed to map them into a heightfield.

### `function architecture-studio.stacked-terrain.edgeNeighbours(mesh: QuadMesh): Map<string, number[]>`

Which cells touch each edge. An interior edge has two; a boundary edge one.

### `function architecture-studio.stacked-terrain.sampleCellValues(mesh: QuadMesh, field: Heightfield): Float32Array`

Samples one continuous value per cell, ready to hand to the Rust
`discretize` crate.

Kept separate from the quantisation itself so the discrete levels stay the
Rust crate's output rather than being recomputed here — the repository has
one authoritative binning implementation and this is not it.

### `function architecture-studio.stacked-terrain.sampleHeightfield(field: Heightfield, u: number, v: number): number`

Reads a regular heightfield at an arbitrary point.

Needed because the cells are irregular and the noise source is not: nothing
lines a cell centre up with a sample. Bilinear rather than nearest, so two
adjacent cells cannot land on the same sample and flatten a step that should
exist.

### `interface architecture-studio.terrain-modules.MeshOptions`

Options controlling how much of a module's sides are drawn.

### `property architecture-studio.terrain-modules.MeshOptions.skirtBottom?: number`

Height the skirt drops to, in cell heights. Defaults to `0`, the module's
own floor.

Only the top of a column is drawn now that the solver works on the shell,
so its skirt has to reach the ground rather than stopping one cell down --
otherwise a raised column reads as a floating sheet. Passing the column's
layer here is what makes it a column again.

### `interface architecture-studio.terrain-modules.TerrainModule`

One authored piece of terrain.

### `property architecture-studio.terrain-modules.TerrainModule.colour: number`

Render colour, so a solved map is legible at a glance.

### `property architecture-studio.terrain-modules.TerrainModule.name: string`

Shown in the composer; also what a solved cell is reported as.

### `property architecture-studio.terrain-modules.TerrainModule.shape: ModuleShape`

The geometry this module stands for.

### `property architecture-studio.terrain-modules.TerrainModule.sockets: readonly number[]`

One socket per face: four lateral in cyclic order, then up, then down.

### `property architecture-studio.terrain-modules.TerrainModule.visible: boolean`

False draws nothing at all -- how "open air" is expressed.

### `property architecture-studio.terrain-modules.TerrainModule.weight: number`

Relative likelihood of the module. Shared across its orientations.

### `type architecture-studio.terrain-modules.ModuleShape = { corners: readonly number[]; kind: "corner-heights" } | { kind: "mesh"; mesh: ModuleMesh }`

What a module's geometry actually is.

# Why this is a union and not four corner heights

A corner-height profile describes a *surface*: one height per corner, a top,
and a skirt dropped from it. That is a heightfield idea, and it survived into
a world whose occupancy is now a set of cells rather than a column height. It
cannot describe an underside, so it cannot describe an overhang's ceiling, an
arch, or a balcony seen from below -- however freely the occupancy is edited.

So a module either keeps that vocabulary, which is still the right one for
terrain, or carries an authored mesh in unit-cell space, which is the
vocabulary a facade tileset needs. placeModule already accepted
arbitrary geometry; only the generation of it was pinned to heights.

### `variable architecture-studio.terrain-modules.EMPTY_MODULE_NAME: "empty"`

The module every air cell is pinned to. Found by name rather than by index so
reordering the composer's list cannot silently pin air to terrain.

### `variable architecture-studio.terrain-modules.MODULE_CORNERS: 4`

How many corners a module gives a height for.

### `variable architecture-studio.terrain-modules.MODULE_FACES: 6`

Faces per module: four lateral slots, then up and down.

### `variable architecture-studio.terrain-modules.SOCKET: { AIR: 6; FALL: 3; GROUND: 4; HIGH: 1; LOW: 0; RISE: 2; SKY: 5; UNDER: 7 }`

`AIR` is what a face meets when there is nothing across it -- the top of a
cliff, the rim, the space over a hole. It exists because the solver used to
be *silent* about those faces rather than constrained on them, which left the
visible surface the freest part of the map. A tileset can now say "this piece
may not be exposed"; the starting one mostly declines to, on purpose.

### `variable architecture-studio.terrain-modules.STARTING_COMPATIBILITY: readonly (readonly [number, number])[]`

Socket compatibility for STARTING_TILESET. Symmetric; list once.

`AIR` meets every lateral socket, so any of them may be a cliff face and
all-`flat` remains a solution however the terrain steps.

# Why `AIR` meets `LOW`, after once not doing so

An earlier version banned that one pair, meaning to keep `hollow` -- a full
depression -- off a cliff edge, on the grounds that a depression open on one
side is not a depression. That reasoning was about a *module* and the ban was
on a *socket*, and `LOW` is not `hollow`'s alone: `ramp` and `corner` each
present it on their low edge, which is a slope descending to a drop, and
ordinary terrain.

Measured consequence, on the real grid at `trianglesPerSide: 5`: with the ban
the solver failed on 5 to 14 of every 20 seeds, because a ramp's low edge
demanded a neighbour showing `LOW`, only `hollow` could show one, and `hollow`
could not be anywhere near air -- which in a shell graph is nearly everywhere.
A solution still existed every time (all-`flat` satisfies every link), so the
tileset was never unsatisfiable; it was unsearchable, which a greedy solver
cannot tell apart. Allowing the pair takes it to 17 to 20 of 20.

Moving the ban onto a socket of `hollow`'s own was tried and does not help:
it is `hollow` being unplaceable at all that strands the ramps, whichever
socket carries it.

### `variable architecture-studio.terrain-modules.STARTING_TILESET: readonly TerrainModule[]`

A starting point for the composer, not a recommendation.

Four terrain modules over seven sockets, plus the pinned `empty` that stands
for air: enough for a solved map to look like something, small enough to hold
in your head while editing. Sockets here
happen to describe the corner heights faithfully -- `flat` is `HIGH` on
every side, `ramp` rises on one and falls on the opposite -- so the starting
map is geometrically continuous, and every departure from that is one you
made deliberately in the composer.

Two properties worth knowing before editing:

- `flat` is symmetric and expands to one variant; `ramp` and `corner` are
  asymmetric and expand to four each. You do not author the rotations.
- all-`flat` is always a solution, so the starting tileset cannot be
  unsatisfiable. Remove `flat` and that guarantee goes with it.

The vertical direction is deliberately unconstrained: every module shows
`SKY` upward and `GROUND` downward, and those are the only vertical pair, so
stacking never rejects anything. Constraining it is a decision for the
composer, not a default worth baking in.

### `function architecture-studio.terrain-modules.edgeProfile(module: TerrainModule, face: number): readonly [number, number] | null`

The height along a module's lateral edge `face`, as the pair of corner
heights in that module's own cyclic order.

Exists so the composer can show whether an authored socket actually matches
the geometry it labels -- the mismatch this file deliberately allows.

`null` for an authored mesh: a socket there labels how the piece meets its
neighbour, which arbitrary geometry gives no single pair of heights to check
against. Silence is the honest answer; inventing a pair would let the
composer flag correct tilesets as inconsistent.

### `function architecture-studio.terrain-modules.flattenCompatibility(pairs: readonly (readonly [number, number])[]): Uint32Array`

Packs socket compatibility into the flat pair array the boundary takes.

### `function architecture-studio.terrain-modules.flattenModules(modules: readonly TerrainModule[]): { sockets: Uint32Array; weights: Float32Array }`

Packs the modules' sockets and weights into the flat arrays the wasm
boundary takes.

### `function architecture-studio.terrain-modules.isSurface(module: TerrainModule): boolean`

Whether a module describes a surface, and so is drawn only where it roofs
something, or a piece, which is drawn wherever the solver puts it.

The renderer needs this and cannot guess it: drawing a surface at every cell
puts coplanar tops inside a column, and drawing a piece only at roofs makes
an overhang's ceiling vanish.

### `function architecture-studio.terrain-modules.moduleMesh(module: TerrainModule, turns: number, options: MeshOptions): ModuleMesh`

Builds a module's geometry in unit-cell space, already turned.

For a corner-height module the top surface is the profile and a skirt drops
from each edge to MeshOptions.skirtBottom, so a raised cell reads as
a solid column rather than a floating sheet. For an authored mesh the
geometry is used as given and only turned: it owns its own underside, so
`skirtBottom` has nothing to act on and is ignored.

Rotation is the same quarter turn in both cases -- rotateUnitCell is
orientation-preserving, so an authored mesh's winding survives it and a
turned piece is not inside out.

### `function architecture-studio.terrain-modules.rotateUnitCell(u: number, v: number, turns: number): { u: number; v: number }`

Turns a unit-cell coordinate one quarter turn.

Sends `(u, 0)` to `(1, u)`: the bottom edge becomes the right edge, so edge
`i` becomes edge `i + 1`. That is the crate's socket convention, and the two
being the same rotation is what keeps a solved map's geometry consistent
with the constraints that produced it.

### `interface architecture-studio.transition-shapes.CornerOccupancy`

Which corner columns are solid, and how far up.

### `property architecture-studio.transition-shapes.CornerOccupancy.layerCount: number`

One past the highest solid layer across the whole grid.

### `method architecture-studio.transition-shapes.CornerOccupancy.filled(vertex: number, layer: number): boolean`

Whether the column at `vertex` is solid at `layer`.

### `method architecture-studio.transition-shapes.CornerOccupancy.topLayer(vertex: number): number`

Highest solid layer at a corner column, or `-1` if it is empty.

### `interface architecture-studio.transition-shapes.TransitionTerrain`

Triangulated terrain, split so a caller can shade the parts differently.

### `property architecture-studio.transition-shapes.TransitionTerrain.positions: Float32Array`

Flat `xyz` triples for every generated corner; no vertex is shared between triangles.

### `property architecture-studio.transition-shapes.TransitionTerrain.sideIndices: Uint32Array`

The chamfers and vertical faces between cells at different levels.

### `property architecture-studio.transition-shapes.TransitionTerrain.skirtIndices: Uint32Array`

The wall closing the open rim at the grid's boundary down to `baseHeight`.

### `property architecture-studio.transition-shapes.TransitionTerrain.topIndices: Uint32Array`

Triangles facing predominantly upward.

### `interface architecture-studio.transition-shapes.TransitionTerrainOptions`

Options for buildTransitionTerrain.

### `property architecture-studio.transition-shapes.TransitionTerrainOptions.baseHeight?: number`

Y the outer skirt descends to, giving the terrain visible thickness at the grid's edge.

### `property architecture-studio.transition-shapes.TransitionTerrainOptions.levelHeight?: number`

World height of one discrete level, matching stage 2's option of the same name.

### `function architecture-studio.transition-shapes.buildTransitionTerrain(mesh: QuadMesh, levels: ArrayLike<number>, options: TransitionTerrainOptions): TransitionTerrain`

Extracts the boundary of the corner-column occupancy as a triangle mesh.

Layer `0` is never given an underside: everything below it counts as solid,
so the terrain is open underneath exactly as stage 2's is, and the sides are
closed by a skirt rather than by a floor.

### `function architecture-studio.transition-shapes.cornerOccupancy(mesh: QuadMesh, levels: ArrayLike<number>): CornerOccupancy`

Turns stage 2's per-cell levels into per-corner-column occupancy.

A corner takes the **highest** level among the cells meeting at it. That is
what makes the union bulge outward at a step, and it is the whole reason the
result reads as rounded rather than stepped: the low cell's shared corners
are pulled up by its taller neighbour, and the surface crosses the gap on a
diagonal.
