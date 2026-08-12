//! Shared wire-format conversions crossing the JSON boundary: `SurfaceKey`
//! as a plain node-id array, and `WallNodeRole` as a hand-written wire name
//! (never a `Debug`-derived string, which would silently change if a
//! variant were ever renamed).

use grafting_graph_core::{NodeId, SurfaceKey};
use grafting_procgen_structure_generation::WallNodeRole;

/// Converts a node-id array into a [`SurfaceKey`]. Order does not matter --
/// [`SurfaceKey::from_cycle`] collects into an unordered set -- but every id
/// must be a valid, non-empty [`NodeId`].
pub fn surface_key_from_wire(ids: &[String]) -> Result<SurfaceKey, String> {
    let nodes = ids
        .iter()
        .map(|id| NodeId::new(id.clone()).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SurfaceKey::from_cycle(&nodes))
}

/// Converts a [`SurfaceKey`] into a node-id array, in the key's own
/// (sorted) iteration order.
pub fn surface_key_to_wire(key: &SurfaceKey) -> Vec<String> {
    key.nodes().iter().map(|id| id.as_str().to_owned()).collect()
}

/// The fixed wire name for a [`WallNodeRole`]. Hand-written, not `{:?}` --
/// see this module's doc comment.
pub fn wall_node_role_wire_name(role: WallNodeRole) -> &'static str {
    match role {
        WallNodeRole::StartBottom => "startBottom",
        WallNodeRole::StartTop => "startTop",
        WallNodeRole::EndBottom => "endBottom",
        WallNodeRole::EndTop => "endTop",
        WallNodeRole::DoorStartBottom => "doorStartBottom",
        WallNodeRole::DoorStartTop => "doorStartTop",
        WallNodeRole::DoorEndBottom => "doorEndBottom",
        WallNodeRole::DoorEndTop => "doorEndTop",
    }
}

/// Every [`WallNodeRole`] variant, for enumerating wire names (e.g. to
/// report which node-id entries a request is missing).
pub const ALL_WALL_NODE_ROLES: [WallNodeRole; 8] = [
    WallNodeRole::StartBottom,
    WallNodeRole::StartTop,
    WallNodeRole::EndBottom,
    WallNodeRole::EndTop,
    WallNodeRole::DoorStartBottom,
    WallNodeRole::DoorStartTop,
    WallNodeRole::DoorEndBottom,
    WallNodeRole::DoorEndTop,
];

/// Parses a wire name back into a [`WallNodeRole`]. The inverse of
/// [`wall_node_role_wire_name`]. Not called from production code today --
/// `wall.rs` only ever looks up a wire name it already computed from a real
/// [`WallNodeRole`], never the reverse -- kept because it is what proves
/// [`wall_node_role_wire_name`]'s mapping is bijective (see this module's
/// round-trip test), the same "tested infrastructure, not dead code"
/// reasoning `grafting-procgen-terrain-generation::bilinear_point` documents
/// for itself.
pub fn wall_node_role_from_wire(name: &str) -> Result<WallNodeRole, String> {
    ALL_WALL_NODE_ROLES
        .into_iter()
        .find(|role| wall_node_role_wire_name(*role) == name)
        .ok_or_else(|| format!("unknown wall node role wire name: {name}"))
}

/// The wire key for a directed pair of roles, used to look up an edge id
/// for one of [`grafting_procgen_structure_generation::generate_wall`]'s
/// ring edges. Directional (`a` then `b`), matching `generate_wall`'s own
/// `edge_id(a, b)` closure shape -- two pieces sharing a jamb node pair in
/// opposite traversal order naturally get distinct wire keys, so no two
/// pieces' ring edges ever collide on the same key.
pub fn wall_edge_role_pair_wire_name(a: WallNodeRole, b: WallNodeRole) -> String {
    format!("{}->{}", wall_node_role_wire_name(a), wall_node_role_wire_name(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::NodeId;

    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    #[test]
    fn surface_key_round_trips_regardless_of_input_order() {
        let key = surface_key_from_wire(&["c".into(), "a".into(), "b".into()]).unwrap();
        let mut wire = surface_key_to_wire(&key);
        wire.sort();
        assert_eq!(wire, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
        assert_eq!(key, SurfaceKey::from_cycle(&[nid("a"), nid("b"), nid("c")]));
    }

    #[test]
    fn surface_key_from_wire_rejects_an_empty_id() {
        let error = surface_key_from_wire(&["a".into(), String::new()]).unwrap_err();
        assert!(error.contains("empty"), "unexpected error: {error}");
    }

    #[test]
    fn every_wall_node_role_wire_name_round_trips() {
        for role in ALL_WALL_NODE_ROLES {
            let wire = wall_node_role_wire_name(role);
            assert_eq!(wall_node_role_from_wire(wire).unwrap(), role);
        }
    }

    #[test]
    fn wall_node_role_from_wire_rejects_an_unknown_name() {
        assert!(wall_node_role_from_wire("nope").is_err());
    }

    #[test]
    fn wall_edge_role_pair_wire_name_is_directional() {
        let forward = wall_edge_role_pair_wire_name(WallNodeRole::DoorStartBottom, WallNodeRole::DoorStartTop);
        let backward = wall_edge_role_pair_wire_name(WallNodeRole::DoorStartTop, WallNodeRole::DoorStartBottom);
        assert_ne!(forward, backward);
    }
}
