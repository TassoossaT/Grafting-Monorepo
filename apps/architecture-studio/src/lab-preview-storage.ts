// Shared between individual /lab trial pages (which capture a preview image
// of what they're rendering) and the /lab gallery (which shows that image as
// a PreviewCard cover). Trial pages and the gallery are separate routes with
// no shared React state, so localStorage is the simplest thing that survives
// navigation between them without introducing a server-side store.
const STORAGE_PREFIX = "grafting:lab-preview:";

function storageKey(candidate: string): string {
  return `${STORAGE_PREFIX}${candidate}`;
}

/** Reads a previously captured preview image for `candidate`, if any. Safe to call during SSR (returns `undefined`). */
export function readPreviewImage(candidate: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(storageKey(candidate)) ?? undefined;
}

/** Persists a captured preview image (a data URL) for `candidate`, so the /lab gallery can show it as a cover. */
export function writePreviewImage(candidate: string, dataUrl: string): void {
  window.localStorage.setItem(storageKey(candidate), dataUrl);
}
