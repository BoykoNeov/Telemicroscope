import { describe, it, expect } from "vitest";
import { fft1d, fft2d, fftShift2d, isPowerOfTwo } from "../src/math/fft";

/**
 * The FFT is pinned to the DEFINITION of the discrete Fourier transform —
 * analytic input/output pairs with closed-form answers — rather than to a
 * second hand-rolled DFT in the test file. Two implementations of the same
 * misunderstanding agree with each other; a delta and a cosine do not care
 * what either of them believes.
 *
 * Convention under test (see math/fft.ts):
 *     X[k] = Σ x[n]·exp(−2πi·kn/N)      x[n] = (1/N)·Σ X[k]·exp(+2πi·kn/N)
 */

const N = 64;

function zeros(n: number): { re: Float64Array; im: Float64Array } {
  return { re: new Float64Array(n), im: new Float64Array(n) };
}

describe("1-D FFT against closed-form transform pairs", () => {
  it("δ[n] transforms to a flat spectrum of ones", () => {
    const { re, im } = zeros(N);
    re[0] = 1;
    fft1d(re, im);
    for (let k = 0; k < N; k++) {
      expect(re[k]!).toBeCloseTo(1, 12);
      expect(im[k]!).toBeCloseTo(0, 12);
    }
  });

  it("a constant transforms to a single spike of height N at DC", () => {
    const { re, im } = zeros(N);
    re.fill(1);
    fft1d(re, im);
    expect(re[0]!).toBeCloseTo(N, 10);
    expect(im[0]!).toBeCloseTo(0, 10);
    for (let k = 1; k < N; k++) {
      expect(Math.hypot(re[k]!, im[k]!)).toBeLessThan(1e-10);
    }
  });

  it("cos(2πk₀n/N) transforms to N/2 at bins k₀ and N−k₀", () => {
    const k0 = 7;
    const { re, im } = zeros(N);
    for (let n = 0; n < N; n++) re[n] = Math.cos((2 * Math.PI * k0 * n) / N);
    fft1d(re, im);
    for (let k = 0; k < N; k++) {
      const expected = k === k0 || k === N - k0 ? N / 2 : 0;
      expect(Math.hypot(re[k]!, im[k]!)).toBeCloseTo(expected, 9);
    }
  });

  /**
   * The shift theorem in its bare form. This is the mechanism the wave layer
   * depends on: a linear phase ramp ACROSS THE PUPIL is wavefront tilt, and it
   * must move the PSF rather than blur it. If this pair is wrong, every
   * off-axis PSF lands in the wrong place.
   */
  it("a linear phase ramp exp(+2πik₀n/N) transforms to one spike at bin k₀", () => {
    const k0 = 11;
    const { re, im } = zeros(N);
    for (let n = 0; n < N; n++) {
      const a = (2 * Math.PI * k0 * n) / N;
      re[n] = Math.cos(a);
      im[n] = Math.sin(a);
    }
    fft1d(re, im);
    expect(Math.hypot(re[k0]!, im[k0]!)).toBeCloseTo(N, 9);
    for (let k = 0; k < N; k++) {
      if (k !== k0) expect(Math.hypot(re[k]!, im[k]!)).toBeLessThan(1e-10);
    }
  });

  /**
   * Parseval in THIS convention (the 1/N sits on the inverse). The PSF's
   * energy normalization — and therefore the promise that the fidelity switch
   * never changes image brightness — is exactly this factor.
   */
  it("satisfies Parseval: Σ|x|² = (1/N)·Σ|X|²", () => {
    const { re, im } = zeros(N);
    for (let n = 0; n < N; n++) {
      re[n] = Math.sin(0.7 * n) + 0.3 * n;
      im[n] = Math.cos(1.3 * n);
    }
    let spatial = 0;
    for (let n = 0; n < N; n++) spatial += re[n]! ** 2 + im[n]! ** 2;

    fft1d(re, im);
    let spectral = 0;
    for (let k = 0; k < N; k++) spectral += re[k]! ** 2 + im[k]! ** 2;

    expect(spectral / N).toBeCloseTo(spatial, 8);
  });

  it("inverse undoes forward", () => {
    const { re, im } = zeros(N);
    const re0 = new Float64Array(N);
    const im0 = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      re0[n] = re[n] = Math.sin(0.31 * n * n);
      im0[n] = im[n] = Math.cos(0.17 * n);
    }
    fft1d(re, im);
    fft1d(re, im, true);
    for (let n = 0; n < N; n++) {
      expect(re[n]!).toBeCloseTo(re0[n]!, 12);
      expect(im[n]!).toBeCloseTo(im0[n]!, 12);
    }
  });

  it("rejects sizes that are not powers of two", () => {
    expect(isPowerOfTwo(64)).toBe(true);
    expect(isPowerOfTwo(48)).toBe(false);
    const re = new Float64Array(48);
    const im = new Float64Array(48);
    expect(() => fft1d(re, im)).toThrow(/power of two/);
  });
});

describe("2-D FFT", () => {
  const M = 16;

  /**
   * The 2-D DFT is separable, so a separable input must transform to the outer
   * product of the two 1-D transforms — exactly, not approximately. That is
   * the property the row–column implementation claims, so it is the property
   * worth pinning.
   */
  it("a separable image transforms to the outer product of its 1-D transforms", () => {
    const g = (x: number) => Math.cos((2 * Math.PI * 3 * x) / M) + 0.4;
    const h = (y: number) => Math.sin((2 * Math.PI * 5 * y) / M) - 0.2;

    const re = new Float64Array(M * M);
    const im = new Float64Array(M * M);
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < M; x++) re[y * M + x] = g(x) * h(y);
    }
    fft2d(re, im, M);

    const gr = new Float64Array(M);
    const gi = new Float64Array(M);
    const hr = new Float64Array(M);
    const hi = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      gr[i] = g(i);
      hr[i] = h(i);
    }
    fft1d(gr, gi);
    fft1d(hr, hi);

    for (let ky = 0; ky < M; ky++) {
      for (let kx = 0; kx < M; kx++) {
        const er = gr[kx]! * hr[ky]! - gi[kx]! * hi[ky]!;
        const ei = gr[kx]! * hi[ky]! + gi[kx]! * hr[ky]!;
        expect(re[ky * M + kx]!).toBeCloseTo(er, 9);
        expect(im[ky * M + kx]!).toBeCloseTo(ei, 9);
      }
    }
  });

  it("a 2-D linear phase ramp transforms to a single spike", () => {
    const kx0 = 3;
    const ky0 = 6;
    const re = new Float64Array(M * M);
    const im = new Float64Array(M * M);
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < M; x++) {
        const a = (2 * Math.PI * (kx0 * x + ky0 * y)) / M;
        re[y * M + x] = Math.cos(a);
        im[y * M + x] = Math.sin(a);
      }
    }
    fft2d(re, im, M);
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < M; x++) {
        const mag = Math.hypot(re[y * M + x]!, im[y * M + x]!);
        if (x === kx0 && y === ky0) expect(mag).toBeCloseTo(M * M, 8);
        else expect(mag).toBeLessThan(1e-9);
      }
    }
  });

  it("round-trips, and Parseval holds in 2-D", () => {
    const re = new Float64Array(M * M);
    const im = new Float64Array(M * M);
    const re0 = new Float64Array(M * M);
    for (let i = 0; i < M * M; i++) re0[i] = re[i] = Math.sin(0.4 * i) * (1 + (i % 5));

    let spatial = 0;
    for (let i = 0; i < M * M; i++) spatial += re[i]! ** 2;

    fft2d(re, im, M);
    let spectral = 0;
    for (let i = 0; i < M * M; i++) spectral += re[i]! ** 2 + im[i]! ** 2;
    expect(spectral / (M * M)).toBeCloseTo(spatial, 8);

    fft2d(re, im, M, true);
    for (let i = 0; i < M * M; i++) expect(re[i]!).toBeCloseTo(re0[i]!, 11);
  });

  it("fftShift2d centres DC and is its own inverse", () => {
    const a = new Float64Array(M * M);
    a[0] = 1; // DC after a forward transform lives at index 0
    fftShift2d(a, M);
    expect(a[(M / 2) * M + M / 2]!).toBe(1);
    expect(a[0]!).toBe(0);
    fftShift2d(a, M);
    expect(a[0]!).toBe(1);
  });
});
