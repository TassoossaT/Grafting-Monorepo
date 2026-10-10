import { useEffect, useState } from "react";

import { recentCommits, type CommitRecord } from "./commit-timing.ts";
import { countMap, createFrameMeter, diffMaps, EMPTY_FINGERPRINT, fingerprintMap, isNoChange, nameCommits, type FrameStats, type MapChange, type MapCounts, type MapFingerprint } from "./debug-stats.ts";
import type { TabletopRuntime } from "./tabletop-runtime.ts";

/** How often the memory is read and unseen commits looked for, in milliseconds. */
const SAMPLE_MS = 1000;
/** How long after the map says it changed it is read: a burst of changes, like a drag, is read once at its end. */
const SETTLE_MS = 150;
/** How many changes the panel keeps. */
export const RECENT_CHANGES = 8;

/** One change of the map, with the commits that made it and what it did. */
export interface ChangeRecord {
  /** Counts up with every record: a stroke the engine refused is timed but leaves the revision where it was, so the revision names no record alone. */
  readonly id: number;
  /** The map's revision once the change was read. */
  readonly revision: number;
  /** What made it, in one line: the commits' labels, or what happened when no timed commit did, as when the map loads. */
  readonly label: string;
  /** The commits' time together, in milliseconds; absent when no timed commit made it. */
  readonly ms?: number;
  /** The slowest phase of any of those commits. */
  readonly slowest?: { readonly label: string; readonly ms: number };
  /** The commits that made it, oldest first. */
  readonly commits: readonly CommitRecord[];
  /** What it added, removed and changed. */
  readonly change: MapChange;
  /** What the map was made of afterwards, to read the totals the change led to. */
  readonly counts: MapCounts;
  /** How long telling the change apart took, in milliseconds. */
  readonly diffMs: number;
}

/** Everything the debug panel shows, gathered. */
export interface DebugStats {
  /** The last full window of frames; absent until one has passed. */
  readonly frame?: FrameStats;
  /** What the map is made of; absent until the table is live. */
  readonly counts?: MapCounts;
  /** How long reading the map took, in milliseconds: what looking at the map costs. */
  readonly readMs?: number;
  /** Bytes of JavaScript heap in use, where the browser says. */
  readonly heapBytes?: number;
  /** The most recent changes, oldest first. */
  readonly changes: readonly ChangeRecord[];
}

/** The heap, where the browser reports it (Chromium does, behind a non-standard field). */
function heapBytes(): number | undefined {
  const memory = (performance as unknown as { readonly memory?: { readonly usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize;
}

/** The slowest phase across commits, as a spread: nothing when none ran a timed phase. */
function slowestOf(commits: readonly CommitRecord[]): { readonly slowest?: { readonly label: string; readonly ms: number } } {
  let slowest: { readonly label: string; readonly ms: number } | undefined;
  for (const commit of commits) if (commit.slowest && (slowest === undefined || commit.slowest.ms > slowest.ms)) slowest = commit.slowest;
  return slowest ? { slowest } : {};
}

/**
 * Gathers the debug panel's numbers. Frames are timed on the page's own
 * animation frame, so a stutter from anywhere shows. The map is read only
 * after it says it changed, once the burst settles, and compared with the
 * previous read element by element -- looking at the map is a read of the
 * graph and must not become a cost of its own.
 */
export function useDebugStats(runtime: TabletopRuntime, enabled: boolean): DebugStats {
  const [frame, setFrame] = useState<FrameStats | undefined>(undefined);
  const [heap, setHeap] = useState<number | undefined>(undefined);
  const [map, setMap] = useState<Pick<DebugStats, "counts" | "readMs" | "changes">>({ changes: [] });

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
    let previous: MapFingerprint = EMPTY_FINGERPRINT;
    let seenRevision: number | undefined;
    let seenSeq = 0;
    let recorded = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = () => {
      timer = undefined;
      const snapshot = runtime.getSnapshot();
      if (snapshot.status !== "ready") return;
      const commits = recentCommits().filter((commit) => commit.seq > seenSeq);
      const moved = snapshot.map.revision !== seenRevision;
      if (!moved && commits.length === 0) return;
      seenSeq = commits.at(-1)?.seq ?? seenSeq;
      seenRevision = snapshot.map.revision;

      const started = performance.now();
      const graph = runtime.getGraphSnapshot();
      const faces = runtime.getAllRegionTopologies();
      const counts = countMap(graph, faces);
      const readMs = performance.now() - started;

      const diffStarted = performance.now();
      const print = fingerprintMap(graph, faces);
      const change = diffMaps(previous, print);
      const diffMs = performance.now() - diffStarted;
      const first = previous === EMPTY_FINGERPRINT;
      previous = print;

      const record: ChangeRecord = {
        id: ++recorded,
        revision: snapshot.map.revision,
        label: commits.length > 0 ? nameCommits(commits.map((commit) => commit.label)) : first ? "mapa carregado" : "sem operação cronometrada",
        ...(commits.length > 0 ? { ms: commits.reduce((sum, commit) => sum + commit.ms, 0) } : {}),
        ...slowestOf(commits),
        commits,
        change,
        counts,
        diffMs,
      };
      setMap((state) => ({
        counts,
        readMs,
        changes: isNoChange(change) && commits.length === 0 ? state.changes : [...state.changes, record].slice(-RECENT_CHANGES),
      }));
    };
    const schedule = () => {
      if (timer === undefined) timer = setTimeout(read, SETTLE_MS);
    };

    schedule();
    const unsubscribe = runtime.subscribe(schedule);
    // A commit that left the map's revision alone still shows, at the next sample.
    const sampler = setInterval(() => {
      setHeap(heapBytes());
      schedule();
    }, SAMPLE_MS);
    return () => {
      unsubscribe();
      clearInterval(sampler);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [runtime, enabled]);

  return { ...map, ...(heap !== undefined ? { heapBytes: heap } : {}), ...(frame ? { frame } : {}) };
}
