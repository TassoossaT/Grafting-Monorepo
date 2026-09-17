//! Reading a reference field from outside the engine: where a ground-plane
//! point projects onto the curves a surface was swept from, and how high the
//! curve is there.
//!
//! Nothing here touches the session. A question carries its own curves, the
//! way `contour_query` carries its own geometry, so the front end can elevate
//! a contour the union handed back flat without keeping a second copy of the
//! projection -- the copy that used to live in the app's
//! `curve-projection.ts` and had to be kept in step with `field.rs` by hand.

use serde::{Deserialize, Serialize};

use grafting_graph_core::curve_offset::{ReferenceCurve, ReferenceField};

/// One curve the caller swept a surface from.
#[derive(Debug, Clone, Deserialize)]
pub struct ReferenceCurveDto {
    /// Ordered `[x, y, z]` samples.
    pub points: Vec<[f32; 3]>,
    /// How far off the curve the surface it generated reaches; `0` means the
    /// caller is not claiming ownership, only asking for the nearest reading.
    #[serde(default)]
    pub reach: f32,
}

/// The curves, and the ground-plane points to read against them.
#[derive(Debug, Clone, Deserialize)]
pub struct FieldQuery {
    pub curves: Vec<ReferenceCurveDto>,
    /// `[x, z]` points, answered in order.
    pub points: Vec<[f32; 2]>,
    /// When given, a point is read as sitting near this height, so curves
    /// stacked over the same ground (a ramp crossing a road) are told apart
    /// by level instead of by whichever was listed first. One height per
    /// point, or none at all.
    #[serde(default)]
    pub near: Option<Vec<f32>>,
}

/// What one point read: the curve it projected onto and that curve's own
/// station, offset and height there. `null` when the field holds no curve to
/// project onto at all.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSampleDto {
    pub curve: usize,
    pub s: f32,
    pub t: f32,
    pub y: f32,
}

/// Reads every point against the query's own curves, in order.
pub fn answer(query: &FieldQuery) -> Vec<Option<FieldSampleDto>> {
    let field = ReferenceField::new(query.curves.iter().map(|curve| ReferenceCurve {
        points: curve.points.clone(),
        reach: curve.reach,
    }));
    query
        .points
        .iter()
        .enumerate()
        .map(|(index, [x, z])| {
            let sample = match query.near.as_ref().and_then(|heights| heights.get(index)) {
                Some(y) => field.sample_near(*x, *z, *y),
                None => field.sample(*x, *z),
            };
            sample.map(|sample| FieldSampleDto {
                curve: sample.curve,
                s: sample.s,
                t: sample.t,
                y: sample.y,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A curve climbing from y=0 to y=10 over 10 units of ground.
    fn ramp() -> ReferenceCurveDto {
        ReferenceCurveDto {
            points: vec![[0.0, 0.0, 0.0], [10.0, 10.0, 0.0]],
            reach: 2.0,
        }
    }

    #[test]
    fn a_point_reads_the_curves_height_at_the_station_it_projects_onto() {
        let answers = answer(&FieldQuery {
            curves: vec![ramp()],
            points: vec![[2.5, 1.0], [7.5, -1.0]],
            near: None,
        });

        assert!((answers[0].as_ref().unwrap().y - 2.5).abs() < 1e-4);
        assert!((answers[1].as_ref().unwrap().y - 7.5).abs() < 1e-4);
    }

    #[test]
    fn a_point_past_the_end_reads_the_end_rather_than_an_extrapolation() {
        let answers = answer(&FieldQuery {
            curves: vec![ramp()],
            points: vec![[99.0, 0.0]],
            near: None,
        });

        assert!((answers[0].as_ref().unwrap().y - 10.0).abs() < 1e-4);
    }

    #[test]
    fn with_no_curve_to_project_onto_a_point_reads_nothing() {
        let answers = answer(&FieldQuery {
            curves: vec![],
            points: vec![[0.0, 0.0]],
            near: None,
        });

        assert!(answers[0].is_none());
    }

    #[test]
    fn stacked_curves_are_told_apart_by_the_level_a_point_sits_on() {
        let over = ReferenceCurveDto {
            points: vec![[0.0, 8.0, 0.0], [10.0, 8.0, 0.0]],
            reach: 2.0,
        };
        let query = |near| FieldQuery {
            curves: vec![ramp(), over.clone()],
            points: vec![[5.0, 0.2]],
            near,
        };

        let high = answer(&query(Some(vec![8.0])));
        assert_eq!(high[0].as_ref().unwrap().curve, 1, "the point sits on the upper curve's level");
        let low = answer(&query(Some(vec![5.0])));
        assert_eq!(low[0].as_ref().unwrap().curve, 0);
    }
}
