import { createAngleTracker } from "../../../../features/edit-construction/index.ts";
import type { ConstructionToolId } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier, CurveHandles, CurvePoint, CurveResult } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import type { DraftEnd, DraftKit, SpineDraftMode } from "./spine-draft.ts";
import type { ToolContext } from "./tool-context.ts";

/**
 * The ways of laying a spine's plan out from clicks, for any tool that
 * draws spines (`spine-draft.ts`) -- the same modes whatever the spine
 * generates:
 *
 * - `straight`: start, end;
 * - `arc`: start, end, then the bulge pulled out from the chord;
 * - `points`: clicks the curve passes through, drawn live up to the pointer;
 *   the last point clicked again, or Enter, ends it;
 * - `connect`: two ends, each leaving square to the edge it lands on, and
 *   the curve between them follows;
 * - `spiral`: start, then the pointer taken aside picks the side it curves
 *   to and its radius, the circle it leaves on square to the start's edge
 *   (or straight on from a structure's end); then turned round -- every
 *   full circle adds a turn -- to the end.
 *
 * Heights are never drawn point by point: the start takes the height of
 * what it was clicked on, and the end the tool's end height. All geometry
 * is computed in Rust through the curve batch.
 */
export type SpineDraftModeName = "straight" | "arc" | "points" | "connect" | "spiral";

/** Every mode a multi-mode tool cycles through with R, in order. */
export const SPINE_DRAFT_MODES: readonly SpineDraftModeName[] = Object.freeze(["points", "straight", "arc", "connect", "spiral"]);

const xyz = (p: ConstructionPosition): CurvePoint => [p.x, p.y, p.z];
const plan = (a: ConstructionPosition, b: ConstructionPosition) => Math.hypot(a.x - b.x, a.z - b.z);

/** The spans of an arc through three points, or the straight span when they are in line -- from Rust. */
function arcThrough(ctx: ToolContext, start: ConstructionPosition, through: ConstructionPosition, end: ConstructionPosition): CurveResult {
  return ctx.runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "arcThrough", start: xyz(start), through: xyz(through), end: xyz(end) }] })[0]!;
}

function spansOf(result: CurveResult) {
  return result.curves.map((curve, i) => ({ curve, handles: result.handles[i]! }));
}

/** The free span between two ends, each leaving square to its edge, or along the chord when it has none. */
function connecting(start: DraftEnd, end: DraftEnd): { readonly curve: CubicBezier; readonly handles: CurveHandles } {
  const a = start.point, b = end.point;
  const reach = Math.hypot(b.x - a.x, b.z - a.z) / 3;
  const chord = { x: (b.x - a.x) / (3 * reach || 1), z: (b.z - a.z) / (3 * reach || 1) };
  // Square to each end's edge, on the side the other end is: off the floor, or over it.
  const facing = (out: { readonly x: number; readonly z: number } | undefined, toward: { readonly x: number; readonly z: number }) =>
    out && (out.x * toward.x + out.z * toward.z >= 0 ? out : { x: -out.x, z: -out.z });
  const leave = facing(start.out, chord) ?? chord;
  const arrive = facing(end.out, { x: -chord.x, z: -chord.z }) ?? { x: -chord.x, z: -chord.z };
  const dy = b.y - a.y;
  const curve: CubicBezier = { points: [
    xyz(a),
    [a.x + leave.x * reach, a.y + dy / 3, a.z + leave.z * reach],
    [b.x + arrive.x * reach, a.y + (2 * dy) / 3, b.z + arrive.z * reach],
    xyz(b),
  ] };
  const minus = (p: CurvePoint, q: CurvePoint): CurvePoint => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  return { curve, handles: { start: minus(curve.points[1], curve.points[0]), end: minus(curve.points[2], curve.points[3]), mode: "aligned", bandOffsets: [] } };
}

/**
 * The circle a spiral begun at `start` runs round, the pointer at `aimed`:
 * a start facing some way -- square off a floor's edge, or straight on from
 * a structure's end -- leaves that way, so the circle touches that line at
 * the start, on the side the pointer is, as wide as the pointer is off the
 * line; a start facing nowhere has the pointer for its centre. With the way
 * round it must turn to leave as it faces.
 */
export function spiralCircle(start: DraftEnd, aimed: ConstructionPosition): { readonly center: ConstructionPosition; readonly radius: number; readonly sign?: 1 | -1 } | undefined {
  const s = start.point;
  const d = { x: aimed.x - s.x, z: aimed.z - s.z };
  if (!start.out) {
    const radius = Math.hypot(d.x, d.z);
    return radius < 0.1 ? undefined : { center: { x: aimed.x, y: s.y, z: aimed.z }, radius };
  }
  // Off the floor or over it, whichever way the pointer is; on from a structure's end always on.
  const way = start.joint || d.x * start.out.x + d.z * start.out.z >= 0 ? start.out : { x: -start.out.x, z: -start.out.z };
  let side = { x: -way.z, z: way.x };
  if (d.x * side.x + d.z * side.z < 0) side = { x: -side.x, z: -side.z };
  const radius = d.x * side.x + d.z * side.z;
  if (radius < 0.1) return undefined;
  const center = { x: s.x + side.x * radius, y: s.y, z: s.z + side.z * radius };
  // Counter-clockwise round the centre, the start moves along (-(s-c).z, (s-c).x): that way or the other.
  const ccw = { x: -(s.z - center.z) / radius, z: (s.x - center.x) / radius };
  return { center, radius, sign: ccw.x * way.x + ccw.z * way.z >= 0 ? 1 : -1 };
}

/** What a spiral keeps between clicks: how far the pointer has turned round the centre, and which way it must. */
export interface SpiralState {
  turning?: ReturnType<typeof createAngleTracker>;
  /** The way round it must turn to leave its start the way the start faces -- absent for a start that faces nowhere. */
  sign?: 1 | -1;
}

/** The spiral's own state on a draft. */
export function spiralOf(kit: { readonly draft: { modeState?: unknown } }): SpiralState {
  kit.draft.modeState ??= {};
  return kit.draft.modeState as SpiralState;
}

/** How far the spiral has been turned, counted the way it leaves its start when that is set. */
export function spiralSweep(state: SpiralState): number {
  const tracked = state.turning?.turned ?? 0;
  return state.sign === undefined ? tracked : state.sign * Math.abs(tracked);
}

/** Where the spiral's pointer has turned it to; full circles add up. */
function spiralTurn(kit: DraftKit<ConstructionToolId, unknown>, cursor: ConstructionPosition): void {
  const state = spiralOf(kit);
  const [start, center] = kit.draft.ends;
  state.turning ??= createAngleTracker(center!.point, start!.point);
  state.turning.turn(cursor);
}

/** The shared modes, for a tool whose state is `S`. */
export function spineDraftModes<Id extends ConstructionToolId, S>(): Readonly<Record<SpineDraftModeName, SpineDraftMode<Id, S>>> {
  const straight: SpineDraftMode<Id, S> = {
    label: "Reta",
    hints: ["Clique o início.", "Clique o fim."],
    needs: 1,
    plan(kit, cursor) {
      const { ends } = kit.draft;
      if (ends.length < 1) return undefined;
      const end = kit.endAt(cursor, kit.endHeight(cursor), ends.at(-1)?.point).point;
      const a = ends[0]!.point;
      if (plan(end, a) < 0.1) return undefined;
      return { kind: "spans", spans: spansOf(arcThrough(kit.ctx, a, { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2, z: (a.z + end.z) / 2 }, end)) };
    },
  };
  return Object.freeze({
    straight,
    arc: {
      label: "Arco",
      hints: ["Clique o início.", "Clique o fim.", "Puxe a curva e clique."],
      needs: 2,
      clickHeight: (kit, sample) => kit.endHeight(sample),
      plan(kit, cursor) {
        const { ends } = kit.draft;
        if (ends.length < 2) return ends.length === 1 ? straight.plan(kit, cursor) : undefined;
        const a = ends[0]!.point, b = ends[1]!.point;
        return { kind: "spans", spans: spansOf(arcThrough(kit.ctx, a, pointerAtHeight(cursor, (a.y + b.y) / 2), b)) };
      },
    },
    points: {
      label: "Por pontos",
      hints: ["Clique o início.", "Clique os pontos por onde passa; clique de novo no último, ou Enter, para terminar."],
      needs: Infinity,
      plan(kit, cursor) {
        const { ends } = kit.draft;
        if (ends.length < 1) return undefined;
        return { kind: "points", points: [...ends.map((end) => end.point), kit.endAt(cursor, kit.endHeight(cursor), ends.at(-1)?.point).point] };
      },
    },
    connect: {
      label: "Ligar pontas",
      hints: ["Clique a primeira ponta, de preferência na borda de um piso.", "Clique a outra ponta."],
      needs: 1,
      plan(kit, cursor) {
        const { ends } = kit.draft;
        if (ends.length < 1) return undefined;
        const end = kit.endAt(cursor, kit.endHeight(cursor), ends.at(-1)?.point);
        if (plan(end.point, ends[0]!.point) < 0.1) return undefined;
        return { kind: "spans", spans: [connecting(ends[0]!, end)] };
      },
    },
    spiral: {
      label: "Espiral",
      hints: ["Clique o início, de preferência na borda de um piso ou na ponta de uma rampa.", "Afaste o mouse para o lado em que ela curva: a distância é o raio. Clique.", "Gire no sentido da curva, cada volta completa soma uma volta, e clique o fim."],
      needs: 2,
      // Its second click picks its circle: the centre, at the start's height.
      place(kit, sample) {
        const { ends } = kit.draft;
        if (ends.length !== 1) return undefined;
        const circle = spiralCircle(ends[0]!, pointerAtHeight(sample, ends[0]!.point.y));
        if (!circle) return null;
        const state = spiralOf(kit);
        state.sign = circle.sign;
        state.turning = undefined;
        return { point: circle.center, sample };
      },
      hover(kit, cursor) {
        if (kit.draft.ends.length >= 2) spiralTurn(kit as DraftKit<ConstructionToolId, unknown>, pointerAtHeight(cursor, kit.draft.ends[0]!.point.y));
      },
      // The start only: the circle the pointer picks, leaving the start the way it faces.
      sketch(kit, cursor) {
        const { ends } = kit.draft;
        if (ends.length !== 1) return undefined;
        const start = ends[0]!.point;
        const circle = spiralCircle(ends[0]!, pointerAtHeight(cursor, start.y));
        if (!circle) return [];
        const { center, radius, sign = 1 } = circle;
        return kit.ctx.runtime.curveBatch({ tolerance: 0.05, commands: [{ kind: "helix", center: xyz(center), radius, startAngle: Math.atan2(start.z - center.z, start.x - center.x), sweep: sign * 2 * Math.PI, rise: 0 }] })[0]!.curves;
      },
      readout(kit) {
        const [start, center] = kit.draft.ends;
        if (!center) return undefined;
        return [`raio ${plan(start!.point, center.point).toFixed(2)} m`, `voltas ${(Math.abs(spiralOf(kit).turning?.turned ?? 0) / (2 * Math.PI)).toFixed(2)}`];
      },
      key: (kit) => (kit.draft.ends.length >= 2 ? spiralSweep(spiralOf(kit)).toFixed(3) : ""),
      beforeFinish(kit, sample) {
        spiralTurn(kit as DraftKit<ConstructionToolId, unknown>, pointerAtHeight(sample, kit.draft.ends[0]!.point.y));
      },
      plan(kit, cursor) {
        const { ends } = kit.draft;
        if (ends.length < 2) return undefined;
        const [start, center] = ends;
        const radius = plan(start!.point, center!.point);
        const sweep = spiralSweep(spiralOf(kit));
        if (radius < 0.1 || Math.abs(sweep) < 1e-3) return undefined;
        const startAngle = Math.atan2(start!.point.z - center!.point.z, start!.point.x - center!.point.x);
        const result = kit.ctx.runtime.curveBatch({ tolerance: 0.01, commands: [{
          kind: "helix", center: [center!.point.x, start!.point.y, center!.point.z], radius, startAngle, sweep, rise: kit.endHeight(cursor) - start!.point.y,
        }] })[0]!;
        return { kind: "spans", spans: spansOf(result) };
      },
    },
  });
}
