//! Projection of a ground-plane point onto the reference curves it was
//! generated from -- "where on the curve is this, how far off it, and how
//! high is the curve there".
//!
//! **Why this exists at all.** A banded contour is built from a curve, then
//! unioned in plain 2D, and the union throws elevation away: it works in
//! `[x, z]` and has no opinion about height. Every stage after it has
//! therefore had to invent one. Nearest-neighbour over the ribbon samples is
//! what that invention looked like, and it is wrong in exactly the way a
//! nearest-neighbour lookup always is -- the nearest *sample* to a point on
//! one margin is regularly a sample on the opposite margin, or on a
//! different curve entirely, and the height comes back from the wrong place.
//!
//! Projecting instead answers the question that was actually being asked.
//! The curve is the thing the surface was derived from, so a point's height
//! is the curve's height at the station the point projects onto, not the
//! height of whichever sample happened to land closest.
//!
//! **The same projection is the surface's parametrization.** `s` (distance
//! travelled along the curve) and `t` (signed distance off it) are a
//! coordinate system on the generated surface that survives everything the
//! geometry does not: regenerating the contour, refining the mesh
//! differently, widening the band, even nudging the curve. Anything anchored
//! to `(curve, s, t)` is still in the same place afterwards, which no vertex
//! index or triangle id can promise -- those are re-minted on every rebuild.
//!
//! Deliberately free of any particular product concept, like the rest of
//! this module: it knows curves with elevation, never a road, a corridor or
//! a station.

/// One reference curve, already flattened to segments, carrying elevation.
///
/// `y` is world height; `x`/`z` are the ground plane. Height rides along
/// rather than being a separate array because the whole point of this type
/// is that the curve is the elevation authority for whatever was swept from
/// it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ReferenceCurve {
    /// Ordered samples, `[x, y, z]`.
    pub points: Vec<[f32; 3]>,
    /// How far off this curve the surface it generated actually reaches --
    /// its widest band offset.
    ///
    /// This is what lets the field say "not mine" instead of answering for
    /// ground it never generated. A point further off than `reach` was swept
    /// from some other curve, or from nothing at all, and reading this
    /// curve's height there would be the same category of mistake
    /// nearest-neighbour makes. Per curve rather than one figure for the
    /// whole field because a footpath and an avenue are the same kind of
    /// thing at different widths, and a shared cap would be wrong for both.
    pub reach: f32,
}

/// Where a point sits relative to the curve it projected onto.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FieldSample {
    /// Index into the field's own curve list.
    pub curve: usize,
    /// Distance travelled along the curve to the projection, in world units
    /// measured on the ground plane.
    pub s: f32,
    /// Signed distance off the curve; positive to the left of travel.
    pub t: f32,
    /// The curve's own height at the projection.
    pub y: f32,
}

#[derive(Debug, Clone)]
struct CurveData {
    points: Vec<[f32; 3]>,
    /// Cumulative ground-plane arclength at each point; one per point.
    stations: Vec<f32>,
    reach: f32,
}

/// Every reference curve a generated surface may have come from, queried
/// together so a point lands on whichever one is actually nearest -- which
/// is what makes a junction work without anybody having to decide in
/// advance which curve owns which part of it.
#[derive(Debug, Clone, Default)]
pub struct ReferenceField {
    curves: Vec<CurveData>,
}

impl ReferenceField {
    /// Builds the field, dropping any curve too short to project onto.
    pub fn new(curves: impl IntoIterator<Item = ReferenceCurve>) -> Self {
        let curves = curves
            .into_iter()
            .filter(|curve| curve.points.len() >= 2)
            .map(|curve| {
                let mut stations = Vec::with_capacity(curve.points.len());
                let mut travelled = 0.0;
                stations.push(0.0);
                for pair in curve.points.windows(2) {
                    travelled += ground_distance(pair[0], pair[1]);
                    stations.push(travelled);
                }
                CurveData {
                    points: curve.points,
                    stations,
                    reach: curve.reach.max(0.0),
                }
            })
            .collect();
        Self { curves }
    }

    /// Whether the field holds no curve, in which case it answers nothing.
    pub fn is_empty(&self) -> bool {
        self.curves.is_empty()
    }

    /// How many curves the field holds -- the range [`FieldSample::curve`]
    /// indexes into.
    pub fn len(&self) -> usize {
        self.curves.len()
    }

    /// The nearest curve's reading of `(x, z)`, or `None` when the field
    /// holds no curve at all.
    ///
    /// A point past a curve's end projects onto that end: `s` saturates at
    /// the curve's length and `y` is the end's own height, which is what a
    /// surface overshooting its curve -- an end cap -- should read.
    pub fn sample(&self, x: f32, z: f32) -> Option<FieldSample> {
        let mut best: Option<(f32, FieldSample)> = None;
        for (index, curve) in self.curves.iter().enumerate() {
            let Some((distance, sample)) = curve.project(index, x, z) else {
                continue;
            };
            let closer = match &best {
                Some((closest, _)) => distance < *closest,
                None => true,
            };
            if closer {
                best = Some((distance, sample));
            }
        }
        best.map(|(_, sample)| sample)
    }

    /// [`Self::sample`], refused unless the point lies inside the matched
    /// curve's own [`ReferenceCurve::reach`] -- "is this ground mine?".
    ///
    /// This is the gate that keeps a field from answering for ground it
    /// never generated. A face nowhere near a curve gets `None` for every
    /// one of its corners and is meshed the way it always was, with no
    /// caller anywhere having to ask what *kind* of surface it is looking
    /// at: the geometry decides, and any future surface swept from a curve
    /// inherits the same answer for free.
    ///
    /// `slack` widens the reach for the one vertex that legitimately sits a
    /// hair outside it -- a mitre overshooting a corner, a union vertex
    /// pushed out by float round-off. Multiplicative, so a wide curve gets
    /// proportionally more of it than a narrow one.
    pub fn sample_owned(&self, x: f32, z: f32, slack: f32) -> Option<FieldSample> {
        self.sample(x, z).filter(|sample| {
            self.curves
                .get(sample.curve)
                .is_some_and(|curve| sample.t.abs() <= curve.reach * slack.max(1.0))
        })
    }
}

fn ground_distance(from: [f32; 3], to: [f32; 3]) -> f32 {
    ((to[0] - from[0]).powi(2) + (to[2] - from[2]).powi(2)).sqrt()
}

impl CurveData {
    /// The nearest point of this curve to `(x, z)`, as `(distance, sample)`.
    fn project(&self, index: usize, x: f32, z: f32) -> Option<(f32, FieldSample)> {
        let mut best: Option<(f32, FieldSample)> = None;
        for (segment, pair) in self.points.windows(2).enumerate() {
            let (from, to) = (pair[0], pair[1]);
            let (dx, dz) = (to[0] - from[0], to[2] - from[2]);
            let length_squared = dx * dx + dz * dz;
            if length_squared < 1e-12 {
                continue;
            }
            let along = (((x - from[0]) * dx + (z - from[2]) * dz) / length_squared).clamp(0.0, 1.0);
            let projected_x = from[0] + dx * along;
            let projected_z = from[2] + dz * along;
            let distance = ((x - projected_x).powi(2) + (z - projected_z).powi(2)).sqrt();
            if let Some((closest, _)) = &best
                && distance >= *closest
            {
                continue;
            }
            // Positive to the left of travel. The magnitude is the real
            // distance to the curve rather than the perpendicular one, so a
            // point past an end reads its true remove from the curve instead
            // of a foreshortened value -- the lateral gate in
            // `sample_within` depends on that being honest.
            let side = (x - from[0]) * dz - (z - from[2]) * dx;
            best = Some((
                distance,
                FieldSample {
                    curve: index,
                    s: self.stations[segment] + length_squared.sqrt() * along,
                    t: if side < 0.0 { distance } else { -distance },
                    y: from[1] + (to[1] - from[1]) * along,
                },
            ));
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn straight() -> ReferenceField {
        ReferenceField::new([ReferenceCurve {
            points: vec![[0.0, 0.0, 0.0], [10.0, 5.0, 0.0]],
            reach: 4.0,
        }])
    }

    #[test]
    fn projects_onto_the_curve_and_reads_its_height_there() {
        let sample = straight().sample(4.0, 3.0).unwrap();
        assert!((sample.s - 4.0).abs() < 1e-4);
        assert!((sample.t.abs() - 3.0).abs() < 1e-4);
        // Four along in `x` is four tenths up in `y`, regardless of how far
        // off to the side the query was.
        assert!((sample.y - 2.0).abs() < 1e-4);
    }

    #[test]
    fn opposite_margins_read_opposite_signs_at_the_same_station() {
        let field = straight();
        let left = field.sample(4.0, 3.0).unwrap();
        let right = field.sample(4.0, -3.0).unwrap();
        assert!((left.s - right.s).abs() < 1e-4);
        assert!(left.t * right.t < 0.0);
        // The failure this module exists to stop: both margins are the same
        // height because the curve is one height there, even though the
        // nearest *sample* to each is on a different side.
        assert!((left.y - right.y).abs() < 1e-4);
    }

    #[test]
    fn a_point_past_the_end_saturates_rather_than_extrapolating() {
        let sample = straight().sample(20.0, 0.0).unwrap();
        assert!((sample.s - 10.0).abs() < 1e-4);
        assert!((sample.y - 5.0).abs() < 1e-4);
        assert!((sample.t.abs() - 10.0).abs() < 1e-4);
    }

    #[test]
    fn the_nearest_curve_wins_so_a_junction_needs_no_owner() {
        let field = ReferenceField::new([
            ReferenceCurve {
                points: vec![[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]],
                reach: 4.0,
            },
            ReferenceCurve {
                points: vec![[0.0, 8.0, 20.0], [10.0, 8.0, 20.0]],
                reach: 4.0,
            },
        ]);
        assert_eq!(field.sample(5.0, 1.0).unwrap().curve, 0);
        assert_eq!(field.sample(5.0, 19.0).unwrap().curve, 1);
    }

    #[test]
    fn the_reach_gate_refuses_ground_the_field_never_generated() {
        let field = straight();
        assert!(field.sample_owned(4.0, 3.0, 1.0).is_some());
        assert!(field.sample_owned(4.0, 40.0, 1.0).is_none());
        // Slack buys the vertex sitting a hair outside a mitred corner, and
        // nothing like the distance a foreign face sits at.
        assert!(field.sample_owned(4.0, 4.5, 1.0).is_none());
        assert!(field.sample_owned(4.0, 4.5, 1.25).is_some());
    }

    #[test]
    fn a_wide_curve_and_a_narrow_one_are_each_gated_by_their_own_reach() {
        let field = ReferenceField::new([
            ReferenceCurve {
                points: vec![[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]],
                reach: 1.0,
            },
            ReferenceCurve {
                points: vec![[0.0, 0.0, 40.0], [10.0, 0.0, 40.0]],
                reach: 9.0,
            },
        ]);
        assert!(field.sample_owned(5.0, 5.0, 1.0).is_none());
        assert!(field.sample_owned(5.0, 33.0, 1.0).is_some());
    }

    #[test]
    fn an_empty_field_answers_nothing() {
        let field = ReferenceField::new([]);
        assert!(field.is_empty());
        assert!(field.sample(0.0, 0.0).is_none());
    }
}
