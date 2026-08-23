import type { AssetDefinition } from "../contracts/definition.js";

/**
 * Checks a declaration before the store accepts it.
 *
 * The types say every field is present. At runtime that guarantee is worth
 * exactly as much as the source the data came from, and the interesting sources
 * are the untyped ones: a manifest parsed from JSON, a file a user dropped onto
 * the page, a row read back out of IndexedDB. `AssetDefinition` describes what
 * a definition must be; this is where that stops being a claim.
 *
 * Provenance is the field this exists for. It is required rather than optional
 * because attribution obligations do not disappear because a file was fetched
 * at runtime instead of committed -- and a required field that nothing verifies
 * is a comment. For imported content the honest answer is often
 * `{ origin: "imported by user", license: "unknown" }`, which is fine: the
 * point is that somebody had to say it, so a map shared later can be traced.
 *
 * @returns what is wrong, or `undefined` when nothing is.
 */
export function invalidReason(candidate: AssetDefinition): string | undefined {
  const entry = candidate as Partial<AssetDefinition> | null | undefined;
  if (entry === null || typeof entry !== "object") return "definition is not an object";

  if (typeof entry.ref !== "string" || entry.ref.length === 0) {
    return "ref must be a non-empty string";
  }
  if (typeof entry.kind !== "string" || entry.kind.length === 0) {
    return "kind must be a non-empty string";
  }
  // Revisions are compared with `>` to decide whether a redeclaration is an
  // update, so a non-finite one would make that comparison meaningless rather
  // than merely odd.
  if (typeof entry.revision !== "number" || !Number.isFinite(entry.revision)) {
    return "revision must be a finite number";
  }

  const provenance = entry.provenance;
  if (provenance === undefined || provenance === null || typeof provenance !== "object") {
    return "provenance is required; say where this came from, even if that is \"imported by user\"";
  }
  if (typeof provenance.origin !== "string" || provenance.origin.length === 0) {
    return "provenance.origin must be a non-empty string";
  }
  if (typeof provenance.license !== "string" || provenance.license.length === 0) {
    return 'provenance.license must be a non-empty string; use "unknown" when it genuinely is';
  }

  // `source` is deliberately unchecked. It is `unknown` by contract -- only the
  // registered resolver for the kind can tell whether it makes sense, and a
  // guess here would reject a resolver this package never imagined.
  return undefined;
}
