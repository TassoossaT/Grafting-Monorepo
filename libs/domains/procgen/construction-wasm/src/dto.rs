//! Shared wire-format conversion crossing the JSON boundary: `SurfaceKey`
//! as a plain node-id array.

use grafting_graph_core::{NodeId, SurfaceKey};

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
