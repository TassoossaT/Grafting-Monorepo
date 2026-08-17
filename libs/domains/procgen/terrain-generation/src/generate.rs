//! Derives a construction-surface node cycle for one `PrismGridMesh` cell
//! from a chosen [`CornerHeightModule`].

use std::error::Error;
use std::fmt;

use grafting_graph_core::{Edge, EdgeId, Node, NodeId, PrismGridMesh, SurfaceSpec, SurfaceType};

use crate::module::{CORNER_COUNT, CornerHeightModule};

/// Why [`generate_terrain_cell_surface`] could not derive a surface.
#[derive(Debug, Clone, PartialEq)]
pub enum TerrainGenerationError {
    /// `cell` is outside `mesh`'s own cell count.
    UnknownCell {
        /// The index that was requested.
        cell: usize,
        /// How many cells `mesh` actually has.
        cell_count: usize,
    },
}

impl fmt::Display for TerrainGenerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownCell { cell, cell_count } => {
                write!(formatter, "cell {cell} is outside a mesh of {cell_count} cells")
            }
        }
    }
}

impl Error for TerrainGenerationError {}

/// One cell's worth of generated construction-surface data: new nodes, the
/// ring edges connecting them, and the [`SurfaceSpec`] a caller can
/// register (first creation) or use as an operand to
/// `grafting_graph_core`'s existing node operations (an edit). This crate
/// never performs either itself.
#[derive(Debug, Clone, PartialEq)]
pub struct TerrainCellGeneration {
    /// The 4 corner nodes, in `PrismGridMesh::cell_corners`' cyclic order.
    pub nodes: Vec<Node<[f32; 3]>>,
    /// The 4-edge ring connecting `nodes` consecutively, wrapping around.
    pub edges: Vec<Edge<()>>,
    /// The surface these nodes and edges form.
    pub surface: SurfaceSpec,
}

/// Derives one `PrismGridMesh` cell's top surface from `module`'s
/// corner-height profile: for each of the cell's 4 corner slots, the
/// generated node's position is a straight lerp between that slot's
/// bottom-ring and top-ring position in `mesh`, by `module.corner_heights`'
/// fraction at that slot.
///
/// This is the correct, minimal algorithm for a flat corner-heights module
/// on a `PrismGridMesh` cell -- the cell's own bottom/top rings already are
/// the quad's real corners at every height fraction, so no XY bilinear
/// re-interpolation ([`crate::bilinear_point`]) is needed to place a point
/// exactly on the cell's own corner column; that function exists for the
/// documented `Mesh`-shape follow-up (interior/edge sampling), not called
/// here.
///
/// `node_id`/`edge_id` (0..3, ring edge `i` connects slot `i` to
/// `(i + 1) % 4`) let the caller decide identity -- in particular, whether
/// two adjacent cells sharing a `PrismGridMesh` vertex index get the *same*
/// `NodeId` (a seamless join) or different ones (a deliberate crack); this
/// crate never invents identity, matching `duplicate_surface`'s own
/// principle (`grafting_graph_core`).
pub fn generate_terrain_cell_surface(
    mesh: &PrismGridMesh,
    cell: usize,
    module: &CornerHeightModule,
    node_id: impl Fn(usize) -> NodeId,
    edge_id: impl Fn(usize) -> EdgeId,
    surface_type: SurfaceType,
) -> Result<TerrainCellGeneration, TerrainGenerationError> {
    let corners = mesh.cell_corners.get(cell).ok_or(TerrainGenerationError::UnknownCell {
        cell,
        cell_count: mesh.cell_count(),
    })?;

    let mut nodes = Vec::with_capacity(CORNER_COUNT);
    let mut cycle = Vec::with_capacity(CORNER_COUNT);
    for slot in 0..CORNER_COUNT {
        let bottom = mesh.positions[corners[slot] as usize];
        let top = mesh.positions[corners[slot + CORNER_COUNT] as usize];
        let fraction = module.corner_heights[slot];
        // Lerp in the mesh's own space first: `bottom`/`top` differ only
        // along `PrismGridMesh`'s own vertical axis (index 2 -- its own doc
        // comments call it "Vertical Z height variation", `z_base = l`),
        // which is what makes this a pure per-corner height lerp with no
        // XY drift.
        let mesh_position = [
            bottom[0] + (top[0] - bottom[0]) * fraction,
            bottom[1] + (top[1] - bottom[1]) * fraction,
            bottom[2] + (top[2] - bottom[2]) * fraction,
        ];
        // `PrismGridMesh` is a general-purpose grid keyed to its own
        // documented Z-up convention, independent of any one consumer (it
        // also backs `grafting-procgen-generation-wasm`, which has no
        // opinion on "up" at all). This crate's job is specifically to
        // bridge one `PrismGridMesh` cell into construction-surface node
        // positions for callers that *do* have an up-axis --
        // `grafting-procgen-construction-wasm` and, through it, `apps/vtt`,
        // which render Y-up (`grafting-procgen-structure-generation`'s
        // `wall.rs::position_at` already commits to the same convention;
        // see `apps/vtt/notes/0006-e2e-validation-slice.md`). Remap here,
        // once, rather than in `PrismGridMesh` itself, so the grid keeps
        // its own general convention for any other consumer.
        let position = [mesh_position[0], mesh_position[2], mesh_position[1]];
        let id = node_id(slot);
        cycle.push(id.clone());
        nodes.push(Node::new(id, position));
    }

    let mut edges = Vec::with_capacity(CORNER_COUNT);
    for slot in 0..CORNER_COUNT {
        let next = (slot + 1) % CORNER_COUNT;
        edges.push(Edge::new(edge_id(slot), cycle[slot].clone(), cycle[next].clone(), ()));
    }

    Ok(TerrainCellGeneration {
        nodes,
        edges,
        surface: SurfaceSpec { cycle, surface_type, physical: true, curvature: None },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::FormationInputs;

    fn ids(cell: usize) -> impl Fn(usize) -> NodeId {
        move |slot| NodeId::new(format!("cell{cell}-{slot}")).unwrap()
    }

    fn edge_ids(cell: usize) -> impl Fn(usize) -> EdgeId {
        move |slot| EdgeId::new(format!("cell{cell}-e{slot}")).unwrap()
    }

    /// Mirrors `generate_terrain_cell_surface`'s own mesh-space-to-render-space
    /// remap, so tests can express expectations in terms of `mesh.positions`
    /// (mesh-space, `PrismGridMesh`'s own Z-up convention) without duplicating
    /// the reasoning for *why* the swap happens.
    fn render_space(mesh_position: [f32; 3]) -> [f32; 3] {
        [mesh_position[0], mesh_position[2], mesh_position[1]]
    }

    #[test]
    fn happy_path_generates_a_flat_top_surface() {
        let mesh = PrismGridMesh::new(2, 2, 1, FormationInputs::default());
        let module = CornerHeightModule { name: "flat".into(), corner_heights: [1.0; 4] };

        let generation =
            generate_terrain_cell_surface(&mesh, 0, &module, ids(0), edge_ids(0), SurfaceType::new("terrain"))
                .unwrap();

        assert_eq!(generation.nodes.len(), 4);
        assert_eq!(generation.edges.len(), 4);
        assert_eq!(generation.surface.cycle.len(), 4);
        assert_eq!(generation.surface.surface_type, SurfaceType::new("terrain"));
        assert!(generation.surface.physical);

        // A flat, fraction-1.0 module places every corner at its top-ring
        // position exactly, remapped into this crate's Y-up render space.
        let corners = mesh.cell_corners[0];
        for slot in 0..4 {
            let expected = render_space(mesh.positions[corners[slot + 4] as usize]);
            assert_eq!(*generation.nodes[slot].data(), expected);
        }

        // The ring closes: edge 3 connects slot 3 back to slot 0.
        assert_eq!(generation.edges[3].source(), generation.nodes[3].id());
        assert_eq!(generation.edges[3].target(), generation.nodes[0].id());
    }

    #[test]
    fn a_ramp_module_lerps_each_corner_independently() {
        let mesh = PrismGridMesh::new(1, 1, 1, FormationInputs::default());
        let module = CornerHeightModule { name: "ramp".into(), corner_heights: [0.0, 1.0, 1.0, 0.0] };

        let generation =
            generate_terrain_cell_surface(&mesh, 0, &module, ids(0), edge_ids(0), SurfaceType::new("terrain"))
                .unwrap();

        let corners = mesh.cell_corners[0];
        let bottom0 = render_space(mesh.positions[corners[0] as usize]);
        let top1 = render_space(mesh.positions[corners[1 + 4] as usize]);
        // Slot 0 has fraction 0.0: stays at the bottom ring.
        assert_eq!(*generation.nodes[0].data(), bottom0);
        // Slot 1 has fraction 1.0: reaches the top ring.
        assert_eq!(*generation.nodes[1].data(), top1);
    }

    #[test]
    fn a_flat_cell_is_not_degenerate_in_render_space() {
        // Regression guard for the axis mismatch fixed alongside this test
        // (`E3.9`): before the remap, every corner of a flat module shared
        // the same render-space Y (mesh's own horizontal Y became render Y),
        // and mesh Z (the actual height axis) was dropped into render Z
        // instead -- so a "flat terrain cell" was flat in the wrong plane
        // relative to `apps/vtt`'s Y-up camera/clip-plane convention, and a
        // ramp's height change was invisible from the app's default view
        // angle. Here every corner must share render-space Y (truly flat,
        // height axis correct) and the four render-space (X, Z) pairs must
        // be the 4 distinct corners of the cell's footprint.
        let mesh = PrismGridMesh::new(1, 1, 1, FormationInputs::default());
        let module = CornerHeightModule { name: "flat".into(), corner_heights: [1.0; 4] };
        let generation =
            generate_terrain_cell_surface(&mesh, 0, &module, ids(0), edge_ids(0), SurfaceType::new("terrain"))
                .unwrap();

        let render_y: Vec<f32> = generation.nodes.iter().map(|node| node.data()[1]).collect();
        for y in &render_y {
            assert!((y - render_y[0]).abs() < 1e-6, "flat module must share one render-space Y: {render_y:?}");
        }

        let footprints: std::collections::HashSet<(i32, i32)> = generation
            .nodes
            .iter()
            .map(|node| ((node.data()[0] * 1000.0) as i32, (node.data()[2] * 1000.0) as i32))
            .collect();
        assert_eq!(footprints.len(), 4, "the 4 corners must occupy 4 distinct (X, Z) footprint positions");
    }

    #[test]
    fn rejects_an_out_of_range_cell() {
        let mesh = PrismGridMesh::new(1, 1, 1, FormationInputs::default());
        let module = CornerHeightModule { name: "flat".into(), corner_heights: [1.0; 4] };

        assert_eq!(
            generate_terrain_cell_surface(&mesh, 5, &module, ids(5), edge_ids(5), SurfaceType::new("terrain"))
                .unwrap_err(),
            TerrainGenerationError::UnknownCell { cell: 5, cell_count: 1 }
        );
    }
}
