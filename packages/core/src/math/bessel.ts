/**
 * Bessel functions of the first kind — as far as the wave layer needs them.
 *
 * The engine has gone this far without one, which is deliberate: every
 * diffraction result so far came out of an FFT of an actual pupil, so the Airy
 * pattern was *produced* rather than evaluated. Nothing changes about that.
 * What arrives here is the closed form a rung compares against, not a second
 * way to compute an image.
 *
 * ## Series, not a fitted approximation, and the domain is stated
 *
 * `besselJ1` is the defining power series
 *
 *     J₁(x) = Σ_{k≥0} (−1)^k (x/2)^{2k+1} / (k! (k+1)!)
 *
 * evaluated by term recurrence. The alternative — one of the published
 * minimax/rational approximations — would mean transcribing a table of fitted
 * coefficients, which this repo forbids for the same reason it forbids
 * transcribing a lens prescription from memory: the numbers would be unpinnable
 * and a typo in the sixth digit is invisible. The series is a *definition*, so
 * it can be pinned against a second one — Bessel's integral,
 * J₁(x) = (1/π)∫₀^π cos(θ − x·sin θ) dθ, which the rung evaluates by a
 * spectrally convergent quadrature — rather than against a remembered table.
 *
 * The price is cancellation. The terms have total magnitude I₁(x) ≈ e^x/√(2πx)
 * and sum to something below 0.6, so f64 can only return about ε·I₁(x) of
 * absolute accuracy — measured, roughly a tenth of that, since the roundoff is
 * a random walk. Out to |x| = 10, where every caller in this engine lives (the
 * first few zeros of the van Cittert–Zernike coherence factor), the series is
 * good to 13 digits, and to 15 below |x| = 3. At |x| = 25 it is down to ~1e-7
 * absolute, and past that it degrades fast enough to be worth refusing rather
 * than silently returning noise. The rung measures both ends.
 */

/**
 * Largest |x| the series is evaluated at.
 *
 * Not a property of the mathematics — a statement about f64. See the module
 * note: the alternating sum gives up about ε·I₁(x), so this is roughly where
 * the answer stops carrying seven decimal digits.
 */
export const BESSEL_SERIES_LIMIT = 25;

/**
 * J₁(x), the Bessel function of the first kind of order one.
 *
 * Odd, so negative arguments are handled by the series itself rather than by a
 * reflection: the recurrence below is seeded with x/2 and every term carries
 * the sign.
 */
export function besselJ1(x: number): number {
  if (!Number.isFinite(x)) {
    throw new Error(`besselJ1 needs a finite argument, got ${x}`);
  }
  const ax = Math.abs(x);
  if (ax > BESSEL_SERIES_LIMIT) {
    throw new Error(
      `besselJ1 is evaluated by its power series and loses accuracy past ` +
        `|x| = ${BESSEL_SERIES_LIMIT}; got ${x}`,
    );
  }
  const half = x / 2;
  const halfSq = -half * half;
  // t_k / t_{k−1} = −(x/2)² / (k(k+1)), so no factorial is ever formed and the
  // recurrence cannot overflow before the sum has converged.
  let term = half;
  let sum = term;
  for (let k = 1; k < 200; k++) {
    term *= halfSq / (k * (k + 1));
    sum += term;
    // Only test for convergence past the hump: the terms GROW until k ≈ x/2,
    // and an early-out before then would stop on the way up.
    if (k > ax && Math.abs(term) < 1e-20) break;
  }
  return sum;
}

/**
 * Jₘ(x) for integer order m — the same defining series, one order up.
 *
 *     Jₘ(x) = Σ_{k≥0} (−1)^k (x/2)^{2k+m} / (k! (k+m)!)
 *
 * Added for the phase grating's spectrum (`illumination/abbe`), where the object
 * is a *sum over orders* rather than one closed form: Jacobi–Anger writes
 * exp(i·φ·cos θ) as Σₘ iᵐ Jₘ(φ) e^{imθ}, so building that object needs every
 * order the grid can hold, not just the first.
 *
 * Negative orders come from J₋ₘ = (−1)ᵐ Jₘ rather than from a second series.
 *
 * The seed (x/2)^m/m! is formed by the same running product as the sum, so no
 * factorial is ever built: at m = 60 the factorial would overflow f64 while the
 * seed itself is a perfectly ordinary 1e-70. Orders past where the seed
 * underflows return 0, which is the right answer to fifteen digits — Jₘ(x) for
 * m ≫ x is smaller than anything the sums it feeds can notice.
 *
 * Accuracy is the module note's: the series is alternating, so it gives up about
 * ε·Iₘ(x), and `BESSEL_SERIES_LIMIT` is where that stops being worth returning.
 */
export function besselJ(order: number, x: number): number {
  if (!Number.isInteger(order)) {
    throw new Error(`besselJ needs an integer order, got ${order}`);
  }
  if (!Number.isFinite(x)) {
    throw new Error(`besselJ needs a finite argument, got ${x}`);
  }
  const ax = Math.abs(x);
  if (ax > BESSEL_SERIES_LIMIT) {
    throw new Error(
      `besselJ is evaluated by its power series and loses accuracy past ` +
        `|x| = ${BESSEL_SERIES_LIMIT}; got ${x}`,
    );
  }
  if (order < 0) {
    return order % 2 === 0 ? besselJ(-order, x) : -besselJ(-order, x);
  }
  const half = x / 2;
  // t₀ = (x/2)^m / m!, accumulated one factor at a time.
  let term = 1;
  for (let j = 1; j <= order; j++) term *= half / j;
  if (term === 0) return 0;
  let sum = term;
  const halfSq = -half * half;
  for (let k = 1; k < 400; k++) {
    term *= halfSq / (k * (k + order));
    sum += term;
    // Past the hump only — the terms grow until k ≈ x/2, and an early-out
    // before then would stop on the way up. See `besselJ1`.
    if (k > ax && Math.abs(term) < 1e-20) break;
  }
  return sum;
}

/**
 * jinc(v) = 2·J₁(v)/v, with its removable singularity filled in.
 *
 * The shape that keeps appearing wherever a *circle* is transformed: the Airy
 * amplitude of a circular pupil, the OTF-adjacent autocorrelation of a disc,
 * and — the reason it lands here — the van Cittert–Zernike degree of coherence
 * of a uniform circular source (`illumination/coherence`).
 *
 * jinc(0) = 1 exactly, which is the normalization every one of those uses:
 * a source of zero extent is perfectly coherent, an Airy peak is the peak.
 */
export function jinc(v: number): number {
  if (!Number.isFinite(v)) {
    throw new Error(`jinc needs a finite argument, got ${v}`);
  }
  // The series' first two terms are v/2 − v³/16, so 2J₁(v)/v → 1 − v²/8. Below
  // this cut the quadratic IS the double-precision answer and the division
  // would only add rounding noise near a 0/0.
  if (Math.abs(v) < 1e-8) return 1 - (v * v) / 8;
  return (2 * besselJ1(v)) / v;
}
