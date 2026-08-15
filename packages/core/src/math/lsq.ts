/**
 * Dense linear least squares by Householder QR.
 *
 * Lifted out of `wave/zernike` when a second caller arrived: the damped
 * least-squares optimiser (`analysis/optimize`) solves its step as an augmented
 * least-squares problem — J stacked on a damping block — rather than by forming
 * the normal equations, and that is the same solve a Zernike fit needs. The two
 * callers want the same numerics for the same reason, which is the only reason
 * this is shared code rather than two loops.
 *
 * QR rather than the normal equations: forming AᵀA squares the condition
 * number, and both callers hand this a matrix whose conditioning is the thing
 * they are worried about (a 36-term Zernike design matrix; a Jacobian whose
 * columns are parameters in unrelated units). QR costs a constant factor more
 * on problems this size — hundreds of rows, tens of columns — and keeps the
 * answer honest where the normal equations would not.
 */

/**
 * Solve min‖Ax − b‖₂, in place.
 *
 * `a` is row-major, `rows × cols`, and both `a` and `b` are DESTROYED — the
 * factorisation overwrites them. Callers that need their matrix afterwards copy
 * it first.
 *
 * A rank-deficient column yields x = 0 in that component rather than an
 * infinity. For a Zernike fit that is a mode the samples never excited (a pure
 * fan cannot see sagittal terms); for an optimiser step it is a variable the
 * merit does not depend on. Both want "no information, so no move" and neither
 * wants a NaN that poisons everything downstream.
 */
export function householderLeastSquares(
  a: Float64Array,
  rows: number,
  cols: number,
  b: Float64Array,
): Float64Array {
  const v = new Float64Array(rows);

  for (let k = 0; k < cols; k++) {
    let norm2 = 0;
    for (let i = k; i < rows; i++) norm2 += a[i * cols + k]! ** 2;
    if (norm2 === 0) continue;
    const akk = a[k * cols + k]!;
    // Sign chosen away from akk so the subtraction never cancels.
    const alpha = akk >= 0 ? -Math.sqrt(norm2) : Math.sqrt(norm2);
    v[k] = akk - alpha;
    for (let i = k + 1; i < rows; i++) v[i] = a[i * cols + k]!;
    let vv = 0;
    for (let i = k; i < rows; i++) vv += v[i]! ** 2;
    if (vv === 0) continue;

    for (let j = k; j < cols; j++) {
      let s = 0;
      for (let i = k; i < rows; i++) s += v[i]! * a[i * cols + j]!;
      s = (2 * s) / vv;
      for (let i = k; i < rows; i++) a[i * cols + j] = a[i * cols + j]! - s * v[i]!;
    }
    let s = 0;
    for (let i = k; i < rows; i++) s += v[i]! * b[i]!;
    s = (2 * s) / vv;
    for (let i = k; i < rows; i++) b[i] = b[i]! - s * v[i]!;
  }

  const x = new Float64Array(cols);
  for (let i = cols - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < cols; j++) s -= a[i * cols + j]! * x[j]!;
    const d = a[i * cols + i]!;
    x[i] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}
