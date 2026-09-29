import type { OpeningStand } from "./openings/opening-stand.ts";
import { roofOpeningStand } from "./roof/roof-opening-stand.ts";

/** Every kind of face that raises an upright stand to hold an opening -- the opening tool asks each in turn. */
export const openingStands: readonly OpeningStand[] = [roofOpeningStand];
