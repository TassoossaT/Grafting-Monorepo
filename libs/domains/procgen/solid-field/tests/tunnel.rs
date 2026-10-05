//! A hill, then the same hill with a tunnel through it, split and laid end to
//! end. `PROBE=1` prints what each piece came out as.

use std::collections::HashMap;

use grafting_procgen_solid_field::{
    Effect, LaidPiece, Region, Shape, SolidField, SplitOptions, Vec3, lay_piece, seams, split,
};

const FACE_SIDE: f64 = 2.0;

fn probe() -> bool {
    std::env::var("PROBE").is_ok_and(|v| v == "1")
}

fn hill(x: f64, z: f64) -> f64 {
    6.0 * (-(x * x + z * z) / (2.0 * 7.0 * 7.0)).exp()
}

fn region() -> Region {
    Region { min: Vec3::new(-20.0, -3.0, -20.0), max: Vec3::new(20.0, 9.0, 20.0), cell: 0.5 }
}

fn steepest_up() -> f64 {
    std::env::var("STEEPEST").ok().and_then(|v| v.parse().ok()).unwrap_or(0.5)
}

fn options() -> SplitOptions {
    SplitOptions { steepest_up: steepest_up(), smallest_piece: FACE_SIDE * FACE_SIDE }
}

struct Laid {
    pieces: Vec<Result<LaidPiece, String>>,
    keys: Vec<String>,
}

fn lay_all(field: &SolidField<fn(f64, f64) -> f64>) -> Laid {
    let region = region();
    let split = split(field, &region, &options());
    let seams = seams(field, &split, FACE_SIDE, region.cell * 0.25);
    let pieces: Vec<_> = (0..split.pieces.len())
        .map(|index| lay_piece(field, &region, &split, &seams, index, FACE_SIDE, 7))
        .collect();
    if probe() {
        println!("-- {} pieces", split.pieces.len());
    }
    let keys = split
        .pieces
        .iter()
        .map(|p| format!("{:?} front {} behind {} area {:.1}", p.key.facing, p.key.in_front, p.key.behind, p.area))
        .collect();
    if probe() {
        for (index, (key, laid)) in split.pieces.iter().zip(&pieces).enumerate() {
            match laid {
                Ok(laid) => println!(
                    "piece {index}: {:?} front {} behind {} area {:.1} rings {} -> {} faces, {} vertices, {} by projection, {} added on border, seams kept {}, tangled {}",
                    key.key.facing, key.key.in_front, key.key.behind, key.area, seams.rings[index].len(), laid.faces.len(), laid.vertices.len(), laid.settled_by_projection, laid.added_on_border, laid.seams_kept, laid.tangled
                ),
                Err(error) => println!("piece {index}: FAILED {error}"),
            }
        }
    }
    Laid { pieces, keys }
}

/// Edges used by one face only that are not on the region's edge: cracks.
fn cracks(laid: &Laid) -> Vec<(Vec3, Vec3)> {
    let region = region();
    let mut uses: HashMap<(i64, i64), usize> = HashMap::new();
    let mut at: HashMap<i64, Vec3> = HashMap::new();
    for (index, piece) in laid.pieces.iter().enumerate() {
        let piece = piece.as_ref().unwrap();
        let id = |v: usize| match piece.border_point[v] {
            Some(p) => p as i64,
            None => -((index as i64) << 32 | v as i64) - 1,
        };
        for (v, &p) in piece.vertices.iter().enumerate() {
            at.insert(id(v), p);
        }
        for face in &piece.faces {
            for i in 0..face.len() {
                let (a, b) = (id(face[i]), id(face[(i + 1) % face.len()]));
                *uses.entry((a.min(b), a.max(b))).or_default() += 1;
            }
        }
    }
    let near_edge = |p: Vec3| {
        let margin = region.cell * 1.5;
        p.x < region.min.x + margin || p.x > region.max.x - margin || p.z < region.min.z + margin || p.z > region.max.z - margin
    };
    uses.iter()
        .filter(|&(_, &n)| n == 1)
        .map(|(&(a, b), _)| (at[&a], at[&b]))
        .filter(|&(a, b)| !(near_edge(a) && near_edge(b)))
        .collect()
}

/// Smallest corner angle over every face, in degrees, seen in 3D.
fn smallest_angle(laid: &LaidPiece) -> f64 {
    let mut smallest: f64 = 180.0;
    for face in &laid.faces {
        for i in 0..face.len() {
            let p = laid.vertices[face[i]];
            let a = laid.vertices[face[(i + face.len() - 1) % face.len()]] - p;
            let b = laid.vertices[face[(i + 1) % face.len()]] - p;
            let cos = a.dot(b) / (a.length() * b.length()).max(1e-12);
            smallest = smallest.min(cos.clamp(-1.0, 1.0).acos().to_degrees());
        }
    }
    smallest
}

fn assert_lays_watertight(field: &SolidField<fn(f64, f64) -> f64>, laid: &Laid) {
    let failed: Vec<_> = laid.pieces.iter().filter_map(|p| p.as_ref().err()).collect();
    assert!(failed.is_empty(), "every piece lays: {failed:#?}");
    for (index, piece) in laid.pieces.iter().enumerate() {
        let piece = piece.as_ref().unwrap();
        assert!(!piece.faces.is_empty(), "piece {index} ({}) has faces", laid.keys[index]);
        assert!(worst_distance(field, piece) < 0.1, "piece {index} ({}) sits on the surface: {}", laid.keys[index], worst_distance(field, piece));
        if probe() {
            println!("  piece {index} smallest angle {:.1}", smallest_angle(piece));
        }
    }
    let cracks = cracks(laid);
    assert!(cracks.is_empty(), "{} cracks between pieces, first {:?}", cracks.len(), cracks.first());
}

fn worst_distance(field: &SolidField<fn(f64, f64) -> f64>, laid: &LaidPiece) -> f64 {
    laid.vertices.iter().map(|&p| field.distance(p).abs()).fold(0.0, f64::max)
}

#[test]
fn a_hill_with_nothing_carved_is_one_piece_facing_up() {
    let field = SolidField::new(hill as fn(f64, f64) -> f64);
    let laid = lay_all(&field);
    assert_eq!(laid.pieces.len(), 1, "{:#?}", laid.keys);
    let piece = laid.pieces[0].as_ref().expect("the hill lays");
    assert!(laid.keys[0].starts_with("Up front 0 behind 0"), "{}", laid.keys[0]);
    assert!(worst_distance(&field, piece) < 0.05, "corners sit on the surface: {}", worst_distance(&field, piece));
    // Roughly the region's plan area in 2 m faces, give or take the hill.
    assert!((250..700).contains(&piece.faces.len()), "{} faces", piece.faces.len());
}

#[test]
fn a_tunnel_through_the_hill_lays_every_piece_on_shared_borders() {
    let mut field = SolidField::new(hill as fn(f64, f64) -> f64);
    field.blend = 0.6;
    field.shapes.push(Shape {
        effect: Effect::Carve,
        path: vec![Vec3::new(-16.0, 2.0, 0.0), Vec3::new(16.0, 2.0, 0.0)],
        radius: 1.8,
    });
    let laid = lay_all(&field);
    assert!(laid.pieces.len() > 1, "the tunnel splits the surface: {:#?}", laid.keys);
    assert_lays_watertight(&field, &laid);
}

fn carved(path: Vec<Vec3>, radius: f64) -> SolidField<fn(f64, f64) -> f64> {
    let mut field = SolidField::new(hill as fn(f64, f64) -> f64);
    field.blend = 0.6;
    field.shapes.push(Shape { effect: Effect::Carve, path, radius });
    field
}

#[test]
fn a_cave_closed_inside_the_hill_lays_watertight() {
    let field = carved(vec![Vec3::new(-2.0, 2.2, 0.0), Vec3::new(2.0, 2.2, 1.0)], 1.5);
    let laid = lay_all(&field);
    assert!(laid.pieces.len() > 1, "{:#?}", laid.keys);
    assert_lays_watertight(&field, &laid);
}

#[test]
fn a_tunnel_running_diagonally_into_the_hill_and_stopping_lays_watertight() {
    let field = carved(vec![Vec3::new(-15.0, 1.8, -15.0), Vec3::new(1.0, 2.0, 1.0)], 1.6);
    let laid = lay_all(&field);
    assert_lays_watertight(&field, &laid);
}

#[test]
fn a_bridge_of_earth_over_flat_ground_lays_watertight() {
    let mut field = SolidField::new((|_: f64, _: f64| 0.0) as fn(f64, f64) -> f64);
    field.blend = 0.6;
    field.shapes.push(Shape {
        effect: Effect::Fill,
        path: vec![Vec3::new(-10.0, -1.0, 0.0), Vec3::new(-6.0, 3.5, 0.0), Vec3::new(6.0, 3.5, 0.0), Vec3::new(10.0, -1.0, 0.0)],
        radius: 1.2,
    });
    let laid = lay_all(&field);
    assert_lays_watertight(&field, &laid);
}

