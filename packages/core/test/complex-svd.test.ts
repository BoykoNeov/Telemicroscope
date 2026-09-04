import { describe, expect, it } from "vitest";
import { complexSingularSystem, singularSystem } from "../src/math/lsq";

/**
 * § 6cs.1 — the complex one-sided Jacobi, pinned before it has a caller.
 *
 * Everything here is a closed form with no engine in it. The solver exists for
 * Hopkins' kernel — the kernel is A·Aᴴ over the condenser, so its eigenvectors
 * are A's left singular vectors and its eigenvalues are σ² — but nothing in
 * this file knows that, deliberately: a solver pinned against the thing that
 * calls it pins nothing.
 *
 * The two rungs that discriminate are the complex 2×2 Gram (a real rotation
 * alone cannot annihilate a complex overlap, so a missing phase step fails
 * here and nowhere else) and the badly scaled pair, where σ₂/σ₁ is below f64
 * epsilon and only a method with high *relative* accuracy can see it at all.
 */

/** Column-major complex matrix, `rows × cols`: element (i, j) at `j*rows + i`. */
interface CM {
  re: Float64Array;
  im: Float64Array;
  rows: number;
  cols: number;
}

function cm(rows: number, cols: number, f: (i: number, j: number) => [number, number]): CM {
  const re = new Float64Array(rows * cols);
  const im = new Float64Array(rows * cols);
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < rows; i++) {
      const [r, m] = f(i, j);
      re[j * rows + i] = r;
      im[j * rows + i] = m;
    }
  }
  return { re, im, rows, cols };
}

function copy(a: CM): CM {
  return { re: Float64Array.from(a.re), im: Float64Array.from(a.im), rows: a.rows, cols: a.cols };
}

/** γ = a[:,p]ᴴ·a[:,q]. */
function overlap(a: CM, p: number, q: number): [number, number] {
  let gr = 0;
  let gi = 0;
  for (let i = 0; i < a.rows; i++) {
    const pr = a.re[p * a.rows + i]!;
    const pi = a.im[p * a.rows + i]!;
    const qr = a.re[q * a.rows + i]!;
    const qi = a.im[q * a.rows + i]!;
    gr += pr * qr + pi * qi;
    gi += pr * qi - pi * qr;
  }
  return [gr, gi];
}

function columnNorm2(a: CM, j: number): number {
  let s = 0;
  for (let i = 0; i < a.rows; i++) {
    s += a.re[j * a.rows + i]! ** 2 + a.im[j * a.rows + i]! ** 2;
  }
  return s;
}

/** A deterministic complex pseudo-random stream — no seed library, no drift. */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

describe("complexSingularSystem — a single column", () => {
  it("has σ₁ = ‖a‖ and the column itself as its left vector, the rest exactly 0", () => {
    const a = cm(5, 1, (i) => [i + 1, 2 - i]);
    const norm = Math.sqrt(columnNorm2(a, 0));
    const kept = copy(a);
    const svd = complexSingularSystem(a.re, a.im, 5, 1);

    expect(svd.values[0]!).toBeCloseTo(norm, 12);
    for (let i = 0; i < 5; i++) {
      expect(svd.leftRe[i]!).toBeCloseTo(kept.re[i]! / norm, 14);
      expect(svd.leftIm[i]!).toBeCloseTo(kept.im[i]! / norm, 14);
    }
    // One column, so V is 1×1 and unitary: a phase of modulus one.
    expect(Math.hypot(svd.rightRe[0]!, svd.rightIm[0]!)).toBeCloseTo(1, 15);
    // Nothing to orthogonalize — it converges on the first sweep.
    expect(svd.sweeps).toBe(1);
  });
});

describe("complexSingularSystem — closed forms", () => {
  it("a unitary matrix has every σ exactly 1: the DFT matrix over √n", () => {
    const n = 8;
    const f = cm(n, n, (i, j) => {
      const ang = (-2 * Math.PI * i * j) / n;
      return [Math.cos(ang) / Math.sqrt(n), Math.sin(ang) / Math.sqrt(n)];
    });
    const svd = complexSingularSystem(f.re, f.im, n, n);
    for (let j = 0; j < n; j++) expect(svd.values[j]!).toBeCloseTo(1, 14);
  });

  it("a diagonal complex matrix has σ = |dᵢ|, sorted", () => {
    const d: [number, number][] = [
      [3, 4],
      [0, 2],
      [-1, 0],
      [0.5, -0.5],
    ];
    const a = cm(4, 4, (i, j) => (i === j ? d[i]! : [0, 0]));
    const svd = complexSingularSystem(a.re, a.im, 4, 4);
    const expected = d.map(([r, m]) => Math.hypot(r, m)).sort((x, y) => y - x);
    for (let j = 0; j < 4; j++) expect(svd.values[j]!).toBeCloseTo(expected[j]!, 14);
  });

  /**
   * A circulant C[i][j] = c[(i−j) mod n] is diagonalized by the Fourier basis,
   * so its eigenvalues are exactly the DFT of its first column and — being
   * normal — its singular values are their moduli. n exact answers from one
   * closed form, with genuinely complex off-diagonal structure, which is what
   * makes this the strongest single pin here.
   */
  it("a complex circulant has σ = |DFT of its first column|", () => {
    const n = 6;
    const c: [number, number][] = [
      [1.0, 0.0],
      [0.3, 0.7],
      [-0.2, 0.1],
      [0.05, -0.4],
      [0.6, 0.2],
      [-0.15, -0.25],
    ];
    const a = cm(n, n, (i, j) => c[(((i - j) % n) + n) % n]!);
    const svd = complexSingularSystem(a.re, a.im, n, n);

    const eig: number[] = [];
    for (let k = 0; k < n; k++) {
      let lr = 0;
      let li = 0;
      for (let m = 0; m < n; m++) {
        const ang = (-2 * Math.PI * m * k) / n;
        const [cr, ci] = c[m]!;
        lr += cr * Math.cos(ang) - ci * Math.sin(ang);
        li += cr * Math.sin(ang) + ci * Math.cos(ang);
      }
      eig.push(Math.hypot(lr, li));
    }
    eig.sort((x, y) => y - x);
    for (let j = 0; j < n; j++) expect(svd.values[j]!).toBeCloseTo(eig[j]!, 13);
  });

  /**
   * The 2×2 Gram in closed form, with a genuinely COMPLEX overlap. λ =
   * (α+β)/2 ± √(((α−β)/2)² + |γ|²), and σ = √λ. A real plane rotation can only
   * annihilate Re γ, so a solver that skips the phase step leaves Im γ behind
   * and fails this rung — it is the one that discriminates.
   */
  it("two columns reproduce the 2×2 Hermitian Gram's eigenvalues", () => {
    const a = cm(6, 2, (i, j) =>
      j === 0
        ? [Math.cos(0.7 * i), Math.sin(0.3 * i + 0.2)]
        : [Math.sin(1.1 * i - 0.4), Math.cos(0.9 * i + 1.3)],
    );
    const alpha = columnNorm2(a, 0);
    const beta = columnNorm2(a, 1);
    const [gr, gi] = overlap(a, 0, 1);
    // The overlap has to be genuinely complex or the rung proves nothing.
    expect(Math.abs(gi)).toBeGreaterThan(0.1 * Math.hypot(gr, gi));

    const mid = (alpha + beta) / 2;
    const rad = Math.hypot((alpha - beta) / 2, Math.hypot(gr, gi));
    const svd = complexSingularSystem(a.re, a.im, 6, 2);
    expect(svd.values[0]! ** 2).toBeCloseTo(mid + rad, 12);
    expect(svd.values[1]! ** 2).toBeCloseTo(mid - rad, 12);
  });

  it("a rank-r factor has exactly cols − r singular values at roundoff", () => {
    const rows = 9;
    const cols = 5;
    const r = 3;
    const rnd = stream(20260904);
    const b = cm(rows, r, () => [rnd(), rnd()]);
    const k = cm(r, cols, () => [rnd(), rnd()]);
    // A = B·K, rows × cols, rank r.
    const a = cm(rows, cols, (i, j) => {
      let re = 0;
      let im = 0;
      for (let t = 0; t < r; t++) {
        const br = b.re[t * rows + i]!;
        const bi = b.im[t * rows + i]!;
        const kr = k.re[j * r + t]!;
        const ki = k.im[j * r + t]!;
        re += br * kr - bi * ki;
        im += br * ki + bi * kr;
      }
      return [re, im];
    });
    const svd = complexSingularSystem(a.re, a.im, rows, cols);
    expect(svd.values[r - 1]!).toBeGreaterThan(1e-3 * svd.values[0]!);
    for (let j = r; j < cols; j++) {
      expect(svd.values[j]!).toBeLessThan(1e-13 * svd.values[0]!);
    }
  });
});

describe("complexSingularSystem — the identities it must satisfy", () => {
  const rows = 11;
  const cols = 4;
  const rnd = stream(770231);
  const original = cm(rows, cols, () => [rnd(), rnd()]);

  it("Σσ² is the Frobenius norm squared", () => {
    const a = copy(original);
    let frob = 0;
    for (let t = 0; t < rows * cols; t++) frob += a.re[t]! ** 2 + a.im[t]! ** 2;
    const svd = complexSingularSystem(a.re, a.im, rows, cols);
    let sum = 0;
    for (let j = 0; j < cols; j++) sum += svd.values[j]! ** 2;
    expect(sum).toBeCloseTo(frob, 12);
  });

  /**
   * Uᴴ·U = I_cols, and NOT U·Uᴴ = I_rows. There are only `cols` left vectors,
   * spanning a cols-dimensional subspace of a rows-dimensional space — which is
   * all the rank A·Aᴴ has, so nothing is missing. Asserting the other product
   * would fail and read as a broken solver.
   */
  it("the left vectors are orthonormal as Uᴴ·U = I, the only product that holds", () => {
    const a = copy(original);
    const svd = complexSingularSystem(a.re, a.im, rows, cols);
    for (let p = 0; p < cols; p++) {
      for (let q = 0; q < cols; q++) {
        let dr = 0;
        let di = 0;
        for (let i = 0; i < rows; i++) {
          const pr = svd.leftRe[p * rows + i]!;
          const pi = svd.leftIm[p * rows + i]!;
          const qr = svd.leftRe[q * rows + i]!;
          const qi = svd.leftIm[q * rows + i]!;
          dr += pr * qr + pi * qi;
          di += pr * qi - pi * qr;
        }
        expect(dr).toBeCloseTo(p === q ? 1 : 0, 13);
        expect(di).toBeCloseTo(0, 13);
      }
    }
  });

  it("the right vectors are unitary", () => {
    const a = copy(original);
    const svd = complexSingularSystem(a.re, a.im, rows, cols);
    for (let p = 0; p < cols; p++) {
      for (let q = 0; q < cols; q++) {
        let dr = 0;
        let di = 0;
        for (let i = 0; i < cols; i++) {
          const pr = svd.rightRe[p * cols + i]!;
          const pi = svd.rightIm[p * cols + i]!;
          const qr = svd.rightRe[q * cols + i]!;
          const qi = svd.rightIm[q * cols + i]!;
          dr += pr * qr + pi * qi;
          di += pr * qi - pi * qr;
        }
        expect(dr).toBeCloseTo(p === q ? 1 : 0, 13);
        expect(di).toBeCloseTo(0, 13);
      }
    }
  });

  it("U·Σ·Vᴴ rebuilds the matrix it was given", () => {
    const a = copy(original);
    const svd = complexSingularSystem(a.re, a.im, rows, cols);
    let worst = 0;
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < rows; i++) {
        let re = 0;
        let im = 0;
        for (let t = 0; t < cols; t++) {
          const ur = svd.leftRe[t * rows + i]!;
          const ui = svd.leftIm[t * rows + i]!;
          const sv = svd.values[t]!;
          // conj(V[j][t]) — component j of right vector t.
          const vr = svd.rightRe[t * cols + j]!;
          const vi = -svd.rightIm[t * cols + j]!;
          const xr = ur * sv;
          const xi = ui * sv;
          re += xr * vr - xi * vi;
          im += xr * vi + xi * vr;
        }
        worst = Math.max(
          worst,
          Math.abs(re - original.re[j * rows + i]!),
          Math.abs(im - original.im[j * rows + i]!),
        );
      }
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it("agrees with the real solver when the imaginary part is zero", () => {
    const rnd2 = stream(31337);
    const rowsR = 7;
    const colsR = 3;
    const colMajor = cm(rowsR, colsR, () => [rnd2(), 0]);
    // The real version is ROW-major; transpose the same numbers into it.
    const rowMajor = new Float64Array(rowsR * colsR);
    for (let j = 0; j < colsR; j++) {
      for (let i = 0; i < rowsR; i++) rowMajor[i * colsR + j] = colMajor.re[j * rowsR + i]!;
    }
    const real = singularSystem(rowMajor, rowsR, colsR);
    const svd = complexSingularSystem(colMajor.re, colMajor.im, rowsR, colsR);
    for (let j = 0; j < colsR; j++) {
      expect(svd.values[j]!).toBeCloseTo(real.values[j]!, 12);
    }
  });
});

describe("complexSingularSystem — the small singular value, which is the point", () => {
  /**
   * Two columns whose norms differ by 10¹⁶, so σ₂/σ₁ lands BELOW f64 epsilon.
   * The closed form for the small one is stable here: λ₁·λ₂ = det(Gram) =
   * αβ − |γ|², and with the columns nowhere near parallel that difference does
   * not cancel — so λ₂ = (αβ − |γ|²)/λ₁ is exact to rounding while the
   * quadratic's own minus branch would not be.
   *
   * This is the rung that justifies one-sided Jacobi over anything that forms a
   * Gram matrix or a normal equation: those return σ₂ as roundoff of σ₁, which
   * is to say they return nothing. Truncating a coherent-mode expansion is
   * exactly a question about the small values, so a solver that cannot see them
   * cannot be used for it.
   */
  it("recovers σ₂ to high relative accuracy when σ₂/σ₁ is below f64 epsilon", () => {
    const big = 1e8;
    const small = 1e-8;
    const u = [0.6, 0.0, 0.8, 0.0];
    const v = [0.0, 0.36, 0.48, 0.8];
    const a = cm(4, 2, (i, j) =>
      j === 0 ? [big * u[i]!, 0] : [0, small * v[i]!],
    );
    const alpha = columnNorm2(a, 0);
    const beta = columnNorm2(a, 1);
    const [gr, gi] = overlap(a, 0, 1);
    const gmag2 = gr * gr + gi * gi;

    const mid = (alpha + beta) / 2;
    const lambda1 = mid + Math.hypot((alpha - beta) / 2, Math.sqrt(gmag2));
    const det = alpha * beta - gmag2;
    const lambda2 = det / lambda1;

    // The regime claim, asserted rather than assumed.
    expect(Math.sqrt(lambda2) / Math.sqrt(lambda1)).toBeLessThan(Number.EPSILON);
    // And the determinant does not cancel, so the closed form is trustworthy.
    expect(det).toBeGreaterThan(0.1 * alpha * beta);

    const svd = complexSingularSystem(a.re, a.im, 4, 2);
    expect(svd.values[0]! / Math.sqrt(lambda1) - 1).toBeLessThan(1e-14);
    expect(Math.abs(svd.values[1]! / Math.sqrt(lambda2) - 1)).toBeLessThan(1e-12);
  });
});
