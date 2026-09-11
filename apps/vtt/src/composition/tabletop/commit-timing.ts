/**
 * Where one commit's time went, phase by phase.
 *
 * A road commit crosses the planner, the engine, the render fold, and a
 * terrain repair that itself generates, adopts and registers -- and it is only
 * sometimes slow. A profiler run rarely catches the slow one; this is always on
 * and costs a clock read per phase, and it prints only a commit that took
 * longer than {@link SLOW_COMMIT_MS}, as one line per phase, nested the way the
 * phases ran. Counters name events that are cheap once and expensive when they
 * repeat, like a split batch the engine refused and that was replayed node by
 * node.
 *
 * Phases opened outside any commit run untimed: the helpers are safe to leave
 * in code a test or another tool calls directly.
 */

const SLOW_COMMIT_MS = 80;

interface Phase {
  readonly label: string;
  readonly depth: number;
  ms: number;
}

interface Trace {
  readonly phases: Phase[];
  depth: number;
  readonly counters: Map<string, number>;
}

let current: Trace | undefined;

/**
 * Times `run` as a whole commit, or as a phase of the commit already running.
 * Either way it returns what `run` returns, and rethrows what it throws.
 */
export function timeCommit<T>(label: string, run: () => T): T {
  if (current !== undefined) return timePhase(label, run);
  const trace: Trace = { phases: [], depth: 0, counters: new Map() };
  current = trace;
  const started = performance.now();
  try {
    return run();
  } finally {
    current = undefined;
    const total = performance.now() - started;
    if (total >= SLOW_COMMIT_MS) report(label, total, trace);
  }
}

/** Times `run` as a phase of the running commit; untimed outside one. */
export function timePhase<T>(label: string, run: () => T): T {
  const trace = current;
  if (trace === undefined) return run();
  const phase: Phase = { label, depth: trace.depth, ms: 0 };
  trace.phases.push(phase);
  trace.depth += 1;
  const started = performance.now();
  try {
    return run();
  } finally {
    phase.ms = performance.now() - started;
    trace.depth = phase.depth;
  }
}

/** Adds to a named counter of the running commit; nothing outside one. */
export function countInCommit(label: string, by = 1): void {
  if (current === undefined) return;
  current.counters.set(label, (current.counters.get(label) ?? 0) + by);
}

function report(label: string, total: number, trace: Trace): void {
  const lines = trace.phases.map((phase) => `${"  ".repeat(phase.depth + 1)}${phase.label}: ${phase.ms.toFixed(1)} ms`);
  const counters = [...trace.counters].map(([name, value]) => `  ${name}: ${value}`);
  console.warn([`[tempo] ${label}: ${total.toFixed(1)} ms`, ...lines, ...counters].join("\n"));
}
