import type { ImageResource } from "../contracts/resource.js";

/**
 * What owning a decoded image costs, and how to give it back.
 *
 * Shared by every resolver that produces an {@link ImageResource}, rather than
 * copied into each one. This is the leak-critical code in the package: an
 * `ImageBitmap` is not garbage collected, and three.js shipped a defect here
 * for years because the fix had nowhere single to live -- `Texture.dispose()`
 * left the underlying bitmap open, so textures decoded from `.glb` leaked
 * despite disposal that looked correct (mrdoob/three.js#23953).
 *
 * One copy is the whole point (`DEC-049`). A second resolver that disposed
 * images *almost* the same way is how that defect gets reintroduced.
 */

/** Whether a value looks like an `ImageBitmap`, without naming the DOM type at runtime. */
function isClosable(value: unknown): value is { close: () => void } {
  return typeof (value as { close?: unknown } | null)?.close === "function";
}

/**
 * Releases whatever the image holds outside the JS heap.
 *
 * Safe to call on either form and on a resource whose source was never
 * closable: a canvas or an `HTMLImageElement` needs nothing, and saying so here
 * is cheaper than every caller deciding.
 */
export function disposeImageResource(resource: ImageResource): void {
  if (resource.form !== "decoded") return;
  if (isClosable(resource.source)) resource.source.close();
}

/**
 * What the image actually occupies, which is not the size of the file it came
 * from.
 *
 * Four bytes per pixel for a decoded image: a 2048x2048 texture is 16 MB in
 * memory whether its PNG was 400 KB or 4 MB. Reporting the file size instead
 * would make `inventory()` agree with the network tab and disagree with the
 * machine, which is the wrong one to be right about.
 */
export function imageResourceBytes(resource: ImageResource): number {
  return resource.form === "decoded"
    ? resource.width * resource.height * 4
    : resource.levels.reduce((total, level) => total + level.data.byteLength, 0);
}
