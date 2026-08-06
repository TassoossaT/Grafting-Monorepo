import { useId, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { ClassicPreset, GetSchemes, NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin, Zoom } from "rete-area-plugin";
import { ClassicFlow, ConnectionPlugin, getSourceTarget, type SocketData } from "rete-connection-plugin";
import { Presets, ReactPlugin, type ReactArea2D } from "rete-react-plugin";

import type {
  CanvasEdge,
  CanvasEdgeConnector,
  CanvasEdgeMarkerPresentation,
  CanvasEdgePresentation,
  CanvasEdgeViewDefinition,
  CanvasEntityReference,
  CanvasHandle,
  CanvasInteractionModifier,
  CanvasNode,
  CanvasNodeRenderHandle,
  CanvasNodeViewDefinition,
  CanvasOptions,
  CanvasPortDefinition,
  CanvasPortPosition,
} from "./contracts.js";
import { checkCanvasConnection, type ConnectionCandidate } from "./connection-policy.js";
import { clampCanvasZoomScale, resolveCanvasInteractionPolicy } from "./interaction-policy.js";
import { isReportableMovement } from "./movement-policy.js";
import { resolveCanvasSocketPointerPolicy } from "./socket-policy.js";

class CanvasSocketModel extends ClassicPreset.Socket {
  constructor(readonly definition: CanvasPortDefinition) {
    super(definition.id);
  }
}

class CanvasNodeModel extends ClassicPreset.Node {
  width: number;
  height: number;
  source: CanvasNode;
  selected = false;

  constructor(
    source: CanvasNode,
    readonly definition: CanvasNodeViewDefinition,
    readonly activate: (reference: CanvasEntityReference) => void,
    readonly clickThreshold: number,
  ) {
    super(source.id);
    this.id = source.id;
    this.source = source;
    this.width = source.width ?? definition.defaultWidth;
    this.height = source.height ?? definition.defaultHeight;
  }
}

class CanvasConnectionModel extends ClassicPreset.Connection<CanvasNodeModel, CanvasNodeModel> {
  selected = false;

  constructor(
    source: CanvasNodeModel,
    sourceOutput: string,
    target: CanvasNodeModel,
    targetInput: string,
    readonly edge: CanvasEdge,
    readonly definition: CanvasEdgeViewDefinition,
    readonly activate: (reference: CanvasEntityReference) => void,
    readonly clickThreshold: number,
  ) {
    super(source, sourceOutput, target, targetInput);
    this.id = edge.id;
  }
}

type Schemes = GetSchemes<CanvasNodeModel, CanvasConnectionModel>;
type AreaExtra = ReactArea2D<Schemes>;

const DEFAULT_SOURCE_PORT: CanvasPortDefinition = Object.freeze({
  id: "__grafting_source__",
  position: "right",
});
const DEFAULT_TARGET_PORT: CanvasPortDefinition = Object.freeze({
  id: "__grafting_target__",
  position: "left",
});

function createCatalog<Definition extends { readonly id: string }>(
  kind: "node" | "edge",
  definitions: readonly Definition[],
): ReadonlyMap<string, Definition> {
  const catalog = new Map<string, Definition>();
  for (const definition of definitions) {
    if (catalog.has(definition.id)) {
      throw new Error(`Duplicate canvas ${kind} view: ${definition.id}`);
    }
    catalog.set(definition.id, definition);
  }
  return catalog;
}

function resolveView<Definition>(
  kind: "node" | "edge",
  catalog: ReadonlyMap<string, Definition>,
  id: string,
): Definition {
  const definition = catalog.get(id);
  if (definition === undefined) {
    throw new Error(`Canvas ${kind} view is not registered: ${id}`);
  }
  return definition;
}

const outputKey = (portId: string): string => `output:${portId}`;
const inputKey = (portId: string): string => `input:${portId}`;

function declaredPorts(
  node: CanvasNode,
  definition: CanvasNodeViewDefinition,
): readonly CanvasPortDefinition[] {
  return node.ports ?? definition.ports ?? [];
}

function resolvePort(
  node: CanvasNode,
  definition: CanvasNodeViewDefinition,
  portId: string | undefined,
  fallback: CanvasPortDefinition,
): CanvasPortDefinition {
  if (portId === undefined) return fallback;
  const port = declaredPorts(node, definition).find((candidate) => candidate.id === portId);
  if (port === undefined) {
    throw new Error(`Canvas node ${node.id} does not define port ${portId}`);
  }
  return port;
}

/**
 * Instantiates every declared port on a node model.
 *
 * Authoring requires a socket to exist before any edge references it, so ports
 * are declared eagerly rather than on first use. A port that names no direction
 * stays undirected and is instantiated on both sides, preserving the behavior
 * of ports written before directions existed.
 */
function declarePorts(model: CanvasNodeModel): void {
  for (const port of declaredPorts(model.source, model.definition)) {
    const direction = port.direction ?? "both";
    const multiple = port.capacity === undefined || port.capacity > 1;
    if (direction !== "in" && !model.hasOutput(outputKey(port.id))) {
      model.addOutput(outputKey(port.id), new ClassicPreset.Output(new CanvasSocketModel(port), "", multiple));
    }
    if (direction !== "out" && !model.hasInput(inputKey(port.id))) {
      model.addInput(inputKey(port.id), new ClassicPreset.Input(new CanvasSocketModel(port), "", multiple));
    }
  }
}

function assertUniqueIds(kind: "node" | "edge", values: readonly { readonly id: string }[]): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`Duplicate canvas ${kind} id: ${value.id}`);
    ids.add(value.id);
  }
}

function socketPosition(position: CanvasPortPosition): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    zIndex: 3,
  };
  if (typeof position === "object") {
    return {
      ...base,
      left: `${position.x * 100}%`,
      top: `${position.y * 100}%`,
    };
  }
  switch (position) {
    case "top":
      return { ...base, left: "50%", top: 0 };
    case "right":
      return { ...base, right: 0, top: "50%" };
    case "bottom":
      return { ...base, bottom: 0, left: "50%" };
    case "left":
      return { ...base, left: 0, top: "50%" };
  }
}

/** Places a port label outside the node boundary the port sits on. */
function socketLabelPosition(position: CanvasPortPosition, offset: number): CSSProperties {
  const side = typeof position === "object" ? "right" : position;
  switch (side) {
    case "top":
      return { bottom: offset, left: "50%", transform: "translateX(-50%)" };
    case "bottom":
      return { top: offset, left: "50%", transform: "translateX(-50%)" };
    case "left":
      return { right: offset, top: "50%", transform: "translateY(-50%)" };
    case "right":
      return { left: offset, top: "50%", transform: "translateY(-50%)" };
  }
}

function CanvasSocketView({ data }: { readonly data: ClassicPreset.Socket }) {
  const definition = (data as CanvasSocketModel).definition;
  const presentation = definition.presentation;
  const radius = presentation?.radius ?? 4;
  const diameter = radius * 2;
  const { interactive, hitSize } = resolveCanvasSocketPointerPolicy(definition);
  return (
    // The outer element is the pointer target, deliberately larger than the
    // drawn dot: a connection is started by grabbing a port, and a ten-pixel
    // circle is not a target anyone can hit reliably while the surface also
    // pans and zooms. The dot itself stays transparent to the pointer so the
    // whole target behaves as one.
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        width: hitSize,
        height: hitSize,
        borderRadius: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: interactive ? "auto" : "none",
        cursor: interactive ? "crosshair" : undefined,
        touchAction: interactive ? "none" : undefined,
      }}
    >
      <span
        style={{
          position: "relative",
          display: "block",
          width: diameter,
          height: diameter,
          boxSizing: "border-box",
          borderRadius: "50%",
          background: presentation?.fill ?? "transparent",
          border: `${presentation?.strokeWidth ?? 0}px solid ${presentation?.stroke ?? "transparent"}`,
          opacity: presentation?.opacity ?? 1,
          pointerEvents: "none",
        }}
      >
        {presentation?.label === undefined ? null : (
          <span
            style={{
              position: "absolute",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              color: presentation.labelColor ?? presentation.stroke ?? "currentColor",
              fontSize: presentation.labelFontSize ?? 9,
              ...socketLabelPosition(definition.position, radius + 4),
            }}
          >
            {presentation.label}
          </span>
        )}
      </span>
    </span>
  );
}

function pointerDistance(
  start: { readonly x: number; readonly y: number },
  event: ReactPointerEvent,
): number {
  return Math.hypot(event.clientX - start.x, event.clientY - start.y);
}

function CanvasNodeView({
  data,
  emit,
}: {
  readonly data: CanvasNodeModel;
  readonly emit: (signal: ReactArea2D<Schemes>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<CanvasNodeRenderHandle | null>(null);
  const pointerStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    mountedRef.current = data.definition.mount(host, {
      node: data.source,
      selected: data.selected,
    });
    return () => {
      mountedRef.current?.dispose();
      mountedRef.current = null;
    };
  }, [data]);

  useLayoutEffect(() => {
    mountedRef.current?.update({ node: data.source, selected: data.selected });
  }, [data, data.selected]);

  const renderSocket = (
    side: "input" | "output",
    key: string,
    port: ClassicPreset.Input<CanvasSocketModel> | ClassicPreset.Output<CanvasSocketModel>,
  ) => (
    <span key={`${side}:${key}`} style={socketPosition(port.socket.definition.position)}>
      <Presets.classic.RefSocket
        name="grafting-canvas-socket"
        side={side}
        socketKey={key}
        nodeId={data.id}
        emit={emit}
        payload={port.socket}
      />
    </span>
  );

  return (
    <div
      data-canvas-node={data.source.id}
      style={{
        position: "relative",
        width: data.width,
        height: data.height,
        boxSizing: "border-box",
        userSelect: "none",
        zIndex: data.source.zIndex ?? 1,
      }}
      onPointerDown={(event) => {
        if (event.button === 0) {
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onPointerUp={(event) => {
        const start = pointerStartRef.current;
        pointerStartRef.current = null;
        if (start !== null && event.button === 0 && pointerDistance(start, event) <= data.clickThreshold) {
          data.activate({ kind: "node", id: data.source.id });
        }
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {Object.entries(data.outputs).map(([key, output]) =>
        output instanceof ClassicPreset.Output ? renderSocket("output", key, output as ClassicPreset.Output<CanvasSocketModel>) : null,
      )}
      {Object.entries(data.inputs).map(([key, input]) =>
        input instanceof ClassicPreset.Input ? renderSocket("input", key, input as ClassicPreset.Input<CanvasSocketModel>) : null,
      )}
    </div>
  );
}

function edgePath(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  connector: CanvasEdgeConnector | undefined,
  fallback: string | null | undefined,
): string {
  if (connector?.kind === "straight") return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  if (connector?.kind === "rounded") {
    const midpointX = (start.x + end.x) / 2;
    const midpointY = (start.y + end.y) / 2;
    const radius = connector.radius ?? 8;
    return `M ${start.x} ${start.y} Q ${midpointX + radius} ${midpointY - radius} ${end.x} ${end.y}`;
  }
  if (connector?.kind === "smooth") {
    if (connector.direction === "vertical") {
      const middleY = (start.y + end.y) / 2;
      return `M ${start.x} ${start.y} C ${start.x} ${middleY}, ${end.x} ${middleY}, ${end.x} ${end.y}`;
    }
    const middleX = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} C ${middleX} ${start.y}, ${middleX} ${end.y}, ${end.x} ${end.y}`;
  }
  return fallback ?? `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function markerShape(marker: CanvasEdgeMarkerPresentation): string {
  return marker.kind === "classic" ? "M 0 0 L 10 5 L 0 10 L 3 5 z" : "M 0 0 L 10 5 L 0 10 z";
}

/**
 * Trailing line drawn while a user is still dragging a connection.
 *
 * The endpoint is not known yet, so no consumer edge exists to present. The
 * treatment stays deliberately plain; a product styles committed edges through
 * its own edge view.
 */
function CanvasPseudoConnectionView() {
  const connection = Presets.classic.useConnection();
  if (connection.start == null || connection.end == null) return null;
  return (
    <svg aria-hidden="true" style={{ overflow: "visible", position: "absolute", pointerEvents: "none", width: 9999, height: 9999 }}>
      <path
        d={edgePath(connection.start, connection.end, undefined, connection.path)}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={2}
        strokeDasharray="4 4"
      />
    </svg>
  );
}

function CanvasConnectionView({ data }: { readonly data: CanvasConnectionModel }) {
  const connection = Presets.classic.useConnection();
  const uniqueId = useId().replaceAll(":", "");
  const pointerStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  // The connection plugin renders an in-progress drag through the same channel
  // as committed connections, but it carries no consumer edge or edge view.
  if ((data as Partial<CanvasConnectionModel>).definition === undefined) return <CanvasPseudoConnectionView />;
  if (connection.start == null || connection.end == null) return null;

  const presentation: CanvasEdgePresentation = data.definition.present({
    edge: data.edge,
    selected: data.selected,
  });
  const pathId = `grafting-edge-${uniqueId}`;
  const sourceMarker = presentation.line?.sourceMarker;
  const targetMarker = presentation.line?.targetMarker;
  const sourceMarkerId = `${pathId}-source`;
  const targetMarkerId = `${pathId}-target`;
  const path = edgePath(connection.start, connection.end, presentation.connector, connection.path);
  const line = presentation.line;

  const renderMarker = (id: string, marker: CanvasEdgeMarkerPresentation | undefined) =>
    marker === undefined || marker.kind === "none" ? null : (
      <marker
        id={id}
        markerWidth={marker.width ?? 10}
        markerHeight={marker.height ?? 10}
        refX={9}
        refY={5}
        orient="auto-start-reverse"
        viewBox="0 0 10 10"
      >
        <path d={markerShape(marker)} fill={marker.fill ?? line?.color ?? "currentColor"} stroke={marker.stroke ?? "none"} />
      </marker>
    );

  return (
    <svg
      aria-hidden="true"
      style={{
        overflow: "visible",
        position: "absolute",
        pointerEvents: "none",
        width: 9999,
        height: 9999,
        zIndex: presentation.zIndex ?? 0,
      }}
    >
      <defs>
        {renderMarker(sourceMarkerId, sourceMarker)}
        {renderMarker(targetMarkerId, targetMarker)}
      </defs>
      <path
        id={pathId}
        d={path}
        className={line?.className}
        fill="none"
        stroke={line?.color ?? "#64748b"}
        strokeWidth={line?.width ?? 2}
        strokeDasharray={line?.dash}
        strokeOpacity={line?.opacity ?? 1}
        markerStart={sourceMarker === undefined || sourceMarker.kind === "none" ? undefined : `url(#${sourceMarkerId})`}
        markerEnd={targetMarker === undefined || targetMarker.kind === "none" ? undefined : `url(#${targetMarkerId})`}
        {...line?.attributes}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={presentation.hitAreaWidth ?? 12}
        pointerEvents="stroke"
        onPointerDown={(event) => {
          if (event.button === 0) pointerStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = pointerStartRef.current;
          pointerStartRef.current = null;
          if (start !== null && event.button === 0 && pointerDistance(start, event) <= data.clickThreshold) {
            data.activate({ kind: "edge", id: data.edge.id });
          }
        }}
      />
      {presentation.labels?.map((label, index) => {
        const labelPath = (
          <textPath href={`#${pathId}`} startOffset={`${(label.position ?? 0.5) * 100}%`} textAnchor="middle">
            {label.text}
          </textPath>
        );
        const backgroundWidth = (label.borderRadius ?? 4) * 2;
        return (
          <g key={`${label.text}:${index}`} className={label.className} pointerEvents="none">
            {label.borderColor === undefined ? null : (
              <text
                fill={label.color ?? line?.color ?? "#334155"}
                fontSize={label.fontSize ?? 10}
                fontWeight={label.fontWeight ?? 600}
                paintOrder="stroke"
                stroke={label.borderColor}
                strokeWidth={backgroundWidth + 2}
                strokeLinejoin="round"
              >
                {labelPath}
              </text>
            )}
            <text
              fill={label.color ?? line?.color ?? "#334155"}
              fontSize={label.fontSize ?? 10}
              fontWeight={label.fontWeight ?? 600}
              paintOrder="stroke"
              stroke={label.backgroundColor ?? "white"}
              strokeWidth={backgroundWidth}
              strokeLinejoin="round"
            >
              {labelPath}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

class CanvasWheelZoom extends Zoom {
  constructor(intensity: number, modifiers: readonly CanvasInteractionModifier[]) {
    super(intensity);
    const inheritedWheel = this.wheel;
    this.wheel = (event: WheelEvent) => {
      const active = modifiers.every((modifier) => {
        switch (modifier) {
          case "control":
            return event.ctrlKey;
          case "meta":
            return event.metaKey;
          case "alt":
            return event.altKey;
          case "shift":
            return event.shiftKey;
        }
      });
      if (active) inheritedWheel(event);
    };
  }
}

function applySurface(container: HTMLElement, options: CanvasOptions): string | null {
  const previous = container.getAttribute("style");
  const surface = options.surface;
  container.style.position = "relative";
  container.style.overflow = "hidden";
  container.style.backgroundColor = surface?.backgroundColor ?? "transparent";
  const grid = surface?.grid;
  if (grid === undefined || grid === false) {
    container.style.backgroundImage = "";
    container.style.backgroundSize = "";
  } else if (grid.kind === "dot") {
    const thickness = grid.thickness ?? 1;
    container.style.backgroundImage = `radial-gradient(circle, ${grid.color ?? "#cbd5e1"} ${thickness}px, transparent ${thickness}px)`;
    container.style.backgroundSize = `${grid.size}px ${grid.size}px`;
  } else {
    const color = grid.color ?? "#cbd5e1";
    const thickness = grid.thickness ?? 1;
    container.style.backgroundImage = `linear-gradient(${color} ${thickness}px, transparent ${thickness}px), linear-gradient(90deg, ${color} ${thickness}px, transparent ${thickness}px)`;
    container.style.backgroundSize = `${grid.size}px ${grid.size}px`;
  }
  return previous;
}

function fitScale(container: HTMLElement, options: CanvasOptions): number {
  const padding = options.viewport?.padding ?? 0;
  const smallestSide = Math.max(1, Math.min(container.clientWidth, container.clientHeight));
  const padded = Math.max(0.1, 1 - (padding * 2) / smallestSide);
  return Math.min(padded, options.viewport?.maxScale ?? 1);
}

/**
 * Internal renderer boundary behind the public {@link createCanvas} facade.
 */
export function createCanvasAdapter(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: CanvasOptions,
): CanvasHandle {
  assertUniqueIds("node", nodes);
  assertUniqueIds("edge", edges);

  const nodeViews = createCatalog("node", options.nodeViews);
  const edgeViews = createCatalog("edge", options.edgeViews ?? []);
  const interaction = resolveCanvasInteractionPolicy(options.interaction);
  const clickThreshold = interaction.clickThreshold;
  const nodeModels = new Map<string, CanvasNodeModel>();
  const connectionModels = new Map<string, CanvasConnectionModel>();
  let activate: (reference: CanvasEntityReference) => void = () => undefined;

  const buildNodeModel = (node: CanvasNode): CanvasNodeModel => {
    const definition = resolveView("node", nodeViews, node.view);
    if (definition.defaultWidth <= 0 || definition.defaultHeight <= 0) {
      throw new Error(`Canvas node view ${definition.id} must define positive dimensions`);
    }
    const model = new CanvasNodeModel(node, definition, (reference) => activate(reference), clickThreshold);
    declarePorts(model);
    return model;
  };

  const buildConnectionModel = (edge: CanvasEdge): CanvasConnectionModel => {
    const source = nodeModels.get(edge.source.nodeId);
    const target = nodeModels.get(edge.target.nodeId);
    if (source === undefined || target === undefined) {
      throw new Error(`Canvas edge ${edge.id} references a missing endpoint`);
    }
    const sourcePort = resolvePort(source.source, source.definition, edge.source.portId, DEFAULT_SOURCE_PORT);
    const targetPort = resolvePort(target.source, target.definition, edge.target.portId, DEFAULT_TARGET_PORT);
    const sourceKey = outputKey(sourcePort.id);
    const targetKey = inputKey(targetPort.id);
    // A port that declares itself an input never received an output socket in
    // `declarePorts`, and vice versa; an edge naming it that way is a caller
    // error, not something to silently repair with a second socket.
    if (!source.hasOutput(sourceKey)) {
      if (edge.source.portId !== undefined && sourcePort.direction === "in") {
        throw new Error(`Canvas edge ${edge.id} leaves ${source.id} through input-only port ${sourcePort.id}`);
      }
      source.addOutput(sourceKey, new ClassicPreset.Output(new CanvasSocketModel(sourcePort), "", true));
    }
    if (!target.hasInput(targetKey)) {
      if (edge.target.portId !== undefined && targetPort.direction === "out") {
        throw new Error(`Canvas edge ${edge.id} enters ${target.id} through output-only port ${targetPort.id}`);
      }
      target.addInput(targetKey, new ClassicPreset.Input(new CanvasSocketModel(targetPort), "", true));
    }
    const definition = resolveView("edge", edgeViews, edge.view);
    return new CanvasConnectionModel(
      source,
      sourceKey,
      target,
      targetKey,
      edge,
      definition,
      (reference) => activate(reference),
      clickThreshold,
    );
  };

  for (const node of nodes) {
    nodeModels.set(node.id, buildNodeModel(node));
  }
  for (const edge of edges) {
    connectionModels.set(edge.id, buildConnectionModel(edge));
  }

  const previousStyle = applySurface(container, options);
  container.replaceChildren();

  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
  render.addPreset(
    Presets.classic.setup({
      customize: {
        node: () => CanvasNodeView,
        connection: () => CanvasConnectionView,
        socket: () => CanvasSocketView,
      },
    }),
  );
  editor.use(area);
  area.use(render);

  const zoom = interaction.zoom;
  if (zoom === false) {
    area.area.setZoomHandler(null);
  } else {
    area.area.setZoomHandler(
      new CanvasWheelZoom(Math.max(0.01, (zoom.factor ?? 1.1) - 1), zoom.modifiers ?? []),
    );
  }
  if (!interaction.panning) area.area.setDragHandler(null);

  let initializing = true;
  let programmaticZoom = false;
  let disposed = false;
  let selected: CanvasEntityReference | null = null;

  area.addPipe((context) => {
    if (
      context.type === "nodetranslate" &&
      !initializing &&
      !interaction.movableNodes
    ) {
      return;
    }
    if (context.type === "zoom" && !programmaticZoom && zoom !== false) {
      if (context.data.source === "dblclick") return;
      if (context.data.zoom < (zoom.minScale ?? 0.1) || context.data.zoom > (zoom.maxScale ?? 4)) {
        return;
      }
    }
    if (context.type === "nodetranslated" && !initializing && interaction.movableNodes) {
      const model = nodeModels.get(context.data.id);
      const { x, y } = context.data.position;
      if (isReportableMovement(model?.source, context.data.position)) {
        options.editing?.onNodeMoved?.(context.data.id, x, y);
      }
    }
    return context;
  });

  const center = async () => {
    if (disposed || nodeModels.size === 0) return;
    programmaticZoom = true;
    try {
      await AreaExtensions.zoomAt(area, editor.getNodes(), { scale: fitScale(container, options) });
    } finally {
      programmaticZoom = false;
    }
  };

  const zoomAroundViewportCenter = async (scale: number): Promise<void> => {
    programmaticZoom = true;
    try {
      await area.area.zoom(
        clampCanvasZoomScale(scale, zoom),
        container.clientWidth / 2,
        container.clientHeight / 2,
      );
    } finally {
      programmaticZoom = false;
    }
  };

  const attachNode = async (model: CanvasNodeModel): Promise<void> => {
    await editor.addNode(model);
    await area.translate(model.id, { x: model.source.x, y: model.source.y });
    await area.resize(model.id, model.width, model.height);
  };

  const ready = (async () => {
    for (const node of nodeModels.values()) {
      if (disposed) return;
      await attachNode(node);
    }
    for (const connection of connectionModels.values()) {
      if (disposed) return;
      await editor.addConnection(connection);
    }
    initializing = false;
    if (options.viewport?.fitOnCreate ?? true) await center();
  })();

  // Rete's editor mutations are asynchronous, so every caller-driven change is
  // appended to one chain. Without it, two mutations issued in the same tick
  // could interleave and leave the surface disagreeing with `nodeModels`.
  let pending: Promise<void> = ready;
  const enqueue = (work: () => Promise<void>): void => {
    pending = pending.then(() => (disposed ? undefined : work()));
    void pending;
  };

  const updateSelection = (reference: CanvasEntityReference, value: boolean): void => {
    if (reference.kind === "node") {
      const node = nodeModels.get(reference.id);
      if (node === undefined) throw new Error(`Canvas node not found: ${reference.id}`);
      node.selected = value;
      enqueue(() => area.update("node", node.id));
    } else {
      const connectionModel = connectionModels.get(reference.id);
      if (connectionModel === undefined) throw new Error(`Canvas edge not found: ${reference.id}`);
      connectionModel.selected = value;
      enqueue(() => area.update("connection", connectionModel.id));
    }
  };

  const setSelection = (reference: CanvasEntityReference | null): void => {
    if (disposed) return;
    if (selected !== null) updateSelection(selected, false);
    selected = reference === null ? null : Object.freeze({ ...reference });
    if (selected !== null) updateSelection(selected, true);
  };

  activate = (reference) => {
    if (interaction.selectOnActivate) setSelection(reference);
    options.onActivate?.(Object.freeze({ ...reference }));
  };

  const clearSelectionOf = (reference: CanvasEntityReference): void => {
    if (selected !== null && selected.kind === reference.kind && selected.id === reference.id) {
      selected = null;
    }
  };

  // The connection flow removes an occupied input's edge on its own, so the
  // editor is the single place where a removal becomes visible regardless of
  // who started it.
  let removingProgrammatically = false;
  editor.addPipe((context) => {
    if (context.type === "connectionremove" && !removingProgrammatically && options.editing?.removableEdges !== true) {
      return;
    }
    if (context.type === "connectionremoved" && !removingProgrammatically) {
      const edgeId = String(context.data.id);
      if (connectionModels.delete(edgeId)) {
        clearSelectionOf({ kind: "edge", id: edgeId });
        options.editing?.onDisconnected?.(edgeId);
      }
    }
    return context;
  });

  const addNode = (node: CanvasNode): void => {
    if (nodeModels.has(node.id)) throw new Error(`Duplicate canvas node id: ${node.id}`);
    const model = buildNodeModel(node);
    nodeModels.set(node.id, model);
    enqueue(() => attachNode(model));
  };

  const addEdge = (edge: CanvasEdge): void => {
    if (connectionModels.has(edge.id)) throw new Error(`Duplicate canvas edge id: ${edge.id}`);
    const model = buildConnectionModel(edge);
    connectionModels.set(edge.id, model);
    enqueue(async () => {
      await editor.addConnection(model);
    });
  };

  const removeEdge = (edgeId: string): void => {
    if (!connectionModels.delete(edgeId)) throw new Error(`Canvas edge not found: ${edgeId}`);
    clearSelectionOf({ kind: "edge", id: edgeId });
    enqueue(async () => {
      removingProgrammatically = true;
      try {
        await editor.removeConnection(edgeId);
      } finally {
        removingProgrammatically = false;
      }
    });
  };

  const edgesTouching = (nodeId: string, portIds?: ReadonlySet<string>): readonly string[] =>
    [...connectionModels.values()]
      .filter((model) => {
        for (const terminal of [model.edge.source, model.edge.target]) {
          if (terminal.nodeId !== nodeId) continue;
          if (portIds === undefined) return true;
          if (terminal.portId !== undefined && portIds.has(terminal.portId)) return true;
        }
        return false;
      })
      .map((model) => model.edge.id);

  const removeNode = (nodeId: string): void => {
    if (!nodeModels.has(nodeId)) throw new Error(`Canvas node not found: ${nodeId}`);
    for (const edgeId of edgesTouching(nodeId)) removeEdge(edgeId);
    nodeModels.delete(nodeId);
    clearSelectionOf({ kind: "node", id: nodeId });
    enqueue(async () => {
      await editor.removeNode(nodeId);
    });
  };

  const updateNode = (node: CanvasNode): void => {
    const model = nodeModels.get(node.id);
    if (model === undefined) throw new Error(`Canvas node not found: ${node.id}`);
    if (node.view !== model.source.view) {
      // A different view is a different mount with different geometry; keeping
      // the identity would hide that. Removing and adding makes it explicit.
      throw new Error(`Canvas node ${node.id} cannot change view in place: ${model.source.view} to ${node.view}`);
    }
    const previousPorts = new Set(declaredPorts(model.source, model.definition).map((port) => port.id));
    const nextPorts = new Set(declaredPorts(node, model.definition).map((port) => port.id));
    const droppedPorts = new Set([...previousPorts].filter((portId) => !nextPorts.has(portId)));
    if (droppedPorts.size > 0) {
      for (const edgeId of edgesTouching(node.id, droppedPorts)) removeEdge(edgeId);
    }

    model.source = node;
    model.width = node.width ?? model.definition.defaultWidth;
    model.height = node.height ?? model.definition.defaultHeight;
    for (const portId of droppedPorts) {
      if (model.hasInput(inputKey(portId))) model.removeInput(inputKey(portId));
      if (model.hasOutput(outputKey(portId))) model.removeOutput(outputKey(portId));
    }
    declarePorts(model);

    enqueue(async () => {
      await area.translate(node.id, { x: node.x, y: node.y });
      await area.resize(node.id, model.width, model.height);
      await area.update("node", node.id);
    });
  };

  const editing = options.editing;
  if (editing?.connectable === true || editing?.removableEdges === true) {
    // Resolves a socket the plugin reports back into the caller's own port.
    const readSocket = (socket: SocketData): ConnectionCandidate | null => {
      const model = nodeModels.get(socket.nodeId);
      if (model === undefined) return null;
      const portId = socket.key.slice(socket.key.indexOf(":") + 1);
      const port = declaredPorts(model.source, model.definition).find((candidate) => candidate.id === portId);
      if (port === undefined) return null;
      const connectionCount = [...connectionModels.values()].filter((connection) =>
        socket.side === "input"
          ? connection.target === socket.nodeId && connection.targetInput === socket.key
          : connection.source === socket.nodeId && connection.sourceOutput === socket.key,
      ).length;
      return { nodeId: socket.nodeId, port, side: socket.side, connectionCount };
    };

    const orderedEnds = (from: SocketData, to: SocketData): readonly [SocketData, SocketData] | null => {
      const ordered = getSourceTarget(from, to);
      const [orderedSource, orderedTarget] = ordered ?? [];
      if (orderedSource === undefined || orderedTarget === undefined) return null;
      return [orderedSource, orderedTarget];
    };

    const review = (from: SocketData, to: SocketData): {
      readonly source: ConnectionCandidate;
      readonly target: ConnectionCandidate;
      readonly sourcePortId: string;
      readonly targetPortId: string;
    } | null => {
      const ends = orderedEnds(from, to);
      if (ends === null) return null;
      const source = readSocket(ends[0]);
      const target = readSocket(ends[1]);
      if (source === null || target === null) return null;
      const alreadyConnected = [...connectionModels.values()].some(
        (model) =>
          model.edge.source.nodeId === source.nodeId &&
          model.edge.target.nodeId === target.nodeId &&
          model.edge.source.portId === source.port.id &&
          model.edge.target.portId === target.port.id,
      );
      if (checkCanvasConnection(source, target, alreadyConnected) !== null) return null;
      return { source, target, sourcePortId: source.port.id, targetPortId: target.port.id };
    };

    const connectionPlugin = new ConnectionPlugin<Schemes, AreaExtra>();
    connectionPlugin.addPreset(
      () =>
        new ClassicFlow<Schemes, [AreaExtra]>({
          canMakeConnection: (from, to) => editing.connectable === true && review(from, to) !== null,
          makeConnection: (from, to) => {
            if (editing.connectable !== true) return undefined;
            const reviewed = review(from, to);
            if (reviewed === null) return undefined;
            const decision = editing.onConnectRequest?.({
              source: Object.freeze({
                nodeId: reviewed.source.nodeId,
                portId: reviewed.sourcePortId,
                dataType: reviewed.source.port.dataType,
              }),
              target: Object.freeze({
                nodeId: reviewed.target.nodeId,
                portId: reviewed.targetPortId,
                dataType: reviewed.target.port.dataType,
              }),
            });
            // No callback means no product opinion, and the canvas will not
            // invent an edge identity or guess value-kind compatibility.
            if (decision === undefined || !decision.accepted) return undefined;
            addEdge(decision.edge);
            editing.onConnected?.(decision.edge);
            return true;
          },
        }),
    );
    area.use(connectionPlugin);
  }

  return Object.freeze({
    get nodeCount() {
      return nodeModels.size;
    },
    get edgeCount() {
      return connectionModels.size;
    },
    center: () => {
      enqueue(center);
    },
    zoomBy: (factor: number) => {
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new RangeError("Canvas zoom factor must be a finite positive number");
      }
      enqueue(() => zoomAroundViewportCenter(area.area.transform.k * factor));
    },
    resetZoom: () => {
      enqueue(() => zoomAroundViewportCenter(1));
    },
    setSelection,
    addNode,
    updateNode,
    removeNode,
    addEdge,
    removeEdge,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      area.destroy();
      void editor.clear();
      container.replaceChildren();
      if (previousStyle === null) container.removeAttribute("style");
      else container.setAttribute("style", previousStyle);
    },
  });
}
