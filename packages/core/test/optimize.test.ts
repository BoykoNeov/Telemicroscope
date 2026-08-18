import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { asCompiled } from "../src/trace/compile";
import { registerMedium, getMedium } from "../src/materials/catalog";
import { constantIndex, abbeNumber, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import { seidelSums } from "../src/analysis/seidel";
import { systemProperties } from "../src/trace/paraxial";
import {
  dampedLeastSquares,
  meritResponse,
  optimizePrescription,
  optimizeSystem,
  systemResponse,
  variableResponse,
  withVariables,
  type DlsOptions,
  type DlsResult,
  type HeldOperand,
  type OptimizeOperand,
  type TracedFocus,
  type TracedOperand,
} from "../src/analysis/optimize";
import { exitBundle, spotAt, bestSpotZ } from "../src/analysis/spot";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, fitRms, balancedRms, coefficient, zernike } from "../src/wave/zernike";
import { pupilGrid, type PupilPoint } from "../src/pupil/aiming";
import { psf } from "../src/wave/psf";
import { mtf, mtfAt, mtfSections, diffractionLimitedMtf } from "../src/wave/mtf";
import { pupils, imagePlaneZ } from "../src/pupil/pupils";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * Step 1.8 — damped least squares, design mode's second half.
 *
 * § 1.7 pinned a solve: one variable, one target, a root. This pins a
 * MINIMISATION over several variables at once, and it is the harder thing to
 * validate, because an optimiser can always report that it converged. The hard
 * rule says a rung must assert a number from outside the engine, so this file
 * is built entirely around merits whose minimiser is known in closed form.
 *
 * **The two external numbers.**
 *
 *  1. **Coddington's best form.** The third-order spherical aberration of a thin
 *     lens in air is a parabola in the shape factor q with its minimum at
 *
 *         q* = 2(n²−1)/(n+2)                [Jenkins & White; Hecht § 6.3]
 *
 *     — 0.714285… at n = 1.5, 1.021621… at n = 1.7. § 5j.1 already pins the
 *     polynomial this is the minimum OF, evaluated. What is pinned here is a
 *     different claim: an optimiser that has never heard of the polynomial, fed
 *     nothing but W₀₄₀ values from `analysis/seidel`, RECOVERS its minimiser.
 *     The residual at that minimum is not zero and cannot be — a singlet's
 *     spherical aberration has a strictly positive floor — so this fixture
 *     exercises the mode that separates least squares from a root find.
 *
 *  2. **The achromat's power split.** For two thin elements in contact the
 *     total power and the achromatic condition give
 *
 *         φ₁ = φ·V₁/(V₁−V₂),   φ₂ = −φ·V₂/(V₁−V₂)      [§ 5j.2's closed form]
 *
 *     and — this is the part that has to be checked rather than assumed — BOTH
 *     residuals reach exactly zero there, in f64, on a two-element prescription
 *     of zero thickness. Verified below before anything is optimised, because a
 *     fixture whose "exact" answer is only exact to O(t/f) would be pinning the
 *     thickness, not the optimiser.
 *
 * **Why the two tolerances in the Coddington rung differ by seven orders of
 * magnitude, and why that is the honest way round.** Near a minimum the merit is
 * quadratic: m(q) ≈ m* + ½m″·(q−q*)². An optimiser that resolves the merit to a
 * relative ε therefore resolves q only to √(2ε·m* / m″) — the square root is not a
 * weakness of this implementation, it is the shape of a minimum. Measured on
 * this fixture: q lands within 2.2e-8 of the closed form, while W₀₄₀ there is
 * within 5e-16 — the f64 floor — of W₀₄₀ at the closed form. So the LOCATION is
 * pinned loosely and the VALUE tightly, and the same pattern is pinned first on
 * a fixture where every quantity is exact algebra (the weighted mean, below):
 * merit exactly right to 17 digits, location out at 3e-10.
 *
 * **Weights.** The merit is Σ(wᵢ·(vᵢ−tᵢ))², and where the residuals do not all
 * vanish the answer DEPENDS on the weights — no external number can pin an
 * optimum whose position is a caller's exchange rate between millimetres and
 * diopters. Both headline fixtures are weight-independent by construction (one
 * operand; or all residuals zero at once), which is checked here rather than
 * assumed, and a third rung measures how far a genuinely over-determined answer
 * moves when the weighting does.
 *
 * SCOPE: paraxial and third-order operands, plus — since § 1.8.5, at the bottom
 * of this file — the traced RMS spot, through `optimizeSystem`. It is the same
 * optimiser with a more expensive residual: measured 430× a third-order sum on
 * a 149-ray pupil, and linear in the ray count, not the four orders of magnitude
 * this file and two documents used to forecast. § 1.8.7 adds the WAVEFRONT:
 * an RMS over the fitted map, a balanced RMS, and a named Zernike coefficient
 * with a target of its own — 4.1× the traced spot on the same rays. § 1.8.8
 * adds the MTF at a stated frequency: the one operand with a transform between
 * the design and the residual, ~7 000× a third-order sum, and the only merit
 * here that is not safe to hand an optimiser on its own.
 */

registerMedium(constantIndex("DLS-N15", 1.5));
registerMedium(constantIndex("DLS-N17", 1.7));

const F = 1000;
const D = 100;
const H = D / 2;

/**
 * A thin lens at Coddington shape factor q, two surfaces 1 nm apart — the same
 * fixture § 5j.1 pins the closed form on, and thin for the same reason: the
 * published polynomial is a thin-lens result, and a real thickness is a
 * different (and correctly different) minimiser.
 */
function thinLens(n: number, q: number, medium: string): Prescription {
  const dc = 1 / ((n - 1) * F);
  const c1 = (dc * (q + 1)) / 2;
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: D / 2, thickness: 1e-6, medium, isStop: true },
      { kind: "refract", curvature: c1 - dc, semiAperture: D / 2, thickness: F, medium: "AIR" },
    ],
  };
}

/** The published bracket, object at infinity (p = −1). */
const bracket = (n: number, q: number): number =>
  ((n + 2) / (n - 1)) * q * q - 4 * (n + 1) * q + (3 * n + 2) * (n - 1) + n ** 3 / (n - 1);
/** The published W₀₄₀ itself, absolute scale included. */
const predictedW040 = (n: number, q: number): number =>
  (H ** 4 / (32 * F ** 3 * n * (n - 1))) * bracket(n, q);
/** What the engine says, which is all the optimiser is ever given. */
const w040 = (n: number, medium: string, q: number): number =>
  seidelSums(thinLens(n, q, medium), LINE_D, { marginalHeightMm: H }).w040;

const INDICES = [
  [1.5, "DLS-N15"],
  [1.7, "DLS-N17"],
] as const;
const qStar = (n: number): number => (2 * (n * n - 1)) / (n + 2);

describe("DLS — the arithmetic anchor: a merit whose minimiser is algebra", () => {
  it("finds the weighted mean, exactly, and misses its LOCATION by the square root of that", () => {
    // min (x−1)² + (x−3)² is the mean, 2, with merit exactly 2. Nothing optical
    // here on purpose: it fixes the meaning of "merit" and of "weight" against
    // arithmetic before either is used on a lens.
    const flat = dampedLeastSquares((x) => [x[0]! - 1, x[0]! - 3], [10]);
    expect(flat.merit).toBe(2);
    expect(flat.x[0]!).toBeCloseTo(2, 8);
    // …and the location is out at ~3e-10 while the merit is exact to the last
    // bit. That is the quadratic-minimum square root, measured on a fixture with
    // no physics in it, and it is why the Coddington rung pins the value tightly
    // and the shape loosely.
    expect(Math.abs(flat.x[0]! - 2)).toBeGreaterThan(1e-12);
    expect(Math.abs(flat.x[0]! - 2)).toBeLessThan(1e-8);

    // Weighted 1:3 the answer is (1·1 + 9·3)/10 = 2.8 — the weights enter
    // squared, which is the whole content of "weight multiplies the residual".
    const weighted = dampedLeastSquares((x) => [x[0]! - 1, 3 * (x[0]! - 3)], [10]);
    expect(weighted.x[0]!).toBeCloseTo(2.8, 8);
  });
});

describe("DLS — Coddington's best form, recovered rather than evaluated", () => {
  it("lands on q* = 2(n²−1)/(n+2) from three starts, at two indices, in both schemes", () => {
    for (const [n, medium] of INDICES) {
      const q = qStar(n);
      const best = w040(n, medium, q);
      for (const scheme of ["central", "forward"] as const) {
        for (const q0 of [-1, 0, 2]) {
          const r = dampedLeastSquares((x) => [w040(n, medium, x[0]!)], [q0], { jacobian: scheme });
          // The LOCATION, loosely — √ of the merit precision. Measured worst
          // case over these twelve runs: 2.2e-8.
          expect(r.x[0]!).toBeCloseTo(q, 7);
          // The VALUE, tightly: the merit at the optimiser's shape is the merit
          // at the closed-form shape to the f64 floor. Worst case measured 4.4e-16.
          expect(w040(n, medium, r.x[0]!) / best).toBeCloseTo(1, 15);
        }
      }
    }
  });

  it("and that value is the published one — same 1e-8 the closed form is pinned at", () => {
    for (const [n, medium] of INDICES) {
      const r = dampedLeastSquares((x) => [w040(n, medium, x[0]!)], [0]);
      // Against Jenkins & White's polynomial evaluated at its own minimum. The
      // residual is the honest 1 nm thick-lens correction § 5j.1 measures
      // (5.2e-10 at n = 1.5, 2.6e-10 at n = 1.7), not an optimiser error.
      expect(w040(n, medium, r.x[0]!) / predictedW040(n, qStar(n))).toBeCloseTo(1, 8);
    }
  });

  it("is a genuine minimum with a POSITIVE floor — a root find has nothing to find here", () => {
    const r = dampedLeastSquares((x) => [w040(1.5, "DLS-N15", x[0]!)], [0]);
    const best = w040(1.5, "DLS-N15", r.x[0]!);
    // ~1.67e-3 mm of W₀₄₀ survives at the best shape: the residual the merit
    // settles on is nowhere near zero, which is the mode that separates this
    // module from § 1.7's.
    expect(best).toBeGreaterThan(1e-3);
    expect(r.merit).toBeCloseTo(best * best, 20);
    for (const dq of [-0.4, -0.01, 0.01, 0.4]) {
      expect(w040(1.5, "DLS-N15", r.x[0]! + dq)).toBeGreaterThan(best);
    }
  });

  it("UNDAMPED Gauss–Newton cannot do it — the damping is the method, not a safety net", () => {
    // δ = −r/J solves r = 0, and r has no zero. Near the best shape J → 0 while
    // r does not, so the step blows up and the iterate wanders. Twelve steps,
    // written out here rather than reached for through an option, because the
    // module does not offer an undamped mode.
    const n = 1.5;
    const h = 1e-5;
    let q = 0;
    let closest = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 12; k++) {
      const r = w040(n, "DLS-N15", q);
      const j = (w040(n, "DLS-N15", q + h) - w040(n, "DLS-N15", q - h)) / (2 * h);
      q = q - r / j;
      closest = Math.min(closest, Math.abs(q - qStar(n)));
    }
    // Not one of the twelve iterates comes within 7% of the shape (measured
    // closest approach 0.073, and the twelfth iterate is at 3.34 — 4.7× q*),
    // while the damped run from the same start is at 6e-9.
    expect(closest).toBeGreaterThan(0.05);
    const damped = dampedLeastSquares((x) => [w040(n, "DLS-N15", x[0]!)], [0]);
    expect(Math.abs(damped.x[0]! - qStar(n))).toBeLessThan(1e-7);
  });

  it("stops on the merit or the step, never on the gradient — a single operand has no cosine", () => {
    // The gradient test measures the ANGLE between the residual vector and each
    // Jacobian column. With one operand there is nothing for it to be orthogonal
    // to: the cosine is identically 1 until the residual is zero, which here it
    // never is. Pinned so the tolerance is not "fixed" later by someone reading
    // a gradient of 1 as a failure to converge.
    const r = dampedLeastSquares((x) => [w040(1.5, "DLS-N15", x[0]!)], [0]);
    expect(r.gradient).toBe(1);
    expect(["merit", "step"]).toContain(r.reason);
  });
});

const CROWN = "N-BK7";
const FLINT = "F2";
const nCrown = getMedium(CROWN).n(LINE_D);
const nFlint = getMedium(FLINT).n(LINE_D);
const vCrown = abbeNumber(getMedium(CROWN));
const vFlint = abbeNumber(getMedium(FLINT));
/** The cemented face, held fixed: the split is about the two outer curvatures. */
const C_MID = -1 / 60;

function doublet(c1: number, c2: number, c3: number, t1 = 0, t2 = 0): Prescription {
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: 25, thickness: t1, medium: CROWN, isStop: true },
      { kind: "refract", curvature: c2, semiAperture: 25, thickness: t2, medium: FLINT },
      { kind: "refract", curvature: c3, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };
}

const PHI = 1 / 100;
const PHI_CROWN = (PHI * vCrown) / (vCrown - vFlint);
const PHI_FLINT = (-PHI * vFlint) / (vCrown - vFlint);
const C1_STAR = C_MID + PHI_CROWN / (nCrown - 1);
const C3_STAR = C_MID - PHI_FLINT / (nFlint - 1);
const SPLIT_VARS: SolveVariable[] = [
  { kind: "curvature", surface: 0 },
  { kind: "curvature", surface: 2 },
];
/** The two curvatures of a singlet — § 1.8.9's exactly degenerate pair. */
const SINGLET_VARS: SolveVariable[] = [
  { kind: "curvature", surface: 0 },
  { kind: "curvature", surface: 1 },
];
const SPLIT_OPERANDS = [
  { kind: "power", wavelengthNm: LINE_D, target: PHI },
  { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0 },
] as const;

describe("DLS — the achromat's crown/flint power split", () => {
  it("FIXTURE CHECK: the closed form is exact here, so the rung pins the optimiser", () => {
    // Both residuals at the textbook split, on the zero-thickness doublet.
    // If either were merely small the rung would be measuring the thickness.
    const exact = doublet(C1_STAR, C_MID, C3_STAR);
    const power = (l: number): number => 1 / systemProperties(exact, l).efl;
    expect(power(LINE_D) - PHI).toBe(0);
    expect(Math.abs(power(LINE_F) - power(LINE_C))).toBeLessThan(1e-17);
  });

  it("recovers φ₁ = φ·V₁/(V₁−V₂) from three starts, to 1e-12", () => {
    for (const [s1, s3] of [[0.01, -0.01], [0.02, 0.005], [0, 0]] as const) {
      const start = doublet(s1, C_MID, s3);
      const r = optimizePrescription(start, SPLIT_VARS, [...SPLIT_OPERANDS]);
      // Both residuals reach zero, so this one is quadratically convergent and
      // the curvatures land on the ulp: measured worst case 1e-13 relative.
      expect(r.x[0]! / C1_STAR).toBeCloseTo(1, 12);
      expect(r.x[1]! / C3_STAR).toBeCloseTo(1, 12);
      // Said in the currency the closed form is written in:
      expect(((nCrown - 1) * (r.x[0]! - C_MID)) / PHI_CROWN).toBeCloseTo(1, 12);
      expect(((nFlint - 1) * (C_MID - r.x[1]!)) / PHI_FLINT).toBeCloseTo(1, 12);
      expect(r.merit).toBeLessThan(1e-30);
      const built = withVariables(start, SPLIT_VARS, r.x);
      expect(systemProperties(built, LINE_D).efl).toBeCloseTo(100, 9);
    }
  });

  it("and the answer does not depend on the weighting — which is why it can be a pin", () => {
    // A zero-residual optimum is where every operand is satisfied at once, so
    // any positive exchange rate between them gives the same lens. Six orders of
    // magnitude of weight move the crown curvature by 5.2e-14 relative — and
    // that residue is stopping noise rather than an effect of the weighting,
    // which the merit says directly: every run ends with BOTH operands satisfied
    // to the f64 floor, so all three are the same zero-residual point approached
    // from three different λ histories. The contrast is the over-determined rung
    // below, where no such point exists and a smaller weight range moves the
    // answer by 4.6e-3. The bound here is set above the noise, not on it.
    const values = [1e-3, 1, 1e3].map((weight) => {
      const start = doublet(0.01, C_MID, -0.01);
      const r = optimizePrescription(start, SPLIT_VARS, [
        { kind: "power", wavelengthNm: LINE_D, target: PHI },
        { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0, weight },
      ]);
      // Both operands satisfied at the f64 floor, weights divided back out and
      // measured against the power target so the bound carries no units: 2.3e-15
      // on the power (about ten ulp of 1/100 mm) and 1.7e-16 on the colour. That
      // is what makes all three runs the same point rather than three
      // compromises that happen to be close.
      expect(Math.abs(r.residuals[0]!) / PHI).toBeLessThan(1e-13);
      expect(Math.abs(r.residuals[1]! / weight) / PHI).toBeLessThan(1e-13);
      return r.x[0]!;
    });
    for (const v of values) expect(v / values[0]!).toBeCloseTo(1, 11);
  });

  it("THICKNESS: on a 10/6 mm doublet the same merit picks a 10% different lens", () => {
    // Why the pin is thin, and — the same point § 5j.2 makes about not solving
    // the split numerically — why the closed form is a PREDICTION about a real
    // lens rather than a recipe for one. At the textbook split the thick lens is
    // 5.6% off in power and its F and C are 2.9e-5 /mm apart.
    const atSplit = doublet(C1_STAR, C_MID, C3_STAR, 10, 6);
    const p = (l: number): number => 1 / systemProperties(atSplit, l).efl;
    expect(Math.abs(p(LINE_D) - PHI) / PHI).toBeGreaterThan(0.05);
    expect(Math.abs(p(LINE_F) - p(LINE_C))).toBeGreaterThan(1e-5);

    const start = doublet(0.01, C_MID, -0.01, 10, 6);
    const r = optimizePrescription(start, SPLIT_VARS, [...SPLIT_OPERANDS]);
    expect(r.merit).toBeLessThan(1e-30); // it solves the THICK problem exactly…
    expect(Math.abs(r.x[0]! / C1_STAR - 1)).toBeGreaterThan(0.1); // …somewhere else
  });
});

describe("DLS — the currency a design question is asked in", () => {
  // § 1.7 found that an EFL target hides a pole a bisection converges onto, and
  // solves power instead. One level up the same choice has teeth: least squares
  // does not cross a barrier at all, it walks away from one.
  const START = doublet(0.002, C_MID, 0.02, 4, 3);
  const VARS: SolveVariable[] = [{ kind: "curvature", surface: 2 }];

  it("starts at −76.5 mm and is asked for +150 mm, with afocal in between", () => {
    expect(systemProperties(START, LINE_D).efl).toBeCloseTo(-76.540084, 5);

    const inPower = optimizePrescription(START, VARS, [
      { kind: "power", wavelengthNm: LINE_D, target: 1 / 150 },
    ]);
    const built = withVariables(START, VARS, inPower.x);
    expect(systemProperties(built, LINE_D).efl).toBeCloseTo(150, 7);
    expect(inPower.iterations).toBeLessThan(10);

    // The same question in millimetres of focal length. 1/f runs to ±∞ between
    // the start and the target, so the merit has a barrier of infinite height
    // there — and a downhill method never reaches it. It slides the other way,
    // to EFL → 0, and reports the GRADIENT test satisfied while sitting 150 mm
    // from what was asked for.
    const inEfl = optimizePrescription(START, VARS, [
      { kind: "efl", wavelengthNm: LINE_D, target: 150 },
    ]);
    expect(inEfl.reason).toBe("gradient");
    expect(inEfl.merit).toBeGreaterThan(2e4);
    expect(Math.abs(inEfl.residuals[0]!)).toBeCloseTo(150, 3);
  });

  it("…and it never so much as touches the wall it failed to cross", () => {
    // Worth pinning because the intuition is wrong: the afocal configuration
    // throws, and one expects a rejected step. Nothing is rejected. The wall is
    // uphill, so the optimiser is never there to be caught by it — the whole
    // failure is a barrier, not an exception.
    let walls = 0;
    const residuals = (x: readonly number[]): readonly number[] => {
      const p = withVariables(START, VARS, x);
      try {
        return [systemProperties(p, LINE_D).efl - 400];
      } catch (e) {
        walls++;
        throw e;
      }
    };
    const r = dampedLeastSquares(residuals, [0.02]);
    expect(walls).toBe(0);
    expect(r.rejected).toBe(0);
    expect(r.reason).toBe("gradient");
    expect(r.merit).toBeGreaterThan(1e5);
  });
});

describe("DLS — walls, and what a domain edge does to a minimisation", () => {
  it("differences on one side when the other is not a system", () => {
    // r = x−2 with the domain ending at 2: the optimum IS the edge. The forward
    // half of every central stencil throws; the run continues backwards and
    // lands on the boundary to 3e-15.
    let walls = 0;
    const halfPlane = (x: readonly number[]): readonly number[] => {
      if (x[0]! > 2) {
        walls++;
        throw new Error("not a system");
      }
      return [x[0]! - 2];
    };
    const r = dampedLeastSquares(halfPlane, [0]);
    expect(walls).toBeGreaterThan(0);
    expect(r.x[0]!).toBeCloseTo(2, 12);
    expect(r.x[0]!).toBeLessThanOrEqual(2);
  });

  it("walks to the boundary when the target is outside the domain, and says how it stopped", () => {
    // Root at 2, domain ends at 1.5. Every step that reaches for the answer is a
    // wall, so the damping climbs (to ~8e13) and shortens the steps until they
    // fit inside the domain. The answer is the closest legal lens, with a merit
    // that says plainly it is not the target.
    const walled = (x: readonly number[]): readonly number[] => {
      if (x[0]! > 1.5) throw new Error("not a system");
      return [x[0]! - 2];
    };
    const r = dampedLeastSquares(walled, [0]);
    expect(r.x[0]!).toBeCloseTo(1.5, 10);
    expect(r.merit).toBeCloseTo(0.25, 10);
    expect(r.rejected).toBeGreaterThan(10);
    expect(r.damping).toBeGreaterThan(1e6);
  });

  it("refuses a starting point that is not a system, rather than damping away from nothing", () => {
    const holed = (x: readonly number[]): readonly number[] => {
      if (x[0]! > 0.5 && x[0]! < 1.5) throw new Error("not a system");
      return [x[0]! - 3];
    };
    expect(() => dampedLeastSquares(holed, [1])).toThrow(/not a system/);
    // A non-finite residual is the same statement made without an exception.
    expect(() => dampedLeastSquares((x) => [Math.sqrt(x[0]!) - 2], [-1])).toThrow(/not a system/);
    expect(dampedLeastSquares((x) => [Math.sqrt(x[0]!) - 2], [1]).x[0]!).toBeCloseTo(4, 9);
  });
});

describe("DLS — the damping's other two jobs", () => {
  it("Marquardt's scaling beats plain λI on a badly scaled pair, same answer", () => {
    // One curvature (1e-2 /mm) and one thickness (mm) against power and back
    // focus: the two columns of J differ by orders of magnitude, which is what
    // scaling the damping per variable exists for.
    const run = (scaling: "marquardt" | "levenberg") => {
      const start = doublet(0.02, C_MID, -0.005, 4, 3);
      return optimizePrescription(
        start,
        [
          { kind: "curvature", surface: 0 },
          { kind: "thickness", surface: 0 },
        ],
        [
          { kind: "power", wavelengthNm: LINE_D, target: 1 / 100 },
          { kind: "bfd", wavelengthNm: LINE_D, target: 95, weight: 1e-3 },
        ],
        { scaling },
      );
    };
    const m = run("marquardt");
    const l = run("levenberg");
    expect(m.x[0]!).toBeCloseTo(l.x[0]!, 8);
    expect(m.x[1]!).toBeCloseTo(l.x[1]!, 6);
    // Measured 8 iterations against 21 — and the unit-blind default would have
    // been the slow one.
    expect(l.iterations).toBeGreaterThan(2 * m.iterations);
  });

  it("a variable the merit cannot see stays exactly where it started", () => {
    // The last surface's thickness moves the back focus and nothing else, so
    // against power and colour its Jacobian column is identically zero. The
    // damped step leaves it alone; an undamped normal-equation solve would have
    // divided by zero.
    const start = doublet(0.01, C_MID, -0.01);
    const vars: SolveVariable[] = [...SPLIT_VARS, { kind: "thickness", surface: 2 }];
    const r = optimizePrescription(start, vars, [...SPLIT_OPERANDS]);
    expect(r.x[2]!).toBe(100);
    expect(r.x[0]! / C1_STAR).toBeCloseTo(1, 12);
    expect(Number.isFinite(r.merit)).toBe(true);
  });

  it("a merit no variable can move reports the gradient test at once — and its residuals say why", () => {
    const island = (x: readonly number[]): readonly number[] => {
      if (x[0]! !== 1) throw new Error("not a system");
      return [7];
    };
    const r = dampedLeastSquares(island, [1]);
    expect(r.reason).toBe("gradient");
    expect(r.iterations).toBe(1);
    expect(r.residuals[0]).toBe(7); // "converged" is not "arrived"
  });
});

describe("DLS — multiplicity, which least squares does not report", () => {
  it("finds BOTH S_I-null bendings of a real thick doublet, one per starting basin", () => {
    // Three curvatures, three wishes: hold the power, hold the colour, null the
    // third-order spherical aberration. § 5j.2 solves this in closed form and
    // finds exactly TWO bendings; § 1.7's solver would have reported both in one
    // call, because a scan sees the whole interval. An optimiser reports the
    // basin it started in and says nothing about the other — which is not a
    // defect to fix, it is what a descent method is.
    const vars: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
      { kind: "curvature", surface: 2 },
    ];
    const operands = [
      { kind: "power", wavelengthNm: LINE_D, target: 1 / 500, weight: 1e4 },
      { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0, weight: 1e4 },
      { kind: "seidelS1", wavelengthNm: LINE_D, marginalHeightMm: 25, target: 0, weight: 1 },
    ] as const;
    const found = ([
      [1 / 60, -1 / 60, -1 / 400],
      [1 / 300, -1 / 200, 1 / 300],
      [1 / 150, -1 / 500, -1 / 150],
    ] as const).map(([a, b, c]) => {
      const start = doublet(a, b, c, 10, 6);
      const r = optimizePrescription(start, vars, [...operands]);
      const built = withVariables(start, vars, r.x);
      const s = seidelSums(built, LINE_D, { marginalHeightMm: 25 });
      expect(systemProperties(built, LINE_D).efl).toBeCloseTo(500, 6);
      expect(Math.abs(s.s1)).toBeLessThan(1e-15);
      return {
        c1: r.x[0]!,
        cancellation: s.surfaces.reduce((t, u) => t + Math.abs(u.s1), 0),
      };
    });
    // Two of the three starts share a solution; the third is a different lens
    // that satisfies the same three wishes exactly as well.
    expect(found[1]!.c1).toBeCloseTo(found[0]!.c1, 9);
    expect(Math.abs(found[2]!.c1 - found[0]!.c1)).toBeGreaterThan(1e-3);
    // And § 5j.2's branch criterion — how violently the surfaces cancel — ranks
    // them, on roots this file found by search rather than by algebra: 0.0199
    // against 0.0350.
    expect(found[0]!.cancellation).toBeLessThan(found[2]!.cancellation);
  });
});

describe("DLS — over- and under-determined merits", () => {
  it("spends surplus freedom on the SHORTEST step, not by holding a variable still", () => {
    const start = doublet(0.02, C_MID, -0.005, 4, 3);
    const r = optimizePrescription(start, SPLIT_VARS, [
      { kind: "power", wavelengthNm: LINE_D, target: 1 / 150 },
    ]);
    const built = withVariables(start, SPLIT_VARS, r.x);
    expect(systemProperties(built, LINE_D).efl).toBeCloseTo(150, 8);
    // Two variables, one wish: both moved, and by comparable amounts, because
    // the damped step is the short one and not the first one that works.
    const d1 = Math.abs(r.x[0]! - 0.02);
    const d3 = Math.abs(r.x[1]! + 0.005);
    expect(d1).toBeGreaterThan(1e-4);
    expect(d3).toBeGreaterThan(1e-4);
    expect(d1 / d3).toBeGreaterThan(0.5);
    expect(d1 / d3).toBeLessThan(2);
  });

  it("moves an over-determined answer when the exchange rate moves — 0.7 mm of focal length", () => {
    // One curvature against two incompatible wishes: 150 mm of focal length and
    // 140 mm of back focus. Neither is reachable, so where it settles is a
    // statement about how many diopters a millimetre is worth. Nothing external
    // can pin this, which is exactly why the two headline rungs are built so
    // that it cannot arise there.
    const at = (weight: number): number => {
      const start = doublet(0.02, C_MID, -0.005, 4, 3);
      const r = optimizePrescription(start, [{ kind: "curvature", surface: 2 }], [
        { kind: "power", wavelengthNm: LINE_D, target: 1 / 150 },
        { kind: "bfd", wavelengthNm: LINE_D, target: 140, weight },
      ]);
      return systemProperties(withVariables(start, [{ kind: "curvature", surface: 2 }], r.x), LINE_D)
        .efl;
    };
    expect(at(1e-4)).toBeCloseTo(147.019, 2);
    expect(at(1)).toBeCloseTo(146.336, 2);
    expect(at(1e-4) - at(1)).toBeGreaterThan(0.5);
  });
});

describe("DLS — refusals", () => {
  const start = doublet(0.01, C_MID, -0.01);
  it("names what it will not do", () => {
    expect(() => optimizePrescription(start, [], [...SPLIT_OPERANDS])).toThrow(/no variables/);
    expect(() => optimizePrescription(start, SPLIT_VARS, [])).toThrow(/no operands/);
    expect(() =>
      optimizePrescription(start, [...SPLIT_VARS, { kind: "curvature", surface: 0 }], [
        ...SPLIT_OPERANDS,
      ]),
    ).toThrow(/listed twice/);
    expect(() =>
      optimizePrescription(start, [{ kind: "curvature", surface: 7 }], [...SPLIT_OPERANDS]),
    ).toThrow(/not in a prescription/);
    expect(() =>
      optimizePrescription(start, SPLIT_VARS, [
        { kind: "power", wavelengthNm: LINE_D, target: PHI, weight: 0 },
      ]),
    ).toThrow(/is not a weight/);
    expect(() =>
      optimizePrescription(start, SPLIT_VARS, [
        { kind: "power", wavelengthNm: LINE_D, target: Number.NaN },
      ]),
    ).toThrow(/is not a target/);
    expect(() => dampedLeastSquares((x) => [x[0]!], [])).toThrow(/no variables/);
    expect(() => dampedLeastSquares((x) => [x[0]!], [Number.NaN])).toThrow(/not finite/);
    expect(() => dampedLeastSquares((x) => [x[0]!], [1], { steps: [1e-6, 1e-6] })).toThrow(
      /2 finite-difference steps for 1 variable/,
    );
    expect(() => dampedLeastSquares((x) => [x[0]!], [1], { initialDamping: 0 })).toThrow(
      /not positive/,
    );
    expect(() => dampedLeastSquares((x) => [x[0]!], [1], { steps: [0] })).toThrow(/not positive/);
    // A residual vector that changes length is a caller bug that would otherwise
    // show up as a nonsense Jacobian several iterations later.
    let calls = 0;
    expect(() =>
      dampedLeastSquares(() => (calls++ === 0 ? [1, 2] : [1]), [1]),
    ).toThrow(/changed length/);
  });

  it("caps the work and says the cap is why it stopped", () => {
    const r = dampedLeastSquares((x) => [x[0]! ** 2 - 9], [0.5], { maxIterations: 3 });
    expect(r.reason).toBe("iterations");
    expect(r.iterations).toBe(3);
  });
});

/**
 * § 1.8.5 — TRACED operands: the merit a real ray answers.
 *
 * Everything above is paraxial or third-order, and the "not yet pinned" note
 * this sub-step closes forecast that a traced merit would be hard to difference
 * because it "carries sampling noise". **That forecast is wrong, and wrong about
 * the mechanism rather than the size.** Over a FIXED set of pupil points the
 * traced RMS spot is an ordinary smooth function of the design — the rungs below
 * measure a central-difference plateau nine decades wide — and the one real
 * threat is a discontinuity nobody had named: a ray entering or leaving the
 * surviving set, which moves the merit 6.31% across a step of 1e-12.
 *
 * **The external numbers are two exact conjugates and one squeeze.**
 *
 *  1. **The paraboloid.** A parabolic mirror images an axial object at infinity
 *     to a point, exactly and at every aperture — it is the definition of the
 *     curve, not an approximation. So an optimiser fed nothing but traced spot
 *     radii must recover conic = −1.
 *  2. **The centre of curvature.** Every ray from the centre of a spherical
 *     mirror strikes it at normal incidence and returns through the centre, so
 *     that conjugate is stigmatic at all apertures and all orders. Recovering
 *     the mirror's curvature from the spot alone is the same statement read
 *     backwards, and — unlike the paraboloid — it moves a real prescription
 *     number, so it exercises `optimizeSystem` end to end.
 *  3. **Coddington's q\*, in a double limit.** The traced minimum-RMS shape is
 *     NOT the third-order minimum-W₀₄₀ shape; they meet only as both the glass
 *     and the aperture vanish. Which of those two limits was doing the work is
 *     measured rather than assumed, and the answer is not the one the first
 *     ladder suggested.
 */

/** A mirror at infinite conjugate. The paraboloid is the exact answer. */
function traceMirror(conic: number, R = -400, semi = 50): OpticalSystem {
  return {
    prescription: {
      surfaces: [
        { kind: "reflect", curvature: 1 / R, conic, semiAperture: semi, thickness: R / 2, isStop: true },
      ],
    },
    aperture: { kind: "stopRadius", value: semi },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** A spherical mirror with the object at distance d. Perfect when |R| = d. */
function concentricMirror(R: number, d: number, semi = 40): OpticalSystem {
  return {
    prescription: {
      surfaces: [{ kind: "reflect", curvature: 1 / R, semiAperture: semi, thickness: -d, isStop: true }],
    },
    aperture: { kind: "stopRadius", value: semi },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance: d },
  };
}

/**
 * The § 5j.1 singlet with REAL glass in it, and the reason it has to have some.
 *
 * § 5j.1's fixture is 1 nm thick because the polynomial it pins is a thin-lens
 * result. That fixture cannot be traced at its own aperture at all: with 1 nm on
 * axis the two surfaces cross a fraction of a millimetre off it, the glass has
 * negative thickness out at the rim, and 140 of 149 rays are lost. A third-order
 * sum never traces a ray and so never noticed. Measured, 6 mm of centre thickness
 * is the first round number that clears the whole f/10 pupil.
 */
const TRACED_T = 6;
function tracedSinglet(q: number, t = TRACED_T, semi = 50, stopR = semi): OpticalSystem {
  const dc = 1 / ((1.5 - 1) * F);
  const c1 = (dc * (q + 1)) / 2;
  return {
    prescription: {
      surfaces: [
        { kind: "refract", curvature: c1, semiAperture: semi * 1.2, thickness: t, medium: "DLS-N15", isStop: true },
        { kind: "refract", curvature: c1 - dc, semiAperture: semi * 1.2, thickness: F, medium: "AIR" },
      ],
    },
    aperture: { kind: "stopRadius", value: stopR },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

const TRACED_GRID = pupilGrid(15);

/** The traced RMS spot at best focus — what every rung below reads. */
function tracedRms(system: OpticalSystem, grid: readonly PupilPoint[] = TRACED_GRID): number {
  const b = exitBundle(system, 0, LINE_D, grid);
  return spotAt(b, bestSpotZ(b)).rmsRadius;
}

const spotOperand = (
  grid: readonly PupilPoint[] = TRACED_GRID,
  focus: TracedFocus = "bestSpot",
): TracedOperand => ({
  kind: "rmsSpot",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil: grid,
  focus,
  target: 0,
});

describe("DLS § 1.8.5 — a traced merit is smooth; only the ray SET is not", () => {
  it("differences over ten decades of step, and the floor below it is f64", () => {
    // The forecast being retired, measured. Central differences of the traced
    // RMS spot in the shape factor, at a shape well off the optimum so the true
    // derivative is O(1e-2) and not itself near zero.
    const q0 = 1.2142857142857144;
    const d = (h: number) =>
      (tracedRms(tracedSinglet(q0 + h)) - tracedRms(tracedSinglet(q0 - h))) / (2 * h);

    // The plateau, with three widths stated rather than one generous one,
    // because "smooth enough to difference" is a claim about a RANGE and the
    // range has a shape. Steps from 1e-6 to 1e-3 agree to seven figures
    // (2.3577643e-2, spread 1.1e-7); out to 1e-8…1e-2 to five (5.3e-6); across
    // the whole ten decades 1e-11…1e-2 to three (1.0e-3), which is already more
    // than a Jacobian needs.
    const spread = (es: number[]) => {
      const v = es.map((e) => d(10 ** e));
      return (Math.max(...v) - Math.min(...v)) / Math.abs(Math.max(...v));
    };
    expect(spread([-6, -5, -4, -3])).toBeLessThan(2e-7);
    expect(spread([-8, -7, -6, -5, -4, -3, -2])).toBeLessThan(1e-5);
    expect(spread([-11, -10, -9, -8, -7, -6, -5, -4, -3, -2])).toBeLessThan(2e-3);
    expect(d(1e-5)).toBeCloseTo(2.3577643e-2, 9);
    // The module's own default step for an O(1) variable, ∛ε ≈ 6.06e-6, is
    // inside that plateau by four decades either way. Nothing needed changing.
    expect(Math.cbrt(Number.EPSILON)).toBeGreaterThan(1e-10);
    expect(Math.cbrt(Number.EPSILON)).toBeLessThan(1e-3);

    // Below the plateau the quotient is cancellation, not sampling: the merit's
    // own resolution is ~1e-15 mm on a 2.7e-2 mm spot, which is f64 on the
    // coordinates, and 2h·(true derivative) drops under it around h = 1e-12.
    const truth = d(1e-5);
    for (const h of [1e-13, 1e-14]) {
      expect(Math.abs(d(h) - truth) / truth).toBeGreaterThan(1);
    }
    expect(tracedRms(tracedSinglet(q0))).toBeCloseTo(2.745516711202e-2, 12);
  });

  it("the ONE discontinuity: four rays of 149 rejoin and the merit jumps 6.31%", () => {
    // A rim placed where a bending walks the beam across it. Nothing about this
    // is exotic — it is what any real lens with a real edge does.
    const dc = 1 / ((1.5 - 1) * F);
    const clipped = (q: number): OpticalSystem => {
      const c1 = (dc * (q + 1)) / 2;
      return {
        prescription: {
          surfaces: [
            { kind: "refract", curvature: c1, semiAperture: 55, thickness: TRACED_T, medium: "DLS-N15", isStop: true },
            { kind: "refract", curvature: c1 - dc, semiAperture: 49.9, thickness: F, medium: "AIR" },
          ],
        },
        aperture: { kind: "stopRadius", value: 50 },
        field: { kind: "angle", values: [0] },
        wavelengths: [{ nm: LINE_D, weight: 1 }],
        conjugate: { kind: "infinite" },
      };
    };
    const rayCount = (q: number) => exitBundle(clipped(q), 0, LINE_D, TRACED_GRID).rays.length;

    // Bisect onto the boundary. It sits at q = 0.7106219, which is 8.0e-5 from
    // the optimum this fixture's un-clipped twin settles on (0.7107023) — the
    // cliff is not somewhere else on the map, it is under the answer.
    let lo = 0.3;
    let hi = 0.8;
    const nLo = rayCount(lo);
    expect(rayCount(hi)).not.toBe(nLo);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (rayCount(mid) === nLo) lo = mid;
      else hi = mid;
    }
    expect(lo).toBeCloseTo(0.710621939, 8);
    expect(Math.abs(lo - 0.710702268824)).toBeLessThan(1e-4);

    const below = tracedRms(clipped(lo));
    const above = tracedRms(clipped(lo + 1e-12));
    expect(rayCount(lo)).toBe(145);
    expect(rayCount(lo + 1e-12)).toBe(149);
    // 6.30% of merit across 1e-12 of variable. A central difference straddling
    // it reports a slope of 1e9 where the true one is 1e-4 — thirteen orders.
    expect((above - below) / below).toBeCloseTo(0.06304, 4);
    expect(Math.abs((above - below) / 1e-12)).toBeGreaterThan(1e9);
  });
});

describe("DLS § 1.8.5 — two exact conjugates, recovered from traced spots alone", () => {
  it("recovers the PARABOLOID, conic = −1, from four starts", () => {
    // The conic is not a `SolveVariable`, and does not need to be: a closure is
    // how the Coddington rung above moves the shape factor too.
    for (const k0 of [0, -0.5, -1.5, -2]) {
      const r = dampedLeastSquares((x) => [tracedRms(traceMirror(x[0]!))], [k0]);
      expect(r.x[0]!).toBeCloseTo(-1, 11);
      expect(Math.sqrt(r.merit)).toBeLessThan(1e-12);
    }
    // The floor: the parabola's own spot is 1.8e-14 mm on a 400 mm mirror, which
    // is f64 on the ray coordinates and not a residual aberration.
    expect(tracedRms(traceMirror(-1))).toBeLessThan(1e-13);
    // …and it is a real minimum, not a flat region: ±0.001 of conic costs 3 500×
    // the floor, symmetrically. That symmetry is the next rung's subject.
    expect(tracedRms(traceMirror(-0.999))).toBeGreaterThan(6e-5);
    expect(tracedRms(traceMirror(-1.001))).toBeGreaterThan(6e-5);
  });

  it("recovers the CENTRE OF CURVATURE through optimizeSystem, from three starts", () => {
    const d = 400;
    for (const R0 of [-380, -420, -300]) {
      const r = optimizeSystem(concentricMirror(R0, d), [{ kind: "curvature", surface: 0 }], [
        spotOperand(),
      ]);
      // R = −400 to a micron in 400 mm — 2.3e-6 relative, worst of the three
      // starts. Loose against the paraboloid's 1e-12 above, and for a reason
      // the rung after next measures: a curvature this far from focus is a very
      // flat direction, 1.8e-10 mm of spot per millimetre of radius.
      expect(1 / r.x[0]!).toBeCloseTo(-d, 2);
      expect(Math.abs(1 / r.x[0]! + d)).toBeLessThan(1e-3);
      expect(Math.sqrt(r.merit)).toBeLessThan(1e-12);
    }
    expect(tracedRms(concentricMirror(-d, d))).toBeLessThan(1e-13);
  });

  it("and a zero-residual TRACED optimum does not obey § 1.8.2's square root", () => {
    // § 1.8.2: near a quadratic minimum, resolving the merit to ε locates it
    // only to √ε. An RMS radius is a NORM, so at a design that is exactly
    // perfect it grows like |δ| rather than δ² — the merit has a corner, not a
    // bowl, and the location is then pinned as tightly as the value is.
    const slope = (dk: number) => tracedRms(traceMirror(-1 + dk)) / Math.abs(dk);
    // Linear over three decades and symmetric to four figures: 6.37e-2 per unit
    // of conic either way. A quadratic would fall by 10× per decade here.
    for (const dk of [1e-3, 1e-4, 1e-5]) {
      expect(slope(dk) / slope(-dk)).toBeCloseTo(1, 3);
      expect(slope(dk)).toBeCloseTo(6.3677e-2, 4);
    }
    // The consequence, measured: the conic is recovered to 1e-12 while the merit
    // resolves to 1e-14 — the same order. The Coddington rung above, whose
    // optimum has a POSITIVE floor and therefore a genuine bowl, is out at 2e-8
    // against a merit good to 4e-16. Same optimiser, same file, six orders apart,
    // and the difference is the shape of the optimum rather than the machinery.
    const traced = dampedLeastSquares((x) => [tracedRms(traceMirror(x[0]!))], [0]);
    expect(Math.abs(traced.x[0]! + 1)).toBeLessThan(1e-11);
    const bowl = dampedLeastSquares((x) => [w040(1.5, "DLS-N15", x[0]!)], [0]);
    expect(Math.abs(bowl.x[0]! - qStar(1.5))).toBeGreaterThan(1e-10);
  });
});

describe("DLS § 1.8.5 — Coddington in a double limit, and which limit does the work", () => {
  const optimumShape = (t: number, semi: number): number =>
    dampedLeastSquares((x) => [tracedRms(tracedSinglet(x[0]!, t, semi))], [qStar(1.5) + 0.5]).x[0]!;

  it("the traced shape is NOT the third-order shape, and the gap is linear in the GLASS", () => {
    // Aperture held at 50, thickness varying 2.6 → 40 mm. The gap to q* is a
    // straight line in t: −5.256e-4 per millimetre, over a 15× range.
    const at = (t: number) => optimumShape(t, 50) - qStar(1.5);
    const a = at(2.6);
    const b = at(6);
    const c = at(20);
    const slope1 = (b - a) / (6 - 2.6);
    const slope2 = (c - b) / (20 - 6);
    expect(slope1).toBeCloseTo(-5.256e-4, 6);
    expect(slope2 / slope1).toBeCloseTo(1, 2);
    // Extrapolated to no glass at all, 4.3e-4 of gap survives — and THAT part is
    // the aperture's.
    expect(a - 2.6 * slope1).toBeCloseTo(-4.29e-4, 5);
  });

  it("with the glass HELD, shrinking the aperture does NOT close the gap", () => {
    // The correction that matters. A first ladder shrank the aperture while
    // scaling the thickness with it — t = 1.5·(the minimum that aperture needs),
    // which is ∝ h² — measured a clean h² convergence toward q*, and would have
    // recorded it as the aperture's doing. It is the glass's.
    const held = [50, 25, 12.5, 6.25, 3.125, 1.5625].map(
      (semi) => optimumShape(3.75, semi) - qStar(1.5),
    );
    // From 6.25 mm down it is flat to three figures at −1.97e-3: the thick-lens
    // offset of 3.75 mm of glass, which no aperture limit can remove. Twelve
    // millimetres of aperture is already inside a thousandth of the floor.
    for (const g of held.slice(3)) expect(g).toBeCloseTo(-1.9725e-3, 5);
    expect(held[held.length - 1]! / held[0]!).toBeGreaterThan(0.8);
    // Only the DIFFERENCE across the ladder is the aperture's, and that part is
    // the forecast h²: 4.29e-4 at 50 mm, quartering with each halving. The tail
    // is not asserted — once it is under 1e-5 it is at the resolution of the
    // located shape itself, which the sample-set rung below measures at 5e-5.
    const aperturePart = (i: number) => held[i]! - held[held.length - 1]!;
    expect(aperturePart(0)).toBeCloseTo(-4.29e-4, 5);
    expect(aperturePart(0) / aperturePart(1)).toBeCloseTo(4, 0);
    expect(aperturePart(1) / aperturePart(2)).toBeCloseTo(4, 0);
  });

  it("so q* is recovered only in the double limit, and best at 2 mm of aperture", () => {
    // Both mechanisms are ∝ h² once the glass is cut to what the aperture needs,
    // so the gap is ≈ −9.6e-7·h² and the recovery is real but slow. Below ~1 mm
    // the spot itself (∝ h³) drops toward the f64 floor and the located shape
    // starts to wander instead: a window, not a limit.
    const shrink = (semi: number) => {
      const tMin = (semi * semi) / (2 * (1.5 - 1) * F);
      return optimumShape(1.5 * tMin, semi) - qStar(1.5);
    };
    expect(shrink(50)).toBeCloseTo(-2.4e-3, 4);
    expect(shrink(5)).toBeCloseTo(-2.34e-5, 6);
    // The best agreement this fixture reaches, and it is a genuine recovery of a
    // published thin-lens constant from nothing but traced ray coordinates.
    expect(Math.abs(shrink(2))).toBeLessThan(5e-6);
    // …and it gets WORSE below that, which is why no limit is claimed.
    expect(Math.abs(shrink(0.1))).toBeGreaterThan(10 * Math.abs(shrink(2)));
  });
});

describe("DLS § 1.8.5 — what the caller must state, because nothing can choose it", () => {
  it("the sample set moves the VALUE 15% and the ANSWER 5e-5", () => {
    const grids = [7, 11, 15, 21, 31, 41].map((n) => pupilGrid(n));
    const values = grids.map((g) => tracedRms(tracedSinglet(1.2142857142857144), g));
    const answers = grids.map(
      (g) => dampedLeastSquares((x) => [tracedRms(tracedSinglet(x[0]!), g)], [qStar(1.5) + 0.5]).x[0]!,
    );
    // 29 rays to 1 253. The merit is a different number at each: 3.27e-2 down to
    // 2.85e-2, and it is not even monotone.
    expect(Math.max(...values) / Math.min(...values) - 1).toBeGreaterThan(0.14);
    // The design it picks is very nearly the same one, though — 5.3e-5 of spread
    // against 15% of value. § 1.8.2 says the value is what an optimiser knows and
    // the design is what it guesses; on the sample set it is the other way round.
    expect(Math.max(...answers) - Math.min(...answers)).toBeLessThan(1e-4);
    expect(Math.max(...answers) - Math.min(...answers)).toBeGreaterThan(1e-5);
  });

  it("a derived aperture breathes with the design, and moves the answer as much as the physics does", () => {
    // Only `stopRadius` states the pupil outright. `fNumber` computes it from
    // the design being optimised, so the ray set is not held after all.
    const byF = (q: number): OpticalSystem => ({
      ...tracedSinglet(q),
      aperture: { kind: "fNumber", value: 10 },
    });
    const radius = (q: number) => pupils(byF(q), LINE_D).stopRadius;
    expect(radius(0.4)).toBeCloseTo(50.042035, 5);
    expect(radius(2.0)).toBeCloseTo(49.850449, 5);
    const held = dampedLeastSquares((x) => [tracedRms(tracedSinglet(x[0]!))], [qStar(1.5) + 0.5]).x[0]!;
    const breathing = dampedLeastSquares((x) => [tracedRms(byF(x[0]!))], [qStar(1.5) + 0.5]).x[0]!;
    // 2.0e-3 apart — the same size as the entire thick-lens offset the rungs
    // above spend three ladders separating out.
    expect(Math.abs(breathing - held)).toBeCloseTo(1.97e-3, 4);
  });

  it("one scalar RMS beats one residual per ray by nothing worth having", () => {
    // The obvious alternative: hand the optimiser every ray's displacement as
    // its own residual, 2N rows instead of 1. It is what a lens-design merit
    // classically is, and here it buys 2.5e-8 of shape for 12% more evaluations.
    const q0 = qStar(1.5) + 0.5;
    const scalar = dampedLeastSquares((x) => [tracedRms(tracedSinglet(x[0]!))], [q0]);
    const perRay = dampedLeastSquares((x) => {
      const b = exitBundle(tracedSinglet(x[0]!), 0, LINE_D, TRACED_GRID);
      const s = spotAt(b, bestSpotZ(b));
      return s.points.flatMap((p) => [p.x - s.centroidX, p.y - s.centroidY]);
    }, [q0]);
    expect(Math.abs(scalar.x[0]! - perRay.x[0]!)).toBeLessThan(1e-7);
    expect(Math.sqrt(perRay.merit / (perRay.residuals.length / 2))).toBeCloseTo(
      Math.sqrt(scalar.merit),
      9,
    );
    expect(perRay.evaluations).toBeGreaterThan(scalar.evaluations);
    // The vector form does light up the gradient test, which a single operand
    // leaves at 1 by construction (§ 1.8.4) — but that is a readout, not an
    // answer, and it is not worth a residual vector whose LENGTH is a function
    // of the design in a module that throws when the length changes.
    expect(scalar.gradient).toBe(1);
    expect(perRay.gradient).toBeLessThan(1e-3);
  });

  it("refocusing FORGIVES the focal length, so that wish is unbounded on a free power", () => {
    // The sharpest reason the convention cannot be defaulted, and it is not a
    // factor — it is whether the question has an answer. `bestSpot` re-focuses
    // every trial, so a design is never charged for where it forms an image; a
    // weaker lens then has less spherical aberration and nothing stops the
    // optimiser making one. Given a single free curvature it walks the focal
    // length from +999.5 mm to −16 411 mm, a nearly flat plate, and the merit is
    // still falling when the step underflows. The infimum of "smallest spot,
    // refocused" over an unconstrained power is a window, which is not a lens.
    const start = tracedSinglet(qStar(1.5) + 0.5);
    const c0 = start.prescription.surfaces[0]!.curvature;
    const free = optimizeSystem(start, [{ kind: "curvature", surface: 0 }], [spotOperand()]);
    const flattened = withVariables(start.prescription, [{ kind: "curvature", surface: 0 }], free.x);
    expect(Math.abs(systemProperties(flattened, LINE_D).efl)).toBeGreaterThan(10_000);
    expect(Math.abs(free.x[0]!)).toBeLessThan(0.1 * Math.abs(c0));
    expect(Math.sqrt(free.merit)).toBeLessThan(0.05 * tracedRms(start));

    // Fix the image plane instead and the same one free curvature is bounded:
    // the lens must form its image THERE, so it cannot buy sharpness by ceasing
    // to be a lens. EFL 1006.6 mm, and a merit that settles rather than slides.
    const pinned = optimizeSystem(start, [{ kind: "curvature", surface: 0 }], [
      spotOperand(TRACED_GRID, "systemImagePlane"),
    ]);
    const heldEfl = systemProperties(
      withVariables(start.prescription, [{ kind: "curvature", surface: 0 }], pinned.x),
      LINE_D,
    ).efl;
    expect(heldEfl).toBeCloseTo(1006.6, 0);
    expect(Math.sqrt(pinned.merit)).toBeCloseTo(2.7102e-2, 5);
  });

  it("…and with the power held they pick shapes 0.49 apart, each best in its own currency", () => {
    // Hold the power and the runaway above is gone, so the conventions can be
    // compared on the same question. They do not agree: refocused lands on the
    // traced Coddington shape, 0.7120, and the fixed plane lands at 0.2257,
    // because there the merit is aberration AND focus position and a bending
    // that moves the focus toward the plane is worth aberration to buy it.
    const start = tracedSinglet(qStar(1.5) + 0.5);
    const vars: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
    ];
    const target = 1 / systemProperties(start.prescription, LINE_D).efl;
    const shapeFor = (focus: TracedFocus) => {
      const r = optimizeSystem(start, vars, [
        { kind: "power", wavelengthNm: LINE_D, target, weight: 1e6 },
        spotOperand(TRACED_GRID, focus),
      ]);
      const moved = withVariables(start.prescription, vars, r.x);
      const [c1, c2] = [moved.surfaces[0]!.curvature, moved.surfaces[1]!.curvature];
      const sys = { ...start, prescription: moved };
      const b = exitBundle(sys, 0, LINE_D, TRACED_GRID);
      return {
        q: (c1 + c2) / (c1 - c2),
        atBest: spotAt(b, bestSpotZ(b)).rmsRadius,
        atPlane: spotAt(b, imagePlaneZ(asCompiled(moved), sys)).rmsRadius,
      };
    };
    const refocused = shapeFor("bestSpot");
    const onPlane = shapeFor("systemImagePlane");
    expect(refocused.q).toBeCloseTo(0.712011, 4);
    expect(onPlane.q).toBeCloseTo(0.225698, 4);
    expect(refocused.q - onPlane.q).toBeCloseTo(0.486, 2);
    // Neither is wrong: each design beats the other on the measure it was asked
    // for, which is what makes this a stated convention and not a default.
    expect(refocused.atBest).toBeLessThan(onPlane.atBest);
    expect(onPlane.atPlane).toBeLessThan(refocused.atPlane);
  });

  it("the two focus conventions differ by 10× and neither is the default", () => {
    const q = 1.2142857142857144;
    const b = exitBundle(tracedSinglet(q), 0, LINE_D, TRACED_GRID);
    const atBest = spotAt(b, bestSpotZ(b)).rmsRadius;
    const atPlane = spotAt(b, imagePlaneZ(asCompiled(tracedSinglet(q).prescription), tracedSinglet(q)))
      .rmsRadius;
    expect(atBest).toBeCloseTo(2.7455e-2, 6);
    expect(atPlane).toBeCloseTo(2.4987e-1, 5);
    expect(atPlane / atBest).toBeGreaterThan(9);
  });
});

describe("DLS § 1.8.5 — the survivor set is held, and the run says when that binds", () => {
  const dc = 1 / ((1.5 - 1) * F);
  /** The clipped fixture again: its dropout sits 8e-5 from the optimum. */
  const clipped = (q: number): OpticalSystem => {
    const c1 = (dc * (q + 1)) / 2;
    return {
      prescription: {
        surfaces: [
          { kind: "refract", curvature: c1, semiAperture: 55, thickness: TRACED_T, medium: "DLS-N15", isStop: true },
          { kind: "refract", curvature: c1 - dc, semiAperture: 49.9, thickness: F, medium: "AIR" },
        ],
      },
      aperture: { kind: "stopRadius", value: 50 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
  };

  it("a run started on the far side of a dropout stops at the boundary rather than crossing it", () => {
    // Started at q = 0.5, where four rays are already clipped. The optimum of
    // the 145-ray merit is on the other side of the boundary at 0.7106219, and
    // the hold means the optimiser may not step over it.
    const r = optimizeSystem(clipped(0.5), [{ kind: "curvature", surface: 0 }], [spotOperand()]);
    const dcOf = (c: number) => (2 * c) / dc - 1;
    const qEnd = dcOf(r.x[0]!);
    // It walks up to the boundary and stops there — 145 rays throughout, and the
    // stopping shape is on the starting side of 0.7106219.
    expect(qEnd).toBeLessThan(0.710621940);
    expect(exitBundle(clipped(qEnd), 0, LINE_D, TRACED_GRID).rays.length).toBe(145);
    // …and it is not a silent success. λ has been driven up by the rejected
    // steps, and the residual is reported so a caller can see the spot it
    // actually settled on rather than trusting the word "converged".
    expect(["damping", "step", "merit"]).toContain(r.reason);
    expect(r.rejected).toBeGreaterThan(0);
    expect(Math.abs(r.residuals[0]!)).toBeGreaterThan(1e-3);
  });

  it("refuses a start it cannot read, by name", () => {
    // § 5j.1's own 1 nm fixture at its own aperture: the surfaces cross off axis
    // and almost nothing gets through. The old message for this was "the
    // starting point is not a system", which is true and names the wrong thing.
    expect(() =>
      optimizeSystem(tracedSinglet(qStar(1.5), 1e-6), [{ kind: "curvature", surface: 0 }], [
        spotOperand(pupilGrid(31)),
      ]),
    ).toThrow(/rays surviving — a spot needs two/);
    expect(() =>
      optimizeSystem(tracedSinglet(qStar(1.5)), [{ kind: "curvature", surface: 0 }], [
        spotOperand([{ px: 0, py: 0 }]),
      ]),
    ).toThrow(/no spot to measure/);
    // And it keeps every refusal `optimizePrescription` makes.
    expect(() => optimizeSystem(tracedSinglet(1), [], [spotOperand()])).toThrow(/no variables/);
    expect(() =>
      optimizeSystem(tracedSinglet(1), [{ kind: "curvature", surface: 9 }], [spotOperand()]),
    ).toThrow(/not in a prescription/);
  });

  it("mixes a traced wish with a paraxial one — which is the question a designer asks", () => {
    // "Hold the focal length and shrink the spot" is one merit over two
    // operands in different units, so the weight is an exchange rate and the
    // answer moves with it — § 1.8.4's point, now with a traced operand in it.
    // Power is in 1/mm and 1e-3 of it is the whole system, so the weight below
    // is what makes a diopter cost more than a millimetre of blur.
    const start = tracedSinglet(qStar(1.5) + 0.5);
    const target = systemProperties(start.prescription, LINE_D).efl;
    const r = optimizeSystem(
      start,
      [
        { kind: "curvature", surface: 0 },
        { kind: "curvature", surface: 1 },
      ],
      [
        { kind: "power", wavelengthNm: LINE_D, target: 1 / target, weight: 1e6 },
        spotOperand(),
      ],
    );
    const moved = withVariables(start.prescription, [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
    ], r.x);
    // The focal length is held to a part in 1e5 while the spot comes down 21%,
    // and 21% is the whole of what was available: holding the power with two
    // curvatures leaves exactly one freedom, the bending, so the answer lands on
    // the traced Coddington optimum the one-variable rungs above found —
    // 2.1555e-2 mm against 2.1514e-2. Two variables, two wishes, and the merit
    // recovers a shape the merit was never told about.
    expect(systemProperties(moved, LINE_D).efl / target).toBeCloseTo(1, 5);
    const shrunk = tracedRms({ ...start, prescription: moved });
    expect(shrunk).toBeLessThan(0.8 * tracedRms(start));
    const bestBending = dampedLeastSquares(
      (x) => [tracedRms(tracedSinglet(x[0]!))],
      [qStar(1.5) + 0.5],
    );
    expect(shrunk / Math.sqrt(bestBending.merit)).toBeCloseTo(1, 2);
    // Both operands are live — this is not the traced one riding along.
    expect(r.residuals).toHaveLength(2);
    expect(Math.abs(r.residuals[0]!)).toBeGreaterThan(0);
  });
});

/**
 * § 1.8.6 — a condition, as opposed to a wish with a large weight.
 *
 * The open item this closes said the difference "is measurable: a weighted
 * constraint is satisfied only to O(1/w)". Both halves of that sentence turn out
 * to need correcting, and the interesting one is not the exponent:
 *
 *  - The violation goes as **1/w²**, not 1/w, because the weight enters the
 *    merit squared. Measured over six decades of weight, below.
 *  - And the thing a weight costs is **not the accuracy of the answer**. On the
 *    fixture the app has been quoting for exactly this purpose, the recovered
 *    SHAPE is the same whether the power is held by weight 1 or held exactly —
 *    because the shape that minimises spherical aberration does not depend on
 *    the power at all. At weight 1 the optimiser returns the right shape of a
 *    lens whose focal length is 55% wrong.
 *
 * What a condition buys is measured here instead: the condition itself (2·10⁻¹⁶
 * against 3·10⁻⁷ at a weight a designer would call large), half the evaluations
 * on a traced merit, a multiplier that prices it, and the removal of a knob
 * whose right value cannot be known in advance — the same achromat is wrong at
 * weight 1 and wrong again at 10¹².
 */
const HELD_POWER = (target: number): HeldOperand => ({
  kind: "power",
  wavelengthNm: LINE_D,
  target,
});

describe("DLS § 1.8.6 — the arithmetic of a condition, before any lens", () => {
  /** min x² + y² subject to x + y = t. Answer (t/2, t/2), merit t²/2, λ = −t. */
  const onALine = (t: number) => (x: readonly number[]) => ({
    minimize: [x[0]!, x[1]!],
    hold: [x[0]! + x[1]! - t],
  });

  it("lands on the closed-form constrained minimum, from the free optimum itself", () => {
    // The start (0,0) IS the unconstrained minimum, so the first step has to
    // make the merit worse to make the condition true. A step accepted on the
    // merit alone could never do that, which is what the ℓ1 measure is for.
    for (const t of [2, 1, 5]) {
      const r = dampedLeastSquares(onALine(t), [0, 0]);
      expect(r.x[0]!).toBeCloseTo(t / 2, 10);
      expect(r.x[1]!).toBeCloseTo(t / 2, 10);
      expect(r.merit).toBeCloseTo((t * t) / 2, 12);
      // The condition is met exactly — not nearly, and not to a tolerance.
      expect(r.constraints[0]!).toBe(0);
      expect(r.feasibility).toBe(0);
      // λ = −t, which is the whole Lagrange condition ∇m + λ∇c = 0 written out:
      // (2x, 2y) + λ(1, 1) = 0 at x = y = t/2.
      expect(r.multipliers[0]!).toBeCloseTo(-t, 10);
    }
  });

  it("…and the multiplier is the PRICE of the condition, at both signs", () => {
    // The envelope theorem: dm*/dt = −λ. m*(t) = t²/2 here, so dm*/dt = t, and
    // the multiplier is measured against a difference quotient of the OPTIMUM
    // rather than against the algebra it happens to agree with.
    for (const t of [2, -2]) {
      const eps = 1e-6;
      const meritAt = (tt: number) => dampedLeastSquares(onALine(tt), [0, 0]).merit;
      const dmdt = (meritAt(t + eps) - meritAt(t - eps)) / (2 * eps);
      const lambda = dampedLeastSquares(onALine(t), [0, 0]).multipliers[0]!;
      expect(dmdt).toBeCloseTo(-lambda, 8);
      expect(dmdt).toBeCloseTo(t, 8);
      // …and the sign the doc comment claims: λ > 0 means raising the target
      // LOWERS the best merit reachable.
      expect(Math.sign(lambda)).toBe(-Math.sign(t));
    }
  });

  it("a condition need not be linear, and a start need not meet it", () => {
    // Pull to the origin, held on the unit circle: every feasible point is
    // optimal, so what is pinned is that the answer lands ON the circle — from
    // outside it, from well inside it, and from the wrong quadrant.
    for (const start of [[3, 0.5], [0.1, 0.02], [-2, -2]]) {
      const r = dampedLeastSquares(
        (x) => ({ minimize: [x[0]!, x[1]!], hold: [x[0]! ** 2 + x[1]! ** 2 - 1] }),
        start,
      );
      expect(Math.hypot(r.x[0]!, r.x[1]!)).toBeCloseTo(1, 15);
      expect(r.merit).toBeCloseTo(1, 14);
      // ∇m + λ∇c = 2x + λ·2x = 0 → λ = −1 wherever it lands.
      expect(r.multipliers[0]!).toBeCloseTo(-1, 10);
    }
  });

  it("a capped run is STILL the longer run's prefix, which μ is what threatens", () => {
    // The app draws its convergence trail by replaying the run at caps of
    // 1, 2, 3 …, which is honest only while a capped run is exactly a prefix.
    // Conditions put a second state in the loop — μ, the exchange rate between
    // merit and violation — and a μ that depended on a total, or on the cap,
    // would break that quietly. It is monotone and depends only on the iterates,
    // and this is that pinned rather than asserted. The start is the far
    // infeasible one, because that is the path where μ actually rises.
    const merit = onALine(2);
    const full = dampedLeastSquares(merit, [-40, 90]);
    expect(full.iterations).toBeGreaterThan(6);
    expect(full.rejected).toBeGreaterThan(0);

    let previous: DlsResult | null = null;
    for (let k = 1; k <= full.iterations; k++) {
      const step = dampedLeastSquares(merit, [-40, 90], { maxIterations: k });
      if (step.reason === "iterations") {
        expect(step.accepted + step.rejected).toBe(k);
      }
      if (previous !== null) {
        expect(step.accepted).toBeGreaterThanOrEqual(previous.accepted);
        expect(step.rejected).toBeGreaterThanOrEqual(previous.rejected);
        expect(step.evaluations).toBeGreaterThanOrEqual(previous.evaluations);
        if (step.accepted === previous.accepted) expect(step.x).toEqual(previous.x);
      }
      previous = step;
    }
    const capped = dampedLeastSquares(merit, [-40, 90], { maxIterations: full.iterations });
    expect(capped.x).toEqual(full.x);
    expect(capped.merit).toBe(full.merit);
    expect(capped.evaluations).toBe(full.evaluations);
    expect(capped.damping).toBe(full.damping);
    expect(capped.multipliers).toEqual(full.multipliers);

    // …and what a trail under a condition may NOT be drawn as: the merit is not
    // monotone along it. The run starts at merit 9 700 and ends at 2, but it
    // pays merit for feasibility on the way and the plot has to say so.
    const early = dampedLeastSquares(merit, [-40, 90], { maxIterations: 1 });
    const later = dampedLeastSquares(merit, [-40, 90], { maxIterations: 3 });
    expect(early.merit).toBeGreaterThan(full.merit);
    expect(early.feasibility).toBeGreaterThan(later.feasibility);
  });

  it("as many conditions as variables leaves nothing to minimise, and says so at once", () => {
    // Not a refusal: the conditions determine the answer and the wishes are
    // simply not granted. What matters is that the run reports the merit it is
    // stuck with rather than pretending it minimised anything.
    const r = dampedLeastSquares(
      (x) => ({ minimize: [x[0]! - 10, x[1]! - 10], hold: [x[0]! - 1, x[1]! - 2] }),
      [0, 0],
    );
    expect(r.x[0]!).toBeCloseTo(1, 14);
    expect(r.x[1]!).toBeCloseTo(2, 14);
    expect(r.merit).toBeCloseTo(145, 10);
    expect(r.feasibility).toBe(0);
    expect(r.iterations).toBeLessThan(6);
  });
});

describe("DLS § 1.8.6 — the weight, measured on the fixture that was quoting it", () => {
  // The § 1.8.1 singlet with BOTH curvatures free, so the power is a question
  // rather than a construction: bend for least spherical aberration at 1000 mm.
  const N = 1.5;
  const MEDIUM = "DLS-N15";
  const VARS: SolveVariable[] = [
    { kind: "curvature", surface: 0 },
    { kind: "curvature", surface: 1 },
  ];
  // Stated, not defaulted: these curvatures are ~1e-3, and the module's default
  // step floors at 1 (its own open item), so the default differences them over
  // half a percent of themselves. That is the largest effect in this fixture and
  // it belongs to neither mechanism — see the last rung of this block.
  const STEPS = { steps: [1e-9, 1e-9] };
  const S1_WISH: OptimizeOperand = {
    kind: "seidelS1",
    wavelengthNm: LINE_D,
    marginalHeightMm: H,
    target: 0,
    weight: 1,
  };
  const START = thinLens(N, qStar(N) + 0.5, MEDIUM);
  const shapeOf = (x: readonly number[]) => (x[0]! + x[1]!) / (x[0]! - x[1]!);
  const powerOf = (x: readonly number[]) =>
    1 / systemProperties(withVariables(START, VARS, x), LINE_D).efl;

  const byWeight = (w: number, options: DlsOptions = STEPS) =>
    optimizePrescription(
      START,
      VARS,
      [S1_WISH, { kind: "power", wavelengthNm: LINE_D, target: 1 / F, weight: w }],
      options,
    );
  const byCondition = (options: DlsOptions = STEPS) =>
    optimizePrescription(START, VARS, { minimize: [S1_WISH], hold: [HELD_POWER(1 / F)] }, options);

  it("a weighted condition is satisfied to O(1/w²) — the exponent, corrected", () => {
    // The weight multiplies the RESIDUAL and the merit squares it, so the
    // stationary point trades (v−t) against 1/w². The open item said O(1/w).
    const violation = (w: number) => Math.abs(powerOf(byWeight(w).x) * F - 1);
    const ladder = [1, 1e2, 1e4, 1e6].map(violation);
    // The law is asymptotic, and the first cell is outside it: at weight 1 the
    // focal length is out by tens of percent, which is not a perturbation of
    // anything. From there on, two decades of weight buy four of violation.
    expect(ladder[0]!).toBeGreaterThan(0.1);
    // 3.90 and 3.99 measured: the exponent is 2 in the weight, with the
    // higher-order terms of a real lens on top of it.
    expect(Math.log10(ladder[1]! / ladder[2]!)).toBeCloseTo(3.90, 1);
    expect(Math.log10(ladder[2]! / ladder[3]!)).toBeCloseTo(4, 1);
    // …which is the correction: 1/w would have made these two numbers 2.
    for (const [a, b] of [[1, 2], [2, 3]] as const) {
      expect(Math.log10(ladder[a]! / ladder[b]!)).toBeGreaterThan(3);
    }

    // And held, it is not satisfied to a tolerance at all — it is satisfied.
    const held = byCondition();
    expect(Math.abs(powerOf(held.x) * F - 1)).toBeLessThan(1e-15);
    expect(held.feasibility).toBeLessThan(1e-16);
  });

  it("…but the weight was never what limited the ANSWER, and the shape proves it", () => {
    // The shape factor that minimises spherical aberration does not depend on
    // the power — q* is a function of the index alone. So at weight 1 the
    // optimiser returns a shape within 1e-7 of the published minimum while
    // sitting 55% away in focal length: the readout the app has been reading
    // this sweep off cannot see the condition at all.
    const loose = byWeight(1);
    expect(Math.abs(powerOf(loose.x) * F - 1)).toBeGreaterThan(0.5);
    expect(shapeOf(loose.x)).toBeCloseTo(qStar(N), 6);

    // Held, weighted-heavily, and weighted-not-at-all land on the same shape.
    const held = byCondition();
    const heavy = byWeight(1e6);
    expect(shapeOf(held.x)).toBeCloseTo(qStar(N), 6);
    expect(shapeOf(heavy.x)).toBeCloseTo(shapeOf(held.x), 7);
    expect(shapeOf(loose.x)).toBeCloseTo(shapeOf(held.x), 7);
  });

  it("what DOES limit it is the differencing step, which is neither mechanism", () => {
    // At the module's default step — 6e-6 absolute against curvatures of 1.5e-3,
    // half a percent of the variable — the recovered shape is out by ~1e-6
    // whether the power is held or weighted, and the sweep of weights that
    // results is not monotone. State the step and both collapse onto the same
    // few·1e-9. The lesson is § 1.8.2's, one level along: a number read off a
    // minimiser is a statement about how the minimiser was differenced.
    const coarse = Math.abs(shapeOf(byCondition({}).x) / qStar(N) - 1);
    const stated = Math.abs(shapeOf(byCondition().x) / qStar(N) - 1);
    expect(coarse).toBeGreaterThan(1e-7);
    expect(stated).toBeLessThan(1e-8);
    expect(coarse / stated).toBeGreaterThan(30);
    // …and the same is true of the weighted run, which is why the two cannot be
    // told apart by their answers at the default step.
    const coarseWeighted = Math.abs(shapeOf(byWeight(1e6, {}).x) / qStar(N) - 1);
    expect(coarseWeighted).toBeGreaterThan(1e-8);
  });
});

describe("DLS § 1.8.6 — the multiplier is a price, and a lens can be charged it", () => {
  // A thick doublet with only the two outer curvatures free: S_I cannot be
  // nulled, so the condition and the objective genuinely compete and the
  // multiplier is not zero. (On the zero-thickness fixture every wish and both
  // conditions vanish together and λ is exactly 0 — which is the same theorem
  // saying the conditions are free there.)
  const VARS: SolveVariable[] = [
    { kind: "curvature", surface: 0 },
    { kind: "curvature", surface: 2 },
  ];
  const STEPS = { steps: [1e-9, 1e-9] };
  const S1_WISH: OptimizeOperand = {
    kind: "seidelS1",
    wavelengthNm: LINE_D,
    marginalHeightMm: 25,
    target: 0,
    weight: 1,
  };
  const thick = (c1: number, c3: number) => doublet(c1, C_MID, c3, 10, 6);
  const atTarget = (target: number) =>
    optimizePrescription(
      thick(C1_STAR, C3_STAR),
      VARS,
      { minimize: [S1_WISH], hold: [HELD_POWER(target)] },
      STEPS,
    );

  it("dm*/dt = −λ on a lens, against a difference quotient of the OPTIMUM", () => {
    const base = atTarget(PHI);
    expect(base.multipliers[0]!).toBeCloseTo(-250.705, 2);
    expect(base.merit).toBeGreaterThan(0.28);
    // The price is measured the way a price is: move the target and see what
    // the best reachable merit does. Six figures, on a merit whose optimum has
    // a floor and therefore a real trade in it.
    const d = 1e-3;
    const dmdt = (atTarget(PHI * (1 + d)).merit - atTarget(PHI * (1 - d)).merit) / (2 * PHI * d);
    expect(dmdt / -base.multipliers[0]!).toBeCloseTo(1, 5);

    // …and every one of those runs met its own condition exactly, which is what
    // makes the quotient a statement about the optimum rather than about three
    // different compromises.
    for (const t of [PHI, PHI * (1 + d), PHI * (1 - d)]) {
      const r = atTarget(t);
      expect(r.feasibility).toBeLessThan(1e-15);
      expect(Math.abs(r.constraints[0]!)).toBeLessThan(1e-17);
    }
  });

  it("a zero-residual optimum prices its conditions at nothing, exactly", () => {
    // The thin doublet: three curvatures, two conditions (power and colour) and
    // one wish (S_I → 0), and all three reach zero together. A condition that
    // costs the objective nothing has λ = 0, and this is that sentence measured
    // rather than asserted.
    const VARS3: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
      { kind: "curvature", surface: 2 },
    ];
    const r = optimizePrescription(
      doublet(C1_STAR * 0.9, C_MID * 1.1, C3_STAR * 1.05),
      VARS3,
      {
        minimize: [S1_WISH],
        hold: [HELD_POWER(PHI), { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0 }],
      },
      { steps: [1e-9, 1e-9, 1e-9] },
    );
    expect(r.merit).toBeLessThan(1e-25);
    for (const l of r.multipliers) expect(Math.abs(l)).toBeLessThan(1e-6);
    // The closed-form split is recovered as a by-product: two conditions on a
    // thin doublet are two equations in the two ELEMENT powers, whatever the
    // three curvatures do, and the wish spends what is left on the bending.
    const [c1, c2, c3] = r.x as [number, number, number];
    expect(((nCrown - 1) * (c1 - c2)) / PHI_CROWN).toBeCloseTo(1, 12);
    expect(((nFlint - 1) * (c2 - c3)) / PHI_FLINT).toBeCloseTo(1, 12);
    expect(r.feasibility).toBeLessThan(1e-15);
  });

  it("…and the same design by weight has a window, at both ends of which it is wrong", () => {
    // The same three curvatures, both conditions turned into wishes. There is a
    // usable band of weights and it is not wide, and neither end announces
    // itself: at 1 the run does not converge and the crown power is 2% out; at
    // 1e12 the conditions are met and the aberration term has vanished from the
    // merit, so the answer is a doublet with Σ S_I = 0.875 mm instead of 0.
    const VARS3: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
      { kind: "curvature", surface: 2 },
    ];
    const byWeight = (w: number) =>
      optimizePrescription(
        doublet(C1_STAR * 0.9, C_MID * 1.1, C3_STAR * 1.05),
        VARS3,
        [
          S1_WISH,
          { kind: "power", wavelengthNm: LINE_D, target: PHI, weight: w },
          { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0, weight: w },
        ],
        { steps: [1e-9, 1e-9, 1e-9] },
      );
    const s1Of = (x: readonly number[]) =>
      seidelSums(doublet(x[0]!, x[1]!, x[2]!, 0, 0), LINE_D, { marginalHeightMm: 25 }).s1;

    const loose = byWeight(1);
    expect(loose.reason).toBe("iterations");
    expect(Math.abs((nCrown - 1) * (loose.x[0]! - C_MID) / PHI_CROWN - 1)).toBeGreaterThan(0.02);

    const tight = byWeight(1e12);
    expect(Math.abs(s1Of(tight.x))).toBeCloseTo(0.875, 2);

    // In between it works, which is the point: the weight has to be found, and
    // nothing in the run says whether it has been.
    const good = byWeight(1e6);
    expect(Math.abs(s1Of(good.x))).toBeLessThan(1e-12);
  });
});

describe("DLS § 1.8.6 — § 1.8.3's barrier is about the CURRENCY, not about least squares", () => {
  // § 1.8.3 measured a focal-length WISH sliding away from +150 mm to EFL → 0,
  // because 1/f runs through ±∞ in between and a downhill method does not cross
  // barriers. A condition is a Newton solve rather than a descent — so it is
  // worth asking whether it crosses. It does not, and for the same reason: the
  // pole is in the quantity, not in the method.
  const START = doublet(0.002, C_MID, 0.02, 4, 3);
  const VARS: SolveVariable[] = [
    { kind: "curvature", surface: 2 },
    { kind: "curvature", surface: 0 },
  ];
  const S1_WISH: OptimizeOperand = {
    kind: "seidelS1",
    wavelengthNm: LINE_D,
    marginalHeightMm: 25,
    target: 0,
    weight: 1,
  };
  const heldIn = (hold: HeldOperand) =>
    optimizePrescription(START, VARS, { minimize: [S1_WISH], hold: [hold] }, { steps: [1e-9, 1e-9] });

  it("held in millimetres of focal length it fails; held in power it is exact", () => {
    expect(systemProperties(START, LINE_D).efl).toBeCloseTo(-76.540084, 5);

    const inEfl = heldIn({ kind: "efl", wavelengthNm: LINE_D, target: 150 });
    expect(inEfl.reason).toBe("iterations");
    expect(inEfl.feasibility).toBeGreaterThan(1);
    // It slides the same way the wish did: toward EFL → 0, on the near side of
    // the pole, with a multiplier the size of the barrier it is stuck against.
    expect(Math.abs(systemProperties(withVariables(START, VARS, inEfl.x), LINE_D).efl)).toBeLessThan(1);

    const inPower = heldIn(HELD_POWER(1 / 150));
    expect(systemProperties(withVariables(START, VARS, inPower.x), LINE_D).efl).toBeCloseTo(150, 6);
    expect(inPower.feasibility).toBeLessThan(1e-15);
    expect(inPower.iterations).toBeLessThan(30);
  });
});

describe("DLS § 1.8.6 — a condition on a TRACED merit, which is the question a designer asks", () => {
  const start = tracedSinglet(qStar(1.5) + 0.5);
  const VARS: SolveVariable[] = [
    { kind: "curvature", surface: 0 },
    { kind: "curvature", surface: 1 },
  ];
  const startEfl = systemProperties(start.prescription, LINE_D).efl;
  const eflOf = (x: readonly number[]) =>
    systemProperties(withVariables(start.prescription, VARS, x), LINE_D).efl;
  const shapeOf = (x: readonly number[]) => (x[0]! + x[1]!) / (x[0]! - x[1]!);

  it("holds the focal length exactly while shrinking the spot, from starts that do NOT hold it", () => {
    // The headline use of the whole feature, and the case the probes could not
    // reach by accident: the start is infeasible, so every run has to restore
    // the focal length as well as bend the lens — and a restoration step is a
    // Newton step, which is longer than a merit step and is exactly what walks
    // a traced merit's survivor set. Measured, it recovers: a dozen rejected
    // steps per run, and the condition met to the last bit.
    expect(startEfl).toBeCloseTo(999.5257, 3);
    for (const [asked, shape, rms] of [
      [700, 0.710765, 4.4166e-2],
      [900, 0.711705, 2.6615e-2],
      [1100, 0.712255, 1.7784e-2],
      [1500, 0.712867, 9.5478e-3],
    ] as const) {
      const r = optimizeSystem(start, VARS, {
        minimize: [spotOperand()],
        hold: [HELD_POWER(1 / asked)],
      });
      expect(eflOf(r.x)).toBeCloseTo(asked, 6);
      expect(r.feasibility).toBeLessThan(1e-17);
      expect(shapeOf(r.x)).toBeCloseTo(shape, 5);
      expect(Math.sqrt(r.merit)).toBeCloseTo(rms, 6);
      expect(r.rejected).toBeGreaterThan(0);
    }
  });

  it("…and the price of the focal length rises as the lens is asked to be shorter", () => {
    // λ is in the merit's units per unit of 1/mm, and it is the number that says
    // what the condition is costing: a 700 mm lens pays ten times what a 1500 mm
    // one does for the same held power, on the same glass at the same aperture.
    const priceAt = (asked: number) =>
      optimizeSystem(start, VARS, { minimize: [spotOperand()], hold: [HELD_POWER(1 / asked)] })
        .multipliers[0]!;
    const short = priceAt(700);
    const long = priceAt(1500);
    expect(short).toBeCloseTo(-5.516, 2);
    expect(long).toBeCloseTo(-0.548, 2);
    expect(short / long).toBeGreaterThan(9);
  });

  it("reaches the same design as a heavy weight in HALF the evaluations", () => {
    // On a traced merit an evaluation is 430× a third-order sum (§ 1.8.5), so
    // the iteration count is the cost. Refocused, the two mechanisms agree on
    // the shape to six figures and the condition costs half the trial designs —
    // a weight has to be walked down to what a condition solves.
    const target = 1 / startEfl;
    const weighted = optimizeSystem(start, VARS, [
      { kind: "power", wavelengthNm: LINE_D, target, weight: 1e6 },
      spotOperand(),
    ]);
    const held = optimizeSystem(start, VARS, {
      minimize: [spotOperand()],
      hold: [HELD_POWER(target)],
    });
    expect(shapeOf(held.x)).toBeCloseTo(shapeOf(weighted.x), 6);
    expect(shapeOf(held.x)).toBeCloseTo(0.712011, 5);
    // Measured 110 against 220. Asserted with room, because the rung is about
    // the factor and not about either run's exact iteration count.
    expect(held.evaluations).toBeLessThan(0.6 * weighted.evaluations);
    // …and the condition is met six orders better than the weight met it.
    expect(Math.abs(eflOf(weighted.x) / startEfl - 1)).toBeGreaterThan(1e-10);
    expect(Math.abs(eflOf(held.x) / startEfl - 1)).toBeLessThan(1e-14);
  });

  it("on the FIXED image plane the two mechanisms do NOT agree, and λ says why", () => {
    // § 1.8.5 quoted 0.2257 for this convention with the power held by weight
    // 1e6. Held exactly it is 0.2230, 1.2% away — because on this convention
    // the merit is aberration AND focus position, so it fights the power wish
    // hard enough that 1e6 was not a large weight after all: it bought its
    // shape by giving away 6.2e-6 of focal length. The multiplier is the same
    // fact as a number — the condition costs 6700× more here than refocused.
    const target = 1 / startEfl;
    const onPlane = (focus: TracedFocus) => ({ ...spotOperand(TRACED_GRID, focus) });
    const weighted = optimizeSystem(start, VARS, [
      { kind: "power", wavelengthNm: LINE_D, target, weight: 1e6 },
      onPlane("systemImagePlane"),
    ]);
    const held = optimizeSystem(start, VARS, {
      minimize: [onPlane("systemImagePlane")],
      hold: [HELD_POWER(target)],
    });
    expect(shapeOf(weighted.x)).toBeCloseTo(0.225698, 5);
    expect(shapeOf(held.x)).toBeCloseTo(0.222951, 5);
    expect(Math.abs(eflOf(weighted.x) / startEfl - 1)).toBeCloseTo(6.2e-6, 7);
    expect(Math.abs(eflOf(held.x) / startEfl - 1)).toBeLessThan(1e-15);

    const refocused = optimizeSystem(start, VARS, {
      minimize: [spotOperand()],
      hold: [HELD_POWER(target)],
    });
    expect(held.multipliers[0]!).toBeCloseTo(-1.2452e4, -1);
    expect(refocused.multipliers[0]!).toBeCloseTo(-1.8662, 3);
    expect(held.multipliers[0]! / refocused.multipliers[0]!).toBeCloseTo(6672, -2);
  });

  it("bounds the unbounded wish: one free curvature, refocused, told what lens to be", () => {
    // § 1.8.5's runaway — refocusing forgives the focal length, so a single free
    // curvature walks the EFL to −16 411 mm. A condition removes the freedom it
    // was running away in, and with one variable and one condition there is
    // nothing left to minimise at all: the answer is the lens the condition
    // names, reported at once.
    const one: SolveVariable[] = [{ kind: "curvature", surface: 0 }];
    const free = optimizeSystem(start, one, [spotOperand()]);
    expect(
      Math.abs(systemProperties(withVariables(start.prescription, one, free.x), LINE_D).efl),
    ).toBeGreaterThan(10_000);

    const held = optimizeSystem(start, one, {
      minimize: [spotOperand()],
      hold: [HELD_POWER(1 / 1200)],
    });
    expect(
      systemProperties(withVariables(start.prescription, one, held.x), LINE_D).efl,
    ).toBeCloseTo(1200, 6);
    expect(held.feasibility).toBeLessThan(1e-16);
  });
});

describe("DLS § 1.8.6 — refusals, and the one dependence differencing cannot see", () => {
  const VARS: SolveVariable[] = [
    { kind: "curvature", surface: 0 },
    { kind: "curvature", surface: 2 },
  ];
  const S1_WISH: OptimizeOperand = {
    kind: "seidelS1",
    wavelengthNm: LINE_D,
    marginalHeightMm: 25,
    target: 0,
    weight: 1,
  };
  const START = doublet(C1_STAR * 0.9, C_MID, C3_STAR * 1.05);
  const held = (hold: readonly HeldOperand[]) =>
    optimizePrescription(START, VARS, { minimize: [S1_WISH], hold }, { steps: [1e-9, 1e-9] });

  it("names what it will not do", () => {
    // A weight on a condition. The type makes it unwriteable; the run refuses it
    // anyway, because a type is not there at run time and a weight silently
    // ignored is a caller believing something untrue about the answer.
    expect(() =>
      held([{ kind: "power", wavelengthNm: LINE_D, target: PHI, weight: 3 } as HeldOperand]),
    ).toThrow(/a condition is not traded against anything/);

    // More conditions than variables: not an over-determined compromise — a
    // compromise is what a condition refuses to be.
    expect(() =>
      held([
        HELD_POWER(PHI),
        { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0 },
        { kind: "bfd", wavelengthNm: LINE_D, target: 99 },
      ]),
    ).toThrow(/3 conditions on 2 variable\(s\)/);

    // The same condition twice: two identical rows, and the rank test sees them
    // because they are identical to the bit.
    expect(() => held([HELD_POWER(PHI), HELD_POWER(PHI)])).toThrow(/not independent/);

    // A condition nothing can move.
    expect(() =>
      dampedLeastSquares((x) => ({ minimize: [x[0]! - 1], hold: [0.5] }), [0, 0]),
    ).toThrow(/not independent/);

    // And every refusal the unconstrained entry points make still stands.
    expect(() => optimizePrescription(START, VARS, { minimize: [] })).toThrow(/no operands/);
  });

  it("two conditions that are ONE condition in different units are not refused — they fail", () => {
    // Holding the power at 1/100 and the focal length at 100 mm is one condition
    // written twice, and the rank test cannot see it: the rows are parallel only
    // to the accuracy the Jacobian was DIFFERENCED at, which is nowhere near the
    // bit. So this is the honest boundary of the refusal above — what is
    // guaranteed is not a message, it is that no optimum is reported. The run
    // stops with the conditions unmet and says so through `feasibility`, which
    // is § 1.8.3's lesson one level along: a converged optimiser is not a
    // correct one, so the run reports what it actually achieved.
    const r = held([HELD_POWER(PHI), { kind: "efl", wavelengthNm: LINE_D, target: 100 }]);
    expect(r.reason).not.toBe("gradient");
    expect(r.feasibility).toBeGreaterThan(1e-6);
    expect(Math.abs(r.constraints[1]!)).toBeGreaterThan(1);
  });

  it("a condition on the far side of a wall is walked up to, not reported as met", () => {
    // The domain ends at x = 2 and the condition asks for x = 3. Restoration is
    // walled, so λ rises and θ halves — and the run stops at the boundary with
    // the violation reported, the same way § 1.8's own domain-edge rung does.
    // What is pinned is the negative: it is not a `gradient` stop and the
    // condition is not claimed.
    let walls = 0;
    const r = dampedLeastSquares(
      (x) => {
        if (x[0]! > 2) {
          walls++;
          throw new Error("outside the domain");
        }
        return { minimize: [x[0]! - 1], hold: [x[0]! - 3] };
      },
      [0],
    );
    expect(walls).toBeGreaterThan(0);
    expect(r.x[0]!).toBeCloseTo(2, 5);
    expect(r.reason).toBe("iterations");
    expect(r.rejected).toBeGreaterThan(50);
    expect(r.constraints[0]!).toBeCloseTo(-1, 5);
    expect(r.feasibility).toBeGreaterThan(0.3);
  });

  it("an unconstrained run carries the new fields as empty, not as zeroes with meaning", () => {
    const r = optimizePrescription(START, VARS, [S1_WISH], { steps: [1e-9, 1e-9] });
    expect(r.constraints).toEqual([]);
    expect(r.multipliers).toEqual([]);
    expect(r.feasibility).toBe(0);
  });
});

/**
 * § 1.8.7's fixture: a spherical mirror, whose only significant on-axis
 * aberration is primary spherical — and whose W₀₄₀ is a closed form.
 *
 * The same mirror `focus.test.ts` uses, and deliberately so: that file already
 * pins the *analysis* side of every number below (the balanced RMS at best
 * focus, the 4/3 spread between the criteria) through `bestFocus`, which is a
 * one-variable search with no target. Reaching the same numbers here, through
 * damped least squares over a thickness, is a second mechanism arriving at an
 * external result rather than a re-assertion of the first.
 */
const MIRROR_R = -200;
const WAVES_PER_MM = 1e6 / LINE_D;
const LAMBDA_MM = LINE_D * 1e-6;

function wfMirror(
  semiAperture: number,
  focus = MIRROR_R / 2,
  curvature = 1 / MIRROR_R,
): OpticalSystem {
  return {
    prescription: {
      surfaces: [
        { kind: "reflect", curvature, conic: 0, semiAperture, thickness: focus, isStop: true },
      ],
    },
    aperture: { kind: "stopRadius", value: semiAperture },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** W₀₄₀ in mm for a spherical mirror at infinite conjugate. */
const primarySA = (semiAperture: number): number =>
  semiAperture ** 4 / (4 * Math.abs(MIRROR_R) ** 3);

const WF_GRID = pupilGrid(21);
const WF_TERMS = 11;

const wfOperand = (
  reading: "rms" | "balancedRms",
  pupil: readonly PupilPoint[] = WF_GRID,
  terms = WF_TERMS,
): TracedOperand => ({
  kind: "wavefront",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil,
  terms,
  reading,
  target: 0,
});

const wfZernike = (
  noll: number,
  target = 0,
  pupil: readonly PupilPoint[] = WF_GRID,
  terms = WF_TERMS,
): TracedOperand => ({
  kind: "wavefront",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil,
  terms,
  reading: "zernike",
  noll,
  target,
});

/** The fitted wavefront of a system, as the operand reads it. */
const wfFit = (
  system: OpticalSystem,
  pupil: readonly PupilPoint[] = WF_GRID,
  terms = WF_TERMS,
  fieldValue = 0,
) => fitZernike(opdMap(system, fieldValue, LINE_D, pupil).samples, terms);

const FOCUS = { kind: "thickness", surface: 0 } as const satisfies SolveVariable;
const RADIUS = { kind: "curvature", surface: 0 } as const satisfies SolveVariable;

/**
 * DLS § 1.8.7 — a WAVEFRONT target.
 *
 * The other half of the "targets on traced quantities" item, and it is a
 * different question from § 1.8.5's rather than the same one at more expense.
 * The spot is read off ray intercepts; this is read off a *fit* to a sampled
 * phase map, and the recorded worry was that the fit's conditioning would move
 * under the optimiser the way the survivor set does.
 *
 * **It cannot.** `fitZernike` builds its design matrix out of sample
 * COORDINATES, and `opdMap` reports every sample at the normalized pupil point
 * that was asked for, not at wherever the ray landed. Hold the survivor set —
 * which the operand already does, for § 1.8.5's reason — and the matrix, its
 * factorisation and every decision the 1e-12 pivot floor makes are fixed for
 * the whole run. The fit is ONE LINEAR MAP applied to a right-hand side, and
 * the right-hand side is the only thing the design moves. Four rungs below
 * measure that rather than asserting it.
 *
 * What the fit does do is *attenuate* noise, by √(terms/samples) — the opposite
 * of the amplification the bullet feared. The floor that actually binds is
 * somewhere else entirely: an OPD is a difference of two ~200 mm optical paths
 * expressed in waves, so f64 on the path becomes ~3e-11 waves on a sample, and
 * the reading's own resolution is ~2e-12 waves. Three decades coarser than the
 * traced spot's, and still four decades below anything a Jacobian needs.
 */
describe("DLS § 1.8.7 — the balanced-focus wavefront, recovered from a closed form", () => {
  /**
   * Third-order theory writes the wavefront of a spherical mirror as
   * W(ρ) = a·ρ⁴ + b·ρ², b being the defocus a plane shift buys. Var(W) is
   * minimised at b = −a, and there
   *
   *     RMS = W₀₄₀/(6√5)                    [Born & Wolf; Mahajan]
   *
   * which is the number this rung recovers by moving the image plane with
   * damped least squares and reading `fitRms` off the operand's own fit.
   */
  it("the RMS at the optimum is W₀₄₀/(6√5), and the excess is fifth-order", () => {
    const excess: number[] = [];
    for (const semi of [20, 10, 5, 2.5]) {
      const system = wfMirror(semi);
      const predicted = (primarySA(semi) / (6 * Math.sqrt(5))) * WAVES_PER_MM;
      const r = optimizeSystem(system, [FOCUS], [wfOperand("rms")], { steps: [1e-4] });
      const found = fitRms(wfFit({ ...system, prescription: withVariables(system.prescription, [FOCUS], r.x) }));
      const na = semi / Math.abs(MIRROR_R / 2);
      excess.push((found / predicted - 1) / na ** 2);
      expect(found / predicted).toBeCloseTo(1, 2);
    }
    // The whole claim, and it is stronger than a percentage band: divide the
    // excess by NA² and what is left is one number — 6.105e-2 — approached from
    // below as the aperture closes, each halving of NA cutting the remaining
    // gap about fourfold. That is the neglected fifth-order term identifying
    // itself by its own order, not a tolerance chosen to fit.
    expect(excess[0]).toBeCloseTo(6.027e-2, 5);
    expect(excess[1]).toBeCloseTo(6.088e-2, 5);
    expect(excess[2]).toBeCloseTo(6.103e-2, 5);
    expect(excess[3]).toBeCloseTo(6.105e-2, 5);
    const gap = excess.map((e) => Math.abs(e - 6.1053e-2));
    for (let i = 1; i < gap.length; i++) expect(gap[i]!).toBeLessThan(gap[i - 1]! / 3);
  });

  it("…and the plane it lands on is the balancing defocus b = −a", () => {
    // W = ½·δz·NA²·ρ² (opd.test.ts pins that), so b = −a is δz = −2a/NA². The
    // sign is the mirror's: light travels −z after it, so the thickness this
    // rung moves is negative and a shorter focus is a POSITIVE change.
    for (const [semi, expected] of [
      [10, 1.00058],
      [5, 1.000147],
    ] as const) {
      const system = wfMirror(semi);
      const na = semi / Math.abs(MIRROR_R / 2);
      const predicted = (2 * primarySA(semi)) / na ** 2;
      const r = optimizeSystem(system, [FOCUS], [wfOperand("rms")], { steps: [1e-4] });
      expect((r.x[0]! - MIRROR_R / 2) / predicted).toBeCloseTo(expected, 5);
    }
  });

  /**
   * The identity c₄ = 0 at best focus is a THIRD-ORDER statement, and this rung
   * is what says so. Minimising √(Σ c_j²) balances c₄ against the higher terms'
   * own drift with the plane — dc₁₁/dz is 1.58e-3 waves per mm here, not zero —
   * so the min-RMS plane and the c₄ = 0 plane are 1.05e-5 mm apart, and each is
   * the better of the two on its own measure.
   */
  it("the min-RMS plane is NOT the c₄ = 0 plane, and the operand can ask for either", () => {
    const system = wfMirror(10);
    const byRms = optimizeSystem(system, [FOCUS], [wfOperand("rms")], { steps: [1e-4] });
    const byC4 = optimizeSystem(system, [FOCUS], [wfZernike(4)], { steps: [1e-4] });

    const at = (x: readonly number[]) =>
      wfFit({ ...system, prescription: withVariables(system.prescription, [FOCUS], x) });
    // The c₄ run drives its own residual to nothing; the RMS run leaves c₄ at
    // 2.6e-5 waves on purpose, because moving further would cost more elsewhere.
    expect(Math.abs(coefficient(at(byC4.x), 4))).toBeLessThan(1e-11);
    expect(coefficient(at(byRms.x), 4)).toBeCloseTo(-2.566e-5, 8);
    expect(byC4.x[0]! - byRms.x[0]!).toBeCloseTo(1.046e-5, 8);
    // …and each really is better by its own measure, which is what makes them
    // two questions rather than one answer computed twice.
    expect(fitRms(at(byRms.x))).toBeLessThan(fitRms(at(byC4.x)));
    expect(Math.abs(coefficient(at(byC4.x), 4))).toBeLessThan(Math.abs(coefficient(at(byRms.x), 4)));
  });

  /**
   * `focus.ts` pins this ratio through a 1-D search over three criteria. Here
   * the same two criteria are two OPERANDS handed to the same optimiser over
   * the same variable, so the 4/3 is being reproduced by a different mechanism
   * — and the two traced operand kinds are shown to be talking about one
   * system rather than two.
   */
  it("min-spot focus sits 4/3 as far out as min-wavefront focus, both by DLS", () => {
    for (const semi of [10, 5]) {
      const system = wfMirror(semi);
      const wave = optimizeSystem(system, [FOCUS], [wfOperand("rms")], { steps: [1e-4] });
      const spot = optimizeSystem(
        system,
        [FOCUS],
        [
          {
            kind: "rmsSpot",
            fieldValue: 0,
            wavelengthNm: LINE_D,
            pupil: WF_GRID,
            focus: "systemImagePlane",
            target: 0,
          },
        ],
        { steps: [1e-4] },
      );
      const ratio = (spot.x[0]! - MIRROR_R / 2) / (wave.x[0]! - MIRROR_R / 2);
      // 1e-3, against focus.test.ts's 1%. The residual is fifth-order plus the
      // stopping precision of two very flat minima, not a disagreement.
      expect(Math.abs(ratio / (4 / 3) - 1)).toBeLessThan(1e-3);
    }
  });
});

describe("DLS § 1.8.7 — a Zernike coefficient is an operand, and it inverts a closed form", () => {
  /**
   * The reading that goes through the fit and nothing else, given a NONZERO
   * target — which no other operand in this file has been given.
   *
   * Ask for a stated amount of primary spherical and the answer is the mirror
   * that produces it:  c₁₁ = −W₀₄₀/(6√5)/λ with W₀₄₀ = h⁴/(4|R|³), so
   *
   *     |R| = ( h⁴ / (4·6√5·λ·|c₁₁|) )^(1/3)
   *
   * Two variables, because the radius that carries the aberration also moves
   * the focus: the curvature is the wish's variable and the plane is pinned by
   * a § 1.8.6 CONDITION, c₄ = 0, so the answer is read at one focus rather
   * than at whichever one the run drifted to.
   */
  it("a prescribed c₁₁ inverts to a radius, with the plane held by a condition", () => {
    const semi = 10;
    const excess: number[] = [];
    for (const target of [-0.02, -0.05, -0.1]) {
      const predicted = -(
        (semi ** 4 / (4 * 6 * Math.sqrt(5) * LAMBDA_MM * Math.abs(target))) ** (1 / 3)
      );
      const start = wfMirror(semi);
      const r = optimizeSystem(
        start,
        [RADIUS, FOCUS],
        { minimize: [wfZernike(11, target)], hold: [wfZernike(4)] },
        { steps: [1e-8, 1e-4] },
      );
      const found = 1 / r.x[0]!;
      const fit = wfFit({ ...start, prescription: withVariables(start.prescription, [RADIUS, FOCUS], r.x) });

      expect(coefficient(fit, 11)).toBeCloseTo(target, 8);
      expect(Math.abs(coefficient(fit, 4))).toBeLessThan(1e-10);
      expect(Math.abs(r.constraints[0]!)).toBeLessThan(1e-10);
      expect(found / predicted).toBeCloseTo(1, 3);
      excess.push((found / predicted - 1) / (semi / (Math.abs(found) / 2)) ** 2);
    }
    // Same signature as the balanced-focus rung: divide the gap from the
    // third-order closed form by NA² and one number is left — 2.03e-2 — while
    // the aberration asked for changes 5× and the radius that carries it moves
    // 100 mm. A fifth-order residual, not an optimiser error.
    for (const e of excess) {
      expect(e).toBeGreaterThan(2.0e-2);
      expect(e).toBeLessThan(2.05e-2);
    }
  });

  /**
   * The condition machinery of § 1.8.6, on the new operand. The point is not
   * that it converges: it is that holding c₄ = 0 is a different request from
   * minimising the RMS, lands on the c₄ = 0 plane rather than the min-RMS one,
   * prices itself, and gets there in a fraction of the work.
   */
  it("holding c₄ = 0 is met exactly, priced by a multiplier, and cheaper than the wish", () => {
    const system = wfMirror(10);
    const free = optimizeSystem(system, [FOCUS], [wfOperand("rms")], { steps: [1e-4] });
    const held = optimizeSystem(
      system,
      [FOCUS],
      { minimize: [wfOperand("rms")], hold: [wfZernike(4)] },
      { steps: [1e-4] },
    );

    expect(Math.abs(held.constraints[0]!)).toBeLessThan(1e-10);
    expect(held.reason).toBe("gradient");
    expect(free.reason).toBe("step");
    // The price of the condition, in RMS waves per wave of c₄ target.
    expect(held.multipliers[0]!).toBeCloseTo(-5.13e-5, 6);
    // Fewer evaluations by a factor of several — the condition removes the one
    // free direction, so what is left is a triangular solve rather than a
    // descent down a very flat bowl.
    expect(held.evaluations * 4).toBeLessThan(free.evaluations);
    // …and the plane it lands on is the c₄ one, not the RMS one.
    expect(held.x[0]! - free.x[0]!).toBeCloseTo(1.046e-5, 8);
  });
});

describe("DLS § 1.8.7 — `balancedRms` forgives the focus, and that is a false minimum", () => {
  /**
   * `TracedFocus` again, in the wavefront's currency, and the answer is worse
   * than the spot's was.
   *
   * `"bestSpot"` over a free power was UNBOUNDED (§ 1.8.5): the merit fell for
   * ever and the run said so by never settling. Removing the defocus term from
   * a wavefront does something more dangerous — it CONVERGES, on a plane half a
   * focal length past focus, where the image is 1 690× larger and the reading
   * is 3.85× better. The mechanism is that the reference sphere's radius is not
   * held: it grows with the plane, and every high-order coefficient shrinks
   * with it.
   */
  it("over the image distance it prefers a plane half a focal length out", () => {
    const balanced = (dz: number) => balancedRms(wfFit(wfMirror(10, MIRROR_R / 2 + dz)));
    const bestFocusShift = -0.0625;

    expect(balanced(bestFocusShift)).toBeCloseTo(3.9469e-2, 6);
    expect(balanced(-50)).toBeCloseTo(1.0278e-2, 6);
    // 3.85× "better" where the geometric image has been destroyed.
    expect(balanced(bestFocusShift) / balanced(-50)).toBeGreaterThan(3.8);
    const bundle = exitBundle(wfMirror(10), 0, LINE_D, WF_GRID);
    const atBest = spotAt(bundle, imagePlaneZ(asCompiled(wfMirror(10, MIRROR_R / 2 + bestFocusShift).prescription), wfMirror(10, MIRROR_R / 2 + bestFocusShift))).rmsRadius;
    const atFalse = spotAt(bundle, imagePlaneZ(asCompiled(wfMirror(10, MIRROR_R / 2 - 50).prescription), wfMirror(10, MIRROR_R / 2 - 50))).rmsRadius;
    expect(atFalse / atBest).toBeGreaterThan(300);

    // The reference sphere is what moved: 100 → 150 mm of radius, and c₁₁ falls
    // by 0.26 against the 0.30 a pure R⁻³ scaling would give.
    const near = opdMap(wfMirror(10), 0, LINE_D, WF_GRID);
    const far = opdMap(wfMirror(10, MIRROR_R / 2 - 50), 0, LINE_D, WF_GRID);
    expect(far.referenceRadius / near.referenceRadius).toBeCloseTo(1.5, 9);
    expect(
      coefficient(fitZernike(far.samples, WF_TERMS), 11) /
        coefficient(fitZernike(near.samples, WF_TERMS), 11),
    ).toBeCloseTo(0.25976, 4);

    // And the optimiser walks there and reports success, which is the whole
    // hazard: not a divergence a caller would notice, an answer.
    const r = optimizeSystem(wfMirror(10), [FOCUS], [wfOperand("balancedRms")], { steps: [1e-4] });
    expect(r.x[0]! - MIRROR_R / 2).toBeLessThan(-40);
  });

  it("over a free power it doubles the focal length and calls the lens perfect", () => {
    const start = tracedSinglet(1);
    const grid = pupilGrid(11);
    const one = [RADIUS];

    const bounded = optimizeSystem(start, one, [wfOperand("rms", grid)], { maxIterations: 400 });
    const forgiving = optimizeSystem(start, one, [wfOperand("balancedRms", grid)], {
      maxIterations: 400,
    });
    const eflOf = (r: DlsResult) =>
      systemProperties(withVariables(start.prescription, one, r.x), LINE_D).efl;

    // `rms` charges the design for where it puts the image, so the focal length
    // stays where the fixture put it.
    expect(eflOf(bounded)).toBeCloseTo(1005.45, 1);
    expect(bounded.merit).toBeGreaterThan(1e-3);
    // `balancedRms` does not, and takes the same freedom `"bestSpot"` took.
    expect(eflOf(forgiving)).toBeGreaterThan(2000);
    expect(forgiving.merit).toBeLessThan(1e-10);
  });
});

describe("DLS § 1.8.7 — the fit's conditioning, which is the question this operand opened", () => {
  /**
   * The bullet asked whether the fit's conditioning moves under the optimiser.
   * It cannot, and this is the measurement rather than the argument: two
   * genuinely different designs, fitted over the same held coordinates, and
   * the fit of a LINEAR COMBINATION of their OPD vectors is the same linear
   * combination of their coefficients — to 8e-16, which is f64 and nothing
   * else. A matrix that moved with the design could not do that.
   */
  it("the fit is one linear map: superposition holds to machine precision", () => {
    const a = opdMap(wfMirror(10), 0, LINE_D, WF_GRID);
    const b = opdMap(wfMirror(10, MIRROR_R / 2 - 0.4), 0, LINE_D, WF_GRID);
    expect(a.samples.length).toBe(b.samples.length);
    for (let i = 0; i < a.samples.length; i++) {
      expect(a.samples[i]!.px).toBe(b.samples[i]!.px);
      expect(a.samples[i]!.py).toBe(b.samples[i]!.py);
    }

    const alpha = 0.37;
    const beta = -1.9;
    const terms = 21;
    const fa = fitZernike(a.samples, terms);
    const fb = fitZernike(b.samples, terms);
    const fm = fitZernike(
      a.samples.map((s, i) => ({ px: s.px, py: s.py, waves: alpha * s.waves + beta * b.samples[i]!.waves })),
      terms,
    );
    let num = 0;
    let den = 0;
    for (let j = 1; j <= terms; j++) {
      num += (coefficient(fm, j) - (alpha * coefficient(fa, j) + beta * coefficient(fb, j))) ** 2;
      den += coefficient(fm, j) ** 2;
    }
    expect(Math.sqrt(num / den)).toBeLessThan(1e-14);
  });

  /**
   * The pivot floor, approached from the only direction that can measure it: a
   * right-hand side that IS a basis function has the exact answer e_j, so what
   * comes back short of e_j is the solve's own conditioning. It is 1e-15 across
   * every term of a 45-term fit — an O(1) condition number, and the 1e-12
   * absolute floor in `math/lsq` is nowhere in sight.
   */
  it("every basis function is recovered exactly, so no pivot is being zeroed", () => {
    const coords = opdMap(wfMirror(10), 0, LINE_D, WF_GRID).samples;
    const terms = 45;
    let worst = 0;
    for (let j = 1; j <= terms; j++) {
      const fit = fitZernike(
        coords.map((s) => ({ px: s.px, py: s.py, waves: zernike(j, s.px, s.py) })),
        terms,
      );
      for (let k = 1; k <= terms; k++) {
        worst = Math.max(worst, Math.abs(coefficient(fit, k) - (k === j ? 1 : 0)));
      }
    }
    expect(worst).toBeLessThan(1e-13);
  });

  /**
   * …and the direction of the effect the bullet feared. A least-squares fit of
   * `terms` coefficients to `n` samples spreads independent per-sample noise
   * over the fit, so ‖Δc‖ is √(terms/n) of it — an ATTENUATION of 4.4× at 11
   * terms on this grid, not an amplification.
   */
  it("the fit attenuates per-sample noise by √(terms/samples)", () => {
    const samples = opdMap(wfMirror(10), 0, LINE_D, WF_GRID).samples;
    const n = samples.length;
    const delta = 1e-6;

    // Sixty-four draws, and the ensemble is the point rather than caution: a
    // SINGLE ±1 pattern puts ‖Δc‖/δ anywhere between 0.10 and 0.28 at eleven
    // terms, because the statistic has only  degrees of freedom in it.
    // One draw would have pinned a realisation. Their RMS is the response.
    for (const terms of [11, 21, 28, 45]) {
      const base = fitZernike(samples, terms);
      let sumSq = 0;
      const draws = 64;
      for (let d = 0; d < draws; d++) {
        // A ±1 pattern with zero mean to build — a CONSTANT offset would be pure
        // piston, which the basis absorbs whole into c₁ and which reads as an
        // amplification of exactly 1 while measuring nothing at all.
        let seed = 12345 + d * 7919;
        const sign = () =>
          ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 30) & 1 ? 1 : -1;
        const bumped = fitZernike(
          samples.map((sample) => ({ px: sample.px, py: sample.py, waves: sample.waves + delta * sign() })),
          terms,
        );
        for (let j = 1; j <= terms; j++) sumSq += (coefficient(bumped, j) - coefficient(base, j)) ** 2;
      }
      const amplification = Math.sqrt(sumSq / draws) / delta;
      // Well under 1: the fit SPREADS independent per-sample noise over the
      // coefficients rather than concentrating it. 4.4× down at eleven terms.
      expect(amplification).toBeLessThan(0.4);
      // …and the size of it is √(terms/samples) to within 2%, at four widths of
      // fit — which is what a design matrix with an O(1) condition number does.
      expect(amplification / Math.sqrt(terms / n)).toBeGreaterThan(1.0);
      expect(amplification / Math.sqrt(terms / n)).toBeLessThan(1.03);
    }
  });

  it("the fitted RMS is steady where the raw sample RMS is not", () => {
    const system = wfMirror(10, MIRROR_R / 2 - 0.0625);
    const readings = [11, 21, 41, 81].map((n) => {
      const map = opdMap(system, 0, LINE_D, pupilGrid(n));
      return { fit: fitRms(fitZernike(map.samples, 28)), raw: map.rmsWaves, rows: map.samples.length };
    });
    expect(readings[0]!.rows).toBe(77);
    expect(readings[3]!.rows).toBe(5021);
    for (const r of readings) expect(r.fit).toBeCloseTo(3.08948745e-1, 8);
    const raw = readings.map((r) => r.raw);
    expect(Math.max(...raw) - Math.min(...raw)).toBeGreaterThan(6e-3);
  });
});

describe("DLS § 1.8.7 — the differencing window, and what actually sets its floor", () => {
  it("differences over six decades of step, on a floor that is not the spot's", () => {
    const read = (dz: number) => fitRms(wfFit(wfMirror(10, MIRROR_R / 2 + dz)));
    const z0 = -0.03;
    const d = (h: number) => (read(z0 + h) - read(z0 - h)) / (2 * h);

    const spread = (es: number[]) => {
      const v = es.map((e) => d(10 ** e));
      return (Math.max(...v) - Math.min(...v)) / Math.abs(Math.max(...v));
    };
    expect(spread([-3, -4, -5])).toBeLessThan(2e-6);
    expect(spread([-2, -3, -4, -5, -6, -7])).toBeLessThan(2e-4);
    expect(d(1e-5)).toBeCloseTo(-2.41234256, 6);

    // The floor, stated as the quantity it is: |d(h) − truth|·2h is the
    // reading's own resolution, ~2e-12 waves. Derived, it is f64 on a ~200 mm
    // optical path (2e-14 mm) turned into waves (×1702) and then attenuated by
    // the fit's √313 — 3.4e-11/17.7 ≈ 1.9e-12, which is what comes back.
    const truth = d(1e-5);
    for (const h of [1e-12, 1e-13]) {
      expect(Math.abs(d(h) - truth) * 2 * h).toBeGreaterThan(1e-12);
      expect(Math.abs(d(h) - truth) * 2 * h).toBeLessThan(1e-11);
    }
    // Relative to the reading itself that is 5e-11, where § 1.8.5's traced spot
    // sits at 4e-14: three decades coarser, because an OPD is a difference of
    // large paths expressed in a tiny unit. Still four decades under the
    // module's own default step.
    expect(Math.abs(truth)).toBeGreaterThan(1);
  });

  /**
   * The recorded "step's own scaling" item, measured on a fixture where it is
   * decisive rather than cosmetic — and a correction to how § 1.8.5's number
   * for this fixture reads.
   *
   * The variable is a curvature of 2.5e-3, so the default step's `max(|x|, 1)`
   * floor makes it ∛ε = 6.06e-6 — a quarter of a percent of the variable, and
   * on this merit that is a straddle rather than a difference. State the step
   * at 1e-8 and the recovered radius improves by SIX ORDERS.
   *
   * With the step held, the wavefront and the fixed-plane spot land in the same
   * place, at the f64 floor. `"bestSpot"` does not, and is seven orders behind
   * both — because the quantity that locates a perfect conjugate is exactly the
   * defocus refocusing throws away. § 1.8.5's 2.3e-6 on this fixture is a
   * `"bestSpot"` number taken at the default step; its "very flat direction"
   * reading is true of `"bestSpot"` and does not carry to the other two.
   */
  it("the concentric conjugate: six orders from stating the step, and the currencies then agree", () => {
    const d = 400;
    const spotOp = (focus: TracedFocus): TracedOperand => ({
      kind: "rmsSpot",
      fieldValue: 0,
      wavelengthNm: LINE_D,
      pupil: WF_GRID,
      focus,
      target: 0,
    });
    const relative = (op: TracedOperand, steps?: number[]) => {
      const worst = [-380, -420].map((R0) => {
        const r = optimizeSystem(concentricMirror(R0, d), [RADIUS], [op], steps ? { steps } : {});
        return Math.abs(1 / r.x[0]! + d) / d;
      });
      return Math.max(...worst);
    };

    const wave = wfOperand("rms");
    expect(relative(wave)).toBeCloseTo(1.39e-8, 9);
    expect(relative(wave, [1e-8])).toBeLessThan(1e-13);
    expect(relative(wave) / relative(wave, [1e-8])).toBeGreaterThan(1e5);

    // Same step, same fixture, the other traced currency: indistinguishable.
    expect(relative(spotOp("systemImagePlane"), [1e-8])).toBeLessThan(1e-12);
    // …and the refocused one is not, by seven orders.
    expect(relative(spotOp("bestSpot"), [1e-8])).toBeGreaterThan(1e-8);

    // A corner and not a bowl, as § 1.8.2 requires of a zero-residual optimum:
    // the merit is linear in ΔR over five decades, 4.8765 waves per mm.
    for (const dR of [1e-2, 1e-4, 1e-6]) {
      expect(fitRms(wfFit(concentricMirror(-d + dR, d))) / dR).toBeCloseTo(4.8765, 3);
    }
  });
});

describe("DLS § 1.8.7 — the refusals a wavefront operand needs of its own", () => {
  it("a fit wider than the pupil offered is refused before a ray is traced", () => {
    expect(() =>
      optimizeSystem(wfMirror(10), [FOCUS], [wfOperand("rms", pupilGrid(7), 45)]),
    ).toThrow(/fits 45 terms over 29 pupil point\(s\), before a single ray is lost/);
    expect(() => optimizeSystem(wfMirror(10), [FOCUS], [wfOperand("rms", WF_GRID, 46)])).toThrow(
      /1…45 is what the basis has/,
    );
    expect(() => optimizeSystem(wfMirror(10), [FOCUS], [wfZernike(12, 0, WF_GRID, 11)])).toThrow(
      /reads Noll 12 out of a 11-term fit/,
    );
    expect(() => optimizeSystem(wfMirror(10), [FOCUS], [wfZernike(0)])).toThrow(/reads Noll 0/);
  });

  /**
   * The survivor set, held, on the other producer. § 1.8.5's clipped singlet
   * walks four rays across a rim as the shape bends; `opdMap` drops what does
   * not reach the reference sphere exactly as `exitBundle` drops what
   * vignettes, so the same fixture is a wall for the same reason — and the
   * generalized key is what lets one mechanism cover both.
   */
  it("a wavefront operand holds its surviving rays, and a design that changes them is a wall", () => {
    const dc = 1 / ((1.5 - 1) * F);
    const clippedAt = (q: number): OpticalSystem => {
      const c1 = (dc * (q + 1)) / 2;
      return {
        prescription: {
          surfaces: [
            { kind: "refract", curvature: c1, semiAperture: 55, thickness: TRACED_T, medium: "DLS-N15", isStop: true },
            { kind: "refract", curvature: c1 - dc, semiAperture: 49.9, thickness: F, medium: "AIR" },
          ],
        },
        aperture: { kind: "stopRadius", value: 50 },
        field: { kind: "angle", values: [0] },
        wavelengths: [{ nm: LINE_D, weight: 1 }],
        conjugate: { kind: "infinite" },
      };
    };
    const grid = pupilGrid(15);
    const survivors = (q: number) => opdMap(clippedAt(q), 0, LINE_D, grid).samples.length;
    // The same boundary the spot operand meets, seen through the OPD map.
    expect(survivors(0.5)).toBeLessThan(survivors(0.9));

    const r = optimizeSystem(clippedAt(0.5), [RADIUS], [wfOperand("rms", grid)]);
    const qEnd = (2 * r.x[0]!) / dc - 1;
    expect(survivors(qEnd)).toBe(survivors(0.5));
    // It stopped because the set was in the way, not because it converged: the
    // damping is up, exactly as § 1.8.5's spot run reports it.
    expect(r.rejected).toBeGreaterThan(0);
  });

  it("a start that cannot be read at all is refused by name, not by symptom", () => {
    // A pupil the trace cannot fill: the mirror clipped to a quarter of the
    // stop leaves too few samples for the fit that was asked for.
    const system = wfMirror(10);
    const starved: OpticalSystem = {
      ...system,
      prescription: { surfaces: [{ ...system.prescription.surfaces[0]!, semiAperture: 1.5 }] },
    };
    expect(() => optimizeSystem(starved, [FOCUS], [wfOperand("rms", WF_GRID, 45)])).toThrow(
      /operand 0 cannot be read at the start — a wavefront operand fitting 45 terms has \d+ of 313 rays surviving/,
    );
  });
});

/**
 * DLS § 1.8.7 — off axis, where keeping tilt is the whole reason `"rms"` and
 * `"balancedRms"` are two readings rather than one.
 *
 * `fitRms` keeps tilt on purpose — `zernike.ts` says why, and § 1.5.3 measures
 * the case that forces the other choice. On axis the distinction is invisible:
 * the tilt and coma terms sit at 10⁻⁷ waves by symmetry, so every rung above
 * would pass with the two readings swapped. Everything that makes them
 * different quantities happens off axis, and that is where it has to be pinned.
 */
describe("DLS § 1.8.7 — off axis, which is where the two RMS readings part", () => {
  const FIELDS = [0.5, 1, 2] as const;
  const OFF_TERMS = 15;

  it("tilt and coma are linear in the field, and are what `balancedRms` discards", () => {
    const at = (field: number) =>
      fitZernike(opdMap(wfMirror(10), field, LINE_D, WF_GRID).samples, OFF_TERMS);

    // On axis both are at the trace's own noise, six orders under the 1° value:
    // this is the symmetry that would let a swapped reading pass unnoticed.
    const axis = at(0);
    expect(Math.abs(coefficient(axis, 2))).toBeLessThan(1e-6);
    expect(Math.abs(coefficient(axis, 8))).toBeLessThan(1e-6);

    // Off axis, tilt (Noll 2) and primary coma (Noll 8) are both first order in
    // the field, which is what says the fit is reading the right terms and not
    // merely producing numbers.
    for (const field of FIELDS) {
      const fit = at(field);
      expect(coefficient(fit, 2) / field).toBeCloseTo(0.2470, 2);
      expect(coefficient(fit, 8) / field).toBeCloseTo(0.08727, 3);
    }

    // …and the exact relation between the two readings, which is Parseval on an
    // orthonormal basis rather than an approximation: what `balancedRms` throws
    // away is precisely tilt and defocus, so rms² − balanced² = c₂² + c₃² + c₄².
    for (const field of FIELDS) {
      const fit = at(field);
      const discarded =
        coefficient(fit, 2) ** 2 + coefficient(fit, 3) ** 2 + coefficient(fit, 4) ** 2;
      expect(fitRms(fit) ** 2 - balancedRms(fit) ** 2).toBeCloseTo(discarded, 12);
    }
    // At 1° that is 0.0974 waves² of a 0.1093 total — most of what `"rms"`
    // charges the design for, and none of it image blur if the instrument is
    // merely pointed differently. Which reading is right is the caller's
    // question; that they are different questions is this rung.
    const one = at(1);
    expect(fitRms(one)).toBeCloseTo(3.3065e-1, 5);
    expect(balancedRms(one)).toBeCloseTo(1.0935e-1, 5);
  });

  it("an off-axis operand starts with a reduced ray set, and holds that one", () => {
    // Six of 313 rays never reach the reference sphere at any nonzero field —
    // the footprint has walked off the mirror's own rim. So the held set here
    // is smaller than the pupil that was asked for from the very first
    // evaluation, which is the survivor machinery meeting a different cause
    // than § 1.8.5's bending-across-a-rim, and reaching the same place.
    expect(opdMap(wfMirror(10), 0, LINE_D, WF_GRID).lost).toBe(0);
    for (const field of FIELDS) expect(opdMap(wfMirror(10), field, LINE_D, WF_GRID).lost).toBe(6);

    const offAxis = (reading: "rms" | "balancedRms"): TracedOperand => ({
      kind: "wavefront",
      fieldValue: 1,
      wavelengthNm: LINE_D,
      pupil: WF_GRID,
      terms: OFF_TERMS,
      reading,
      target: 0,
    });

    // `"rms"` refocuses the field point and stops: the merit is charged for
    // the defocus, so it drives c₄ to 6e-4 and stays put.
    const bounded = optimizeSystem(wfMirror(10), [FOCUS], [offAxis("rms")], { steps: [1e-4] });
    expect(bounded.x[0]! - MIRROR_R / 2).toBeCloseTo(7.7505e-2, 5);
    // Read at the field it was optimised for — reading this plane on axis was
    // the first thing tried here and it says nothing about the run.
    const moved = wfFit(
      { ...wfMirror(10), prescription: withVariables(wfMirror(10).prescription, [FOCUS], bounded.x) },
      WF_GRID,
      OFF_TERMS,
      1,
    );
    expect(Math.abs(coefficient(moved, 4))).toBeLessThan(1e-3);
    // The tilt is untouched by refocusing, which is the point of keeping it:
    // a plane shift cannot mend a chief ray that lands somewhere else.
    expect(coefficient(moved, 2)).toBeCloseTo(0.2471, 3);

    // …and `"balancedRms"` walks 94 mm, the same false minimum as on axis and
    // further, on a start whose ray set was already short of the pupil.
    const forgiving = optimizeSystem(wfMirror(10), [FOCUS], [offAxis("balancedRms")], {
      steps: [1e-4],
    });
    expect(forgiving.x[0]! - MIRROR_R / 2).toBeLessThan(-80);
  });
});

describe("DLS § 1.8.7 — a reading that sums nothing is a merit that measures nothing", () => {
  /**
   * The failure this refusal exists to prevent has the worst shape a failure
   * can have here. `fitRms` sums Noll j = 2… and `balancedRms` sums j = 5…, so
   * a term count below the reading's own first term leaves the sum EMPTY: the
   * residual is exactly zero at every design, the first gradient test passes,
   * and the run returns at iteration one on `"gradient"` — the converged-optimum
   * reason — with merit 0 and the variables exactly where they started.
   *
   * A caller reading that result cannot tell it apart from a design that was
   * already perfect. Measured before the refusal was written, and it is the
   * reason the check is keyed on the reading rather than on the basis.
   */
  it("refuses a term count the reading cannot see past, by name and with the floor", () => {
    expect(() =>
      optimizeSystem(wfMirror(10), [FOCUS], [wfOperand("balancedRms", WF_GRID, 4)]),
    ).toThrow(/reading balancedRms over 4 terms sums nothing — that reading starts at Noll 5/);
    expect(() => optimizeSystem(wfMirror(10), [FOCUS], [wfOperand("rms", WF_GRID, 1)])).toThrow(
      /reading rms over 1 terms sums nothing — that reading starts at Noll 2/,
    );
    // A condition is refused on the same grounds — a constraint that is 0 = 0
    // for every design is not a constraint, and its row would be a zero row in
    // C rather than a dependency the `conditions` stop can report.
    expect(() =>
      optimizeSystem(wfMirror(10), [FOCUS], {
        minimize: [wfOperand("rms")],
        hold: [wfOperand("balancedRms", WF_GRID, 4)],
      }),
    ).toThrow(/sums nothing/);

    // One term past the floor is a legitimate request and is accepted: the
    // boundary is the reading's own first term, not a judgement about whether
    // the fixture happens to excite it.
    expect(() =>
      optimizeSystem(wfMirror(10), [FOCUS], [wfOperand("balancedRms", WF_GRID, 5)], {
        maxIterations: 2,
      }),
    ).not.toThrow();
    // …and `"zernike"` needs no floor of its own: the Noll index is already
    // checked against the term count, so it can never name a term the fit did
    // not compute.
    expect(() =>
      optimizeSystem(wfMirror(10), [FOCUS], [wfZernike(1, 0, WF_GRID, 1)], { maxIterations: 2 }),
    ).not.toThrow();
  });
});

/**
 * § 1.8.8's fixtures. Both are EXACT, because the thing being measured is how
 * an MTF merit behaves at and around a design with no aberration at all, and a
 * fixture with a residual would hide the two effects that matter: the
 * discretization bias, and the shape of the merit at its own floor.
 */
const MTF_R = -400;
const mtfParabola = (conic: number, thickness = MTF_R / 2, semi = 40): OpticalSystem => ({
  prescription: {
    surfaces: [
      { kind: "reflect", curvature: 1 / MTF_R, conic, semiAperture: semi, thickness, isStop: true },
    ],
  },
  aperture: { kind: "stopRadius", value: semi },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LINE_D, weight: 1 }],
  conjugate: { kind: "infinite" },
});

const MTF_SAMPLES = 32;
const mtfRead = (system: OpticalSystem, nu: number, pupilSamples = MTF_SAMPLES): number => {
  const image = psf(system, 0, LINE_D, { pupilSamples, padFactor: 4 });
  return mtfAt(mtf(image), nu, image.pupilSamples);
};
const mtfOperand = (
  nu: number,
  target: number,
  pupilSamples = MTF_SAMPLES,
): TracedOperand => ({
  kind: "mtf",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  nu,
  pupilSamples,
  target,
});

/**
 * DLS § 1.8.8 — CONTRAST as an operand, and the one merit here that is not safe
 * to hand an optimiser on its own.
 *
 * The last piece of § 1.8's "targets on traced quantities", and the only one
 * with a transform between the design and the residual. Structurally it is the
 * wavefront operand plus an FFT — same trace, same fit, same held survivor set,
 * taken from `systemPupil` so there is one definition of a system's pupil
 * rather than two. What is new is entirely in what the transform does to the
 * merit's SHAPE, and three of the four things below were not what this ladder
 * expected.
 */
describe("DLS § 1.8.8 — the MTF reads above the closed form, and the grid says by how much", () => {
  /**
   * The pin that cannot be the obvious one.
   *
   * A real system cannot beat the diffraction-limited MTF
   * (2/π)(arccos ν − ν√(1−ν²)), so that closed form looked like a target with a
   * zero residual at a perfect design. It is not: a sampled pupil's
   * autocorrelation over-counts its own edge, so the engine reads ABOVE the
   * closed form on a paraboloid whose Strehl is exactly 1. The excess is
   * first order in the sampling — bias·pupilSamples is one number — which is
   * what makes it a discretization law rather than a discrepancy, and it is the
   * square-grid-on-a-disc counting of § 6ab.17 arriving in a third place.
   *
   * So an operand told to hit `diffractionLimitedMtf` would report a residual
   * at a perfect design and go looking for the grid. The reachable target is
   * the engine's own ceiling at the sampling the caller stated, which the rung
   * after next reaches exactly.
   */
  it("a Strehl-1 paraboloid reads 0.66/pupilSamples ABOVE the closed form", () => {
    for (const pupilSamples of [16, 32, 64, 128]) {
      const image = psf(mtfParabola(-1), 0, LINE_D, { pupilSamples, padFactor: 4 });
      expect(image.strehl).toBeCloseTo(1, 9);
      for (const nu of [0.25, 0.5]) {
        const bias = mtfAt(mtf(image), nu, image.pupilSamples) / diffractionLimitedMtf(nu) - 1;
        // Positive at every sampling: it is over-counting, not aberration.
        expect(bias).toBeGreaterThan(0);
        // …and bias·N is one number, 0.65…0.76, falling toward ~0.65 as the
        // grid refines. Halving the sampling doubles the error.
        expect(bias * pupilSamples).toBeGreaterThan(0.64);
        expect(bias * pupilSamples).toBeLessThan(0.76);
      }
    }
    // The numbers themselves, so a change in the transform has to edit them.
    const at = (n: number) =>
      mtfAt(mtf(psf(mtfParabola(-1), 0, LINE_D, { pupilSamples: n, padFactor: 4 })), 0.5, n);
    expect(at(32) / diffractionLimitedMtf(0.5) - 1).toBeCloseTo(2.1797e-2, 6);
    expect(at(64) / diffractionLimitedMtf(0.5) - 1).toBeCloseTo(1.0580e-2, 6);
  });

  /**
   * …and the OTHER sampling knob does not move the reading at all, which is why
   * one is a required field of the operand and the other has a default. Padding
   * buys image-plane sampling — points BETWEEN the frequency bins — and the
   * value at a bin is set by the pupil sampling alone.
   */
  it("padFactor does not move the reading; pupilSamples is the knob that does", () => {
    const values = [2, 4, 8].map(
      (padFactor) =>
        mtfAt(
          mtf(psf(mtfParabola(-1), 0, LINE_D, { pupilSamples: 32, padFactor })),
          0.5,
          32,
        ),
    );
    // To one ulp, not to the bit: three padding factors are three different FFT
    // sizes and therefore three different summation orders. On this fixture
    // they happen to agree exactly and on the concentric one the widest pad is
    // a single ulp away, so `toBe` here would have been an assertion about
    // accumulation order wearing the clothes of a claim about optics.
    for (const v of values) expect(Math.abs(v / values[0]! - 1)).toBeLessThan(4 * Number.EPSILON);
    // …where changing the PUPIL sampling moves it in the second figure.
    expect(Math.abs(mtfRead(mtfParabola(-1), 0.5, 64) / values[0]! - 1)).toBeGreaterThan(1e-2);
  });

  /**
   * The shape of the merit at a zero-aberration optimum, and it is the OPPOSITE
   * of § 1.8.5's.
   *
   * A traced spot and a wavefront RMS are NORMS, so at a perfect design they
   * grow like |δ| — a corner, which is why § 1.8.2's square-root law did not
   * apply to them. Contrast is quadratic in the wavefront error, so this one is
   * a genuine bowl: the deficit below the ceiling is (488.5)·ΔK², constant to
   * three figures over two decades of ΔK and symmetric in the sign.
   */
  it("at a perfect design this merit is a BOWL, where every other traced one is a corner", () => {
    const ceiling = mtfRead(mtfParabola(-1), 0.5, 64);
    const curvature: number[] = [];
    for (const dk of [3e-3, 1e-3, 3e-4, 1e-4]) {
      const below = ceiling - mtfRead(mtfParabola(-1 - dk), 0.5, 64);
      const above = ceiling - mtfRead(mtfParabola(-1 + dk), 0.5, 64);
      // Symmetric to 5e-5 — the residue is the cubic term, and a corner would
      // be symmetric too. What tells them apart is the exponent, below.
      expect(below / above).toBeCloseTo(1, 3);
      curvature.push(below / dk ** 2);
    }
    // Approached from below as ΔK shrinks — 486.4 at 3e-3, then 488.3, 488.5,
    // 488.5 — the quartic term retiring and leaving one constant.
    expect(curvature[0]!).toBeCloseTo(486.4, 0);
    for (const c of curvature.slice(1)) expect(c).toBeCloseTo(488.4, 0);
    // And the discriminator, stated as the thing a corner cannot do: deficit/ΔK
    // is NOT constant — it falls by the same factor ΔK does.
    const linear = [3e-3, 1e-4].map((dk) => (ceiling - mtfRead(mtfParabola(-1 - dk), 0.5, 64)) / dk);
    expect(linear[0]! / linear[1]!).toBeCloseTo(30, 0);
  });

  it("differences over four decades of step, off the optimum", () => {
    // Off the optimum, because at the bottom of a bowl the true derivative is
    // zero and a step ladder there measures the floor and nothing else.
    const k0 = -0.995;
    const d = (h: number) => (mtfRead(mtfParabola(k0 + h), 0.5, 64) - mtfRead(mtfParabola(k0 - h), 0.5, 64)) / (2 * h);
    const v = [-4, -5, -6, -7].map((e) => d(10 ** e));
    const spread = (Math.max(...v) - Math.min(...v)) / Math.abs(v[0]!);
    expect(spread).toBeLessThan(1e-4);
    expect(d(1e-5)).toBeCloseTo(-4.77089865, 5);
  });
});

describe("DLS § 1.8.8 — one frequency is not a merit, and the impostor proves it", () => {
  const CONJUGATE = 400;

  it("reaches the engine's own ceiling EXACTLY, from inside the basin", () => {
    const ceiling = mtfRead(concentricMirror(-CONJUGATE, CONJUGATE), 0.5);
    // The reachable target, not the closed form — 2.2% above it at this grid.
    expect(ceiling / diffractionLimitedMtf(0.5) - 1).toBeCloseTo(2.1797e-2, 6);

    const r = optimizeSystem(
      concentricMirror(-CONJUGATE + 0.05, CONJUGATE),
      [RADIUS],
      [mtfOperand(0.5, ceiling)],
      { steps: [1e-9] },
    );
    // Merit exactly zero: the run reproduces the perfect design's own reading
    // bit for bit, and the radius to 1e-9 relative.
    expect(r.merit).toBeLessThan(1e-30);
    expect(Math.abs(1 / r.x[0]! + CONJUGATE) / CONJUGATE).toBeLessThan(1e-8);
  });

  /**
   * **The finding this sub-step exists for.**
   *
   * The OTF changes sign as aberration grows and the MTF is its modulus, so
   * contrast at ONE frequency is not monotone in how good the design is: a
   * far-out side lobe reads as high contrast. On this fixture there is a design
   * at 2.31 waves RMS — Strehl 0.0075, 133× worse than diffraction-limited, an
   * image that is gone — whose modulation at ν = 0.5 sits within **2.8·10⁻⁴**
   * of the perfect system's.
   *
   * An optimiser started outside the basin walks straight to it and stops with
   * a merit of 7.7·10⁻⁸, which no caller reading the result could tell from the
   * true answer's zero. That is not a convention that can be fixed the way
   * `"balancedRms"`'s false minimum was: it is what contrast at a frequency IS.
   */
  it("an impostor at 2.31 waves matches the perfect design to 2.8e-4 at one frequency", () => {
    const impostorR = -399.52717849;
    const perfect = concentricMirror(-CONJUGATE, CONJUGATE);
    const impostor = concentricMirror(impostorR, CONJUGATE);

    // It is genuinely ruined, by every other readout the engine has.
    const image = psf(impostor, 0, LINE_D, { pupilSamples: MTF_SAMPLES, padFactor: 4 });
    expect(image.strehl).toBeCloseTo(7.507e-3, 5);
    expect(fitRms(wfFit(impostor, pupilGrid(21), 28))).toBeCloseTo(2.3084, 3);

    // …and indistinguishable at ν = 0.5.
    expect(Math.abs(mtfRead(impostor, 0.5) - mtfRead(perfect, 0.5))).toBeLessThan(3e-4);

    // A single-frequency run started 0.1 mm out lands on it and reports a merit
    // four orders under anything a caller would question.
    const fooled = optimizeSystem(
      concentricMirror(-CONJUGATE + 0.1, CONJUGATE),
      [RADIUS],
      [mtfOperand(0.5, mtfRead(perfect, 0.5))],
      { steps: [1e-9] },
    );
    expect(fooled.merit).toBeLessThan(1e-6);
    expect(Math.abs(1 / fooled.x[0]! + CONJUGATE)).toBeGreaterThan(0.4);
  });

  /**
   * …and the fix, which is a second operand rather than a cleverer one. The
   * impostor is degenerate at ν = 0.5 and nowhere else — 0.826 against 0.0045
   * at ν = 0.15 — so a merit over two frequencies separates the two designs by
   * three orders and converges from the start that fooled the single one.
   *
   * It widens the basin; it does not abolish multimodality. Started 0.2 mm out
   * the two-frequency merit still lands somewhere else, and says so with a
   * residual that is visible rather than tiny. `solve.ts`'s convention, which
   * this file has kept throughout: a run reports the basin it landed in.
   */
  it("a second frequency separates them by three orders and widens the basin", () => {
    const perfect = concentricMirror(-CONJUGATE, CONJUGATE);
    const impostor = concentricMirror(-399.52717849, CONJUGATE);
    for (const nu of [0.15, 0.3, 0.7]) {
      expect(Math.abs(mtfRead(impostor, nu) - mtfRead(perfect, nu))).toBeGreaterThan(0.18);
    }
    expect(Math.abs(mtfRead(impostor, 0.15) - mtfRead(perfect, 0.15))).toBeGreaterThan(0.8);

    const both = [mtfOperand(0.5, mtfRead(perfect, 0.5)), mtfOperand(0.15, mtfRead(perfect, 0.15))];
    const rescued = optimizeSystem(concentricMirror(-CONJUGATE + 0.1, CONJUGATE), [RADIUS], both, {
      steps: [1e-9],
    });
    expect(rescued.merit).toBeLessThan(1e-30);
    expect(Math.abs(1 / rescued.x[0]! + CONJUGATE) / CONJUGATE).toBeLessThan(1e-8);

    // The boundary, stated rather than left to be met.
    const beyond = optimizeSystem(concentricMirror(-CONJUGATE + 0.2, CONJUGATE), [RADIUS], both, {
      steps: [1e-9],
    });
    expect(Math.abs(1 / beyond.x[0]! + CONJUGATE)).toBeGreaterThan(1);
    expect(beyond.merit).toBeGreaterThan(1e-2);
  });

  it("refuses a frequency at which nothing is being measured", () => {
    for (const nu of [0, 1, 1.5, -0.2]) {
      expect(() =>
        optimizeSystem(mtfParabola(-1), [FOCUS], [mtfOperand(nu, 0.3)]),
      ).toThrow(/the modulation is defined on \(0, 1\)/);
    }
    expect(() => optimizeSystem(mtfParabola(-1), [FOCUS], [mtfOperand(0.5, 0.3, 1)])).toThrow(
      /the FFT grid needs an integer of at least 2/,
    );
    expect(() => optimizeSystem(mtfParabola(-1), [FOCUS], [mtfOperand(0.5, 0.3, 33)])).toThrow(
      /operand 0 cannot be read at the start/,
    );
  });
});

/**
 * DLS § 1.8.8 — off axis, the direction the operand actually reads, and the
 * one code path an on-axis rung can never reach.
 *
 * Every rung above is at field 0, where the pattern is rotationally symmetric —
 * so none of them can tell the tangential section from the sagittal one, and
 * the type's claim to be reading a particular direction had no evidence. Off
 * axis it also changes what RUNS: `systemPupil` builds a vignette mask only
 * when the trace has already lost something, and these fixtures lose nothing on
 * axis, so the masked branch had never once been exercised through this
 * operand.
 */
describe("DLS § 1.8.8 — off axis, where the operand's direction becomes a claim", () => {
  const OFF_GRID = pupilGrid(21);

  it("`mtfAt` is the TANGENTIAL section, and off axis the two part company", () => {
    for (const field of [0, 1, 2]) {
      const image = psf(wfMirror(10), field, LINE_D, { pupilSamples: 32, padFactor: 4 });
      const m = mtf(image);
      const sections = mtfSections(m, 33, image.pupilSamples);
      const i = 8; // ν = 0.25 exactly, on this bin count
      expect(sections.nu[i]).toBeCloseTo(0.25, 12);
      // The convention, pinned rather than asserted in a comment: what the
      // operand reads is the x-section, to the bit.
      expect(mtfAt(m, sections.nu[i]!, image.pupilSamples)).toBe(sections.tangential[i]!);
      if (field === 0) {
        // Rotationally symmetric, which is exactly why this rung had to be
        // written at a field and not on the axis.
        expect(sections.tangential[i]).toBe(sections.sagittal[i]!);
      }
    }
    // And they split, in the direction an off-axis mirror's coma and
    // astigmatism put the blur: 0.2% at 1° and 27% at 2°.
    const at = (field: number) => {
      const image = psf(wfMirror(10), field, LINE_D, { pupilSamples: 32, padFactor: 4 });
      const s = mtfSections(mtf(image), 33, image.pupilSamples);
      return s.tangential[8]! / s.sagittal[8]!;
    };
    expect(at(1)).toBeCloseTo(0.99770, 4);
    expect(at(2)).toBeCloseTo(0.73149, 4);
  });

  it("off axis the masked pupil branch runs, and the cost figure survives it", () => {
    // The branch: six of 313 traced rays are lost at any nonzero field, so
    // `systemPupil` builds a vignette mask and the pupil amplitude re-aims and
    // re-traces per grid point. On axis nothing is lost and it never runs.
    expect(opdMap(wfMirror(10), 0, LINE_D, OFF_GRID).lost).toBe(0);
    expect(opdMap(wfMirror(10), 1, LINE_D, OFF_GRID).lost).toBe(6);

    // It is a real extra cost and it is not an order of magnitude: measured
    // ~16% at 32 pupil samples and ~21% at 64, so § 1.8.8's ~7 000× is an
    // on-axis number that stays the right size off axis. Asserted as a bound
    // rather than a value — a timing is about the machine, and what this rung
    // is for is that the masked path does not change the SHAPE of the cost.
    const time = (field: number): number => {
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) {
        const image = psf(wfMirror(10), field, LINE_D, { pupilSamples: 32, padFactor: 4 });
        mtfAt(mtf(image), 0.25, image.pupilSamples);
      }
      return performance.now() - t0;
    };
    time(0); // warm
    expect(time(1)).toBeLessThan(time(0) * 4);

    // …and the operand itself runs there, which is the whole point of the field.
    const image = psf(wfMirror(10), 1, LINE_D, { pupilSamples: 32, padFactor: 4 });
    const r = optimizeSystem(
      wfMirror(10),
      [FOCUS],
      [
        {
          kind: "mtf",
          fieldValue: 1,
          wavelengthNm: LINE_D,
          nu: 0.25,
          pupilSamples: 32,
          target: 1,
        },
      ],
      { steps: [1e-4], maxIterations: 30 },
    );
    // Asked for a contrast no system can reach, so this is a refocus rather
    // than a solve: it moves the plane and stops with its residual reported.
    expect(mtfAt(mtf(image), 0.25, image.pupilSamples)).toBeCloseTo(0.33421, 4);
    expect(r.x[0]! - MIRROR_R / 2).toBeGreaterThan(0);
    expect(r.merit).toBeGreaterThan(0.1);
  });

  /**
   * The operand's central design decision, measured rather than argued.
   *
   * ν was chosen over cycles/mm because in ν the sample position is the
   * caller's own arithmetic and cannot drift. That is only worth saying if the
   * alternative really would drift, so: `pixelScaleMm` moves with the image
   * distance — and, on this fixture, is bit-identical across a 30% change of
   * curvature, because the stop is the mirror and the exit pupil does not move
   * with its power. Both halves matter. A frequency in cycles/mm would ride the
   * first and not the second, which is a merit whose ruler depends on WHICH
   * variable an optimiser happens to be moving.
   */
  it("pixelScaleMm moves with the image distance and not with the curvature", () => {
    const scaleOf = (thickness: number, curvature: number): number =>
      psf(
        { ...wfMirror(10), prescription: { surfaces: [{ ...wfMirror(10).prescription.surfaces[0]!, thickness, curvature }] } },
        0,
        LINE_D,
        { pupilSamples: 32, padFactor: 4 },
      ).pixelScaleMm;

    const base = scaleOf(MIRROR_R / 2, 1 / MIRROR_R);
    expect(base).toBeCloseTo(7.3445225e-4, 11);
    // It rides the reference distance exactly — `imagePixelScaleMm` is linear
    // in it — so half a millimetre of focus is 0.5% of the ruler and five
    // millimetres is 5%. That is the drift a frequency in cycles/mm would sit on.
    for (const dz of [-0.5, -5]) {
      const moved = scaleOf(MIRROR_R / 2 + dz, 1 / MIRROR_R);
      expect(moved / base).toBeCloseTo((MIRROR_R / 2 + dz) / (MIRROR_R / 2), 12);
    }
    expect(scaleOf(MIRROR_R / 2 - 5, 1 / MIRROR_R) / base - 1).toBeCloseTo(5.0e-2, 6);
    // …and a 30% change of curvature moves it not at all, to the bit.
    for (const curvature of [1 / -210, 1 / -260]) {
      expect(scaleOf(MIRROR_R / 2, curvature)).toBe(base);
    }
  });
});

/**
 * DLS § 1.8.8 — and a held MTF, which `{ minimize, hold }` accepts and which
 * therefore needs a rung rather than a comment.
 *
 * Holding a MULTIMODAL quantity as an equality constraint is not obviously
 * sound, and the honest position is § 1.8.6's: the condition is a Newton solve
 * embedded in a minimisation, so it reaches the nearest design that satisfies
 * it and reports the basin it landed in — exactly what a wish over the same
 * quantity does. Started inside the basin it behaves like any other condition.
 */
describe("DLS § 1.8.8 — a contrast held exactly, and a multiplier that says it is free", () => {
  it("holds one frequency while another is minimised, and prices it at zero", () => {
    const d = 400;
    const perfect = concentricMirror(-d, d);
    const r = optimizeSystem(
      concentricMirror(-d + 0.03, d),
      [RADIUS],
      {
        minimize: [mtfOperand(0.15, mtfRead(perfect, 0.15))],
        hold: [mtfOperand(0.5, mtfRead(perfect, 0.5))],
      },
      { steps: [1e-9] },
    );
    expect(r.reason).toBe("gradient");
    expect(Math.abs(r.constraints[0]!)).toBeLessThan(1e-12);
    expect(Math.abs(1 / r.x[0]! + d) / d).toBeLessThan(1e-10);
    // λ ≈ 0, and that is a statement rather than a rounding: § 1.8.6's rung on
    // the zero-residual achromat is the same fact. Both frequencies peak at the
    // same design, so holding one costs the other nothing and the envelope
    // theorem has nothing to charge for.
    expect(Math.abs(r.multipliers[0]!)).toBeLessThan(1e-9);
    expect(r.merit).toBeLessThan(1e-25);
  });
});

/**
 * DLS § 1.8.9 — what the variables can do, before anything is optimised.
 *
 * Every rung above chooses a variable set and never asks what it chose. This
 * one asks. `variableResponse` differences the SAME Jacobian the run does and
 * reports its geometry: each variable's response, the angles between them, and
 * the singular values of the set scaled to unit columns.
 *
 * **The external number is the achromat's own.** For a zero-thickness cemented
 * doublet the two outer curvatures enter the two wishes in closed form —
 * ∂φ/∂c₁ = n₁−1 and ∂(φ_F−φ_C)/∂c₁ = (n₁−1)/V₁, and the same with a minus sign
 * and the flint's numbers for c₃ — so the whole 2 × 2 Jacobian is textbook.
 * Scaled to unit columns the indices cancel exactly and what is left depends on
 * the two ABBE NUMBERS ALONE:
 *
 *     cos = (1 + ρ²/(V₁V₂)) / √((1 + ρ²/V₁²)(1 + ρ²/V₂²)),   κ = √((1+cos)/(1−cos))
 *
 * with ρ the ratio of the two wishes' weights. Not the indices, not the
 * curvatures, not the focal length asked for: an achromat's design problem is
 * as well conditioned as its two glasses are far apart in dispersion, and by
 * exactly that much. At equal weights κ ≈ 2/|1/V₁ − 1/V₂|.
 *
 * And a thin lens in air, asked only for power, is EXACTLY degenerate in its
 * two curvatures — bending does not change power — so the readout has a
 * fixture whose answer is 0 and 1 rather than a tolerance.
 */
describe("DLS § 1.8.9 — the variable set's own geometry, read before the run", () => {
  /** A zero-thickness singlet: φ = (n−1)(c₁−c₂), exactly. */
  function thinSinglet(c1: number, c2: number): Prescription {
    return {
      surfaces: [
        { kind: "refract", curvature: c1, semiAperture: 25, thickness: 0, medium: CROWN, isStop: true },
        { kind: "refract", curvature: c2, semiAperture: 25, thickness: 100, medium: "AIR" },
      ],
    };
  }
  const POWER_ONLY: OptimizeOperand[] = [
    { kind: "power", wavelengthNm: LINE_D, target: 1 / 500 },
  ];

  it("bending is the direction a power wish cannot see, and the readout says so exactly", () => {
    const r = variableResponse(thinSinglet(0.01, -0.01), SINGLET_VARS, POWER_ONLY);

    // Both columns are the thin-lens closed form, to the differencing floor.
    expect(r.response[0]!).toBeCloseTo(nCrown - 1, 12);
    expect(r.response[1]!).toBeCloseTo(nCrown - 1, 12);
    expect(r.dead).toEqual([]);

    // …and they are the same column twice, up to sign: one wish, and a wish
    // that depends on c₁ − c₂ only.
    expect(r.cosines[0]![1]!).toBe(1);
    expect(r.worstPair).toEqual({ a: 0, b: 1, cosine: 1 });
    expect(r.singularValues[0]!).toBeCloseTo(Math.SQRT2, 12);
    expect(r.singularValues[1]!).toBe(0);
    expect(r.conditionNumber).toBe(Infinity);

    // The direction it cannot see is (1, 1)/√2 — both curvatures moving
    // together, which is what BENDING is: § 1.8.1's shape factor q traverses
    // exactly this line, and that is why a best-form fixture can hold power
    // while it bends.
    expect(r.weakest[0]!).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r.weakest[1]!).toBeCloseTo(Math.SQRT1_2, 12);

    // Not an inference from the Jacobian: the lens itself, bent along that
    // direction, has the same power to the last bit.
    const straight = thinSinglet(0.01, -0.01);
    const bent = thinSinglet(0.01 + 1e-4, -0.01 + 1e-4);
    const steeper = thinSinglet(0.01 + 1e-4, -0.01);
    const power = (p: Prescription) => 1 / systemProperties(p, LINE_D).efl;
    expect(Math.abs(power(bent) / power(straight) - 1)).toBeLessThan(1e-15);
    expect(power(steeper) - power(straight)).toBeCloseTo((nCrown - 1) * 1e-4, 12);
  });

  /** cos between the two outer curvatures' columns, from the Abbe numbers alone. */
  const cosFromAbbe = (v1: number, v2: number, rho = 1): number =>
    (1 + (rho * rho) / (v1 * v2)) /
    Math.sqrt((1 + (rho * rho) / (v1 * v1)) * (1 + (rho * rho) / (v2 * v2)));
  const kappaFromCos = (cos: number): number => Math.sqrt((1 + cos) / (1 - cos));

  const pairResponse = (
    crown: string,
    flint: string,
    c1 = 0.02,
    c2 = C_MID,
    c3 = -0.01,
    focal = 100,
    weights: readonly [number, number] = [1, 1],
  ) =>
    variableResponse(
      {
        surfaces: [
          { kind: "refract", curvature: c1, semiAperture: 25, thickness: 0, medium: crown, isStop: true },
          { kind: "refract", curvature: c2, semiAperture: 25, thickness: 0, medium: flint },
          { kind: "refract", curvature: c3, semiAperture: 25, thickness: 100, medium: "AIR" },
        ],
      },
      SPLIT_VARS,
      [
        { kind: "power", wavelengthNm: LINE_D, target: 1 / focal, weight: weights[0] },
        { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0, weight: weights[1] },
      ],
    );

  it("an achromat's conditioning is a function of the two Abbe numbers ALONE", () => {
    for (const [crown, flint] of [
      [CROWN, FLINT],
      ["CAF2", FLINT],
      [CROWN, "D263"],
      [CROWN, "FUSED-SILICA"],
    ] as const) {
      const v1 = abbeNumber(getMedium(crown));
      const v2 = abbeNumber(getMedium(flint));
      const r = pairResponse(crown, flint);
      const cos = cosFromAbbe(v1, v2);
      expect(Math.abs(r.cosines[0]![1]! / cos - 1)).toBeLessThan(1e-13);
      expect(Math.abs(r.conditionNumber / kappaFromCos(cos) - 1)).toBeLessThan(1e-9);
      // …and the simple form of the same statement, good to a part in 500:
      // twice the reciprocal of the two glasses' dispersive-power difference.
      expect(Math.abs(r.conditionNumber / (2 / Math.abs(1 / v1 - 1 / v2)) - 1)).toBeLessThan(2e-3);
    }
  });

  it("neither the indices, nor the curvatures, nor the focal length asked for move it", () => {
    const base = pairResponse(CROWN, FLINT);
    // A different starting lens, a different cemented face, a target 2.5×
    // away: the same conditioning to eleven figures, because the columns'
    // DIRECTIONS carry only the two glasses.
    const elsewhere = pairResponse(CROWN, FLINT, 0.03, -1 / 40, -0.02, 250);
    expect(Math.abs(elsewhere.conditionNumber / base.conditionNumber - 1)).toBeLessThan(1e-9);
    // The responses themselves are not invariant — they are the columns'
    // LENGTHS over BOTH wishes, (n−1)·√(1+1/V²) in 1/mm per 1/mm, and those
    // carry the indices. The rung was written asserting (n−1) alone and was
    // wrong by the 1.2·10⁻⁴ that the colour row contributes.
    expect(base.response[0]!).toBeCloseTo((nCrown - 1) * Math.sqrt(1 + 1 / vCrown ** 2), 12);
    expect(base.response[1]!).toBeCloseTo((nFlint - 1) * Math.sqrt(1 + 1 / vFlint ** 2), 12);
    expect(base.conditionNumber).toBeCloseTo(167.9534, 3);
  });

  it("the weights are inside the geometry, and their best setting is √(V₁V₂)", () => {
    const rhoStar = Math.sqrt(vCrown * vFlint);
    const kappaAt = (rho: number) => pairResponse(CROWN, FLINT, 0.02, C_MID, -0.01, 100, [1, rho]).conditionNumber;

    // The closed form holds across four decades of the weight ratio.
    for (const rho of [1, 10, rhoStar, 100, 1e4]) {
      expect(Math.abs(kappaAt(rho) / kappaFromCos(cosFromAbbe(vCrown, vFlint, rho)) - 1)).toBeLessThan(1e-9);
    }

    // …and it has a MINIMUM, at the geometric mean of the two Abbe numbers:
    // 7.09, against 168 at the equal weights a panel would offer by default.
    // A weight is usually argued about as an exchange rate between wishes;
    // this is the other thing it does, and nothing on a screen says so.
    const best = kappaAt(rhoStar);
    expect(best).toBeCloseTo(7.0914, 3);
    for (const away of [0.5, 0.8, 1.25, 2]) expect(kappaAt(rhoStar * away)).toBeGreaterThan(best);
    expect(kappaAt(1) / best).toBeCloseTo(23.68, 2);
  });

  it("the CURRENCY moves it by three and a half orders — § 1.8.3's finding, on the variables", () => {
    const inPower = pairResponse(CROWN, FLINT).conditionNumber;
    const inFocal = variableResponse(doublet(0.02, C_MID, -0.01), SPLIT_VARS, [
      { kind: "efl", wavelengthNm: LINE_D, target: 100 },
      { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0 },
    ]).conditionNumber;
    expect(inPower).toBeCloseTo(167.9534, 3);
    expect(inFocal / inPower).toBeGreaterThan(4.5e3);
    expect(inFocal / inPower).toBeLessThan(4.6e3);
  });

  it("a dead variable is not a degenerate pair, and is not allowed to look like one", () => {
    // The last surface's thickness is the distance to an image plane no
    // first-order wish here mentions: its column is exactly zero.
    const r = variableResponse(
      doublet(0.02, C_MID, -0.01),
      [...SPLIT_VARS, { kind: "thickness", surface: 2 }],
      [...SPLIT_OPERANDS],
    );
    expect(r.dead).toEqual([2]);
    expect(r.response[2]!).toBe(0);
    expect(r.cosines[2]!.every((c) => Number.isNaN(c))).toBe(true);
    expect(Number.isNaN(r.cosines[0]![2]!)).toBe(true);
    expect(r.weakest[2]!).toBe(0);
    // …and the two live variables' conditioning is untouched by its presence,
    // to the bit. A dead column sent through the singular values would have
    // read κ = ∞ and said nothing about the pair that is alive.
    expect(r.conditionNumber).toBe(pairResponse(CROWN, FLINT).conditionNumber);
    expect(r.singularValues).toHaveLength(2);
  });

  it("more variables than wishes: the surplus σ is 0 by RANK, not by rounding", () => {
    const three: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
      { kind: "curvature", surface: 2 },
    ];
    const r = variableResponse(doublet(0.02, C_MID, -0.01), three, [...SPLIT_OPERANDS]);
    // Two wishes cannot see three directions. One-sided Jacobi leaves the third
    // column at 10⁻¹⁶², which is not a small number about the design — it is an
    // arithmetic artefact, and reported as κ = 10¹⁶¹ it would read as one.
    expect(r.singularValues[2]!).toBe(0);
    expect(r.conditionNumber).toBe(Infinity);
    expect(r.dead).toEqual([]);
    expect(r.worstPair!.a).toBe(0);
    expect(r.worstPair!.b).toBe(2);
  });

  it("…and THAT is what the second start is disagreeing about", () => {
    // The panel's basin control runs the optimisation again from a nudged
    // start and reports whether the two agreed. On a rank-deficient set they
    // do not — and a reader told only that would conclude there are two
    // minima. There are not: both runs reach the SAME merit, at different
    // points of the flat direction the readout above names.
    const three: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
      { kind: "curvature", surface: 2 },
    ];
    const start = doublet(0.02, C_MID, -0.01);
    const nudged = withVariables(start, three, [0.02 * 1.08, C_MID * 1.08, -0.01 * 1.08]);
    const a = optimizePrescription(start, three, [...SPLIT_OPERANDS], { maxIterations: 200 });
    const b = optimizePrescription(nudged, three, [...SPLIT_OPERANDS], { maxIterations: 200 });
    const worst = Math.max(
      ...a.x.map((v, i) => Math.abs(b.x[i]! - v) / Math.max(Math.abs(v), Math.abs(b.x[i]!), 1e-12)),
    );
    expect(worst).toBeGreaterThan(1e-3);
    expect(a.merit).toBeLessThan(1e-30);
    expect(b.merit).toBeLessThan(1e-30);

    // The same two starts on the two-variable set, whose σ_min is 168× down
    // and not 0, agree to fourteen figures.
    const c = optimizePrescription(start, SPLIT_VARS, [...SPLIT_OPERANDS], { maxIterations: 200 });
    const d = optimizePrescription(
      withVariables(start, SPLIT_VARS, [0.02 * 1.08, -0.01 * 1.08]),
      SPLIT_VARS,
      [...SPLIT_OPERANDS],
      { maxIterations: 200 },
    );
    const worstTwo = Math.max(
      ...c.x.map((v, i) => Math.abs(d.x[i]! - v) / Math.max(Math.abs(v), Math.abs(d.x[i]!), 1e-12)),
    );
    expect(worstTwo).toBeLessThan(1e-12);
  });

  it("THE FINDING: the rejected-step count does not carry this signal — it moves the OTHER WAY", () => {
    // APP.md said the damping's rejected-step count was most of this signal
    // already, and offered that as the reason a degeneracy readout might not
    // be needed. Measured on one lens with one set of variables, where the
    // only thing that changes is a weight: six orders of conditioning, and the
    // rejections FALL while it happens.
    const seen: { kappa: number; rejected: number; iterations: number; x: readonly number[] }[] = [];
    for (const w of [1, 1e2, 1e4, 1e6]) {
      const operands: OptimizeOperand[] = [
        { kind: "power", wavelengthNm: LINE_D, target: PHI, weight: w },
        { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0 },
      ];
      const start = doublet(0.02, C_MID, -0.01);
      const r = variableResponse(start, SPLIT_VARS, operands);
      const run = optimizePrescription(start, SPLIT_VARS, operands, { maxIterations: 200 });
      seen.push({ kappa: r.conditionNumber, rejected: run.rejected, iterations: run.iterations, x: run.x });
    }
    expect(seen[0]!.kappa).toBeCloseTo(167.9534, 3);
    expect(seen[3]!.kappa / seen[0]!.kappa).toBeGreaterThan(9e5);
    // Above the first decade the conditioning is simply proportional to the
    // weight: one row grows and the columns line up with it.
    expect(seen[3]!.kappa / seen[2]!.kappa).toBeCloseTo(100, -1);
    expect(seen.map((s) => s.rejected)).toEqual([6, 5, 2, 1]);
    expect(seen.map((s) => s.iterations)).toEqual([20, 26, 31, 40]);
    // And the ANSWER is untouched: at a zero-residual optimum the conditioning
    // is spent on iterations, not on digits. It is the merits that cannot
    // reach zero where a κ of 10⁸ would also cost accuracy — which is why this
    // readout is a warning about the QUESTION and not a prediction of failure.
    for (const s of seen) {
      expect(s.x[0]!).toBeCloseTo(seen[0]!.x[0]!, 12);
      expect(s.x[1]!).toBeCloseTo(seen[0]!.x[1]!, 12);
    }
  });

  it("what it costs, and what it refuses", () => {
    const r = variableResponse(doublet(0.02, C_MID, -0.01), SPLIT_VARS, [...SPLIT_OPERANDS]);
    // One evaluation at the design, then the central stencil's two per variable.
    expect(r.evaluations).toBe(5);
    expect(r.merit).toBeGreaterThan(0);

    // A condition is not part of a merit, and the geometry it leaves behind is
    // a different object — so it is declined rather than silently dropped.
    expect(() =>
      meritResponse(() => ({ minimize: [1], hold: [1] }), [1]),
    ).toThrow(/condition/);
    // A starting point that is not a system has no response to read.
    expect(() => meritResponse(() => [Number.NaN], [1])).toThrow(/not a system/);
    expect(() => variableResponse(doublet(0.02, C_MID, -0.01), [], [...SPLIT_OPERANDS])).toThrow(
      /no variables/,
    );
  });
});

/**
 * DLS § 1.8.10 — the same question where the merit TRACES.
 *
 * § 1.8.9 reads what a merit can see of a variable set, and reads it off a
 * PRESCRIPTION — so it can difference a power wish and cannot see a spot at
 * all, because a spot has a field, an aperture and a conjugate and a
 * prescription has none of them. `systemResponse` is that reader where
 * `optimizeSystem` already lives: the same builder as the run, survivor lock
 * included, so what a caller is shown about a variable set is what the step
 * would be computed from.
 *
 * **The external number is the classical defocus relation**, and it is a
 * closed form for a COLUMN rather than for an operand's value — which is what
 * a response rung needs, and what most textbook aberration formulas do not
 * give. Move the image plane by δz and the wavefront gains
 *
 *     W(ρ) = (h/R)²·ρ²·δz/2                       [the two spheres' sag]
 *
 * with h the marginal ray's height at the exit-pupil plane and R the reference
 * sphere's radius. Noll's Z₄ = √3(2ρ² − 1) takes the ρ² projection with the
 * same factor 1/(2√3) that ρ⁴ would, so
 *
 *     ∂a₄/∂z = (h/R)²·10⁶ / (4√3·λ_nm)   waves per millimetre.
 *
 * **And there is a second reading of "the aperture" that is wrong by a term
 * the aperture cannot close.** Use the marginal ray's own convergence angle —
 * the obvious NA, and the one every other rung in this file means — and the
 * column is out by (1 − Δ/R)², with Δ the distance from the reference sphere's
 * centre to where the beam actually converges. That is 0.586% on this singlet
 * at a round 1000 mm of back distance, and it does NOT vanish as the aperture
 * closes. This column belongs to the SPHERE and not to the beam.
 *
 * The two rungs that need no external number at all are the ones with exact
 * answers. One traced wish over two variables is rank 1 by construction, and
 * the direction it cannot see is the merit's own level set — measured, not
 * asserted: a step along it moves the traced RMS spot 10⁶ times less than the
 * same step along one variable, and quadratically rather than linearly.
 */
describe("DLS § 1.8.10 — a traced merit's own geometry", () => {
  const RESPONSE_VARS: SolveVariable[] = [
    { kind: "curvature", surface: 0 },
    { kind: "curvature", surface: 1 },
  ];
  const IMAGE_DISTANCE: SolveVariable[] = [{ kind: "thickness", surface: 1 }];
  /** The best-form shape § 1.8.5's traced fixture settles on. */
  const Q_STAR = 0.7107023;

  /** § 1.8.5's traced singlet with its back distance freed — the defocus rungs move it. */
  function backedSinglet(semi: number, back: number): OpticalSystem {
    const base = tracedSinglet(Q_STAR, TRACED_T, semi, semi);
    return {
      ...base,
      prescription: {
        surfaces: base.prescription.surfaces.map((s, i) =>
          i === 1 ? { ...s, thickness: back } : s,
        ),
      },
    };
  }

  it("a paraxial merit read through the SYSTEM entry point is the same reading, bitwise", () => {
    // The composition claim, and the cheapest possible way to state it: mixing
    // is only meaningful if the paraxial half means exactly what it meant
    // before. Not "agrees to twelve figures" — the same bits, because it is
    // the same difference of the same builder at the same step.
    const sys = tracedSinglet(0.7);
    const ops: OptimizeOperand[] = [
      { kind: "power", wavelengthNm: LINE_D, target: 1 / F },
      { kind: "bfd", wavelengthNm: LINE_D, target: 990 },
    ];
    const paraxial = variableResponse(sys.prescription, RESPONSE_VARS, ops);
    const traced = systemResponse(sys, RESPONSE_VARS, ops);
    expect(traced.response).toEqual(paraxial.response);
    expect(traced.conditionNumber).toBe(paraxial.conditionNumber);
    expect(traced.cosines).toEqual(paraxial.cosines);
    expect(traced.weakest).toEqual(paraxial.weakest);
    expect(traced.merit).toBe(paraxial.merit);
    expect(traced.evaluations).toBe(paraxial.evaluations);
    // Nothing traced, so nothing can wall: the three new lists are empty and
    // the extra probes they would have paid for were never spent.
    expect(traced.walled).toEqual([]);
    expect(traced.blind).toEqual([]);
    expect(traced.survivorChanged).toEqual([]);
  });

  it("one traced wish over two curvatures is rank 1 — and the flat direction is a real level set", () => {
    const sys = tracedSinglet(0.7);
    const r = systemResponse(sys, RESPONSE_VARS, [spotOperand()]);

    // A 1 × 2 Jacobian cannot have two independent columns. Exactly, not
    // nearly: the scaled columns are ±1 apiece.
    expect(r.cosines[0]![1]!).toBe(1);
    expect(r.singularValues[0]!).toBeCloseTo(Math.SQRT2, 12);
    expect(r.singularValues[1]!).toBe(0);
    expect(r.conditionNumber).toBe(Infinity);
    expect(r.dead).toEqual([]);
    expect(r.walled).toEqual([]);
    expect(r.blind).toEqual([]);
    expect(r.survivorChanged).toEqual([]);
    expect(r.weakest[0]!).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r.weakest[1]!).toBeCloseTo(Math.SQRT1_2, 12);

    // …and the readout does not stop at the Jacobian. `weakest` is in the
    // SCALED coordinates, so dividing by the response puts it back in the
    // curvatures' own units — and the design moved along it holds the traced
    // RMS spot while the same step on one curvature alone does not.
    const x0 = RESPONSE_VARS.map((v) => sys.prescription.surfaces[v.surface]!.curvature);
    const dir = r.weakest.map((w, jj) => w / r.response[jj]!);
    const base = tracedRms(sys);
    const moved = (pres: Prescription): number =>
      tracedRms({ ...sys, prescription: pres });
    const along = (d: number): number =>
      Math.abs(moved(withVariables(sys.prescription, RESPONSE_VARS, x0.map((v, jj) => v + d * dir[jj]!))) - base) / base;
    const across = (d: number): number =>
      Math.abs(moved(withVariables(sys.prescription, RESPONSE_VARS, [x0[0]! + d, x0[1]!])) - base) / base;

    expect(along(1e-6)).toBeCloseTo(1.1388e-9, 12);
    expect(across(1e-6)).toBeCloseTo(1.0008e-3, 6);
    // Six orders between them at the same step — and the flat one grows as d²
    // while the other grows as d, which is what "stationary" means and what a
    // single ratio would not have said.
    expect(across(1e-6) / along(1e-6)).toBeGreaterThan(8e5);
    expect(along(1e-5) / along(1e-6)).toBeCloseTo(100, -1);
    expect(across(1e-5) / across(1e-6)).toBeCloseTo(10, 0);
  });

  it("THE external number: the defocus column, and WHICH aperture it belongs to", () => {
    // ∂a₄/∂z = (h/R)²·10⁶/(4√3·λ) waves per mm, with h the marginal ray's
    // height at the exit-pupil PLANE and R the reference sphere's radius.
    const defocusOperand: TracedOperand = {
      kind: "wavefront",
      fieldValue: 0,
      wavelengthNm: LINE_D,
      pupil: pupilGrid(21),
      terms: 11,
      reading: "zernike",
      noll: 4,
      target: 0,
    };
    const sphere = (sys: OpticalSystem): { h: number; r: number } => {
      const c = asCompiled(sys.prescription);
      const p = pupils(sys, LINE_D);
      const rad = imagePlaneZ(c, sys) - p.exit.z;
      const edge = exitBundle(sys, 0, LINE_D, [{ px: 1, py: 0 }]).rays[0]!;
      const o = edge.ray.origin;
      const d = edge.ray.dir;
      const s = (p.exit.z - o.z) / d.z;
      return { h: Math.hypot(o.x + s * d.x, o.y + s * d.y), r: rad };
    };

    const seen: number[] = [];
    const spreads: number[] = [];
    const sines: number[] = [];
    for (const semi of [50, 12.5, 3.125]) {
      // Three back distances, 15 mm apart, so a dependence on where the image
      // plane sits could not hide inside the tolerance.
      const ratios = [1000, 1005, 990].map((back) => {
        const sys = backedSinglet(semi, back);
        const { h, r } = sphere(sys);
        const column = systemResponse(sys, IMAGE_DISTANCE, [defocusOperand]).response[0]!;
        return column / (((h / r) ** 2 * 1e6) / (4 * Math.sqrt(3) * LINE_D));
      });
      // The same number at all three planes, to 1% of its own departure from
      // 1 — so 15 mm of image plane is not in this column, and the (1 − Δ/R)²
      // the ray-angle reading pays below is gone entirely.
      seen.push(ratios[0]!);
      spreads.push(Math.max(...ratios) - Math.min(...ratios));
      sines.push(sphere(backedSinglet(semi, 1000)).h / sphere(backedSinglet(semi, 1000)).r);
    }
    expect(seen[0]!).toBeCloseTo(0.9981238, 6);
    expect(seen[1]!).toBeCloseTo(0.9998831, 6);
    expect(seen[2]!).toBeCloseTo(0.9999929, 6);
    // Quartering the aperture divides the residue by sixteen: the departure is
    // the ρ⁴ term the closed form drops, and it goes as NA².
    expect((1 - seen[0]!) / (1 - seen[1]!)).toBeCloseTo(16, -0.5);
    expect((1 - seen[1]!) / (1 - seen[2]!)).toBeCloseTo(16, -0.5);

    // …and it is not left as a residue with an order and no size. Expand
    // 1 − cos u, whose ρ⁴ coefficient is +¼s² written in the SINE and −¾t²
    // written in the TANGENT — two spellings of one aperture, and the SIGN is
    // what tells them apart. The departure is negative, so what (h/R) reads as
    // here is a tangent: § 6ag's currency split, on a wavefront column.
    const quarticShare = seen.map((v, k) => (1 - v) / (0.75 * sines[k]! ** 2));
    expect(quarticShare[0]!).toBeCloseTo(1.005, 2);
    expect(quarticShare[1]!).toBeCloseTo(1.004, 2);
    // The third is 2.4% low rather than 0.5%, and that is this rung's own
    // floor showing rather than the law failing: its departure is 7.1·10⁻⁶
    // against the 6.4·10⁻⁷ the three image planes already disagree by. Stated,
    // not tolerated.
    expect(quarticShare[2]!).toBeCloseTo(0.976, 2);
    expect(1 - seen[2]!).toBeLessThan(12 * spreads[2]!);
    // The plane dependence shrinks with the aperture as well: 1.9·10⁻⁵,
    // 1.2·10⁻⁶, 6.4·10⁻⁷. The first step is the same factor of 16 the
    // departure takes; the second is not, and this rung measures that floor
    // rather than attributing it.
    expect(spreads[0]!).toBeCloseTo(1.887e-5, 7);
    expect(spreads[0]! / (1 - seen[0]!)).toBeCloseTo(0.0101, 3);
    expect(spreads[1]! / (1 - seen[1]!)).toBeCloseTo(0.0105, 3);
    expect(spreads[0]! / spreads[1]!).toBeCloseTo(15.4, 0);
    expect(spreads[2]!).toBeLessThan(1e-6);

    // THE FINDING. Read the aperture off the marginal RAY instead — its own
    // convergence angle, which is what every other rung in this file means by
    // NA — and the column is out by (1 − Δ/R)², Δ being how far the reference
    // sphere's centre sits from where the beam converges. On this singlet at a
    // round 1000 mm that is 0.586%, and closing the aperture does not touch it.
    const byRay = [50, 3.125].map((semi) => {
      const sys = backedSinglet(semi, 1000);
      const edge = exitBundle(sys, 0, LINE_D, [{ px: 1, py: 0 }]).rays[0]!;
      const d = edge.ray.dir;
      const t = Math.hypot(d.x, d.y) / d.z;
      const column = systemResponse(sys, IMAGE_DISTANCE, [defocusOperand]).response[0]!;
      return column / ((t * t * 1e6) / (4 * Math.sqrt(3) * LINE_D));
    });
    expect(byRay[0]!).toBeCloseTo(0.9870035, 6);
    expect(byRay[1]!).toBeCloseTo(0.9941482, 6);
    // Sixteen times less aperture, and the error is the same 0.586%: it is not
    // an aperture term at all. Attributed, rather than left as a residue —
    // (1 − Δ/R)² with the paraxial focus at 997.0720 and R = 1004.0023.
    const narrow = backedSinglet(3.125, 1000);
    const bfd = systemProperties(narrow.prescription, LINE_D).bfd;
    const { h, r } = sphere(narrow);
    expect(bfd).toBeCloseTo(997.07205, 4);
    const predicted = (1 - (1000 - bfd) / r) ** 2;
    expect(predicted).toBeCloseTo(byRay[1]!, 4);
    // 2.78·10⁻⁵ is left over, and it is spent rather than tolerated. Two
    // pieces, both already named: Δ above is the PARAXIAL focus while the ray
    // whose angle was read crosses the axis short of it (2.09·10⁻⁵, twice its
    // relative angle error because a tangent is squared), plus the ρ⁴ term
    // this aperture still carries (7.10·10⁻⁶, measured three lines up). They
    // sum to the residue to 1.6·10⁻⁷.
    const residue = Math.abs(predicted - byRay[1]!);
    expect(residue).toBeCloseTo(2.78e-5, 6);
    const edge = exitBundle(narrow, 0, LINE_D, [{ px: 1, py: 0 }]).rays[0]!;
    const tan = Math.hypot(edge.ray.dir.x, edge.ray.dir.y) / edge.ray.dir.z;
    const fromRay = 2 * Math.abs(tan / (h / (r - (1000 - bfd))) - 1);
    expect(fromRay).toBeCloseTo(2.086e-5, 7);
    expect(fromRay + (1 - seen[2]!)).toBeCloseTo(residue, 6);
  });

  it("a ray leaving the set is not a dead variable — and the old readout could not say so", () => {
    // § 1.8.5's clipping fixture, at the shape where four of 149 rays rejoin.
    // Both curvature columns straddle it at the default step.
    const clipped = (c1: number): OpticalSystem => ({
      prescription: {
        surfaces: [
          { kind: "refract", curvature: c1, semiAperture: 55, thickness: TRACED_T, medium: "DLS-N15", isStop: true },
          { kind: "refract", curvature: c1 - 1 / ((1.5 - 1) * F), semiAperture: 49.9, thickness: F, medium: "AIR" },
        ],
      },
      aperture: { kind: "stopRadius", value: 50 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    });
    const c1Star = ((1 / ((1.5 - 1) * F)) * (0.710621939 + 1)) / 2;
    const r = systemResponse(clipped(c1Star), RESPONSE_VARS, [spotOperand()]);

    expect(r.walled).toEqual([0, 1]);
    expect(r.survivorChanged).toEqual([0, 1]);
    // Not dead, not blind, and not silent: the columns are real numbers taken
    // one-sidedly, which is a different sentence from either.
    expect(r.dead).toEqual([]);
    expect(r.blind).toEqual([]);
    expect(r.response[0]!).toBeGreaterThan(0);
    // Two probes, one per suspect column, on top of the stencil's five.
    expect(r.evaluations).toBe(7);

    // What the readout would have printed without this. 10⁻⁹ of curvature —
    // twelve orders below the difference step — moves the reported response by
    // 6.7%, because on one side of that the stencil straddles the cliff and on
    // the other it does not. A reader shown either number alone would have no
    // way to know which one they had.
    const above = systemResponse(clipped(c1Star + 1e-9), RESPONSE_VARS, [spotOperand()]);
    expect(Math.abs(above.response[0]! / r.response[0]! - 1)).toBeCloseTo(0.0669, 3);
    expect(above.survivorChanged).toEqual([0, 1]);
  });

  it("blind, dead and walled are three facts wearing the same zero", () => {
    // At the entry point the distinction is made, on residual functions that
    // are the three cases and nothing else. A lens reaches `walled` easily —
    // the rung above — and reaches `blind` only with two vignetting boundaries
    // inside one difference step, which is a contrivance and not a fixture.
    const blind = meritResponse(
      (x) => {
        if (Math.abs(x[1]! - 3) > 1e-12) throw new Error("not a system");
        return [2 * x[0]! - 1];
      },
      [1, 3],
    );
    const dead = meritResponse((x) => [2 * x[0]! - 1 + 0 * x[1]!], [1, 3]);

    // The same two numbers, and the same conditioning, from two different facts.
    expect(blind.response[1]!).toBe(0);
    expect(dead.response[1]!).toBe(0);
    expect(blind.response[0]!).toBe(dead.response[0]!);
    expect(blind.conditionNumber).toBe(dead.conditionNumber);
    // Only the lists tell them apart, which is the whole point of adding them.
    expect(blind.blind).toEqual([1]);
    expect(blind.dead).toEqual([]);
    expect(dead.dead).toEqual([1]);
    expect(dead.blind).toEqual([]);
    // Both are kept out of the angles and out of the singular values, for the
    // reason § 1.8.9 keeps `dead` out: a rank deficiency reported through them
    // says nothing about the variables that are alive.
    expect(blind.cosines[1]![1]!).toBeNaN();
    expect(blind.singularValues).toHaveLength(1);
    expect(blind.weakest[1]!).toBe(0);

    // And a wall on ONE side leaves a real column, at O(h) instead of O(h²).
    const walled = meritResponse(
      (x) => {
        if (x[1]! > 3) throw new Error("not a system");
        return [2 * x[0]! + 5 * x[1]!];
      },
      [1, 3],
    );
    expect(walled.walled).toEqual([1]);
    expect(walled.dead).toEqual([]);
    expect(walled.blind).toEqual([]);
    expect(walled.response[1]!).toBeCloseTo(5, 9);
  });

  it("a paraxial wish and a traced one in one merit, and what the weight does to the pair", () => {
    const sys = tracedSinglet(0.7);
    const power: OptimizeOperand = { kind: "power", wavelengthNm: LINE_D, target: 1 / F };
    const r = systemResponse(sys, RESPONSE_VARS, [power, spotOperand()]);
    // Two wishes, so the pair is no longer rank 1 — but only just. A power
    // wish and a spot wish over the two curvatures of a singlet are nearly the
    // same question asked twice.
    expect(r.conditionNumber).toBeCloseTo(3374.2045, 3);
    expect(r.cosines[0]![1]!).toBeCloseTo(0.99999982, 8);
    expect(r.singularValues[1]!).toBeCloseTo(4.19125e-4, 8);

    // § 1.8.9's weight finding, transplanted: a weight scales a ROW, so the
    // conditioning belongs to the merit as asked. Above a weight of about one
    // the traced row simply dominates and κ is proportional to it.
    const kappa = (w: number): number =>
      systemResponse(sys, RESPONSE_VARS, [power, { ...spotOperand(), weight: w }]).conditionNumber;
    expect(kappa(1e3) / kappa(1)).toBeCloseTo(999, -2);
    expect(kappa(1e6) / kappa(1e3)).toBeCloseTo(1000, -2);
    // …and below it there is a better setting than the one a panel offers by
    // default, which is the same shape as the achromat's ρ* and is measured
    // here rather than derived: no closed form is claimed for it.
    expect(kappa(1e-3)).toBeLessThan(kappa(1));
  });

  it("what it costs, and what it refuses", () => {
    const sys = tracedSinglet(0.7);
    // One evaluation at the design plus the central stencil's two per
    // variable — one iteration's worth of the run it describes, which is the
    // same fraction § 1.8.9 quotes and the reason a panel can afford it twice.
    expect(systemResponse(sys, RESPONSE_VARS, [spotOperand()]).evaluations).toBe(5);

    // A condition cannot be written down here at all: the parameter is a list
    // of operands and not a `SystemRequest`, so the geometry inside the null
    // space of C is a question this entry point declines by its own type.
    expect(() => systemResponse(sys, [], [spotOperand()])).toThrow(/no variables/);
    // An operand that cannot be read at the START is refused by name and by
    // index, rather than reaching the differencer as five walls in a row and
    // coming back as a variable set nothing can see.
    const stopped: OpticalSystem = {
      ...sys,
      prescription: {
        surfaces: sys.prescription.surfaces.map((surface, k) =>
          k === 1 ? { ...surface, semiAperture: 1 } : surface,
        ),
      },
    };
    expect(() => systemResponse(stopped, RESPONSE_VARS, [spotOperand()])).toThrow(
      /operand 0 cannot be read at the start/,
    );
  });
});
