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
use crate::region_editing;
use crate::region_overlay;
use crate::sweep_bridge;

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

struct RegionOverlayHistoryEntry {
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
    pub(crate) graph: SessionGraph,
    pub(crate) surfaces: SurfaceRegistry,
    pub(crate) topology: ContourTopology,
    pub(crate) known_regions: HashSet<RegionId>,
    region_overlay_undo: Vec<RegionOverlayHistoryEntry>,
    region_overlay_redo: Vec<RegionOverlayHistoryEntry>,
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
            region_overlay_undo: Vec::new(),
            region_overlay_redo: Vec::new(),
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

    /// Runs the graph-neutral sweep planner without mutating session state.
    pub fn plan_sweep_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: sweep_bridge::PlanSweepRequest = parse(request_json)?;
        let response = sweep_bridge::plan_sweep(request).map_err(to_js_error)?;
        serialize(&response)
    }

    // ---- Terrain mesh lifecycle ----

    // ---- Generate-and-apply ----

    /// Applies an application-generated patch over an exact, already-resolved
    /// set of source regions. Geometry and product policy are caller-owned;
    /// this method only executes the generic overlay atomically.
    pub fn apply_region_overlay_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: region_overlay::ApplyRegionOverlayRequest = parse(request_json)?;
        let operation_id = request.operation_id.clone();
        let before = ConstructionState {
            graph: self.graph.clone(),
            surfaces: self.surfaces.clone(),
            topology: self.topology.clone(),
            known_regions: self.known_regions.clone(),
        };
        let response = region_overlay::apply_region_overlay(
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
        self.region_overlay_undo.push(RegionOverlayHistoryEntry {
            operation_id,
            before,
            after,
        });
        self.region_overlay_redo.clear();
        serialize(&response)
    }

    /// Restores the state immediately before one generic overlay.
    pub fn undo_region_overlay(&mut self, operation_id: &str) -> Result<(), JsValue> {
        let Some(entry) = self.region_overlay_undo.pop() else {
            return Err(JsValue::from_str("no region overlay is available to undo"));
        };
        if entry.operation_id != operation_id {
            self.region_overlay_undo.push(entry);
            return Err(JsValue::from_str(
                "region overlay undo order does not match session history",
            ));
        }
        self.graph = entry.before.graph.clone();
        self.surfaces = entry.before.surfaces.clone();
        self.topology = entry.before.topology.clone();
        self.known_regions = entry.before.known_regions.clone();
        self.region_overlay_redo.push(entry);
        Ok(())
    }

    /// Restores the state immediately after one undone generic overlay.
    pub fn redo_region_overlay(&mut self, operation_id: &str) -> Result<(), JsValue> {
        let Some(entry) = self.region_overlay_redo.pop() else {
            return Err(JsValue::from_str("no region overlay is available to redo"));
        };
        if entry.operation_id != operation_id {
            self.region_overlay_redo.push(entry);
            return Err(JsValue::from_str(
                "region overlay redo order does not match session history",
            ));
        }
        self.graph = entry.after.graph.clone();
        self.surfaces = entry.after.surfaces.clone();
        self.topology = entry.after.topology.clone();
        self.known_regions = entry.after.known_regions.clone();
        self.region_overlay_undo.push(entry);
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
