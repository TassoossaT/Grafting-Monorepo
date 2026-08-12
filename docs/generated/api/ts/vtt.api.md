# vtt

### `reference vtt.tabletop.createTabletopRuntime`

### `reference vtt.tabletop.CreateTabletopRuntimeInput`

### `reference vtt.tabletop.TabletopRuntime`

### `reference vtt.tabletop.TabletopRuntimeListener`

### `reference vtt.tabletop.TabletopRuntimeStatus`

### `reference vtt.tabletop.TabletopSnapshot`

### `interface vtt.create-tabletop-runtime.CreateTabletopRuntimeInput`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.tableId: string`

### `function vtt.create-tabletop-runtime.createTabletopRuntime(input: CreateTabletopRuntimeInput): TabletopRuntime`

### `class vtt.tabletop-runtime.AppTabletopRuntime`

### `constructor vtt.tabletop-runtime.AppTabletopRuntime.constructor(tableId: string): AppTabletopRuntime`

### `method vtt.tabletop-runtime.AppTabletopRuntime.dispose(): Promise<void>`

### `method vtt.tabletop-runtime.AppTabletopRuntime.getSnapshot(): TabletopSnapshot`

### `method vtt.tabletop-runtime.AppTabletopRuntime.start(): Promise<void>`

### `method vtt.tabletop-runtime.AppTabletopRuntime.subscribe(listener: TabletopRuntimeListener): () => void`

### `interface vtt.tabletop-runtime.TabletopRuntime`

### `method vtt.tabletop-runtime.TabletopRuntime.dispose(): Promise<void>`

### `method vtt.tabletop-runtime.TabletopRuntime.getSnapshot(): TabletopSnapshot`

### `method vtt.tabletop-runtime.TabletopRuntime.start(): Promise<void>`

### `method vtt.tabletop-runtime.TabletopRuntime.subscribe(listener: TabletopRuntimeListener): () => void`

### `interface vtt.tabletop-runtime.TabletopSnapshot`

### `property vtt.tabletop-runtime.TabletopSnapshot.revision: number`

### `property vtt.tabletop-runtime.TabletopSnapshot.status: TabletopRuntimeStatus`

### `property vtt.tabletop-runtime.TabletopSnapshot.tableId: string`

### `type vtt.tabletop-runtime.TabletopRuntimeListener = () => void`

### `type vtt.tabletop-runtime.TabletopRuntimeStatus = "idle" | "starting" | "ready" | "disposed"`
