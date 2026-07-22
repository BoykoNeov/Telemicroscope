/**
 * Complex FFT — the transform the wave layer runs on.
 *
 * Scope and conventions, both deliberate:
 *
 *  - **Radix-2 only.** Sizes must be powers of two. Pupil arrays are chosen,
 *    not given, so there is never a reason to transform a size of 1023; a
 *    Bluestein path would be code that only ever runs when something upstream
 *    has already gone wrong. Non-power-of-two throws.
 *  - **Split arrays** (`re`, `im` as separate `Float64Array`s) rather than
 *    interleaved. Analysis outputs cross the worker boundary as typed arrays
 *    (ARCHITECTURE § Data model), and a split pair transfers without a
 *    de-interleave step on either side.
 *  - **Unnormalized forward, 1/N inverse:**
 *        X[k] = Σ x[n]·exp(−2πi·kn/N)      x[n] = (1/N)·Σ X[k]·exp(+2πi·kn/N)
 *    so `Σ|x|² = (1/N)·Σ|X|²` (Parseval in this convention). The PSF's energy
 *    normalization depends on which side carries the 1/N; it is pinned by a
 *    Parseval rung rather than left to memory.
 *
 * Accuracy: twiddle factors come from a precomputed exact table, NOT from
 * recurrent rotation. Recurrence drifts as O(√N) and the pupil phase this
 * feeds is the whole point of running the trace in f64.
 */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function requirePowerOfTwo(n: number, what: string): void {
  if (!isPowerOfTwo(n)) {
    throw new Error(`${what} must be a power of two, got ${n}`);
  }
}

interface Twiddles {
  readonly re: Float64Array;
  readonly im: Float64Array;
}

/**
 * exp(−2πi·k/n) for k in [0, n/2). Cached per size: a transform of an n×n
 * array runs 2n one-dimensional passes, and they all share one table.
 */
const twiddleCache = new Map<number, Twiddles>();

function twiddles(n: number): Twiddles {
  const hit = twiddleCache.get(n);
  if (hit) return hit;
  const half = n >> 1;
  const re = new Float64Array(half);
  const im = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const a = (-2 * Math.PI * k) / n;
    re[k] = Math.cos(a);
    im[k] = Math.sin(a);
  }
  const t = { re, im };
  twiddleCache.set(n, t);
  return t;
}

/** In-place bit-reversal permutation. */
function bitReverse(re: Float64Array, im: Float64Array, n: number, offset: number, stride: number): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      const tr = re[a]!;
      const ti = im[a]!;
      re[a] = re[b]!;
      im[a] = im[b]!;
      re[b] = tr;
      im[b] = ti;
    }
  }
}

/**
 * One in-place Cooley–Tukey pass over `n` samples starting at `offset` with
 * `stride` between them. The stride is what lets the 2-D transform run down
 * columns without copying them out into a scratch buffer first.
 */
function transform(
  re: Float64Array,
  im: Float64Array,
  n: number,
  offset: number,
  stride: number,
  inverse: boolean,
): void {
  if (n === 1) return;
  bitReverse(re, im, n, offset, stride);
  const w = twiddles(n);
  const sign = inverse ? -1 : 1;

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len; // index into the size-n twiddle table
    for (let base = 0; base < n; base += len) {
      for (let k = 0; k < half; k++) {
        const t = k * step;
        const wr = w.re[t]!;
        const wi = sign * w.im[t]!;
        const iu = offset + (base + k) * stride;
        const iv = offset + (base + k + half) * stride;
        const vr = re[iv]!;
        const vi = im[iv]!;
        const tr = vr * wr - vi * wi;
        const ti = vr * wi + vi * wr;
        const ur = re[iu]!;
        const ui = im[iu]!;
        re[iu] = ur + tr;
        im[iu] = ui + ti;
        re[iv] = ur - tr;
        im[iv] = ui - ti;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      const idx = offset + i * stride;
      re[idx] = re[idx]! / n;
      im[idx] = im[idx]! / n;
    }
  }
}

/** In-place 1-D FFT. `re` and `im` must be the same power-of-two length. */
export function fft1d(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n) throw new Error("fft1d: re and im must be the same length");
  requirePowerOfTwo(n, "fft1d length");
  transform(re, im, n, 0, 1, inverse);
}

/**
 * In-place 2-D FFT of a square `n`×`n` array stored row-major.
 *
 * Row–column decomposition: the 2-D DFT is separable, so transforming every
 * row and then every column is the transform, not an approximation of it.
 */
export function fft2d(re: Float64Array, im: Float64Array, n: number, inverse = false): void {
  requirePowerOfTwo(n, "fft2d size");
  if (re.length !== n * n || im.length !== n * n) {
    throw new Error(`fft2d: arrays must hold ${n * n} elements`);
  }
  for (let row = 0; row < n; row++) transform(re, im, n, row * n, 1, inverse);
  for (let col = 0; col < n; col++) transform(re, im, n, col, n, inverse);
}

/**
 * Swap quadrants so zero frequency moves from index 0 to the array centre
 * (n/2, n/2) — where a PSF is expected to sit before anyone measures a radius
 * from it. Self-inverse for even `n`, which is the only case radix-2 produces.
 */
export function fftShift2d(a: Float64Array, n: number): void {
  if (n % 2 !== 0) throw new Error("fftShift2d: size must be even");
  if (a.length !== n * n) throw new Error(`fftShift2d: array must hold ${n * n} elements`);
  const h = n >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < n; x++) {
      const src = y * n + x;
      const dst = (y + h) * n + ((x + h) % n);
      const tmp = a[src]!;
      a[src] = a[dst]!;
      a[dst] = tmp;
    }
  }
}
