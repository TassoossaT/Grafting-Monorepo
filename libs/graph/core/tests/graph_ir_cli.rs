#![cfg(feature = "graph-ir-cli")]

use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../docs/graph-ir/fixtures")
        .join(name)
}

#[test]
fn accepts_structurally_valid_graph_ir() {
    let output = Command::new(env!("CARGO_BIN_EXE_validate-graph-ir"))
        .arg(fixture("valid-minimal.graph.json"))
        .output()
        .expect("Graph IR validator runs");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn rejects_dangling_graph_ir_endpoint() {
    let output = Command::new(env!("CARGO_BIN_EXE_validate-graph-ir"))
        .arg(fixture("invalid-dangling-edge.graph.json"))
        .output()
        .expect("Graph IR validator runs");

    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("references missing target project:missing")
    );
}
