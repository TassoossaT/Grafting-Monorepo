// Product-owned declaration of what a laboratory element *is*. Computation is
// deliberately absent: a kind describes identity, connection surface, and the
// parameters a user may change, and nothing here knows how to run anything.
// The evaluation engine registers behavior against these ids separately
// (ADR-0019), so the authoring surface stays independent of the compute stack.

/** A value a user may edit for one node instance. */
export type BenchParamValue = number | boolean | string;

/** One choice offered by an enumerated parameter. */
export interface BenchEnumOption {
  /** Stored value. */
  readonly value: string;
  /** Human-readable text shown in the control. */
  readonly label: string;
}

/**
 * Declarative description of one editable parameter.
 *
 * The bench derives its whole control surface from this, which is what makes
 * adding an element a registration rather than a UI change.
 */
export type BenchParamSpec =
  | {
      readonly kind: "number";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly description?: string;
    }
  | {
      readonly kind: "integer";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: number;
      readonly min?: number;
      readonly max?: number;
      readonly description?: string;
    }
  | {
      readonly kind: "boolean";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: boolean;
      readonly description?: string;
    }
  | {
      readonly kind: "enum";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: string;
      readonly options: readonly BenchEnumOption[];
      readonly description?: string;
    }
  | {
      /**
       * An integer that seeds deterministic generation.
       *
       * Separated from `integer` so randomness is always an explicit, stored
       * input rather than something an element reaches for on its own — the
       * property the evaluation cache depends on (ADR-0019).
       */
      readonly kind: "seed";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: number;
      readonly description?: string;
    };

/** One input or output of an element. */
export interface BenchPortSpec {
  /** Identity, unique within the element's own inputs or outputs. */
  readonly id: string;
  /** Human-readable text rendered beside the port. */
  readonly label: string;
  /** Opaque value kind used to decide whether a connection makes sense. */
  readonly dataType: string;
  /**
   * Maximum number of connections this port accepts.
   *
   * Inputs default to one, because an element consumes a single value per
   * input; outputs default to unlimited, because one result may feed many
   * elements.
   */
  readonly capacity?: number;
}

/** Complete declaration of one laboratory element. */
export interface BenchNodeKind {
  /** Stable identity referenced by node instances and by the evaluation engine. */
  readonly id: string;
  /** Human-readable name shown in the element menu and on the node. */
  readonly title: string;
  /** Menu grouping. */
  readonly category: string;
  /** One sentence explaining what the element does. */
  readonly description: string;
  /** Values the element consumes. */
  readonly inputs: readonly BenchPortSpec[];
  /** Values the element produces. */
  readonly outputs: readonly BenchPortSpec[];
  /** Parameters a user may edit per node instance. */
  readonly params: readonly BenchParamSpec[];
}

/**
 * Port identity that drives a parameter from a connection.
 *
 * Namespaced so a parameter can never collide with a value port declared by
 * the element itself.
 *
 * @param paramId - Parameter the port feeds.
 * @returns The port identity.
 */
export function paramPortId(paramId: string): string {
  return `param:${paramId}`;
}

/**
 * Reads the parameter a port drives.
 *
 * @param portId - Port identity.
 * @returns The parameter identity, or `null` for an ordinary value port.
 */
export function paramIdFromPort(portId: string): string | null {
  return portId.startsWith("param:") ? portId.slice("param:".length) : null;
}

/**
 * The inputs a node instance actually shows.
 *
 * Every parameter *can* be driven by a connection, but showing all of them at
 * once is what makes a node with a dozen settings unreadable: the ports that
 * carry the element's real work get lost among a column of settings nobody
 * is wiring. So an element's declared inputs are always visible -- they are
 * how it is used at all -- and a parameter port appears only once someone asks
 * for it.
 *
 * @param kind - Element declaration.
 * @param exposed - Parameters this instance has promoted to ports.
 * @returns Declared inputs first, then the promoted parameters, in the
 * element's own parameter order so the column does not reshuffle as ports are
 * added and removed.
 */
export function visibleInputPorts(
  kind: BenchNodeKind,
  exposed: readonly string[],
): readonly BenchPortSpec[] {
  const wanted = new Set(exposed);
  return Object.freeze(
    allInputPorts(kind).filter((port) => {
      const paramId = paramIdFromPort(port.id);
      return paramId === null || wanted.has(paramId);
    }),
  );
}

/**
 * Every input an element accepts, including one port per parameter.
 *
 * Exposing parameters as ports is what lets one element drive another's
 * settings — a control feeding a radius, or a generator's own width feeding a
 * downstream element — instead of every value being typed in by hand.
 *
 * @param kind - Element declaration.
 * @returns Value inputs first, then one port per parameter.
 */
export function allInputPorts(kind: BenchNodeKind): readonly BenchPortSpec[] {
  return Object.freeze([
    ...kind.inputs,
    ...kind.params.map((spec) =>
      Object.freeze({
        id: paramPortId(spec.id),
        label: spec.label,
        dataType: "number",
        capacity: 1,
      }),
    ),
  ]);
}

/** Parameter values held by one node instance. */
export type BenchParamValues = Readonly<Record<string, BenchParamValue>>;

/**
 * Builds the starting parameter values for a new node instance.
 *
 * @param kind - Element being instantiated.
 * @returns One value per declared parameter.
 */
export function defaultParamValues(kind: BenchNodeKind): BenchParamValues {
  const values: Record<string, BenchParamValue> = {};
  for (const spec of kind.params) values[spec.id] = spec.defaultValue;
  return Object.freeze(values);
}

/**
 * Brings a user-supplied value into the range its parameter declares.
 *
 * Controls can emit values a spec forbids — an empty numeric field, a slider
 * dragged past a bound, a stale option — so every edit passes through here
 * before it reaches node state.
 *
 * @param spec - Parameter the value belongs to.
 * @param raw - Value produced by the control.
 * @returns A value that satisfies the spec, falling back to its default.
 */
export function coerceParamValue(spec: BenchParamSpec, raw: unknown): BenchParamValue {
  if (spec.kind === "boolean") return typeof raw === "boolean" ? raw : spec.defaultValue;
  if (spec.kind === "enum") {
    const allowed = spec.options.some((option) => option.value === raw);
    return allowed ? (raw as string) : spec.defaultValue;
  }

  // `Number("")` and `Number(null)` are both 0, so an emptied field would
  // otherwise silently become a real value — usually the minimum, after
  // clamping. An absent value means "use the default", not "use zero".
  const blank = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
  const numeric = blank ? Number.NaN : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) return spec.defaultValue;
  if (spec.kind === "seed") return Math.trunc(numeric);

  const rounded = spec.kind === "integer" ? Math.round(numeric) : numeric;
  const lowerBounded = spec.min === undefined ? rounded : Math.max(spec.min, rounded);
  return spec.max === undefined ? lowerBounded : Math.min(spec.max, lowerBounded);
}

/**
 * Resolves how many connections a port accepts.
 *
 * @param port - Declared port.
 * @param side - Whether the port consumes or produces.
 * @returns The declared capacity, or the side's default.
 */
export function portCapacity(port: BenchPortSpec, side: "input" | "output"): number | undefined {
  if (port.capacity !== undefined) return port.capacity;
  return side === "input" ? 1 : undefined;
}
