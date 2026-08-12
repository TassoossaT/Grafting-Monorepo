"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  createTabletopRuntime,
  type TabletopRuntime,
} from "@/composition/tabletop";

export interface TabletopEntryProps {
  readonly tableId: string;
}

export function TabletopEntry({ tableId }: TabletopEntryProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<TabletopRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createTabletopRuntime({ tableId });
  }

  const runtime = runtimeRef.current;
  const current = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useEffect(() => {
    let active = true;
    let viewId: string | undefined;
    void runtime.start().then(() => {
      if (!active || viewportRef.current === null) return;
      viewId = runtime.attachView(viewportRef.current);
    });
    return () => {
      active = false;
      if (viewId !== undefined) runtime.detachView(viewId);
      void runtime.dispose();
    };
  }, [runtime]);

  return (
    <main className="tabletop-shell">
      <header className="tabletop-header">
        <div>
          <p className="eyebrow">Open table</p>
          <h1>{current.tableId}</h1>
        </div>
        <span className={`runtime-status runtime-status--${current.status}`} aria-live="polite">
          Runtime: {current.status}
        </span>
      </header>

      <section className="tabletop-stage" aria-label="3D tabletop viewport">
        <div className="tabletop-viewport" ref={viewportRef} />
        <div className="tabletop-stage__caption">
          <strong>{current.tokens.byId.size} token</strong>
          <span>Billboard 2.5D em um mundo 3D</span>
        </div>
      </section>
    </main>
  );
}
