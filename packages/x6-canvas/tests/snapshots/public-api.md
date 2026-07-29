# Generated TypeScript public API baseline

Package: `@grafting/x6-canvas`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `@antv/x6`

## Declaration entry point

```ts
/** Immutable presentation data for one canvas node. */
export interface CanvasNode {
    /** Stable caller-owned identity preserved by the adapter. */
    readonly id: string;
    /** Human-readable text rendered inside the node. */
    readonly label: string;
    /** Horizontal presentation coordinate supplied by the caller. */
    readonly x: number;
    /** Vertical presentation coordinate supplied by the caller. */
    readonly y: number;
    /** Optional rendered width in CSS pixels. */
    readonly width?: number;
    /** Optional rendered height in CSS pixels. */
    readonly height?: number;
    /** Optional CSS color used to fill the node body. */
    readonly color?: string;
}
/** Immutable presentation data for one directed canvas edge. */
export interface CanvasEdge {
    /** Stable caller-owned identity preserved by the adapter. */
    readonly id: string;
    /** Identity of the rendered source node. */
    readonly source: string;
    /** Identity of the rendered target node. */
    readonly target: string;
    /** Optional human-readable text rendered on the edge. */
    readonly label?: string;
}
/** Read-only controls returned to a canvas consumer. */
export interface ReadOnlyCanvas {
    /** Number of nodes supplied when the canvas was created. */
    readonly nodeCount: number;
    /** Number of edges supplied when the canvas was created. */
    readonly edgeCount: number;
    /** Centers the current rendered content in the viewport. */
    center(): void;
    /** Releases the canvas resources owned by this adapter instance. */
    dispose(): void;
}
/**
 * Creates a non-editable graph canvas from caller-owned presentation data.
 *
 * This adapter preserves identifiers and coordinates; it does not calculate a
 * graph layout or expose the mutable vendor graph.
 *
 * @param container - Browser element that will own the rendered canvas.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable edge presentation data.
 * @returns A frozen Grafting-owned handle with read-only canvas operations.
 * @throws When the browser canvas cannot be initialized from the supplied data.
 */
export declare function createReadOnlyCanvas(container: HTMLElement, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): ReadOnlyCanvas;
```
