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
    void runtime.start();
    return () => void runtime.dispose();
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

      <section className="tabletop-stage" aria-label="Tabletop viewport placeholder">
        <p>The composition boundary is active.</p>
        <small>Rendering and session adapters enter in later slices.</small>
      </section>
    </main>
  );
}
