//! `ConstructionSession`: the `#[wasm_bindgen]` class owning one live
//! `Graph`/`SurfaceRegistry` (and an optional `PrismGridMesh`) across a
//! whole editing session, exposed as JSON-request/response methods.
//! Mirrors `libs/isekai/wasm-bridge`'s `WasmEngine` -- one long-lived
//! object driven through many `&mut self` calls; panics on
//! `wasm32-unknown-unknown` cannot be caught, so every method validates its
//! own JSON input rather than relying on panic recovery.

use std::collections::HashSet;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use grafting_graph_core::{ContourTopology, Graph, RegionId, SurfaceRegistry, SurfaceType};

use crate::editing::{self, SessionGraph};
use crate::enclosure;
use crate::footprint;
use crate::generation;
use crate::geometry::connected_component;
use crate::mesh::{self, region_id_to_wire};
use crate::path_brush;
use crate::region_editing;

fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, JsValue> {
    serde_json::from_str(json)
        .map_err(|error| JsValue::from_str(&format!("invalid request JSON: {error}")))
}

fn serialize<T: Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value)
        .map_err(|error| JsValue::from_str(&format!("failed to serialize response: {error}")))
}

fn to_js_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

#[derive(Clone)]
struct ConstructionState {
    graph: SessionGraph,
    surfaces: SurfaceRegistry,
    topology: ContourTopology,
    known_regions: HashSet<RegionId>,
}

struct PathBrushHistoryEntry {
    operation_id: String,
    before: ConstructionState,
    after: ConstructionState,
}
/// One live editing session: a `Graph<[f32; 3], ()>` + `SurfaceRegistry`,
/// plus an optional `PrismGridMesh` terrain generation reads from. In-memory
/// only -- gone when the tab/Worker closes; see this crate's `AGENTS.md` for
/// why no persistence is built here.
#[wasm_bindgen]
pub struct ConstructionSession {
    graph: SessionGraph,
    surfaces: SurfaceRegistry,
    topology: ContourTopology,
    known_regions: HashSet<RegionId>,
    path_brush_undo: Vec<PathBrushHistoryEntry>,
    path_brush_redo: Vec<PathBrushHistoryEntry>,
}

impl Default for ConstructionSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl ConstructionSession {
    /// Creates an empty session.
    #[wasm_bindgen(constructor)]
    pub fn new() -> ConstructionSession {
        console_error_panic_hook::set_once();
        ConstructionSession {
            graph: Graph::try_from_parts(Vec::new(), Vec::new())
                .expect("an empty graph is always valid"),
            surfaces: SurfaceRegistry::new(),
            topology: ContourTopology::new(),
            known_regions: HashSet::new(),
            path_brush_undo: Vec::new(),
            path_brush_redo: Vec::new(),
        }
    }

    /// Keeps `known_regions` in step with whatever an atomic edit created or
    /// removed, so `all_surface_meshes_json`/`snapshot_json` never enumerate
    /// a region that no longer exists (or miss one that now does).
    fn track(&mut self, outcome: &region_editing::RegionEditOutcomeDto) {
        for key in &outcome.created_surface_keys {
            if let Ok(id) = mesh::region_id_from_wire(key) {
                self.known_regions.insert(id);
            }
        }
        for key in &outcome.removed_surface_keys {
            if let Ok(id) = mesh::region_id_from_wire(key) {
                self.known_regions.remove(&id);
            }
        }
    }

    // ---- Bootstrapping ----

    /// Unregisters a surface outright -- no hole-repair, no cascading. See
    /// `editing::remove_surface`.
    pub fn remove_surface_json(&mut self, request_json: &str) -> Result<(), JsValue> {
        let request: editing::RemoveSurfaceRequest = parse(request_json)?;
        let region_id = mesh::region_id_from_wire(&request.surface_key).map_err(to_js_error)?;
        editing::remove_surface(&mut self.surfaces, &mut self.topology, request)
            .map_err(to_js_error)?;
        self.known_regions.remove(&region_id);
        Ok(())
    }

    // ---- Atomic region edits (the analytic edit vocabulary) ----

    /// `MoveVertex`. See `region_editing::apply_move_vertex`.
    pub fn move_vertex_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = region_editing::apply_move_vertex(&mut self.graph, &self.topology, request)
            .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `InsertVertex`. See `region_editing::apply_insert_vertex`.
    pub fn insert_vertex_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            region_editing::apply_insert_vertex(&mut self.graph, &mut self.topology, request)
                .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `RemoveVertex`. See `region_editing::apply_remove_vertex`.
    pub fn remove_vertex_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            region_editing::apply_remove_vertex(&mut self.graph, &mut self.topology, request)
                .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `RetypeEdge`. See `region_editing::apply_retype_edge`.
    pub fn retype_edge_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            region_editing::apply_retype_edge(&mut self.topology, request).map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `MoveEdge`. See `region_editing::apply_move_edge`.
    pub fn move_edge_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = region_editing::apply_move_edge(&mut self.graph, &self.topology, request)
            .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `MoveRegion`. See `region_editing::apply_move_region`.
    pub fn move_region_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = region_editing::apply_move_region(&mut self.graph, &self.topology, request)
            .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `AddHole` -- opens one more inner loop on a face. See
    /// `region_editing::apply_add_hole`.
    pub fn add_hole_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            region_editing::apply_add_hole(&mut self.topology, request).map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `RemoveHole` -- closes one back up. See
    /// `region_editing::apply_remove_hole`.
    pub fn remove_hole_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            region_editing::apply_remove_hole(&mut self.graph, &mut self.topology, request)
                .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// `DeleteRegion`. See `region_editing::apply_delete_region`.
    pub fn delete_region_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = region_editing::apply_delete_region(
            &mut self.graph,
            &mut self.topology,
            &mut self.surfaces,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// What a brush footprint currently covers, before anything is
    /// generated -- the creation-side counterpart to `region_topology_json`.
    /// The engine reports; the caller's own per-type table decides what to
    /// do about it. See `footprint::footprint_coverage`.
    pub fn footprint_coverage_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            footprint::footprint_coverage(&self.graph, &self.topology, &self.surfaces, request)
                .map_err(to_js_error)?;
        serialize(&response)
    }

    /// Registers a whole generated patch -- nodes, shared boundary edges,
    /// and the regions over them -- in one call. See
    /// `region_editing::apply_add_patch` for why a generator must name its
    /// own edges rather than let each face mint its own.
    pub fn add_patch_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let dto = region_editing::apply_add_patch(
            &mut self.graph,
            &mut self.topology,
            &mut self.surfaces,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&dto.outcome);
        serialize(&dto)
    }

    /// Every closed loop of free boundary, among the nodes the request
    /// names, that another such loop encloses -- a hole in the surface whose
    /// rim already exists. The caller passes the region it just touched;
    /// boundary elsewhere on the map is none of its business. See
    /// `enclosure::unfilled_loops`.
    pub fn unfilled_loops_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            enclosure::unfilled_loops(&self.graph, &self.topology, &self.surfaces, request)
                .map_err(to_js_error)?;
        serialize(&response)
    }

    /// Which of the given XZ points already sit inside a region -- what a
    /// generator consults so it only builds over open ground. See
    /// `footprint::classify_points`.
    pub fn classify_points_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            footprint::classify_points(&self.graph, &self.topology, &self.surfaces, request)
                .map_err(to_js_error)?;
        serialize(&response)
    }

    /// `DuplicateRegion`. See `region_editing::apply_duplicate_region`.
    pub fn duplicate_region_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = region_editing::apply_duplicate_region(
            &mut self.graph,
            &mut self.topology,
            &mut self.surfaces,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&response);
        serialize(&response)
    }

    /// One region's live boundary, in this crate's own deterministic order.
    /// See `region_editing::region_topology`.
    pub fn region_topology_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: region_editing::RegionRequest = parse(request_json)?;
        let region = mesh::region_id_from_wire(&request.surface_key).map_err(to_js_error)?;
        let dto =
            region_editing::region_topology(&self.graph, &self.topology, &self.surfaces, &region)
                .map_err(to_js_error)?;
        serialize(&dto)
    }

    /// Every registered region's boundary -- the edit-mode bootstrap call.
    /// See `region_editing::all_region_topologies`.
    pub fn all_region_topologies_json(&self) -> Result<String, JsValue> {
        let dtos =
            region_editing::all_region_topologies(&self.graph, &self.topology, &self.surfaces)
                .map_err(to_js_error)?;
        serialize(&dtos)
    }

    // ---- Terrain mesh lifecycle ----

    // ---- Generate-and-apply ----

    /// Applies one validated terrain-to-path brush operation. The session only
    /// forwards the resolved request to the domain transformer and publishes
    /// its already-atomic replacement plan.
    pub fn apply_path_brush_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: path_brush::ApplyPathBrushRequest = parse(request_json)?;
        let operation_id = request.operation_id.clone();
        let before = ConstructionState {
            graph: self.graph.clone(),
            surfaces: self.surfaces.clone(),
            topology: self.topology.clone(),
            known_regions: self.known_regions.clone(),
        };
        let response = path_brush::apply_path_brush(
            &mut self.graph,
            &mut self.surfaces,
            &mut self.topology,
            &mut self.known_regions,
            request,
        )
        .map_err(to_js_error)?;
        let after = ConstructionState {
            graph: self.graph.clone(),
            surfaces: self.surfaces.clone(),
            topology: self.topology.clone(),
            known_regions: self.known_regions.clone(),
        };
        self.path_brush_undo.push(PathBrushHistoryEntry {
            operation_id,
            before,
            after,
        });
        self.path_brush_redo.clear();
        serialize(&response)
    }

    /// Restores the state immediately before the latest matching path-brush operation.
    pub fn undo_path_brush(&mut self, operation_id: &str) -> Result<(), JsValue> {
        let Some(entry) = self.path_brush_undo.pop() else {
            return Err(JsValue::from_str(
                "no path brush operation is available to undo",
            ));
        };
        if entry.operation_id != operation_id {
            self.path_brush_undo.push(entry);
            return Err(JsValue::from_str(
                "path brush undo order does not match session history",
            ));
        }
        self.graph = entry.before.graph.clone();
        self.surfaces = entry.before.surfaces.clone();
        self.topology = entry.before.topology.clone();
        self.known_regions = entry.before.known_regions.clone();
        self.path_brush_redo.push(entry);
        Ok(())
    }

    /// Restores the state immediately after the latest matching undone path-brush operation.
    pub fn redo_path_brush(&mut self, operation_id: &str) -> Result<(), JsValue> {
        let Some(entry) = self.path_brush_redo.pop() else {
            return Err(JsValue::from_str(
                "no path brush operation is available to redo",
            ));
        };
        if entry.operation_id != operation_id {
            self.path_brush_redo.push(entry);
            return Err(JsValue::from_str(
                "path brush redo order does not match session history",
            ));
        }
        self.graph = entry.after.graph.clone();
        self.surfaces = entry.after.surfaces.clone();
        self.topology = entry.after.topology.clone();
        self.known_regions = entry.after.known_regions.clone();
        self.path_brush_undo.push(entry);
        Ok(())
    }
    /// Regenerates a painted cell set's whole region partition (every
    /// region's own per-cell floor/ceiling, and a wall -- notched where a
    /// run borders a different region -- along every boundary run) and
    /// applies only the difference against whatever this structure already
    /// holds -- the "Pintar Casa" tool's per-tick commit, and (once a
    /// wall-brush stroke's path closes) the wall-brush's own closure
    /// commit. See `generation::generate_and_apply_region_partition`.
    pub fn generate_and_apply_region_partition_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = generation::generate_and_apply_region_partition(
            &mut self.graph,
            &mut self.surfaces,
            &mut self.topology,
            &self.known_regions,
            request,
        )
        .map_err(to_js_error)?;
        for wire_key in &response.removed_surface_keys {
            self.known_regions
                .remove(&mesh::region_id_from_wire(wire_key).map_err(to_js_error)?);
        }
        for wire_key in &response.added_surface_keys {
            self.known_regions
                .insert(mesh::region_id_from_wire(wire_key).map_err(to_js_error)?);
        }
        serialize(&response)
    }

    // ---- Clouds ----

    /// The connected component of same-`type` regions reachable from
    /// `seed` by shared graph nodes -- `ADR-0022`'s "cloud" query. See
    /// `geometry::connected_component`.
    pub fn cloud_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: CloudRequest = parse(request_json)?;
        let seed = mesh::region_id_from_wire(&request.seed).map_err(to_js_error)?;
        let cloud = connected_component(
            &self.surfaces,
            &self.topology,
            &self.known_regions,
            &seed,
            &SurfaceType::new(request.surface_type),
        );
        let mut surface_keys: Vec<Vec<String>> = cloud.iter().map(region_id_to_wire).collect();
        surface_keys.sort();
        serialize(&CloudResponse { surface_keys })
    }

    // ---- Mesh derivation ----

    /// Every currently-known surface's triangulated mesh, in stable key
    /// order -- the one bootstrap call a renderer uses to draw everything
    /// already in the session. See `mesh::all_surface_meshes`.
    pub fn all_surface_meshes_json(&self) -> Result<String, JsValue> {
        let meshes = mesh::all_surface_meshes(
            &self.graph,
            &self.surfaces,
            &self.topology,
            &self.known_regions,
        );
        serialize(&meshes)
    }

    /// One surface's triangulated mesh piece(s), by key -- what a caller
    /// re-fetches for each entry in an operation's `affectedSurfaceKeys`
    /// after a mutation, instead of re-fetching everything. An analytic
    /// region key can legitimately return more than one piece; a plain
    /// surface key always returns exactly one. See `mesh::surface_mesh`.
    pub fn surface_mesh_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let dtos = mesh::surface_mesh(&self.graph, &self.surfaces, &self.topology, request)
            .map_err(to_js_error)?;
        serialize(&dtos)
    }

    // ---- Introspection ----

    /// The session's current nodes, edges, and surfaces, for a caller to
    /// render from without re-deriving state.
    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        let snapshot = self.graph.snapshot();
        let nodes = snapshot
            .nodes()
            .iter()
            .map(|node| NodeSnapshot {
                id: node.id().as_str().to_owned(),
                position: *node.data(),
            })
            .collect();
        let edges = snapshot
            .edges()
            .iter()
            .map(|edge| EdgeSnapshot {
                id: edge.id().as_str().to_owned(),
                source: edge.source().as_str().to_owned(),
                target: edge.target().as_str().to_owned(),
            })
            .collect();
        let mut surfaces: Vec<SurfaceSnapshot> = Vec::new();
        let mut region_ids = self.known_regions.iter().collect::<Vec<_>>();
        region_ids.sort();
        surfaces.extend(region_ids.into_iter().filter_map(|region_id| {
            self.surfaces
                .region_surface(region_id)
                .map(|surface| SurfaceSnapshot {
                    surface_key: region_id_to_wire(region_id),
                    surface_type: surface.surface_type().as_str().to_owned(),
                    physical: surface.physical(),
                })
        }));
        serialize(&SnapshotResponse {
            nodes,
            edges,
            surfaces,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeSnapshot {
    id: String,
    position: [f32; 3],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeSnapshot {
    id: String,
    source: String,
    target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceSnapshot {
    surface_key: Vec<String>,
    surface_type: String,
    physical: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotResponse {
    nodes: Vec<NodeSnapshot>,
    edges: Vec<EdgeSnapshot>,
    surfaces: Vec<SurfaceSnapshot>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudRequest {
    seed: Vec<String>,
    surface_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudResponse {
    surface_keys: Vec<Vec<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;
    use wasm_bindgen_test::wasm_bindgen_test;

    /// One flat unit quad of terrain at grid cell `cell`, declared the way
    /// every generator declares a face: a patch over caller-named shared
    /// edges. Corners run `(x, z)`, `(x+1, z)`, `(x+1, z+1)`, `(x, z+1)`,
    /// the same ring the retired prism-grid generator used, so a stroke
    /// crossing these quads meets the geometry it always did.
    fn terrain_cell(
        session: &mut ConstructionSession,
        cell: usize,
        width: usize,
        y: f32,
        nodes: [&str; 4],
    ) {
        let x = (cell % width) as f32;
        let z = (cell / width) as f32;
        let corners = [
            [x, y, z],
            [x + 1.0, y, z],
            [x + 1.0, y, z + 1.0],
            [x, y, z + 1.0],
        ];
        let mut edges = Vec::new();
        let mut boundary = Vec::new();
        for index in 0..4 {
            let from = nodes[index];
            let to = nodes[(index + 1) % 4];
            let forward = from < to;
            let (start, end) = if forward { (from, to) } else { (to, from) };
            let edge_id = format!("seg:{start}~{end}");
            edges.push(json!({"edgeId": edge_id, "startNodeId": start, "endNodeId": end}));
            boundary.push(json!({"edgeId": edge_id, "reversed": !forward}));
        }
        let request = json!({
            "nodes": nodes
                .iter()
                .zip(corners.iter())
                .map(|(id, position)| json!({"id": id, "position": position}))
                .collect::<Vec<_>>(),
            "edges": edges,
            "regions": [{
                "regionId": nodes.join("|"),
                "boundary": boundary,
                "surfaceType": "terrain",
                "physical": true,
            }],
        });
        session
            .add_patch_json(&request.to_string())
            .expect("terrain patch registers");
    }

    #[wasm_bindgen_test]
    fn a_full_session_sequence_generates_moves_and_merges() {
        let mut session = ConstructionSession::new();

        terrain_cell(&mut session, 0, 2, 1.0, ["n0", "n1", "n2", "n3"]);
        terrain_cell(&mut session, 1, 2, 1.0, ["n4", "n5", "n6", "n7"]);

        let move_response = session
            .move_vertex_json(r#"{"nodeId":"n0","position":[9.0,9.0,9.0]}"#)
            .expect("n0 exists");
        assert!(
            move_response.contains("@region"),
            "a generated cell is an analytic region, and moving its vertex must report it: {move_response}"
        );

        let snapshot = session.snapshot_json().expect("snapshot always succeeds");
        assert!(snapshot.contains("\"n0\""));
        assert!(snapshot.contains("\"surfaces\""));
    }

    #[test]
    fn applying_path_brush_replaces_terrain_through_the_wasm_boundary() {
        let mut session = ConstructionSession::new();
        terrain_cell(&mut session, 0, 2, 0.0, ["n0", "n1", "n2", "n3"]);

        let request = r#"{"operationId":"path-1","samples":[[0.5,0.5]],"brushShape":{"kind":"circle","radius":0.25},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;
        let before = session.snapshot_json().expect("snapshot before the stroke");
        let response = session
            .apply_path_brush_json(request)
            .expect("path brush applies");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(
            !parsed["surfaceIds"]["created"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(session.snapshot_json().unwrap().contains("\"path\""));

        let meshes: Vec<serde_json::Value> =
            serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
        assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));
        assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "terrain"));

        session
            .undo_path_brush("path-1")
            .expect("whole stroke undoes");
        assert_eq!(session.snapshot_json().unwrap(), before);
        session
            .redo_path_brush("path-1")
            .expect("whole stroke redoes");
        assert!(session.snapshot_json().unwrap().contains("\"path\""));
    }

    /// Reproduction: a multi-segment stroke (union path, not a single fitted
    /// primitive) drawn over existing terrain must leave a remainder region
    /// whose mesh actually derives -- not "no mesh derivable for analytic
    /// region ...-remainder".
    #[test]
    fn a_multi_segment_stroke_over_terrain_leaves_a_derivable_remainder_mesh() {
        let mut session = ConstructionSession::new();
        for cell in 0..16 {
            let x = cell % 4;
            let z = cell / 4;
            terrain_cell(
                &mut session,
                cell,
                4,
                0.0,
                [
                    &format!("n{x}-{z}-0"),
                    &format!("n{x}-{z}-1"),
                    &format!("n{x}-{z}-2"),
                    &format!("n{x}-{z}-3"),
                ],
            );
        }

        let request = serde_json::json!({
            "operationId": "path-multi-1",
            "samples": [[1.0, 1.0], [3.0, 1.0], [3.0, 3.0], [5.0, 3.0]],
            "brushShape": {"kind": "circle", "radius": 0.5},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();

        let response = session
            .apply_path_brush_json(&request)
            .expect("multi-segment path brush applies");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(
            parsed["surfaceIds"]["created"].as_array().unwrap().len(),
            2,
            "both the remainder terrain and the new path region must be created"
        );

        let meshes_json = session
            .all_surface_meshes_json()
            .expect("every created region, including the remainder, must have a derivable mesh");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));
        assert!(
            meshes.iter().any(|mesh| mesh["surfaceType"] == "terrain"),
            "the remainder terrain must still be present and meshable: {meshes_json}"
        );
    }

    /// Reproduction attempt 2: a self-overlapping loop stroke that fully
    /// covers the only terrain cell it touches -- the remainder's leftover
    /// boundary is then smaller than (or equal to) the hole the union
    /// contour cuts into it.
    #[test]
    fn a_loop_stroke_fully_covering_its_only_terrain_cell_still_meshes() {
        let mut session = ConstructionSession::new();
        terrain_cell(&mut session, 0, 2, 0.0, ["n0", "n1", "n2", "n3"]);

        let loop_samples: Vec<[f32; 2]> = (0..=32)
            .map(|index| {
                let angle = std::f32::consts::TAU * index as f32 / 32.0;
                [1.0 + 3.0 * angle.cos(), 1.0 + 3.0 * angle.sin()]
            })
            .collect();
        let request = serde_json::json!({
            "operationId": "path-loop-cover",
            "samples": loop_samples,
            "brushShape": {"kind": "circle", "radius": 0.5},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();

        let response = session
            .apply_path_brush_json(&request)
            .expect("a loop stroke fully covering its only terrain cell must still apply");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(
            !parsed["surfaceIds"]["created"]
                .as_array()
                .unwrap()
                .is_empty()
        );

        let meshes_json = session
            .all_surface_meshes_json()
            .expect("every created region must have a derivable mesh, remainder included");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));
    }

    /// The real user-reported bug: a SECOND path-brush stroke overlapping
    /// the region a FIRST stroke already created used to leave that first
    /// region orphaned forever (`plan_region_merge` only ever scanned plain
    /// node-cycle surfaces for eligibility, never existing regions), and
    /// eventually produced "no mesh derivable for ...-remainder" once the
    /// resulting geometry became inconsistent enough. This must now not
    /// only apply without error, but actually retire the first stroke's
    /// own region -- not leave it sitting there duplicated underneath.
    #[test]
    fn a_second_overlapping_path_brush_stroke_consumes_the_first_ones_region() {
        let mut session = ConstructionSession::new();
        for cell in 0..16 {
            let x = cell % 4;
            let z = cell / 4;
            terrain_cell(
                &mut session,
                cell,
                4,
                0.0,
                [
                    &format!("n{x}-{z}-0"),
                    &format!("n{x}-{z}-1"),
                    &format!("n{x}-{z}-2"),
                    &format!("n{x}-{z}-3"),
                ],
            );
        }

        let first = serde_json::json!({
            "operationId": "path-overlap-1",
            "samples": [[1.0, 1.0], [3.0, 1.0]],
            "brushShape": {"kind": "circle", "radius": 0.5},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();
        let first_response = session
            .apply_path_brush_json(&first)
            .expect("first path brush applies");
        let first_parsed: serde_json::Value = serde_json::from_str(&first_response).unwrap();
        // response_from_outcome pushes the leftover remainder (still
        // "terrain"-typed) first, then the new "path" region. A path
        // stroke's own eligibility is purely geometric (`path_brush.rs`'s
        // `plan_path_brush_region_merge` always answers `true`), so the
        // second stroke below would happily consume either one -- this
        // test targets the remainder specifically to also prove type is
        // irrelevant to what gets cut.
        let first_remainder_region = first_parsed["surfaceIds"]["created"]
            .as_array()
            .unwrap()
            .first()
            .unwrap()
            .clone();

        // Second stroke overlaps the first one's own already-carved region.
        let second = serde_json::json!({
            "operationId": "path-overlap-2",
            "samples": [[1.5, 0.5], [1.5, 2.5]],
            "brushShape": {"kind": "circle", "radius": 0.5},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();
        let response = session
            .apply_path_brush_json(&second)
            .expect("second, overlapping path brush stroke must still apply");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(
            !parsed["surfaceIds"]["created"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(
            parsed["surfaceIds"]["removed"]
                .as_array()
                .unwrap()
                .contains(&first_remainder_region),
            "the second stroke must report the first stroke's own remainder region as removed: {response}"
        );

        let meshes_json = session
            .all_surface_meshes_json()
            .expect("every surface, including anything from the first stroke, must still mesh");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert!(
            !meshes
                .iter()
                .any(|mesh| mesh["surfaceKey"] == first_remainder_region),
            "the first stroke's own remainder region must no longer be rendered after being consumed"
        );
        assert!(!meshes.is_empty());
    }

    /// The eligibility gate used to be a type filter (`sourceSurfaceTypes`),
    /// which meant a path stroke could never cut a region an *earlier* path
    /// stroke had produced -- that region's own type is "path", never in
    /// the caller's source list. Cutting must be purely geometric: this
    /// draws stroke 2 squarely over stroke 1's own *new* "path" region
    /// (not its terrain remainder) and asserts it gets consumed too.
    #[test]
    fn a_path_stroke_cuts_a_path_region_from_an_earlier_stroke_regardless_of_type() {
        let mut session = ConstructionSession::new();
        for cell in 0..16 {
            let x = cell % 4;
            let z = cell / 4;
            terrain_cell(
                &mut session,
                cell,
                4,
                0.0,
                [
                    &format!("n{x}-{z}-0"),
                    &format!("n{x}-{z}-1"),
                    &format!("n{x}-{z}-2"),
                    &format!("n{x}-{z}-3"),
                ],
            );
        }

        let first = serde_json::json!({
            "operationId": "path-type-1",
            "samples": [[1.0, 1.0], [3.0, 1.0]],
            "brushShape": {"kind": "circle", "radius": 0.5},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();
        let first_response = session
            .apply_path_brush_json(&first)
            .expect("first path brush applies");
        let first_parsed: serde_json::Value = serde_json::from_str(&first_response).unwrap();
        let first_path_region = first_parsed["surfaceIds"]["created"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .clone();

        let second = serde_json::json!({
            "operationId": "path-type-2",
            "samples": [[2.0, 1.0]],
            "brushShape": {"kind": "circle", "radius": 0.6},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();
        let response = session
            .apply_path_brush_json(&second)
            .expect("second stroke over the first stroke's own path region must still apply");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(
            parsed["surfaceIds"]["removed"]
                .as_array()
                .unwrap()
                .contains(&first_path_region),
            "a path region from an earlier stroke must be cut like anything else under the brush: {response}"
        );
    }

    /// Consuming a surface must delete its own now-orphaned graph nodes,
    /// not just untrack it -- otherwise leftover geometry from every past
    /// stroke keeps accumulating in the graph forever (the "vertices where
    /// nothing was drawn" symptom). Uses a real 2x2 grid of quads that
    /// *share* corner nodes (four independent `generate_and_apply_terrain_cell`
    /// calls never do -- each gets its own private node ids), so consuming
    /// all four at once actually exercises edge cancellation: the shared
    /// center node's four edges each cancel against the adjacent cell that
    /// also owns them, leaving it with nothing to keep it alive, while the
    /// eight perimeter nodes each keep one surviving outer edge and must
    /// stay.
    #[test]
    fn consuming_shared_quads_deletes_the_now_orphaned_center_node() {
        let mut session = ConstructionSession::new();
        // Nodes arrive with the patch that uses them; these are declared up
        // front only so each quad below can name them without repeating a
        // position.
        let mut corners: Vec<serde_json::Value> = Vec::new();
        let mut corner = |id: &str, x: f32, z: f32| {
            corners.push(serde_json::json!({"id": id, "position": [x, 0.0, z]}));
        };
        corner("q-a", 0.0, 0.0);
        corner("q-b", 1.0, 0.0);
        corner("q-c", 2.0, 0.0);
        corner("q-d", 0.0, 1.0);
        corner("q-e", 1.0, 1.0);
        corner("q-f", 2.0, 1.0);
        corner("q-g", 0.0, 2.0);
        corner("q-h", 1.0, 2.0);
        corner("q-i", 2.0, 2.0);

        // Every face is declared as a patch over shared, caller-named edges
        // -- the only way a generator creates anything. Naming each edge
        // after its own node pair is what makes two neighbouring quads meet
        // along one edge instead of two coincident ones.
        let mut quad = |cycle: [&str; 4]| {
            let segment = |from: &str, to: &str| {
                let forward = from < to;
                let (start, end) = if forward { (from, to) } else { (to, from) };
                (
                    format!("seg:{start}~{end}"),
                    start.to_string(),
                    end.to_string(),
                    forward,
                )
            };
            let steps: Vec<_> = (0..4)
                .map(|index| segment(cycle[index], cycle[(index + 1) % 4]))
                .collect();
            let edges: Vec<_> = steps
                .iter()
                .map(|(id, start, end, _)| {
                    serde_json::json!({"edgeId": id, "startNodeId": start, "endNodeId": end})
                })
                .collect();
            let boundary: Vec<_> = steps
                .iter()
                .map(|(id, _, _, forward)| serde_json::json!({"edgeId": id, "reversed": !forward}))
                .collect();
            session
                .add_patch_json(
                    &serde_json::json!({
                        "nodes": corners,
                        "edges": edges,
                        "regions": [{
                            "regionId": cycle.join("|"),
                            "boundary": boundary,
                            "surfaceType": "terrain",
                            "physical": true,
                        }],
                    })
                    .to_string(),
                )
                .expect("quad patch adds");
        };
        quad(["q-a", "q-b", "q-e", "q-d"]);
        quad(["q-b", "q-c", "q-f", "q-e"]);
        quad(["q-d", "q-e", "q-h", "q-g"]);
        quad(["q-e", "q-f", "q-i", "q-h"]);

        let request = serde_json::json!({
            "operationId": "path-orphan-cleanup",
            "samples": [[1.0, 1.0]],
            "brushShape": {"kind": "circle", "radius": 1.6},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();
        let response = session
            .apply_path_brush_json(&request)
            .expect("a brush covering the whole grid applies");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let removed_node_ids: Vec<&str> = parsed["nodeIds"]["removed"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        assert_eq!(
            removed_node_ids,
            vec!["q-e"],
            "only the shared center node has every one of its own edges cancel out: {response}"
        );
        assert!(
            session
                .graph
                .node(&grafting_graph_core::NodeId::new("q-e").unwrap())
                .is_none(),
            "the reported orphan must actually be gone from the graph"
        );
        for surviving in ["q-a", "q-b", "q-c", "q-d", "q-f", "q-g", "q-h", "q-i"] {
            assert!(
                session
                    .graph
                    .node(&grafting_graph_core::NodeId::new(surviving).unwrap())
                    .is_some(),
                "{surviving} still anchors a surviving remainder edge and must not be deleted"
            );
        }
    }

    /// A single-point (dot) stroke with a circle brush produces a contour
    /// whose edges are ALL circular arcs -- no straight line segment at
    /// all, unlike a dragged stroke's line-with-round-caps shape. This must
    /// apply exactly like any other contour.
    #[test]
    fn a_single_point_circle_brush_dot_applies_as_a_pure_arc_region() {
        let mut session = ConstructionSession::new();
        let request = r#"{"operationId":"path-dot","samples":[[0.0,0.0]],"brushShape":{"kind":"circle","radius":0.5},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;

        let response = session
            .apply_path_brush_json(request)
            .expect("a pure-arc contour must apply");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["surfaceIds"]["created"].as_array().unwrap().len(), 1);
        assert!(session.snapshot_json().unwrap().contains("\"path\""));

        let meshes_json = session.all_surface_meshes_json().unwrap();
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(
            meshes.len(),
            1,
            "the pure-arc region must produce exactly one mesh: {meshes_json}"
        );
        assert!(
            !meshes[0]["indices"].as_array().unwrap().is_empty(),
            "the pure-arc region's mesh must have real triangles, not be empty: {meshes_json}"
        );
    }

    /// The exact user-reported bug this fix addresses, through the whole
    /// wasm boundary: a stroke that loops back over itself -- like drawing
    /// a circle with the brush, sample by sample -- used to fail outright
    /// with "requires union normalization." The committed area must always
    /// resolve to one region and render as one real mesh, regardless of the
    /// stroke's own shape.
    #[test]
    fn a_self_overlapping_loop_stroke_applies_and_renders_as_one_region() {
        let mut session = ConstructionSession::new();
        let loop_samples: Vec<[f32; 2]> = (0..=32)
            .map(|index| {
                let angle = std::f32::consts::TAU * index as f32 / 32.0;
                [2.0 * angle.cos(), 2.0 * angle.sin()]
            })
            .collect();
        let request = serde_json::json!({
            "operationId": "path-loop",
            "samples": loop_samples,
            "brushShape": {"kind": "circle", "radius": 0.5},
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();

        let response = session
            .apply_path_brush_json(&request)
            .expect("a self-overlapping loop stroke must apply, not require union normalization");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["surfaceIds"]["created"].as_array().unwrap().len(), 1);

        let meshes_json = session.all_surface_meshes_json().unwrap();
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(
            meshes.len(),
            1,
            "the looped stroke must produce exactly one mesh: {meshes_json}"
        );
        assert!(
            !meshes[0]["indices"].as_array().unwrap().is_empty(),
            "the looped stroke's mesh must have real triangles, not be empty: {meshes_json}"
        );
    }

    /// A path is a structure like any other -- committing one over an empty
    /// session (no terrain, no surfaces at all) must succeed and create just
    /// the path itself, not fail for lack of something to consume.
    #[test]
    fn applying_path_brush_with_no_terrain_at_all_still_creates_the_path() {
        let mut session = ConstructionSession::new();
        let request = r#"{"operationId":"path-empty","samples":[[0.0,0.0],[1.0,0.0]],"brushShape":{"kind":"circle","radius":0.25},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;

        let response = session
            .apply_path_brush_json(request)
            .expect("path brush applies with no terrain underneath");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(
            parsed["surfaceIds"]["created"].as_array().unwrap().len(),
            1,
            "only the target region is created, there is no source region to make"
        );
        assert!(
            parsed["surfaceIds"]["removed"]
                .as_array()
                .unwrap()
                .is_empty(),
            "nothing existed to remove"
        );
        assert!(session.snapshot_json().unwrap().contains("\"path\""));
    }

    /// Deterministic xorshift -- no external `rand` dependency needed for
    /// one stress test.
    struct Xorshift(u32);
    impl Xorshift {
        fn next(&mut self) -> u32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 17;
            self.0 ^= self.0 << 5;
            self.0
        }
        fn range(&mut self, lo: f32, hi: f32) -> f32 {
            lo + (self.next() as f32 / u32::MAX as f32) * (hi - lo)
        }
    }

    /// The user reported "no mesh derivable for ...-remainder" appears
    /// *consistently* while freehand-drawing "vários e vários caminhos
    /// aleatórios em cima de outros caminhos ou de terreno" -- every
    /// targeted synthetic repro so far has applied cleanly, so this throws
    /// many random overlapping strokes (varying shape, radius, and
    /// position, some on terrain, some on empty space, some on top of a
    /// prior stroke's own region) at one session and, after *every single*
    /// stroke, re-derives the mesh for exactly the keys the front end
    /// itself re-fetches (`surfaceIds.created`, via `mesh::surface_mesh` --
    /// the single-key lookup, not the infallible `all_surface_meshes`), to
    /// catch whatever specific combination trips it. Calls the crate's own
    /// pure inner functions directly (`path_brush::apply_path_brush`,
    /// `mesh::surface_mesh`) instead of the `#[wasm_bindgen]` JSON wrappers,
    /// since a `JsValue` error's `.as_string()` aborts outside a real wasm32
    /// target.
    #[test]
    fn many_random_overlapping_strokes_never_leave_an_unmeshable_surface() {
        let mut session = ConstructionSession::new();
        for cell in 0..36 {
            let x = cell % 6;
            let z = cell / 6;
            terrain_cell(
                &mut session,
                cell,
                4,
                0.0,
                [
                    &format!("n{x}-{z}-0"),
                    &format!("n{x}-{z}-1"),
                    &format!("n{x}-{z}-2"),
                    &format!("n{x}-{z}-3"),
                ],
            );
        }

        let mut rng = Xorshift(0x9e3779b1);
        for stroke in 0..80 {
            let shape = match rng.next() % 3 {
                0 => serde_json::json!({"kind": "circle", "radius": rng.range(0.3, 1.5)}),
                1 => {
                    serde_json::json!({"kind": "square", "size": rng.range(0.6, 3.0), "rotationRadians": rng.range(0.0, 6.28)})
                }
                _ => {
                    serde_json::json!({"kind": "hexagon", "radius": rng.range(0.3, 1.5), "rotationRadians": rng.range(0.0, 6.28)})
                }
            };
            let sample_count = 1 + (rng.next() % 3) as usize;
            let samples: Vec<[f32; 2]> = (0..sample_count)
                .map(|_| [rng.range(-1.0, 7.0), rng.range(-1.0, 7.0)])
                .collect();
            let request_json = serde_json::json!({
                "operationId": format!("path-stress-{stroke}"),
                "samples": samples,
                "brushShape": shape,
                "depth": 0.1,
                "sourceSurfaceTypes": ["terrain"],
                "targetSurfaceType": "path",
            })
            .to_string();
            let request: path_brush::ApplyPathBrushRequest = serde_json::from_str(&request_json)
                .unwrap_or_else(|error| panic!("bad request json {request_json}: {error}"));

            let response = match path_brush::apply_path_brush(
                &mut session.graph,
                &mut session.surfaces,
                &mut session.topology,
                &mut session.known_regions,
                request,
            ) {
                Ok(response) => response,
                Err(message) => {
                    if message.contains("produced no semantic change") {
                        continue;
                    }
                    panic!("stroke {stroke} ({request_json}) failed to apply: {message}");
                }
            };
            let response_json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&response_json).unwrap();

            for key in parsed["surfaceIds"]["created"].as_array().unwrap() {
                let surface_key: Vec<String> = key
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|part| part.as_str().unwrap().to_string())
                    .collect();
                if let Err(message) = mesh::surface_mesh(
                    &session.graph,
                    &session.surfaces,
                    &session.topology,
                    mesh::SurfaceMeshRequest {
                        surface_key: surface_key.clone(),
                    },
                ) {
                    panic!(
                        "stroke {stroke} created {surface_key:?} but it doesn't mesh: {message}\nstroke request: {request_json}\nstroke response: {response_json}"
                    );
                }
            }
        }
    }

    #[wasm_bindgen_test]
    fn invalid_json_is_rejected_not_panicking() {
        let mut session = ConstructionSession::new();
        let error = session.move_vertex_json("not json").unwrap_err();
        assert!(error.as_string().unwrap().contains("invalid request JSON"));
    }

    // `ADR-0022`'s node-set edit operations are retired: every creation
    // path registers an analytic region, which those operations had no way
    // to resolve. Their replacement is the atomic vocabulary in
    // `region_editing.rs`, covered by that module's own tests.

    #[wasm_bindgen_test]
    fn a_registered_patch_exposes_its_mesh() {
        let mut session = ConstructionSession::new();
        terrain_cell(&mut session, 0, 2, 1.0, ["n0", "n1", "n2", "n3"]);

        let meshes_json = session
            .all_surface_meshes_json()
            .expect("meshes always succeed");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(meshes.len(), 1);
        assert_eq!(
            meshes[0]["positions"].as_array().unwrap().len(),
            12,
            "4 vertices * 3 components"
        );
        assert_eq!(
            meshes[0]["indices"].as_array().unwrap().len(),
            6,
            "2 triangles * 3 indices"
        );
    }

    #[wasm_bindgen_test]
    fn surface_mesh_json_rejects_an_unregistered_key() {
        let session = ConstructionSession::new();
        let error = session
            .surface_mesh_json(r#"{"surfaceKey":["@region","missing"]}"#)
            .unwrap_err();
        assert!(
            error
                .as_string()
                .unwrap()
                .contains("unknown analytic region")
        );
    }

    #[wasm_bindgen_test]
    fn a_tower_stamp_patch_meshes_all_four_quarters_cleanly() {
        let mut session = ConstructionSession::new();
        let patch_json = r#"{
            "nodes": [
                {"id": "b0", "position": [2.0, 0.0, 0.0]},
                {"id": "t0", "position": [2.0, 3.0, 0.0]},
                {"id": "b1", "position": [0.0, 0.0, 2.0]},
                {"id": "t1", "position": [0.0, 3.0, 2.0]},
                {"id": "b2", "position": [-2.0, 0.0, 0.0]},
                {"id": "t2", "position": [-2.0, 3.0, 0.0]},
                {"id": "b3", "position": [0.0, 0.0, -2.0]},
                {"id": "t3", "position": [0.0, 3.0, -2.0]}
            ],
            "edges": [
                {"edgeId": "e_b0_b1", "startNodeId": "b0", "endNodeId": "b1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_b1_t1", "startNodeId": "b1", "endNodeId": "t1"},
                {"edgeId": "e_t0_t1", "startNodeId": "t0", "endNodeId": "t1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_t0_b0", "startNodeId": "t0", "endNodeId": "b0"},
                {"edgeId": "e_b1_b2", "startNodeId": "b1", "endNodeId": "b2", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_b2_t2", "startNodeId": "b2", "endNodeId": "t2"},
                {"edgeId": "e_t1_t2", "startNodeId": "t1", "endNodeId": "t2", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_b2_b3", "startNodeId": "b2", "endNodeId": "b3", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_b3_t3", "startNodeId": "b3", "endNodeId": "t3"},
                {"edgeId": "e_t2_t3", "startNodeId": "t2", "endNodeId": "t3", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_b3_b0", "startNodeId": "b3", "endNodeId": "b0", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
                {"edgeId": "e_t3_t0", "startNodeId": "t3", "endNodeId": "t0", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}}
            ],
            "regions": [
                {
                    "regionId": "r0",
                    "boundary": [
                        {"edge": "e_b0_b1", "reversed": false},
                        {"edge": "e_b1_t1", "reversed": false},
                        {"edge": "e_t0_t1", "reversed": true},
                        {"edge": "e_t0_b0", "reversed": false}
                    ],
                    "surfaceType": "wall-white",
                    "physical": true
                },
                {
                    "regionId": "r1",
                    "boundary": [
                        {"edge": "e_b1_b2", "reversed": false},
                        {"edge": "e_b2_t2", "reversed": false},
                        {"edge": "e_t1_t2", "reversed": true},
                        {"edge": "e_b1_t1", "reversed": true}
                    ],
                    "surfaceType": "wall-white",
                    "physical": true
                },
                {
                    "regionId": "r2",
                    "boundary": [
                        {"edge": "e_b2_b3", "reversed": false},
                        {"edge": "e_b3_t3", "reversed": false},
                        {"edge": "e_t2_t3", "reversed": true},
                        {"edge": "e_b2_t2", "reversed": true}
                    ],
                    "surfaceType": "wall-white",
                    "physical": true
                },
                {
                    "regionId": "r3",
                    "boundary": [
                        {"edge": "e_b3_b0", "reversed": false},
                        {"edge": "e_t0_b0", "reversed": true},
                        {"edge": "e_t3_t0", "reversed": true},
                        {"edge": "e_b3_t3", "reversed": true}
                    ],
                    "surfaceType": "wall-white",
                    "physical": true
                }
            ]
        }"#;
        session.add_patch_json(patch_json).unwrap();
        let meshes_json = session.all_surface_meshes_json().unwrap();
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(meshes.len(), 4);
        for mesh in meshes {
            let positions: Vec<f32> = mesh["positions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_f64().unwrap() as f32)
                .collect();
            let indices: Vec<u32> = mesh["indices"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_u64().unwrap() as u32)
                .collect();
            assert!(!indices.is_empty());
            for triangle in indices.chunks_exact(3) {
                let p0 = [
                    positions[triangle[0] as usize * 3],
                    positions[triangle[0] as usize * 3 + 1],
                    positions[triangle[0] as usize * 3 + 2],
                ];
                let p1 = [
                    positions[triangle[1] as usize * 3],
                    positions[triangle[1] as usize * 3 + 1],
                    positions[triangle[1] as usize * 3 + 2],
                ];
                let p2 = [
                    positions[triangle[2] as usize * 3],
                    positions[triangle[2] as usize * 3 + 1],
                    positions[triangle[2] as usize * 3 + 2],
                ];
                let a0 = p0[2].atan2(p0[0]);
                let a1 = p1[2].atan2(p1[0]);
                let a2 = p2[2].atan2(p2[0]);
                let mut span = (a0 - a1).abs().max((a1 - a2).abs()).max((a2 - a0).abs());
                if span > std::f32::consts::PI {
                    span = std::f32::consts::TAU - span;
                }
                assert!(
                    span < 0.4,
                    "triangle cut diagonally across tower: angular span = {span}"
                );
            }
        }
    }
}
