"use client";

import { useState } from "react";

interface PanelCounts {
  readonly vertices: number;
  readonly edges: number;
  readonly sharedEdges: number;
  readonly faces: number;
  readonly byType: readonly { readonly type: string; readonly count: number }[];
}

interface PanelElementChange {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
}

/** One change of the map, as the panel draws it. */
export interface DebugPanelChange {
  readonly revision: number;
  readonly label: string;
  readonly ms?: number;
  readonly slowest?: { readonly label: string; readonly ms: number };
  readonly change: {
    readonly vertices: PanelElementChange;
    readonly edges: PanelElementChange;
    readonly faces: PanelElementChange;
    readonly facesByType: readonly (PanelElementChange & { readonly type: string })[];
  };
  readonly counts: PanelCounts;
  readonly diffMs: number;
}

/** The panel's numbers, as plain values: this widget draws them and knows nothing of where they come from. */
export interface DebugPanelStats {
  readonly frame?: { readonly fps: number; readonly meanMs: number; readonly worstMs: number };
  readonly counts?: PanelCounts;
  readonly readMs?: number;
  readonly heapBytes?: number;
  readonly changes: readonly DebugPanelChange[];
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

const ADDED_COLOR = "#34d399";
const REMOVED_COLOR = "#f87171";
const CHANGED_COLOR = "#facc15";

/** A count the change left at zero is drawn faint, so the ones that moved stand out. */
function Tally(props: { readonly sign: string; readonly value: number; readonly color: string }) {
  return <span style={{ color: props.color, opacity: props.value === 0 ? 0.35 : 1 }}>{`${props.sign}${props.value}`}</span>;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** One kind of element: added, removed, changed in place, and the total it went to with the net in brackets. */
function ImpactRow(props: { readonly label: string; readonly line: PanelElementChange; readonly total?: number }) {
  const { line } = props;
  return (
    <div className="gm-debug-impact-row">
      <span>{props.label}</span>
      <Tally sign="+" value={line.added} color={ADDED_COLOR} />
      <Tally sign="−" value={line.removed} color={REMOVED_COLOR} />
      <Tally sign="~" value={line.changed} color={CHANGED_COLOR} />
      <span className="gm-debug-impact-total">{props.total === undefined ? "" : `${props.total} (${signed(line.added - line.removed)})`}</span>
    </div>
  );
}

/** One change: what made it and how long it took, folding open to what it did element by element. */
function ChangeEntry(props: { readonly record: DebugPanelChange; readonly open: boolean }) {
  const { record } = props;
  const { change, counts } = record;
  return (
    <details className="gm-debug-change" open={props.open}>
      <summary>
        <span className="gm-debug-change-label">{record.label}</span>
        <span className="gm-stat-value" style={record.ms === undefined ? undefined : { color: commitColor(record.ms) }}>
          {record.ms === undefined ? "—" : `${record.ms.toFixed(0)} ms`}
        </span>
      </summary>
      <div className="gm-debug-impact">
        <div className="gm-debug-impact-row gm-debug-impact-head">
          <span />
          <span>adic.</span>
          <span>rem.</span>
          <span>mod.</span>
          <span className="gm-debug-impact-total">total (saldo)</span>
        </div>
        <ImpactRow label="Vértices" line={change.vertices} total={counts.vertices} />
        <ImpactRow label="Arestas" line={change.edges} total={counts.edges} />
        <ImpactRow label="Faces" line={change.faces} total={counts.faces} />
        {change.facesByType.map((line) => (
          <ImpactRow key={line.type} label={`· ${line.type}`} line={line} total={counts.byType.find((entry) => entry.type === line.type)?.count ?? 0} />
        ))}
      </div>
      {record.slowest ? <Row label={`Fase mais lenta: ${record.slowest.label}`} value={`${record.slowest.ms.toFixed(0)} ms`} /> : null}
      <Row label="Comparação" value={`${record.diffMs.toFixed(1)} ms`} />
    </details>
  );
}

/**
 * The always-visible developer panel: frame rate, what the map is made of,
 * what each recent change cost and did to it, and the switches that draw the topology. It
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
            <span className="gm-debug-panel-heading">Últimas mudanças</span>
            {stats.changes.length === 0 ? <Row label="Nenhuma ainda" value="" /> : null}
            {[...stats.changes].reverse().map((record, index) => <ChangeEntry key={record.revision} record={record} open={index === 0} />)}
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
