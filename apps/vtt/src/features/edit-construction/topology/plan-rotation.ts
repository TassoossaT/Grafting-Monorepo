/**
 * Turning things round a vertical axis, in plan -- for anything that
 * rotates or winds: a whole structure turned by a handle, a spiral wound on
 * by one, a spiral laid out by turning the pointer. Heights never change.
 */

export interface PlanPoint {
  readonly x: number;
  readonly z: number;
}

/** `angle` brought into (-π, π]. */
export function wrapAngle(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

/** The plan angle of `point` round `center`, from +X towards +Z. */
export function planAngle(center: PlanPoint, point: PlanPoint): number {
  return Math.atan2(point.z - center.z, point.x - center.x);
}

/** `point` turned by `angle` round `pivot` in plan; anything else it carries -- its height -- is kept. */
export function rotateInPlan<P extends PlanPoint>(point: P, pivot: PlanPoint, angle: number): P {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = point.x - pivot.x, dz = point.z - pivot.z;
  return { ...point, x: pivot.x + dx * cos - dz * sin, z: pivot.z + dx * sin + dz * cos };
}

/** An `[x, y, z]` direction turned by `angle` in plan. */
export function rotateVectorInPlan(vector: readonly [number, number, number], angle: number): [number, number, number] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [vector[0] * cos - vector[2] * sin, vector[1], vector[0] * sin + vector[2] * cos];
}

/**
 * How far a pointer has turned round `center` since `from`, counting whole
 * circles: each move adds the short way round from the last, so going round
 * twice reads as two full turns, not as back where it started.
 */
export function createAngleTracker(center: PlanPoint, from: PlanPoint): { turn(point: PlanPoint): number; readonly turned: number } {
  let last = planAngle(center, from);
  let turned = 0;
  return {
    turn(point) {
      const angle = planAngle(center, point);
      turned += wrapAngle(angle - last);
      last = angle;
      return turned;
    },
    get turned() { return turned; },
  };
}
