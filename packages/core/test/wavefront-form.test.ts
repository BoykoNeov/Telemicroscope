import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex, LINE_D } from "../src/materials/dispersion";
import { pupilGrid } from "../src/pupil/aiming";
import { optimizeSystem, withVariables, type TracedOperand } from "../src/analysis/optimize";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, fitRms, balancedRms, zernike } from "../src/wave/zernike";
import { refractorPair } from "../src/designs/refractor";
import { systemProperties } from "../src/trace/paraxial";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * Step 1.8.13 — a wavefront wish as ONE row, or as the terms it is the
 * root-sum-square of.
 *
 * § 1.8.12 fixed the spot and forecast this one: "an OPD map's per-sample
 * residuals, scaled so their squares sum to the fitted RMS". **That forecast is
 * the wrong shape and this step measures why.** `fitRms` is √(Σ_{j≥2} c_j²)
 * exactly — Parseval on an orthonormal basis — so the merit is ALREADY a sum of
 * squares and its terms are the Zernike coefficients. A sample's OPD is not a
 * term of it: it carries the piston the reading excludes and the part of the
 * map the fit did not represent, and the discrete basis is not orthonormal on a
 * clipped grid anyway. Both per-sample spellings land 1.4% from the number the
 * operand is defined as; the coefficients land on it to the bit.
 *
 * The second thing that did not transfer is the MECHANISM. § 1.8.12's spot was
 * defeated by the dropped Σrᵢ∇²rᵢ, 2.2·10⁷ against 0.4. Here that term is
 * 4.5·10⁻³ of the one that is kept and the run is stuck harder: what stops it
 * is the RANK. One row over two variables is a rank-one JᵀJ by construction,
 * and it measures as one — second eigenvalue exactly zero.
 *
 * The external number is Coddington's shape factor for least spherical
 * aberration at infinite conjugate, q* = 2(n²−1)/(n+2) — the same closed form
 * § 1.8.5, § 1.8.12 and § 5j.1 are built on (Jenkins & White; Hecht § 6.3). It
 * pins this operand for a reason worth stating: at third order the wave and
 * transverse spherical aberrations are the same coefficient, so the shape that
 * nulls one nulls the other, and a wavefront merit has to find the same form a
 * spot merit does. Measured: 1.09·10⁻³ of shape factor, where the one-row
 * spelling ends 5.08·10⁻¹ away — on the seed it started at.
 */

registerMedium(constantIndex("WF-N15", 1.5));

const N = 1.5;
const F = 1000;
const SEMI = 50;
const GRID = pupilGrid(11);
const TERMS = 11;
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
      medium: "WF-N15",
      isStop: true,
    },
    { kind: "refract", curvature: 0, semiAperture: SEMI * 1.2, thickness: F, medium: "AIR" },
  ],
};
const VARS: SolveVariable[] = [
  { kind: "curvature", surface: 0 },
  { kind: "curvature", surface: 1 },
];
const at = (x: readonly number[]): OpticalSystem => ({
  prescription: withVariables(BASE, VARS, x),
  aperture: { kind: "stopRadius", value: SEMI },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LINE_D, weight: 1 }],
  conjugate: { kind: "infinite" },
});
const fitAt = (x: readonly number[]) => {
  const map = opdMap(at(x), 0, LINE_D, GRID);
  return { map, fit: fitZernike(map.samples, TERMS) };
};
const rmsOf = (x: readonly number[]): number => fitRms(fitAt(x).fit);
const op = (reading: "rms" | "balancedRms", form: "value" | "terms"): TracedOperand => ({
  kind: "wavefront",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil: GRID,
  terms: TERMS,
  target: 0,
  weight: 1,
  reading,
  form,
});
/** Half a shape factor from the best form — § 1.8.5's own start, and § 1.8.12's. */
const SEED = fromQ(qStar(N) + 0.5);

describe("§ 1.8.13 — the two forms are one merit", () => {
  it("Σ of the coefficient rows IS the fitted RMS squared, to the bit", () => {
    // `maxIterations: 0` evaluates the start and stops. Unlike § 1.8.12's spot
    // — where the two spellings differ in the ORDER 154 squares are summed in
    // and agree to 6.4e-16 — this identity is exact: `fitRms` computes the same
    // sum over the same terms in the same order, then takes a root the merit
    // squares back. Nothing is rescaled, which is why there is no 1/√N here.
    const value = optimizeSystem(at(SEED), VARS, [op("rms", "value")], { maxIterations: 0 });
    const terms = optimizeSystem(at(SEED), VARS, [op("rms", "terms")], { maxIterations: 0 });
    expect(value.residuals).toHaveLength(1);
    expect(terms.residuals).toHaveLength(TERMS - 1);
    expect(value.merit).toBe(rmsOf(SEED) ** 2);
    expect(terms.merit).toBe(value.merit);
  });

  it("…and a weight means the same thing in both, also to the bit", () => {
    // A weight multiplies every row, so it scales Σ c_j² by w² exactly as it
    // scales (w·rms)². Pinned because the alternative — a weight meaning
    // "per row" — would silently reprice a mixed merit by the term count.
    const value = optimizeSystem(at(SEED), VARS, [{ ...op("rms", "value"), weight: 3 }], {
      maxIterations: 0,
    });
    const terms = optimizeSystem(at(SEED), VARS, [{ ...op("rms", "terms"), weight: 3 }], {
      maxIterations: 0,
    });
    expect(terms.merit).toBe(value.merit);
    // The two FORMS are bitwise; the weight against the unweighted merit is
    // not, and the difference is where the multiply happens rather than
    // anything about the operand — w·c_j rounded per row against w²·Σc_j².
    expect(Math.abs(value.merit / (9 * rmsOf(SEED) ** 2) - 1)).toBeLessThan(1e-15);
  });

  it("and they cost the same per iteration — the rows come off one fit", () => {
    // The Jacobian is 2n trial designs whatever m is. Same number as § 1.8.12's
    // spot, and for the same reason: this is a conditioning change, not a
    // resolution knob being paid for.
    const value = optimizeSystem(at(SEED), VARS, [op("rms", "value")], { maxIterations: 7 });
    const terms = optimizeSystem(at(SEED), VARS, [op("rms", "terms")], { maxIterations: 7 });
    expect(value.evaluations).toBe(36);
    expect(terms.evaluations).toBe(36);
  });

  it("THE forecast, refuted: a per-SAMPLE row is not a term of this merit", () => {
    // § 1.8.12 forecast per-sample residuals "scaled so their squares sum to
    // the fitted RMS". They do not sum to it, and the two ways of reading
    // "per-sample" miss by the same 1.4% — which is what says the shortfall is
    // the discrete grid rather than the part of the map the fit dropped.
    const { map, fit } = fitAt(SEED);
    const fitted = fitRms(fit);
    expect(map.samples).toHaveLength(77);

    const raw = map.samples.map((s) => s.waves);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const rawRms = Math.sqrt(raw.reduce((a, b) => a + (b - mean) ** 2, 0) / raw.length);
    expect(rawRms / fitted - 1).toBeCloseTo(0.0139, 4);

    // The fitted model resampled at the same points — no fit residual in it at
    // all, so if the grid were orthonormal this would be exact. It is not.
    let modelSq = 0;
    for (const s of map.samples) {
      let w = 0;
      for (let j = 2; j <= TERMS; j++) w += fit.coefficients[j - 1]! * zernike(j, s.px, s.py);
      modelSq += w * w;
    }
    expect(Math.sqrt(modelSq / raw.length) / fitted - 1).toBeCloseTo(0.014, 4);

    // …where the coefficients are the merit itself, with nothing left over.
    let coeffSq = 0;
    for (let j = 2; j <= TERMS; j++) coeffSq += fit.coefficients[j - 1]! ** 2;
    expect(Math.sqrt(coeffSq)).toBe(fitted);
  });
});

describe("§ 1.8.13 — what the form is worth on TWO free curvatures", () => {
  const value = optimizeSystem(at(SEED), VARS, [op("rms", "value")], { maxIterations: 400 });
  const terms = optimizeSystem(at(SEED), VARS, [op("rms", "terms")], { maxIterations: 400 });

  it("the decomposed form recovers Coddington's best form; the one-row form never leaves the seed", () => {
    // THE rung. q* is a closed form from outside the engine and the seed is
    // half a shape factor from it. At third order the wave and transverse
    // spherical aberrations are one coefficient, so a wavefront merit has to
    // land where § 1.8.12's spot merit landed — and it does, closer (1.09e-3
    // against 4.7e-4 is the same order, both residues unattributed).
    expect(Math.abs(qOf(terms.x[0]!, terms.x[1]!) - qStar(N))).toBeLessThan(1.2e-3);
    // …where the one-row form ends 0.508 from q*, having not moved off the seed
    // in any meaningful sense: 0.008 of shape for 2 001 evaluations.
    expect(qOf(value.x[0]!, value.x[1]!)).toBeCloseTo(1.2222, 3);
    expect(Math.abs(qOf(value.x[0]!, value.x[1]!) - qOf(SEED[0], SEED[1]))).toBeLessThan(0.01);
  });

  it("…and the EFL it settles at is § 1.8.5's own bound on a free power", () => {
    expect(systemProperties(at(terms.x).prescription, LINE_D).efl).toBeCloseTo(1004.8, 0);
  });

  it("the wavefront it costs: the one-row form ends 28.0% above the answer", () => {
    expect(rmsOf(value.x)).toBeCloseTo(0.26912, 4);
    expect(rmsOf(terms.x)).toBeCloseTo(0.21029, 4);
    expect(rmsOf(value.x) / rmsOf(terms.x) - 1).toBeCloseTo(0.28, 2);
  });

  it("the one-row run stops with the KKT test reading exactly 1, which it cannot leave", () => {
    expect(value.gradient).toBe(1);
    expect(value.reason).toBe("iterations");
    expect(value.evaluations).toBe(2001);
    expect(terms.gradient).toBeLessThan(1e-8);
    expect(terms.reason).toBe("step");
    expect(terms.evaluations).toBeLessThan(200);
  });

  it("THE PROOF the one-row answer is not an optimum: restarted there, the run moves", () => {
    // No external digit needed. A converged answer is a fixed point; this one
    // is not, and the point it moves to is the decomposed answer.
    const again = optimizeSystem(at(value.x), VARS, [op("rms", "terms")], { maxIterations: 400 });
    expect(Math.hypot(again.x[0]! - value.x[0]!, again.x[1]! - value.x[1]!)).toBeGreaterThan(1e-4);
    expect(rmsOf(again.x)).toBeLessThan(rmsOf(value.x));
    expect(rmsOf(again.x)).toBeCloseTo(rmsOf(terms.x), 9);

    // …and the decomposed answer IS a fixed point, to the last bits — where the
    // spot's crawled 1.3e-15 and this moves 8.1e-13 of curvature.
    const stay = optimizeSystem(at(terms.x), VARS, [op("rms", "terms")], { maxIterations: 400 });
    expect(Math.hypot(stay.x[0]! - terms.x[0]!, stay.x[1]! - terms.x[1]!)).toBeLessThan(1e-11);
  });
});

describe("§ 1.8.13 — the mechanism is the RANK, not the dropped curvature term", () => {
  /** The residual vector, differenced outside the solver so this is not a readout of it. */
  const resid = (x: readonly number[], form: "value" | "terms"): number[] => {
    const fit = fitAt(x).fit;
    if (form === "value") return [fitRms(fit)];
    const out: number[] = [];
    for (let j = 2; j <= TERMS; j++) out.push(fit.coefficients[j - 1]!);
    return out;
  };
  const jacobian = (form: "value" | "terms", h = 1e-6): number[][] =>
    [0, 1].map((i) => {
      const p = [...SEED];
      p[i] = p[i]! + h;
      const n = [...SEED];
      n[i] = n[i]! - h;
      const rp = resid(p, form);
      const rn = resid(n, form);
      return rp.map((v, k) => (v - rn[k]!) / (2 * h));
    });
  const eigs = (J: number[][]): [number, number] => {
    const a = J[0]!.reduce((s, v) => s + v * v, 0);
    const b = J[0]!.reduce((s, v, k) => s + v * J[1]![k]!, 0);
    const d = J[1]!.reduce((s, v) => s + v * v, 0);
    const tr = a + d;
    const disc = Math.sqrt(Math.max(0, tr * tr - 4 * (a * d - b * b)));
    return [(tr + disc) / 2, (tr - disc) / 2];
  };

  it("one row over two variables is a rank-one JᵀJ, and it measures as one", () => {
    // Not "ill-conditioned" — SINGULAR, by construction: a 1 × 2 Jacobian's
    // outer product has one nonzero eigenvalue however the design is placed, so
    // there is a direction in the design space the step cannot see at all.
    // THIS is what the KKT test reading exactly 1 is a symptom of.
    const [big, small] = eigs(jacobian("value"));
    expect(big).toBeGreaterThan(1e11);
    expect(small).toBe(0);

    // The decomposed form is rank two — badly conditioned, and that is a
    // different complaint with a different remedy (the damping is for it).
    const [tBig, tSmall] = eigs(jacobian("terms"));
    expect(tSmall).toBeGreaterThan(1e4);
    expect(tBig / tSmall).toBeLessThan(1e7);
  });

  it("…and `\"terms\"` is not a PROMISE of rank — at the reading's floor it is one row again", () => {
    // A bound authored this session is still a bound. The rows number
    // `terms − 1`, so `terms: 2` on `"rms"` — allowed, because only BELOW the
    // floor is refused — decomposes to a single row and cannot exceed rank one
    // over two variables. The 2.8·10⁴ measured above is a property of an
    // 11-term fit, not of the form.
    //
    // What does survive the boundary is the other half, and it is pinned as an
    // identity rather than by a sign this fixture happens to give: the row IS
    // the coefficient, signed, where the summary is its magnitude. On axis at
    // this design that coefficient is positive and the two rows coincide, which
    // is exactly why asserting "they differ" would have been a fixture fact
    // rather than the claim.
    const two = (form: "value" | "terms"): TracedOperand => ({
      kind: "wavefront",
      fieldValue: 0.5,
      wavelengthNm: LINE_D,
      pupil: GRID,
      terms: 2,
      target: 0,
      weight: 1,
      reading: "rms",
      form,
    });
    const value = optimizeSystem(at(SEED), VARS, [two("value")], { maxIterations: 0 });
    const terms = optimizeSystem(at(SEED), VARS, [two("terms")], { maxIterations: 0 });
    expect(terms.residuals).toHaveLength(1);
    expect(terms.merit).toBe(value.merit);

    const fit = fitZernike(opdMap(at(SEED), 0.5, LINE_D, GRID).samples, 2);
    expect(terms.residuals[0]).toBe(fit.coefficients[1]);
    expect(value.residuals[0]).toBe(Math.abs(fit.coefficients[1]!));
  });

  it("…and the term a Gauss–Newton step DROPS is negligible here, unlike the spot's", () => {
    // § 1.8.12 measured 2.2e7 against 0.4 and that is why the spot's fix works.
    // Transferring the explanation would have been wrong: on this operand the
    // dropped Σrᵢ∇²rᵢ is under 1% of the term that is kept in BOTH spellings.
    // Measured here so the claim "one defect with two readings" is corrected by
    // a number rather than left standing.
    const h = 1e-6;
    const dropped = (form: "value" | "terms"): number => {
      const r0 = resid(SEED, form);
      const shift = (a: number, sa: number, b: number, sb: number): number[] => {
        const z = [...SEED];
        z[a] = z[a]! + sa * h;
        z[b] = z[b]! + sb * h;
        return resid(z, form);
      };
      let acc = 0;
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          let s = 0;
          for (let k = 0; k < r0.length; k++) {
            const d2 =
              a === b
                ? (shift(a, 1, a, 0)[k]! - 2 * r0[k]! + shift(a, -1, a, 0)[k]!) / (h * h)
                : (shift(a, 1, b, 1)[k]! -
                    shift(a, 1, b, -1)[k]! -
                    shift(a, -1, b, 1)[k]! +
                    shift(a, -1, b, -1)[k]!) /
                  (4 * h * h);
            s += r0[k]! * d2;
          }
          acc += s * s;
        }
      }
      return Math.sqrt(acc);
    };
    const kept = (form: "value" | "terms"): number => {
      const J = jacobian(form);
      let acc = 0;
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          let s = 0;
          for (let k = 0; k < J[a]!.length; k++) s += J[a]![k]! * J[b]![k]!;
          acc += s * s;
        }
      }
      return Math.sqrt(acc);
    };
    expect(dropped("value") / kept("value")).toBeLessThan(1e-2);
    expect(dropped("terms") / kept("terms")).toBeLessThan(1e-3);
  });
});

describe("§ 1.8.13 — the reading that removes terms, and the reading with nothing to remove", () => {
  it("with the power HELD, balancedRms lands on the same shape in both forms", () => {
    // The negative control, and the ONLY way this reading may be run: its own
    // comment records that over a free power it walks the focal length to
    // 2 036 mm and reports 4e-12 waves on a lens that forms no image where the
    // image is. Measured again here at 1 809 mm and 1.2e-12 — so the condition
    // is not decoration.
    const target = 1 / systemProperties(withVariables(BASE, VARS, fromQ(qStar(N))), LINE_D).efl;
    const answers = (["value", "terms"] as const).map((form) =>
      optimizeSystem(
        at(SEED),
        VARS,
        {
          minimize: [op("balancedRms", form)],
          hold: [{ kind: "power", wavelengthNm: LINE_D, target }],
        },
        { maxIterations: 400 },
      ),
    );
    const [value, terms] = answers;
    expect(value!.reason).toBe("step");
    expect(terms!.reason).toBe("step");
    // `balancedRms` sums from Noll 5, so the rows are j = 5…terms — four fewer
    // than the `"rms"` form's, not three.
    expect(terms!.residuals).toHaveLength(TERMS - 4);
    // A condition removes the free direction the rank-one model could not
    // follow, and then the two forms agree — which is what says the decomposed
    // form is a better-conditioned spelling of one question, not a new one.
    expect(
      Math.abs(qOf(value!.x[0]!, value!.x[1]!) - qOf(terms!.x[0]!, terms!.x[1]!)),
    ).toBeLessThan(1e-4);
    expect(qOf(terms!.x[0]!, terms!.x[1]!)).toBeCloseTo(0.7042, 3);
    const balanced = (x: readonly number[]): number => balancedRms(fitAt(x).fit);
    expect(Math.abs(balanced(terms!.x) / balanced(value!.x) - 1)).toBeLessThan(1e-9);
  });

  it("a zernike reading has no decomposed form, because it is already one signed row", () => {
    // Stated as a type error rather than a runtime refusal: `form` is a field
    // on the two RMS variants only. The run is here to show the reading was
    // never the one with the defect — one Noll coefficient is signed, so its
    // Jacobian has the rank the RMS one lacks and it converges as it always
    // did. § 1.8.7's numbers on this reading do not move.
    const spherical: TracedOperand = {
      kind: "wavefront",
      fieldValue: 0,
      wavelengthNm: LINE_D,
      pupil: GRID,
      terms: TERMS,
      target: 0,
      weight: 1,
      reading: "zernike",
      noll: 11,
    };
    const r = optimizeSystem(at(SEED), VARS, [spherical], { maxIterations: 400 });
    expect(r.residuals).toHaveLength(1);
    expect(r.reason).toBe("step");
    expect(Math.abs(fitAt(r.x).fit.coefficients[10]!)).toBeLessThan(1e-6);
  });
});

describe("§ 1.8.13 — the app's achromat, which is where § 1.8.12's forecast was measured", () => {
  const ACH = refractorPair(500, 25, 500).achromat;
  const AVARS: SolveVariable[] = [
    { kind: "curvature", surface: 0 },
    { kind: "curvature", surface: 2 },
  ];
  const aat = (x: readonly number[]): OpticalSystem => ({
    prescription: withVariables(ACH, AVARS, x),
    aperture: { kind: "stopRadius", value: 25 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  });
  const ASEED = [ACH.surfaces[0]!.curvature, ACH.surfaces[2]!.curvature];
  const aRms = (x: readonly number[]): number =>
    fitRms(fitZernike(opdMap(aat(x), 0, LINE_D, GRID).samples, TERMS));

  it("the forecast's own numbers reproduce, and the decomposed form closes the gap it named", () => {
    // § 1.8.12 recorded 9.0126156741e-3 for the run against a Nelder–Mead
    // reference of 6.7406570415e-3 — 33.7% above — and left the remedy unbuilt.
    // Both halves are here: the one-row form still reads what it read, and the
    // decomposed form reaches the INDEPENDENT reference to nine significant
    // figures. That reference is not an external number and is not treated as
    // one; the external pin is q* on the singlet above.
    const value = optimizeSystem(aat(ASEED), AVARS, [op("rms", "value")], { maxIterations: 400 });
    const terms = optimizeSystem(aat(ASEED), AVARS, [op("rms", "terms")], { maxIterations: 400 });
    expect(aRms(value.x)).toBeCloseTo(9.0126156741e-3, 12);
    expect(value.reason).toBe("iterations");
    expect(value.gradient).toBe(1);
    // Nine significant figures against a reference produced by a different
    // method entirely — stated as a relative difference, because that is the
    // claim. An absolute tolerance here would be a statement about 10⁻³ waves.
    expect(Math.abs(aRms(terms.x) / 6.7406570415e-3 - 1)).toBeLessThan(5e-9);
    expect(terms.reason).toBe("step");
    expect(aRms(value.x) / aRms(terms.x) - 1).toBeCloseTo(0.337, 3);
  });
});

describe("§ 1.8.13 — the two refusals", () => {
  it("a decomposed reading cannot carry a nonzero target", () => {
    expect(() =>
      optimizeSystem(at(SEED), VARS, [{ ...op("rms", "terms"), target: 1e-3 }], {}),
    ).toThrow(/no summary to aim at/);
  });

  it("…and cannot be held, because a condition is one equation", () => {
    expect(() =>
      optimizeSystem(
        at(SEED),
        VARS,
        {
          minimize: [op("rms", "value")],
          hold: [
            {
              kind: "wavefront",
              fieldValue: 0,
              wavelengthNm: LINE_D,
              pupil: GRID,
              terms: TERMS,
              target: 0,
              reading: "rms",
              form: "terms",
            },
          ],
        },
        {},
      ),
    ).toThrow(/one per Zernike term, so it can be minimised but not held/);
  });
});
