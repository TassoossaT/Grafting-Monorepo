//! Transient tessellation of analytic profile sheets.
use grafting_graph_core::profile_surface::ProfileSheet;

use crate::TriangulatedMesh;

/// Tessellates a sheet on an explicit, bounded rendering grid.
/// Neighboring sheets must use the same rise subdivision count to share seams.
/// Collapsed upper sections produce an apex without zero-area triangles.
pub fn triangulate_profile_sheet(
    sheet: &ProfileSheet,
    along: u32,
    rise: u32,
) -> Result<TriangulatedMesh, String> {
    if along == 0 || rise == 0 || along > 512 || rise > 512 {
        return Err("sheet subdivisions must be between 1 and 512".into());
    }
    let mut positions = Vec::new();
    let mut uvs = Vec::new();
    for j in 0..=rise {
        for i in 0..=along {
            let p = sheet.point(
                f64::from(i) / f64::from(along),
                f64::from(j) / f64::from(rise),
            )?;
            let position = p.map(|v| v as f32);
            if position.iter().any(|v| !v.is_finite()) {
                return Err("sheet exceeds rendering coordinate range".into());
            }
            positions.push(position);
            uvs.push([position[0], position[2]]);
        }
    }
    let mut indices = Vec::new();
    let mut normals = vec![[0.0f32; 3]; positions.len()];
    let mut triangle = |a: u32, b: u32, c: u32| {
        let p = positions[a as usize];
        let q = positions[b as usize];
        let r = positions[c as usize];
        let d = std::array::from_fn::<_, 3, _>(|i| f64::from(q[i]) - f64::from(p[i]));
        let e = std::array::from_fn::<_, 3, _>(|i| f64::from(r[i]) - f64::from(p[i]));
        let n = [
            d[1] * e[2] - d[2] * e[1],
            d[2] * e[0] - d[0] * e[2],
            d[0] * e[1] - d[1] * e[0],
        ];
        let length = n[0].hypot(n[1]).hypot(n[2]);
        if length == 0.0 {
            return;
        }
        let (order, sign) = if n[1] < 0.0 {
            ([a, c, b], -1.0)
        } else {
            ([a, b, c], 1.0)
        };
        indices.extend(order);
        for index in order {
            for k in 0..3 {
                normals[index as usize][k] += (sign * n[k] / length) as f32;
            }
        }
    };
    for j in 0..rise {
        for i in 0..along {
            let a = j * (along + 1) + i;
            let b = a + 1;
            let c = a + along + 1;
            let d = c + 1;
            triangle(a, b, c);
            triangle(b, d, c);
        }
    }
    if indices.is_empty() {
        return Err("sheet has no renderable area".into());
    }
    for normal in &mut normals {
        let length = normal[0].hypot(normal[1]).hypot(normal[2]);
        if length > 0.0 {
            for v in normal {
                *v /= length;
            }
        } else {
            *normal = [0.0, 1.0, 0.0];
        }
    }
    Ok(TriangulatedMesh {
        positions,
        normals,
        uvs,
        indices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::profile_cap::{CapBase, four_sheet_cap};

    #[test]
    fn tessellation_keeps_four_logical_leaves_and_non_degenerate_triangles() {
        let sheets = four_sheet_cap(
            CapBase::Circle {
                center: [0.0; 2],
                radius: 3.0,
            },
            2.0,
            4.0,
            [-1.0, 0.2, 1.0, -0.4],
        )
        .unwrap();
        for sheet in sheets {
            let mesh = triangulate_profile_sheet(&sheet, 16, 12).unwrap();
            assert_eq!(mesh.positions.len(), 17 * 13);
            assert_eq!(mesh.indices.len(), (16 * 12 * 2 - 16) * 3);
            for t in mesh.indices.chunks_exact(3) {
                let a = mesh.positions[t[0] as usize];
                let b = mesh.positions[t[1] as usize];
                let c = mesh.positions[t[2] as usize];
                let area_y = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
                assert!(area_y > 0.0);
            }
            assert!(mesh.positions.iter().all(|p| (2.0..=6.0).contains(&p[1])));
            assert!(mesh.normals.iter().flatten().all(|v| v.is_finite()));
        }
    }

    #[test]
    fn adjacent_meshes_have_identical_seam_samples() {
        let sheets = four_sheet_cap(
            CapBase::Rectangle {
                min: [0.0; 2],
                max: [8.0, 4.0],
            },
            1.0,
            3.0,
            [-1.0, 1.0, -0.5, 0.0],
        )
        .unwrap();
        let meshes: Vec<_> = sheets
            .iter()
            .map(|s| triangulate_profile_sheet(s, 8, 12).unwrap())
            .collect();
        for i in 0..4 {
            for j in 0..=12 {
                assert_eq!(
                    meshes[i].positions[j * 9 + 8],
                    meshes[(i + 1) % 4].positions[j * 9]
                );
            }
        }
        assert!(triangulate_profile_sheet(&sheets[0], 0, 1).is_err());
        assert!(triangulate_profile_sheet(&sheets[0], 1, 513).is_err());
    }
}
