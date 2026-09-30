//! Plan (2D) line geometry every module that meets one segment with another
//! shares: where two lines cross, as the parameter along each. Each caller
//! keeps its own rule for which parameters count -- ends included or not,
//! how much slack -- since that is what differs between them, not the maths.

/// Where the lines through `a`-`b` and `c`-`d` cross, as the parameter along
/// each (0 at the first point, 1 at the second); `None` when they run
/// parallel, their cross product under `parallel`.
pub(crate) fn line_parameters(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2], parallel: f64) -> Option<(f64, f64)> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let det = r[0] * s[1] - r[1] * s[0];
    if det.abs() < parallel {
        return None;
    }
    let w = [c[0] - a[0], c[1] - a[1]];
    Some(((w[0] * s[1] - w[1] * s[0]) / det, (w[0] * r[1] - w[1] * r[0]) / det))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossing_lines_meet_at_each_ones_parameter_and_parallel_ones_do_not() {
        let (t, u) = line_parameters([0., 0.], [2., 2.], [0., 2.], [2., 0.], 1e-12).unwrap();
        assert!((t - 0.5).abs() < 1e-12 && (u - 0.5).abs() < 1e-12);
        let (t, _) = line_parameters([0., 0.], [1., 0.], [3., -1.], [3., 1.], 1e-12).unwrap();
        assert!((t - 3.).abs() < 1e-12, "lines, not segments: {t}");
        assert!(line_parameters([0., 0.], [1., 1.], [0., 1.], [1., 2.], 1e-12).is_none());
    }
}
