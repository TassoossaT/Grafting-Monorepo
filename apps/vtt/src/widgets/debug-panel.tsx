"use client";

import { useState } from "react";

/** The panel's numbers, as plain values: this widget draws them and knows nothing of where they come from. */
export interface DebugPanelStats {
  readonly frame?: { readonly fps: number; readonly meanMs: number; readonly worstMs: number };
  readonly counts?: {
    readonly vertices: number;
    readonly edges: number;
    readonly sharedEdges: number;
    readonly faces: number;
    readonly byType: readonly { readonly type: string; readonly count: number }[];
  };
  readonly readMs?: number;
  readonly heapBytes?: number;
  readonly commits: readonly { readonly label: string; readonly ms: number; readonly slowest?: { readonly label: string; readonly ms: number } }[];
}

export interface DebugPanelProps {
  readonly stats: DebugPanelStats;
  /** Whether the dots on the graph's vertices are drawn. */
  readonly graphOverlay: boolean;
  readonly onGraphOverlayChange: (visible: boolean) => void;
  /** Whether the lines along the edges, by role, are drawn. */
  readonly edgeOverlay: boolean;
  readonly onEdgeOverlayChange: (visible: boolean) => void;
}

/** How many face types are listed before the rest are folded away. */
const TYPES_SHOWN = 6;
/** Frame rates at which the indicator turns yellow, then red. */
const FPS_OK = 50;
const FPS_SLOW = 30;
/** Commit times, in ms, at which a commit reads as slow, then very slow. */
const COMMIT_SLOW_MS = 80;
const COMMIT_VERY_SLOW_MS = 250;

const MEGABYTE = 1024 * 1024;

function fpsColor(fps: number): string {
  if (fps >= FPS_OK) return "#34d399";
  if (fps >= FPS_SLOW) return "#facc15";
  return "#f87171";
}

function commitColor(ms: number): string {
  if (ms >= COMMIT_VERY_SLOW_MS) return "#f87171";
  if (ms >= COMMIT_SLOW_MS) return "#facc15";
  return "#34d399";
}

function Row(props: { readonly label: string; readonly value: string; readonly color?: string }) {
  return (
    <div className="gm-stat-row">
      <span>{props.label}</span>
      <span className="gm-stat-value" style={props.color ? { color: props.color } : undefined}>{props.value}</span>
    </div>
  );
}

/**
 * The always-visible developer panel: frame rate, what the map is made of,
 * what the last commits cost, and the switches that draw the topology. It
 * floats over the map and folds to its title bar.
 */
export function DebugPanel(props: DebugPanelProps) {
  const [open, setOpen] = useState(true);
  const { stats } = props;
  const lines = stats.counts?.byType ?? [];

  return (
    <aside className="gm-debug-panel" aria-label="Painel de depuração">
      <button type="button" className="gm-debug-panel-title" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Debug</span>
        {stats.frame ? <span style={{ color: fpsColor(stats.frame.fps) }}>{Math.round(stats.frame.fps)} fps</span> : <span>…</span>}
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="gm-debug-panel-body">
          <section>
            <span className="gm-debug-panel-heading">Desempenho</span>
            {stats.frame ? (
              <>
                <Row label="FPS" value={stats.frame.fps.toFixed(0)} color={fpsColor(stats.frame.fps)} />
                <Row label="Quadro (média)" value={`${stats.frame.meanMs.toFixed(1)} ms`} />
                <Row label="Pior quadro" value={`${stats.frame.worstMs.toFixed(1)} ms`} />
              </>
            ) : (
              <Row label="FPS" value="medindo…" />
            )}
            {stats.heapBytes !== undefined ? <Row label="Memória (JS)" value={`${(stats.heapBytes / MEGABYTE).toFixed(1)} MB`} /> : null}
          </section>

          <section>
            <span className="gm-debug-panel-heading">Mapa</span>
            {stats.counts ? (
              <>
                <Row label="Vértices" value={String(stats.counts.vertices)} />
                <Row label="Arestas" value={String(stats.counts.edges)} />
                <Row label="· compartilhadas (2+ faces)" value={String(stats.counts.sharedEdges)} />
                <Row label="Faces" value={String(stats.counts.faces)} />
                {lines.slice(0, TYPES_SHOWN).map((line) => <Row key={line.type} label={`· ${line.type}`} value={String(line.count)} />)}
                {lines.length > TYPES_SHOWN ? <Row label="· outros tipos" value={String(lines.slice(TYPES_SHOWN).reduce((sum, line) => sum + line.count, 0))} /> : null}
                {stats.readMs !== undefined ? <Row label="Leitura do grafo" value={`${stats.readMs.toFixed(1)} ms`} /> : null}
              </>
            ) : (
              <Row label="Mapa" value="carregando…" />
            )}
          </section>

          <section>
            <span className="gm-debug-panel-heading">Últimas operações</span>
            {stats.commits.length === 0 ? <Row label="Nenhuma ainda" value="" /> : null}
            {[...stats.commits].reverse().map((commit, index) => (
              <Row
                key={`${commit.label}:${index}`}
                label={commit.slowest ? `${commit.label} (${commit.slowest.label} ${commit.slowest.ms.toFixed(0)})` : commit.label}
                value={`${commit.ms.toFixed(0)} ms`}
                color={commitColor(commit.ms)}
              />
            ))}
          </section>

          <section>
            <span className="gm-debug-panel-heading">Topologia (só visualização)</span>
            <label className="gm-debug-panel-check">
              <input type="checkbox" checked={props.graphOverlay} onChange={(event) => props.onGraphOverlayChange(event.target.checked)} />
              <span>Pontos dos vértices</span>
            </label>
            <label className="gm-debug-panel-check">
              <input type="checkbox" checked={props.edgeOverlay} onChange={(event) => props.onEdgeOverlayChange(event.target.checked)} />
              <span>Linhas das arestas, por papel</span>
            </label>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
