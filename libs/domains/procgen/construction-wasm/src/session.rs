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

use grafting_graph_core::{FormationInputs, Graph, GraphPrimitive, PrismGridMesh, SurfaceKey, SurfaceRegistry};

use crate::dto::{surface_key_from_wire, surface_key_to_wire};
use crate::editing::{self, SessionGraph};
use crate::mesh;
use crate::terrain;
use crate::wall;

fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, JsValue> {
    serde_json::from_str(json).map_err(|error| JsValue::from_str(&format!("invalid request JSON: {error}")))
}

fn serialize<T: Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| JsValue::from_str(&format!("failed to serialize response: {error}")))
}

fn to_js_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

/// One live editing session: a `Graph<[f32; 3], ()>` + `SurfaceRegistry`,
/// plus an optional `PrismGridMesh` terrain generation reads from. In-memory
/// only -- gone when the tab/Worker closes; see this crate's `AGENTS.md` for
/// why no persistence is built here.
#[wasm_bindgen]
pub struct ConstructionSession {
    graph: SessionGraph,
    surfaces: SurfaceRegistry,
    terrain_mesh: Option<PrismGridMesh>,
    /// This crate's own bookkeeping of every surface key currently
    /// registered, purely so [`Self::snapshot_json`] can enumerate them --
    /// `SurfaceRegistry` itself exposes no "all surfaces" iterator, and
    /// adding one would be a `grafting-graph-core` change, out of this
    /// crate's scope.
    known_surfaces: HashSet<SurfaceKey>,
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
            graph: Graph::try_from_parts(Vec::new(), Vec::new()).expect("an empty graph is always valid"),
            surfaces: SurfaceRegistry::new(),
            terrain_mesh: None,
            known_surfaces: HashSet::new(),
        }
    }

    fn remember(&mut self, wire_key: &[String]) {
        let key = surface_key_from_wire(wire_key).expect("wire-formatted key was produced internally and must parse back");
        self.known_surfaces.insert(key);
    }

    fn forget(&mut self, wire_key: &[String]) {
        let key = surface_key_from_wire(wire_key).expect("wire-formatted key was produced internally and must parse back");
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
        let response = editing::add_surface(&self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
        self.remember(&response.surface_key);
        serialize(&response)
    }

    // ---- The five construction.rs operations ----

    /// Moves a node. See `editing::apply_move_node`.
    pub fn move_node_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = editing::apply_move_node(&mut self.graph, &self.surfaces, request).map_err(to_js_error)?;
        serialize(&response)
    }

    /// Deletes a node and repairs the hole it leaves. See `editing::apply_delete_node`.
    pub fn delete_node_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = editing::apply_delete_node(&mut self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
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
        let response = editing::apply_merge_surfaces(&self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
        self.forget(&a);
        self.forget(&b);
        self.remember(&response.surface_key);
        serialize(&response)
    }

    /// Divides one surface into two. See `editing::apply_split_surface`.
    pub fn split_surface_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: editing::SplitSurfaceRequest = parse(request_json)?;
        let original = request.key.clone();
        let response = editing::apply_split_surface(&self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
        self.forget(&original);
        self.remember(&response.first_key);
        self.remember(&response.second_key);
        serialize(&response)
    }

    /// Duplicates a surface. See `editing::apply_duplicate_surface`.
    pub fn duplicate_surface_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = editing::apply_duplicate_surface(&mut self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
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
            return Err(JsValue::from_str("set_terrain_mesh: dimensions must be greater than 0"));
        }
        if width > 512 || height > 512 || layers > 64 {
            return Err(JsValue::from_str("set_terrain_mesh: grid size exceeds maximum limits"));
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

    /// Generates one terrain cell's surface and applies it. See
    /// `terrain::generate_and_apply_terrain_cell`.
    pub fn generate_and_apply_terrain_cell_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response =
            terrain::generate_and_apply_terrain_cell(&mut self.graph, &mut self.surfaces, self.terrain_mesh.as_ref(), request)
                .map_err(to_js_error)?;
        self.remember(&response.surface_key);
        serialize(&response)
    }

    /// Generates a wall's (and its door's) surface pieces and applies them.
    /// See `wall::generate_and_apply_wall`.
    pub fn generate_and_apply_wall_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = wall::generate_and_apply_wall(&mut self.graph, &mut self.surfaces, request).map_err(to_js_error)?;
        for piece in &response.pieces {
            self.remember(&piece.surface_key);
        }
        serialize(&response)
    }

    // ---- Mesh derivation ----

    /// Every currently-known surface's triangulated mesh, in stable key
    /// order -- the one bootstrap call a renderer uses to draw everything
    /// already in the session. See `mesh::all_surface_meshes`.
    pub fn all_surface_meshes_json(&self) -> Result<String, JsValue> {
        let meshes = mesh::all_surface_meshes(&self.graph, &self.surfaces, &self.known_surfaces);
        serialize(&meshes)
    }

    /// One surface's triangulated mesh, by key -- what a caller re-fetches
    /// for each entry in an operation's `affectedSurfaceKeys` after a
    /// mutation, instead of re-fetching everything. See `mesh::surface_mesh`.
    pub fn surface_mesh_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let dto = mesh::surface_mesh(&self.graph, &self.surfaces, request).map_err(to_js_error)?;
        serialize(&dto)
    }

    // ---- Introspection ----

    /// The session's current nodes, edges, and surfaces, for a caller to
    /// render from without re-deriving state.
    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        let snapshot = self.graph.snapshot();
        let nodes = snapshot
            .nodes()
            .iter()
            .map(|node| NodeSnapshot { id: node.id().as_str().to_owned(), position: *node.data() })
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
        let surfaces = self
            .known_surfaces
            .iter()
            .filter_map(|key| {
                self.surfaces.surface(key).map(|surface| SurfaceSnapshot {
                    surface_key: surface_key_to_wire(key),
                    surface_type: surface.surface_type().as_str().to_owned(),
                    physical: surface.physical(),
                })
            })
            .collect();
        serialize(&SnapshotResponse { nodes, edges, surfaces })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use serde_json::json;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn all_role_node_ids_json() -> serde_json::Value {
        let map: HashMap<String, String> = crate::dto::ALL_WALL_NODE_ROLES
            .into_iter()
            .map(|role| {
                let wire = crate::dto::wall_node_role_wire_name(role);
                (wire.to_string(), format!("{wire}-id"))
            })
            .collect();
        serde_json::to_value(map).unwrap()
    }

    fn all_role_edge_ids_json() -> serde_json::Value {
        let mut map: HashMap<String, String> = HashMap::new();
        for &a in &crate::dto::ALL_WALL_NODE_ROLES {
            for &b in &crate::dto::ALL_WALL_NODE_ROLES {
                if a != b {
                    let wire = crate::dto::wall_edge_role_pair_wire_name(a, b);
                    map.insert(wire.clone(), format!("{wire}-edge"));
                }
            }
        }
        serde_json::to_value(map).unwrap()
    }

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
        session.add_node_json(r#"{"id":"a","position":[0.0,0.0,0.0]}"#).unwrap();
        session.add_node_json(r#"{"id":"b","position":[1.0,0.0,0.0]}"#).unwrap();
        session.add_node_json(r#"{"id":"c","position":[1.0,1.0,0.0]}"#).unwrap();
        session.add_node_json(r#"{"id":"d","position":[0.0,1.0,0.0]}"#).unwrap();
        for (id, a, b) in [("ab", "a", "b"), ("bc", "b", "c"), ("ca", "c", "a"), ("ac", "a", "c"), ("cd", "c", "d"), ("da", "d", "a")] {
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
        assert!(!snapshot.contains("\"wall\""), "merged-away surfaces must not remain in the snapshot");
    }

    #[wasm_bindgen_test]
    fn generating_a_terrain_cell_exposes_its_mesh() {
        let mut session = ConstructionSession::new();
        session.set_terrain_mesh(2, 2, 1, 2, 0.0, 0.0).expect("valid dimensions");
        session
            .generate_and_apply_terrain_cell_json(
                r#"{"cell":0,"module":{"name":"flat","cornerHeights":[1.0,1.0,1.0,1.0]},"surfaceType":"terrain","nodeIds":["n0","n1","n2","n3"],"edgeIds":["e0","e1","e2","e3"]}"#,
            )
            .expect("cell 0 generates");

        let meshes_json = session.all_surface_meshes_json().expect("meshes always succeed");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(meshes.len(), 1);
        assert_eq!(meshes[0]["positions"].as_array().unwrap().len(), 12, "4 vertices * 3 components");
        assert_eq!(meshes[0]["indices"].as_array().unwrap().len(), 6, "2 triangles * 3 indices");
    }

    #[wasm_bindgen_test]
    fn generating_a_door_wall_exposes_three_sibling_meshes() {
        let mut session = ConstructionSession::new();
        let request = json!({
            "wall": {"start": [0.0, 0.0, 0.0], "end": [4.0, 0.0, 0.0], "height": 3.0},
            "door": {"opensAt": 0.25, "closesAt": 0.75},
            "wallType": "wall",
            "doorType": "door",
            "nodeIds": all_role_node_ids_json(),
            "edgeIds": all_role_edge_ids_json(),
        })
        .to_string();

        session.generate_and_apply_wall_json(&request).expect("wall with door generates");

        let meshes_json = session.all_surface_meshes_json().expect("meshes always succeed");
        let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
        assert_eq!(meshes.len(), 3, "left remainder, door, right remainder = three sibling surfaces");
        for entry in &meshes {
            assert_eq!(entry["indices"].as_array().unwrap().len(), 6, "each piece is a quad: two triangles");
        }
    }

    #[wasm_bindgen_test]
    fn moving_a_node_changes_its_surfaces_refetched_mesh() {
        let mut session = ConstructionSession::new();
        session.add_node_json(r#"{"id":"a","position":[0.0,0.0,0.0]}"#).unwrap();
        session.add_node_json(r#"{"id":"b","position":[1.0,0.0,0.0]}"#).unwrap();
        session.add_node_json(r#"{"id":"c","position":[0.0,1.0,0.0]}"#).unwrap();
        session.add_edge_json(r#"{"id":"ab","source":"a","target":"b"}"#).unwrap();
        session.add_edge_json(r#"{"id":"bc","source":"b","target":"c"}"#).unwrap();
        session.add_edge_json(r#"{"id":"ca","source":"c","target":"a"}"#).unwrap();
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

        assert_ne!(before, after, "moving a node must change its surface's refetched mesh");
    }

    #[wasm_bindgen_test]
    fn surface_mesh_json_rejects_an_unregistered_key() {
        let session = ConstructionSession::new();
        let error = session.surface_mesh_json(r#"{"surfaceKey":["missing"]}"#).unwrap_err();
        assert!(error.as_string().unwrap().contains("no mesh derivable"));
    }
}
