/**
 * Dense linear least squares by Householder QR, unconstrained and with exact
 * equality constraints.
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

/**
 * Solve min‖Ax − b‖₂ **subject to Cx = d**, by the null-space method.
 *
 * The equality-constrained least-squares problem — LSE in the LAPACK naming
 * (`dgglse`), Golub & Van Loan § 12.1.4 — and the difference between it and
 * stacking C onto A with a large weight is the whole reason it exists: a
 * weighted constraint is satisfied to O(1/w²) — the weight enters the merit
 * squared — and this one is satisfied to the conditioning of C. § 1.8.6
 * measures both, and measures what that difference is and is not worth.
 *
 *     Cᵀ = Q·[R; 0]     x = Q·y,  y = [y₁; y₂],  y₁ ∈ ℝᵖ
 *     Cx = Rᵀ·y₁ = d                    ← p unknowns, triangular, exact
 *     min‖A·Q·y − b‖ over y₂ only       ← the constraint has already used up y₁
 *
 * So the constraint is met by a triangular solve rather than by a compromise,
 * and the objective is minimised over the (n−p)-dimensional space the
 * constraint leaves free — which is an *orthonormal* basis of it, so nothing
 * about the answer depends on which basis the QR happened to produce.
 *
 * `a` and `b` are DESTROYED, as above; `c` and `d` are read only. `c` is
 * row-major `crows × cols`.
 *
 * **Returns `null` when C is rank-deficient** — two conditions that are the
 * same condition, or one no variable can move. That is not a compromise this
 * routine is entitled to make on the caller's behalf: an unconstrained solve
 * answers a rank-deficient column with a zero (no information, no move), but
 * dropping a *constraint* silently would answer a different question than the
 * one asked. The rank test is on R's diagonal, relative to its largest entry.
 *
 * Rows of A below the constraint count are not required: with p = n the answer
 * is the unique point satisfying the constraints and A is never consulted.
 */
export function equalityConstrainedLeastSquares(
  a: Float64Array,
  rows: number,
  cols: number,
  b: Float64Array,
  c: Float64Array,
  crows: number,
  d: Float64Array,
): Float64Array | null {
  const n = cols;
  const p = crows;
  if (p === 0) return householderLeastSquares(a, rows, cols, b);
  if (p > n) return null;

  // ---- Householder QR of Cᵀ (n×p). The reflectors are kept, because both the
  // objective block and the answer have to be carried through the same Q.
  const ct = new Float64Array(n * p);
  for (let k = 0; k < p; k++) {
    for (let i = 0; i < n; i++) ct[i * p + k] = c[k * n + i]!;
  }
  const vs = new Float64Array(p * n);
  const vv = new Float64Array(p);
  for (let k = 0; k < p; k++) {
    let norm2 = 0;
    for (let i = k; i < n; i++) norm2 += ct[i * p + k]! ** 2;
    if (norm2 === 0) return null;
    const akk = ct[k * p + k]!;
    const alpha = akk >= 0 ? -Math.sqrt(norm2) : Math.sqrt(norm2);
    vs[k * n + k] = akk - alpha;
    for (let i = k + 1; i < n; i++) vs[k * n + i] = ct[i * p + k]!;
    let s2 = 0;
    for (let i = k; i < n; i++) s2 += vs[k * n + i]! ** 2;
    vv[k] = s2;
    if (s2 === 0) continue;
    for (let j = k; j < p; j++) {
      let s = 0;
      for (let i = k; i < n; i++) s += vs[k * n + i]! * ct[i * p + j]!;
      s = (2 * s) / s2;
      for (let i = k; i < n; i++) ct[i * p + j] = ct[i * p + j]! - s * vs[k * n + i]!;
    }
  }

  let maxPivot = 0;
  for (let k = 0; k < p; k++) maxPivot = Math.max(maxPivot, Math.abs(ct[k * p + k]!));
  if (maxPivot === 0) return null;
  for (let k = 0; k < p; k++) {
    if (Math.abs(ct[k * p + k]!) <= 1e-12 * maxPivot) return null;
  }

  // ---- The constrained half: Rᵀ·y₁ = d, forward substitution.
  const y = new Float64Array(n);
  for (let k = 0; k < p; k++) {
    let s = d[k]!;
    for (let i = 0; i < k; i++) s -= ct[i * p + k]! * y[i]!;
    y[k] = s / ct[k * p + k]!;
  }

  // ---- A ← A·Q, so the objective is expressed in y rather than x.
  for (let k = 0; k < p; k++) {
    if (vv[k] === 0) continue;
    for (let i = 0; i < rows; i++) {
      let s = 0;
      for (let j = k; j < n; j++) s += a[i * n + j]! * vs[k * n + j]!;
      s = (2 * s) / vv[k]!;
      for (let j = k; j < n; j++) a[i * n + j] = a[i * n + j]! - s * vs[k * n + j]!;
    }
  }

  // ---- The free half: what the constraint has not already spent.
  const free = n - p;
  if (free > 0) {
    const rhs = new Float64Array(rows);
    for (let i = 0; i < rows; i++) {
      let s = b[i]!;
      for (let k = 0; k < p; k++) s -= a[i * n + k]! * y[k]!;
      rhs[i] = s;
    }
    const a2 = new Float64Array(rows * free);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < free; j++) a2[i * free + j] = a[i * n + p + j]!;
    }
    const y2 = householderLeastSquares(a2, rows, free, rhs);
    for (let j = 0; j < free; j++) y[p + j] = y2[j]!;
  }

  // ---- x = Q·y, the reflectors applied in the other order.
  for (let k = p - 1; k >= 0; k--) {
    if (vv[k] === 0) continue;
    let s = 0;
    for (let i = k; i < n; i++) s += vs[k * n + i]! * y[i]!;
    s = (2 * s) / vv[k]!;
    for (let i = k; i < n; i++) y[i] = y[i]! - s * vs[k * n + i]!;
  }
  return y;
}
