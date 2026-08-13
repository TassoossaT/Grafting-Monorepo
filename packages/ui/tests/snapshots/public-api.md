# Generated TypeScript public API baseline

Package: `@grafting/ui`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `antd`, `react-dom`, `react-grid-layout`, `rete`, `rete-area-plugin`, `rete-connection-plugin`, `rete-react-plugin`, `rete-render-utils`, `styled-components`

## Declaration entry point

```ts
/** Semantic statuses supported by Grafting UI components. */
export type UiStatus = "neutral" | "info" | "success" | "warning" | "error";
/** Geometric outline of a card surface. */
export type CardShape = "rectangle" | "pill" | "circle" | "hexagon";
/** Vendor-neutral lifecycle returned by a UI component mounted into an existing DOM host. */
export interface UiMountHandle<Props> {
    /** Re-renders the mounted component with complete next inputs. */
    update(props: Props): void;
    /** Unmounts the component and releases the owned UI root. */
    dispose(): void;
}

import type { ReactElement } from "react";
/** Semantic text tones independent of the current visual implementation. */
export type TextTone = "default" | "muted" | "accent" | "danger";
/** Public inputs for the smallest reusable text presentation primitive. */
export interface TextProps {
    /**
     * Text content rendered by the component.
     * @example "Example label"
     */
    readonly content: string;
    /**
     * Optional semantic color treatment.
     * @default "default"
     */
    readonly tone?: TextTone;
    /**
     * Whether the text uses the emphasized weight.
     * @default false
     */
    readonly strong?: boolean;
    /**
     * Whether overflowing single-line content is truncated with an accessible tooltip.
     * @default false
     */
    readonly truncate?: boolean;
    /** Optional tooltip text used when truncation is enabled. */
    readonly tooltip?: string;
    /**
     * Optional maximum width in CSS pixels.
     * @default "100%"
     */
    readonly maxWidth?: number;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Bounded text with semantic tone and optional truncation.
 *
 * @layer atom
 * @status stable
 */
export declare function Text(props: TextProps): ReactElement;

import type { ReactElement } from "react";
import type { UiStatus } from "../shared-types.js";
/** Public inputs for a compact semantic status indicator. */
export interface StatusBadgeProps {
    /**
     * Semantic state to present.
     * @example "success"
     */
    readonly status: UiStatus;
    /**
     * Human-readable status label.
     * @example "Ready"
     */
    readonly label: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Semantic status marker with Grafting-owned status names.
 *
 * @layer atom
 * @status stable
 */
export declare function StatusBadge(props: StatusBadgeProps): ReactElement;

import type { ReactElement } from "react";
/** Public inputs for a compact, clickable action. */
export interface ButtonProps {
    /**
     * Human-readable button label.
     * @example "Run"
     */
    readonly label: string;
    /** Invoked when the button is activated. */
    readonly onClick?: () => void;
    /**
     * Optional semantic emphasis.
     * @default "default"
     */
    readonly tone?: "default" | "accent";
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Compact action button for lightweight command triggers.
 *
 * @layer atom
 * @status stable
 */
export declare function Button(props: ButtonProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
import type { CardShape } from "../shared-types.js";
/** Public inputs for the smallest reusable bounded surface: a generic card. */
export interface CardProps {
    /**
     * Geometric outline of the card; defaults to a rounded rectangle.
     * @default "rectangle"
     */
    readonly shape?: CardShape;
    /**
     * Caller-owned content rendered inside the card.
     * @example "Body"
     */
    readonly children: ReactNode;
    /**
     * Optional accessible name for the card.
     * @example "Task status"
     */
    readonly ariaLabel?: string;
    /** Optional accent used for the card boundary. */
    readonly accentColor?: string;
    /**
     * Optional background color for the card surface.
     * @default "#ffffff"
     */
    readonly backgroundColor?: string;
    /**
     * Whether the card occupies the complete width and height of its container.
     * @default false
     */
    readonly fillContainer?: boolean;
    /**
     * Whether the card should communicate pointer interaction.
     * @default false
     */
    readonly interactive?: boolean;
    /**
     * Whether the card displays its selected treatment.
     * @default false
     */
    readonly selected?: boolean;
    /** Optional boundary color used when the card is selected. */
    readonly selectedColor?: string;
    /**
     * Optional boundary width in CSS pixels.
     * @default 1
     */
    readonly borderWidth?: number;
    /**
     * Optional rounded-corner radius in CSS pixels.
     * @default 8
     */
    readonly borderRadius?: number;
    /**
     * Optional padding in CSS pixels.
     * @default 12
     */
    readonly padding?: number;
    /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
    readonly glowColor?: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Dependency-free bounded surface with replaceable accent and selection styles.
 *
 * @layer atom
 * @status stable
 */
export declare function Card(props: CardProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
import type { CardShape, UiMountHandle, UiStatus } from "../shared-types.js";
/** Public inputs for a reusable entity summary shown in canvases, tables, or inspectors. */
export interface EntitySummaryProps {
    /**
     * Primary human-readable entity name.
     * @example "architecture-studio"
     */
    readonly title: string;
    /**
     * Optional secondary description.
     * @example "project"
     */
    readonly description?: string;
    /** Optional semantic status. */
    readonly status?: UiStatus;
    /** Human-readable label paired with status. */
    readonly statusLabel?: string;
    /** Optional visual placed before the textual identity. */
    readonly leading?: ReactNode;
    /** Optional actions placed after the textual identity. */
    readonly actions?: ReactNode;
    /** Optional accessible name for the summary container. */
    readonly ariaLabel?: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional accent used for the complete card boundary. */
    readonly accentColor?: string;
    /** Optional background color for the complete card surface. */
    readonly backgroundColor?: string;
    /**
     * Whether the card occupies the complete width and height of its container.
     * @default false
     */
    readonly fillContainer?: boolean;
    /**
     * Whether the card should communicate pointer interaction.
     * @default false
     */
    readonly interactive?: boolean;
    /**
     * Whether the card displays its selected treatment.
     * @default false
     */
    readonly selected?: boolean;
    /** Optional boundary color used when the component is selected. */
    readonly selectedColor?: string;
    /**
     * Optional boundary width in CSS pixels.
     * @default 1
     */
    readonly borderWidth?: number;
    /**
     * Optional rounded-corner radius in CSS pixels.
     * @default 8
     */
    readonly borderRadius?: number;
    /**
     * Optional body padding in CSS pixels.
     * @default 12
     */
    readonly bodyPadding?: number;
    /**
     * Optional gap between the component's content regions.
     * @default 10
     */
    readonly contentGap?: number;
    /**
     * Optional short caller-owned labels rendered as compact badges below the identity.
     * @default []
     */
    readonly tags?: readonly string[];
    /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
    readonly glowColor?: string;
    /**
     * Geometric outline of the card; defaults to a rounded rectangle.
     * @default "rectangle"
     */
    readonly shape?: CardShape;
    /** Optional label for a compact action button rendered in the card. */
    readonly actionLabel?: string;
    /** Invoked when the action button is activated. */
    readonly onAction?: () => void;
}
/**
 * Composable identity card built from Card, Text, and StatusBadge.
 *
 * @layer molecule
 * @status stable
 */
export declare function EntitySummary(props: EntitySummaryProps): ReactElement;
/** Mounts an EntitySummary into an existing DOM host without exposing ReactDOM. */
export declare function mountEntitySummary(host: HTMLElement, props: EntitySummaryProps): UiMountHandle<EntitySummaryProps>;

import type { ReactElement, ReactNode } from "react";
import type { UiStatus } from "../shared-types.js";
/** Public inputs for a gallery-style tile: cover image, title/description, status, tags, and actions. */
export interface PreviewCardProps {
    /**
     * Primary human-readable title.
     * @example "Heightmap generation"
     */
    readonly title: string;
    /**
     * Optional secondary description.
     * @example "Perlin-noise procedural terrain heightmap, computed in Rust via Wasm."
     */
    readonly description?: string;
    /**
     * Optional cover image shown above the title, clipped to the card's own
     * corners. `alt` is bundled with `src` so accessible text can never be
     * forgotten when a cover is present.
     * @example
     * ```tsx
     * { src: "/preview.png", alt: "Rendered heightmap preview" }
     * ```
     */
    readonly cover?: {
        readonly src: string;
        readonly alt: string;
    };
    /**
     * Optional semantic status.
     * @example "success"
     */
    readonly status?: UiStatus;
    /**
     * Human-readable label paired with status.
     * @example "Adopted"
     */
    readonly statusLabel?: string;
    /**
     * Optional short caller-owned labels rendered as compact badges.
     * @default []
     * @example ["MIT", "top pick"]
     */
    readonly tags?: readonly string[];
    /** Optional actions rendered at the bottom of the card. */
    readonly actions?: ReactNode;
    /** Optional accessible name for the card container. */
    readonly ariaLabel?: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
    readonly glowColor?: string;
    /**
     * Whether the card should communicate pointer interaction.
     * @default false
     */
    readonly interactive?: boolean;
    /**
     * Whether the card displays its selected treatment.
     * @default false
     */
    readonly selected?: boolean;
    /** Optional boundary color used when the card is selected. */
    readonly selectedColor?: string;
    /** Optional accent used for the card boundary. */
    readonly accentColor?: string;
    /**
     * Optional background color for the card surface.
     * @default "#ffffff"
     */
    readonly backgroundColor?: string;
    /**
     * Whether the card occupies the complete width and height of its container.
     * @default false
     */
    readonly fillContainer?: boolean;
}
/**
 * Gallery-style tile built from Card, Text, and StatusBadge: a cover image,
 * title/description, status, tags, and caller-owned actions.
 *
 * @layer molecule
 * @status stable
 */
export declare function PreviewCard(props: PreviewCardProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Stable key used to identify a table row independently of its position. */
export type DataTableRowKey = string | number;
/** Immutable context supplied to a custom table-cell renderer. */
export interface DataTableCellContext<Row extends object> {
    /** Complete caller-owned row. */
    readonly row: Row;
    /** Value projected by the column. */
    readonly value: unknown;
    /** Current presentation index of the row. */
    readonly rowIndex: number;
}
/** Vendor-neutral description of one data-table column. */
export interface DataTableColumn<Row extends object> {
    /** Stable column identifier. */
    readonly id: string;
    /** Human-readable column heading. */
    readonly header: string;
    /** Projects the value represented by this column. */
    readonly value: (row: Row) => unknown;
    /** Optional custom React presentation for the projected cell value. */
    readonly renderCell?: (context: DataTableCellContext<Row>) => ReactNode;
    /** Optional width in CSS pixels. */
    readonly width?: number;
    /** Optional horizontal alignment. */
    readonly align?: "start" | "center" | "end";
}
/** Controlled row-selection contract for a data table. */
export interface DataTableSelection {
    /** Currently selected stable row keys. */
    readonly selectedKeys: readonly DataTableRowKey[];
    /** Receives the complete next selection. */
    readonly onChange: (keys: readonly DataTableRowKey[]) => void;
}
/** Minimal pagination contract independent of the current table engine. */
export interface DataTablePagination {
    /** Number of rows rendered on each page. */
    readonly pageSize: number;
    /** Whether controls disappear when every row fits on one page. */
    readonly hideWhenSinglePage?: boolean;
}
/** Public inputs for the reusable Grafting data table. */
export interface DataTableProps<Row extends object> {
    /**
     * Immutable caller-owned rows.
     * @example
     * ```tsx
     * [{ id: "a", name: "architecture-studio" }, { id: "b", name: "ui" }]
     * ```
     */
    readonly rows: readonly Row[];
    /**
     * Immutable vendor-neutral column definitions.
     * @example
     * ```tsx
     * [{ id: "name", header: "Name", value: (row) => row.name }]
     * ```
     */
    readonly columns: readonly DataTableColumn<Row>[];
    /**
     * Returns the stable key for a row.
     * @example (row) => row.id
     */
    readonly rowKey: (row: Row) => DataTableRowKey;
    /**
     * Accessible table name.
     * @example "Repository nodes"
     */
    readonly ariaLabel: string;
    /** Optional controlled selection. */
    readonly selection?: DataTableSelection;
    /**
     * Optional pagination, or false to render all rows.
     * @default
     * ```tsx
     * { pageSize: 20, hideWhenSinglePage: true }
     * ```
     */
    readonly pagination?: DataTablePagination | false;
    /**
     * Optional table density.
     * @default "compact"
     */
    readonly density?: "compact" | "regular";
    /**
     * Optional text shown when there are no rows.
     * @default "No data"
     */
    readonly emptyMessage?: string;
    /** Whether a loading treatment is displayed. */
    readonly loading?: boolean;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Immutable rows table with controlled selection and custom renderers.
 *
 * @layer organism
 * @status stable
 */
export declare function DataTable<Row extends object>(props: DataTableProps<Row>): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Stable caller-owned identity for one panel in a Grafting grid layout. */
export type GridPanelId = string;
/** Vendor-neutral position and size of one panel, in grid units, not pixels. */
export interface GridPanelPlacement {
    /** Stable identity matching the panel this placement belongs to. */
    readonly id: GridPanelId;
    /** Horizontal position in grid columns, zero-indexed from the left. */
    readonly x: number;
    /** Vertical position in grid rows, zero-indexed from the top. */
    readonly y: number;
    /** Width in grid columns. */
    readonly width: number;
    /** Height in grid rows. */
    readonly height: number;
    /** Optional minimum width in grid columns. */
    readonly minWidth?: number;
    /** Optional minimum height in grid rows. */
    readonly minHeight?: number;
    /** Optional maximum width in grid columns. */
    readonly maxWidth?: number;
    /** Optional maximum height in grid rows. */
    readonly maxHeight?: number;
    /** Whether the panel is fixed in place and excluded from drag or resize. */
    readonly locked?: boolean;
}
/** One panel rendered by the Grafting grid layout. */
export interface GridPanel {
    /** Current placement of this panel. */
    readonly placement: GridPanelPlacement;
    /** Caller-owned content rendered inside the panel. */
    readonly content: ReactNode;
}
/** Public inputs for the reusable Grafting dashboard grid layout. */
export interface GridLayoutProps {
    /**
     * Immutable caller-owned panels and their current placements.
     * @example
     * ```tsx
     * [{ placement: { id: "p1", x: 0, y: 0, width: 12, height: 4 }, content: <div>Panel</div> }]
     * ```
     */
    readonly panels: readonly GridPanel[];
    /**
     * Accessible name for the grid region.
     * @example "Studio dashboard"
     */
    readonly ariaLabel: string;
    /**
     * Number of columns the grid is divided into.
     * @default 12
     */
    readonly columns?: number;
    /**
     * Height of one grid row in CSS pixels.
     * @default 32
     */
    readonly rowHeight?: number;
    /**
     * Gap between panels in CSS pixels, applied both horizontally and vertically.
     * @default 12
     */
    readonly gap?: number;
    /** Whether panels can be dragged to a new position. */
    readonly draggable?: boolean;
    /** Whether panels can be resized. */
    readonly resizable?: boolean;
    /** Receives the complete next placement for every panel after a drag, resize, or compaction. */
    readonly onPlacementsChange?: (placements: readonly GridPanelPlacement[]) => void;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Draggable/resizable dashboard layout using Grafting-owned panel contracts.
 *
 * Consumers whose bundler does not already provide it must import
 * `react-grid-layout/css/styles.css` once at the application level; this
 * package does not import it as a side effect (it declares `sideEffects:
 * false`), so the choice of when and whether to load that stylesheet stays
 * with the consuming application.
 *
 * @layer atom
 * @status stable
 */
export declare function GridLayout(props: GridLayoutProps): ReactElement;

import type { GeometryCanvas, GeometryCanvasOptions } from "./geometry/contracts.js";
import type { CanvasEdge, CanvasHandle, CanvasNode, CanvasOptions } from "./graph/contracts.js";
import type { HeightfieldCanvas, HeightfieldCanvasOptions } from "./heightfield/contracts.js";
export type { CanvasConnectionDecision, CanvasConnectionEndpoint, CanvasConnectionRequest, CanvasEdge, CanvasEdgeConnector, CanvasEdgeLabelPresentation, CanvasEdgeLinePresentation, CanvasEdgeMarkerPresentation, CanvasEdgePresentation, CanvasEdgeRenderContext, CanvasEdgeTerminal, CanvasEdgeViewDefinition, CanvasEditingOptions, CanvasEntityReference, CanvasGridPresentation, CanvasHandle, CanvasInteractionModifier, CanvasInteractionOptions, CanvasNode, CanvasNodeRenderContext, CanvasNodeRenderHandle, CanvasNodeViewDefinition, CanvasOptions, CanvasPortDefinition, CanvasPortDirection, CanvasPortPosition, CanvasPortPresentation, CanvasSurfacePresentation, CanvasViewportOptions, CanvasZoomOptions, } from "./graph/contracts.js";
export type { HeightfieldCanvas, HeightfieldCanvasOptions, } from "./heightfield/contracts.js";
/**
 * Creates a graph canvas from caller-owned presentation data.
 *
 * The UI boundary preserves identifiers and coordinates, mounts
 * consumer-supplied views, and keeps its rendering engine private. Graph
 * layout remains an explicit upstream computation.
 *
 * @param container - Browser element that owns the canvas surface.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable connection presentation data.
 * @param options - Consumer-supplied views and replaceable presentation policy.
 * @returns A frozen Grafting-owned lifecycle handle.
 */
export declare function createCanvas(container: HTMLElement, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], options: CanvasOptions): CanvasHandle;
/**
 * Mounts a real-time heightfield preview while keeping the renderer private.
 *
 * @param container - Browser element that owns the rendered preview.
 * @param options - Grid data and replaceable presentation options.
 * @returns A Grafting-owned update, capture, and disposal handle.
 */
export declare function createHeightfieldCanvas(container: HTMLElement, options: HeightfieldCanvasOptions): HeightfieldCanvas;
export type { GeometryCanvas, GeometryCanvasOptions } from "./geometry/contracts.js";
/**
 * Mounts a real-time preview of arbitrary triangle geometry, keeping the
 * renderer private.
 *
 * Separate from {@link createHeightfieldCanvas} rather than a mode of it: a
 * raster holds one height per point, and geometry off the lattice or with a
 * vertical step has more than one.
 *
 * @param container - Browser element that owns the rendered preview.
 * @param options - Geometry and replaceable presentation options.
 * @returns A Grafting-owned update, capture, and disposal handle.
 */
export declare function createGeometryCanvas(container: HTMLElement, options: GeometryCanvasOptions): GeometryCanvas;

import type { ReactElement, ReactNode } from "react";
/** Menu item entry for a circular radial context menu. */
export interface RadialMenuItem {
    /**
     * Unique menu item identifier.
     * @example "move"
     */
    readonly id: string;
    /**
     * Display label for the menu item.
     * @example "Mover Nó"
     */
    readonly label: string;
    /** Optional icon element. */
    readonly icon?: ReactNode;
    /** Invoked when this item is selected. */
    readonly action: () => void;
    /** Optional visual accent color for the border. */
    readonly accentColor?: string;
}
/** Public inputs for the floating 3D Radial Context Menu. */
export interface RadialContextMenuProps {
    /**
     * Target screen position (x, y) where the radial menu opens. Pass null when hidden.
     * @example { x: 300, y: 400 }
     */
    readonly position: {
        readonly x: number;
        readonly y: number;
    } | null;
    /**
     * Items rendered around the ring.
     * @example [{ id: "move", label: "Mover Nó", action: () => {} }]
     */
    readonly items: readonly RadialMenuItem[];
    /**
     * Invoked when clicking outside or canceling the menu.
     * @example () => {}
     */
    readonly onClose: () => void;
    /** Optional title shown at the center pivot. */
    readonly title?: string;
}
/**
  * Floating circular 2D/3D Radial Context Menu for rapid map actions.
  *
  * @layer molecule
  * @status stable
  */
export declare function RadialContextMenu(props: RadialContextMenuProps): ReactElement | null;

import type { ReactElement } from "react";
/** Floor level preset item. */
export interface FloorLevelOption {
    /**
     * Unique level identifier.
     * @example "L1"
     */
    readonly id: string;
    /**
     * Human-readable level name.
     * @example "Térreo"
     */
    readonly label: string;
    /**
     * Elevation height in meters.
     * @example 3.5
     */
    readonly heightMeters: number;
}
/** Default floor level presets for building cutaways. */
export declare const DEFAULT_FLOOR_LEVELS: readonly FloorLevelOption[];
/** Public inputs for the Floor Height Slicer component. */
export interface FloorLevelSlicerProps {
    /**
     * Current cutaway height in meters.
     * @example 3.5
     */
    readonly heightMeters: number;
    /**
     * Currently active level ID preset.
     * @example "L1"
     */
    readonly activeLevelId: string;
    /** Optional array of level presets. */
    readonly levels?: readonly FloorLevelOption[];
    /**
     * Callback when height in meters is adjusted.
     * @example (height) => console.log(height)
     */
    readonly onChangeHeight: (heightMeters: number) => void;
    /**
     * Callback when a level preset is chosen.
     * @example (id, height) => console.log(id, height)
     */
    readonly onSelectLevel: (levelId: string, heightMeters: number) => void;
    /** Optional custom class name. */
    readonly className?: string;
}
/**
 * Floor Height Cutaway Slicer molecule for multi-story level design.
 *
 * @layer molecule
 * @status stable
 */
export declare function FloorLevelSlicer(props: FloorLevelSlicerProps): ReactElement;

import type { ReactElement } from "react";
/** Material option entry for swatch selection. */
export interface MaterialSwatchOption {
    /**
     * Unique material identifier.
     * @example "wall-white"
     */
    readonly id: string;
    /**
     * Display name of the material or prototype block.
     * @example "Bloco Branco"
     */
    readonly name: string;
    /**
     * Color hex code or preview styling.
     * @example "#e2e8f0"
     */
    readonly colorHex: string;
    /** Optional material category. */
    readonly category?: string;
}
/** Default material options for prototype blocks. */
export declare const DEFAULT_SWATCH_MATERIALS: readonly MaterialSwatchOption[];
/** Public inputs for Material Swatch Palette Grid component. */
export interface MaterialSwatchGridProps {
    /**
     * Currently active material swatch ID.
     * @example "wall-white"
     */
    readonly activeMaterialId: string;
    /** Optional array of available material swatches. */
    readonly materials?: readonly MaterialSwatchOption[];
    /**
     * Callback when a material is chosen.
     * @example (id) => console.log(id)
     */
    readonly onSelectMaterial: (id: string) => void;
    /** Optional custom CSS class name. */
    readonly className?: string;
}
/**
 * Material Swatch Palette Grid molecule for block and surface styling.
 *
 * @layer molecule
 * @status stable
 */
export declare function MaterialSwatchGrid(props: MaterialSwatchGridProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Option item for Category Dock pill buttons. */
export interface CategoryDockOption {
    /**
     * Unique category identifier.
     * @example "walls"
     */
    readonly id: string;
    /**
     * Category display name.
     * @example "Paredes"
     */
    readonly label: string;
    /** Optional icon node. */
    readonly icon?: ReactNode;
}
/** Default category options for the studio bottom dock. */
export declare const DEFAULT_STUDIO_CATEGORIES: readonly CategoryDockOption[];
/** Public inputs for Category Dock organism. */
export interface CategoryDockProps {
    /**
     * Currently active category ID.
     * @example "walls"
     */
    readonly activeCategoryId: string;
    /** Optional array of available categories. */
    readonly categories?: readonly CategoryDockOption[];
    /**
     * Callback when a category pill is selected.
     * @example (id) => console.log(id)
     */
    readonly onSelectCategory: (id: string) => void;
    /** Optional sub-palette content rendered floating above the dock. */
    readonly subPalette?: ReactNode;
    /** Optional custom class name. */
    readonly className?: string;
}
/**
 * Bottom Category Dock organism for Level Design Studio (Concept B).
 *
 * @layer organism
 * @status stable
 */
export declare function CategoryDock(props: CategoryDockProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Public inputs for Studio Property Inspector organism. */
export interface StudioPropertyInspectorProps {
    /**
     * Header title for the property inspector panel.
     * @example "Nó n_01 [X: 2.0, Y: 3.5]"
     */
    readonly title: string;
    /** Optional subtitle or status badge text. */
    readonly subtitle?: string;
    /** Optional floor level slicer element. */
    readonly floorSlicer?: ReactNode;
    /** Optional material swatch grid element. */
    readonly materialPalette?: ReactNode;
    /** Additional inspection cards or children. */
    readonly children?: ReactNode;
    /** Optional custom class name. */
    readonly className?: string;
}
/**
 * Studio Property Inspector organism combining node properties, floor height slicer, and materials.
 *
 * @layer organism
 * @status stable
 */
export declare function StudioPropertyInspector(props: StudioPropertyInspectorProps): ReactElement;
```
