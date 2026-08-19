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

use grafting_graph_core::{
    ContourTopology, FormationInputs, Graph, GraphPrimitive, PrismGridMesh, RegionId, SurfaceKey,
    SurfaceRegistry, SurfaceType,
};

use crate::dto::{surface_key_from_wire, surface_key_to_wire};
use crate::editing::{self, SessionGraph};
use crate::generation;
use crate::geometry::connected_component;
use crate::mesh::{self, region_id_to_wire};
use crate::path_brush;
use crate::terrain;

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
    known_surfaces: HashSet<SurfaceKey>,
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
    terrain_mesh: Option<PrismGridMesh>,
    /// This crate's own bookkeeping of every surface key currently
    /// registered, purely so [`Self::snapshot_json`] can enumerate them --
    /// `SurfaceRegistry` itself exposes no "all surfaces" iterator, and
    /// adding one would be a `grafting-graph-core` change, out of this
    /// crate's scope.
    known_surfaces: HashSet<SurfaceKey>,
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
            terrain_mesh: None,
            known_surfaces: HashSet::new(),
            known_regions: HashSet::new(),
            path_brush_undo: Vec::new(),
            path_brush_redo: Vec::new(),
        }
    }

    fn remember(&mut self, wire_key: &[String]) {
        let key = surface_key_from_wire(wire_key)
            .expect("wire-formatted key was produced internally and must parse back");
        self.known_surfaces.insert(key);
    }

    fn forget(&mut self, wire_key: &[String]) {
        let key = surface_key_from_wire(wire_key)
            .expect("wire-formatted key was produced internally and must parse back");
        self.known_surfaces.remove(&key);
    }

    // ---- Bootstrapping ----

    /// Adds a brand-new node. See `editing::add_node`.
    pub fn add_node_json(&mut self, request_json: &str) -> Result<(), JsValue> {
        let request = parse(request_json)?;
        editing::add_node(&mut self.graph, request).map_err(to_js_error)
    }

    /// Adds a brand-new edge. See `editing::add_edge`.
    pub fn add_edge_json(&mut self, request_json: &str) -> Result<(), JsValue> {
        let request = parse(request_json)?;
        editing::add_edge(&mut self.graph, request).map_err(to_js_error)
    }

    /// Registers a brand-new surface. See `editing::add_surface`.
    pub fn add_surface_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            editing::add_surface(&self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
        self.remember(&response.surface_key);
        serialize(&response)
    }

    /// Unregisters a surface outright -- no hole-repair, no cascading. See
    /// `editing::remove_surface`.
    pub fn remove_surface_json(&mut self, request_json: &str) -> Result<(), JsValue> {
        let request: editing::RemoveSurfaceRequest = parse(request_json)?;
        let key = request.surface_key.clone();
        editing::remove_surface(&mut self.surfaces, request).map_err(to_js_error)?;
        self.forget(&key);
        Ok(())
    }

    /// Removes an edge outright -- no repair, no cascading. See
    /// `editing::remove_edge`.
    pub fn remove_edge_json(&mut self, request_json: &str) -> Result<(), JsValue> {
        let request = parse(request_json)?;
        editing::remove_edge(&mut self.graph, request).map_err(to_js_error)
    }

    // ---- The five construction.rs operations ----

    /// Moves a node. See `editing::apply_move_node`.
    pub fn move_node_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = editing::apply_move_node(&mut self.graph, &self.surfaces, request)
            .map_err(to_js_error)?;
        serialize(&response)
    }

    /// Deletes a node and repairs the hole it leaves. See `editing::apply_delete_node`.
    pub fn delete_node_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = editing::apply_delete_node(&mut self.graph, &mut self.surfaces, request)
            .map_err(to_js_error)?;
        for key in &response.removed_surface_keys {
            self.forget(key);
        }
        for key in &response.capping_surface_keys {
            self.remember(key);
        }
        serialize(&response)
    }

    /// Unites two surfaces. See `editing::apply_merge_surfaces`.
    pub fn merge_surfaces_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: editing::MergeSurfacesRequest = parse(request_json)?;
        let a = request.a.clone();
        let b = request.b.clone();
        let response = editing::apply_merge_surfaces(&self.graph, &mut self.surfaces, request)
            .map_err(to_js_error)?;
        self.forget(&a);
        self.forget(&b);
        self.remember(&response.surface_key);
        serialize(&response)
    }

    /// Divides one surface into two. See `editing::apply_split_surface`.
    pub fn split_surface_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: editing::SplitSurfaceRequest = parse(request_json)?;
        let original = request.key.clone();
        let response = editing::apply_split_surface(&self.graph, &mut self.surfaces, request)
            .map_err(to_js_error)?;
        self.forget(&original);
        self.remember(&response.first_key);
        self.remember(&response.second_key);
        serialize(&response)
    }

    /// Duplicates a surface. See `editing::apply_duplicate_surface`.
    pub fn duplicate_surface_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            editing::apply_duplicate_surface(&mut self.graph, &mut self.surfaces, request)
                .map_err(to_js_error)?;
        self.remember(&response.surface_key);
        serialize(&response)
    }

    // ---- Terrain mesh lifecycle ----

    /// Constructs and stores this session's own `PrismGridMesh`, the same
    /// input shape `@grafting/procgen-generation-wasm`'s own
    /// `generate_prism_mesh` takes. Must be called before
    /// [`Self::generate_and_apply_terrain_cell_json`].
    pub fn set_terrain_mesh(
        &mut self,
        width: u32,
        height: u32,
        layers: u32,
        primitive_u8: u8,
        deformation_xy: f32,
        deformation_z: f32,
    ) -> Result<(), JsValue> {
        if width == 0 || height == 0 || layers == 0 {
            return Err(JsValue::from_str(
                "set_terrain_mesh: dimensions must be greater than 0",
            ));
        }
        if width > 512 || height > 512 || layers > 64 {
            return Err(JsValue::from_str(
                "set_terrain_mesh: grid size exceeds maximum limits",
            ));
        }
        let primitive = match primitive_u8 {
            0 => GraphPrimitive::Passage,
            1 => GraphPrimitive::Boundary,
            _ => GraphPrimitive::Surface,
        };
        let inputs = FormationInputs {
            primitive,
            deformation_xy: deformation_xy.clamp(0.0, 1.0),
            deformation_z: deformation_z.clamp(0.0, 1.0),
        };
        self.terrain_mesh = Some(PrismGridMesh::new(width, height, layers, inputs));
        Ok(())
    }

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
            known_surfaces: self.known_surfaces.clone(),
            topology: self.topology.clone(),
            known_regions: self.known_regions.clone(),
        };
        let response = path_brush::apply_path_brush(
            &mut self.graph,
            &mut self.surfaces,
            &mut self.topology,
            &mut self.known_surfaces,
            &mut self.known_regions,
            request,
        )
        .map_err(to_js_error)?;
        let after = ConstructionState {
            graph: self.graph.clone(),
            surfaces: self.surfaces.clone(),
            known_surfaces: self.known_surfaces.clone(),
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

    /// Resolves terrain-grid cells through the shared authoritative brush footprint.
    pub fn resolve_brush_cells_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = path_brush::resolve_brush_cells(request).map_err(to_js_error)?;
        serialize(&response)
    }
    /// Returns the exact target mesh for a path brush without mutating confirmed state.
    pub fn preview_path_brush_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: path_brush::ApplyPathBrushRequest = parse(request_json)?;
        let response = path_brush::preview_path_brush(
            &self.graph,
            &self.surfaces,
            &self.topology,
            &self.known_surfaces,
            &self.known_regions,
            request,
        )
        .map_err(to_js_error)?;
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
        self.known_surfaces = entry.before.known_surfaces.clone();
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
        self.known_surfaces = entry.after.known_surfaces.clone();
        self.topology = entry.after.topology.clone();
        self.known_regions = entry.after.known_regions.clone();
        self.path_brush_undo.push(entry);
        Ok(())
    }
    /// Generates one terrain cell's surface and applies it. See
    /// `terrain::generate_and_apply_terrain_cell`.
    pub fn generate_and_apply_terrain_cell_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = terrain::generate_and_apply_terrain_cell(
            &mut self.graph,
            &mut self.surfaces,
            self.terrain_mesh.as_ref(),
            request,
        )
        .map_err(to_js_error)?;
        self.remember(&response.surface_key);
        serialize(&response)
    }

    /// Regenerates a path's whole panel geometry (straight and
    /// semicircular-arc edges, with an optional single-edge notch) and
    /// applies only the difference against whatever this structure already
    /// holds -- the free-form path/wall brush's per-tick commit, and the
    /// generic replacement for a one-shot wall-with-door generation. Never
    /// generates a floor/ceiling itself. See
    /// `generation::generate_and_apply_path_extrusion`.
    pub fn generate_and_apply_path_extrusion_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = generation::generate_and_apply_path_extrusion(
            &mut self.graph,
            &mut self.surfaces,
            &self.known_surfaces,
            request,
        )
        .map_err(to_js_error)?;
        for key in &response.removed_surface_keys {
            self.forget(key);
        }
        for key in &response.added_surface_keys {
            self.remember(key);
        }
        serialize(&response)
    }

    /// Regenerates one closed boundary's cap (a floor, a ceiling, or any
    /// other flat or per-vertex-height polygon) and applies only the
    /// difference against whatever this structure already holds. See
    /// `generation::generate_and_apply_boundary_cap`.
    pub fn generate_and_apply_boundary_cap_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = generation::generate_and_apply_boundary_cap(
            &mut self.graph,
            &mut self.surfaces,
            &self.known_surfaces,
            request,
        )
        .map_err(to_js_error)?;
        for key in &response.removed_surface_keys {
            self.forget(key);
        }
        for key in &response.added_surface_keys {
            self.remember(key);
        }
        serialize(&response)
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
            &self.known_surfaces,
            request,
        )
        .map_err(to_js_error)?;
        for key in &response.removed_surface_keys {
            self.forget(key);
        }
        for key in &response.added_surface_keys {
            self.remember(key);
        }
        serialize(&response)
    }

    // ---- Clouds ----

    /// The connected component of same-`type` surfaces reachable from
    /// `seed` by shared graph nodes -- `ADR-0022`'s "cloud" query. See
    /// `geometry::connected_component`.
    pub fn cloud_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: CloudRequest = parse(request_json)?;
        let seed = surface_key_from_wire(&request.seed).map_err(to_js_error)?;
        let cloud = connected_component(
            &self.surfaces,
            &self.known_surfaces,
            &seed,
            &SurfaceType::new(request.surface_type),
        );
        let surface_keys: Vec<Vec<String>> = cloud.iter().map(surface_key_to_wire).collect();
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
            &self.known_surfaces,
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
        let mut surfaces = self
            .known_surfaces
            .iter()
            .filter_map(|key| {
                self.surfaces.surface(key).map(|surface| SurfaceSnapshot {
                    surface_key: surface_key_to_wire(key),
                    surface_type: surface.surface_type().as_str().to_owned(),
                    physical: surface.physical(),
                })
            })
            .collect::<Vec<_>>();
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

    #[wasm_bindgen_test]
    fn a_full_session_sequence_generates_moves_and_merges() {
        let mut session = ConstructionSession::new();

        session
            .set_terrain_mesh(2, 2, 1, 2, 0.0, 0.0)
            .expect("valid dimensions");

        let cell0 = session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":0,"module":{"name":"flat","cornerHeights":[1.0,1.0,1.0,1.0]},"surfaceType":"terrain","nodeIds":["n0","n1","n2","n3"],"edgeIds":["e0","e1","e2","e3"]}"#,
            )
            .expect("cell 0 generates");
        assert!(cell0.contains("n0"));

        let cell1 = session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":1,"module":{"name":"flat","cornerHeights":[1.0,1.0,1.0,1.0]},"surfaceType":"terrain","nodeIds":["n4","n5","n6","n7"],"edgeIds":["e4","e5","e6","e7"]}"#,
            )
            .expect("cell 1 generates");
        assert!(cell1.contains("n4"));

        let move_response = session
            .move_node_json(r#"{"nodeId":"n0","position":[9.0,9.0,9.0]}"#)
            .expect("n0 exists");
        assert!(move_response.contains("affectedSurfaceKeys"));

        let snapshot = session.snapshot_json().expect("snapshot always succeeds");
        assert!(snapshot.contains("\"n0\""));
        assert!(snapshot.contains("\"surfaces\""));
    }

    /// Regression test for a real bug found during `E3.8`'s end-to-end
    /// validation: a wall running along Z (this app's own default seed and
    /// its "generate wall" edit-mode trigger both build walls this way) had
    /// its top nodes collapse back onto the centerline
    /// (`grafting-procgen-structure-generation`'s `position_at` added
    /// `height` to the same axis as the wall's own length), so every
    /// wall/door mesh silently failed to triangulate and never appeared in
    /// `all_surface_meshes_json`. Plain `#[test]`, not `#[wasm_bindgen_test]`
    /// -- this crate's `wasm_bindgen_test`s are not wired into any CI job
    /// and do not run under a plain `cargo test`, which is exactly how this
    /// bug went uncaught despite `generating_a_notched_wall_exposes_three_sibling_meshes`
    /// already asserting the right mesh count.
    #[test]
    fn generating_a_terrain_cell_then_a_z_running_wall_exposes_all_four_meshes() {
        let mut session = ConstructionSession::new();
        session
            .set_terrain_mesh(2, 2, 1, 2, 0.0, 0.0)
            .expect("valid dimensions");
        session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":0,"module":{"name":"flat","cornerHeights":[1.0,1.0,1.0,1.0]},"surfaceType":"terrain","nodeIds":["tn0","tn1","tn2","tn3"],"edgeIds":["te0","te1","te2","te3"]}"#,
            )
            .expect("terrain cell generates");

        let request = json!({
            "edges": [{"start": [2.0, 0.0, 0.0], "end": [2.0, 0.0, 4.0], "curvature": "straight"}],
            "height": 3.0,
            "idPrefix": "z-wall-1",
            "surfaceType": "wall",
            "notch": {"startsAt": 0.25, "endsAt": 0.75, "surfaceType": "door"},
        })
        .to_string();
        session
            .generate_and_apply_path_extrusion_json(&request)
            .expect("wall generates");

        let meshes_json = session
            .all_surface_meshes_json()
            .expect("meshes always succeed");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(
            meshes.len(),
            4,
            "1 terrain + 3 wall/door pieces, every one triangulable"
        );
    }

    /// The TS adapter's `JSON.stringify` drops any key whose value is
    /// `undefined` -- a no-notch wall-brush call therefore sends a request
    /// with the `notch` key *absent*, not `null`. No prior test exercised
    /// that exact wire shape. Reported while testing `VTT-WALL-CORNER-WELD`:
    /// a wall drawn with the door UI removed still produced more than 4
    /// nodes.
    #[test]
    fn a_path_extrusion_request_with_no_notch_key_at_all_still_produces_exactly_four_nodes() {
        let mut session = ConstructionSession::new();
        let request = json!({
            "edges": [{"start": [0.0, 0.0, 0.0], "end": [4.0, 0.0, 0.0], "curvature": "straight"}],
            "height": 3.0,
            "idPrefix": "no-notch-1",
            "surfaceType": "wall",
        })
        .to_string();

        let response = session
            .generate_and_apply_path_extrusion_json(&request)
            .expect("wall generates");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["addedSurfaceKeys"].as_array().unwrap().len(), 1);

        let snapshot: serde_json::Value =
            serde_json::from_str(&session.snapshot_json().unwrap()).unwrap();
        assert_eq!(
            snapshot["nodes"].as_array().unwrap().len(),
            4,
            "no-notch wall must be exactly 4 nodes: {snapshot}"
        );
    }

    #[test]
    fn applying_path_brush_replaces_terrain_through_the_wasm_boundary() {
        let mut session = ConstructionSession::new();
        session
            .set_terrain_mesh(2, 2, 1, 2, 0.0, 0.0)
            .expect("valid dimensions");
        session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":0,"module":{"name":"flat","cornerHeights":[0.0,0.0,0.0,0.0]},"surfaceType":"terrain","nodeIds":["n0","n1","n2","n3"],"edgeIds":["e0","e1","e2","e3"]}"#,
            )
            .expect("terrain cell generates");

        let request = r#"{"operationId":"path-1","samples":[[0.5,0.5]],"brushShape":{"kind":"circle","radius":0.25},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;
        let before = session.snapshot_json().expect("snapshot before preview");
        let preview = session
            .preview_path_brush_json(request)
            .expect("path preview succeeds");
        assert!(preview.contains("\"path\""));
        assert_eq!(
            session.snapshot_json().unwrap(),
            before,
            "preview is non-mutating"
        );

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
        assert_eq!(meshes.len(), 1, "the pure-arc region must produce exactly one mesh: {meshes_json}");
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
        assert_eq!(meshes.len(), 1, "the looped stroke must produce exactly one mesh: {meshes_json}");
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

    #[wasm_bindgen_test]
    fn generating_a_terrain_cell_before_set_terrain_mesh_errors_cleanly() {
        let mut session = ConstructionSession::new();
        let error = session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":0,"module":{"name":"flat","cornerHeights":[1.0,1.0,1.0,1.0]},"surfaceType":"terrain","nodeIds":["n0","n1","n2","n3"],"edgeIds":["e0","e1","e2","e3"]}"#,
            )
            .unwrap_err();
        assert!(error.as_string().unwrap().contains("set_terrain_mesh"));
    }

    #[wasm_bindgen_test]
    fn invalid_json_is_rejected_not_panicking() {
        let mut session = ConstructionSession::new();
        let error = session.move_node_json("not json").unwrap_err();
        assert!(error.as_string().unwrap().contains("invalid request JSON"));
    }

    #[wasm_bindgen_test]
    fn merge_surfaces_updates_known_surfaces_so_the_snapshot_reflects_it() {
        let mut session = ConstructionSession::new();
        session
            .add_node_json(r#"{"id":"a","position":[0.0,0.0,0.0]}"#)
            .unwrap();
        session
            .add_node_json(r#"{"id":"b","position":[1.0,0.0,0.0]}"#)
            .unwrap();
        session
            .add_node_json(r#"{"id":"c","position":[1.0,1.0,0.0]}"#)
            .unwrap();
        session
            .add_node_json(r#"{"id":"d","position":[0.0,1.0,0.0]}"#)
            .unwrap();
        for (id, a, b) in [
            ("ab", "a", "b"),
            ("bc", "b", "c"),
            ("ca", "c", "a"),
            ("ac", "a", "c"),
            ("cd", "c", "d"),
            ("da", "d", "a"),
        ] {
            session
                .add_edge_json(&format!(r#"{{"id":"{id}","source":"{a}","target":"{b}"}}"#))
                .unwrap();
        }
        session
            .add_surface_json(r#"{"cycle":["a","b","c"],"surfaceType":"wall","physical":true}"#)
            .unwrap();
        session
            .add_surface_json(r#"{"cycle":["a","c","d"],"surfaceType":"wall","physical":true}"#)
            .unwrap();

        session
            .merge_surfaces_json(
                r#"{"a":["a","b","c"],"b":["a","c","d"],"merged":{"cycle":["a","b","c","d"],"surfaceType":"floor","physical":true}}"#,
            )
            .expect("merge succeeds");

        let snapshot = session.snapshot_json().unwrap();
        assert!(snapshot.contains("\"floor\""));
        assert!(
            !snapshot.contains("\"wall\""),
            "merged-away surfaces must not remain in the snapshot"
        );
    }

    #[wasm_bindgen_test]
    fn generating_a_terrain_cell_exposes_its_mesh() {
        let mut session = ConstructionSession::new();
        session
            .set_terrain_mesh(2, 2, 1, 2, 0.0, 0.0)
            .expect("valid dimensions");
        session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":0,"module":{"name":"flat","cornerHeights":[1.0,1.0,1.0,1.0]},"surfaceType":"terrain","nodeIds":["n0","n1","n2","n3"],"edgeIds":["e0","e1","e2","e3"]}"#,
            )
            .expect("cell 0 generates");

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
    fn generating_a_notched_wall_exposes_three_sibling_meshes() {
        let mut session = ConstructionSession::new();
        let request = json!({
            "edges": [{"start": [0.0, 0.0, 0.0], "end": [4.0, 0.0, 0.0], "curvature": "straight"}],
            "height": 3.0,
            "idPrefix": "notched-1",
            "surfaceType": "wall",
            "notch": {"startsAt": 0.25, "endsAt": 0.75, "surfaceType": "door"},
        })
        .to_string();

        session
            .generate_and_apply_path_extrusion_json(&request)
            .expect("wall with notch generates");

        let meshes_json = session
            .all_surface_meshes_json()
            .expect("meshes always succeed");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(
            meshes.len(),
            3,
            "left remainder, door, right remainder = three sibling surfaces"
        );
        for entry in &meshes {
            assert_eq!(
                entry["indices"].as_array().unwrap().len(),
                6,
                "each piece is a quad: two triangles"
            );
        }
    }

    #[wasm_bindgen_test]
    fn moving_a_node_changes_its_surfaces_refetched_mesh() {
        let mut session = ConstructionSession::new();
        session
            .add_node_json(r#"{"id":"a","position":[0.0,0.0,0.0]}"#)
            .unwrap();
        session
            .add_node_json(r#"{"id":"b","position":[1.0,0.0,0.0]}"#)
            .unwrap();
        session
            .add_node_json(r#"{"id":"c","position":[0.0,1.0,0.0]}"#)
            .unwrap();
        session
            .add_edge_json(r#"{"id":"ab","source":"a","target":"b"}"#)
            .unwrap();
        session
            .add_edge_json(r#"{"id":"bc","source":"b","target":"c"}"#)
            .unwrap();
        session
            .add_edge_json(r#"{"id":"ca","source":"c","target":"a"}"#)
            .unwrap();
        session
            .add_surface_json(r#"{"cycle":["a","b","c"],"surfaceType":"wall","physical":true}"#)
            .unwrap();

        let before = session
            .surface_mesh_json(r#"{"surfaceKey":["a","b","c"]}"#)
            .expect("mesh exists before move");

        session
            .move_node_json(r#"{"nodeId":"a","position":[5.0,5.0,5.0]}"#)
            .expect("move succeeds");

        let after = session
            .surface_mesh_json(r#"{"surfaceKey":["a","b","c"]}"#)
            .expect("mesh exists after move");

        assert_ne!(
            before, after,
            "moving a node must change its surface's refetched mesh"
        );
    }

    #[wasm_bindgen_test]
    fn surface_mesh_json_rejects_an_unregistered_key() {
        let session = ConstructionSession::new();
        let error = session
            .surface_mesh_json(r#"{"surfaceKey":["missing"]}"#)
            .unwrap_err();
        assert!(error.as_string().unwrap().contains("no mesh derivable"));
    }
}
