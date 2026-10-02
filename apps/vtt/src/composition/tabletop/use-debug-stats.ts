import { useEffect, useState } from "react";

import { recentCommits, type CommitRecord } from "./commit-timing.ts";
import { countMap, createFrameMeter, type FrameStats, type MapCounts } from "./debug-stats.ts";
import type { TabletopRuntime } from "./tabletop-runtime.ts";

/** How often the map is counted and the memory read, in milliseconds. */
const SAMPLE_MS = 1000;

/** Everything the debug panel shows, gathered. */
export interface DebugStats {
  /** The last full window of frames; absent until one has passed. */
  readonly frame?: FrameStats;
  /** What the map is made of; absent until the table is live. */
  readonly counts?: MapCounts;
  /** How long reading those counts took, in milliseconds: what looking at the map costs. */
  readonly readMs?: number;
  /** Bytes of JavaScript heap in use, where the browser says. */
  readonly heapBytes?: number;
  /** The most recent finished commits, oldest first. */
  readonly commits: readonly CommitRecord[];
}

/** The heap, where the browser reports it (Chromium does, behind a non-standard field). */
function heapBytes(): number | undefined {
  const memory = (performance as unknown as { readonly memory?: { readonly usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize;
}

/**
 * Gathers the debug panel's numbers. Frames are timed on the page's own
 * animation frame, so a stutter from anywhere shows; the map is counted once
 * a second and only when it, or a commit, has changed -- looking at the map
 * is a read of the graph and must not become a cost of its own.
 */
export function useDebugStats(runtime: TabletopRuntime, enabled: boolean): DebugStats {
  const [frame, setFrame] = useState<FrameStats | undefined>(undefined);
  const [sample, setSample] = useState<Omit<DebugStats, "frame">>({ commits: [] });

  useEffect(() => {
    if (!enabled) return;
    const meter = createFrameMeter();
    let handle = 0;
    const tick = (now: number) => {
      const stats = meter(now);
      if (stats) setFrame(stats);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let seen = "";
    const read = () => {
      const commits = recentCommits();
      const snapshot = runtime.getSnapshot();
      const last = commits.at(-1);
      const key = `${snapshot.status}:${snapshot.map.revision}:${commits.length}:${last?.ms ?? 0}`;
      if (key === seen) return;
      seen = key;
      if (snapshot.status !== "ready") {
        setSample({ commits, heapBytes: heapBytes() });
        return;
      }
      const started = performance.now();
      const counts = countMap(runtime.getGraphSnapshot(), runtime.getAllRegionTopologies());
      setSample({ commits, counts, readMs: performance.now() - started, heapBytes: heapBytes() });
    };
    read();
    const timer = setInterval(read, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [runtime, enabled]);

  return { ...sample, ...(frame ? { frame } : {}) };
}
