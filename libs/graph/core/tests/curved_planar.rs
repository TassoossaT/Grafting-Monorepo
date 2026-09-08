use grafting_graph_core::{
    ContourGeometry as G, CurvedPlanarShape, PlanarBoolean as Op, PlanarCurve as C,
    curved_planar_boolean as boolean,
};
fn rect(x: f32, y: f32, w: f32, h: f32) -> CurvedPlanarShape {
    let p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    vec![
        (0..4)
            .map(|i| C {
                start: p[i],
                end: p[(i + 1) % 4],
                geometry: G::Line,
            })
            .collect(),
    ]
}
fn circle(x: f32, y: f32, r: f32) -> CurvedPlanarShape {
    let p = [[x + r, y], [x, y + r], [x - r, y], [x, y - r]];
    vec![
        (0..4)
            .map(|i| C {
                start: p[i],
                end: p[(i + 1) % 4],
                geometry: G::CircularArc {
                    center: [x, y],
                    clockwise: false,
                },
            })
            .collect(),
    ]
}
fn arcs(shapes: &[CurvedPlanarShape]) -> usize {
    shapes
        .iter()
        .flatten()
        .flatten()
        .filter(|c| matches!(c.geometry, G::CircularArc { .. }))
        .count()
}
fn reverse(shape: &CurvedPlanarShape) -> CurvedPlanarShape {
    shape
        .iter()
        .map(|r| {
            r.iter()
                .rev()
                .map(|c| C {
                    start: c.end,
                    end: c.start,
                    geometry: match c.geometry {
                        G::Line => G::Line,
                        G::CircularArc { center, clockwise } => G::CircularArc {
                            center,
                            clockwise: !clockwise,
                        },
                    },
                })
                .collect()
        })
        .collect()
}
#[test]
fn overlapping_extension_and_adjacent_join_preserve_seams() {
    for x in [2.0, 4.0] {
        let a = rect(0.0, 0.0, 4.0, 4.0);
        let b = rect(x, 1.0, 3.0, 2.0);
        let out = boolean(&[a.clone()], &[b], Op::Extend).unwrap();
        assert_eq!(out.len(), 2);
        for c in &a[0] {
            assert!(out.iter().flatten().flatten().any(|e| e.start == c.start));
        }
        assert!(out[0][0].iter().any(|e| e.start == [4.0, 1.0]));
        assert!(out[1][0].iter().any(|e| e.start == [4.0, 1.0]));
    }
}
#[test]
fn circles_keep_arcs_through_create_union_cut_extend_and_winding() {
    let a = circle(0.0, 0.0, 3.0);
    assert_eq!(arcs(&boolean(&[], &[a.clone()], Op::Union).unwrap()), 4);
    for a in [a.clone(), reverse(&a)] {
        let b = circle(3.0, 0.0, 3.0);
        for op in [Op::Union, Op::Difference, Op::Extend] {
            let out = boolean(&[a.clone()], &[b.clone()], op).unwrap();
            assert!(arcs(&out) > 0);
            assert!(
                out.iter()
                    .flatten()
                    .flatten()
                    .all(|e| matches!(e.geometry, G::CircularArc { .. }))
            );
        }
    }
}
#[test]
fn circular_holes_can_be_filled_and_cut_through() {
    let disk = circle(0.0, 0.0, 4.0);
    let hole = circle(0.0, 0.0, 2.0);
    let ring = boolean(&[disk], &[hole.clone()], Op::Difference).unwrap();
    assert_eq!(ring.len(), 1);
    assert_eq!(ring[0].len(), 2);
    assert_eq!(arcs(&ring), 8);
    let filled = boolean(&ring, &[hole], Op::Union).unwrap();
    assert_eq!(filled[0].len(), 1);
    assert_eq!(arcs(&filled), 4);
    let split = boolean(&ring, &[rect(-0.5, -5.0, 1.0, 10.0)], Op::Difference).unwrap();
    assert_eq!(split.len(), 2);
    assert!(arcs(&split) >= 8);
}
#[test]
fn exact_line_arc_crossings_survive_and_invalid_radii_reject() {
    let disk = circle(0.0, 0.0, 5.0);
    let out = boolean(
        &[disk.clone()],
        &[rect(3.0, -6.0, 3.0, 12.0)],
        Op::Difference,
    )
    .unwrap();
    let nodes: Vec<_> = out.iter().flatten().flatten().map(|e| e.start).collect();
    assert!(nodes.contains(&[3.0, 4.0]));
    assert!(nodes.contains(&[3.0, -4.0]));
    let mut bad = disk;
    bad[0][0].end = [0.0, 6.0];
    bad[0][1].start = [0.0, 6.0];
    assert!(boolean(&[], &[bad], Op::Union).is_err());
}
#[test]
fn coincident_and_tangent_circles_do_not_duplicate_or_lose_area() {
    let a = circle(0.0, 0.0, 2.0);
    let same = boolean(&[a.clone()], &[a.clone()], Op::Union).unwrap();
    assert_eq!(same.len(), 1);
    assert_eq!(arcs(&same), 4);
    assert!(
        boolean(&[a.clone()], &[a.clone()], Op::Difference)
            .unwrap()
            .is_empty()
    );
    let tangent = boolean(&[a], &[circle(4.0, 0.0, 2.0)], Op::Union).unwrap();
    assert_eq!(arcs(&tangent), 8);
}

#[test]
fn rotated_circle_intersections_remain_closed_without_chords() {
    for angle in [0.1_f32, 0.4, 0.8, 1.57, 2.4, 3.5, 5.7] {
        for d in [0.1_f32, 1.0, 2.0, 3.0, 3.99, 4.0, 4.1] {
            let a = circle(0.0, 0.0, 2.0);
            let b = circle(d * angle.cos(), d * angle.sin(), 2.0);
            for op in [Op::Union, Op::Difference, Op::Extend] {
                let out = boolean(&[a.clone()], &[b.clone()], op)
                    .unwrap_or_else(|e| panic!("{angle} {d} {op:?}: {e}"));
                for ring in out.iter().flatten() {
                    for (i, c) in ring.iter().enumerate() {
                        assert!(matches!(c.geometry, G::CircularArc { .. }));
                        let next = &ring[(i + 1) % ring.len()];
                        assert!((c.end[0] - next.start[0]).hypot(c.end[1] - next.start[1]) < 1e-5);
                    }
                }
            }
        }
    }
}
