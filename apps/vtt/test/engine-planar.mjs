import { readFileSync } from "node:fs";

import { initSync, ConstructionSession } from "../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm.js";

initSync({ module: readFileSync(new URL("../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm_bg.wasm", import.meta.url)) });

/**
 * The engine's own geometry -- planar booleans and contour questions -- for a
 * test whose runtime is otherwise a stub. Geometry is the engine's answer even
 * where the rest of the runtime is faked, so a test never measures a second
 * implementation.
 */
const session = new ConstructionSession();

/** The engine's own geometry, for a test whose runtime is otherwise a stub. */
export const enginePort = {
  planarBoolean: (request) => JSON.parse(session.planar_boolean_json(JSON.stringify(request))),
  queryContours: (queries) => (queries.length === 0 ? [] : JSON.parse(session.contour_query_json(JSON.stringify(queries)))),
};

export const planarPort = enginePort;
