import type { ReactElement } from "react";

/** Floor level preset item. */
export interface FloorLevelOption {
  /**
   * Unique level identifier.
   * @example "L1"
   */
  readonly id: string;
  /**
   * Human-readable level name.
   * @example "Térreo"
   */
  readonly label: string;
  /**
   * Elevation height in meters.
   * @example 3.5
   */
  readonly heightMeters: number;
}

/** Default floor level presets for building cutaways. */
export const DEFAULT_FLOOR_LEVELS: readonly FloorLevelOption[] = [
  { id: "L0", label: "B1 Subsolo", heightMeters: 0 },
  { id: "L1", label: "L1 Térreo", heightMeters: 3.5 },
  { id: "L2", label: "L2 1º Andar", heightMeters: 7.0 },
  { id: "L3", label: "L3 2º Andar", heightMeters: 10.5 },
  { id: "L4", label: "L4 Telhado", heightMeters: 14.0 },
];

/** Public inputs for the Floor Height Slicer component. */
export interface FloorLevelSlicerProps {
  /**
   * Current cutaway height in meters.
   * @example 3.5
   */
  readonly heightMeters: number;
  /**
   * Currently active level ID preset.
   * @example "L1"
   */
  readonly activeLevelId: string;
  /** Optional array of level presets. */
  readonly levels?: readonly FloorLevelOption[];
  /**
   * Callback when height in meters is adjusted.
   * @example (height) => console.log(height)
   */
  readonly onChangeHeight: (heightMeters: number) => void;
  /**
   * Callback when a level preset is chosen.
   * @example (id, height) => console.log(id, height)
   */
  readonly onSelectLevel: (levelId: string, heightMeters: number) => void;
  /** Optional custom class name. */
  readonly className?: string;
}

/**
 * Floor Height Cutaway Slicer molecule for multi-story level design.
 *
 * @layer molecule
 * @status stable
 */
export function FloorLevelSlicer(props: FloorLevelSlicerProps): ReactElement {
  const {
    heightMeters,
    activeLevelId,
    levels = DEFAULT_FLOOR_LEVELS,
    onChangeHeight,
    onSelectLevel,
    className = "",
  } = props;

  return (
    <div className={`gm-floor-slicer-card ${className}`}>
      <div className="gm-floor-slicer-header">
        <span className="gm-floor-slicer-title">Corte de Andar (Clip Y)</span>
        <strong className="gm-floor-slicer-val">{heightMeters.toFixed(1)}m</strong>
      </div>
      <div className="gm-floor-slicer-body">
        <input
          className="gm-floor-slider-input"
          max={20}
          min={0}
          onChange={(e) => onChangeHeight(parseFloat(e.target.value))}
          step={0.5}
          type="range"
          value={heightMeters}
        />
        <div className="gm-floor-presets">
          {levels.map((level) => {
            const isSelected = level.id === activeLevelId || Math.abs(heightMeters - level.heightMeters) < 0.3;
            return (
              <button
                key={level.id}
                className={`gm-floor-preset-btn ${isSelected ? "gm-floor-preset-btn--active" : ""}`}
                onClick={() => onSelectLevel(level.id, level.heightMeters)}
                type="button"
              >
                {level.id}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
