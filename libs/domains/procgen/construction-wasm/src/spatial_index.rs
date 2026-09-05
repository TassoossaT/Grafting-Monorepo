//! Uniform 2D grid spatial index over region bounding boxes.
//!
//! Provides fast candidate-filtering for point classification and footprint/bounds
//! queries, eliminating O(N) flat scans over all session regions.

use std::collections::{HashMap, HashSet};

use grafting_graph_core::{ContourTopology, RegionId};

use crate::editing::SessionGraph;

/// Default cell size in world units (XZ).
/// Standard tabletop regions (walls, path spans, terrain cells) typically span 2 to 8 units.
pub const DEFAULT_GRID_CELL_SIZE: f32 = 4.0;

/// Axis-aligned 2D bounding box on the XZ plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RegionBounds {
    pub min_x: f32,
    pub min_z: f32,
    pub max_x: f32,
    pub max_z: f32,
}

impl RegionBounds {
    pub fn new(min_x: f32, min_z: f32, max_x: f32, max_z: f32) -> Self {
        Self {
            min_x,
            min_z,
            max_x,
            max_z,
        }
    }

    pub fn intersects(&self, other: &RegionBounds) -> bool {
        self.min_x <= other.max_x
            && self.max_x >= other.min_x
            && self.min_z <= other.max_z
            && self.max_z >= other.min_z
    }

    pub fn contains_point(&self, x: f32, z: f32) -> bool {
        x >= self.min_x && x <= self.max_x && z >= self.min_z && z <= self.max_z
    }

    #[allow(dead_code)]
    pub fn from_points<I>(points: I) -> Option<Self>
    where
        I: IntoIterator<Item = [f32; 2]>,
    {
        let mut iter = points.into_iter();
        let first = iter.next()?;
        let mut bounds = Self {
            min_x: first[0],
            min_z: first[1],
            max_x: first[0],
            max_z: first[1],
        };
        for p in iter {
            bounds.min_x = bounds.min_x.min(p[0]);
            bounds.min_z = bounds.min_z.min(p[1]);
            bounds.max_x = bounds.max_x.max(p[0]);
            bounds.max_z = bounds.max_z.max(p[1]);
        }
        Some(bounds)
    }

    pub fn of_region(
        graph: &SessionGraph,
        topology: &ContourTopology,
        region_id: &RegionId,
    ) -> Option<Self> {
        let nodes = topology.region_nodes(region_id).ok()?;
        if nodes.is_empty() {
            return None;
        }
        let first = graph.node(&nodes[0])?.data();
        let mut bounds = Self {
            min_x: first[0],
            min_z: first[2],
            max_x: first[0],
            max_z: first[2],
        };
        for node_id in &nodes {
            let pos = graph.node(node_id)?.data();
            bounds.min_x = bounds.min_x.min(pos[0]);
            bounds.min_z = bounds.min_z.min(pos[2]);
            bounds.max_x = bounds.max_x.max(pos[0]);
            bounds.max_z = bounds.max_z.max(pos[2]);
        }
        Some(bounds)
    }
}

/// Uniform 2D grid index storing region bounding boxes.
#[derive(Debug, Clone)]
pub struct UniformGridIndex {
    cell_size: f32,
    cells: HashMap<(i32, i32), HashSet<RegionId>>,
    bounds: HashMap<RegionId, RegionBounds>,
}

impl Default for UniformGridIndex {
    fn default() -> Self {
        Self::new(DEFAULT_GRID_CELL_SIZE)
    }
}

impl UniformGridIndex {
    pub fn new(cell_size: f32) -> Self {
        assert!(cell_size > 0.0, "grid cell size must be positive");
        Self {
            cell_size,
            cells: HashMap::new(),
            bounds: HashMap::new(),
        }
    }

    #[allow(dead_code)]
    pub fn cell_size(&self) -> f32 {
        self.cell_size
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.bounds.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.bounds.is_empty()
    }

    #[allow(dead_code)]
    pub fn bounds_of(&self, region_id: &RegionId) -> Option<&RegionBounds> {
        self.bounds.get(region_id)
    }

    fn cell_coords(&self, x: f32, z: f32) -> (i32, i32) {
        (
            (x / self.cell_size).floor() as i32,
            (z / self.cell_size).floor() as i32,
        )
    }

    fn cell_range(&self, bounds: &RegionBounds) -> (i32, i32, i32, i32) {
        let (min_cx, min_cz) = self.cell_coords(bounds.min_x, bounds.min_z);
        let (max_cx, max_cz) = self.cell_coords(bounds.max_x, bounds.max_z);
        (min_cx, min_cz, max_cx, max_cz)
    }

    pub fn insert(&mut self, region_id: RegionId, bounds: RegionBounds) {
        self.remove(&region_id);
        let (min_cx, min_cz, max_cx, max_cz) = self.cell_range(&bounds);
        for cx in min_cx..=max_cx {
            for cz in min_cz..=max_cz {
                self.cells
                    .entry((cx, cz))
                    .or_default()
                    .insert(region_id.clone());
            }
        }
        self.bounds.insert(region_id, bounds);
    }

    pub fn remove(&mut self, region_id: &RegionId) -> Option<RegionBounds> {
        let old_bounds = self.bounds.remove(region_id)?;
        let (min_cx, min_cz, max_cx, max_cz) = self.cell_range(&old_bounds);
        for cx in min_cx..=max_cx {
            for cz in min_cz..=max_cz {
                if let Some(set) = self.cells.get_mut(&(cx, cz)) {
                    set.remove(region_id);
                    if set.is_empty() {
                        self.cells.remove(&(cx, cz));
                    }
                }
            }
        }
        Some(old_bounds)
    }

    pub fn query_bounds(&self, query: &RegionBounds) -> Vec<RegionId> {
        let (min_cx, min_cz, max_cx, max_cz) = self.cell_range(query);
        let mut candidates = HashSet::new();
        for cx in min_cx..=max_cx {
            for cz in min_cz..=max_cz {
                if let Some(set) = self.cells.get(&(cx, cz)) {
                    for id in set {
                        candidates.insert(id);
                    }
                }
            }
        }
        let mut results = Vec::new();
        for id in candidates {
            if let Some(b) = self.bounds.get(id) {
                if b.intersects(query) {
                    results.push(id.clone());
                }
            }
        }
        results
    }

    pub fn query_point(&self, x: f32, z: f32) -> Vec<RegionId> {
        let cell = self.cell_coords(x, z);
        let Some(set) = self.cells.get(&cell) else {
            return Vec::new();
        };
        let mut results = Vec::new();
        for id in set {
            if let Some(b) = self.bounds.get(id) {
                if b.contains_point(x, z) {
                    results.push(id.clone());
                }
            }
        }
        results
    }

    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.cells.clear();
        self.bounds.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_insert_query_remove() {
        let mut index = UniformGridIndex::new(4.0);
        let r1 = RegionId::new("r1").unwrap();
        let r2 = RegionId::new("r2").unwrap();

        index.insert(r1.clone(), RegionBounds::new(0.0, 0.0, 2.0, 2.0));
        index.insert(r2.clone(), RegionBounds::new(10.0, 10.0, 12.0, 12.0));

        assert_eq!(index.len(), 2);

        // Query near r1
        let q1 = RegionBounds::new(-1.0, -1.0, 1.0, 1.0);
        let hits1 = index.query_bounds(&q1);
        assert_eq!(hits1, vec![r1.clone()]);

        // Query point inside r1
        let pt_hits = index.query_point(1.0, 1.0);
        assert_eq!(pt_hits, vec![r1.clone()]);

        // Query point between r1 and r2
        let empty_hits = index.query_point(5.0, 5.0);
        assert!(empty_hits.is_empty());

        // Remove r1
        let removed = index.remove(&r1);
        assert_eq!(removed, Some(RegionBounds::new(0.0, 0.0, 2.0, 2.0)));
        assert_eq!(index.len(), 1);
        assert!(index.query_point(1.0, 1.0).is_empty());
    }
}
