//! Generated public-API snapshot check for `grafting-graph-core`.
//!
//! The test is ignored during ordinary `cargo test` runs because Rustdoc JSON
//! requires the separately pinned nightly toolchain. The Nx `api-check` target
//! runs it explicitly; it never installs that toolchain itself.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const RUSTDOC_TOOLCHAIN: &str = include_str!("../../../../tools/rust-public-api-toolchain.txt");

#[test]
#[ignore = "run through graph-core:api-check with the pinned Rustdoc JSON toolchain installed"]
fn generated_public_api_matches_snapshot() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let rustdoc_json_path = rustdoc_json::Builder::default()
        .toolchain(RUSTDOC_TOOLCHAIN.trim())
        .manifest_path(manifest_dir.join("Cargo.toml"))
        .package("grafting-graph-core")
        .all_features(true)
        .build()
        .expect("build grafting-graph-core Rustdoc JSON with the pinned nightly");

    let public_api = public_api::Builder::from_rustdoc_json(rustdoc_json_path.clone())
        .omit_blanket_impls(true)
        .include_function_parameter_names(true)
        .build()
        .expect("derive the public API from Rustdoc JSON");

    let baseline = render_baseline(&public_api, &rustdoc_json_path);
    assert_or_update(
        &manifest_dir.join("tests/snapshots/public-api.txt"),
        &baseline,
    );
}

fn render_baseline(public_api: &public_api::PublicApi, rustdoc_json_path: &Path) -> String {
    let source = fs::read_to_string(rustdoc_json_path).expect("read the generated Rustdoc JSON");
    let rustdoc: rustdoc_types::Crate =
        serde_json::from_str(&source).expect("parse the generated Rustdoc JSON");
    let mut documented_items = BTreeMap::new();

    for public_item in public_api.items() {
        let Some(item) = rustdoc.index.get(&public_item.id()) else {
            continue;
        };
        if item.crate_id != 0 {
            continue;
        }
        let Some(documentation) = item.docs.as_deref() else {
            continue;
        };
        documented_items
            .entry(public_item.to_string())
            .or_insert_with(|| documentation.trim().to_owned());
    }

    let mut rendered = format!(
        "# Generated public API baseline\n\nRustdoc toolchain: `{}`  \nRustdoc JSON format: `{}`  \nDocumentation policy: `#![deny(missing_docs)]`\n\n## Signatures\n\n```text\n{public_api}```\n\n## Documentation evidence\n",
        RUSTDOC_TOOLCHAIN.trim(),
        rustdoc.format_version,
    );
    for (signature, documentation) in documented_items {
        rendered.push_str(&format!("\n### `{signature}`\n\n{documentation}\n",));
    }
    rendered
}

fn assert_or_update(snapshot_path: &Path, actual: &str) {
    let update = env::var("UPDATE_SNAPSHOTS")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "yes" | "true"))
        .unwrap_or(false);

    if update {
        if let Some(parent) = snapshot_path.parent() {
            fs::create_dir_all(parent).expect("create the public API snapshot directory");
        }
        fs::write(snapshot_path, actual).expect("write the generated public API baseline");
        return;
    }

    let expected = fs::read_to_string(snapshot_path)
        .expect("read the tracked public API baseline; run the documented update command first");
    assert!(
        baseline_matches(&expected, actual).is_ok(),
        "public API drifted; update intentionally and review the baseline diff"
    );
}

fn baseline_matches(expected: &str, actual: &str) -> Result<(), &'static str> {
    if expected == actual {
        Ok(())
    } else {
        Err("public API baseline mismatch")
    }
}

#[test]
fn baseline_comparison_rejects_drift() {
    assert_eq!(
        baseline_matches("tracked API", "changed API"),
        Err("public API baseline mismatch")
    );
}
