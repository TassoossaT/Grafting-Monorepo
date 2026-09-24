//! Nodes pinned to a host face in relative `(u, v)` coordinates, and the
//! per-surface-type capabilities that decide which faces cut which.
//!
//! The host is the truth: a pinned node's position is always re-derived
//! from its host's current shape, never the other way round. The geometry
//! of that mapping, and of the cut, is `grafting-procgen-surface-mesh`'s
//! [`HostFace`] and `triangulate_region_cut`; this module only keeps the
//! pin table in step with the session's edits.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourLoop, ContourTopology, NodeId, RegionId, SurfaceRegion,
    SurfaceRegistry, move_vertex,
};
use grafting_procgen_surface_mesh::TriangulatedMesh;
use grafting_procgen_surface_mesh::host::{HostFace, mesh_on_host};
use grafting_procgen_surface_mesh::tessellation::{tessellate_edge, traversed_edge};

use crate::editing::SessionGraph;
use crate::mesh::{region_id_from_wire, region_id_to_wire};
use crate::region_editing::RegionEditOutcomeDto;

/// How far a pinned node may sit from its resolved place before it is moved.
const RESOLVE_TOLERANCE: f32 = 1e-6;

/// Float slack on `inside`, so a node resolved onto the rim still reads as on the face.
const INSIDE_TOLERANCE: f64 = 1e-6;

/// Bounds the re-resolution cascade when a pinned region is itself a host.
const MAX_SETTLE_PASSES: usize = 8;

#[derive(Debug, Clone, PartialEq)]
pub struct Pin {
    pub host: RegionId,
    pub u: f64,
    pub v: f64,
}

pub type Pins = BTreeMap<NodeId, Pin>;

/// An edge's cubic control points in its host's relative `(u, v)`, in the
/// edge's own start-to-end direction. Only meaningful while both ends are
/// pinned to `host`; [`settle`] drops it otherwise.
#[derive(Debug, Clone, PartialEq)]
pub struct PinnedCurve {
    pub host: RegionId,
    pub controls: [[f64; 2]; 2],
}

pub type PinnedCurves = BTreeMap<ContourEdgeId, PinnedCurve>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinEdgeCurveRequest {
    pub edge_id: String,
    #[serde(default)]
    pub host_surface_key: Option<Vec<String>>,
    #[serde(default)]
    pub controls: Option<[[f64; 2]; 2]>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostOutlineRequest {
    pub surface_key: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostOutlineDto {
    pub host_surface_key: Vec<String>,
    pub uv: Vec<[f64; 2]>,
}

/// An edge traced on its host, as the topology DTO reports it: walked the
/// way its loop walks it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCurveDto {
    pub host_surface_key: Vec<String>,
    /// The cubic's control points in `(u, v)`; absent for a straight path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub controls: Option<[[f64; 2]; 2]>,
    /// The same control points placed on the host, in world space.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handles: Option<[[f32; 3]; 2]>,
    /// The traced path in world space, both ends included.
    pub points: Vec<[f32; 3]>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SurfaceCapability {
    pub cuts: bool,
    pub accepts_cuts: bool,
}

/// Keyed by surface type. A type absent from the table has no capability.
pub type SurfaceCapabilities = HashMap<String, SurfaceCapability>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceCapabilityDto {
    pub surface_type: String,
    #[serde(default)]
    pub cuts: bool,
    #[serde(default)]
    pub accepts_cuts: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSurfaceCapabilitiesRequest {
    pub capabilities: Vec<SurfaceCapabilityDto>,
}

pub fn capability_table(request: SetSurfaceCapabilitiesRequest) -> SurfaceCapabilities {
    request
        .capabilities
        .into_iter()
        .map(|entry| {
            (
                entry.surface_type,
                SurfaceCapability {
                    cuts: entry.cuts,
                    accepts_cuts: entry.accepts_cuts,
                },
            )
        })
        .collect()
}

pub(crate) fn capability_of(
    capabilities: &SurfaceCapabilities,
    surfaces: &SurfaceRegistry,
    region: &RegionId,
) -> SurfaceCapability {
    surfaces
        .region_surface(region)
        .and_then(|surface| capabilities.get(surface.surface_type().as_str()))
        .copied()
        .unwrap_or_default()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinDto {
    pub node_id: String,
    pub host_surface_key: Vec<String>,
    pub u: f64,
    pub v: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinNodesRequest {
    pub pins: Vec<PinDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnpinNodesRequest {
    pub node_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectToHostRequest {
    pub host_surface_key: Vec<String>,
    pub points: Vec<[f32; 3]>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedPointDto {
    pub u: f64,
    pub v: f64,
    pub inside: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveOnHostRequest {
    pub host_surface_key: Vec<String>,
    pub uv: Vec<[f64; 2]>,
}

/// A node's pin as the topology DTO reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePinDto {
    pub host_surface_key: Vec<String>,
    pub u: f64,
    pub v: f64,
}

impl From<&Pin> for NodePinDto {
    fn from(pin: &Pin) -> Self {
        Self {
            host_surface_key: region_id_to_wire(&pin.host),
            u: pin.u,
            v: pin.v,
        }
    }
}

fn parse_node_id(id: &str) -> Result<NodeId, String> {
    NodeId::new(id.to_owned()).map_err(|error| error.to_string())
}

pub fn host_face(
    graph: &SessionGraph,
    topology: &ContourTopology,
    host: &RegionId,
) -> Option<HostFace> {
    let region = topology.region(host)?;
    HostFace::of(topology, region, &mut |id| {
        graph.node(id).map(|node| *node.data())
    })
}

fn required_host_face(
    graph: &SessionGraph,
    topology: &ContourTopology,
    key: &[String],
) -> Result<HostFace, String> {
    let host = region_id_from_wire(key)?;
    if topology.region(&host).is_none() {
        return Err(format!("unknown host region {host}"));
    }
    host_face(graph, topology, &host)
        .ok_or_else(|| format!("host region {host} is not an upright panel"))
}

pub fn project_to_host(
    graph: &SessionGraph,
    topology: &ContourTopology,
    request: ProjectToHostRequest,
) -> Result<Vec<ProjectedPointDto>, String> {
    let face = required_host_face(graph, topology, &request.host_surface_key)?;
    Ok(request
        .points
        .into_iter()
        .map(|point| {
            let [u, v] = face.project(point);
            ProjectedPointDto {
                u,
                v,
                inside: (-INSIDE_TOLERANCE..=1.0 + INSIDE_TOLERANCE).contains(&u)
                    && (-INSIDE_TOLERANCE..=1.0 + INSIDE_TOLERANCE).contains(&v),
            }
        })
        .collect())
}

pub fn resolve_on_host(
    graph: &SessionGraph,
    topology: &ContourTopology,
    request: ResolveOnHostRequest,
) -> Result<Vec<[f32; 3]>, String> {
    let face = required_host_face(graph, topology, &request.host_surface_key)?;
    Ok(request
        .uv
        .into_iter()
        .map(|[u, v]| face.resolve(u, v))
        .collect())
}

fn push_key(keys: &mut Vec<Vec<String>>, region: &RegionId) {
    let key = region_id_to_wire(region);
    if !keys.contains(&key) {
        keys.push(key);
    }
}

/// Records the pins and reports the pinned regions and their hosts as
/// affected. Positions are resolved by [`settle`], which the session runs
/// after every mutation.
pub fn pin_nodes(
    graph: &SessionGraph,
    topology: &ContourTopology,
    pins: &mut Pins,
    request: PinNodesRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let mut parsed = Vec::with_capacity(request.pins.len());
    for pin in request.pins {
        let node = parse_node_id(&pin.node_id)?;
        if graph.node(&node).is_none() {
            return Err(format!("unknown node {node}"));
        }
        let host = region_id_from_wire(&pin.host_surface_key)?;
        let host_nodes = topology
            .region_nodes(&host)
            .map_err(|error| error.to_string())?;
        if host_nodes.contains(&node) {
            return Err(format!("node {node} is on its own host {host}'s boundary"));
        }
        if !pin.u.is_finite() || !pin.v.is_finite() {
            return Err(format!("pin for node {node} has a non-finite coordinate"));
        }
        parsed.push((
            node,
            Pin {
                host,
                u: pin.u,
                v: pin.v,
            },
        ));
    }
    let mut outcome = RegionEditOutcomeDto::default();
    for (node, pin) in parsed {
        for region in topology.regions_touching_node(&node) {
            push_key(&mut outcome.affected_surface_keys, &region);
        }
        push_key(&mut outcome.affected_surface_keys, &pin.host);
        if let Some(previous) = pins.insert(node, pin)
            && topology.region(&previous.host).is_some()
        {
            push_key(&mut outcome.affected_surface_keys, &previous.host);
        }
    }
    Ok(outcome)
}

/// Drops the pins; every node keeps the position it has.
pub fn unpin_nodes(
    topology: &ContourTopology,
    pins: &mut Pins,
    request: UnpinNodesRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let nodes = request
        .node_ids
        .iter()
        .map(|id| parse_node_id(id))
        .collect::<Result<Vec<_>, _>>()?;
    let mut outcome = RegionEditOutcomeDto::default();
    for node in nodes {
        let Some(pin) = pins.remove(&node) else {
            continue;
        };
        for region in topology.regions_touching_node(&node) {
            push_key(&mut outcome.affected_surface_keys, &region);
        }
        if topology.region(&pin.host).is_some() {
            push_key(&mut outcome.affected_surface_keys, &pin.host);
        }
    }
    Ok(outcome)
}

/// Gives an edge whose ends are both pinned to one host a cubic path in
/// that host's `(u, v)`, or with `controls` null takes it back to a
/// straight path there. The edge's regions and the host are affected.
pub fn pin_edge_curve(
    topology: &ContourTopology,
    pins: &Pins,
    curves: &mut PinnedCurves,
    request: PinEdgeCurveRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let edge_id = ContourEdgeId::new(request.edge_id).map_err(|error| error.to_string())?;
    let edge = topology
        .edge(&edge_id)
        .ok_or_else(|| format!("unknown contour edge {edge_id}"))?;
    let mut outcome = RegionEditOutcomeDto::default();
    for region in topology.regions_using_edge(&edge_id) {
        push_key(&mut outcome.affected_surface_keys, &region);
    }
    let Some(controls) = request.controls else {
        if let Some(previous) = curves.remove(&edge_id)
            && topology.region(&previous.host).is_some()
        {
            push_key(&mut outcome.affected_surface_keys, &previous.host);
        }
        return Ok(outcome);
    };
    let key = request
        .host_surface_key
        .ok_or_else(|| format!("a curve on edge {edge_id} needs a hostSurfaceKey"))?;
    let host = region_id_from_wire(&key)?;
    if topology.region(&host).is_none() {
        return Err(format!("unknown host region {host}"));
    }
    for node in [edge.start_node(), edge.end_node()] {
        if pins.get(node).is_none_or(|pin| pin.host != host) {
            return Err(format!(
                "edge {edge_id}'s node {node} is not pinned to {host}"
            ));
        }
    }
    if controls.iter().flatten().any(|value| !value.is_finite()) {
        return Err(format!("curve on edge {edge_id} has a non-finite control"));
    }
    push_key(&mut outcome.affected_surface_keys, &host);
    if let Some(previous) = curves.insert(edge_id, PinnedCurve { host, controls })
        && topology.region(&previous.host).is_some()
    {
        push_key(&mut outcome.affected_surface_keys, &previous.host);
    }
    Ok(outcome)
}

fn touched_regions(outcome: &RegionEditOutcomeDto) -> BTreeSet<RegionId> {
    outcome
        .affected_surface_keys
        .iter()
        .chain(&outcome.created_surface_keys)
        .filter_map(|key| region_id_from_wire(key).ok())
        .collect()
}

fn report_affected(outcome: &mut RegionEditOutcomeDto, region: &RegionId) {
    let key = region_id_to_wire(region);
    if !outcome.affected_surface_keys.contains(&key)
        && !outcome.created_surface_keys.contains(&key)
        && !outcome.removed_surface_keys.contains(&key)
    {
        outcome.affected_surface_keys.push(key);
    }
}

/// Brings the pin table and pinned positions back in step after a mutation.
///
/// Pins whose node is gone are dropped (their host re-meshes); pins whose
/// host is gone are dropped with the node left where it is. Every pin on a
/// host the mutation touched is re-resolved, every region traced on such a
/// host is reported, and every host of a pinned node in a touched region is
/// reported, since its cut depends on it. A curve is dropped with its edge,
/// or once its ends are no longer both pinned to its host.
pub fn settle(
    graph: &mut SessionGraph,
    topology: &ContourTopology,
    pins: &mut Pins,
    curves: &mut PinnedCurves,
    outcome: &mut RegionEditOutcomeDto,
) {
    if pins.is_empty() {
        curves.clear();
        return;
    }
    let mut orphaned_hosts = Vec::new();
    pins.retain(|node, pin| {
        let host_alive = topology.region(&pin.host).is_some();
        if graph.node(node).is_none() {
            if host_alive {
                orphaned_hosts.push(pin.host.clone());
            }
            return false;
        }
        host_alive
    });
    for host in &orphaned_hosts {
        report_affected(outcome, host);
    }
    curves.retain(|edge_id, curve| {
        topology.edge(edge_id).is_some_and(|edge| {
            [edge.start_node(), edge.end_node()]
                .into_iter()
                .all(|node| pins.get(node).is_some_and(|pin| pin.host == curve.host))
        })
    });

    for _ in 0..MAX_SETTLE_PASSES {
        let touched = touched_regions(outcome);
        let mut faces: BTreeMap<RegionId, Option<HostFace>> = BTreeMap::new();
        let mut moves = Vec::new();
        for (node, pin) in pins.iter() {
            if !touched.contains(&pin.host) {
                continue;
            }
            let face = faces
                .entry(pin.host.clone())
                .or_insert_with(|| host_face(graph, topology, &pin.host));
            let Some(face) = face else {
                continue;
            };
            let target = face.resolve(pin.u, pin.v);
            let Some(current) = graph.node(node).map(|node| *node.data()) else {
                continue;
            };
            if (0..3).any(|axis| (current[axis] - target[axis]).abs() > RESOLVE_TOLERANCE) {
                moves.push((node.clone(), target));
            }
        }
        if moves.is_empty() {
            break;
        }
        for (node, target) in moves {
            if let Ok(moved) = move_vertex(graph, topology, &node, |position| *position = target) {
                for region in moved.affected_regions {
                    report_affected(outcome, &region);
                }
            }
        }
    }

    let touched = touched_regions(outcome);
    let mut dependents = BTreeSet::new();
    for (node, pin) in pins.iter() {
        if touched.contains(&pin.host) {
            dependents.extend(topology.regions_touching_node(node));
        }
    }
    for region in dependents {
        report_affected(outcome, &region);
    }

    let mut hosts = BTreeSet::new();
    for region in touched_regions(outcome) {
        let Ok(nodes) = topology.region_nodes(&region) else {
            continue;
        };
        for node in nodes {
            if let Some(pin) = pins.get(&node) {
                hosts.insert(pin.host.clone());
            }
        }
    }
    for host in hosts {
        report_affected(outcome, &host);
    }
}

/// Traces edges in the frame of the host both their ends are pinned to, so
/// a straight edge follows a curved host and a curved one bends with it.
#[derive(Clone, Copy)]
pub struct HostTracer<'a> {
    pins: &'a Pins,
    curves: &'a PinnedCurves,
}

impl<'a> HostTracer<'a> {
    pub fn new(pins: &'a Pins, curves: &'a PinnedCurves) -> Self {
        Self { pins, curves }
    }

    /// The one host every boundary node of `region` is pinned to.
    pub fn sole_host(
        &self,
        topology: &ContourTopology,
        region: &SurfaceRegion,
    ) -> Option<&'a RegionId> {
        let mut host: Option<&'a RegionId> = None;
        for loop_ in region.outer_loops().iter().chain(region.holes()) {
            for use_ in loop_ {
                let edge = topology.edge(use_.edge())?;
                for node in [edge.start_node(), edge.end_node()] {
                    let pinned = &self.pins.get(node)?.host;
                    if host.is_some_and(|host| host != pinned) {
                        return None;
                    }
                    host = Some(pinned);
                }
            }
        }
        host
    }

    /// `traversed` as points of `face`'s flat, both ends included, when both
    /// its ends are pinned to `host`, whose face `face` is.
    pub fn trace(
        &self,
        topology: &ContourTopology,
        host: &RegionId,
        face: &HostFace,
        traversed: &ContourEdge,
    ) -> Option<Vec<[f32; 2]>> {
        let [from, to] = [traversed.start_node(), traversed.end_node()]
            .map(|node| self.pins.get(node).filter(|pin| &pin.host == host));
        let (from, to) = (from?, to?);
        let controls = self
            .curves
            .get(traversed.id())
            .filter(|curve| &curve.host == host)
            .and_then(|curve| {
                let forward = topology.edge(traversed.id())?.start_node() == traversed.start_node();
                let [first, second] = curve.controls;
                Some(if forward {
                    [first, second]
                } else {
                    [second, first]
                })
            });
        Some(face.trace([from.u, from.v], [to.u, to.v], controls))
    }

    /// `loop_` as a ring of `face`'s flat: edges on `host` traced there,
    /// any other tessellated in the world and unrolled.
    pub fn unrolled_loop(
        &self,
        graph: &SessionGraph,
        topology: &ContourTopology,
        host: &RegionId,
        face: &HostFace,
        loop_: &ContourLoop,
    ) -> Option<Vec<[f32; 2]>> {
        let mut ring = Vec::new();
        for use_ in loop_ {
            let traversed = traversed_edge(topology, use_)?;
            let mut points = match self.trace(topology, host, face, &traversed) {
                Some(points) => points,
                None => {
                    let start = *graph.node(traversed.start_node())?.data();
                    let end = *graph.node(traversed.end_node())?.data();
                    tessellate_edge(&traversed, start, end)?
                        .into_iter()
                        .map(|point| face.frame.unroll(point))
                        .collect()
                }
            };
            points.pop();
            ring.extend(points);
        }
        (ring.len() >= 3).then_some(ring)
    }

    /// `region`'s own mesh when it lies wholly on one host, drawn in that
    /// host's frame so it follows the host however it curves.
    pub fn mesh(
        &self,
        graph: &SessionGraph,
        topology: &ContourTopology,
        region: &SurfaceRegion,
    ) -> Option<TriangulatedMesh> {
        if region.profile().is_some() {
            return None;
        }
        let [outer] = region.outer_loops() else {
            return None;
        };
        let host = self.sole_host(topology, region)?;
        let face = host_face(graph, topology, host)?;
        let ring = self.unrolled_loop(graph, topology, host, &face, outer)?;
        let holes = region
            .holes()
            .iter()
            .map(|hole| self.unrolled_loop(graph, topology, host, &face, hole))
            .collect::<Option<Vec<_>>>()?;
        mesh_on_host(&face, &ring, &holes)
    }

    /// How `edge`, walked from `start`, is traced on its host, when it is.
    pub fn host_curve(
        &self,
        graph: &SessionGraph,
        topology: &ContourTopology,
        faces: &mut BTreeMap<RegionId, Option<HostFace>>,
        edge: &ContourEdge,
        start: &NodeId,
    ) -> Option<HostCurveDto> {
        let host = &self.pins.get(start)?.host;
        let forward = edge.start_node() == start;
        let traversed = if forward {
            edge.clone()
        } else {
            ContourEdge::new(
                edge.id().clone(),
                edge.end_node().clone(),
                edge.start_node().clone(),
                edge.reversed_geometry(),
            )
        };
        let face = faces
            .entry(host.clone())
            .or_insert_with(|| host_face(graph, topology, host))
            .as_ref()?;
        let points = self.trace(topology, host, face, &traversed)?;
        let controls = self
            .curves
            .get(edge.id())
            .filter(|curve| &curve.host == host)
            .map(|curve| {
                let [first, second] = curve.controls;
                if forward {
                    [first, second]
                } else {
                    [second, first]
                }
            });
        Some(HostCurveDto {
            host_surface_key: region_id_to_wire(host),
            controls,
            handles: controls.map(|pair| pair.map(|[u, v]| face.resolve(u, v))),
            points: points
                .into_iter()
                .map(|point| face.frame.roll(point))
                .collect(),
        })
    }
}

/// A region's outer loop traced on the one host its nodes are all pinned
/// to, as `(u, v)` there.
pub fn host_outline(
    graph: &SessionGraph,
    topology: &ContourTopology,
    tracer: HostTracer<'_>,
    request: HostOutlineRequest,
) -> Result<HostOutlineDto, String> {
    let id = region_id_from_wire(&request.surface_key)?;
    let region = topology
        .region(&id)
        .ok_or_else(|| format!("unknown region {id}"))?;
    let [outer] = region.outer_loops() else {
        return Err(format!("region {id} has more than one outer loop"));
    };
    let host = tracer
        .sole_host(topology, region)
        .ok_or_else(|| format!("region {id}'s nodes are not all pinned to one host"))?;
    let face = host_face(graph, topology, host)
        .ok_or_else(|| format!("host region {host} is not an upright panel"))?;
    let ring = tracer
        .unrolled_loop(graph, topology, host, &face, outer)
        .ok_or_else(|| format!("region {id}'s outline cannot be traced"))?;
    Ok(HostOutlineDto {
        host_surface_key: region_id_to_wire(host),
        uv: ring
            .into_iter()
            .map(|point| face.uv_of_unrolled(point))
            .collect(),
    })
}

/// Which pinned regions cut which host, and how pinned regions are traced,
/// for one meshing pass.
pub struct Cutting<'a> {
    capabilities: &'a SurfaceCapabilities,
    tracer: HostTracer<'a>,
    by_host: HashMap<&'a RegionId, Vec<&'a NodeId>>,
}

impl<'a> Cutting<'a> {
    pub fn new(
        pins: &'a Pins,
        curves: &'a PinnedCurves,
        capabilities: &'a SurfaceCapabilities,
    ) -> Self {
        let mut by_host: HashMap<&RegionId, Vec<&NodeId>> = HashMap::new();
        for (node, pin) in pins {
            by_host.entry(&pin.host).or_default().push(node);
        }
        Self {
            capabilities,
            tracer: HostTracer::new(pins, curves),
            by_host,
        }
    }

    pub fn tracer(&self) -> HostTracer<'a> {
        self.tracer
    }

    /// The outer rings of every cutting region with a node pinned to `host`,
    /// in `host`'s unrolled frame, or none when `host` does not accept cuts.
    pub fn rings(
        &self,
        graph: &SessionGraph,
        surfaces: &SurfaceRegistry,
        topology: &ContourTopology,
        host: &RegionId,
    ) -> Vec<Vec<[f32; 2]>> {
        let Some(nodes) = self.by_host.get(host) else {
            return Vec::new();
        };
        if !capability_of(self.capabilities, surfaces, host).accepts_cuts {
            return Vec::new();
        }
        let Some(face) = host_face(graph, topology, host) else {
            return Vec::new();
        };
        let cutters: BTreeSet<RegionId> = nodes
            .iter()
            .flat_map(|node| topology.regions_touching_node(node))
            .filter(|region| {
                region != host && capability_of(self.capabilities, surfaces, region).cuts
            })
            .collect();
        cutters
            .iter()
            .filter_map(|region| topology.region(region))
            .flat_map(|region| region.outer_loops().iter())
            .filter_map(|loop_| {
                self.tracer
                    .unrolled_loop(graph, topology, host, &face, loop_)
            })
            .collect()
    }
}
