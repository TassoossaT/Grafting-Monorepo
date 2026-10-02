"use client";

import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";

import { formatLength, type MeasureUnitId } from "@/features/edit-construction";

export interface HeightCutMarkerProps {
  /** The height above which the map is hidden; `undefined` shows it all. */
  readonly height: number | undefined;
  readonly onHeightChange: (height: number | undefined) => void;
  /** The unit the height is written in. */
  readonly measureUnit: MeasureUnitId;
}

/** The highest cut the marker reaches, in metres, and the step it moves by. */
const CUT_MAX = 30;
const CUT_STEP = 0.25;

function clampToStep(height: number): number {
  return Math.min(CUT_MAX, Math.max(0, Math.round(height / CUT_STEP) * CUT_STEP));
}

/**
 * The height cut as a marker on the side of the map, as in TaleSpire: a
 * vertical track whose top is "no cut" and whose foot is the ground. Drag the
 * marker down and everything above it hides, to see and edit inside roofed
 * or upper-floored structures; drag it back to the top, or double-click it,
 * and the whole map shows again. The wheel over the track and the arrow keys
 * move it a step at a time. Only the view changes: nothing reaches the
 * construction or the history.
 */
export function HeightCutMarker(props: HeightCutMarkerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { height } = props;
  const cutOn = height !== undefined;
  // The top of the track is the "no cut" stop, just above the highest cut.
  const fraction = cutOn ? height / CUT_MAX : 1;

  const heightAt = (clientY: number): number | undefined => {
    const track = trackRef.current;
    if (!track) return height;
    const box = track.getBoundingClientRect();
    const up = (box.bottom - clientY) / box.height;
    return up >= 1 ? undefined : clampToStep(up * CUT_MAX);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onHeightChange(heightAt(event.clientY));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    props.onHeightChange(heightAt(event.clientY));
  };
  const step = (by: number) => {
    const from = height ?? CUT_MAX + CUT_STEP;
    const next = from + by;
    props.onHeightChange(next > CUT_MAX ? undefined : clampToStep(next));
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
    step(event.deltaY < 0 ? CUT_STEP : -CUT_STEP);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") step(CUT_STEP);
    else if (event.key === "ArrowDown") step(-CUT_STEP);
    else if (event.key === "Home") props.onHeightChange(undefined);
    else if (event.key === "End") props.onHeightChange(0);
    else return;
    event.preventDefault();
  };

  const label = cutOn ? formatLength(height, props.measureUnit) : "sem corte";
  return (
    <div className="gm-height-cut" aria-label="Corte de altura">
      <div
        ref={trackRef}
        className="gm-height-cut-track"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={CUT_MAX}
        aria-valuenow={height ?? CUT_MAX}
        aria-valuetext={label}
        title="Corte de altura: arraste para baixo para esconder o que passa da altura. Duplo clique tira o corte."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={() => props.onHeightChange(undefined)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {cutOn ? <div className="gm-height-cut-hidden" style={{ height: `${(1 - fraction) * 100}%` }} /> : null}
        <div className={`gm-height-cut-marker${cutOn ? " gm-height-cut-marker--on" : ""}`} style={{ bottom: `${fraction * 100}%` }}>
          <span className="gm-height-cut-label">{label}</span>
        </div>
      </div>
    </div>
  );
}
