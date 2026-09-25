/** A caller-owned anchor and its two control positions. Point values must be immutable. */
export interface CurvePenAnchor<P> {
  /** Anchor position. */
  readonly point: P;
  /** Incoming control position. */
  readonly incoming: P;
  /** Outgoing control position. */
  readonly outgoing: P;
}
/** Immutable authoring draft; no confirmed scene data is owned by the controller. */
export interface CurvePenDraft<P> {
  /** Ordered anchors. */
  readonly anchors: readonly CurvePenAnchor<P>[];
  /** Whether the consumer should connect the final anchor to the first. */
  readonly closed: boolean;
}
/** Geometry and interaction policies supplied by the consumer. */
export interface CurvePenOptions<P> {
  /** Constructs an anchor; an omitted drag means a plain click. */
  readonly anchor: (point: P, drag?: P) => CurvePenAnchor<P>;
  /** Determines whether a pointer position has changed. */
  readonly equal: (a: P, b: P) => boolean;
  /** Determines whether a released point requests closing the draft. */
  readonly closes: (first: P, current: P) => boolean;
  /** Receives temporary presentation only. */
  readonly onPreview: (draft: CurvePenDraft<P>) => void;
  /** Accepts a complete draft synchronously; false or a thrown error preserves it for retry. */
  readonly onFinish: (draft: CurvePenDraft<P>) => boolean;
}
/** Renderer-neutral pen lifecycle. Bind pointer capture and keys in the consumer. */
export interface CurvePen<P> {
  /** Arms placement; never confirms scene data. */
  begin(point: P): void;
  /** Updates only the pending anchor. */
  move(point: P): void;
  /** Uses the final pointer sample and stores a draft anchor, or closes on release. */
  end(point: P): void;
  /** Displays an extension without changing stored anchors. */
  hover(point: P): void;
  /** Confirms once, when released and sufficiently populated; rejected drafts remain editable. */
  finish(closed?: boolean): boolean;
  /** Discards every pending anchor without confirmation. */
  cancel(): void;
  /** Discards a pending placement, otherwise removes the last draft anchor. */
  removeLast(): void;
  /** Returns a frozen snapshot; caller-owned point values are not cloned. */
  snapshot(): CurvePenDraft<P>;
}
/** Creates an isolated pen controller without geometry, renderer, keyboard or style policy. */
export function createCurvePen<P>(options: CurvePenOptions<P>): CurvePen<P> {
  type State = { kind: "ready" } | { kind: "placing"; origin: P; current: P; closing: boolean } | { kind: "committing" };
  let state: State = { kind: "ready" };
  let anchors: readonly CurvePenAnchor<P>[] = [];
  const draft = (points = anchors, closed = false): CurvePenDraft<P> =>
    Object.freeze({ anchors: Object.freeze([...points]), closed });
  const anchor = (point: P, drag?: P) => Object.freeze({ ...options.anchor(point, drag) });
  const pending = (origin: P, current: P) => anchor(origin, options.equal(origin, current) ? undefined : current);
  const show = () => options.onPreview(draft());
  const finish = (closed = false): boolean => {
    if (state.kind !== "ready" || anchors.length < (closed ? 3 : 2)) return false;
    state = { kind: "committing" };
    let accepted: boolean;
    try { accepted = options.onFinish(draft(anchors, closed)); }
    finally { state = { kind: "ready" }; }
    if (!accepted) return false;
    anchors = [];
    show();
    return true;
  };
  return {
    begin(point) {
      if (state.kind !== "ready") return;
      const closing = anchors.length >= 3 && options.closes(anchors[0]!.point, point);
      if (!closing && anchors.length && options.equal(anchors.at(-1)!.point, point)) return;
      state = { kind: "placing", origin: point, current: point, closing };
      if (closing) options.onPreview(draft(anchors, true));
      else options.onPreview(draft([...anchors, anchor(point)]));
    },
    move(point) {
      if (state.kind !== "placing") return;
      state = { ...state, current: point };
      options.onPreview(state.closing ? draft(anchors, true) : draft([...anchors, pending(state.origin, point)]));
    },
    end(point) {
      if (state.kind !== "placing") return;
      const placing = state;
      if (placing.closing) {
        state = { kind: "ready" };
        if (options.closes(anchors[0]!.point, point)) finish(true);
        else show();
        return;
      }
      // Construct first: a failed geometry callback leaves a cancellable pending placement.
      const next = pending(placing.origin, point);
      anchors = [...anchors, next];
      state = { kind: "ready" };
      show();
    },
    hover(point) {
      if (state.kind !== "ready" || !anchors.length) return;
      if (anchors.length >= 3 && options.closes(anchors[0]!.point, point)) options.onPreview(draft(anchors, true));
      else options.onPreview(draft(options.equal(anchors.at(-1)!.point, point) ? anchors : [...anchors, anchor(point)]));
    },
    finish,
    cancel() {
      if (state.kind === "committing") return;
      state = { kind: "ready" }; anchors = []; show();
    },
    removeLast() {
      if (state.kind === "committing") return;
      if (state.kind === "ready") anchors = anchors.slice(0, -1);
      state = { kind: "ready" }; show();
    },
    snapshot: () => draft(),
  };
}
