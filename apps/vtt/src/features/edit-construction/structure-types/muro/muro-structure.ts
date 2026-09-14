import type { StructureTypeDefinition } from "../structure-type.ts";
import { denied } from "../structure-type.ts";
import { IGNORE } from "../creation-interaction.ts";

/** A generated upright ribbon is edited through its authored axis, not its tessellation. */
export const muroStructureType = Object.freeze<StructureTypeDefinition>({
  surfaceType: "muro",
  label: "Muro",
  creation: "Bézier axis extruded in Rust, with thickness and constant height above sampled terrain",
  roleFor: (_topology, target) => target.kind === "region" ? "muro-body" : target.kind === "edge" ? "muro-panel-edge" : Number(target.nodeId.split(":").at(-1)) % 2 === 1 ? "muro-top" : "muro-base",
  policyFor: (role) => denied(role, "Edite o muro pelos nós e alças do eixo; use Altura do muro para ajustar o topo."),
  interactionOver: () => IGNORE,
  conformsTo: (surfaceType) => surfaceType === "terrain" || surfaceType === "terrain-grass",
  repairAfterCut: { kind: "preserve", reason: "Interações e recortes do muro estão desativados nesta versão." },
});
