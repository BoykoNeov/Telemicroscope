/**
 * Colour — how a spectrum becomes something a screen can show.
 *
 * This is the layer that makes the step-4 milestone *visible*. Purple fringing
 * is not a new physical effect: it is the chromatic focal shift the tracer
 * already computes, seen through the response of an eye. Without a λ → colour
 * map the whole story is a set of numbers that differ; with one it is an image
 * that is violet at the edges.
 *
 * ## The colour-matching functions
 *
 * The CIE 1931 2° standard observer is tabulated data, but it is used here in
 * the published **analytic multi-lobe fit** of Wyman, Sloan & Shirley,
 * "Simple Analytic Approximations to the CIE XYZ Color Matching Functions",
 * JCGT 2(2), 2013 — a sum of piecewise Gaussians, accurate to about 1% of
 * peak.
 *
 * That is a deliberate trade and it is worth stating plainly. The fit is an
 * approximation to the standard observer, so it is NOT the authority the
 * tabulated data would be; what it buys is that the whole observer is 20
 * numbers that can be read and checked, rather than 243 that can only be
 * trusted. The error it introduces is bounded and measured by the rungs below
 * (illuminant E lands at 0.3331, 0.3335 against a true 1/3, 1/3; the ȳ peak at
 * 554.2 nm against 555). Both are far below any chromatic difference this
 * engine exists to show, and swapping in the tabulated observer later is a
 * change to this file alone — nothing downstream knows which one it got.
 *
 * ## Units and normalization
 *
 * The CMFs are dimensionless weighting functions of wavelength. XYZ therefore
 * carries whatever units the spectrum was in; only *ratios* (chromaticity) and
 * post-normalization RGB are absolute. Nothing here normalizes for you,
 * because the imaging layer needs to control exposure itself.
 */

/** Range over which the fit is defined and non-negligible (nm). */
export const CMF_MIN_NM = 360;
export const CMF_MAX_NM = 830;

/** Piecewise Gaussian: σ differs either side of the peak. */
function lobe(x: number, mu: number, sigmaLo: number, sigmaHi: number): number {
  const t = (x - mu) / (x < mu ? sigmaLo : sigmaHi);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 2° x̄(λ). */
export function xBar(nm: number): number {
  return (
    1.056 * lobe(nm, 599.8, 37.9, 31.0) +
    0.362 * lobe(nm, 442.0, 16.0, 26.7) -
    0.065 * lobe(nm, 501.1, 20.4, 26.2)
  );
}

/** CIE 1931 2° ȳ(λ) — also the photopic luminous efficiency V(λ). */
export function yBar(nm: number): number {
  return 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
}

/** CIE 1931 2° z̄(λ). */
export function zBar(nm: number): number {
  return 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
}

export interface Xyz {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** All three CMFs at once — the form the per-wavelength image loop wants. */
export function colorMatch(nm: number): Xyz {
  return { x: xBar(nm), y: yBar(nm), z: zBar(nm) };
}

export interface Chromaticity {
  readonly x: number;
  readonly y: number;
}

/**
 * CIE 1931 chromaticity — the direction of a colour with its brightness
 * divided out. Black has none, and returning (0, 0) rather than NaN would be a
 * lie about where it sits, so it throws.
 */
export function chromaticity(c: Xyz): Chromaticity {
  const sum = c.x + c.y + c.z;
  if (!(sum > 0)) throw new Error("chromaticity of a colour with no energy is undefined");
  return { x: c.x / sum, y: c.y / sum };
}

/**
 * Integrate a spectral power distribution against the observer.
 *
 * Trapezoidal over a uniform grid; the CMFs are smooth on the scale of a
 * nanometre, so the sampling step is the only error term and 1 nm is
 * effectively exact.
 */
export function spectrumToXyz(
  spectralPower: (nm: number) => number,
  options: { fromNm?: number; toNm?: number; stepNm?: number } = {},
): Xyz {
  const from = options.fromNm ?? CMF_MIN_NM;
  const to = options.toNm ?? CMF_MAX_NM;
  const step = options.stepNm ?? 1;
  if (!(step > 0)) throw new Error(`stepNm must be positive, got ${step}`);

  let x = 0;
  let y = 0;
  let z = 0;
  const n = Math.max(1, Math.round((to - from) / step));
  for (let i = 0; i <= n; i++) {
    const nm = from + (i * (to - from)) / n;
    const w = (i === 0 || i === n ? 0.5 : 1) * ((to - from) / n);
    const s = spectralPower(nm);
    x += s * xBar(nm) * w;
    y += s * yBar(nm) * w;
    z += s * zBar(nm) * w;
  }
  return { x, y, z };
}

/**
 * Correlated colour temperature by McCamy's cubic approximation
 * (C. S. McCamy, Color Research & Application 17(2), 1992).
 *
 * Present as a *readout* and, more usefully, as a rung: feeding a blackbody
 * through `spectrumToXyz` and back out through this formula is a round trip
 * that leaves the engine entirely and comes back — if the observer above were
 * wrong, the temperature would not come back right. Valid near the Planckian
 * locus over roughly 2000–15000 K; far from the locus it is meaningless, and
 * this does not check.
 */
export function correlatedColorTemperature(c: Chromaticity): number {
  const n = (c.x - 0.332) / (0.1858 - c.y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}
