//! Test/tooling-only CLI, behind the `abi-info-cli` feature (never built
//! into the real `cdylib`): prints `EngineAbiInfo::current()` as JSON, so
//! `tools/scripts/generate-artifact-manifest.mjs` (G-004) reads the real
//! runtime value instead of re-deriving it by parsing Rust source --
//! avoids duplicating logic that would silently drift as
//! `feature_flags`'s active set grows (e.g. once GPU support lands).
//!
//! Run via `cargo run -p grafting-isekai-capi --features abi-info-cli
//! --bin abi-info-cli`.

use grafting_isekai_capi::abi_info::{EngineAbiInfo, FEATURE_CPU_BACKEND, FEATURE_GPU_BACKEND};

fn main() {
    let info = EngineAbiInfo::current();

    let mut features = Vec::new();
    if info.feature_flags & FEATURE_CPU_BACKEND != 0 {
        features.push("cpu");
    }
    if info.feature_flags & FEATURE_GPU_BACKEND != 0 {
        features.push("gpu");
    }
    let features_json = features
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(",");

    // Hand-written JSON, not serde_json -- this crate has no other real
    // need for a JSON dependency, and this shape is small/flat enough
    // not to justify adding one just for this CLI (see G-004's design
    // notes in CURRENT_PLANNING_STATE.md). `protocolMinor` is always 0:
    // `EngineAbiInfo.protocol_version` is a single field in the real
    // struct, not split into major/minor -- treated as the major
    // component here, not an invented minor value.
    println!(
        "{{\"abiMajor\":{},\"abiMinor\":{},\"protocolMajor\":{},\"protocolMinor\":0,\"features\":[{}]}}",
        info.abi_major, info.abi_minor, info.protocol_version, features_json
    );
}
