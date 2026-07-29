use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

use crate::{EdgeId, Graph, NodeId};

/// Caller-controlled dimensions for the deterministic grouped-grid heuristic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroupedGridOptions {
    node_width: u32,
    node_height: u32,
    horizontal_gap: u32,
    vertical_gap: u32,
    group_gap: u32,
    padding: u32,
    group_columns: u32,
    member_columns: u32,
}

impl GroupedGridOptions {
    /// Creates validated grouped-grid dimensions.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        node_width: u32,
        node_height: u32,
        horizontal_gap: u32,
        vertical_gap: u32,
        group_gap: u32,
        padding: u32,
        group_columns: u32,
        member_columns: u32,
    ) -> Result<Self, LayoutError> {
        for (name, value) in [
            ("node_width", node_width),
            ("node_height", node_height),
            ("group_columns", group_columns),
            ("member_columns", member_columns),
        ] {
            if value == 0 {
                return Err(LayoutError::InvalidOption { name });
            }
        }

        Ok(Self {
            node_width,
            node_height,
            horizontal_gap,
            vertical_gap,
            group_gap,
            padding,
            group_columns,
            member_columns,
        })
    }
}

/// Position assigned to one stable node by a graph layout snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutPosition {
    node_id: NodeId,
    x: u32,
    y: u32,
}

impl LayoutPosition {
    /// Stable node identity associated with this position.
    pub fn node_id(&self) -> &NodeId {
        &self.node_id
    }

    /// Horizontal coordinate in caller-defined presentation units.
    pub fn x(&self) -> u32 {
        self.x
    }

    /// Vertical coordinate in caller-defined presentation units.
    pub fn y(&self) -> u32 {
        self.y
    }
}

/// Immutable deterministic output from a grouped-grid layout operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutSnapshot {
    positions: Vec<LayoutPosition>,
    width: u32,
    height: u32,
}

impl LayoutSnapshot {
    /// Positions sorted by stable node identity.
    pub fn positions(&self) -> &[LayoutPosition] {
        &self.positions
    }

    /// Width required to contain every position and the configured padding.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Height required to contain every position and the configured padding.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Consumes the snapshot into its positions and bounds.
    pub fn into_parts(self) -> (Vec<LayoutPosition>, u32, u32) {
        (self.positions, self.width, self.height)
    }
}

/// Invalid input or arithmetic failure from the grouped-grid heuristic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutError {
    /// A required dimension or column count was zero.
    InvalidOption {
        /// Stable option name suitable for an adapter error message.
        name: &'static str,
    },
    /// A grouping edge identity was not present in the graph.
    UnknownGroupingEdge {
        /// Missing grouping edge identity.
        id: EdgeId,
    },
    /// One node was assigned to two different groups.
    MultipleGroups {
        /// Node with conflicting group ownership.
        node: NodeId,
        /// First group encountered in deterministic edge order.
        first: NodeId,
        /// Conflicting second group.
        second: NodeId,
    },
    /// One grouping source is itself a member of another group.
    NestedGroup {
        /// Group node that would require recursive layout semantics.
        node: NodeId,
    },
    /// Requested dimensions exceeded the coordinate representation.
    DimensionsOverflow,
}

impl fmt::Display for LayoutError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOption { name } => {
                write!(formatter, "layout option {name} must be non-zero")
            }
            Self::UnknownGroupingEdge { id } => write!(formatter, "unknown grouping edge {id}"),
            Self::MultipleGroups {
                node,
                first,
                second,
            } => write!(
                formatter,
                "node {node} belongs to both {first} and {second}"
            ),
            Self::NestedGroup { node } => {
                write!(
                    formatter,
                    "nested grouping is not supported for node {node}"
                )
            }
            Self::DimensionsOverflow => formatter.write_str("layout dimensions overflowed u32"),
        }
    }
}

impl Error for LayoutError {}

fn add(left: u32, right: u32) -> Result<u32, LayoutError> {
    left.checked_add(right)
        .ok_or(LayoutError::DimensionsOverflow)
}

fn multiply(left: u32, right: u32) -> Result<u32, LayoutError> {
    left.checked_mul(right)
        .ok_or(LayoutError::DimensionsOverflow)
}

impl<N: Clone, E: Clone> Graph<N, E> {
    /// Places one-level groups in a deterministic grid and their members below
    /// the corresponding group root.
    ///
    /// `grouping_edges` explicitly identifies which existing graph edges mean
    /// containment for this calculation. All other edges remain structurally
    /// valid graph data but do not influence this presentation heuristic.
    pub fn grouped_grid_layout(
        &self,
        grouping_edges: &[EdgeId],
        options: GroupedGridOptions,
    ) -> Result<LayoutSnapshot, LayoutError> {
        let mut grouping_edges = grouping_edges.to_vec();
        grouping_edges.sort();
        grouping_edges.dedup();

        let mut parent_by_member = BTreeMap::<NodeId, NodeId>::new();
        let mut group_sources = BTreeSet::<NodeId>::new();
        for edge_id in grouping_edges {
            let edge = self
                .edge(&edge_id)
                .ok_or(LayoutError::UnknownGroupingEdge { id: edge_id })?;
            let group = edge.source().clone();
            let member = edge.target().clone();
            if let Some(previous) = parent_by_member.insert(member.clone(), group.clone())
                && previous != group
            {
                return Err(LayoutError::MultipleGroups {
                    node: member,
                    first: previous,
                    second: group,
                });
            }
            group_sources.insert(group);
        }

        if let Some(node) = group_sources
            .iter()
            .find(|node| parent_by_member.contains_key(*node))
        {
            return Err(LayoutError::NestedGroup { node: node.clone() });
        }

        let snapshot = self.snapshot();
        let roots = snapshot
            .nodes()
            .iter()
            .map(|node| node.id().clone())
            .filter(|id| !parent_by_member.contains_key(id))
            .collect::<Vec<_>>();
        let mut members_by_root = roots
            .iter()
            .cloned()
            .map(|root| (root, Vec::<NodeId>::new()))
            .collect::<BTreeMap<_, _>>();
        for (member, root) in parent_by_member {
            members_by_root.entry(root).or_default().push(member);
        }

        let member_columns = options.member_columns;
        let member_width = add(
            multiply(member_columns, options.node_width)?,
            multiply(member_columns - 1, options.horizontal_gap)?,
        )?;
        let group_width = options.node_width.max(member_width);
        let root_x_offset = (group_width - options.node_width) / 2;
        let group_columns =
            usize::try_from(options.group_columns).map_err(|_| LayoutError::DimensionsOverflow)?;

        let mut group_heights = Vec::with_capacity(roots.len());
        for root in &roots {
            let member_count = u32::try_from(members_by_root[root].len())
                .map_err(|_| LayoutError::DimensionsOverflow)?;
            if member_count == 0 {
                group_heights.push(options.node_height);
                continue;
            }
            let rows = member_count.div_ceil(member_columns);
            let members_height = add(
                multiply(rows, options.node_height)?,
                multiply(rows - 1, options.vertical_gap)?,
            )?;
            group_heights.push(add(
                add(options.node_height, options.vertical_gap)?,
                members_height,
            )?);
        }

        let mut positions = Vec::with_capacity(snapshot.nodes().len());
        let mut row_y = options.padding;
        let mut used_columns = 0_u32;
        for (row_index, roots_in_row) in roots.chunks(group_columns).enumerate() {
            let row_start = row_index * group_columns;
            let row_height = group_heights[row_start..row_start + roots_in_row.len()]
                .iter()
                .copied()
                .max()
                .unwrap_or(0);
            used_columns = used_columns.max(
                u32::try_from(roots_in_row.len()).map_err(|_| LayoutError::DimensionsOverflow)?,
            );

            for (column, root) in roots_in_row.iter().enumerate() {
                let column = u32::try_from(column).map_err(|_| LayoutError::DimensionsOverflow)?;
                let origin_x = add(
                    options.padding,
                    multiply(column, add(group_width, options.group_gap)?)?,
                )?;
                positions.push(LayoutPosition {
                    node_id: root.clone(),
                    x: add(origin_x, root_x_offset)?,
                    y: row_y,
                });

                for (member_index, member) in members_by_root[root].iter().enumerate() {
                    let member_index =
                        u32::try_from(member_index).map_err(|_| LayoutError::DimensionsOverflow)?;
                    let member_column = member_index % member_columns;
                    let member_row = member_index / member_columns;
                    positions.push(LayoutPosition {
                        node_id: member.clone(),
                        x: add(
                            origin_x,
                            multiply(
                                member_column,
                                add(options.node_width, options.horizontal_gap)?,
                            )?,
                        )?,
                        y: add(
                            add(row_y, add(options.node_height, options.vertical_gap)?)?,
                            multiply(member_row, add(options.node_height, options.vertical_gap)?)?,
                        )?,
                    });
                }
            }

            row_y = add(row_y, row_height)?;
            if row_start + roots_in_row.len() < roots.len() {
                row_y = add(row_y, options.group_gap)?;
            }
        }

        positions.sort_by(|left, right| left.node_id.cmp(&right.node_id));
        let width = if used_columns == 0 {
            multiply(options.padding, 2)?
        } else {
            add(
                multiply(options.padding, 2)?,
                add(
                    multiply(used_columns, group_width)?,
                    multiply(used_columns - 1, options.group_gap)?,
                )?,
            )?
        };
        let height = add(row_y, options.padding)?;

        Ok(LayoutSnapshot {
            positions,
            width,
            height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, Node};

    fn node(id: &str) -> Node<()> {
        Node::new(NodeId::new(id).unwrap(), ())
    }

    fn edge(id: &str, source: &str, target: &str) -> Edge<()> {
        Edge::new(
            EdgeId::new(id).unwrap(),
            NodeId::new(source).unwrap(),
            NodeId::new(target).unwrap(),
            (),
        )
    }

    fn options() -> GroupedGridOptions {
        GroupedGridOptions::new(100, 40, 20, 10, 60, 30, 2, 2).unwrap()
    }

    #[test]
    fn groups_members_below_roots_without_losing_standalone_nodes() {
        let graph = Graph::try_from_parts(
            vec![
                node("project:b"),
                node("target:a"),
                node("project:a"),
                node("solo:c"),
            ],
            vec![edge("contains:a", "project:a", "target:a")],
        )
        .unwrap();

        let layout = graph
            .grouped_grid_layout(&[EdgeId::new("contains:a").unwrap()], options())
            .unwrap();
        let positions = layout
            .positions()
            .iter()
            .map(|position| (position.node_id().as_str(), position.x(), position.y()))
            .collect::<Vec<_>>();

        assert_eq!(
            positions,
            vec![
                ("project:a", 90, 30),
                ("project:b", 370, 30),
                ("solo:c", 90, 180),
                ("target:a", 30, 80),
            ]
        );
        assert_eq!(layout.width(), 560);
        assert_eq!(layout.height(), 250);
    }

    #[test]
    fn rejects_ambiguous_or_nested_grouping() {
        let graph = Graph::try_from_parts(
            vec![node("a"), node("b"), node("c")],
            vec![
                edge("ab", "a", "b"),
                edge("cb", "c", "b"),
                edge("bc", "b", "c"),
            ],
        )
        .unwrap();

        assert!(matches!(
            graph.grouped_grid_layout(
                &[EdgeId::new("ab").unwrap(), EdgeId::new("cb").unwrap()],
                options(),
            ),
            Err(LayoutError::MultipleGroups { .. })
        ));
        assert!(matches!(
            graph.grouped_grid_layout(
                &[EdgeId::new("ab").unwrap(), EdgeId::new("bc").unwrap()],
                options(),
            ),
            Err(LayoutError::NestedGroup { .. })
        ));
    }
}
