use crate::ConstructionSession;
use grafting_graph_core::profile_cap::CapBase;
use grafting_graph_core::profile_cap_patch::{CapRequest, generate_cap_patch};
use serde_json::{Value, json};

fn patch(base: CapBase) -> Value {
    let cap = generate_cap_patch(CapRequest {
        base,
        elevation: 3.0,
        height: 2.0,
        overhang: 0.2,
        curvatures: [-1.0, 0.0, 1.0, 0.5],
    })
    .unwrap();
    json!({
        "operationId": "cap-op", "sourceSurfaceKeys": [],
        "patch": {
            "nodes": cap.nodes.iter().enumerate().map(|(i,p)| json!({"id":format!("n{i}"),"position":p})).collect::<Vec<_>>(),
            "edges": cap.edges.iter().enumerate().map(|(i,e)| json!({"edgeId":format!("e{i}"),
                "startNodeId":format!("n{}",e.start),"endNodeId":format!("n{}",e.end),
                "geometry": e.center.map_or(json!({"kind":"line"}), |center| json!({"kind":"arc","center":center,"clockwise":false}))})).collect::<Vec<_>>(),
            "regions": cap.faces.iter().enumerate().map(|(i,f)| json!({"regionId":format!("f{i}"),
                "surfaceType":"roof","physical":true,"profile":f.profile,
                "boundary": f.boundary.iter().map(|(e,reversed)| json!({"edgeId":format!("e{e}"),"reversed":reversed})).collect::<Vec<_>>() })).collect::<Vec<_>>()
        }
    })
}

#[test]
fn cap_profiles_round_trip_through_live_topology_mesh_and_undo() {
    for base in [
        CapBase::Circle {
            center: [0.0, 0.0],
            radius: 2.0,
        },
        CapBase::Rectangle {
            min: [0.0, 0.0],
            max: [8.0, 4.0],
        },
    ] {
        let mut session = ConstructionSession::new();
        session
            .apply_patch_replacement_json(&patch(base).to_string())
            .unwrap();
        let topologies: Value =
            serde_json::from_str(&session.all_region_topologies_json().unwrap()).unwrap();
        assert_eq!(topologies.as_array().unwrap().len(), 4);
        assert_eq!(topologies[0]["profile"]["middle"], -1.0);
        let before = session.all_surface_meshes_json().unwrap();
        let meshes: Value = serde_json::from_str(&before).unwrap();
        assert_eq!(meshes.as_array().unwrap().len(), 4);
        for mesh in meshes.as_array().unwrap() {
            assert!(mesh["indices"].as_array().unwrap().len() > 3);
            assert!(
                mesh["positions"]
                    .as_array()
                    .unwrap()
                    .chunks_exact(3)
                    .all(|p| (3.0..=5.0).contains(&p[1].as_f64().unwrap()))
            );
        }
        session.undo_region_overlay("cap-op").unwrap();
        assert_eq!(session.all_surface_meshes_json().unwrap(), "[]");
        session.redo_region_overlay("cap-op").unwrap();
        assert_eq!(session.all_surface_meshes_json().unwrap(), before);
    }
}

#[test]
fn malformed_profile_rejects_before_adding_nodes() {
    let mut value = patch(CapBase::Circle {
        center: [0.0, 0.0],
        radius: 2.0,
    });
    value["patch"]["regions"][0]["profile"]["middle"] = json!(2.0);
    let request = serde_json::from_value(value["patch"].clone()).unwrap();
    let mut session = ConstructionSession::new();
    assert!(
        crate::region_editing::apply_add_patch(
            &mut session.graph,
            &mut session.topology,
            &mut session.surfaces,
            request
        )
        .is_err()
    );
    assert!(session.graph.snapshot().nodes().is_empty());
}
