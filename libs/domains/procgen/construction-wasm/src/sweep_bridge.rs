//! JSON bridge for the graph-neutral sweep planner.
//!
//! This module exposes geometry only. It knows nothing about paths, surface
//! types, graph identities, creation policy, or topology mutations.

use serde::{Deserialize, Serialize};

use grafting_procgen_surface_transformations::{
    SweepFormationRequest, TransverseProfilePoint, plan_sweep_formation,
};

/// One transverse profile sample received from an application recipe.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepProfilePointRequest {
    lateral_offset: f32,
    elevation: f32,
}

/// Pure sweep request in construction-world XZ coordinates.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSweepRequest {
    reference_line: Vec<[f32; 3]>,
    profile: Vec<SweepProfilePointRequest>,
    miter_limit: f32,
}

/// Graph-neutral sweep geometry returned to the application.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSweepResponse {
    reference_line: Vec<[f32; 3]>,
    vertices: Vec<[f32; 3]>,
    quads: Vec<[usize; 4]>,
    boundary: Vec<usize>,
}

/// Executes the reusable Rust geometry algorithm without mutating a session.
pub fn plan_sweep(request: PlanSweepRequest) -> Result<PlanSweepResponse, String> {
    let plan = plan_sweep_formation(&SweepFormationRequest {
        reference_line: request.reference_line,
        profile: request
            .profile
            .into_iter()
            .map(|point| TransverseProfilePoint {
                lateral_offset: point.lateral_offset,
                elevation: point.elevation,
            })
            .collect(),
        miter_limit: request.miter_limit,
    })
    .map_err(|error| error.to_string())?;
    Ok(PlanSweepResponse {
        reference_line: plan.reference_line().to_vec(),
        vertices: plan.vertices().to_vec(),
        quads: plan.quads().to_vec(),
        boundary: plan.boundary().to_vec(),
    })
}
