/**
 * The spine: control nodes and the bezier spans between them, stored in the
 * construction graph and shared by every structure generated along a curve --
 * a road, a sloped platform, a curved wall. Which one a span generates is its
 * owner (`spine-owner.ts`); how to read, pick and edit a spine is the same
 * for all of them and lives here.
 */
export { chainsOf } from "./spine-chains.ts";
export type { SpineChain } from "./spine-chains.ts";
export { moveSpineControlNode } from "./spine-edit.ts";
export { neighborsOf, spineGraphFromSnapshot, spineGraphIn, spineGraphOf } from "./spine-graph.ts";
export type { SpineControlNode, SpineCurveEdge, SpineGraph } from "./spine-graph.ts";
export { isSpineControlNodeId, parseSpineControlNodeId, spineControlNodeId } from "./spine-node-id.ts";
export type { SpineControlNodeAddress } from "./spine-node-id.ts";
export { isSpineEdge, ownedBy, spineComponent, spineOwnerAt, spineOwnerOf } from "./spine-owner.ts";
export { spanOffsets, spineRibbons } from "./spine-ribbons.ts";
export type { SpineRibbon, SpineRibbonSpan } from "./spine-ribbons.ts";
export { prospectiveGraph } from "./spine-owner.ts";
export { curvePick, curvePickId, isBezierEditTarget } from "./spine-handles.ts";
export { planSpineAction } from "./spine-actions.ts";
export { isSpinePivotId, planSpineTranslate, spineEndHandleAt, spineEndHandleId, spineEndHandleOf, spineEndHandles, spineMemberOf, spinePivotAt, spinePivotId, spinePivots } from "./spine-pivot.ts";
export type { SpineEndHandle, SpineEndHandleKind, SpinePivot } from "./spine-pivot.ts";
export type { SpineAction } from "./spine-actions.ts";
export { planSpineEditPatch, withAutomaticHandles } from "./spine-edit-plan.ts";
export type { SpineEditInput } from "./spine-edit-plan.ts";
