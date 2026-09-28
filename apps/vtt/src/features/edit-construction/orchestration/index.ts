export {
  ALL_AXES,
  HEIGHT_AXIS,
  HORIZONTAL_AXES,
  ZERO_DELTA,
  addPosition,
  constrainToAxes,
  scalePosition,
} from "./atomic-edit.ts";
export type {
  AtomicEditOp,
  AtomicEditOpKind,
  EditAxis,
  EditGesture,
  EditTarget,
} from "./atomic-edit.ts";

export {
  EMPTY_OUTCOME,
  applyEditOp,
  applyEditPlan,
  mergeOutcomes,
  planEdit,
  planEdgeReshape,
} from "./edit-orchestrator.ts";
export type { EditOpSink, EditPlan } from "./edit-orchestrator.ts";
export { handleMotionAt, planGlobalHandle, shownGlobalHandleAt, shownGlobalHandles } from "./global-handles/index.ts";
export type { CloudGlobalHandle } from "./global-handles/cloud-handle-provider.ts";
export { regenerateWithEndWelds, spineChainEnds, spineEndsLanded } from "./spine-end-welds.ts";
export { adoptJointEnd, adoptsEnds, endJointNear, freeStructureEnds, weldFreeEndsOnto } from "./free-end-welds.ts";
export { settleMoves, settlePatch } from "./type-law.ts";
export { releaseFromSolid } from "./detach.ts";
export { joinWhereLanded, partNodes, releasePart, snapAnchorsOf, snapMagnetsOf } from "./handle-release.ts";
export { joinedStructures, standingOn, standsOn } from "./rigid-carry.ts";
export { outlineMagnets, snapToOutlines, SNAP_REACH, type Magnet, type OutlineSnap, type SnapAnchor } from "./outline-snap.ts";
export { rejoinNodes, reshapedWelds, reweld, unweld, endJoinsOf, type WeldLink } from "./weld-pause.ts";
export { sceneHandles, type HandleFocus, type SceneHandle, type SceneHandleInput, type SceneHandleKind } from "./scene-handles.ts";
