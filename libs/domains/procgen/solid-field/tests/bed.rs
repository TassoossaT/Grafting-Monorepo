//! The ground brought to rest under a structure instead of cut for it
//! (`Bed`, through `layer_surface`).

use std::collections::HashMap;

use grafting_procgen_solid_field::{Bed, Faces, LayerEdit, Vec3, layer_surface};

/// Square ground of `cells` x `cells` faces `cell` wide, centred on the
/// origin, counter-clockwise in plan.
fn ground(cell: f64, cells: usize, height: impl Fn(f64, f64) -> f64) -> Faces {
    let origin = -cell * cells as f64 / 2.0;
    let id = |i: usize, j: usize| i * (cells + 1) + j;
    let mut vertices = Vec::new();
    for i in 0..=cells {
        for j in 0..=cells {
            let (x, z) = (origin + i as f64 * cell, origin + j as f64 * cell);
            vertices.push(Vec3::new(x, height(x, z), z));
        }
    }
    let mut faces = Vec::new();
    for i in 0..cells {
        for j in 0..cells {
            faces.push(vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
        }
    }
    Faces { vertices, faces }
}

/// A straight road along x, `width` wide, its deck at `height(x)`.
fn road(from: f64, to: f64, width: f64, height: impl Fn(f64) -> f64) -> Faces {
    let steps = ((to - from) / 1.0).ceil() as usize;
    let mut vertices = Vec::new();
    for k in 0..=steps {
        let x = from + (to - from) * k as f64 / steps as f64;
        vertices.push(Vec3::new(x, height(x), -width / 2.0));
        vertices.push(Vec3::new(x, height(x), width / 2.0));
    }
    let faces = (0..steps)
        .map(|k| vec![2 * k, 2 * k + 2, 2 * k + 3, 2 * k + 1])
        .collect();
    Faces { vertices, faces }
}

fn bed(faces: Faces) -> Bed {
    Bed {
        faces,
        sink: 0.1,
        below: 1.5,
        above: 8.0,
        margin: 1.0,
        slope: 1.5,
        shoulder: 1.0,
    }
}

fn edges(faces: &[Vec<usize>]) -> HashMap<(usize, usize), usize> {
    let mut uses = HashMap::new();
    for face in faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            *uses.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    uses
}

/// The new ground's height nearest `(x, z)` in plan.
fn height_near(out: &[Vec3], x: f64, z: f64) -> f64 {
    out.iter()
        .min_by(|a, b| {
            (a.x - x)
                .hypot(a.z - z)
                .total_cmp(&(b.x - x).hypot(b.z - z))
        })
        .unwrap()
        .y
}

fn lay(
    all: &Faces,
    beds: Vec<Bed>,
    near: impl Fn(Vec3) -> bool,
) -> (Faces, Vec<Vec3>, Vec<Vec<usize>>) {
    let touched = |face: &Vec<usize>| face.iter().any(|&v| near(all.vertices[v]));
    let patch = Faces {
        vertices: all.vertices.clone(),
        faces: all.faces.iter().filter(|f| touched(f)).cloned().collect(),
    };
    let context = Faces {
        vertices: all.vertices.clone(),
        faces: all.faces.iter().filter(|f| !touched(f)).cloned().collect(),
    };
    let edit = LayerEdit {
        shapes: Vec::new(),
        blend: 0.5,
        face_side: 1.0,
        seed: 3,
        table: None,
        beds,
    };
    let out = layer_surface(&patch, &context, &Faces::default(), &edit)
        .expect("the ground comes to rest");
    (patch, out.vertices, out.faces)
}

#[test]
fn a_road_over_a_dip_raises_the_ground_to_just_under_it_and_eases_off_round_it() {
    let all = ground(1.0, 30, |_, _| 0.0);
    let (patch, vertices, faces) = lay(&all, vec![bed(road(-8.0, 8.0, 4.0, |_| 1.0))], |p| {
        p.z.abs() < 8.0 && p.x.abs() < 12.0
    });
    let under = height_near(&vertices, 0.0, 0.0);
    assert!(
        (under - 0.9).abs() < 0.05,
        "under the road, just under it: {under}"
    );
    let beside = height_near(&vertices, 0.0, 6.5);
    assert!(beside < 0.3, "eased back off past the shoulder: {beside}");
    // One surface: its open border is the patch's own ring, nothing cut.
    let open = edges(&faces).into_values().filter(|&n| n == 1).count();
    assert_eq!(
        open,
        edges(&patch.faces)
            .into_values()
            .filter(|&n| n == 1)
            .count(),
        "no hole"
    );
}

#[test]
fn a_road_sunk_in_a_hill_cuts_the_ground_down_to_it() {
    let all = ground(1.0, 30, |_, _| 3.0);
    let (_, vertices, _) = lay(&all, vec![bed(road(-8.0, 8.0, 4.0, |_| 0.0))], |p| {
        p.z.abs() < 12.0 && p.x.abs() < 12.0
    });
    let under = height_near(&vertices, 0.0, 0.0);
    assert!(
        (under + 0.1).abs() < 0.05,
        "cut down to just under the road: {under}"
    );
    // The cutting's sides rise back to the hill, never a wall.
    let side = height_near(&vertices, 0.0, 4.0);
    assert!(side > -0.1 && side < 3.0, "the cutting's shoulder: {side}");
}

#[test]
fn a_bridge_high_over_the_ground_leaves_it_as_it_is() {
    let all = ground(1.0, 30, |_, _| 0.0);
    let (_, vertices, _) = lay(&all, vec![bed(road(-8.0, 8.0, 4.0, |_| 6.0))], |p| {
        p.z.abs() < 8.0 && p.x.abs() < 12.0
    });
    assert!(
        vertices.iter().all(|v| v.y.abs() < 1e-9),
        "nothing moved under a bridge six metres up"
    );
}

#[test]
fn a_road_laid_as_one_long_face_over_a_hill_rests_the_ground_just_under_its_own_height() {
    // As the road tool lays it: one face, down one side and back up the other.
    let hill = |x: f64| 4.0 * (-(x * x) / 50.0).exp();
    let strip = road(-14.0, 14.0, 2.0, hill);
    let count = strip.vertices.len();
    let one: Vec<usize> = (0..count)
        .step_by(2)
        .chain((1..count).step_by(2).rev())
        .collect();
    let all = ground(1.0, 40, |x, _| hill(x) - 0.3);
    let (_, vertices, _) = lay(
        &all,
        vec![bed(Faces {
            vertices: strip.vertices,
            faces: vec![one],
        })],
        |p| p.z.abs() < 8.0 && p.x.abs() < 16.0,
    );
    let under: Vec<&Vec3> = vertices
        .iter()
        .filter(|v| v.z.abs() < 0.9 && v.x.abs() < 12.0)
        .collect();
    assert!(under.len() > 10, "corners under the road: {}", under.len());
    for v in under {
        assert!(
            (v.y - (hill(v.x) - 0.1)).abs() < 0.05,
            "at {}: {} under a road at {}",
            v.x,
            v.y,
            hill(v.x)
        );
    }
}
