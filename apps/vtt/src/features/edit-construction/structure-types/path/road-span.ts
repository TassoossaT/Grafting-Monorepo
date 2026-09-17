import { ownedBy } from "../../spine/index.ts";
import { PATH_SURFACE_TYPE } from "./path-surface-type.ts";

/** Spine spans a road generates; spans owned by any other structure are never part of a road. */
export const isRoadSpan = ownedBy(PATH_SURFACE_TYPE);
