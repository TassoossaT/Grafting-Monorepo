//! Deterministic sweep formation from a reference line and a transverse profile.
//!
//! The formation is deliberately independent from graph identities and surface
//! types. Consumers can use its vertices and shared quad indices to assemble a
//! graph patch, derive a navigation line, or render a preview without deriving
//! a second version of the geometry algorithm.

use std::error::Error;
use std::fmt;

const COINCIDENT_EPSILON: f32 = 0.000_01;

/// One sample of a formation's transverse profile.
///
/// `lateral_offset` is measured left/right from the reference line in world
/// units. `elevation` is copied directly into the resulting vertex; callers
/// own the policy that decides which elevations are valid for their product.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransverseProfilePoint {
    /// Signed world-space distance from the reference line.
    pub lateral_offset: f32,
    /// World-space Y coordinate at this lateral offset.
    pub elevation: f32,
}

/// Input for one deterministic profile sweep.
#[derive(Debug, Clone, PartialEq)]
pub struct SweepFormationRequest {
    /// Ordered XZ reference-line samples.
    pub reference_line: Vec<[f32; 2]>,
    /// Strictly left-to-right cross-section samples.
    pub profile: Vec<TransverseProfilePoint>,
    /// Longest allowed spacing between consecutive generated stations.
    pub max_segment_length: f32,
    /// Largest allowed corner miter, expressed as a multiple of lateral offset.
    pub miter_limit: f32,
}

/// Reusable failures while creating a profile sweep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SweepFormationFailure {
    /// The reference line does not contain two distinct finite points.
    InvalidReferenceLine,
    /// The profile is not finite, has fewer than two points, or is unordered.
    InvalidProfile,
    /// The requested longitudinal sampling spacing is invalid.
    InvalidSegmentLength,
    /// The requested corner miter limit is invalid.
    InvalidMiterLimit,
}

impl fmt::Display for SweepFormationFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidReferenceLine => formatter
                .write_str("sweep formation requires two distinct finite reference-line points"),
            Self::InvalidProfile => formatter
                .write_str("sweep formation requires two finite, strictly ordered profile points"),
            Self::InvalidSegmentLength => {
                formatter.write_str("sweep formation requires a finite positive max segment length")
            }
            Self::InvalidMiterLimit => {
                formatter.write_str("sweep formation requires a finite miter limit of at least one")
            }
        }
    }
}

impl Error for SweepFormationFailure {}

/// Graph-neutral result of sweeping a profile along a reference line.
///
/// Vertices are arranged station-major: every consecutive `profile_len`
/// entries form one transverse station. Each quad references those shared
/// vertices, so neighbouring strips are topologically connected by design.
#[derive(Debug, Clone, PartialEq)]
pub struct SweepFormationPlan {
    reference_line: Vec<[f32; 2]>,
    vertices: Vec<[f32; 3]>,
    quads: Vec<[usize; 4]>,
    boundary: Vec<usize>,
    profile_len: usize,
}

impl SweepFormationPlan {
    /// Resampled reference line used by this exact formation.
    pub fn reference_line(&self) -> &[[f32; 2]] {
        &self.reference_line
    }

    /// Generated world-space vertices, arranged one transverse station at a time.
    pub fn vertices(&self) -> &[[f32; 3]] {
        &self.vertices
    }

    /// Shared-vertex quad cells between neighbouring stations and profile samples.
    pub fn quads(&self) -> &[[usize; 4]] {
        &self.quads
    }

    /// Ordered outer cycle of the complete formation, expressed as vertex indices.
    ///
    /// This is the exact rim a terrain replacement uses as its hole boundary;
    /// it never includes an interior strip edge.
    pub fn boundary(&self) -> &[usize] {
        &self.boundary
    }

    /// Number of profile vertices in every transverse station.
    pub fn profile_len(&self) -> usize {
        self.profile_len
    }
}

/// Samples a transverse profile along a reference line into connected quads.
///
/// The reference line is resampled by `max_segment_length`; this makes curves
/// denser without introducing a global terrain grid. Outer boundaries and
/// interior strips share the exact same vertex indices, so a caller can turn
/// the plan into a manifold graph patch without welding coincident geometry.
pub fn plan_sweep_formation(
    request: &SweepFormationRequest,
) -> Result<SweepFormationPlan, SweepFormationFailure> {
    validate_request(request)?;
    let reference_line =
        resample_reference_line(&request.reference_line, request.max_segment_length);
    if reference_line.len() < 2 {
        return Err(SweepFormationFailure::InvalidReferenceLine);
    }

    let profile_len = request.profile.len();
    let mut vertices = Vec::with_capacity(reference_line.len() * profile_len);
    for (index, station) in reference_line.iter().copied().enumerate() {
        let frame = station_frame(&reference_line, index, request.miter_limit);
        for profile_point in &request.profile {
            vertices.push([
                station[0] + frame[0] * profile_point.lateral_offset,
                profile_point.elevation,
                station[1] + frame[1] * profile_point.lateral_offset,
            ]);
        }
    }

    let mut quads = Vec::with_capacity((reference_line.len() - 1) * (profile_len - 1));
    for station in 0..reference_line.len() - 1 {
        let current = station * profile_len;
        let next = (station + 1) * profile_len;
        for profile_index in 0..profile_len - 1 {
            quads.push([
                current + profile_index,
                next + profile_index,
                next + profile_index + 1,
                current + profile_index + 1,
            ]);
        }
    }
    let boundary = outer_boundary(reference_line.len(), profile_len);

    Ok(SweepFormationPlan {
        reference_line,
        vertices,
        quads,
        boundary,
        profile_len,
    })
}

fn outer_boundary(station_len: usize, profile_len: usize) -> Vec<usize> {
    let last_station = station_len - 1;
    let mut boundary: Vec<usize> = (0..profile_len).collect();
    boundary.extend((1..station_len).map(|station| station * profile_len + profile_len - 1));
    boundary.extend(
        (0..profile_len - 1)
            .rev()
            .map(|profile| last_station * profile_len + profile),
    );
    boundary.extend((1..last_station).rev().map(|station| station * profile_len));
    boundary
}

fn validate_request(request: &SweepFormationRequest) -> Result<(), SweepFormationFailure> {
    if !request.max_segment_length.is_finite() || request.max_segment_length <= 0.0 {
        return Err(SweepFormationFailure::InvalidSegmentLength);
    }
    if !request.miter_limit.is_finite() || request.miter_limit < 1.0 {
        return Err(SweepFormationFailure::InvalidMiterLimit);
    }
    if request.reference_line.len() < 2
        || request
            .reference_line
            .iter()
            .flatten()
            .any(|coordinate| !coordinate.is_finite())
    {
        return Err(SweepFormationFailure::InvalidReferenceLine);
    }
    if request.profile.len() < 2
        || request
            .profile
            .iter()
            .any(|point| !point.lateral_offset.is_finite() || !point.elevation.is_finite())
        || request
            .profile
            .windows(2)
            .any(|pair| pair[0].lateral_offset >= pair[1].lateral_offset)
    {
        return Err(SweepFormationFailure::InvalidProfile);
    }
    Ok(())
}

fn resample_reference_line(samples: &[[f32; 2]], max_segment_length: f32) -> Vec<[f32; 2]> {
    let mut distinct = Vec::with_capacity(samples.len());
    for sample in samples {
        if distinct
            .last()
            .is_none_or(|previous| distance(*previous, *sample) > COINCIDENT_EPSILON)
        {
            distinct.push(*sample);
        }
    }
    let Some(&first) = distinct.first() else {
        return Vec::new();
    };
    let mut resampled = vec![first];
    for pair in distinct.windows(2) {
        let length = distance(pair[0], pair[1]);
        let segments = (length / max_segment_length).ceil().max(1.0) as usize;
        for segment in 1..=segments {
            let ratio = segment as f32 / segments as f32;
            resampled.push([
                pair[0][0] + (pair[1][0] - pair[0][0]) * ratio,
                pair[0][1] + (pair[1][1] - pair[0][1]) * ratio,
            ]);
        }
    }
    resampled
}

fn station_frame(reference_line: &[[f32; 2]], index: usize, miter_limit: f32) -> [f32; 2] {
    let current = reference_line[index];
    if index == 0 {
        return left_normal(normalize(subtract(reference_line[1], current)));
    }
    if index + 1 == reference_line.len() {
        return left_normal(normalize(subtract(current, reference_line[index - 1])));
    }

    let incoming = normalize(subtract(current, reference_line[index - 1]));
    let outgoing = normalize(subtract(reference_line[index + 1], current));
    let incoming_normal = left_normal(incoming);
    let outgoing_normal = left_normal(outgoing);
    let bisector = normalize(add(incoming_normal, outgoing_normal));
    let denominator = dot(bisector, outgoing_normal);
    if denominator.abs() <= COINCIDENT_EPSILON {
        return outgoing_normal;
    }
    let scale = (1.0 / denominator).clamp(-miter_limit, miter_limit);
    [bisector[0] * scale, bisector[1] * scale]
}

fn distance(left: [f32; 2], right: [f32; 2]) -> f32 {
    let delta = subtract(right, left);
    (delta[0] * delta[0] + delta[1] * delta[1]).sqrt()
}

fn subtract(left: [f32; 2], right: [f32; 2]) -> [f32; 2] {
    [left[0] - right[0], left[1] - right[1]]
}

fn add(left: [f32; 2], right: [f32; 2]) -> [f32; 2] {
    [left[0] + right[0], left[1] + right[1]]
}

fn normalize(vector: [f32; 2]) -> [f32; 2] {
    let length = (vector[0] * vector[0] + vector[1] * vector[1]).sqrt();
    if length <= COINCIDENT_EPSILON {
        [1.0, 0.0]
    } else {
        [vector[0] / length, vector[1] / length]
    }
}

fn left_normal(tangent: [f32; 2]) -> [f32; 2] {
    [-tangent[1], tangent[0]]
}

fn dot(left: [f32; 2], right: [f32; 2]) -> f32 {
    left[0] * right[0] + left[1] * right[1]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        reference_line: Vec<[f32; 2]>,
        profile: Vec<TransverseProfilePoint>,
    ) -> SweepFormationRequest {
        SweepFormationRequest {
            reference_line,
            profile,
            max_segment_length: 1.0,
            miter_limit: 4.0,
        }
    }

    #[test]
    fn creates_a_connected_flat_ribbon_from_two_profile_points() {
        let plan = plan_sweep_formation(&request(
            vec![[0.0, 0.0], [3.0, 0.0]],
            vec![
                TransverseProfilePoint {
                    lateral_offset: -1.0,
                    elevation: 0.0,
                },
                TransverseProfilePoint {
                    lateral_offset: 1.0,
                    elevation: 0.0,
                },
            ],
        ))
        .expect("valid formation");

        assert_eq!(plan.reference_line().len(), 4);
        assert_eq!(plan.vertices().len(), 8);
        assert_eq!(plan.quads(), &[[0, 2, 3, 1], [2, 4, 5, 3], [4, 6, 7, 5]]);
        assert_eq!(plan.boundary(), &[0, 1, 3, 5, 7, 6, 4, 2]);
        assert!(plan.vertices().iter().all(|vertex| vertex[1] == 0.0));
    }

    #[test]
    fn preserves_every_band_of_a_u_shaped_profile() {
        let plan = plan_sweep_formation(&request(
            vec![[0.0, 0.0], [1.0, 0.0]],
            vec![
                TransverseProfilePoint {
                    lateral_offset: -2.0,
                    elevation: 1.0,
                },
                TransverseProfilePoint {
                    lateral_offset: -1.0,
                    elevation: 0.0,
                },
                TransverseProfilePoint {
                    lateral_offset: 1.0,
                    elevation: 0.0,
                },
                TransverseProfilePoint {
                    lateral_offset: 2.0,
                    elevation: 1.0,
                },
            ],
        ))
        .expect("valid formation");

        assert_eq!(plan.profile_len(), 4);
        assert_eq!(plan.quads().len(), 3);
        assert_eq!(
            plan.vertices()
                .iter()
                .map(|vertex| vertex[1])
                .collect::<Vec<_>>(),
            vec![1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0]
        );
    }

    #[test]
    fn joins_a_bend_without_duplicate_station_vertices() {
        let plan = plan_sweep_formation(&request(
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
            vec![
                TransverseProfilePoint {
                    lateral_offset: -0.5,
                    elevation: 0.0,
                },
                TransverseProfilePoint {
                    lateral_offset: 0.5,
                    elevation: 0.0,
                },
            ],
        ))
        .expect("valid formation");

        assert_eq!(plan.vertices().len(), 6);
        assert_eq!(plan.quads(), &[[0, 2, 3, 1], [2, 4, 5, 3]]);
        assert!(
            plan.vertices()
                .iter()
                .all(|vertex| vertex.iter().all(|value| value.is_finite()))
        );
    }

    #[test]
    fn rejects_an_unordered_profile() {
        let error = plan_sweep_formation(&request(
            vec![[0.0, 0.0], [1.0, 0.0]],
            vec![
                TransverseProfilePoint {
                    lateral_offset: 1.0,
                    elevation: 0.0,
                },
                TransverseProfilePoint {
                    lateral_offset: -1.0,
                    elevation: 0.0,
                },
            ],
        ))
        .expect_err("unordered profile cannot form strips");

        assert_eq!(error, SweepFormationFailure::InvalidProfile);
    }
}
