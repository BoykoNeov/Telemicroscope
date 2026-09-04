import { describe, expect, it } from "vitest";
import {
  abbeImage,
  circleOverlapArea,
  coherentSource,
  cosineGratingObject,
  defocusedPupil,
  diskSource,
  hopkinsImage,
  idealPupil,
  phaseGratingObject,
  tccAt,
  transmissionCrossCoefficient,
  transmissionCrossCoefficientDisk,
  transmissionCrossCoefficients,
  tripleOverlapArea,
  weakObjectTransfer,
  weakObjectTransferDisk,
  weakObjectTransferFunction,
  weakPhaseTransfer,
  type Disc,
  type ObjectField,
  type Tcc,
} from "../src/illumination";
import { fft2d, fftShift2d } from "../src/math/fft";
import { diffractionLimitedMtf } from "../src/wave/mtf";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 6cr — Hopkins' transmission cross-coefficient.
 *
 * The Abbe sum with the order of summation exchanged: the source integral is
 * done first, over pairs of object frequencies, and the specimen drops out of
 * it. Everything here is either an exact identity (the two sums are one sum; the
 * kernel is Hermitian by construction; the § 6f transfers are two of its
 * entries) or a convergence in the condenser's sampling, which is § 6f.2's knob
 * and pinned the way § 6f.2 pins it — a rate and a total, not a place count.
 */

const clear = (): PupilFunction => idealPupil();

/** A purely ODD wavefront — coma's parity, and nothing else's. */
function comaticPupil(waves: number): PupilFunction {
  return {
    amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
    phaseWaves: (px, py) => waves * px * (px * px + py * py),
  };
}

/** A phase ripple at the lattice period — § 6f.9's hardest case for the guard. */
function ripplePupil(amplitude: number, cyclesPerRadius: number): PupilFunction {
  return {
    amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
    phaseWaves: (px, py) => amplitude * Math.cos(2 * Math.PI * cyclesPerRadius * Math.hypot(px, py)),
  };
}

function noisyObject(size: number, seed: number): ObjectField {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const re = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) re[i] = 1 + 0.3 * rnd();
  return { size, re, im: new Float64Array(size * size) };
}

function worstRelative(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < a.length; i++) {
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    peak = Math.max(peak, Math.abs(a[i]!));
  }
  return worst / peak;
}

/** Forty (u₁, u₂) pairs spread over the whole reachable square. */
const OFF_DIAGONAL_PAIRS: number[][] = Array.from({ length: 40 }, (_, i) => {
  const t = (i * 2.399963) % (2 * Math.PI);
  const r1 = 0.15 + 1.6 * ((i * 0.618) % 1);
  const r2 = 0.15 + 1.6 * ((i * 0.382) % 1);
  return [r1 * Math.cos(t), r1 * Math.sin(t), r2 * Math.cos(t * 1.7), r2 * Math.sin(t * 1.7)];
});

/** The same area by brute force, owing nothing to the closed form. */
function gridOverlapArea(discs: Disc[], n: number): number {
  const small = discs.reduce((p, q) => (p.r < q.r ? p : q));
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const x = small.x - small.r + (2 * small.r * (i + 0.5)) / n;
    for (let j = 0; j < n; j++) {
      const y = small.y - small.r + (2 * small.r * (j + 0.5)) / n;
      if (discs.every((d) => (x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r)) inside++;
    }
  }
  return (inside * 4 * small.r * small.r) / (n * n);
}

function worstClosedFormError(coherenceParameter: number, samples: number): number {
  const pupil = clear();
  const source = diskSource(coherenceParameter, samples);
  let worst = 0;
  for (const [u1x, u1y, u2x, u2y] of OFF_DIAGONAL_PAIRS) {
    const measured = transmissionCrossCoefficient(pupil, source, u1x!, u1y!, u2x!, u2y!);
    const closed = transmissionCrossCoefficientDisk(coherenceParameter, u1x!, u1y!, u2x!, u2y!);
    worst = Math.max(worst, Math.abs(measured.re - closed));
  }
  return worst;
}

describe("§ 6cr — the kernel is Hermitian by construction, not by tolerance", () => {
  const kernel = transmissionCrossCoefficients(defocusedPupil(0.4), diskSource(0.6, 15), {
    pupilSamples: 16,
    size: 32,
  });

  it("every entry is its transpose's exact conjugate", () => {
    const m = kernel.support;
    expect(m).toBeGreaterThan(100);
    let asymmetric = 0;
    let complexDiagonal = 0;
    let emptyDiagonal = 0;
    let complexOffDiagonal = 0;
    for (let i = 0; i < m; i++) {
      // The diagonal is Σ w·|P|², a sum of non-negative reals: exactly real, and
      // strictly positive on every bin the support contains at all.
      if (kernel.im[i * m + i] !== 0) complexDiagonal++;
      if (!(kernel.re[i * m + i]! > 0)) emptyDiagonal++;
      for (let j = 0; j < m; j++) {
        if (kernel.re[i * m + j] !== kernel.re[j * m + i]) asymmetric++;
        // Compared as a sum, because the transpose of +0 is −0 and Object.is
        // separates them: the claim is that they cancel exactly, and they do.
        if (kernel.im[i * m + j]! + kernel.im[j * m + i]! !== 0) asymmetric++;
        if (i !== j && kernel.im[i * m + j] !== 0) complexOffDiagonal++;
      }
    }
    // Counted rather than asserted per entry: a quarter of a million `expect`s
    // costs half a minute and says nothing the count does not.
    expect(asymmetric).toBe(0);
    expect(complexDiagonal).toBe(0);
    expect(emptyDiagonal).toBe(0);
    // Not vacuous: a defocused pupil makes the off-diagonal genuinely complex.
    expect(complexOffDiagonal).toBeGreaterThan(0);
  });

  it("is positive semi-definite — it is a Gram matrix over the source", () => {
    const m = kernel.support;
    let s = 20250904;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff - 0.5;
    };
    let worst = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < 20; trial++) {
      const vr = new Float64Array(m);
      const vi = new Float64Array(m);
      let norm = 0;
      for (let i = 0; i < m; i++) {
        vr[i] = rnd();
        vi[i] = rnd();
        norm += vr[i]! * vr[i]! + vi[i]! * vi[i]!;
      }
      let q = 0;
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
          const tr = kernel.re[i * m + j]!;
          const ti = kernel.im[i * m + j]!;
          // conj(v_i)·T_ij·v_j, real part (the imaginary part cancels by Hermiticity)
          const cr = vr[i]! * tr + vi[i]! * ti;
          const ci = vr[i]! * ti - vi[i]! * tr;
          q += cr * vr[j]! - ci * vi[j]!;
        }
      }
      worst = Math.min(worst, q / norm);
    }
    expect(worst).toBeGreaterThanOrEqual(0);
  });
});

describe("§ 6cr.2 — three discs, in closed form", () => {
  const S: Disc = { x: 0, y: 0, r: 0.5 };

  it("collapses to the two-disc lens when the third constrains nothing", () => {
    // Same frequency twice: the third disc is a copy of the second.
    for (const u of [0.2, 0.7, 1.3]) {
      const area = tripleOverlapArea(S, { x: -u, y: 0, r: 1 }, { x: -u, y: 0, r: 1 });
      expect(area).toBeCloseTo(circleOverlapArea(u, 0.5, 1), 12);
    }
    // A source disc swallowed whole by both pupils is its own area.
    expect(tripleOverlapArea(S, { x: 0, y: 0, r: 1 }, { x: 0.1, y: 0, r: 1 })).toBeCloseTo(
      Math.PI * 0.25,
      12,
    );
    // A lens lying wholly inside the third disc: the pair is the answer.
    expect(
      tripleOverlapArea({ x: -1.4, y: 0, r: 1 }, { x: 1.4, y: 0, r: 1 }, { x: 0, y: 0, r: 1 }),
    ).toBeCloseTo(circleOverlapArea(2.8, 1, 1), 12);
    // Disjoint anywhere is empty everywhere.
    expect(tripleOverlapArea(S, { x: -3, y: 0, r: 1 }, { x: 0, y: 0, r: 1 })).toBe(0);
  });

  it("does not depend on the order the three discs are given in", () => {
    const cases: Disc[][] = [
      [S, { x: -0.4, y: 0, r: 1 }, { x: 0.1, y: -0.2, r: 1 }],
      [{ x: 0, y: 0, r: 0.9 }, { x: -0.85, y: 0.1, r: 1 }, { x: 0.6, y: 0.7, r: 1 }],
      // A small disc clipped a little by two large ones — the major-arc case the
      // minor-segment formula gets wrong.
      [{ x: 0, y: 0, r: 0.3 }, { x: -0.9, y: 0, r: 1 }, { x: 0.9, y: 0.2, r: 1 }],
    ];
    for (const [a, b, c] of cases) {
      const ref = tripleOverlapArea(a!, b!, c!);
      expect(ref).toBeGreaterThan(0);
      for (const [x, y, z] of [
        [a, c, b],
        [b, a, c],
        [b, c, a],
        [c, a, b],
        [c, b, a],
      ]) {
        expect(tripleOverlapArea(x!, y!, z!)).toBeCloseTo(ref, 12);
      }
    }
  });

  it("agrees with a fine-grid count, including where the bounding arc is MAJOR", () => {
    // A brute-force count owes nothing to the construction, so it is what says the
    // arcs were chosen right rather than merely consistently.
    const cases: { discs: Disc[]; note: string }[] = [
      {
        discs: [
          { x: 0, y: 0, r: 0.5 },
          { x: -0.85, y: 0.1, r: 1 },
          { x: 0.6, y: 0.7, r: 1 },
        ],
        note: "a plain curvilinear triangle",
      },
      {
        // The region covers 91% of the smallest disc, so its boundary there runs
        // more than half way round: the minor-segment reading is a different
        // number, and this is the case that catches it.
        discs: [
          { x: 0, y: 0, r: 1.0860426698280696 },
          { x: -0.07873077340364958, y: 0.32226562570886014, r: 0.8862361909757537 },
          { x: 0.513619995915154, y: 0.3486557014047427, r: 1.4002151493449766 },
        ],
        note: "a major bounding arc",
      },
      {
        // Four corners, not three: the third disc misses one pair's lens
        // entirely, so that pair contributes both of its crossings.
        discs: [
          { x: 0, y: 0, r: 0.3 },
          { x: -0.9, y: 0, r: 1 },
          { x: 0.9, y: 0.2, r: 1 },
        ],
        note: "a curvilinear quadrilateral",
      },
    ];
    for (const { discs, note } of cases) {
      const closed = tripleOverlapArea(discs[0]!, discs[1]!, discs[2]!);
      expect(closed, note).toBeCloseTo(gridOverlapArea(discs, 1500), 4);
    }
    // The middle case really is past half a disc — otherwise the rung is vacuous.
    const small = cases[1]!.discs.reduce((p, q) => (p.r < q.r ? p : q));
    const coverage =
      tripleOverlapArea(cases[1]!.discs[0]!, cases[1]!.discs[1]!, cases[1]!.discs[2]!) /
      (Math.PI * small.r * small.r);
    expect(coverage).toBeGreaterThan(0.9);
  });

  it("and over a hundred and fifty random configurations, without refusing one", () => {
    // The construction throws rather than guessing when a configuration is not
    // one it describes. That is only safe if the configurations it describes are
    // the ones that occur, so this counts the refusals as well as the errors.
    let seed = 99;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let compared = 0;
    let worst = 0;
    for (let k = 0; k < 400 && compared < 150; k++) {
      const discs: Disc[] = [
        { x: 0, y: 0, r: 0.2 + 0.9 * rnd() },
        { x: (rnd() - 0.5) * 2.4, y: (rnd() - 0.5) * 2.4, r: 0.5 + rnd() },
        { x: (rnd() - 0.5) * 2.4, y: (rnd() - 0.5) * 2.4, r: 0.5 + rnd() },
      ];
      const area = tripleOverlapArea(discs[0]!, discs[1]!, discs[2]!);
      const grid = gridOverlapArea(discs, 300);
      if (grid < 1e-4 && area < 1e-4) continue;
      compared++;
      worst = Math.max(worst, Math.abs(area - grid));
    }
    expect(compared).toBe(150);
    // A 300² count over the smallest disc resolves its own boundary to about
    // this, so the bound is the grid's and not the closed form's.
    expect(worst).toBeLessThan(1e-3);
  });

  it("the on-diagonal and undiffracted slices are § 6f's own closed form", () => {
    for (const S0 of [0.25, 0.5, 0.9]) {
      for (const u of [0.15, 0.6, 1.1, 1.7]) {
        // u₁ = u₂: the kernel's diagonal.
        expect(transmissionCrossCoefficientDisk(S0, u, 0, u, 0)).toBeCloseTo(
          circleOverlapArea(u, Math.min(S0, 1), 1) / (Math.PI * S0 * S0),
          12,
        );
        // u₂ = 0: the weak-absorber transfer, which is where § 6f lives.
        expect(transmissionCrossCoefficientDisk(S0, u, 0, 0, 0)).toBeCloseTo(
          weakObjectTransferDisk(S0, u),
          12,
        );
      }
    }
  });

  it("the measured sum converges on it off the diagonal, at § 6f.2's rate", () => {
    // Nothing before this step had a closed form for u₁ ≠ u₂ ≠ 0, so this is the
    // one rung that pins the kernel's genuinely new content. It is a rim effect,
    // so it converges like § 6f.2's: fast, and not monotone doubling by doubling.
    const [n8, n16, n64, n256] = [8, 16, 64, 256].map((n) => worstClosedFormError(0.5, n));
    expect(n8!).toBeGreaterThan(3e-2);
    expect(n256!).toBeLessThan(2.5e-4);
    // 5 doublings, ~310×: an exponent near 1.65, faster than the O(1/N) a
    // discontinuous integrand guarantees, for § 6f.2's reason.
    const exponent = Math.log2(n8! / n256!) / 5;
    expect(exponent).toBeGreaterThan(1.4);
    expect(exponent).toBeLessThan(1.9);
    // It keeps falling rather than settling on a floor — which is what says the
    // closed form is the limit and not merely close to the sum.
    expect(n16!).toBeLessThan(n8!);
    expect(n64!).toBeLessThan(n16!);
    expect(n256!).toBeLessThan(n64!);
    expect(worstClosedFormError(1, 128)).toBeLessThan(2e-3);
  });
});

describe("§ 6cr.3 — the two sums are one sum", () => {
  const pupilSamples = 16;
  const source = diskSource(0.5, 15);

  const cases: { name: string; pupil: PupilFunction; object: (n: number) => ObjectField }[] = [
    {
      name: "absorption grating, unaberrated",
      pupil: clear(),
      object: (n) => cosineGratingObject({ size: n, cycles: 3, modulation: 0.6 }),
    },
    {
      // Real object × real pupil leaves every product real, so a conjugation
      // error would survive it. This case is where the conjugation is tested.
      name: "phase grating, quarter wave of defocus",
      pupil: defocusedPupil(0.25),
      object: (n) => phaseGratingObject({ size: n, cycles: 3, amplitudeRadians: 0.4 }),
    },
    {
      name: "broadband noise, comatic pupil",
      pupil: comaticPupil(0.2),
      object: (n) => noisyObject(n, 7),
    },
    {
      name: "broadband noise, a ripple at the lattice period",
      pupil: ripplePupil(0.3, pupilSamples / 4),
      object: (n) => noisyObject(n, 11),
    },
  ];

  for (const { name, pupil, object } of cases) {
    it(`Hopkins is Abbe to f64 roundoff — ${name}`, () => {
      const n = 32;
      const obj = object(n);
      const abbe = abbeImage(obj, pupil, source, { pupilSamples });
      const kernel = transmissionCrossCoefficients(pupil, source, { pupilSamples, size: n });
      const hopkins = hopkinsImage(obj, kernel);
      expect(worstRelative(abbe.intensity, hopkins.intensity)).toBeLessThan(1e-13);
      // The image of a Hermitian kernel is real, and the transform says so.
      expect(hopkins.imaginaryResidual).toBeLessThan(1e-14);
      // Both read the same pupil on the same lattices, through the same guard.
      expect(kernel.maxGridPhaseStepWaves).toBe(abbe.maxGridPhaseStepWaves);
      expect(kernel.contributingPoints).toBe(abbe.contributingPoints);
    });
  }

  it("the disagreement is roundoff, not truncation: it does not fall with the grid", () => {
    // An aliasing or a windowing error would shrink as the grid grows. This one
    // does not move, which is the signature of an exact reassociation.
    const pupil = defocusedPupil(0.3);
    const errors = [32, 64, 128].map((n) => {
      const obj = cosineGratingObject({ size: n, cycles: (3 * n) / 32, modulation: 0.8 });
      const abbe = abbeImage(obj, pupil, source, { pupilSamples });
      const kernel = transmissionCrossCoefficients(pupil, source, {
        pupilSamples,
        size: n,
        maxEntries: 1e8,
      });
      return worstRelative(abbe.intensity, hopkinsImage(obj, kernel).intensity);
    });
    for (const e of errors) expect(e).toBeLessThan(1e-13);
    expect(Math.max(...errors) / Math.min(...errors)).toBeLessThan(10);
  });

  it("the beat aliases only where the pupil's autocorrelation closes — and it must", () => {
    // The kernel is non-zero only where the two shifted pupils overlap, so its
    // support in the difference is the pupil's autocorrelation: ±pupilSamples
    // bins, closing at exactly that where the two discs go tangent. `abbeImage`
    // demands only n ≥ pupilSamples·(1 + S), so for S < 1 the grid is narrower
    // than 2·pupilSamples + 1 and the two outermost entries land ON the Nyquist
    // bin, which is its own alias.
    const kernel = transmissionCrossCoefficients(clear(), diskSource(0.5, 9), {
      pupilSamples,
      size: 32,
    });
    const wrap = countWrapping(kernel, 32);
    expect(wrap.nonZero).toBeGreaterThan(100000);
    expect(wrap.wrapped).toBe(2);
    // Each is one lattice point of the source, caught with both orders exactly on
    // the rim — the tangency, and nothing else.
    expect(wrap.largest).toBeCloseTo(1 / kernel.contributingPoints, 15);
    expect(wrap.maxDelta).toBe(pupilSamples);
    // Twice the grid and nothing wraps at all, which is what says this is the
    // grid's Nyquist and not the kernel's shape.
    const roomy = transmissionCrossCoefficients(clear(), diskSource(0.5, 9), {
      pupilSamples,
      size: 64,
      maxEntries: 1e8,
    });
    expect(countWrapping(roomy, 64).wrapped).toBe(0);
  });

  it("and the modulo is load-bearing: dropping those two costs seven orders", () => {
    // Small, but nowhere near roundoff — and `abbeImage` aliases identically,
    // which is why folding them is the agreement rather than an approximation.
    const n = 32;
    const pupil = defocusedPupil(0.3);
    const object = noisyObject(n, 5);
    const abbe = abbeImage(object, pupil, source, { pupilSamples });
    const kernel = transmissionCrossCoefficients(pupil, source, { pupilSamples, size: n });
    const folded = worstRelative(abbe.intensity, hopkinsImage(object, kernel).intensity);
    const dropped = worstRelative(abbe.intensity, imageDroppingWrapped(object, kernel));
    expect(folded).toBeLessThan(1e-13);
    expect(dropped).toBeGreaterThan(1e-9);
    expect(dropped / folded).toBeGreaterThan(1e6);
  });
});

function countWrapping(
  kernel: Tcc,
  n: number,
): { nonZero: number; wrapped: number; largest: number; maxDelta: number } {
  const half = n / 2;
  let nonZero = 0;
  let wrapped = 0;
  let largest = 0;
  let maxDelta = 0;
  for (let a = 0; a < kernel.support; a++) {
    const b1 = kernel.bins[a]!;
    const ix1 = b1 % n;
    const iy1 = (b1 - ix1) / n;
    for (let b = 0; b < kernel.support; b++) {
      const re = kernel.re[a * kernel.support + b]!;
      const im = kernel.im[a * kernel.support + b]!;
      if (re === 0 && im === 0) continue;
      nonZero++;
      const b2 = kernel.bins[b]!;
      const ix2 = b2 % n;
      const iy2 = (b2 - ix2) / n;
      const jx = ix1 - ix2 + half;
      const jy = iy1 - iy2 + half;
      if (jx < 0 || jx >= n || jy < 0 || jy >= n) {
        wrapped++;
        largest = Math.max(largest, Math.hypot(re, im));
        maxDelta = Math.max(maxDelta, Math.abs(ix1 - ix2), Math.abs(iy1 - iy2));
      }
    }
  }
  return { nonZero, wrapped, largest, maxDelta };
}

/** `hopkinsImage` with the wrapped terms thrown away instead of folded. */
function imageDroppingWrapped(object: ObjectField, kernel: Tcc): Float64Array {
  const n = kernel.size;
  const half = n / 2;
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);
  fftShift2d(specRe, n);
  fftShift2d(specIm, n);
  const hatRe = new Float64Array(n * n);
  const hatIm = new Float64Array(n * n);
  for (let a = 0; a < kernel.support; a++) {
    const b1 = kernel.bins[a]!;
    const ix1 = b1 % n;
    const iy1 = (b1 - ix1) / n;
    for (let b = 0; b < kernel.support; b++) {
      const tr = kernel.re[a * kernel.support + b]!;
      const ti = kernel.im[a * kernel.support + b]!;
      if (tr === 0 && ti === 0) continue;
      const b2 = kernel.bins[b]!;
      const ix2 = b2 % n;
      const iy2 = (b2 - ix2) / n;
      const jx = ix1 - ix2 + half;
      const jy = iy1 - iy2 + half;
      if (jx < 0 || jx >= n || jy < 0 || jy >= n) continue;
      const gr = specRe[b1]! * specRe[b2]! + specIm[b1]! * specIm[b2]!;
      const gi = specIm[b1]! * specRe[b2]! - specRe[b1]! * specIm[b2]!;
      const j = jy * n + jx;
      hatRe[j] = hatRe[j]! + gr * tr - gi * ti;
      hatIm[j] = hatIm[j]! + gr * ti + gi * tr;
    }
  }
  fftShift2d(hatRe, n);
  fftShift2d(hatIm, n);
  fft2d(hatRe, hatIm, n, true);
  const out = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = hatRe[i]! / (n * n);
  return out;
}

describe("§ 6cr.4 — two transfer curves are one complex number", () => {
  const source = diskSource(0.6, 21);

  it("§ 6f's two readouts are rebuilt bit for bit from two kernel entries", () => {
    for (const pupil of [clear(), defocusedPupil(0.25), comaticPupil(0.3)]) {
      for (const nu of [0.4, 1.0, 1.4]) {
        const plus = transmissionCrossCoefficient(pupil, source, nu, 0, 0, 0);
        const minus = transmissionCrossCoefficient(pupil, source, 0, 0, -nu, 0);
        const dc = transmissionCrossCoefficient(pupil, source, 0, 0, 0, 0).re;
        expect(Math.hypot(plus.re + minus.re, plus.im + minus.im) / (2 * dc)).toBe(
          weakObjectTransfer(pupil, source, nu),
        );
        expect(Math.hypot(plus.re - minus.re, plus.im - minus.im) / (2 * dc)).toBe(
          weakPhaseTransfer(pupil, source, nu),
        );
      }
    }
  });

  it("an EVEN pupil makes them the real and imaginary parts of TCC(ν, 0)", () => {
    for (const pupil of [clear(), defocusedPupil(0.25)]) {
      for (const nu of [0.4, 1.0]) {
        const plus = transmissionCrossCoefficient(pupil, source, nu, 0, 0, 0);
        const minus = transmissionCrossCoefficient(pupil, source, 0, 0, -nu, 0);
        // s → −s maps one onto the conjugate of the other, for any even pupil.
        expect(minus.re).toBeCloseTo(plus.re, 15);
        expect(minus.im).toBeCloseTo(-plus.im, 15);
        const wotf = weakObjectTransferFunction(pupil, source, nu);
        expect(Math.abs(wotf.re)).toBeCloseTo(weakObjectTransfer(pupil, source, nu), 15);
        expect(Math.abs(wotf.im)).toBeCloseTo(weakPhaseTransfer(pupil, source, nu), 15);
      }
    }
  });

  it("the phase null is a symmetry: a REAL pupil has a real TCC(ν, 0)", () => {
    // § 6f.5 measured this as a cancellation between two sums. Here it is one
    // number having no imaginary part, and defocus is what gives it one.
    for (const nu of [0.3, 0.8, 1.2]) {
      expect(weakObjectTransferFunction(clear(), source, nu).im).toBe(0);
      expect(Math.abs(weakObjectTransferFunction(defocusedPupil(0.25), source, nu).im)).toBeGreaterThan(
        0.1,
      );
    }
  });

  it("an ODD pupil nulls the phase transfer for a different reason — and hides a third of the kernel", () => {
    // Coma's parity, alone: s → −s maps TCC(0,−ν) onto TCC(ν,0) itself rather
    // than onto its conjugate, so the two are EQUAL and `weakPhaseTransfer` is
    // zero with the pupil nowhere near real. The kernel is not zero: its
    // imaginary part is a third of the signal, and both § 6f readouts are blind
    // to it. That is what the kernel carries and the two moduli do not.
    const pupil = comaticPupil(0.3);
    for (const nu of [0.4, 1.0]) {
      expect(weakPhaseTransfer(pupil, source, nu)).toBeLessThan(1e-15);
      const wotf = weakObjectTransferFunction(pupil, source, nu);
      expect(Math.abs(wotf.im)).toBeGreaterThan(0.3);
      // The absorber readout is then the MODULUS, not the real part, and the two
      // are different numbers.
      expect(Math.hypot(wotf.re, wotf.im)).toBeCloseTo(weakObjectTransfer(pupil, source, nu), 14);
      expect(Math.abs(Math.abs(wotf.re) - weakObjectTransfer(pupil, source, nu))).toBeGreaterThan(
        0.06,
      );
    }
  });
  it("...but it is not additive, which is the inference to refuse", () => {
    // "An odd wavefront transfers no phase" reads like a mechanism for
    // § 6ab.16's symmetrization leaving its number unchanged. The transfer is not
    // linear in the wavefront, so it is not one — a term that contributes nothing
    // alone still changes what the others do, and here it costs 4.7%.
    const evenPart = (px: number, py: number): number => 0.25 * (px * px + py * py);
    const oddPart = (px: number, py: number): number => 0.3 * px * (px * px + py * py);
    const disc = (px: number, py: number): number => (px * px + py * py <= 1 ? 1 : 0);
    const both: PupilFunction = {
      amplitude: disc,
      phaseWaves: (px, py) => evenPart(px, py) + oddPart(px, py),
    };
    const evenOnly: PupilFunction = { amplitude: disc, phaseWaves: evenPart };
    const oddOnly: PupilFunction = { amplitude: disc, phaseWaves: oddPart };
    for (const [nu, expectedEven, expectedBoth] of [
      [0.4, 0.2313, 0.2205],
      [1.0, 0.2366, 0.2235],
    ] as const) {
      expect(weakPhaseTransfer(oddOnly, source, nu)).toBeLessThan(1e-15);
      expect(weakPhaseTransfer(evenOnly, source, nu)).toBeCloseTo(expectedEven, 4);
      expect(weakPhaseTransfer(both, source, nu)).toBeCloseTo(expectedBoth, 4);
      // Below the even part's own reading, by more than the four places above.
      expect(weakPhaseTransfer(both, source, nu)).toBeLessThan(
        0.99 * weakPhaseTransfer(evenOnly, source, nu),
      );
    }
  });
});

describe("§ 6cr.5 — the two limits, as properties of the kernel", () => {
  it("a coherent source gives a rank-one kernel: every 2×2 minor vanishes", () => {
    // S → 0 leaves one direction, so TCC(u₁,u₂) = P(u₁)·P̄(u₂) — an outer product.
    // Defocus is needed for the statement to have content: an unaberrated pupil's
    // kernel is all ones, which is rank one for a duller reason.
    const kernel = transmissionCrossCoefficients(defocusedPupil(0.4), coherentSource(), {
      pupilSamples: 16,
      size: 32,
    });
    const m = kernel.support;
    const at = (i: number, j: number): { re: number; im: number } => ({
      re: kernel.re[i * m + j]!,
      im: kernel.im[i * m + j]!,
    });
    let worst = 0;
    for (let a = 0; a < 24; a++) {
      for (let b = 0; b < 24; b++) {
        for (let c = 0; c < 24; c++) {
          for (let d = 0; d < 24; d++) {
            const p = at(a, b);
            const q = at(c, d);
            const r = at(a, d);
            const s = at(c, b);
            worst = Math.max(
              worst,
              Math.abs(p.re * q.re - p.im * q.im - (r.re * s.re - r.im * s.im)),
              Math.abs(p.re * q.im + p.im * q.re - (r.re * s.im + r.im * s.re)),
            );
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it("an open source makes it translation invariant — exactly, on its own lattice", () => {
    // Once the source covers every shifted pupil, TCC depends on u₁ − u₂ alone.
    // On a lattice source that is not a limit but an identity: translating both
    // frequencies by a lattice step permutes the same terms.
    const S = 3;
    const samples = 32;
    const source = diskSource(S, samples);
    const t = (2 * S) / samples;
    for (const [u1, u2] of [
      [0.4, 0.1],
      [0.9, -0.3],
      [-0.2, 0.7],
    ]) {
      const a = transmissionCrossCoefficient(clear(), source, u1!, 0, u2!, 0);
      const b = transmissionCrossCoefficient(clear(), source, u1! + t, 0, u2! + t, 0);
      expect(b.re).toBe(a.re);
      expect(b.im).toBe(a.im);
    }
  });

  it("and that difference-only kernel is § 2b's incoherent MTF", () => {
    // Which mints no new number: the normalized TCC(ν, 0) of a wide-open
    // condenser is `diffractionLimitedMtf`, whose ν is half of this file's.
    for (const d of [0.3, 0.9, 1.4]) {
      const source = diskSource(3, 257);
      const k = transmissionCrossCoefficient(clear(), source, d, 0, 0, 0);
      const dc = transmissionCrossCoefficient(clear(), source, 0, 0, 0, 0).re;
      expect(k.re / dc).toBeCloseTo(diffractionLimitedMtf(d / 2), 2);
    }
  });
});

describe("§ 6cr.6 — what it costs, and what the cost points at", () => {
  const pupilSamples = 16;

  it("one transform per image, whatever the condenser's sampling", () => {
    const source = diskSource(0.5, 15);
    const pupil = defocusedPupil(0.2);
    const n = 32;
    const object = noisyObject(n, 3);
    const abbe = abbeImage(object, pupil, source, { pupilSamples });
    const kernel = transmissionCrossCoefficients(pupil, source, { pupilSamples, size: n });
    // Abbe pays one inverse transform per contributing direction, per object.
    // Hopkins pays one, and the kernel is object-independent — so the saving is
    // exactly that integer, and it is stated as one rather than as a clock.
    expect(abbe.contributingPoints).toBe(177);
    expect(kernel.contributingPoints).toBe(177);
    // Both read the pupil once over each direction's box.
    expect(kernel.pupilEvaluations).toBe(abbe.pupilEvaluations);
    // A three-line object touches only the entries its spectrum has; a broadband
    // one touches the whole kernel, and that is the honest bilinear cost.
    const grating = cosineGratingObject({ size: n, cycles: 3, modulation: 0.6 });
    expect(hopkinsImage(grating, kernel).kernelTerms).toBeLessThan(1000);
    expect(hopkinsImage(object, kernel).kernelTerms).toBeGreaterThan(
      0.7 * kernel.support * kernel.support,
    );
  });

  it("memory grows as the FOURTH power of the pupil sampling", () => {
    const measured = ([16, 32] as const).map((ps) => {
      const n = ps === 16 ? 32 : 64;
      return transmissionCrossCoefficients(clear(), diskSource(0.5, 9), {
        pupilSamples: ps,
        size: n,
        maxEntries: 1e9,
      });
    });
    const [small, large] = measured;
    expect(small!.support).toBe(437);
    expect(large!.support).toBe(1781);
    // (π/4)·(1+S)²·pupilSamples² is the count of lattice points inside a disc of
    // radius (1+S)·pupilSamples/2 — a lattice count, so it is approached rather
    // than hit.
    const predicted = (ps: number): number => (Math.PI / 4) * 1.5 * 1.5 * ps * ps;
    expect(small!.support / predicted(16)).toBeCloseTo(1, 1);
    expect(large!.support / predicted(32)).toBeCloseTo(1, 1);
    // Doubling the pupil sampling multiplied the kernel by ~16.
    expect(large!.entries / small!.entries).toBeGreaterThan(14);
    expect(large!.entries / small!.entries).toBeLessThan(18);
    expect(small!.bytes / 1048576).toBeCloseTo(2.9, 1);
    expect(large!.bytes / 1048576).toBeCloseTo(48.4, 1);
  });

  it("and past its cap it throws, naming what would fix it", () => {
    expect(() =>
      transmissionCrossCoefficients(clear(), diskSource(0.5, 9), {
        pupilSamples: 16,
        size: 32,
        maxEntries: 1000,
      }),
    ).toThrow(/190969 entries.*past the 1000 cap.*decomposition/s);
    // A grid too small for the shifted pupil throws the same way `abbeImage`
    // does, and through the same code.
    expect(() =>
      transmissionCrossCoefficients(clear(), diskSource(0.9, 9), {
        pupilSamples: 16,
        size: 16,
      }),
    ).toThrow(/runs off a 16-bin frequency grid/);
  });
});

/** Both spellings of the kernel, for the bridge below. */
function latticeAndDirect(pupil: PupilFunction, u: number): { lattice: number; direct: number } {
  const source = diskSource(0.5, 15);
  const kernel: Tcc = transmissionCrossCoefficients(pupil, source, {
    pupilSamples: 16,
    size: 32,
  });
  return {
    lattice: tccAt(kernel, u, 0, 0, 0).re,
    direct: transmissionCrossCoefficient(pupil, source, u, 0, 0, 0).re,
  };
}

describe("§ 6cr — the lattice kernel and the direct sum are the same kernel", () => {
  it("an entry read off the grid is the sum evaluated at that frequency", () => {
    for (const pupil of [clear(), defocusedPupil(0.3)]) {
      for (const u of [0.25, 0.75, 1.25]) {
        const { lattice, direct } = latticeAndDirect(pupil, u);
        expect(lattice).toBeCloseTo(direct, 14);
      }
    }
  });
});
