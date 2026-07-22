import { PupilPoint } from "../pupil/aiming";

/**
 * Zernike decomposition of a wavefront.
 *
 * This module exists for two reasons, and the second is the structural one:
 *
 *  1. **Readout.** Zernike coefficients are how opticians name aberrations.
 *     "0.3 waves of coma" is a coefficient; the OPD map it came from is a
 *     cloud of numbers.
 *  2. **Resampling.** The engine traces a COARSE pupil (64×64 resolves a
 *     smooth system wavefront) but the FFT that turns pupil into PSF wants a
 *     FINE grid — and atmospheric seeing at D/r₀ ≈ 20 wants 256²–512². Tracing
 *     512² rays to feed the FFT would be wasteful by two orders of magnitude.
 *     So: trace coarse, fit a basis, evaluate the fit wherever the FFT needs
 *     it (ARCHITECTURE § Pupil sampling vs. atmospheric seeing). That is why
 *     the wave layer consumes *a fit plus a sampler*, never a fixed-size
 *     array, and it is why this module is upstream of the PSF rather than a
 *     reporting convenience hung off the side.
 *
 * ## Indexing: Noll (1976)
 *
 * Two conventions are in circulation (Noll and OSA/ANSI) and they disagree on
 * both ordering and normalization, so mixing them silently mislabels every
 * aberration. This engine uses **Noll**, single-index j starting at 1:
 *
 *     j = 1  piston            j = 5,6   astigmatism
 *     j = 2  tilt x            j = 7,8   coma
 *     j = 3  tilt y            j = 9,10  trefoil
 *     j = 4  defocus           j = 11    primary spherical
 *
 * Chosen over OSA because the Kolmogorov turbulence variances that the seeing
 * model needs (step 5) are tabulated in Noll indices in the source literature
 * — matching the convention of the data avoids a translation layer at exactly
 * the place an off-by-one would be hardest to notice.
 *
 * **Normalization is Noll's too:** the mean square of each polynomial over the
 * unit disc is 1, i.e. (1/π)∫∫ Z_j² dA = 1. Two consequences the code relies
 * on:
 *   - a coefficient is directly an RMS contribution, so the total RMS
 *     wavefront error is √(Σ_{j≥2} c_j²) — no quadrature needed (`fitRms`);
 *   - piston (j=1) is excluded from that sum because it is not an aberration,
 *     which matches how `OpdMap.rmsWaves` removes the mean.
 */

/** Radial order n and azimuthal order m; m > 0 is cosine, m < 0 is sine. */
export interface NollIndex {
  readonly n: number;
  readonly m: number;
}

/**
 * Noll single index j → (n, m).
 *
 * Within a radial order n there are n+1 terms. |m| runs 0,2,4,… for even n and
 * 1,1,3,3,… for odd n; within a ± pair, an even j takes the cosine and an odd
 * j the sine. That last rule is Noll's, and it is why j=2 is tilt-*x* while
 * j=7 is the *sine* coma — the parity alternates with radial order rather than
 * the cosine always coming first.
 */
export function nollIndex(j: number): NollIndex {
  if (!Number.isInteger(j) || j < 1) throw new Error(`Noll index must be a positive integer, got ${j}`);
  let n = 0;
  let rest = j - 1;
  while (rest > n) {
    n += 1;
    rest -= n;
  }
  const odd = n % 2;
  const absM = 2 * Math.floor((rest + (odd === 0 ? 1 : 0)) / 2) + odd;
  if (absM === 0) return { n, m: 0 };
  return { n, m: j % 2 === 0 ? absM : -absM };
}

/** Number of terms up to and including radial order `n` — (n+1)(n+2)/2. */
export function termsThroughOrder(n: number): number {
  return ((n + 1) * (n + 2)) / 2;
}

const FACTORIAL: number[] = (() => {
  const f = [1];
  for (let i = 1; i <= 40; i++) f.push(f[i - 1]! * i);
  return f;
})();

/**
 * Radial polynomial R_n^|m|(ρ). Zero unless n − |m| is even and non-negative.
 *
 * Evaluated from the explicit factorial sum. That form is ill-conditioned at
 * high order (alternating terms of growing size), which bounds the useful term
 * count to a few dozen — comfortably above the ~36 terms a smooth system
 * wavefront needs, and the reason `fitZernike` caps rather than silently
 * degrading.
 */
export function radialPolynomial(n: number, m: number, rho: number): number {
  const a = Math.abs(m);
  if (a > n || (n - a) % 2 !== 0) return 0;
  const half = (n - a) / 2;
  let sum = 0;
  for (let s = 0; s <= half; s++) {
    const num = FACTORIAL[n - s]!;
    const den = FACTORIAL[s]! * FACTORIAL[(n + a) / 2 - s]! * FACTORIAL[half - s]!;
    sum += (s % 2 === 0 ? 1 : -1) * (num / den) * Math.pow(rho, n - 2 * s);
  }
  return sum;
}

/** Noll normalization factor: √(n+1) for m = 0, √(2(n+1)) otherwise. */
export function nollNorm(n: number, m: number): number {
  return Math.sqrt((m === 0 ? 1 : 2) * (n + 1));
}

/**
 * Z_j evaluated at a normalized pupil point (px² + py² ≤ 1 inside the rim).
 *
 * Defined outside the unit disc too — the polynomial does not care — but the
 * orthonormality that makes coefficients meaningful only holds on the disc, so
 * callers must not feed it corner samples of a square grid.
 */
export function zernike(j: number, px: number, py: number): number {
  const { n, m } = nollIndex(j);
  const rho = Math.hypot(px, py);
  const radial = nollNorm(n, m) * radialPolynomial(n, m, rho);
  if (m === 0) return radial;
  const theta = Math.atan2(py, px);
  return m > 0 ? radial * Math.cos(m * theta) : radial * Math.sin(-m * theta);
}

/** A wavefront sample: a pupil point and its OPD. `OpdSample` satisfies this. */
export interface WavefrontSample extends PupilPoint {
  readonly waves: number;
}

export interface ZernikeFit {
  /** Terms fitted: Noll j = 1 … terms. */
  readonly terms: number;
  /** Coefficients in waves; index j−1. Orthonormal, so each IS an RMS share. */
  readonly coefficients: Float64Array;
  /** RMS of what the basis could not represent (waves). */
  readonly rmsResidualWaves: number;
  readonly samplesUsed: number;
}

/**
 * Solve min‖Ax − b‖ by Householder QR, in place.
 *
 * QR rather than the normal equations: A is a Zernike design matrix whose
 * condition number grows with term count, and AᵀA squares it. QR costs a
 * constant factor more on a problem this size (hundreds of rows, tens of
 * columns) and keeps the fit honest at 36 terms.
 */
function leastSquares(a: Float64Array, rows: number, cols: number, b: Float64Array): Float64Array {
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
    // A rank-deficient column means the samples never excited that mode (e.g.
    // a pure fan cannot see sagittal terms). Reporting zero beats an infinity
    // that would poison every later evaluation of the fit.
    x[i] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}

/** Largest term count a sample set can support without being underdetermined. */
export const MAX_ZERNIKE_TERMS = 45; // through radial order 8

/**
 * Least-squares fit of Zernike terms to scattered wavefront samples.
 *
 * Scattered, not gridded: the samples that reach here are whatever survived
 * the trace, so vignetting has already carved pieces out of the pupil. A
 * least-squares fit handles that; a quadrature-based projection would silently
 * mis-weight the surviving points.
 *
 * Samples outside the unit disc are rejected rather than fitted — outside it
 * the basis is not orthogonal and the coefficients stop meaning what their
 * names say.
 */
export function fitZernike(samples: readonly WavefrontSample[], terms: number): ZernikeFit {
  if (!Number.isInteger(terms) || terms < 1) throw new Error(`term count must be ≥ 1, got ${terms}`);
  if (terms > MAX_ZERNIKE_TERMS) {
    throw new Error(`term count ${terms} exceeds MAX_ZERNIKE_TERMS (${MAX_ZERNIKE_TERMS})`);
  }

  const inside = samples.filter((s) => s.px * s.px + s.py * s.py <= 1 + 1e-9);
  if (inside.length < terms) {
    throw new Error(`Zernike fit needs at least ${terms} in-pupil samples, got ${inside.length}`);
  }

  const rows = inside.length;
  const a = new Float64Array(rows * terms);
  const b = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    const s = inside[i]!;
    b[i] = s.waves;
    for (let j = 1; j <= terms; j++) a[i * terms + (j - 1)] = zernike(j, s.px, s.py);
  }

  const coefficients = leastSquares(a, rows, terms, b);

  // Residual measured by re-evaluating the fit, not read off the QR: it checks
  // the evaluator and the solver against each other rather than trusting one.
  let acc = 0;
  for (const s of inside) {
    let model = 0;
    for (let j = 1; j <= terms; j++) model += coefficients[j - 1]! * zernike(j, s.px, s.py);
    acc += (s.waves - model) ** 2;
  }

  return {
    terms,
    coefficients,
    rmsResidualWaves: Math.sqrt(acc / rows),
    samplesUsed: rows,
  };
}

/** Evaluate a fit at a normalized pupil point (waves). */
export function evaluateFit(fit: ZernikeFit, px: number, py: number): number {
  let sum = 0;
  for (let j = 1; j <= fit.terms; j++) sum += fit.coefficients[j - 1]! * zernike(j, px, py);
  return sum;
}

/**
 * The sampler half of "a fitted basis plus a sampler". Hoists the coefficient
 * list out of the inner loop so the FFT grid fill is one multiply-add per
 * term per point, and gives the wave layer something it can hold that is not a
 * fixed-size array.
 */
export function wavefrontSampler(fit: ZernikeFit): (px: number, py: number) => number {
  const c = fit.coefficients;
  const terms = fit.terms;
  return (px, py) => {
    let sum = 0;
    for (let j = 1; j <= terms; j++) sum += c[j - 1]! * zernike(j, px, py);
    return sum;
  };
}

/**
 * RMS wavefront error implied by the coefficients (waves).
 *
 * Because the basis is orthonormal this is √(Σ c_j²) — Parseval for Zernikes,
 * not an approximation of a quadrature. Piston is excluded by default (it is
 * not an aberration); tilt is NOT, because tilt off-axis is a real chief-ray
 * displacement and hiding it would misreport distortion as perfection.
 */
export function fitRms(fit: ZernikeFit, options: { includePiston?: boolean } = {}): number {
  const from = options.includePiston === true ? 1 : 2;
  let acc = 0;
  for (let j = from; j <= fit.terms; j++) acc += fit.coefficients[j - 1]! ** 2;
  return Math.sqrt(acc);
}

/** Coefficient for Noll term j (waves), or 0 if the fit did not go that far. */
export function coefficient(fit: ZernikeFit, j: number): number {
  return j >= 1 && j <= fit.terms ? fit.coefficients[j - 1]! : 0;
}

/** Human-readable name for the low-order Noll terms; "" beyond the table. */
export function nollName(j: number): string {
  const names: Record<number, string> = {
    1: "piston",
    2: "tilt x",
    3: "tilt y",
    4: "defocus",
    5: "astigmatism 45°",
    6: "astigmatism 0°",
    7: "coma y",
    8: "coma x",
    9: "trefoil y",
    10: "trefoil x",
    11: "primary spherical",
  };
  return names[j] ?? "";
}
