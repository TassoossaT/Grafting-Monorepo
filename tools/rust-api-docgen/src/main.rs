//! Curated public-API Markdown extractor for any Grafting workspace crate.
//!
//! Generalizes the Rustdoc JSON + `public-api` curation
//! `grafting-graph-core`'s own `tests/public_api_snapshot.rs` already
//! proves for its narrow drift check: build Rustdoc JSON with the pinned
//! nightly toolchain, derive the genuinely public surface (blanket impls
//! omitted, matching that existing usage), and render a flat
//! `### signature` + doc-body Markdown document -- the same shape
//! tools/scripts/generate-api-docs.mjs renders for the TypeScript side,
//! and the shape `tests/snapshots/public-api.txt` already proved for
//! this repo. Not the raw Rustdoc JSON model, which duplicates every impl
//! block as its own noisy index entry, and not a JSON map either: the one
//! real consumer today is an agent reading the whole file, and Markdown's
//! header structure and lower punctuation cost suit that better.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const RUSTDOC_TOOLCHAIN: &str = include_str!("../../rust-public-api-toolchain.txt");

// #[derive(...)] generates one impl-block item per trait plus one pub fn
// item per trait method, none of it ever documented -- real signal (the
// crate's own doc comments) drowns in it otherwise. A denylist heuristic,
// not semantic analysis: any of these that ever gains a real doc comment
// stops being filtered, since the filter only applies when doc.is_none().
const DERIVE_ONLY_METHOD_NAMES: &[&str] =
    &["clone", "eq", "ne", "fmt", "hash", "cmp", "partial_cmp", "default"];

fn is_undocumented_derive_noise(signature: &str) -> bool {
    if signature.starts_with("impl ") {
        return true;
    }
    let Some(function_signature) = signature.strip_prefix("pub fn ") else {
        return false;
    };
    let Some(path) = function_signature.split('(').next() else {
        return false;
    };
    // Strip a generic-parameter clause (e.g. `hash<__H: core::hash::Hasher>`)
    // *before* splitting on `::`, since the bound itself can contain `::`
    // (`core::hash::Hasher`) and would otherwise win the split.
    let path_without_generics = path.split_once('<').map_or(path, |(before, _)| before);
    let Some(method_name) = path_without_generics.rsplit("::").next() else {
        return false;
    };
    DERIVE_ONLY_METHOD_NAMES.contains(&method_name)
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let (Some(package), Some(output_path)) = (args.next(), args.next()) else {
        eprintln!("usage: grafting-rust-api-docgen <package> <output-json-path>");
        return ExitCode::FAILURE;
    };

    let workspace_manifest =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.toml");

    let rustdoc_json_path = rustdoc_json::Builder::default()
        .toolchain(RUSTDOC_TOOLCHAIN.trim())
        .manifest_path(&workspace_manifest)
        .package(package.as_str())
        .all_features(true)
        .build()
        .unwrap_or_else(|error| panic!("build {package}'s Rustdoc JSON with the pinned nightly: {error}"));

    let public_api = public_api::Builder::from_rustdoc_json(rustdoc_json_path.clone())
        .omit_blanket_impls(true)
        .include_function_parameter_names(true)
        .build()
        .unwrap_or_else(|error| panic!("derive {package}'s public API from Rustdoc JSON: {error}"));

    let rustdoc_source =
        fs::read_to_string(&rustdoc_json_path).expect("read the generated Rustdoc JSON");
    let rustdoc: rustdoc_types::Crate =
        serde_json::from_str(&rustdoc_source).expect("parse the generated Rustdoc JSON");

    let mut items: BTreeMap<String, Option<&str>> = BTreeMap::new();
    for public_item in public_api.items() {
        let doc = rustdoc
            .index
            .get(&public_item.id())
            .filter(|item| item.crate_id == 0)
            .and_then(|item| item.docs.as_deref())
            .map(str::trim);
        let signature = public_item.to_string();
        if doc.is_none() && is_undocumented_derive_noise(&signature) {
            continue;
        }
        items.insert(signature, doc);
    }

    let mut rendered = format!("# {package}\n\n");
    for (signature, doc) in &items {
        match doc {
            Some(doc) => rendered.push_str(&format!("### `{signature}`\n\n{doc}\n\n")),
            None => rendered.push_str(&format!("### `{signature}`\n\n")),
        }
    }

    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).expect("create the output directory");
    }
    fs::write(&output_path, rendered.trim_end().to_string() + "\n")
        .expect("write the curated public API Markdown");

    ExitCode::SUCCESS
}
