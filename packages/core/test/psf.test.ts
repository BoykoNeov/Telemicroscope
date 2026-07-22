import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";
import {
  psf,
  psfFromPupilFunction,
  radialProfile,
  encircledEnergy,
  Psf,
  PupilFunction,
} from "../src/wave/psf";
import { mtf, mtfProfile, mtfAt, diffractionLimitedMtf } from "../src/wave/mtf";

/**
 * Wave-layer rungs. Every one of these is a number that exists in a textbook
 * and does not depend on this engine: 1.22 λ/D, 83.8% encircled energy, the
 * Maréchal Strehl approximation, and the closed-form circular-pupil MTF.
 *
 * The system under test is a PARABOLOID at its focus — geometrically perfect,
 * so anything the PSF shows beyond a point is diffraction and nothing else.
 * It is used at NA 0.1, deliberately: the pupil→image scale identifies NA with
 * r/R, which is a paraxial identification, so the comparisons are made where
 * the neglected term is bounded rather than where it is merely convenient.
 */

const R = -200; // concave mirror facing the light; focus at R/2 = −100
const APERTURE = 10; // semi-aperture (mm) → NA = 10/100 = 0.1

function mirror(conic: number, imageOffset?: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic,
        semiAperture: APERTURE,
        thickness: R / 2,
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: APERTURE },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
    ...(imageOffset === undefined ? {} : { imageSurface: { offsetFromLastVertex: imageOffset } }),
  };
}

const GRID = { pupilSamples: 64, padFactor: 8 } as const; // 512² FFT

const NA = APERTURE / Math.abs(R / 2);

/** Radius of the k-th Airy dark ring, in image-plane mm: c·λ/(2·NA). */
function darkRingMm(c: number): number {
  return (c * LINE_D * 1e-6) / (2 * NA);
}

/**
 * First dark ring of the radial profile, to sub-pixel by parabolic fit.
 *
 * Guarded by "must be below 2% of the peak" because an azimuthal average taken
 * in one-pixel annuli ripples near the core, and an unguarded scan latches
 * onto the first ripple instead of the ring. The measurement is still
 * sampling-limited — see the convergence rung below, which is why the position
 * rung is stated as a limit rather than a fixed tolerance.
 */
function firstMinimumPixels(p: Psf): number {
  const { radius, mean } = radialProfile(p, p.size / 2);
  let peak = 0;
  for (const v of mean) if (v > peak) peak = v;

  for (let i = 1; i < mean.length - 1; i++) {
    if (mean[i]! < peak * 0.02 && mean[i]! < mean[i - 1]! && mean[i]! <= mean[i + 1]!) {
      // Vertex of the parabola through the three samples straddling the dip.
      const a = mean[i - 1]!;
      const b = mean[i]!;
      const c = mean[i + 1]!;
      const denom = a - 2 * b + c;
      const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const step = radius[1]! - radius[0]!;
      return radius[i]! + shift * step;
    }
  }
  throw new Error("no dark ring found in the radial profile");
}

describe("Airy pattern of a perfect circular pupil", () => {
  const perfect = psf(mirror(-1), 0, LINE_D, GRID);

  /**
   * Rung: the encircled-energy fractions of the Airy pattern — 83.8%, 91.0%
   * and 93.8% inside the first three dark rings at 1.220, 2.233 and 3.238
   * λ/(2·NA).
   *
   * These are the primary Airy pins, and they are stronger than locating a
   * minimum for two reasons. The radii are computed from the closed form and
   * converted to pixels through `pixelScaleMm`, so a wrong pupil→image scale
   * moves all three answers; and they are integrals over the pattern, so they
   * test its SHAPE out to three rings rather than one position. Nothing is
   * interpolated anywhere.
   *
   * They are stated as a **limit in pupil sampling**, like the dark-ring rung
   * below and for the same reason: representing a round aperture on a square
   * grid carries an O(1/N) boundary error, and cell-averaging the edge (see
   * `amplitudeGrid`) turns that into a bias that converges away instead of an
   * aliasing artifact that does not.
   *
   * This replaced a fixed 0.003 tolerance at N = 64, and it is the STRICTER
   * standard. Point-sampling the aperture passed that tolerance at every N —
   * 0.83804, 0.83806, 0.83806 at N = 64, 128, 256 — which looks like a pass and
   * is actually a diagnosis: an answer that does not move as the grid refines
   * is not a resolved one. Two errors were cancelling, the staircase edge
   * aliasing energy outward while the same staircase left the energy
   * denominator short. Edge-resolved, the sequence converges properly (0.84698,
   * 0.84235, 0.84021) and Richardson-extrapolates to 0.8378 — the analytic
   * value — which the flat sequence can never demonstrate.
   */
  const energyRungs: Array<[number, number, string]> = [
    [1.22, 0.838, "first"],
    [2.233, 0.91, "second"],
    [3.238, 0.938, "third"],
  ];
  for (const [coefficient, fraction, which] of energyRungs) {
    it(`converges to ${(fraction * 100).toFixed(1)}% of the energy inside the ${which} dark ring`, () => {
      const enclosedAt = (pupilSamples: number): number => {
        const p = psf(mirror(-1), 0, LINE_D, { pupilSamples, padFactor: 4 });
        return encircledEnergy(p, darkRingMm(coefficient) / p.pixelScaleMm);
      };
      const coarse = enclosedAt(64);
      const mid = enclosedAt(128);
      const fine = enclosedAt(256);

      // Monotone approach from above, halving each time the pupil grid doubles
      // — first-order convergence, which is what a boundary error looks like.
      expect(coarse).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(fine);
      expect(fine - fraction).toBeLessThan((mid - fraction) / 1.8);
      expect(mid - fraction).toBeLessThan((coarse - fraction) / 1.8);

      // Richardson: for an O(h) error, 2·f(h/2) − f(h) removes the leading
      // term. That extrapolate must hit the textbook fraction outright.
      expect(Math.abs(2 * fine - mid - fraction)).toBeLessThan(0.002);
    });
  }

  /**
   * Rung: the first dark ring sits at 1.22·λ/(2·NA), i.e. at
   * 1.22·size/pupilSamples pixels — one statement pinning the FFT, the
   * aperture embedding and the pixel scale together.
   *
   * Measuring it is sampling-limited: a one-pixel-wide azimuthal annulus
   * averages across a near-zero and biases the ring outward. So the rung is
   * stated the way the ladder states every approximation — as a limit. The
   * error must SHRINK with image sampling, which is what distinguishes a
   * discretization artifact from a wrong scale.
   */
  it("the first dark ring approaches 1.22·λ/(2·NA) as image sampling refines", () => {
    const expectedMm = darkRingMm(1.22);
    const errorAt = (padFactor: number): number => {
      const p = psf(mirror(-1), 0, LINE_D, { pupilSamples: 64, padFactor });
      return firstMinimumPixels(p) * p.pixelScaleMm / expectedMm - 1;
    };

    const coarse = errorAt(4);
    const fine = errorAt(16);
    expect(Math.abs(fine)).toBeLessThan(0.015);
    // 4× the image sampling cuts the bias by well over 3×; a wrong pixel scale
    // would leave a constant offset instead.
    expect(Math.abs(fine)).toBeLessThan(Math.abs(coarse) / 3);
  });

  /**
   * Rung: a circular aperture's diffraction pattern is ROTATIONALLY SYMMETRIC.
   *
   * The true azimuthal variation at any fixed radius is exactly zero — this is
   * a theorem about the transform of a disc, not a measured quantity — which
   * makes it one of the few rungs with an exact external answer. It is also the
   * rung the engine used to fail: a round aperture point-sampled on a square
   * grid is a staircase, and the staircase transforms into RADIAL SPOKES at
   * ~6·10⁻⁵ of the peak.
   *
   * That artifact is small and dangerous rather than small and harmless,
   * because of what it looks like: diffraction spikes. Spikes are a real effect
   * this engine will produce for real reasons once spiders arrive at step 5, so
   * a refractor rendering with them is the engine inventing an optical
   * component. Resolving the aperture edge (`amplitudeGrid`) is what removes
   * them; the negative control below is what proves that is why they are gone.
   *
   * Measured on an ANALYTIC pupil rather than a traced one, so nothing but the
   * aperture discretization is in the answer.
   */
  describe("a circular pupil's PSF has no preferred direction", () => {
    const analytic: PupilFunction = {
      amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
      phaseWaves: () => 0,
    };
    const scale = { referenceRadius: 100, exitRadius: 5, wavelengthNm: 550, nImage: 1 };

    const build = (pupilSamples: number, edgeSamples: number): Psf =>
      psfFromPupilFunction(analytic, scale, 0, { pupilSamples, padFactor: 4, edgeSamples });

    /** Peak-to-peak azimuthal variation at an exact radius, relative to peak. */
    const azimuthalSpread = (p: Psf, radiusPx: number): number => {
      const c = p.size / 2;
      let lo = Infinity;
      let hi = -Infinity;
      for (let a = 0; a < 1440; a++) {
        const t = (a * Math.PI) / 720;
        // Bilinear, so the probe sits at ONE radius: rounding to a pixel would
        // wander across the rings and report radial structure as azimuthal.
        const x = c + radiusPx * Math.cos(t);
        const y = c + radiusPx * Math.sin(t);
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const at = (ix: number, iy: number) => p.intensity[iy * p.size + ix]!;
        const v =
          at(x0, y0) * (1 - fx) * (1 - fy) +
          at(x0 + 1, y0) * fx * (1 - fy) +
          at(x0, y0 + 1) * (1 - fx) * fy +
          at(x0 + 1, y0 + 1) * fx * fy;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return (hi - lo) / p.peak;
    };

    const RADII = [0.25, 0.35, 0.45];

    it("is symmetric to better than 1e-5 of the peak", () => {
      const p = build(64, 4);
      for (const fraction of RADII) {
        expect(azimuthalSpread(p, fraction * p.size)).toBeLessThan(6e-6);
      }
    });

    it("point-sampling the aperture instead is several times worse", () => {
      // The negative control. Without it the rung above only says "the number
      // is small", which a broken implementation could also satisfy by being
      // uniformly wrong.
      const resolved = build(64, 4);
      const staircase = build(64, 1);
      for (const fraction of RADII) {
        expect(azimuthalSpread(staircase, fraction * staircase.size)).toBeGreaterThan(
          4 * azimuthalSpread(resolved, fraction * resolved.size),
        );
      }
    });

    it("and what remains is a discretization artifact: it halves with the grid", () => {
      const coarse = build(64, 4);
      const fine = build(128, 4);
      for (const fraction of RADII) {
        expect(azimuthalSpread(fine, fraction * fine.size)).toBeLessThan(
          azimuthalSpread(coarse, fraction * coarse.size) / 2,
        );
      }
    });
  });

  /**
   * Rung: Parseval. The PSF integrates to the transmitted pupil energy. This
   * is the obligation ARCHITECTURE places on the fidelity switch — both PSF
   * branches must carry the same energy, so the geometric branch that arrives
   * later has a fixed number to match rather than a convention to negotiate.
   */
  it("integrates to exactly the transmitted pupil energy", () => {
    let sum = 0;
    for (let i = 0; i < perfect.intensity.length; i++) sum += perfect.intensity[i]!;
    expect(sum / perfect.energy).toBeCloseTo(1, 10);
  });

  it("a geometrically perfect system has Strehl 1 and a flat pupil phase", () => {
    expect(perfect.strehl).toBeGreaterThan(0.9999);
    expect(perfect.maxGridPhaseStepWaves).toBeLessThan(1e-3);
  });

  /**
   * Padding buys image-plane SAMPLING, not physics. Measured on encircled
   * energy — an exact integral at any pad factor — this is the guard against a
   * pixel scale that quietly absorbs the pad, which would otherwise show up as
   * an Airy disc that changes size when you ask for a finer picture of it.
   */
  it("the physical Airy scale is independent of pad factor", () => {
    // Stated as agreement BETWEEN pad factors rather than against 0.838, which
    // is both the actual claim and a tighter one: the residual boundary bias is
    // set by `pupilSamples` and is held fixed here, so padding must not move
    // the answer at all — 3·10⁻³ of slack against the textbook value would have
    // hidden a real pad-dependent drift ten times smaller than itself.
    const radiusMm = darkRingMm(1.22);
    const enclosed = [4, 8, 16].map((padFactor) => {
      const p = psf(mirror(-1), 0, LINE_D, { pupilSamples: 64, padFactor });
      return encircledEnergy(p, radiusMm / p.pixelScaleMm);
    });
    for (const value of enclosed) expect(Math.abs(value - enclosed[0]!)).toBeLessThan(3e-4);
  });
});

/**
 * Rung: the extended Maréchal approximation, S ≈ exp(−(2πσ)²), with σ the RMS
 * wavefront error in waves.
 *
 * σ is taken from `OpdMap.rmsWaves` — computed by direct mean-square over the
 * traced rays, with no FFT and no Zernike fit in its history. So this compares
 * the FFT's peak against a published formula fed by an independently measured
 * number, rather than the engine against itself.
 *
 * The approximation is itself only good for small σ, which is why the
 * tolerance widens with σ and why the last assertion checks that the error
 * SHRINKS as σ does. A drifting result is answered with less aberration, never
 * a wider band.
 */
describe("Strehl ratio follows Maréchal for small wavefront error", () => {
  const cases = [
    { delta: 0.008, tol: 0.01 },
    { delta: 0.02, tol: 0.015 },
    { delta: 0.032, tol: 0.03 },
  ];

  const errors: number[] = [];
  for (const { delta, tol } of cases) {
    it(`δ = ${delta} mm of defocus`, () => {
      const system = mirror(-1, R / 2 - delta);
      const sigma = opdMap(system, 0, LINE_D, pupilGrid(21)).rmsWaves;
      const measured = psf(system, 0, LINE_D, GRID).strehl;
      const marechal = Math.exp(-((2 * Math.PI * sigma) ** 2));

      expect(sigma).toBeGreaterThan(0.01); // the test must actually aberrate
      expect(Math.abs(measured / marechal - 1)).toBeLessThan(tol);
      errors.push(Math.abs(measured / marechal - 1));
    });
  }

  it("the approximation's error shrinks as the aberration does", () => {
    expect(errors.length).toBe(3);
    expect(errors[0]!).toBeLessThan(errors[2]!);
  });
});

describe("MTF", () => {
  const perfect = psf(mirror(-1), 0, LINE_D, GRID);
  const m = mtf(perfect);
  const cutoffBins = perfect.pupilSamples;

  /**
   * Rung: the diffraction-limited MTF is the normalized overlap area of two
   * displaced circles,
   *     MTF(ν) = (2/π)·[arccos ν − ν√(1 − ν²)],
   * evaluated here against a transform of a traced system's PSF. No fitted
   * constants — the curve is the published closed form.
   */
  it("matches the closed-form circular-pupil MTF across the band", () => {
    for (const nu of [0.1, 0.2, 0.3, 0.5, 0.7, 0.85]) {
      const measured = mtfAt(m, nu, cutoffBins);
      const analytic = diffractionLimitedMtf(nu);
      expect(Math.abs(measured - analytic)).toBeLessThan(0.01);
    }
  });

  it("is 1 at zero frequency and reaches zero at the cutoff", () => {
    expect(mtfAt(m, 0, cutoffBins)).toBeCloseTo(1, 6);
    expect(mtfAt(m, 1, cutoffBins)).toBeLessThan(0.01);
    // Beyond the cutoff there is no information at all — the pupil
    // autocorrelation has run out of overlap.
    expect(mtfAt(m, 1.15, cutoffBins)).toBeLessThan(1e-6);
  });

  /**
   * The cutoff in physical units is 2·NA/λ — the Abbe form, and the same
   * quantity the microscope branch will call resolution.
   */
  it("the cutoff is 2·NA/λ in cycles per mm", () => {
    const NA = APERTURE / Math.abs(R / 2);
    const expected = (2 * NA) / (LINE_D * 1e-6);
    expect(m.cutoffCyclesPerMm / expected).toBeGreaterThan(0.99);
    expect(m.cutoffCyclesPerMm / expected).toBeLessThan(1.01);
  });

  it("the radial profile tracks the analytic curve", () => {
    const profile = mtfProfile(m, 20, cutoffBins);
    for (let i = 0; i < profile.nu.length; i++) {
      expect(Math.abs(profile.modulation[i]! - diffractionLimitedMtf(profile.nu[i]!))).toBeLessThan(
        0.03,
      );
    }
  });

  /**
   * A central obstruction redistributes contrast — it does NOT move the
   * cutoff. Textbook behaviour for obstructed apertures, and the reason a
   * Newtonian looks "softer" on planets than its aperture suggests while still
   * resolving fine detail: mid frequencies lose, high frequencies gain.
   *
   * Directional, so it is a behaviour check rather than a pinned number; the
   * number that pins the obstruction lives in the annular-aperture rung below.
   */
  it("a central obstruction cuts mid-frequency contrast and raises high", () => {
    const obstructed = mtf(psf(mirror(-1), 0, LINE_D, { ...GRID, obstruction: 0.35 }));
    expect(mtfAt(obstructed, 0.3, cutoffBins)).toBeLessThan(mtfAt(m, 0.3, cutoffBins) - 0.03);
    expect(mtfAt(obstructed, 0.85, cutoffBins)).toBeGreaterThan(mtfAt(m, 0.85, cutoffBins));
    expect(mtfAt(obstructed, 1.02, cutoffBins)).toBeLessThan(0.01);
  });

  it("aberration lowers contrast below the cutoff without extending it", () => {
    const aberrated = mtf(psf(mirror(-1, R / 2 - 0.03), 0, LINE_D, GRID));
    expect(mtfAt(aberrated, 0.4, cutoffBins)).toBeLessThan(mtfAt(m, 0.4, cutoffBins));
    expect(mtfAt(aberrated, 1.1, cutoffBins)).toBeLessThan(1e-6);
  });
});

/**
 * Rung: the ANNULAR aperture, pinned to its closed form.
 *
 * A central obstruction of relative radius ε makes the pupil an annulus, whose
 * diffraction amplitude is the difference of two Airy terms. Its first dark
 * ring therefore sits at the first root of
 *
 *     J₁(v) = ε·J₁(ε·v),        r = v·λ·R/(π·D)
 *
 * which reduces to the familiar J₁(v) = 0, v = 3.8317, r = 1.22·λ/(2·NA) when
 * ε = 0 — and the test asserts that reduction first, so the Bessel series and
 * the root finder below are themselves validated before anything leans on
 * them.
 *
 * The comparison is made as a RATIO r(ε)/r(0). Locating a dark ring by
 * azimuthal averaging carries a systematic outward bias (see the convergence
 * rung above), and measuring both radii the same way at the same sampling
 * cancels it — which is what lets this assert to 1% rather than 3%.
 *
 * This is the rung that makes `obstruction` a validated capability rather than
 * a parameter that merely behaves plausibly.
 */
describe("annular aperture: the obstructed Airy core shrinks by the amount theory says", () => {
  /** J₁ by its defining power series; ample convergence for v < 4. */
  function besselJ1(x: number): number {
    let sum = 0;
    for (let k = 0; k < 40; k++) {
      let term = 1;
      for (let i = 1; i <= k; i++) term /= i;
      for (let i = 1; i <= k + 1; i++) term /= i;
      sum += (k % 2 === 0 ? 1 : -1) * term * Math.pow(x / 2, 2 * k + 1);
    }
    return sum;
  }

  /** First root of J₁(v) − ε·J₁(εv), by bisection on a bracket known to hold it. */
  function firstAnnularRoot(eps: number): number {
    const f = (v: number) => besselJ1(v) - eps * besselJ1(eps * v);
    let lo = 1;
    let hi = 3.9;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  it("reduces to the unobstructed first zero of J₁ at ε = 0", () => {
    // 3.8317059… — the first non-trivial zero of J₁, and the origin of "1.22".
    expect(firstAnnularRoot(0)).toBeCloseTo(3.8317, 4);
    expect(firstAnnularRoot(0) / Math.PI).toBeCloseTo(1.2197, 4);
  });

  const unobstructed = firstMinimumPixels(psf(mirror(-1), 0, LINE_D, { pupilSamples: 64, padFactor: 16 }));
  const v0 = firstAnnularRoot(0);

  for (const eps of [0.25, 0.35, 0.5]) {
    it(`ε = ${eps}: the first dark ring contracts by v(ε)/v(0)`, () => {
      const p = psf(mirror(-1), 0, LINE_D, { pupilSamples: 64, padFactor: 16, obstruction: eps });
      const measured = firstMinimumPixels(p) / unobstructed;
      const predicted = firstAnnularRoot(eps) / v0;
      expect(measured / predicted).toBeGreaterThan(0.99);
      expect(measured / predicted).toBeLessThan(1.01);
      // The contraction is real, not noise: ε = 0.5 pulls the ring in ~18%.
      expect(predicted).toBeLessThan(1);
    });
  }

  it("an obstruction removes exactly the energy its area accounts for", () => {
    const open = psf(mirror(-1), 0, LINE_D, GRID);
    const eps = 0.4;
    const blocked = psf(mirror(-1), 0, LINE_D, { ...GRID, obstruction: eps });
    // Transmitted pupil energy scales as the annulus area, (1 − ε²).
    expect(blocked.energy / open.energy).toBeGreaterThan((1 - eps * eps) * 0.99);
    expect(blocked.energy / open.energy).toBeLessThan((1 - eps * eps) * 1.01);
  });
});
