import { describe, it, expect } from "vitest";
import {
  nollIndex,
  zernike,
  fitZernike,
  evaluateFit,
  wavefrontSampler,
  fitRms,
  coefficient,
  termsThroughOrder,
} from "../src/wave/zernike";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Zernike rungs. The first group pins the basis itself to Noll (1976) — the
 * published index table and the published polynomials. The last group is the
 * one that makes this a validation rung rather than a consistency check: a
 * REAL traced wavefront of known analytic form, decomposed, with each
 * coefficient compared against the closed-form expansion of that form.
 */

// ── The basis, pinned to Noll 1976 ──────────────────────────────────────────

describe("Noll indexing matches the published table", () => {
  it("j = 1..11 map to the standard (n, m) pairs", () => {
    // Noll 1976 Table 1. m > 0 is the cosine term, m < 0 the sine term.
    const expected: Array<[number, number]> = [
      [0, 0], //  1 piston
      [1, 1], //  2 tilt x      (cos)
      [1, -1], //  3 tilt y      (sin)
      [2, 0], //  4 defocus
      [2, -2], //  5 astigmatism (sin 2θ)
      [2, 2], //  6 astigmatism (cos 2θ)
      [3, -1], //  7 coma        (sin θ)
      [3, 1], //  8 coma        (cos θ)
      [3, -3], //  9 trefoil     (sin 3θ)
      [3, 3], // 10 trefoil     (cos 3θ)
      [4, 0], // 11 primary spherical
    ];
    expected.forEach(([n, m], i) => {
      expect(nollIndex(i + 1)).toEqual({ n, m });
    });
  });

  it("the term count through radial order n is (n+1)(n+2)/2", () => {
    expect(termsThroughOrder(4)).toBe(15);
    expect(nollIndex(15).n).toBe(4);
    expect(nollIndex(16).n).toBe(5);
  });
});

describe("polynomials match the published closed forms", () => {
  const samples = [
    { px: 0, py: 0 },
    { px: 0.31, py: 0.17 },
    { px: -0.62, py: 0.44 },
    { px: 0.8, py: -0.55 },
  ];

  it("Z₄ = √3(2ρ² − 1)", () => {
    for (const s of samples) {
      const r2 = s.px * s.px + s.py * s.py;
      expect(zernike(4, s.px, s.py)).toBeCloseTo(Math.sqrt(3) * (2 * r2 - 1), 12);
    }
  });

  it("Z₈ = √8(3ρ³ − 2ρ)cos θ", () => {
    for (const s of samples) {
      const r = Math.hypot(s.px, s.py);
      const t = Math.atan2(s.py, s.px);
      const want = Math.sqrt(8) * (3 * r ** 3 - 2 * r) * Math.cos(t);
      expect(zernike(8, s.px, s.py)).toBeCloseTo(want, 12);
    }
  });

  it("Z₁₁ = √5(6ρ⁴ − 6ρ² + 1)", () => {
    for (const s of samples) {
      const r2 = s.px * s.px + s.py * s.py;
      expect(zernike(11, s.px, s.py)).toBeCloseTo(Math.sqrt(5) * (6 * r2 * r2 - 6 * r2 + 1), 12);
    }
  });
});

/**
 * Orthonormality is the property every coefficient's meaning rests on: it is
 * what makes c_j an RMS contribution and √(Σc²) the total RMS.
 *
 * The quadrature is EXACT, not merely convergent, so the assertion below is at
 * machine precision and pins the basis rather than the integrator:
 *  - radially, 8-point Gauss–Legendre integrates ∫f(ρ)ρ dρ exactly for
 *    polynomial integrands of degree ≤ 15, and Z_i·Z_j·ρ through radial order
 *    4 reaches degree 9;
 *  - azimuthally, the midpoint rule on a periodic integrand is exact for
 *    trigonometric polynomials of frequency < N, and the highest frequency
 *    here is |m_i| + |m_j| ≤ 8.
 * A midpoint rule in ρ instead leaves a ~6·10⁻⁵ error — enough to force a
 * loose tolerance that would then hide a real normalization slip.
 */
describe("the basis is orthonormal on the unit disc (Noll normalization)", () => {
  // 8-point Gauss–Legendre on [−1, 1], mapped to [0, 1].
  const GL_X = [
    -0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
    0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363,
  ];
  const GL_W = [
    0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
    0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
  ];
  const NT = 128;

  function inner(i: number, j: number): number {
    let sum = 0;
    for (let a = 0; a < GL_X.length; a++) {
      const rho = (GL_X[a]! + 1) / 2;
      const wr = GL_W[a]! / 2;
      for (let b = 0; b < NT; b++) {
        const th = (2 * Math.PI * (b + 0.5)) / NT;
        const px = rho * Math.cos(th);
        const py = rho * Math.sin(th);
        sum += wr * ((2 * Math.PI) / NT) * zernike(i, px, py) * zernike(j, px, py) * rho;
      }
    }
    // dA = ρ dρ dθ, and the Noll norm divides by the disc area π.
    return sum / Math.PI;
  }

  it("(1/π)∫∫ Z_j² dA = 1 for every term through radial order 4", () => {
    for (let j = 1; j <= 15; j++) expect(inner(j, j)).toBeCloseTo(1, 12);
  });

  it("distinct terms are orthogonal", () => {
    const pairs: Array<[number, number]> = [
      [1, 4],
      [4, 11],
      [2, 8],
      [5, 6],
      [3, 7],
      [9, 10],
      [1, 11],
    ];
    for (const [i, j] of pairs) expect(Math.abs(inner(i, j))).toBeLessThan(1e-12);
  });
});

// ── The fit ────────────────────────────────────────────────────────────────

describe("the least-squares fit inverts the basis", () => {
  const truth = new Map<number, number>([
    [1, 0.12],
    [4, -0.35],
    [6, 0.21],
    [8, 0.07],
    [11, 0.14],
  ]);
  const points = pupilGrid(25);
  const samples = points.map((p) => {
    let w = 0;
    for (const [j, c] of truth) w += c * zernike(j, p.px, p.py);
    return { px: p.px, py: p.py, waves: w };
  });

  it("recovers injected coefficients and leaves no residual", () => {
    const fit = fitZernike(samples, 15);
    for (let j = 1; j <= 15; j++) {
      expect(coefficient(fit, j)).toBeCloseTo(truth.get(j) ?? 0, 9);
    }
    expect(fit.rmsResidualWaves).toBeLessThan(1e-10);
  });

  it("fitRms is √(Σ_{j≥2} c_j²) — Parseval for an orthonormal basis", () => {
    const fit = fitZernike(samples, 15);
    let want = 0;
    for (const [j, c] of truth) if (j >= 2) want += c * c;
    expect(fitRms(fit)).toBeCloseTo(Math.sqrt(want), 9);
    // Piston is excluded by default and included on request.
    expect(fitRms(fit, { includePiston: true })).toBeCloseTo(
      Math.sqrt(want + 0.12 ** 2),
      9,
    );
  });

  it("the sampler evaluates the fit anywhere, not only where rays were traced", () => {
    const fit = fitZernike(samples, 15);
    const sample = wavefrontSampler(fit);
    // A point that is in NO traced grid cell — this is the resampling the FFT
    // grid depends on (ARCHITECTURE § Pupil sampling vs. atmospheric seeing).
    const px = 0.0137;
    const py = -0.4291;
    let want = 0;
    for (const [j, c] of truth) want += c * zernike(j, px, py);
    expect(sample(px, py)).toBeCloseTo(want, 9);
    expect(sample(px, py)).toBeCloseTo(evaluateFit(fit, px, py), 12);
  });

  it("refuses to fit more terms than it has in-pupil samples", () => {
    expect(() => fitZernike(samples.slice(0, 5), 15)).toThrow(/at least 15/);
  });
});

// ── Physics: a real traced wavefront, decomposed ────────────────────────────

const R = -200; // concave mirror facing the light; paraxial focus at R/2
const APERTURE = 10; // semi-aperture (mm) → NA = 10/100 = 0.1
const NA = APERTURE / Math.abs(R / 2);

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

/**
 * Rung: DEFOCUS ↔ Z₄, the coefficient with a known longitudinal cause.
 *
 * A beam of numerical aperture NA whose image plane is displaced by δ carries
 * W(ρ) = ½·δ·NA²·ρ². Expanding ρ² in the basis, ρ² = (Z₄/√3 + Z₁)/2, gives
 *
 *     c₄ = δ·NA² / (4√3)      (mm, then converted to waves)
 *
 * — a closed form with no fitted quantity in it. Both halves are external: the
 * wavefront comes from third-order theory (already a rung in opd.test.ts) and
 * the ρ² → Z₄ expansion from the definition of the polynomials.
 *
 * The 1% tolerance is set by the first NEGLECTED term of the NA expansion, so
 * the comparison is deliberately made at NA 0.1. A drifting ratio is answered
 * with a lower NA, never a wider band.
 */
describe("defocus lands in Z₄ with the closed-form coefficient", () => {
  for (const delta of [0.02, 0.05, 0.1]) {
    it(`δ = ${delta} mm gives c₄ = δ·NA²/(4√3)`, () => {
      // Light travels −z after the mirror, so more defocus is a more negative
      // image-plane offset.
      const map = opdMap(mirror(-1, R / 2 - delta), 0, LINE_D, pupilGrid(21));
      const fit = fitZernike(map.samples, 15);

      const expectedWaves = ((delta * NA * NA) / (4 * Math.sqrt(3)) / (LINE_D * 1e-6));

      expect(Math.abs(coefficient(fit, 4))).toBeGreaterThan(Math.abs(expectedWaves) * 0.99);
      expect(Math.abs(coefficient(fit, 4))).toBeLessThan(Math.abs(expectedWaves) * 1.01);
    });
  }

  it("pure defocus excites no other aberration", () => {
    const map = opdMap(mirror(-1, R / 2 - 0.05), 0, LINE_D, pupilGrid(21));
    const fit = fitZernike(map.samples, 15);
    const defocus = Math.abs(coefficient(fit, 4));
    for (const j of [2, 3, 5, 6, 7, 8, 9, 10]) {
      expect(Math.abs(coefficient(fit, j))).toBeLessThan(defocus * 1e-6);
    }
  });

  it("an in-focus paraboloid decomposes to nothing at all", () => {
    const map = opdMap(mirror(-1), 0, LINE_D, pupilGrid(21));
    const fit = fitZernike(map.samples, 15);
    expect(fitRms(fit)).toBeLessThan(1e-4);
    expect(fit.rmsResidualWaves).toBeLessThan(1e-4);
  });
});

/**
 * Rung: SPHERICAL ABERRATION ↔ Z₄ and Z₁₁.
 *
 * At the paraxial focus the defocus term is zero by definition, so a
 * spherically-aberrated wavefront there is W(ρ) = W₀₄₀·ρ⁴. Expanding ρ⁴,
 *
 *     ρ⁴ = Z₁₁/(6√5) + Z₄/(2√3) + (1/3)·Z₁
 *
 * so a system with primary spherical aberration MUST show
 *
 *     c₁₁ = W₀₄₀/(6√5)      c₄ = W₀₄₀/(2√3)      c₄/c₁₁ = 3√(5/3) ≈ 3.873
 *
 * That ratio is the strong rung: W₀₄₀ cancels, so it contains no aperture, no
 * focal length and no wavelength — a pure number from the expansion, the way
 * the 4/3 focus-criterion ratio is. Note that a non-zero c₄ here is NOT
 * defocus of the image plane; it is the balancing defocus that ρ⁴ contains,
 * which is exactly why best focus is not the paraxial focus.
 */
describe("spherical aberration decomposes as the ρ⁴ expansion demands", () => {
  const map = opdMap(mirror(0), 0, LINE_D, pupilGrid(31));
  const fit = fitZernike(map.samples, 15);

  it("c₄/c₁₁ = 3√(5/3), a pure number with no system parameters left in it", () => {
    const ratio = coefficient(fit, 4) / coefficient(fit, 11);
    const want = 3 * Math.sqrt(5 / 3);
    // Bounded by the fifth-order (ρ⁶) term, which at NA 0.1 is ~NA² down.
    expect(ratio).toBeGreaterThan(want * 0.99);
    expect(ratio).toBeLessThan(want * 1.01);
  });

  it("c₁₁ = W₀₄₀/(6√5), against the rim OPD that measures W₀₄₀", () => {
    const rim = map.samples.reduce((a, b) =>
      b.px * b.px + b.py * b.py > a.px * a.px + a.py * a.py ? b : a,
    );
    const centre = map.samples.reduce((a, b) =>
      b.px * b.px + b.py * b.py < a.px * a.px + a.py * a.py ? b : a,
    );
    // W(1) − W(0) = W₀₄₀ for W = W₀₄₀ρ⁴. A mirror's spherical aberration is
    // negative here, so the comparison is made as a RATIO — bounds written as
    // ±% of a signed quantity silently invert.
    const w040 = rim.waves - centre.waves;
    const ratio = coefficient(fit, 11) / (w040 / (6 * Math.sqrt(5)));
    expect(ratio).toBeGreaterThan(0.99);
    expect(ratio).toBeLessThan(1.01);
  });

  it("the fit reproduces the traced wavefront to far better than it aberrates it", () => {
    expect(fit.rmsResidualWaves).toBeLessThan(fitRms(fit) * 1e-3);
  });

  /**
   * `fitRms` and `OpdMap.rmsWaves` are the same physical quantity reached two
   * different ways, and the difference between them is worth stating because
   * it decides which one the UI should report.
   *
   * `fitRms` = √(Σc²) is an AREA average over the disc, delivered by
   * orthonormality. `map.rmsWaves` is a POINT average over whichever samples
   * of a square grid happened to land inside the disc — and which corner
   * points fall inside changes discontinuously with grid size, so it does not
   * converge smoothly. Measured across grids of 21…81 it wanders over ~0.6%
   * while the fitted value moves in the 7th decimal.
   *
   * So: they must agree to that jitter (a wrong Noll normalization would show
   * up as a factor like √3 or 2, not a fraction of a percent), and the fitted
   * value is the grid-independent one.
   */
  it("√(Σc²) is grid-independent where the raw sample RMS is not", () => {
    const values = [21, 31, 45, 61, 81].map((n) =>
      fitRms(fitZernike(opdMap(mirror(0), 0, LINE_D, pupilGrid(n)).samples, 15)),
    );
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    expect(hi - lo).toBeLessThan(1e-5);
    // ...and it agrees with the point average to that estimator's own jitter.
    expect(Math.abs(fitRms(fit) / map.rmsWaves - 1)).toBeLessThan(0.01);
  });
});
