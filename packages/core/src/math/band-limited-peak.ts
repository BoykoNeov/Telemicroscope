import { fft2d } from "./fft";

/**
 * The maximum of a sampled image read off its trigonometric interpolant — the
 * continuous, periodic, band-limited function whose samples the image is.
 *
 * ## Why not the brightest pixel
 *
 * The brightest pixel is a maximum over a grid, and a quantity read off it as
 * something else moves is a maximum of several smooth curves: wherever the
 * winner hands over to a neighbour the curve has a corner. § 2q found one at
 * the top of a focus sweep — the image of an off-axis point slides sideways
 * with defocus, the brightest pixel changed at the vertex, and the three-point
 * parabola read the corner as a plateau. The interpolant has no corners: each
 * sample is smooth in whatever moves, the interpolant is linear in the samples,
 * and the maximum of a smooth family is smooth where it is non-degenerate.
 *
 * ## When it is the image and not a model of it
 *
 * The image is taken as one period of a periodic function, and its frequencies
 * as signed, −n/2 ≤ k < n/2. That is the image itself, not a fit, exactly when
 * it has no content at the Nyquist row or column. A render formed by FFT on an
 * n-grid from a pupil lattice `pupilSamples` across has `pupilSamples + 1`
 * nodes rim to rim — the rim nodes are lit when the rim falls on them, which
 * on the exit layout it does on axis (§ 2q) — so its spectral support is
 * |k| ≤ pupilSamples, and `n > 2·pupilSamples` is the condition. The focus
 * sweep enforces it rather than this function guessing at it. Measured (§ 2q.2)
 * on rendered planes that meet it, the energy at the Nyquist row and column is
 * 1e-33 of the image's non-DC energy: round-off.
 *
 * ## Convention
 *
 * `values[iy·n + ix]` — rows are y, as everywhere in the wave layer. The
 * returned position is in pixel units of that same index, fractional.
 *
 * ## The search, and what it refuses
 *
 * Newton's method on the interpolant from the brightest pixel, every derivative
 * exact (one O(n²) pass gives the value, gradient and Hessian together), a step
 * cut to one pixel; where the interpolant is not concave there it climbs the
 * gradient until it is. Only a concave stationary point within 1.5 pixels of
 * the brightest one is returned. A ring — an image far from focus, whose
 * maximum runs round it nearly flat — is REFUSED rather than read: the search
 * walks along it, or never settles, and a number read off that would be this
 * function's choice and not the image's. It is meant for a peak.
 */
export interface BandLimitedPeak {
  /** The interpolant's value at its maximum. */
  readonly value: number;
  /** Where it is, in fractional pixel index (x = column, y = row). */
  readonly x: number;
  readonly y: number;
  /** The brightest sample — what the pixel readout would have returned. */
  readonly pixelValue: number;
}

const MAX_ITERATIONS = 200;
const CONVERGED_PX = 1e-10;

export function bandLimitedPeak(values: Float64Array, n: number): BandLimitedPeak {
  if (values.length !== n * n) {
    throw new Error(`bandLimitedPeak: an image of ${values.length} samples is not ${n}×${n}`);
  }
  let arg = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[arg]!) arg = i;
  const pixelValue = values[arg]!;
  if (!(Number.isFinite(pixelValue) && pixelValue > 0)) {
    throw new Error(`bandLimitedPeak: the brightest sample is ${pixelValue}`);
  }
  const re = Float64Array.from(values);
  const im = new Float64Array(n * n);
  fft2d(re, im, n);

  const freq = new Float64Array(n);
  for (let k = 0; k < n; k++) freq[k] = (2 * Math.PI * (k < n / 2 ? k : k - n)) / n;
  const cx = new Float64Array(n);
  const sx = new Float64Array(n);
  const cy = new Float64Array(n);
  const sy = new Float64Array(n);
  const norm = 1 / (n * n);

  // Value, gradient and Hessian of Re Σ F[l,k]·e^{i(ωₖx + ωₗy)} / n².
  const evaluate = (x: number, y: number) => {
    for (let k = 0; k < n; k++) {
      cx[k] = Math.cos(freq[k]! * x);
      sx[k] = Math.sin(freq[k]! * x);
      cy[k] = Math.cos(freq[k]! * y);
      sy[k] = Math.sin(freq[k]! * y);
    }
    let f = 0;
    let fx = 0;
    let fy = 0;
    let fxx = 0;
    let fxy = 0;
    let fyy = 0;
    for (let l = 0; l < n; l++) {
      // Row sums over x: S0 = Σ F·e, S1 = Σ F·ω·e (times i, applied below), S2 = Σ F·ω²·e.
      let s0r = 0;
      let s0i = 0;
      let s1r = 0;
      let s1i = 0;
      let s2r = 0;
      let s2i = 0;
      const row = l * n;
      for (let k = 0; k < n; k++) {
        const fr = re[row + k]!;
        const fi = im[row + k]!;
        const er = fr * cx[k]! - fi * sx[k]!;
        const ei = fr * sx[k]! + fi * cx[k]!;
        const w = freq[k]!;
        s0r += er;
        s0i += ei;
        s1r += w * er;
        s1i += w * ei;
        s2r += w * w * er;
        s2i += w * w * ei;
      }
      const c = cy[l]!;
      const s = sy[l]!;
      const v = freq[l]!;
      // Re(S·e^{iωy}) = Sr·c − Si·s ; the i·ω factors turn Re into −Im.
      const t0r = s0r * c - s0i * s;
      const t0i = s0r * s + s0i * c;
      const t1r = s1r * c - s1i * s;
      const t1i = s1r * s + s1i * c;
      const t2r = s2r * c - s2i * s;
      f += t0r;
      fx -= t1i;
      fxx -= t2r;
      fy -= v * t0i;
      fyy -= v * v * t0r;
      fxy -= v * t1r;
    }
    return {
      f: f * norm,
      fx: fx * norm,
      fy: fy * norm,
      fxx: fxx * norm,
      fxy: fxy * norm,
      fyy: fyy * norm,
    };
  };

  const x0 = arg % n;
  const y0 = Math.floor(arg / n);
  let x = x0;
  let y = y0;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const e = evaluate(x, y);
    const det = e.fxx * e.fyy - e.fxy * e.fxy;
    let settled = false;
    if (e.fxx < 0 && det > 0) {
      let dx = -(e.fyy * e.fx - e.fxy * e.fy) / det;
      let dy = -(e.fxx * e.fy - e.fxy * e.fx) / det;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      x += dx;
      y += dy;
      settled = length < CONVERGED_PX;
    } else {
      // Off the dome: a quarter pixel along the gradient, halved until the value rises.
      const g = Math.hypot(e.fx, e.fy);
      let t = 0.25 / g;
      while (!(g > 0) || evaluate(x + t * e.fx, y + t * e.fy).f <= e.f) {
        t /= 2;
        if (!(g > 0) || t * g < CONVERGED_PX) {
          throw new Error(
            `bandLimitedPeak: (${x}, ${y}), beside the brightest pixel (${x0}, ${y0}), is a ` +
              `saddle of the interpolant and not a maximum`,
          );
        }
      }
      x += t * e.fx;
      y += t * e.fy;
    }
    if (Math.hypot(x - x0, y - y0) > 1.5) {
      throw new Error(
        `bandLimitedPeak: the search walked to (${x}, ${y}), more than 1.5 pixels from the ` +
          `brightest pixel (${x0}, ${y0}) — a ring, not a peak, and this reads a peak`,
      );
    }
    if (settled) return { value: evaluate(x, y).f, x, y, pixelValue };
  }
  throw new Error(
    `bandLimitedPeak: the search from (${x0}, ${y0}) did not settle in ${MAX_ITERATIONS} steps`,
  );
}
