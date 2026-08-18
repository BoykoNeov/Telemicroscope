import { describe, it, expect } from "vitest";
import type { Prescription } from "../src/trace/prescription";
import type { OpticalSystem } from "../src/trace/system";
import { registerMedium, getMedium } from "../src/materials/catalog";
import { constantIndex, LINE_D, abbeNumber } from "../src/materials/dispersion";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, coefficient } from "../src/wave/zernike";
import { pupilGrid, type PupilPoint } from "../src/pupil/aiming";
import {
  optimizeSystem,
  variableResponse,
  systemResponse,
  type OptimizeOperand,
  type SystemOperand,
  type TracedOperand,
} from "../src/analysis/optimize";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * § 1.8.11 — the solver's step scaling, and the sentence VALIDATION.md carried
 * about it that measurement falsified.
 *
 * The recorded open item said the default step's `max(|xⱼ|, 1)` floor was "a
 * unit assumption … wrong by three orders for a curvature", and proposed a
 * SCALE-RELATIVE floor. The first half is right and the proposal is wrong, and
 * the fixture that says so is a near-plano surface: a variable's own magnitude
 * carries no information about the merit's sensitivity to it. On the concentric
 * mirror the two are linked through R²; on a surface whose system's power lives
 * elsewhere they are not linked at all, and a relative step walks off a cliff.
 *
 * What replaces it is **1/a**, the reciprocal of the surface's own
 * semi-aperture — the number that turns a curvature into a length. A step h
 * moves the rim sag by h·a²/2, so h = ∛ε/a moves it by ∛ε·a/2: a fixed fraction
 * of the aperture, at every aperture. The old floor moved it by ∛ε·a²/2, which
 * grows with the aperture squared.
 *
 * And it is gated on the merit TRACING, which is not a hedge. A paraxial or
 * third-order operand is a closed form, exactly LINEAR in a curvature, so its
 * column carries no truncation error and every decade of step is a decade less
 * cancellation — the two operand families want opposite steps, and the merit is
 * what says which one it is.
 */

registerMedium(constantIndex("SS-N15", 1.5));

const CBRT_EPS = Math.cbrt(Number.EPSILON);
const LAM_MM = LINE_D * 1e-6;
const GRID = pupilGrid(21);
const TERMS = 11;
const CROWN = "N-BK7";
const nCrown = getMedium(CROWN).n(LINE_D);
const vCrown = abbeNumber(getMedium(CROWN));

/** A mirror at infinite conjugate: curvature C, image plane HELD at `focus`. */
function mirror(C: number, focus: number, semi: number): OpticalSystem {
  return {
    prescription: {
      surfaces: [
        { kind: "reflect", curvature: C, conic: 0, semiAperture: semi, thickness: focus, isStop: true },
      ],
    },
    aperture: { kind: "stopRadius", value: semi },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** A spherical mirror with the object at distance d. Perfect when |R| = d. */
function concentricMirror(R: number, d: number, semi: number): OpticalSystem {
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
 * A plano-convex singlet whose BACK curvature is the variable, at or near zero.
 *
 * The point of the fixture is that surface 0 carries all the power, so the
 * variable's magnitude and the merit's sensitivity to it are DECOUPLED: the
 * column is ~52.8 whether c₂ is 10⁻² or exactly 0.
 */
function singlet(c2: number, semi = 10, back = semi * 1.3): OpticalSystem {
  const c1 = 1 / ((1.5 - 1) * 100);
  return {
    prescription: {
      surfaces: [
        { kind: "refract", curvature: c1, semiAperture: semi * 1.3, thickness: 4, medium: "SS-N15", isStop: true },
        { kind: "refract", curvature: c2, semiAperture: back, thickness: 96, medium: "AIR" },
      ],
    },
    aperture: { kind: "stopRadius", value: semi },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

const c11 = (s: OpticalSystem) => coefficient(fitZernike(opdMap(s, 0, LINE_D, GRID).samples, TERMS), 11);

const RADIUS = { kind: "curvature", surface: 0 } as const satisfies SolveVariable;
const BACK = { kind: "curvature", surface: 1 } as const satisfies SolveVariable;
const FOCUS = { kind: "thickness", surface: 0 } as const satisfies SolveVariable;

const wfRms = (pupil: readonly PupilPoint[] = GRID): TracedOperand => ({
  kind: "wavefront",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil,
  terms: TERMS,
  reading: "rms",
  target: 0,
});

describe("§ 1.8.11 — THE external number: a closed form for a CURVATURE column", () => {
  /**
   * § 1.8.10 pinned a column against a closed form and the column was a
   * THICKNESS — which is the one kind the old floor already suited, so it
   * could not discriminate. This is the same shape of rung in the kind that
   * can, and the closed form turns out to be a SUM of two textbook terms:
   *
   *     ∂c₁₁/∂C = 3h⁴C²/(24√5·λ)      the spherical aberration growing
   *             − (1/(2C²))·NA⁴/(48√5·λ)   the paraxial focus walking out
   *                                        from under the HELD image plane
   *
   * The first is Born & Wolf's W₀₄₀ = h⁴/(4R³) for a mirror at infinite
   * conjugate, put through the ρ⁴→Z₁₁ expansion c₁₁ = W₀₄₀/(6√5), and
   * differentiated in C = 1/R. The second is the ρ⁴ term of a longitudinal
   * defocus ΔZ, ΔZ·NA⁴/8 in mm, carried through the same expansion — with
   * dΔZ/dC = −1/(2C²), because a mirror's focus is at R/2.
   *
   * **The second term is 1.333× the first and takes the opposite sign, so the
   * column's SIGN is set by the conjugate motion rather than by the
   * aberration.** Anyone differentiating W₀₄₀ alone gets this column backwards,
   * which is why a curvature column is worth pinning and a thickness one was
   * not enough.
   */
  it("the composite closed form, and its residue is fifth order over an 8× range of NA", () => {
    const R = -400;
    const C = 1 / R;
    const focus = R / 2;
    const excess: number[] = [];
    for (const semi of [5, 10, 20, 40]) {
      const na = semi / Math.abs(focus);
      const aberration = (3 * semi ** 4 * C * C) / (24 * Math.sqrt(5) * LAM_MM);
      const conjugate = -(1 / (2 * C * C)) * (na ** 4 / (48 * Math.sqrt(5) * LAM_MM));
      // The two terms really are opposed and comparable — stated, so a later
      // reader cannot take the closed form for the aberration term alone.
      expect(conjugate / aberration).toBeCloseTo(-4 / 3, 9);

      // Differenced at the step this module now chooses for this surface.
      const h = CBRT_EPS / semi;
      const at = (x: number) => c11(mirror(x, focus, semi));
      const column = (at(C + h) - at(C - h)) / (2 * h);
      excess.push(column / (aberration + conjugate) - 1);
    }

    // Approached from BELOW and settling on one number over four apertures —
    // the § 1.8.7 signature, and the neglected fifth-order term identifying
    // itself by its own order rather than by a tolerance chosen to fit.
    const perNa2 = excess.map((e, i) => e / [0.025, 0.05, 0.1, 0.2][i]! ** 2);
    expect(perNa2[0]!).toBeCloseTo(0.1630, 3);
    expect(perNa2[1]!).toBeCloseTo(0.1878, 3);
    expect(perNa2[2]!).toBeCloseTo(0.1893, 3);
    expect(perNa2[3]!).toBeCloseTo(0.1904, 3);
    for (let i = 1; i < perNa2.length; i++) expect(perNa2[i]!).toBeGreaterThan(perNa2[i - 1]!);
    expect(perNa2[3]!).toBeLessThan(0.1905);
  });

  /**
   * The same reading at a FIXED step is not this measurement, and the smallest
   * aperture is where that shows: at h = 1e-8 the NA 0.025 column is
   * differencing-floor-limited and its excess/NA² reads −0.68, breaking the
   * sequence entirely. The rung above is not "four points that happened to
   * line up" — it is four points each taken at its own resolution.
   */
  it("…and at one fixed step the smallest aperture leaves the sequence", () => {
    const R = -400;
    const C = 1 / R;
    const focus = R / 2;
    const semi = 5;
    const na = semi / Math.abs(focus);
    const closed =
      (3 * semi ** 4 * C * C) / (24 * Math.sqrt(5) * LAM_MM) -
      (1 / (2 * C * C)) * (na ** 4 / (48 * Math.sqrt(5) * LAM_MM));
    const at = (x: number) => c11(mirror(x, focus, semi));
    const col = (h: number) => (at(C + h) - at(C - h)) / (2 * h);

    expect((col(1e-8) / closed - 1) / na ** 2).toBeCloseTo(-0.679, 2);
    expect((col(CBRT_EPS / semi) / closed - 1) / na ** 2).toBeCloseTo(0.163, 3);
  });
});

describe("§ 1.8.11 — what the scale buys, and that it is the right currency", () => {
  /**
   * § 1.8.7's concentric conjugate, across a 16× range of size. The rung is not
   * the gain — it is that **1/a reads the SAME accuracy at every scale**, which
   * is what separates a currency from a constant that happened to suit one
   * fixture. The old floor does not: it degrades as the mirror grows, because a
   * fixed step in curvature is a step in RADIUS that grows as R².
   */
  it("the located conjugate is scale-invariant under 1/a and is not under the old floor", () => {
    const located = (d: number, semi: number, steps?: number[]) =>
      Math.max(
        ...[-0.95 * d, -1.05 * d].map((R0) => {
          const r = optimizeSystem(concentricMirror(R0, d, semi), [RADIUS], [wfRms()], steps ? { steps } : {});
          return Math.abs(1 / r.x[0]! + d) / d;
        }),
      );

    const sizes: Array<[number, number]> = [
      [100, 10],
      [400, 40],
      [1600, 160],
    ];
    const now = sizes.map(([d, semi]) => located(d, semi));
    const before = sizes.map(([d, semi]) => located(d, semi, [CBRT_EPS]));

    // One number at three sizes, to three figures.
    for (const v of now) expect(v).toBeCloseTo(9.04e-12, 13);
    // …against a reading that walks a factor of 21 over the same range.
    expect(before[0]!).toBeCloseTo(9.00e-10, 11);
    expect(before[1]!).toBeCloseTo(1.39e-8, 9);
    expect(before[2]!).toBeCloseTo(1.86e-8, 9);
    expect(before[2]! / before[0]!).toBeGreaterThan(20);
    expect(Math.max(...now) / Math.min(...now)).toBeLessThan(1.01);

    // The gain, said once: two orders at the smallest and three at the largest.
    expect(before[0]! / now[0]!).toBeGreaterThan(90);
    expect(before[2]! / now[2]!).toBeGreaterThan(2e3);
  });

  /**
   * The dimensional statement the rule rests on, checked as arithmetic rather
   * than left in a comment: one difference step moves the rim sag by h·a²/2,
   * and under 1/a that is ∛ε·a/2 — proportional to the aperture, not to its
   * square. This is why the old floor reached 15 mm of radius on a 160 mm
   * mirror and 5 µm on a 10 mm one, for the same nominal "step".
   */
  it("a curvature step is a rim sag, and the two rules move it by a and by a²", () => {
    const sag = (h: number, a: number) => (h * a * a) / 2;
    for (const a of [10, 40, 160]) {
      expect(sag(CBRT_EPS / a, a)).toBeCloseTo((CBRT_EPS * a) / 2, 15);
      expect(sag(CBRT_EPS, a) / sag(CBRT_EPS / a, a)).toBeCloseTo(a, 9);
    }
    expect(sag(CBRT_EPS, 160)).toBeCloseTo(7.751e-2, 5);
    expect(sag(CBRT_EPS / 160, 160)).toBeCloseTo(4.844e-4, 7);
  });
});

describe("§ 1.8.11 — the branch the proposal took, and why it is not taken", () => {
  /**
   * THE finding, and it is the recorded proposal failing.
   *
   * A pure scale-relative step, ∛ε·|x|, on a surface whose curvature is near
   * zero and whose system's power is elsewhere. The column is ~52.8 at every
   * c₂ here — the merit's sensitivity does not know or care how small the
   * variable is — so a step proportional to |c₂| walks straight into the
   * cancellation arm and then off the end of it.
   *
   * Compared against the column read at 1e-7, which the sweep in the probe put
   * squarely on the plateau (1e-9…1e-4 agree to six figures).
   */
  it("a relative step is catastrophic on a near-plano surface, where 1/a is not", () => {
    const col = (c2: number, h: number) => (c11(singlet(c2 + h)) - c11(singlet(c2 - h))) / (2 * h);
    const a = 13; // the back surface's own semi-aperture
    const rows: Array<[number, number, number]> = [];
    for (const c2 of [1e-3, 1e-5, 1e-6, 1e-8, 1e-10]) {
      const truth = col(c2, 1e-7);
      rows.push([
        c2,
        col(c2, CBRT_EPS * c2) / truth - 1, // relative
        col(c2, CBRT_EPS / a) / truth - 1, // 1/a
      ]);
    }

    // The relative rule degrades monotonically and without bound…
    const relErr = rows.map(([, e]) => Math.abs(e));
    for (let i = 1; i < relErr.length; i++) expect(relErr[i]!).toBeGreaterThan(relErr[i - 1]!);
    expect(relErr[0]!).toBeLessThan(1e-4);
    expect(Math.abs(rows[3]![1]!)).toBeGreaterThan(0.4); // 48% at c₂ = 1e-8
    expect(Math.abs(rows[4]![1]!)).toBeGreaterThan(20); // 2500% at c₂ = 1e-10

    // …while 1/a holds five decades of the same sweep at the plateau.
    for (const [, , e] of rows) expect(Math.abs(e)).toBeLessThan(1e-5);
  });

  /**
   * And the end of that arm is not a bad number, it is no number: a variable at
   * exactly 0 has no relative step, and `differenceSteps` refuses a step of 0
   * rather than dividing by it. A plano surface is not exotic — every coverslip
   * and every immersion gap in this engine has one — so the rule that cannot
   * difference it is disqualified by a shipped design, not by a contrivance.
   */
  it("a curvature of exactly zero is differenced, and the relative rule cannot be", () => {
    expect(singlet(0).prescription.surfaces[1]!.curvature).toBe(0);

    const truth = (c11(singlet(1e-7)) - c11(singlet(-1e-7))) / 2e-7;
    const h = CBRT_EPS / 13;
    expect((c11(singlet(h)) - c11(singlet(-h))) / (2 * h) / truth - 1).toBeLessThan(1e-5);

    // The rule the proposal named, applied at 0, is not a step at all.
    expect(CBRT_EPS * Math.abs(0)).toBe(0);
    expect(() =>
      optimizeSystem(singlet(0), [BACK], [wfRms()], { steps: [0] }),
    ).toThrow(/difference step 0 is not positive/);

    // What the module does instead: a run over that variable, from plano, that
    // reaches a stated coefficient — the § 1.8.7 inversion on a back surface.
    const target = -0.35;
    const r = optimizeSystem(singlet(0), [BACK], [
      {
        kind: "wavefront",
        fieldValue: 0,
        wavelengthNm: LINE_D,
        pupil: GRID,
        terms: TERMS,
        reading: "zernike",
        noll: 11,
        target,
      },
    ]);
    expect(c11(singlet(r.x[0]!)) - target).toBeLessThan(1e-12);
    expect(r.x[0]!).toBeCloseTo(4.940670281e-4, 12);
  });
});

describe("§ 1.8.11 — the branches the default does not take", () => {
  /**
   * `semiAperture: Infinity` is shipped — `designs/coverslip.ts`,
   * `designs/immersion.ts` and `designs/microscope.ts` all declare it — so the
   * unbounded surface is not a hypothetical branch. It takes the widest bounded
   * semi-aperture in the same prescription, which is a length the design
   * actually has rather than a constant.
   */
  it("an unbounded surface borrows the prescription's widest bounded rim", () => {
    // Same lens twice, the back surface bounded at 13 and then unbounded. The
    // front is 13 as well, so the fallback picks 13 and the two runs agree to
    // the bit — which is what "borrows the widest" MEANS, said as an identity
    // rather than as a sentence.
    const bounded = optimizeSystem(singlet(1e-3, 10, 13), [BACK], [wfRms()]);
    const unbounded = optimizeSystem(singlet(1e-3, 10, Infinity), [BACK], [wfRms()]);
    expect(unbounded.x[0]!).toBe(bounded.x[0]!);

    // And a WIDER bounded surface elsewhere really is what gets borrowed: widen
    // the front to 130 and the unbounded back is differenced ten times finer,
    // so the run is a different run. (Not a better or worse one — a different
    // step. The point is that the fallback reads the prescription.)
    const wider = optimizeSystem(
      { ...singlet(1e-3, 10, Infinity), prescription: {
        ...singlet(1e-3, 10, Infinity).prescription,
        surfaces: singlet(1e-3, 10, Infinity).prescription.surfaces.map((s, i) =>
          i === 0 ? { ...s, semiAperture: 130 } : s,
        ),
      } },
      [BACK],
      [wfRms()],
    );
    expect(wider.x[0]!).not.toBe(unbounded.x[0]!);
  });

  /**
   * A prescription with NO bounded surface anywhere has no length to offer, and
   * the rule falls back to the kind-blind 1 rather than inventing one.
   */
  it("a prescription with no bounded surface falls back to the kind-blind floor", () => {
    const allOpen: OpticalSystem = {
      prescription: {
        surfaces: [
          { kind: "refract", curvature: 1 / 50, semiAperture: Infinity, thickness: 4, medium: "SS-N15", isStop: true },
          { kind: "refract", curvature: 0, semiAperture: Infinity, thickness: 96, medium: "AIR" },
        ],
      },
      aperture: { kind: "stopRadius", value: 10 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    const auto = optimizeSystem(allOpen, [BACK], [wfRms()]);
    const stated = optimizeSystem(allOpen, [BACK], [wfRms()], { steps: [CBRT_EPS] });
    expect(auto.x[0]!).toBe(stated.x[0]!);
    expect(auto.evaluations).toBe(stated.evaluations);
  });

  /**
   * `max(|C|, 1/a)` fires when the DECLARED clear aperture is wider than the
   * radius of curvature. That cannot happen to the GLASS — |C| > 1/a means the
   * rim is further from the axis than the sphere's own radius, so the surface
   * never reaches it and no ray can be traced there — but it happens easily to
   * a prescription, which declares a rim it does not need to fill. A generous
   * `semiAperture` beside a small stop is the ordinary way to write "do not clip
   * this", and 1/a from a 10⁵ mm rim is 10⁻⁵ times the curvature it is meant to
   * scale: straight into the cancellation arm.
   *
   * So the `max` is not decoration. It is the guard against a declared aperture
   * that is a statement about clipping rather than a length the surface has.
   */
  it("a declared rim wider than the radius hands the scale back to the curvature", () => {
    const roomy = singlet(1e-3, 10, 1e5);
    expect(1 / 1e5).toBeLessThan(1e-3); // the max really does pick |C| here

    const auto = optimizeSystem(roomy, [BACK], [wfRms()]);
    const byMagnitude = optimizeSystem(roomy, [BACK], [wfRms()], { steps: [CBRT_EPS * 1e-3] });
    expect(auto.x[0]!).toBe(byMagnitude.x[0]!);

    // …and it is not the same run as the one the rim alone would have given.
    const byRim = optimizeSystem(roomy, [BACK], [wfRms()], { steps: [CBRT_EPS * (1 / 1e5)] });
    expect(byRim.x[0]!).not.toBe(auto.x[0]!);
  });
});

describe("§ 1.8.11 — the negative controls, which are bitwise", () => {
  /**
   * A thickness keeps `max(|t|, 1)` and keeps it TO THE BIT. It is a length in
   * millimetres and the engine's geometry unit is a millimetre, so the floor is
   * a statement in the variable's own units — 1 mm is a thickness a lens might
   * have, where 1 mm⁻¹ is a 1 mm radius of curvature and no surface here has
   * ever had one. That asymmetry is the whole reason this sub-step touches one
   * kind and not the other.
   */
  it("a thickness variable is differenced exactly as it was", () => {
    const sys = mirror(1 / -400, -200, 10);
    const auto = optimizeSystem(sys, [FOCUS], [wfRms()]);
    const stated = optimizeSystem(sys, [FOCUS], [wfRms()], { steps: [CBRT_EPS * 200] });
    expect(auto.x[0]!).toBe(stated.x[0]!);
    expect(auto.evaluations).toBe(stated.evaluations);
    expect(auto.merit).toBe(stated.merit);
  });

  /**
   * A merit that does not trace keeps the old step for its curvatures too, and
   * this is the measurement that makes that a decision rather than a hedge: a
   * paraxial power operand is φ = (n−1)(c₁−c₂), EXACTLY linear in either
   * curvature, so its column carries no truncation error at all and the error
   * is pure cancellation — monotone in 1/h. Bigger is strictly better, which is
   * the opposite of what a traced merit wants.
   */
  it("a paraxial column is linear in the curvature, so it wants the LARGER step", () => {
    const thin = (semi: number): Prescription => ({
      surfaces: [
        { kind: "refract", curvature: 0.01, semiAperture: semi, thickness: 0, medium: CROWN, isStop: true },
        { kind: "refract", curvature: -0.01, semiAperture: semi, thickness: 100, medium: "AIR" },
      ],
    });
    const vars: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
    ];
    const power: OptimizeOperand[] = [{ kind: "power", wavelengthNm: LINE_D, target: 1 / 500 }];
    const err = (semi: number, h: number) =>
      Math.abs(
        variableResponse(thin(semi), vars, power, { steps: [h, h] }).response[0]! / (nCrown - 1) - 1,
      );

    // The whole window is one arm: every decade of step is a decade of accuracy.
    expect(err(25, 1e-3)).toBeLessThan(1e-14);
    expect(err(25, CBRT_EPS)).toBeCloseTo(9.79e-14, 15);
    expect(err(25, CBRT_EPS / 25)).toBeCloseTo(2.67e-12, 13);
    expect(err(25, CBRT_EPS / 100)).toBeCloseTo(2.50e-11, 12);
    // 27× at a 25 mm rim and 256× at a 100 mm one — the cost grows straight
    // with the aperture, which is exactly the quantity 1/a would have used.
    expect(err(25, CBRT_EPS / 25) / err(25, CBRT_EPS)).toBeGreaterThan(20);
    expect(err(25, CBRT_EPS / 100) / err(25, CBRT_EPS)).toBeGreaterThan(200);
  });

  /** …so a paraxial merit's columns come out of both entry points unmoved. */
  it("a paraxial merit is differenced exactly as it was, through both readers", () => {
    const thin: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 0.01, semiAperture: 25, thickness: 0, medium: CROWN, isStop: true },
        { kind: "refract", curvature: -0.01, semiAperture: 25, thickness: 100, medium: "AIR" },
      ],
    };
    const vars: SolveVariable[] = [
      { kind: "curvature", surface: 0 },
      { kind: "curvature", surface: 1 },
    ];
    const power: OptimizeOperand[] = [{ kind: "power", wavelengthNm: LINE_D, target: 1 / 500 }];
    const auto = variableResponse(thin, vars, power);
    const stated = variableResponse(thin, vars, power, { steps: [CBRT_EPS, CBRT_EPS] });
    expect(auto.response).toEqual(stated.response);
    expect(auto.conditionNumber).toBe(stated.conditionNumber);
    // (n−1) to twelve figures, which is § 1.8.9's own rung saying it is unmoved.
    expect(auto.response[0]!).toBeCloseTo(nCrown - 1, 12);
    expect(vCrown).toBeGreaterThan(60);
  });

  /**
   * A merit that MIXES the two takes the traced rule, because a merit's floor
   * is the worst of its parts — and a HELD traced quantity counts, since a
   * condition is differenced in the same stencil as the wishes.
   */
  it("one traced row anywhere in the merit chooses the traced rule", () => {
    const sys = singlet(1e-3, 10, 13);
    const power: OptimizeOperand = { kind: "power", wavelengthNm: LINE_D, target: 1 / 100 };
    // ε·(1/13), NOT ε/13 — `autoStep` multiplies by whatever `Math.max` returned,
    // and the two spellings differ in the last bit. A rung asserting a BITWISE
    // identity has to write the expression the module writes.
    const h = CBRT_EPS * (1 / 13);

    const mixedWish: SystemOperand[] = [power, wfRms()];
    expect(systemResponse(sys, [BACK], mixedWish).response).toEqual(
      systemResponse(sys, [BACK], mixedWish, { steps: [h] }).response,
    );

    // The same merit with the traced row REMOVED goes back to the old step.
    expect(systemResponse(sys, [BACK], [power]).response).toEqual(
      systemResponse(sys, [BACK], [power], { steps: [CBRT_EPS] }).response,
    );

    // …and a traced row that is HELD rather than wished chooses it too.
    const heldTraced = optimizeSystem(
      sys,
      [BACK, FOCUS],
      { minimize: [power], hold: [wfRms()] },
      { steps: [h, CBRT_EPS * 4] },
    );
    const auto = optimizeSystem(sys, [BACK, FOCUS], { minimize: [power], hold: [wfRms()] });
    expect(auto.x).toEqual(heldTraced.x);
  });
});
