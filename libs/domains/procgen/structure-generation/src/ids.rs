//! A generated corner's id is a pure function of where it sits, never of
//! which generator minted it or which call produced it -- the property
//! every generator in this crate relies on to weld shared corners (two
//! adjacent cells, a straight run meeting an arc, a repainted stroke)
//! without any generator knowing about any other. Shared here so
//! `cell_partition` and `wall_path` mint byte-identical ids for the same
//! world position under the same `id_prefix`, instead of each keeping its
//! own copy that could silently drift apart.

use grafting_graph_core::NodeId;

/// A corner's id: `{id_prefix}:corner:{x}:{z}:{top|bottom}`. Y is
/// deliberately not part of this -- see each generator's own doc for what
/// that implies for its caller (an `id_prefix` must vary per physical
/// structure *and* per floor/level sharing the same footprint, or two
/// floors mint colliding corners).
pub(crate) fn corner_id(id_prefix: &str, x: f32, z: f32, top: bool) -> NodeId {
    let end = if top { "top" } else { "bottom" };
    NodeId::new(format!("{id_prefix}:corner:{:.3}:{:.3}:{end}", x as f64, z as f64)).expect("formatted id is never empty")
}
