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

/** A matrix's singular values, and the directions the smallest ones belong to. */
export interface SingularSystem {
  /** σ₁ ≥ σ₂ ≥ … ≥ σ_cols ≥ 0. */
  readonly values: Float64Array;
  /**
   * The right singular vectors, row-major `cols × cols`: entry `i*cols + j` is
   * component i of the vector belonging to `values[j]`. Orthonormal.
   */
  readonly right: Float64Array;
}

/**
 * Singular values of a dense `rows × cols` matrix by one-sided Jacobi, with the
 * right singular vectors. `a` is row-major and is DESTROYED — it comes back
 * holding U·Σ.
 *
 * One-sided Jacobi rather than the usual bidiagonalise-and-QR: it computes
 * every singular value to high *relative* accuracy, including the small ones,
 * and the small ones are the entire question its caller asks — a design
 * problem's smallest singular value is the combination of variables that moves
 * nothing, and a σ that is 10⁻¹⁴ rather than 0 is a different statement from
 * one that is 10⁻¹ rather than 0. It orthogonalises pairs of COLUMNS by plane
 * rotations until they are orthogonal, at which point their lengths are the
 * singular values and the accumulated rotations are V. Demmel & Veselić (1992)
 * is the accuracy argument; on the sizes here — a handful of columns — the cost
 * argument that usually favours the alternative does not apply.
 *
 * A zero column is left alone rather than rotated: it is already orthogonal to
 * everything, and its σ is exactly 0.
 */
export function singularSystem(a: Float64Array, rows: number, cols: number): SingularSystem {
  const right = new Float64Array(cols * cols);
  for (let i = 0; i < cols; i++) right[i * cols + i] = 1;

  // 30 sweeps is a backstop, not a schedule: one-sided Jacobi converges
  // quadratically and a matrix this size is done in single figures.
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < cols - 1; p++) {
      for (let q = p + 1; q < cols; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < rows; i++) {
          const ap = a[i * cols + p]!;
          const aq = a[i * cols + q]!;
          alpha += ap * ap;
          beta += aq * aq;
          gamma += ap * aq;
        }
        if (gamma === 0 || alpha === 0 || beta === 0) continue;
        // The relative test: rotate while the columns' overlap is above the
        // rounding of their own lengths, which is what "to high relative
        // accuracy" costs and buys.
        if (Math.abs(gamma) <= Number.EPSILON * Math.sqrt(alpha * beta)) continue;
        off++;
        const zeta = (beta - alpha) / (2 * gamma);
        const t =
          (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < rows; i++) {
          const ap = a[i * cols + p]!;
          const aq = a[i * cols + q]!;
          a[i * cols + p] = c * ap - s * aq;
          a[i * cols + q] = s * ap + c * aq;
        }
        for (let i = 0; i < cols; i++) {
          const vp = right[i * cols + p]!;
          const vq = right[i * cols + q]!;
          right[i * cols + p] = c * vp - s * vq;
          right[i * cols + q] = s * vp + c * vq;
        }
      }
    }
    if (off === 0) break;
  }

  const values = new Float64Array(cols);
  for (let j = 0; j < cols; j++) {
    let s = 0;
    for (let i = 0; i < rows; i++) s += a[i * cols + j]! * a[i * cols + j]!;
    values[j] = Math.sqrt(s);
  }

  // Descending, columns of V carried along with them.
  const order = Array.from({ length: cols }, (_, j) => j).sort((x, y) => values[y]! - values[x]!);
  const sortedValues = new Float64Array(cols);
  const sortedRight = new Float64Array(cols * cols);
  for (let j = 0; j < cols; j++) {
    const from = order[j]!;
    sortedValues[j] = values[from]!;
    for (let i = 0; i < cols; i++) sortedRight[i * cols + j] = right[i * cols + from]!;
  }
  return { values: sortedValues, right: sortedRight };
}
/**
 * A complex matrix's singular values, with both sets of singular vectors.
 *
 * **Indexing is COLUMN-major throughout, which is not the convention
 * `SingularSystem` above uses** — deliberately, and the reason is in
 * `complexSingularSystem`'s note on layout. Component i of the vector belonging
 * to `values[j]` is at `j*rows + i` (left) or `j*cols + i` (right).
 */
export interface ComplexSingularSystem {
  /** σ₁ ≥ σ₂ ≥ … ≥ σ_cols ≥ 0. */
  readonly values: Float64Array;
  /**
   * The left singular vectors, `rows × cols` column-major — **these are the
   * caller's own input arrays**, normalized in place, not copies.
   *
   * There are `cols` of them and they span a `cols`-dimensional subspace of the
   * `rows`-dimensional space, so they satisfy Uᴴ·U = I_cols and **not** U·Uᴴ =
   * I_rows. That is not a shortfall: for the Gram matrix A·Aᴴ these diagonalize,
   * the rank is at most `cols`, so there is no more of the space to reach.
   */
  readonly leftRe: Float64Array;
  readonly leftIm: Float64Array;
  /** The right singular vectors, `cols × cols` column-major. Unitary. */
  readonly rightRe: Float64Array;
  readonly rightIm: Float64Array;
  /** Sweeps actually taken — 30 means it hit the backstop without converging. */
  readonly sweeps: number;
}

/**
 * Permute columns of a column-major complex matrix in place: new column j takes
 * old column `order[j]`.
 *
 * In place, and following cycles rather than copying to a second buffer,
 * because the matrix this is written for is the condenser factor and the whole
 * point of the factor is that `rows × cols` is the largest thing allocated.
 */
function permuteColumns(
  re: Float64Array,
  im: Float64Array,
  rows: number,
  cols: number,
  order: Int32Array,
): void {
  const done = new Uint8Array(cols);
  const holdRe = new Float64Array(rows);
  const holdIm = new Float64Array(rows);
  for (let start = 0; start < cols; start++) {
    if (done[start] === 1 || order[start] === start) {
      done[start] = 1;
      continue;
    }
    // Each slot in the cycle is READ (as the source for the previous slot)
    // exactly before it is written, so only the cycle's first column needs
    // holding aside.
    const s0 = start * rows;
    for (let i = 0; i < rows; i++) {
      holdRe[i] = re[s0 + i]!;
      holdIm[i] = im[s0 + i]!;
    }
    let j = start;
    for (;;) {
      done[j] = 1;
      const src = order[j]!;
      const dst = j * rows;
      if (src === start) {
        for (let i = 0; i < rows; i++) {
          re[dst + i] = holdRe[i]!;
          im[dst + i] = holdIm[i]!;
        }
        break;
      }
      const from = src * rows;
      for (let i = 0; i < rows; i++) {
        re[dst + i] = re[from + i]!;
        im[dst + i] = im[from + i]!;
      }
      j = src;
    }
  }
}

/**
 * Singular values of a dense COMPLEX `rows × cols` matrix by one-sided Jacobi,
 * with both sets of singular vectors. `re` and `im` are **column-major** and are
 * DESTROYED — they come back holding U, normalized in place.
 *
 * The complex sibling of `singularSystem`, and it exists for one caller and one
 * reason. Hopkins' kernel (`illumination/hopkins`) is built as Σ_s w_s·a_s·a_sᴴ
 * over the condenser — that is A·Aᴴ with A's column s the shifted pupil scaled
 * by √w_s — so the kernel's eigenvectors are **this** A's left singular vectors
 * and its eigenvalues are σ². The decomposition never needs a Hermitian
 * eigensolver and never needs the kernel itself: A is `rows × cols` where the
 * kernel is `rows × rows`, and `cols` is the number of illumination directions,
 * which does not grow when the pupil is sampled more finely.
 *
 * One-sided Jacobi, for the reason the real version gives and more sharply
 * here: it computes every σ to high *relative* accuracy including the small
 * ones, and the small ones are the entire question its caller asks — which
 * coherent systems can be dropped, and what dropping them costs. A method that
 * returns the small σ as roundoff-of-the-large cannot answer that at all.
 *
 * **Layout is column-major, unlike `singularSystem`.** The algorithm's inner
 * loops walk two whole columns at a time; row-major would stride them by `cols`
 * across every row, which is the strided gather § 8c measured at 5× on a hot
 * kernel. The one caller builds its factor in this layout to suit.
 *
 * The complex step, and the only real addition over the real version: a real
 * plane rotation can annihilate only the real part of the overlap γ = a_pᴴ·a_q.
 * So column q is first phase-rotated by e^(−i·arg γ), which makes the overlap
 * real and positive without changing either column's length, and the real
 * rotation then applies unchanged. Both operations are unitary and both are
 * accumulated into V.
 *
 * A zero column is left alone: it is already orthogonal to everything and its σ
 * is exactly 0, as is its left vector — there is no direction to report.
 *
 * With `rows` < `cols` the surplus σ are 0 by rank rather than by rounding, and
 * Jacobi leaves them at the square root of nothing rather than at 0; a caller
 * that cares must zero them itself, exactly as `analysis/optimize` does for the
 * real version. The caller this was written for has `rows` > `cols`.
 */
export function complexSingularSystem(
  re: Float64Array,
  im: Float64Array,
  rows: number,
  cols: number,
): ComplexSingularSystem {
  if (!(rows > 0) || !(cols > 0) || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new Error(`complexSingularSystem: rows and cols must be positive integers, got ${rows}×${cols}`);
  }
  if (re.length < rows * cols || im.length < rows * cols) {
    throw new Error(
      `complexSingularSystem: a ${rows}×${cols} matrix needs ${rows * cols} elements per part, ` +
        `got ${re.length} and ${im.length}`,
    );
  }

  const rightRe = new Float64Array(cols * cols);
  const rightIm = new Float64Array(cols * cols);
  for (let j = 0; j < cols; j++) rightRe[j * cols + j] = 1;

  // 30 sweeps is a backstop, not a schedule — the same one the real version
  // carries, for the same reason. `sweeps` is reported so that a caller can see
  // it was never reached.
  let sweeps = 0;
  for (let sweep = 0; sweep < 30; sweep++) {
    sweeps = sweep + 1;
    let off = 0;
    for (let p = 0; p < cols - 1; p++) {
      const pOff = p * rows;
      for (let q = p + 1; q < cols; q++) {
        const qOff = q * rows;
        let alpha = 0;
        let beta = 0;
        let gr = 0;
        let gi = 0;
        for (let i = 0; i < rows; i++) {
          const pr = re[pOff + i]!;
          const pi = im[pOff + i]!;
          const qr = re[qOff + i]!;
          const qi = im[qOff + i]!;
          alpha += pr * pr + pi * pi;
          beta += qr * qr + qi * qi;
          // γ = a_pᴴ·a_q = Σ conj(a_p)·a_q.
          gr += pr * qr + pi * qi;
          gi += pr * qi - pi * qr;
        }
        if (alpha === 0 || beta === 0) continue;
        const gmag = Math.hypot(gr, gi);
        if (gmag === 0) continue;
        // The relative test, as in the real version: rotate while the columns'
        // overlap is above the rounding of their own lengths. This is what "to
        // high relative accuracy" costs and buys.
        if (gmag <= Number.EPSILON * Math.sqrt(alpha * beta)) continue;
        off++;

        // ---- Phase, so the overlap becomes real and positive: a_q ← a_q·e^(−iθ),
        // where γ = |γ|·(cph + i·sph). Lengths are untouched, so alpha and beta
        // computed above stay valid for the rotation below.
        const cph = gr / gmag;
        const sph = gi / gmag;
        for (let i = 0; i < rows; i++) {
          const qr = re[qOff + i]!;
          const qi = im[qOff + i]!;
          re[qOff + i] = qr * cph + qi * sph;
          im[qOff + i] = qi * cph - qr * sph;
        }
        const vqOff = q * cols;
        for (let i = 0; i < cols; i++) {
          const vr = rightRe[vqOff + i]!;
          const vi = rightIm[vqOff + i]!;
          rightRe[vqOff + i] = vr * cph + vi * sph;
          rightIm[vqOff + i] = vi * cph - vr * sph;
        }

        // ---- The real rotation, now annihilating an overlap of |γ|.
        const zeta = (beta - alpha) / (2 * gmag);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < rows; i++) {
          const pr = re[pOff + i]!;
          const pi = im[pOff + i]!;
          const qr = re[qOff + i]!;
          const qi = im[qOff + i]!;
          re[pOff + i] = c * pr - s * qr;
          im[pOff + i] = c * pi - s * qi;
          re[qOff + i] = s * pr + c * qr;
          im[qOff + i] = s * pi + c * qi;
        }
        const vpOff = p * cols;
        for (let i = 0; i < cols; i++) {
          const vpr = rightRe[vpOff + i]!;
          const vpi = rightIm[vpOff + i]!;
          const vqr = rightRe[vqOff + i]!;
          const vqi = rightIm[vqOff + i]!;
          rightRe[vpOff + i] = c * vpr - s * vqr;
          rightIm[vpOff + i] = c * vpi - s * vqi;
          rightRe[vqOff + i] = s * vpr + c * vqr;
          rightIm[vqOff + i] = s * vpi + c * vqi;
        }
      }
    }
    if (off === 0) break;
  }

  const norms = new Float64Array(cols);
  for (let j = 0; j < cols; j++) {
    const jOff = j * rows;
    let s2 = 0;
    for (let i = 0; i < rows; i++) s2 += re[jOff + i]! * re[jOff + i]! + im[jOff + i]! * im[jOff + i]!;
    norms[j] = Math.sqrt(s2);
  }

  // Descending, with both sets of vectors carried along.
  const order = Int32Array.from(
    Array.from({ length: cols }, (_, j) => j).sort((x, y) => norms[y]! - norms[x]!),
  );
  const values = new Float64Array(cols);
  for (let j = 0; j < cols; j++) values[j] = norms[order[j]!]!;
  permuteColumns(re, im, rows, cols, order);
  permuteColumns(rightRe, rightIm, cols, cols, order);

  for (let j = 0; j < cols; j++) {
    const jOff = j * rows;
    const sv = values[j]!;
    if (sv === 0) {
      re.fill(0, jOff, jOff + rows);
      im.fill(0, jOff, jOff + rows);
      continue;
    }
    const inv = 1 / sv;
    for (let i = 0; i < rows; i++) {
      re[jOff + i] = re[jOff + i]! * inv;
      im[jOff + i] = im[jOff + i]! * inv;
    }
  }

  return { values, leftRe: re, leftIm: im, rightRe, rightIm, sweeps };
}
