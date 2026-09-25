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
use crate::geometry::connected_component;
use crate::grid_generation;
use crate::mesh::{self, region_id_to_wire};
use crate::patch_replacement;
use crate::panel_runs;
use crate::pins::{self, Cutting, HostTracer, SurfaceCapabilities};
use crate::region_annotations::RegionAnnotations;
use crate::region_editing;
use crate::region_props;
use crate::region_overlay;

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
    spatial_index: crate::spatial_index::UniformGridIndex,
    annotations: RegionAnnotations,
}

/// One undoable replacement, holding the *other* state: the one before it
/// while it sits on the undo stack, the one it was undone from while it sits
/// on the redo stack. Undo and redo swap it with the live state, so neither
/// copies the map -- keeping a full `before` and `after` per entry cost two
/// whole-map copies on every road commit and one more on every undo or redo.
struct RegionOverlayHistoryEntry {
    operation_id: String,
    state: ConstructionState,
}

/// A transaction in progress: the live state as it was when it began.
///
/// Every mutation between `begin_transaction` and `commit_transaction` lands
/// on the live state as usual, but none records history of its own. Commit
/// records the whole transaction as one undo entry; rollback swaps the saved
/// state back, so a refused step leaves nothing behind -- edge splits
/// included.
struct OpenTransaction {
    id: String,
    before: ConstructionState,
    /// Whether any mutation ran. A transaction that changed nothing records no entry.
    mutated: bool,
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
    pub(crate) spatial_index: crate::spatial_index::UniformGridIndex,
    pub(crate) annotations: RegionAnnotations,
    /// Session configuration rather than edit state: undo never touches it.
    pub(crate) surface_capabilities: SurfaceCapabilities,
    region_overlay_undo: Vec<RegionOverlayHistoryEntry>,
    region_overlay_redo: Vec<RegionOverlayHistoryEntry>,
    open_transaction: Option<OpenTransaction>,
}

impl ConstructionSession {
    fn current_state(&self) -> ConstructionState {
        ConstructionState {
            graph: self.graph.clone(),
            surfaces: self.surfaces.clone(),
            topology: self.topology.clone(),
            known_regions: self.known_regions.clone(),
            spatial_index: self.spatial_index.clone(),
            annotations: self.annotations.clone(),
        }
    }

    /// Records `state` as the undo entry for `operation_id`, unless a
    /// transaction is open: then the transaction's own entry covers it.
    fn record_history(&mut self, operation_id: String, state: ConstructionState) {
        if self.open_transaction.is_some() {
            return;
        }
        self.region_overlay_undo.push(RegionOverlayHistoryEntry {
            operation_id,
            state,
        });
        self.region_overlay_redo.clear();
    }

    pub(crate) fn begin(&mut self, id: &str) -> Result<(), String> {
        if let Some(open) = &self.open_transaction {
            return Err(format!(
                "transaction \"{id}\" cannot begin while \"{}\" is open",
                open.id
            ));
        }
        self.open_transaction = Some(OpenTransaction {
            id: id.to_owned(),
            before: self.current_state(),
            mutated: false,
        });
        Ok(())
    }

    fn take_open(&mut self, id: &str) -> Result<OpenTransaction, String> {
        match self.open_transaction.take() {
            Some(open) if open.id == id => Ok(open),
            Some(open) => {
                let message = format!("transaction \"{id}\" is not open; \"{}\" is", open.id);
                self.open_transaction = Some(open);
                Err(message)
            }
            None => Err(format!("transaction \"{id}\" is not open")),
        }
    }

    /// Returns whether the transaction was recorded as an undo entry: only
    /// one that mutated something is, so callers keep their own history in
    /// step by recording exactly when this says so.
    pub(crate) fn commit(&mut self, id: &str) -> Result<bool, String> {
        let open = self.take_open(id)?;
        if !open.mutated {
            return Ok(false);
        }
        self.record_history(open.id, open.before);
        Ok(true)
    }

    pub(crate) fn rollback(&mut self, id: &str) -> Result<(), String> {
        let mut open = self.take_open(id)?;
        self.swap_state(&mut open.before);
        Ok(())
    }
}

impl Default for ConstructionSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl ConstructionSession {
    /// Generates an indexed analytic cap without mutating the live graph.
    pub fn profile_cap_json(&self, json: &str) -> Result<String, JsValue> {
        let request = parse::<grafting_graph_core::profile_cap_patch::CapRequest>(json)?;
        serialize(
            &grafting_graph_core::profile_cap_patch::generate_cap_patch(request)
                .map_err(to_js_error)?,
        )
    }

    /// Evaluates a batch of generic curve-authoring commands without mutation.
    pub fn bezier_batch_json(&self, json: &str) -> Result<String, JsValue> {
        let request = parse::<grafting_graph_core::bezier_commands::CurveBatch>(json)?;
        let result = grafting_graph_core::bezier_commands::execute(request).map_err(to_js_error)?;
        serialize(&result)
    }

    /// Plans a generic curve graph insertion without changing the session.
    pub fn bezier_network_json(&self, json: &str) -> Result<String, JsValue> {
        let request = parse::<grafting_graph_core::bezier_network::NetworkRequest>(json)?;
        serialize(&grafting_graph_core::bezier_network::plan(request).map_err(to_js_error)?)
    }

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
            spatial_index: crate::spatial_index::UniformGridIndex::default(),
            annotations: RegionAnnotations::default(),
            surface_capabilities: SurfaceCapabilities::new(),
            region_overlay_undo: Vec::new(),
            region_overlay_redo: Vec::new(),
            open_transaction: None,
        }
    }

    // ---- Transactions ----

    /// Starts one atomic unit of work. See `OpenTransaction`.
    pub fn begin_transaction(&mut self, id: &str) -> Result<(), JsValue> {
        self.begin(id).map_err(to_js_error)
    }

    /// Ends the open transaction, recording it as a single undo entry when it
    /// changed anything. Returns whether it was recorded.
    pub fn commit_transaction(&mut self, id: &str) -> Result<bool, JsValue> {
        self.commit(id).map_err(to_js_error)
    }

    /// Ends the open transaction by restoring the state it began from.
    pub fn rollback_transaction(&mut self, id: &str) -> Result<(), JsValue> {
        self.rollback(id).map_err(to_js_error)
    }

    /// Keeps `known_regions` and `spatial_index` in step with whatever an atomic edit created,
    /// affected, or removed, so queries never enumerate stale regions or miss newly created ones.
    /// Re-resolves pinned nodes first, so the bookkeeping below sees every
    /// region that re-resolution moved.
    fn track(&mut self, outcome: &mut region_editing::RegionEditOutcomeDto) {
        if let Some(open) = self.open_transaction.as_mut() {
            open.mutated = true;
        }
        let orphaned_hosts = self.annotations.retain_live(&self.topology, &self.graph);
        pins::settle(
            &mut self.graph,
            &self.topology,
            &self.annotations.pins,
            &orphaned_hosts,
            outcome,
        );
        for key in &outcome.created_surface_keys {
            if let Ok(id) = mesh::region_id_from_wire(key) {
                self.known_regions.insert(id.clone());
                if let Some(bounds) =
                    crate::spatial_index::RegionBounds::of_region(&self.graph, &self.topology, &id)
                {
                    self.spatial_index.insert(id, bounds);
                }
            }
        }
        for key in &outcome.affected_surface_keys {
            if let Ok(id) = mesh::region_id_from_wire(key) {
                if let Some(bounds) =
                    crate::spatial_index::RegionBounds::of_region(&self.graph, &self.topology, &id)
                {
                    self.spatial_index.insert(id, bounds);
                }
            }
        }
        for key in &outcome.removed_surface_keys {
            if let Ok(id) = mesh::region_id_from_wire(key) {
                self.known_regions.remove(&id);
                self.spatial_index.remove(&id);
            }
        }
    }

    /// Fills in what the session keeps beside the region: its property bag,
    /// its nodes' pins, and how its edges are traced on their host.
    fn annotate(&self, dto: &mut region_editing::RegionTopologyDto) {
        let annotations = &self.annotations;
        if let Ok(id) = mesh::region_id_from_wire(&dto.surface_key) {
            dto.props = annotations.props.get(&id).cloned();
        }
        if annotations.pins.is_empty() {
            return;
        }
        for node in &mut dto.nodes {
            node.pin = grafting_graph_core::NodeId::new(node.id.clone())
                .ok()
                .and_then(|id| annotations.pins.get(&id))
                .map(Into::into);
        }
        let tracer = HostTracer::new(annotations);
        let mut faces = std::collections::BTreeMap::new();
        for edge_dto in dto
            .outer_loops
            .iter_mut()
            .chain(dto.holes.iter_mut())
            .flatten()
        {
            let (Ok(edge_id), Ok(start)) = (
                grafting_graph_core::ContourEdgeId::new(edge_dto.edge_id.clone()),
                grafting_graph_core::NodeId::new(edge_dto.start_node_id.clone()),
            ) else {
                continue;
            };
            let Some(edge) = self.topology.edge(&edge_id) else {
                continue;
            };
            edge_dto.host_curve =
                tracer.host_curve(&self.graph, &self.topology, &mut faces, edge, &start);
        }
    }

    fn cutting(&self) -> Cutting<'_> {
        Cutting::new(&self.annotations, &self.surface_capabilities)
    }

    /// Exchanges the live construction state with a history entry's.
    fn swap_state(&mut self, state: &mut ConstructionState) {
        std::mem::swap(&mut self.graph, &mut state.graph);
        std::mem::swap(&mut self.surfaces, &mut state.surfaces);
        std::mem::swap(&mut self.topology, &mut state.topology);
        std::mem::swap(&mut self.known_regions, &mut state.known_regions);
        std::mem::swap(&mut self.spatial_index, &mut state.spatial_index);
        std::mem::swap(&mut self.annotations, &mut state.annotations);
    }

    // ---- Bootstrapping ----

    /// Unregisters a surface outright and prunes any nodes it orphaned. See
    /// `editing::remove_surface`.
    pub fn remove_surface_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: editing::RemoveSurfaceRequest = parse(request_json)?;
        let mut response = editing::remove_surface(
            &mut self.graph,
            &mut self.surfaces,
            &mut self.topology,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    // ---- Atomic region edits (the analytic edit vocabulary) ----

    /// Generic closed-contour union/subtraction. Product selection stays in the caller.
    pub fn planar_boolean_json(&self, request_json: &str) -> Result<String, JsValue> {
        #[derive(serde::Deserialize)]
        struct Request {
            subject: Vec<grafting_graph_core::PlanarShape>,
            clip: Vec<grafting_graph_core::PlanarShape>,
            operation: String,
        }
        let request: Request = parse(request_json)?;
        let operation = match request.operation.as_str() {
            "union" => grafting_graph_core::PlanarBoolean::Union,
            "difference" => grafting_graph_core::PlanarBoolean::Difference,
            "extend" => grafting_graph_core::PlanarBoolean::Extend,
            _ => return Err(to_js_error("unknown planar operation".to_string())),
        };
        serialize(
            &grafting_graph_core::planar_boolean(&request.subject, &request.clip, operation)
                .map_err(to_js_error)?,
        )
    }

    /// Resolves a complete directed motion cascade without mutating the session.
    pub fn plan_motion_json(&self, request_json: &str) -> Result<String, JsValue> {
        serialize(
            &region_editing::plan_motion(&self.graph, parse(request_json)?).map_err(to_js_error)?,
        )
    }

    /// Validates and applies all vertex positions atomically, tracking regions once.
    pub fn move_vertices_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let mut response = region_editing::apply_move_vertices(
            &mut self.graph,
            &mut self.topology,
            parse(request_json)?,
        )
        .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `MoveVertex`. See `region_editing::apply_move_vertex`.
    pub fn move_vertex_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response =
            region_editing::apply_move_vertex(&mut self.graph, &self.topology, request)
                .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `InsertVertex`. See `region_editing::apply_insert_vertex`.
    pub fn insert_vertex_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response =
            region_editing::apply_insert_vertex(&mut self.graph, &mut self.topology, request)
                .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `RemoveVertex`. See `region_editing::apply_remove_vertex`.
    pub fn remove_vertex_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response =
            region_editing::apply_remove_vertex(&mut self.graph, &mut self.topology, request)
                .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `RetypeEdge`. See `region_editing::apply_retype_edge`.
    pub fn retype_edge_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response =
            region_editing::apply_retype_edge(&mut self.topology, request).map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `MoveEdge`. See `region_editing::apply_move_edge`.
    pub fn move_edge_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response =
            region_editing::apply_move_edge(&mut self.graph, &self.topology, request)
                .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `MoveRegion`. See `region_editing::apply_move_region`.
    pub fn move_region_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response =
            region_editing::apply_move_region(&mut self.graph, &self.topology, request)
                .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// `DeleteRegion`. See `region_editing::apply_delete_region`.
    pub fn delete_region_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response = region_editing::apply_delete_region(
            &mut self.graph,
            &mut self.topology,
            &mut self.surfaces,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    // ---- Pins and cut capabilities ----

    /// Replaces the whole per-surface-type capability table. Configuration,
    /// not edit state: it is never undone and moves no geometry.
    pub fn set_surface_capabilities_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        self.surface_capabilities = pins::capability_table(parse(request_json)?);
        Ok("{}".to_owned())
    }

    /// Pins nodes to host faces at relative `(u, v)` and moves them there.
    /// See `pins::pin_nodes`.
    pub fn pin_nodes_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let mut response = pins::pin_nodes(
            &self.graph,
            &self.topology,
            &mut self.annotations.pins,
            parse(request_json)?,
        )
        .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// Drops pins; the nodes stay where they are.
    pub fn unpin_nodes_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let mut response = pins::unpin_nodes(&self.topology, &mut self.annotations.pins, parse(request_json)?)
            .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// Gives an edge pinned at both ends to one host a cubic path in that
    /// host's `(u, v)`, or with `controls` null a straight one there. See
    /// `pins::pin_edge_curve`.
    pub fn pin_edge_curve_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let mut response = pins::pin_edge_curve(
            &self.topology,
            &self.annotations.pins,
            &mut self.annotations.curves,
            parse(request_json)?,
        )
        .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// A pinned region's outer loop traced on its host, as `(u, v)` there.
    pub fn host_outline_json(&self, request_json: &str) -> Result<String, JsValue> {
        serialize(
            &pins::host_outline(
                &self.graph,
                &self.topology,
                HostTracer::new(&self.annotations),
                parse(request_json)?,
            )
            .map_err(to_js_error)?,
        )
    }

    /// World points as unclamped `(u, v)` on an upright host face.
    pub fn project_to_host_json(&self, request_json: &str) -> Result<String, JsValue> {
        serialize(
            &pins::project_to_host(&self.graph, &self.topology, parse(request_json)?)
                .map_err(to_js_error)?,
        )
    }

    /// `(u, v)` on an upright host face as world points, without mutating.
    pub fn resolve_on_host_json(&self, request_json: &str) -> Result<String, JsValue> {
        serialize(
            &pins::resolve_on_host(&self.graph, &self.topology, parse(request_json)?)
                .map_err(to_js_error)?,
        )
    }

    // ---- Region props and panel runs ----

    /// Replaces the regions' property bag, or clears it when `props` is
    /// null. See `region_props::set_region_props`.
    pub fn set_region_props_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let mut response =
            region_props::set_region_props(
            &self.topology,
            &mut self.annotations.props,
            parse(request_json)?,
        )
                .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// The chain of cuttable upright panels continuing the requested one
    /// through shared vertical sides. See `panel_runs::panel_run_of`.
    pub fn panel_run_json(&self, request_json: &str) -> Result<String, JsValue> {
        serialize(
            &panel_runs::panel_run_of(
                &self.graph,
                &self.topology,
                &self.surfaces,
                &self.surface_capabilities,
                parse(request_json)?,
            )
            .map_err(to_js_error)?,
        )
    }

    /// What a brush footprint currently covers, before anything is
    /// generated -- the creation-side counterpart to `region_topology_json`.
    /// The engine reports; the caller's own per-type table decides what to
    /// do about it. See `footprint::footprint_coverage`.
    pub fn footprint_coverage_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = footprint::footprint_coverage(
            &self.graph,
            &self.topology,
            &self.surfaces,
            Some(&self.spatial_index),
            request,
        )
        .map_err(to_js_error)?;
        serialize(&response)
    }

    /// Registers a whole generated patch -- nodes, shared boundary edges,
    /// and the regions over them -- in one call. See
    /// `region_editing::apply_add_patch` for why a generator must name its
    /// own edges rather than let each face mint its own.
    pub fn add_patch_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut dto = region_editing::apply_add_patch(
            &mut self.graph,
            &mut self.topology,
            &mut self.surfaces,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&mut dto.outcome);
        serialize(&dto)
    }

    /// Atomically replaces exact application-selected regions with an
    /// application-generated patch. Unlike a geometric overlay, this keeps
    /// no remainder and makes no product decision; it simply publishes the
    /// replacement iff every target face can be registered.
    pub fn apply_patch_replacement_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: patch_replacement::ApplyPatchReplacementRequest = parse(request_json)?;
        let operation_id = request.operation_id.clone();
        let annotations = self
            .open_transaction
            .is_none()
            .then(|| self.annotations.clone());
        let (mut response, previous) = patch_replacement::apply_patch_replacement(
            &mut self.graph,
            &mut self.surfaces,
            &mut self.topology,
            &mut self.known_regions,
            request,
        )
        .map_err(to_js_error)?;
        let Some(annotations) = annotations else {
            self.track(&mut response.outcome);
            return serialize(&response);
        };
        // The index is updated in place by `track`, so its previous state is
        // the one piece still copied.
        let spatial_index = self.spatial_index.clone();
        self.track(&mut response.outcome);
        self.record_history(
            operation_id,
            ConstructionState {
                graph: previous.graph,
                surfaces: previous.surfaces,
                topology: previous.topology,
                known_regions: previous.known_regions,
                spatial_index,
                annotations,
            },
        );
        serialize(&response)
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

    /// One irregular quad grid, generated against the contours the request
    /// names as constraints. Pure -- reads nothing from this session and
    /// mutates nothing in it.
    ///
    /// The caller applies the result itself through `add_patch`, because
    /// doing it here would mean minting node ids and sampling a height for
    /// every new corner, neither of which this bridge has any business
    /// deciding. See `grid_generation::irregular_quad_grid`.
    pub fn irregular_quad_grid_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = grid_generation::irregular_quad_grid(request).map_err(to_js_error)?;
        serialize(&response)
    }

    /// Which of the given XZ points already sit inside a region -- what a
    /// generator consults so it only builds over open ground. See
    /// `footprint::classify_points`.
    pub fn classify_points_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let response = footprint::classify_points(
            &self.graph,
            &self.topology,
            &self.surfaces,
            Some(&self.spatial_index),
            request,
        )
        .map_err(to_js_error)?;
        serialize(&response)
    }

    /// `DuplicateRegion`. See `region_editing::apply_duplicate_region`.
    pub fn duplicate_region_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request = parse(request_json)?;
        let mut response = region_editing::apply_duplicate_region(
            &mut self.graph,
            &mut self.topology,
            &mut self.surfaces,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&mut response);
        serialize(&response)
    }

    /// One region's live boundary, in this crate's own deterministic order.
    /// See `region_editing::region_topology`.
    pub fn region_topology_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: region_editing::RegionRequest = parse(request_json)?;
        let region = mesh::region_id_from_wire(&request.surface_key).map_err(to_js_error)?;
        let mut dto =
            region_editing::region_topology(&self.graph, &self.topology, &self.surfaces, &region)
                .map_err(to_js_error)?;
        if let Some(dto) = dto.as_mut() {
            self.annotate(dto);
        }
        serialize(&dto)
    }

    /// Every registered region's boundary -- the edit-mode bootstrap call.
    /// See `region_editing::all_region_topologies`.
    pub fn all_region_topologies_json(&self) -> Result<String, JsValue> {
        let mut dtos =
            region_editing::all_region_topologies(&self.graph, &self.topology, &self.surfaces)
                .map_err(to_js_error)?;
        dtos.iter_mut().for_each(|dto| self.annotate(dto));
        serialize(&dtos)
    }

    /// Answers pure questions about contour geometry -- where a curve runs,
    /// how long it is, the span between two parameters. Reads nothing from
    /// the session. See `contour_query`.
    pub fn contour_query_json(&self, request_json: &str) -> Result<String, JsValue> {
        let queries: Vec<crate::contour_query::ContourQuery> = parse(request_json)?;
        serialize(&crate::contour_query::answer(&queries).map_err(to_js_error)?)
    }

    /// Where ground-plane points project onto the curves a surface was swept
    /// from. See `field_query`.
    pub fn field_query_json(&self, request_json: &str) -> Result<String, JsValue> {
        let query: crate::field_query::FieldQuery = parse(request_json)?;
        serialize(&crate::field_query::answer(&query))
    }

    /// Every bezier boundary edge a region uses. See `region_editing::curved_edges`.
    pub fn curved_edges_json(&self) -> Result<String, JsValue> {
        serialize(&region_editing::curved_edges(&self.graph, &self.topology))
    }

    /// Region boundaries intersecting a local XZ extent, serialized once.
    pub fn region_topologies_in_bounds_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: region_editing::RegionBoundsRequest = parse(request_json)?;
        let mut dtos = region_editing::region_topologies_in_bounds(
            &self.graph,
            &self.topology,
            &self.surfaces,
            &self.known_regions,
            Some(&self.spatial_index),
            &request,
        )
        .map_err(to_js_error)?;
        dtos.iter_mut().for_each(|dto| self.annotate(dto));
        serialize(&dtos)
    }

    // ---- Terrain mesh lifecycle ----

    // ---- Generate-and-apply ----

    /// Applies an application-generated patch over an exact, already-resolved
    /// set of source regions. Geometry and product policy are caller-owned;
    /// this method only executes the generic overlay atomically.
    pub fn apply_region_overlay_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        let request: region_overlay::ApplyRegionOverlayRequest = parse(request_json)?;
        let operation_id = request.operation_id.clone();
        let before = self
            .open_transaction
            .is_none()
            .then(|| self.current_state());
        let mut response = region_overlay::apply_region_overlay(
            &mut self.graph,
            &mut self.surfaces,
            &mut self.topology,
            &mut self.known_regions,
            request,
        )
        .map_err(to_js_error)?;
        self.track(&mut response.outcome);
        if let Some(before) = before {
            self.record_history(operation_id, before);
        }
        serialize(&response)
    }

    /// Restores the state immediately before one generic overlay.
    pub fn undo_region_overlay(&mut self, operation_id: &str) -> Result<(), JsValue> {
        if self.open_transaction.is_some() {
            return Err(JsValue::from_str("cannot undo while a transaction is open"));
        }
        let Some(mut entry) = self.region_overlay_undo.pop() else {
            return Err(JsValue::from_str("no region overlay is available to undo"));
        };
        if entry.operation_id != operation_id {
            self.region_overlay_undo.push(entry);
            return Err(JsValue::from_str(
                "region overlay undo order does not match session history",
            ));
        }
        self.swap_state(&mut entry.state);
        self.region_overlay_redo.push(entry);
        Ok(())
    }

    /// Restores the state immediately after one undone generic overlay.
    pub fn redo_region_overlay(&mut self, operation_id: &str) -> Result<(), JsValue> {
        if self.open_transaction.is_some() {
            return Err(JsValue::from_str("cannot redo while a transaction is open"));
        }
        let Some(mut entry) = self.region_overlay_redo.pop() else {
            return Err(JsValue::from_str("no region overlay is available to redo"));
        };
        if entry.operation_id != operation_id {
            self.region_overlay_redo.push(entry);
            return Err(JsValue::from_str(
                "region overlay redo order does not match session history",
            ));
        }
        self.swap_state(&mut entry.state);
        self.region_overlay_undo.push(entry);
        Ok(())
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
            &self.cutting(),
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
        let dtos = mesh::surface_mesh(
            &self.graph,
            &self.surfaces,
            &self.topology,
            request,
            &self.cutting(),
        )
        .map_err(to_js_error)?;
        serialize(&dtos)
    }

    /// A mutation's known surface meshes through one JSON/Wasm crossing.
    pub fn surface_meshes_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: mesh::SurfaceMeshesRequest = parse(request_json)?;
        serialize(&mesh::surface_meshes(
            &self.graph,
            &self.surfaces,
            &self.topology,
            request,
            &self.cutting(),
        ))
    }

    /// [`Self::surface_meshes_json`] plus every key that yielded no mesh and
    /// why: `{"meshes": [...], "failed": [{"surfaceKey", "reason"}]}`.
    pub fn surface_meshes_report_json(&self, request_json: &str) -> Result<String, JsValue> {
        let request: mesh::SurfaceMeshesRequest = parse(request_json)?;
        serialize(&mesh::surface_meshes_report(
            &self.graph,
            &self.surfaces,
            &self.topology,
            request,
            &self.cutting(),
        ))
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
                curve: edge.data().clone(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    curve: Option<grafting_graph_core::bezier::CurveHandles>,
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
