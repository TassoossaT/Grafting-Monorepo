# GM-Facing Construction and Building UI in Virtual Tabletops and 3D World-Building Tools

This document analyzes Game Master (GM) construction, map-editing, and world-building user interfaces across major 2D Virtual Tabletops (Foundry VTT, Owlbear Rodeo v2, Roll20, Fantasy Grounds Unity) and 3D free-camera building tools (Townscaper, Tiny Glade). It breaks down toolbar organization, layering models, camera navigation conventions, selection and property inspectors, GM vs. player view separation, 3D camera pivot behaviors, and recurring design patterns across tools.

## 2D Virtual Tabletops: Toolbars, Categories, and Flyouts

* **Foundry VTT**:
  * **Tool Structure & Layout**: Uses a primary vertical toolbar anchored to the top-left edge of the screen, categorized by functional canvas layers (Select, Tiles, Drawings, Walls, Lighting, Ambient Sound, Measured Templates, Journal Notes).
  * **Sub-Tool Flyouts**: Selecting a main category tool extends a secondary vertical toolbar (flyout palette) to the right. For example, selecting the **Wall Controls** category opens sub-tools for specific wall types (Normal, Terrain, Invisible, Etheric, Doors, Secret Doors, Snap-to-Grid toggles).
  * **Global Sidebars**: Document management (Actors, Items, Scenes, Journals) sits in a collapsible right-hand sidebar tab strip, keeping construction tools cleanly separated from narrative assets.

* **Owlbear Rodeo v2**:
  * **Tool Structure & Layout**: Features a minimalist, bottom-centered horizontal action dock (Toolbar) housing primary tools: Select, Pan, Draw, Measure, Fog of War, Text, Laser Pointer, and Attachment tools.
  * **Flyouts & Fold Menus**: Employs expandable flyout menus ("fold" popups) directly above active toolbar icons to configure brush width, colors, shape types, or fog reveal modes without obscuring the canvas.
  * **Extension Architecture**: Complex building utilities (e.g., custom asset lists or advanced layering) are modularly loaded as floating popovers via an Extensions dock item.

* **Roll20**:
  * **Tool Structure & Layout**: Utilizes a left-hand vertical toolbar with stacked tool icons (Select/Pan, Layers, Drawing/Text tools, FX, Fog of War/Lighting, Measurement, Turn Tracker).
  * **Flyout Menus**: Clicking an icon with a small corner indicator opens a horizontal flyout popout menu to switch tool modes (e.g., switching between Freehand, Polygon, Rectangle, and Circle drawing tools).
  * **Layer-Specific Controls**: Certain tools (like Fog of War or Dynamic Lighting stroke tools) only appear or activate when their respective operational mode is selected.

* **Fantasy Grounds Unity (FGU)**:
  * **Tool Structure & Layout**: Integrates map construction into an Image Window HUD header bar and a comprehensive right-hand **Image Data Panel / Layer Stack**.
  * **Mode Selection & Palettes**: The GM unlocks the map window to access mode tabs: Image, Painting, Tile, Line of Sight (LoS), Lighting, FX/Shaders, Text, and Token. Selecting a mode tab populates the sub-panel with specialized palettes (e.g., Tile Asset Browser, LoS wall/door/terrain tools, FX shader selectors).

## Layer Architecture: Visual Stack vs. Selection Isolation

* **Foundry VTT**:
  * **Canvas Layers**: Manages discrete layers including Background, Tiles, Drawings, Tokens/Actors, Walls, Lighting, Ambient Sounds, and Notes.
  * **Visibility & Permissions**: Walls, lighting source parameters, hidden notes, and unrevealed tokens are strictly GM-only. Canvas items render in standard visual z-order (Background < Tiles < Drawings < Tokens < Lighting/Fog).
  * **Input-Targeting Isolation**: Layer selection acts as a strict input mask. When the Wall tool is active, the GM can only hover, select, or edit wall nodes; tokens and tiles cannot be accidentally clicked or moved.

* **Owlbear Rodeo v2**:
  * **Canvas Layers**: Native categories include Map, Grid, Drawing, Text, Token, Attachment, and Fog.
  * **Z-Index & Attachment**: Relies on a simplified visual stacking order combined with an explicit **Attachment System** (child objects parented to parent tokens/maps follow parent transforms).
  * **Outliner Extension**: Detailed depth reordering, asset locking, and visibility toggling (GM-only vs. Player) are managed via the Outliner extension panel. Input selection targets un-locked assets across types unless filtered.

* **Roll20**:
  * **Layer Types**: Divided into Map & Background, Objects & Tokens, GM Info Overlay, Foreground (Plus/Pro tier), and Dynamic Lighting (Plus/Pro tier).
  * **Input Isolation & Selection Locking**: High-isolation model. Activating the "Map & Background" layer greys out tokens and locks them from input selection. Switch to "Objects & Tokens" to interact with character pieces without disturbing the background map.
  * **GM-Only Privacy**: The GM Info Overlay is strictly opaque to players; items on this layer can be instantly moved to the Token or Map layer via context menu or keyboard shortcuts (`Ctrl+Shift+K`, `Ctrl+Shift+O`, `Ctrl+Shift+M`).

* **Fantasy Grounds Unity**:
  * **Layer Architecture**: Supports arbitrary nested graphic layers, paint layers, tile layers, LoS vector layers, lighting layers, and shader FX layers stacked in the right-hand panel.
  * **Layer Stacking & Masking**: Each layer's visual z-order matches its list order in the stack. Layers can be toggled between "Visible to All" and "GM Only" (e.g., secret door lines or DM map annotations).
  * **Targeting Isolation**: Clicking a specific layer in the layer stack targets painting, tile placement, or transformation strictly to that target layer, avoiding unintended edits to surrounding map assets.

## Navigation, Selection, and Property Inspectors

* **Viewport Navigation Conventions**:
  * **Foundry VTT**: Pan via Right-Click + Drag or WASD/Arrow keys; Zoom via Mouse Wheel (cursor-centered).
  * **Owlbear Rodeo v2**: Pan via Middle-Click Drag, Right-Click Drag, or Spacebar + Left-Click Drag; Zoom via Mouse Wheel toward cursor.
  * **Roll20**: Pan via Right-Click Drag, Middle-Click Drag, or Pan tool; Zoom via Alt + Mouse Wheel or toolbar zoom slider.
  * **Fantasy Grounds Unity**: Pan via Arrow keys / Ctrl + Arrow keys (grid steps) or drag with Pan tool; Zoom via Mouse Wheel.

* **Selection & Property Inspector Patterns**:
  * **Foundry VTT**:
    * **Selection**: Left-Click selects single object; Shift + Left-Click adds to selection box or multi-selects.
    * **Contextual HUD**: Right-Clicking a token opens an immediate radial/on-canvas Token HUD (quick stats, status icons, elevation, target lock, gear icon).
    * **Full Inspector**: Double-Clicking (or double right-clicking) an asset opens a comprehensive modal Configuration Sheet (Token Settings, Tile Properties, Wall Configuration).
  * **Owlbear Rodeo v2**:
    * **Selection**: Left-Click selects; Marquee rectangular or Lasso selection for multi-item picking.
    * **Action Dock / Ring**: Selecting an item attaches a contextual Action Ring directly around the bounding box (transform handles, rotation knob, lock toggle, duplicate, attachment toggle, layer depth controls).
    * **Locked Objects**: Locked items ignore standard single-clicks and require explicit double-clicks or Outliner interactions to edit.
  * **Roll20**:
    * **Selection**: Left-Click selects; drag marquee selects multiple tokens.
    * **Radial Menu & Bubbles**: Single-clicking a token spawns 3 status bubbles (HP/AC values), marker overlay wheel, and quick gear icon.
    * **Modal Inspector**: Double-clicking a token opens the Token Settings modal dialog (vision, light emitting, bar links). Shift + Double-Click opens Character Bio; Alt + Double-Click opens full Character Sheet.
  * **Fantasy Grounds Unity**:
    * **Selection & Transform**: Selecting a tile or paint layer activates bounding-box gizmos directly on the map canvas for scale, rotation, and offset.
    * **Image Data Inspector**: Properties for selected layers (opacity/alpha, tint color, grid snapping, blend mode) render in the right-side Image Data panel. Double-clicking tokens/cards opens associated character sheets.

## GM Edit Mode vs. Player View Separation

* **Foundry VTT**:
  * **In-Place GM Canvas**: GMs edit the canvas in real time while viewing all invisible walls, secret doors, hidden tiles, and notes overlaid with visual cues.
  * **Vision Preview**: Selecting a specific player token isolates vision to that token's line-of-sight and fog-of-war (while keeping wall geometries visible to GM).
  * **Full Separation**: For strict player view verification, GMs open a second browser window logged in with a Player user account, or use community display modules (*Monk's Common Display*).

* **Owlbear Rodeo v2**:
  * **Shared Room Canvas**: All users share the same viewport workspace; GM edits assets live.
  * **View Synchronization**: Features **Sync View** and **Lock View** (bullseye button) to lock all connected players' viewports to the GM's exact camera framing (ideal for TV/projector setups).
  * **Casting & Player Verification**: Offers a native **Cast Window** mode for secondary presentation screens, or GMs revoke GM rights temporarily to test player visibility.

* **Roll20**:
  * **In-Place Edit Workspace**: GM sees hidden layer content (GM Info Overlay, Dynamic Lighting barrier lines) rendered at partial opacity on the active canvas.
  * **Player Vision Toggle**: Pressing `Ctrl+L` with a token selected previews that token's point-of-view and dynamic lighting constraints.
  * **Rejoin as Player**: GM can click "Rejoin as Player" in settings to toggle the entire UI into player mode, or launch a second browser session for local table projection.

* **Fantasy Grounds Unity**:
  * **Lock/Unlock Edit Mode**: Map editing tools, layer stacks, and LoS controls are only exposed when the GM toggles the image window to "Unlocked".
  * **Player Vision Preview**: Built-in map toolbar button toggles "Player Vision Preview" mode on/off instantly to verify dynamic lighting, shadow casting, and hidden layer concealment.
  * **Dual-Instance Play**: Standard convention for local/hybrid tables is running a second instance of FGU connected to `localhost` as a player on a secondary monitor.

## 3D Free-Camera Building Tools: Townscaper and Tiny Glade

* **Townscaper**:
  * **Camera Control Scheme**:
    * **Orbit / Rotate**: Left Mouse Button (LMB) click-drag orbits the camera around the central build focus.
    * **Pan**: Right Mouse Button (RMB) click-drag pans the camera laterally.
    * **Zoom**: Scroll Wheel zooms in/out toward the central focal area. Keyboard controls (WASD, Q/E, Arrow keys) provide translation adjustments.
    * *Note on Construction Inputs*: Single LMB click places a building block; single RMB click removes a block.
  * **Pivot-Point Behavior**: Uses a fixed screen-centered / grid focal pivot point. Camera rotation always orbits around the center of the constructed town grid or active focal cluster.
  * **Build Mode vs. Photo Mode Split**: Seamless single camera model. Building and inspection happen in the same camera space. Players hide the minimal UI to frame screenshots, using extreme zoom to inspect street-level details.

* **Tiny Glade**:
  * **Camera Control Scheme**:
    * **Orbit / Rotate**: Right Mouse Button (RMB) click-drag rotates/orbits the camera.
    * **Pan**: Middle Mouse Button (MMB) click-drag or Arrow keys pan horizontally.
    * **Zoom**: Scroll Wheel zooms in/out.
    * **Vertical Translation**: `E` key moves camera up; `Q` key moves camera down.
  * **Pivot-Point Behavior**: Highly customizable in **Settings ➡ Controls ➡ Camera**:
    * **Cursor Point (Default)**: Camera rotates and zooms directly around the 3D surface point currently under the mouse cursor, allowing precision framing of specific walls/roofs.
    * **Center Point / Region**: Switchable option to orbit around the screen center, preventing jumpy camera movements on complex geometry.
  * **Build Mode vs. Photo Mode Split**:
    * **Build Mode**: Active building gizmos, procedural tools, and UI overlays are visible while navigating.
    * **Photo Mode**: Explicit mode entered via `P` key or camera icon. Hides build tools and unlocks advanced photographic controls: time-of-day slider (`T`), depth-of-field, lighting controls, and a dedicated **Walking Camera** mode (first-person ground-level exploration view inside the glade).

## Patterns Recurring Across 3+ Tools

1. **Input-Targeting Isolation by Active Layer / Mode**:
   * *Observed in*: Foundry VTT, Roll20, Fantasy Grounds Unity.
   * *Pattern*: Selecting a specific layer or build tool (e.g., Walls, Map Background, Tiles) restricts canvas mouse interactions exclusively to objects of that type, preventing accidental selection or movement of underlying graphics or tokens.

2. **Two-Tier Property Inspection (Contextual Action Dock + Modal Configuration)**:
   * *Observed in*: Foundry VTT, Owlbear Rodeo v2, Roll20.
   * *Pattern*: Selecting an asset reveals an immediate, low-friction contextual overlay (HUD ring, radial bubble menu, or bounding action dock) for common tasks (health, rotation, lock). Deep customization (light emission, token vision, script hooks) is delegated to a double-click modal property sheet.

3. **Cursor-Centered Viewport Zooming**:
   * *Observed in*: Foundry VTT, Owlbear Rodeo v2, Tiny Glade, Townscaper.
   * *Pattern*: Scroll-wheel zoom vectors are calculated using the user's cursor position as the focal target rather than the screen center, enabling rapid navigation to specific detail areas without manual re-centering.

4. **In-Place GM Editing with Token-Based Vision Previews**:
   * *Observed in*: Foundry VTT, Roll20, Fantasy Grounds Unity.
   * *Pattern*: GMs construct maps on the live canvas with full visibility of hidden items and vision barriers, using a dedicated shortcut (`Ctrl+L` in Roll20, token selection in Foundry, Vision Preview in FGU) to temporarily evaluate player sightlines without switching user roles.

5. **Direct Bounding-Box Gizmo Manipulation for Tile/Asset Construction**:
   * *Observed in*: Owlbear Rodeo v2, Fantasy Grounds Unity, Foundry VTT.
   * *Pattern*: When placed on the map, tiles and visual props display bounding box handles directly on the canvas for scaling, rotation, and alignment, combining spatial editing with structured layer management.

6. **Dedicated Presentation / Photo Mode Split**:
   * *Observed in*: Tiny Glade, Owlbear Rodeo v2 (Cast View), Fantasy Grounds Unity (Vision Preview / Dual Instance).
   * *Pattern*: Building tools maintain a distinct operational mode for construction (editing controls, node handles, grid snapping) and presentation (clean UI removal, camera lock, lighting customization, or ground-level perspective view).

## Sources

* Foundry VTT Game Controls & Layout Documentation: https://foundryvtt.com/article/controls/
* Foundry VTT Canvas Architecture Documentation: https://foundryvtt.com/article/canvas/
* Foundry VTT Token Configuration Documentation: https://foundryvtt.com/article/tokens/
* Foundry VTT Community Wiki: https://foundryvtt.wiki/
* Owlbear Rodeo v2 Application & User Guide: https://owlbear.rodeo/
* Owlbear Rodeo Developer Blog: https://blog.owlbear.rodeo/
* Roll20 Layer System & Tool Guide: https://help.roll20.net/
* Roll20 Main Platform Overview: https://roll20.net/
* Fantasy Grounds Unity User Guides & Image Workspace Wiki: https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/overview
* Fantasy Grounds Official Site: https://fantasygrounds.com/
* Townscaper on Steam: https://store.steampowered.com/app/1291340/Townscaper/
* Tiny Glade on Steam: https://store.steampowered.com/app/2198150/Tiny_Glade/
