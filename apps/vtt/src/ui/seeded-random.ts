// Re-exported (not imported directly by `composition/` or `features/`, per
// this layer's own boundary rule -- see `test/architecture-boundaries.test.mjs`,
// which permits a direct `@grafting/*` import only from `adapters` or `ui`)
// so `composition/tabletop/room-seed.ts` can derive deterministic room
// variation without reaching past this layer into `@grafting/render-3d`
// itself. A standalone module, not part of `index.ts`'s own barrel, so a
// caller that only wants this plain math does not also pull in
// `terrain-shape-picker.tsx`'s React/JSX.
export { lerp, mulberry32 } from "@grafting/render-3d";
