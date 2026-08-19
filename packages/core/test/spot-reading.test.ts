import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex, LINE_D } from "../src/materials/dispersion";
import { pupilGrid } from "../src/pupil/aiming";
import { optimizeSystem, withVariables, type TracedOperand } from "../src/analysis/optimize";
import { exitBundle, spotAt } from "../src/analysis/spot";
import { imagePlaneZ } from "../src/pupil/pupils";
import { asCompiled } from "../src/trace/compile";
import { systemProperties } from "../src/trace/paraxial";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * Step 1.8.12 — a spot wish as ONE row or as the rays it summarised.
 *
 * § 1.8.5 asked this question on the singlet's ONE free curvature and recorded
 * the answer "the vector form is not needed": 2.5·10⁻⁸ of shape for 12% more
 * evaluations. That is true, and it is a fixture that cannot discriminate. On
 * TWO free curvatures the same comparison is the difference between finding
 * Coddington's best form and not moving off the seed.
 *
 * The mechanism is in `SpotReading`'s own comment: a least-squares step carries
 * JᵀJ and drops Σrᵢ∇²rᵢ, and on ONE non-negative row that dropped term is
 * coherent, because every ray's curvature enters with the sign of r. Signed
 * per-ray rows let it cancel, and make JᵀJ full rank besides.
 *
 * The external number is Coddington's shape factor for least spherical
 * aberration at infinite conjugate, q* = 2(n²−1)/(n+2) — the same closed form
 * § 1.8.5 and § 5j.1 are built on (Jenkins & White; Hecht § 6.3).
 */

registerMedium(constantIndex("DLS-N15", 1.5));

const N = 1.5;
const F = 1000;
const SEMI = 50;
const GRID = pupilGrid(11);
/** Coddington's best form at infinite conjugate. */
const qStar = (n: number): number => (2 * (n * n - 1)) / (n + 2);
/** Thin-lens curvature difference for focal length F. */
const DC = 1 / ((N - 1) * F);
/** Shape factor q = (c₀ + c₁)/(c₀ − c₁). */
const qOf = (c0: number, c1: number): number => (c0 + c1) / (c0 - c1);
const fromQ = (q: number): [number, number] => {
  const c0 = (DC * (q + 1)) / 2;
  return [c0, c0 - DC];
};

const BASE: Prescription = {
  surfaces: [
    {
      kind: "refract",
      curvature: 0,
      semiAperture: SEMI * 1.2,
      thickness: 6,
      medium: "DLS-N15",
      isStop: true,
    },
    { kind: "refract", curvature: 0, semiAperture: SEMI * 1.2, thickness: F, medium: "AIR" },
  ],
};
const VARS: SolveVariable[] = [
  { kind: "curvature", surface: 0 },
  { kind: "curvature", surface: 1 },
];
const systemOf = (prescription: Prescription): OpticalSystem => ({
  prescription,
  aperture: { kind: "stopRadius", value: SEMI },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LINE_D, weight: 1 }],
  conjugate: { kind: "infinite" },
});
const at = (x: readonly number[]): OpticalSystem => systemOf(withVariables(BASE, VARS, x));
const spotOf = (x: readonly number[]): number => {
  const sys = at(x);
  const bundle = exitBundle(sys, 0, LINE_D, GRID);
  return spotAt(bundle, imagePlaneZ(asCompiled(sys.prescription), sys)).rmsRadius;
};
const op = (reading: "rms" | "transverse"): TracedOperand => ({
  kind: "rmsSpot",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil: GRID,
  focus: "systemImagePlane",
  target: 0,
  weight: 1,
  reading,
});
/** Half a shape factor away from the best form — § 1.8.5's own start. */
const SEED = fromQ(qStar(N) + 0.5);

describe("§ 1.8.12 — the two readings are one merit", () => {
  it("Σ of the per-ray rows IS the RMS squared", () => {
    // `maxIterations: 0` evaluates the start and stops, so this reads the merit
    // at one design in both spellings. The scalar row is spot² to the BIT; the
    // 154-row form differs only by the order 154 squares are summed in.
    const scalar = optimizeSystem(at(SEED), VARS, [op("rms")], { maxIterations: 0 });
    const perRay = optimizeSystem(at(SEED), VARS, [op("transverse")], { maxIterations: 0 });
    expect(scalar.residuals).toHaveLength(1);
    expect(perRay.residuals).toHaveLength(154);
    expect(scalar.merit).toBe(spotOf(SEED) ** 2);
    expect(Math.abs(perRay.merit - scalar.merit) / scalar.merit).toBeLessThan(1e-15);
  });

  it("and they cost the same per iteration — the rows come off one trace", () => {
    // The Jacobian is 2n trial designs whatever m is, so the per-ray form is
    // not a resolution knob being paid for. It is the same work, differenced.
    const scalar = optimizeSystem(at(SEED), VARS, [op("rms")], { maxIterations: 7 });
    const perRay = optimizeSystem(at(SEED), VARS, [op("transverse")], { maxIterations: 7 });
    expect(scalar.evaluations).toBe(36);
    expect(perRay.evaluations).toBe(36);
  });
});

describe("§ 1.8.12 — what the reading is worth on TWO free curvatures", () => {
  const scalar = optimizeSystem(at(SEED), VARS, [op("rms")], { maxIterations: 400 });
  const perRay = optimizeSystem(at(SEED), VARS, [op("transverse")], { maxIterations: 400 });

  it("the per-ray reading recovers Coddington's best form; the scalar one does not move off the seed", () => {
    // THE rung. q* is a closed form from outside the engine, and the seed is
    // half a shape factor away from it on purpose.
    //
    // The 4.7e-4 gap is MEASURED AND NOT ATTRIBUTED, and saying so is the point
    // rather than a hedge: § 1.8.5 attributes a thick singlet's departure from
    // the thin-lens q* at −5.256e-4 per mm of glass, which at 6 mm predicts
    // −3.15e-3 — six times what is seen here and the wrong size to explain it.
    // That fixture held the power and this one does not, so the free power is
    // the obvious suspect and it has not been measured. A bound this file
    // authored is still a bound; it is here to catch a regression, not to claim
    // the residue is understood.
    expect(Math.abs(qOf(perRay.x[0]!, perRay.x[1]!) - qStar(N))).toBeLessThan(5e-4);
    // …where the scalar reading ends 0.008 from the SEED's shape and 0.51 from
    // the answer, having spent thirteen times the evaluations to get there.
    expect(qOf(scalar.x[0]!, scalar.x[1]!)).toBeCloseTo(1.2224, 3);
    expect(Math.abs(qOf(scalar.x[0]!, scalar.x[1]!) - qOf(SEED[0], SEED[1]))).toBeLessThan(0.01);
  });

  it("…and the EFL it settles at is § 1.8.5's own bound on this variable", () => {
    // § 1.8.5: refocusing is unbounded on a free power and the image plane
    // bounds it at 1006.6. The per-ray reading is what actually reaches it.
    expect(systemProperties(at(perRay.x).prescription, LINE_D).efl).toBeCloseTo(1005.2, 0);
  });

  it("the scalar run stops with the KKT test reading exactly 1, which it cannot leave", () => {
    // One non-negative row: the cosine between r and the single Jacobian column
    // is 1 by construction (§ 1.8.4), so the optimum test can never fire and
    // the run has nothing to stop it but the iteration cap.
    expect(scalar.gradient).toBe(1);
    expect(scalar.reason).toBe("iterations");
    expect(scalar.evaluations).toBe(2001);
    // Signed rows give it a gradient to read, and it converges on one.
    expect(perRay.gradient).toBeLessThan(1e-9);
    expect(perRay.reason).toBe("step");
    expect(perRay.evaluations).toBeLessThan(200);
  });

  it("THE PROOF the scalar answer is not an optimum: restarted there, the run moves", () => {
    // No reference number needed for this one. A converged answer is a fixed
    // point; this one is not, and the point it moves to is the per-ray answer.
    const again = optimizeSystem(at(scalar.x), VARS, [op("transverse")], { maxIterations: 400 });
    expect(Math.hypot(again.x[0]! - scalar.x[0]!, again.x[1]! - scalar.x[1]!)).toBeGreaterThan(1e-4);
    expect(spotOf(again.x)).toBeLessThan(spotOf(scalar.x));
    expect(spotOf(again.x) / spotOf(scalar.x)).toBeCloseTo(0.7819, 3);
    expect(spotOf(again.x)).toBeCloseTo(spotOf(perRay.x), 12);

    // …and the per-ray answer IS a fixed point, to the last bits.
    const stay = optimizeSystem(at(perRay.x), VARS, [op("transverse")], { maxIterations: 400 });
    expect(Math.hypot(stay.x[0]! - perRay.x[0]!, stay.x[1]! - perRay.x[1]!)).toBeLessThan(1e-14);
  });

  it("the spot it costs: the scalar reading ends 27.9% above the answer", () => {
    expect(spotOf(scalar.x) / spotOf(perRay.x) - 1).toBeCloseTo(0.279, 2);
  });
});

describe("§ 1.8.12 — the reading changes the model, not the physics", () => {
  it("with the power HELD the two readings land on the same shape", () => {
    // The negative control. A condition removes the free direction that the
    // scalar model cannot follow, and then both readings agree — which is what
    // says the per-ray form is a better-conditioned spelling of one question
    // rather than a different question.
    const target = 1 / systemProperties(withVariables(BASE, VARS, fromQ(qStar(N))), LINE_D).efl;
    const answers = (["rms", "transverse"] as const).map((reading) =>
      optimizeSystem(
        at(SEED),
        VARS,
        { minimize: [op(reading)], hold: [{ kind: "power", wavelengthNm: LINE_D, target }] },
        { maxIterations: 400 },
      ),
    );
    const [scalar, perRay] = answers;
    expect(scalar!.reason).toBe("step");
    expect(perRay!.reason).toBe("step");
    expect(Math.abs(qOf(scalar!.x[0]!, scalar!.x[1]!) - qOf(perRay!.x[0]!, perRay!.x[1]!))).toBeLessThan(
      1e-5,
    );
    // …and it is the FIXED-PLANE shape, not q* — § 1.8.5's 0.49 gap between the
    // two focus conventions, which this reading does not touch.
    expect(qOf(perRay!.x[0]!, perRay!.x[1]!)).toBeCloseTo(0.2344, 3);
  });
});

describe("§ 1.8.12 — the two refusals", () => {
  it("a per-ray reading cannot carry a nonzero target", () => {
    expect(() =>
      optimizeSystem(at(SEED), VARS, [{ ...op("transverse"), target: 1e-3 }], {}),
    ).toThrow(/no summary to aim at/);
  });

  it("…and cannot be held, because a condition is one equation", () => {
    expect(() =>
      optimizeSystem(
        at(SEED),
        VARS,
        {
          minimize: [op("rms")],
          hold: [
            {
              kind: "rmsSpot",
              fieldValue: 0,
              wavelengthNm: LINE_D,
              pupil: GRID,
              focus: "systemImagePlane",
              target: 0,
              reading: "transverse",
            },
          ],
        },
        {},
      ),
    ).toThrow(/one per ray, so it can be minimised but not held/);
  });
});
