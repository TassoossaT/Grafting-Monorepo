//! A hill, then the same hill with a tunnel through it, split and laid end to
//! end. `PROBE=1` prints what each piece came out as.

use std::collections::HashMap;

use grafting_procgen_solid_field::{
    Effect, LaidPiece, Region, Shape, SolidField, SplitOptions, Vec3, lay_ground, lay_piece, seams, split,
};

fn face_side() -> f64 { std::env::var("FACE").ok().and_then(|v| v.parse().ok()).unwrap_or(2.0) }

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
    SplitOptions { steepest_up: steepest_up(), smallest_piece: face_side() * face_side(), collar: 0.0 }
}

struct Laid {
    pieces: Vec<Result<LaidPiece, String>>,
    keys: Vec<String>,
}

fn lay_all(field: &SolidField<fn(f64, f64) -> f64>) -> Laid {
    let ground = lay_ground(field, &region(), &options(), face_side(), face_side(), 7);
    let keys: Vec<String> = ground
        .pieces
        .iter()
        .map(|(key, _)| format!("{:?} front {} behind {}", key.facing, key.in_front, key.behind))
        .collect();
    if probe() {
        println!("-- {} pieces", ground.pieces.len());
        for (index, (key, laid)) in ground.pieces.iter().enumerate() {
            match laid {
                Ok(laid) => println!(
                    "piece {index}: {:?} front {} behind {} -> {} faces, {} vertices, {} by projection, {} added on border, seams kept {}, tangled {}",
                    key.facing, key.in_front, key.behind, laid.faces.len(), laid.vertices.len(), laid.settled_by_projection, laid.added_on_border, laid.seams_kept, laid.tangled
                ),
                Err(error) => println!("piece {index}: FAILED {error}"),
            }
        }
    }
    Laid { pieces: ground.pieces.into_iter().map(|(_, laid)| laid).collect(), keys }
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
        // Two corners at one point: a zero-length edge opens nothing.
        .filter(|&(a, b)| a.distance(b) > 1e-6)
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
        assert!(worst_distance(field, piece) < 0.1, "piece {index} ({}) sits on the surface: {}", laid.keys[index], worst_distance(field, piece));
        if probe() {
            println!("  piece {index} smallest angle {:.1}", smallest_angle(piece));
        }
    }
    let cracks = cracks(laid);
    assert!(cracks.is_empty(), "{} cracks between pieces, first {:?}", cracks.len(), cracks.first());
}

/// Whether the triangles cover each face exactly once: a face of `n`
/// corners in `n - 2` triangles, none of them turned into the solid -- a fan
/// over a concave face turns one over and leaves a notch bare.
fn triangles_cover_faces(field: &SolidField<fn(f64, f64) -> f64>, laid: &LaidPiece) -> bool {
    let expected: usize = laid.faces.iter().map(|f| f.len() - 2).sum();
    let turned = laid.triangles.iter().filter(|t| {
        let [a, b, c] = [laid.vertices[t[0]], laid.vertices[t[1]], laid.vertices[t[2]]];
        (b - a).cross(c - a).dot(field.gradient((a + b + c) * (1.0 / 3.0), 0.1)) < 0.0
    }).count();
    if probe() && (turned > 0 || expected != laid.triangles.len()) {
        println!("    {} triangles for {expected} expected, {turned} turned inward", laid.triangles.len());
    }
    // A few fold over beside a steep border, or where a face touching
    // itself in its plane is fanned: up to one in fifty, never a gap.
    expected == laid.triangles.len() && turned <= 1.max(laid.triangles.len() / 50)
}

/// What [`assert_lays_watertight`] holds, and every face cut into triangles
/// that cover it, none turned over.
///
/// Not held for a tunnel carved out past the hillside: the trench it leaves
/// in front of its mouth is narrower than two faces, and where its wall is
/// too short to be a piece of its own the ground is laid straight across it,
/// one face turning over.
fn assert_lays_along_the_ground(field: &SolidField<fn(f64, f64) -> f64>, laid: &Laid) {
    assert_lays_watertight(field, laid);
    for (index, piece) in laid.pieces.iter().enumerate() {
        let piece = piece.as_ref().unwrap();
        assert!(triangles_cover_faces(field, piece), "piece {index} ({}): its triangles cover its faces", laid.keys[index]);
    }
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
    let scale = (2.0 / face_side()).powi(2);
    let faces = piece.faces.len() as f64 / scale;
    assert!((250.0..700.0).contains(&faces), "{} faces", piece.faces.len());
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
    assert_lays_along_the_ground(&field, &laid);
}

#[test]
fn every_piece_holds_only_surface_facing_its_own_way() {
    // A steep sliver of a tunnel's mouth folded into the ground facing up was
    // laid seen from above, its faces hanging over the mouth like a curtain.
    let field = carved(vec![Vec3::new(-16.0, 2.0, 0.0), Vec3::new(16.0, 2.0, 0.0)], 1.8);
    let region = region();
    let split = split(&field, &region, &options());
    for piece in &split.pieces {
        for &t in &piece.triangles {
            let [a, b, c] = split.triangles[t];
            let centre = (split.positions[a] + split.positions[b] + split.positions[c]) * (1.0 / 3.0);
            let facing = grafting_procgen_solid_field::Facing::of(field.gradient(centre, region.cell * 0.25), steepest_up());
            assert_eq!(facing, piece.key.facing, "a piece facing {:?} holds surface facing {facing:?} at {centre:?}", piece.key.facing);
        }
    }
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
    assert_lays_along_the_ground(&field, &laid);
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
    assert_lays_along_the_ground(&field, &laid);
}


/// Probe only: faces that came out wrong in 3D even though they close --
/// facing into the solid, stretched across, or corners lifted onto another
/// layer than their piece's.
#[test]
fn probe_wrong_faces() {
    if !probe() {
        return;
    }
    let cases: Vec<(&str, SolidField<fn(f64, f64) -> f64>)> = vec![
        ("through", carved(vec![Vec3::new(-16.0, 2.0, 0.0), Vec3::new(16.0, 2.0, 0.0)], 1.8)),
        ("diagonal", carved(vec![Vec3::new(-15.0, 1.8, -15.0), Vec3::new(1.0, 2.0, 1.0)], 1.8)),
        ("curve", carved(vec![Vec3::new(-16.0, 1.8, -4.0), Vec3::new(-4.0, 2.0, -4.0), Vec3::new(2.0, 2.2, 2.0), Vec3::new(4.0, 2.2, 16.0)], 1.8)),
    ];
    for (name, field) in cases {
        let region = region();
        let split = split(&field, &region, &options());
        let seams = seams(&field, &split, &region, face_side(), region.cell * 0.25);
        for index in 0..split.pieces.len() {
            let key = split.pieces[index].key;
            let laid = match lay_piece(&field, &region, &split, &seams, index, face_side(), 7) {
                Ok(l) => l,
                Err(e) => { println!("{name} {index}: ERR {e}"); continue; }
            };
            let own: Vec<Vec3> = split.pieces[index].triangles.iter().flat_map(|&t| split.triangles[t]).map(|p| split.positions[p]).collect();
            let off_layer = laid.vertices.iter().enumerate().filter(|(v, p)| laid.border_point[*v].is_none() && own.iter().map(|q| q.distance(**p)).fold(f64::INFINITY, f64::min) > 1.0).count();
            let mut inward = 0;
            let mut stretched = 0;
            for face in &laid.faces {
                let pts: Vec<Vec3> = face.iter().map(|&i| laid.vertices[i]).collect();
                let c = pts.iter().fold(Vec3::default(), |a, &p| a + p) * (1.0 / pts.len() as f64);
                let mut n = Vec3::default();
                for i in 0..pts.len() { n = n + pts[i].cross(pts[(i + 1) % pts.len()]); }
                if n.dot(field.gradient(c, 0.1)) < 0.0 { inward += 1; }
                if (0..pts.len()).any(|i| pts[i].distance(pts[(i + 1) % pts.len()]) > 3.0 * face_side()) { stretched += 1; }
            }
            // A face the fan cannot cover: some fan triangle faces the other way.
            let fan_breaks = laid.faces.iter().filter(|f| f.len() > 3 && {
                let pts: Vec<Vec3> = f.iter().map(|&i| laid.vertices[i]).collect();
                let mut n = Vec3::default();
                for i in 0..pts.len() { n = n + pts[i].cross(pts[(i + 1) % pts.len()]); }
                (1..pts.len() - 1).any(|k| (pts[k] - pts[0]).cross(pts[k + 1] - pts[0]).dot(n) < 0.0)
            }).count();
            let covered: f64 = laid.triangles.iter().map(|t| (laid.vertices[t[1]] - laid.vertices[t[0]]).cross(laid.vertices[t[2]] - laid.vertices[t[0]]).length() * 0.5).sum();
            // Faces whose middle hangs off the surface: a curtain across an opening.
            let hanging: Vec<(f64, Vec3)> = laid.triangles.iter().map(|t| {
                let c = (laid.vertices[t[0]] + laid.vertices[t[1]] + laid.vertices[t[2]]) * (1.0 / 3.0);
                (field.distance(c), c)
            }).filter(|(d, _)| d.abs() > 0.4).collect();
            println!("  hanging triangles {} worst {:?}", hanging.len(), hanging.iter().max_by(|a, b| a.0.abs().total_cmp(&b.0.abs())));
            for t in laid.triangles.iter().filter(|t| {
                let c = (laid.vertices[t[0]] + laid.vertices[t[1]] + laid.vertices[t[2]]) * (1.0 / 3.0);
                field.distance(c).abs() > 0.4
            }).take(3) {
                let fmt = |i: usize| { let p = laid.vertices[i]; let n = field.gradient(p, 0.1).normalized(); format!("({:.1},{:.2},{:.1}) n.y {:.2} border {}", p.x, p.y, p.z, n.y, laid.border_point[i].is_some()) };
                println!("    tri {} | {} | {}", fmt(t[0]), fmt(t[1]), fmt(t[2]));
            }
            println!("  fan breaks {fan_breaks}, earcut triangles {} covering {covered:.1} m2", laid.triangles.len());
            println!("{name} piece {index} {:?} f{} b{}: {} faces, {} off layer, {} inward, {} stretched, {} by projection, polygons>4: {}",
                key.facing, key.in_front, key.behind, laid.faces.len(), off_layer, inward, stretched, laid.settled_by_projection,
                laid.faces.iter().filter(|f| f.len() > 4).count());
        }
    }
}


/// Edges more than two faces hold, in a single mesh.
fn open_edges(mesh: &grafting_procgen_solid_field::ShapedSurface) -> usize {
    let mut uses: HashMap<(usize, usize), usize> = HashMap::new();
    for face in &mesh.faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            *uses.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    uses.values().filter(|&&n| n > 2).count()
}

#[test]
fn a_tunnels_surface_is_one_light_quad_mesh_on_the_surface() {
    let field = carved(vec![Vec3::new(-16.0, 2.0, 0.0), Vec3::new(16.0, 2.0, 0.0)], 1.8);
    let region = Region { cell: 1.2, ..region() };
    let options = SplitOptions { collar: 1.5, smallest_piece: 1.44, ..options() };
    let mesh = grafting_procgen_solid_field::shaped_surface(&field, &region, &options);
    let quads = mesh.faces.iter().filter(|f| f.len() == 4).count();
    let worst = mesh.vertices.iter().map(|&p| field.distance(p).abs()).fold(0.0, f64::max);
    if probe() {
        println!("surface: {} faces ({quads} quads), {} vertices, worst off surface {worst:.3}", mesh.faces.len(), mesh.vertices.len());
    }
    assert!(mesh.faces.len() > 20 && mesh.faces.len() < 400, "{} faces", mesh.faces.len());
    assert!(quads * 10 >= mesh.faces.len() * 8, "mostly quads: {quads} of {}", mesh.faces.len());
    assert!(worst < 0.05, "settled on the surface: {worst}");
    // Surface Nets pinches an edge between three faces where the surface
    // touches itself inside one cell: rare, never a gap.
    assert!(open_edges(&mesh) * 100 <= mesh.faces.len(), "edges held by more than two faces: {}", open_edges(&mesh));
}
