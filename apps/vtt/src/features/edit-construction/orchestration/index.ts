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
} from "./edit-orchestrator.ts";
export type { EditOpSink, EditPlan } from "./edit-orchestrator.ts";
