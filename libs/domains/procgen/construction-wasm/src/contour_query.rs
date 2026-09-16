//! Pure questions about one contour edge's shape, batched over the wire.
//!
//! Nothing here reads or changes the session: a question carries the geometry
//! and the two endpoint positions it is about. That is what lets the front end
//! ask where a curve runs -- to draw it, to place an opening on it, to merge
//! two arcs -- without keeping its own copy of the arithmetic, which is the
//! rule this crate's `AGENTS.md` states: the engine calculates, the front end
//! decides.
//!
//! Every answer is XZ, like the geometry itself. A boundary edge carries no
//! curvature in height, so height rides linearly between the two anchors and
//! is the caller's to interpolate.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourPoint, NodeId, arc_sweep, distance_at_parameter,
    parameter_at_distance, sub_geometry,
};

use crate::region_editing::ContourGeometryDto;

/// What is being asked about one edge.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContourQuestion {
    /// Positions at these parameters.
    Evaluate { at: Vec<f32> },
    /// A polyline no further than `tolerance` from the true curve.
    Tessellate { tolerance: f32 },
    /// The edge's own length.
    Length,
    /// The parameter and position closest to a point.
    ClosestPoint { point: ContourPoint },
    /// The geometry of the span between two parameters.
    #[serde(rename_all = "camelCase")]
    SubGeometry { t0: f32, t1: f32 },
    /// Parameters sitting these distances along the edge.
    ParameterAtDistance { distance: Vec<f32> },
    /// Distances along the edge at these parameters.
    DistanceAtParameter { at: Vec<f32> },
    /// The signed angle an arc turns through, positive counter-clockwise.
    ArcSweep,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourQuery {
    pub geometry: ContourGeometryDto,
    pub from: ContourPoint,
    pub to: ContourPoint,
    pub question: ContourQuestion,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContourAnswer {
    Points { points: Vec<ContourPoint> },
    Scalars { values: Vec<f32> },
    Geometry { geometry: ContourGeometryDto },
    #[serde(rename_all = "camelCase")]
    Closest { t: f32, position: ContourPoint },
}

fn edge_of(query: &ContourQuery) -> Result<ContourEdge, String> {
    Ok(ContourEdge::new(
        ContourEdgeId::new("query").map_err(|error| error.to_string())?,
        NodeId::new("from".to_owned()).map_err(|error| error.to_string())?,
        NodeId::new("to".to_owned()).map_err(|error| error.to_string())?,
        query.geometry.clone().into_geometry(),
    ))
}

/// Answers every query in order.
pub fn answer(queries: &[ContourQuery]) -> Result<Vec<ContourAnswer>, String> {
    queries
        .iter()
        .map(|query| {
            let edge = edge_of(query)?;
            let (from, to) = (query.from, query.to);
            Ok(match &query.question {
                ContourQuestion::Evaluate { at } => ContourAnswer::Points {
                    points: at.iter().map(|t| edge.evaluate(from, to, *t)).collect(),
                },
                ContourQuestion::Tessellate { tolerance } => ContourAnswer::Points {
                    points: edge.tessellate(from, to, *tolerance),
                },
                ContourQuestion::Length => ContourAnswer::Scalars {
                    values: vec![edge.length(from, to)],
                },
                ContourQuestion::ClosestPoint { point } => {
                    let (t, position) = edge.closest_point(from, to, *point);
                    ContourAnswer::Closest { t, position }
                }
                ContourQuestion::SubGeometry { t0, t1 } => ContourAnswer::Geometry {
                    geometry: ContourGeometryDto::from_geometry(&sub_geometry(&edge, from, to, *t0, *t1)),
                },
                ContourQuestion::ParameterAtDistance { distance } => ContourAnswer::Scalars {
                    values: distance
                        .iter()
                        .map(|d| parameter_at_distance(&edge, from, to, *d))
                        .collect(),
                },
                ContourQuestion::DistanceAtParameter { at } => ContourAnswer::Scalars {
                    values: at
                        .iter()
                        .map(|t| distance_at_parameter(&edge, from, to, *t))
                        .collect(),
                },
                ContourQuestion::ArcSweep => ContourAnswer::Scalars {
                    values: vec![arc_sweep(&edge, from, to)],
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bezier() -> ContourGeometryDto {
        ContourGeometryDto::Bezier { handle1: [1.0, -2.0], handle2: [3.0, 1.0] }
    }

    fn query(question: ContourQuestion) -> ContourQuery {
        ContourQuery { geometry: bezier(), from: [0.0, 0.0], to: [4.0, 0.0], question }
    }

    #[test]
    fn a_batch_answers_every_question_in_order() {
        let answers = answer(&[
            query(ContourQuestion::Evaluate { at: vec![0.0, 1.0] }),
            query(ContourQuestion::Length),
            query(ContourQuestion::SubGeometry { t0: 0.25, t1: 0.75 }),
        ])
        .unwrap();

        let ContourAnswer::Points { points } = &answers[0] else { panic!("expected points") };
        assert_eq!(points[0], [0.0, 0.0]);
        assert_eq!(points[1], [4.0, 0.0]);
        let ContourAnswer::Scalars { values } = &answers[1] else { panic!("expected a length") };
        assert!(values[0] > 4.0, "a curve is longer than its chord");
        let ContourAnswer::Geometry { geometry } = &answers[2] else { panic!("expected geometry") };
        assert!(matches!(geometry, ContourGeometryDto::Bezier { .. }));
    }

    #[test]
    fn travelling_a_straight_edge_is_proportional() {
        let straight = |question| ContourQuery {
            geometry: ContourGeometryDto::Line,
            from: [0.0, 0.0],
            to: [10.0, 0.0],
            question,
        };
        let answers = answer(&[
            straight(ContourQuestion::ParameterAtDistance { distance: vec![2.5] }),
            straight(ContourQuestion::DistanceAtParameter { at: vec![0.25] }),
            straight(ContourQuestion::ClosestPoint { point: [3.0, 5.0] }),
        ])
        .unwrap();

        let ContourAnswer::Scalars { values } = &answers[0] else { panic!("expected a parameter") };
        assert!((values[0] - 0.25).abs() < 1e-4);
        let ContourAnswer::Scalars { values } = &answers[1] else { panic!("expected a distance") };
        assert!((values[0] - 2.5).abs() < 1e-4);
        let ContourAnswer::Closest { t, position } = &answers[2] else { panic!("expected the closest point") };
        assert!((t - 0.3).abs() < 1e-4);
        assert_eq!(*position, [3.0, 0.0]);
    }
}
