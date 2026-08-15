import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { registerMedium, getMedium } from "../src/materials/catalog";
import { constantIndex, abbeNumber, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import { seidelSums } from "../src/analysis/seidel";
import { systemProperties } from "../src/trace/paraxial";
import { dampedLeastSquares, optimizePrescription, withVariables } from "../src/analysis/optimize";
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
 * SCOPE: paraxial and third-order operands only. A merit over traced quantities
 * — RMS spot, a Zernike term, MTF at a frequency — is the same optimiser with a
 * more expensive residual, and nothing here pins one.
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
