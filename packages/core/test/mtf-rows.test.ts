import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex, LINE_D } from "../src/materials/dispersion";
import { pupilGrid } from "../src/pupil/aiming";
import { optimizeSystem, withVariables, type TracedOperand } from "../src/analysis/optimize";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, fitRms, balancedRms, coefficient } from "../src/wave/zernike";
import { bestFocus } from "../src/analysis/focus";
import { systemPupil, psfFromSystemPupil } from "../src/wave/psf";
import { mtf, mtfAt, diffractionLimitedMtf } from "../src/wave/mtf";
import { fft2d } from "../src/math/fft";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * Step 1.8.14 — a contrast wish's rows, and the three transfers that failed.
 *
 * § 1.8.12 gave a spot its rays and § 1.8.13 gave a wavefront RMS its Zernike
 * terms. `mtf` is the third operand of that shape, and § 1.8.13 closed by
 * saying its lesson was NOT "decompose this one too". This file measures which
 * parts of the pattern reach contrast, and the answer is none of them.
 *
 * **The rows exist and cannot carry the merit.** At a frequency BIN the reading
 * is |OTF|/OTF(0), so `(re, im)/OTF(0)` are two signed rows whose squares sum
 * to the reading squared — bitwise, in the same arithmetic `mtf()` uses. But
 * both shipped decompositions satisfy Σ rows² = value², and the merit is
 * (value − target)²; the two are the same question only at target 0, which is
 * why `validate` refuses a nonzero target on a transverse spot and on a
 * decomposed wavefront. On contrast a target of 0 is a wish for **no image at
 * all**. And off a bin the rows do not exist even in principle: `mtfAt` blends
 * two MODULI, which is not the modulus of any complex pair.
 *
 * **The mechanism does not transfer.** § 1.8.13's one-row wavefront was
 * paralysed by rank — a 1 × 2 Jacobian's outer product is singular by
 * construction. One contrast row is exactly as singular and the run converges
 * anyway, on `step`, in ~135 evaluations. Rank-one paralysis was a property of
 * a merit whose residual reaches zero, not of one row.
 *
 * **And the remedy does not transfer.** A second frequency gives rank two and a
 * KKT test that can leave 1 — and lands in the same place, for twice the
 * traces. It buys the readout, not the answer.
 *
 * What bites instead is what the merit spends its freedom ON. The external
 * number is the same as § 1.8.12's and § 1.8.13's — Coddington's shape factor
 * for least spherical aberration at infinite conjugate, q* = 2(n²−1)/(n+2)
 * (Jenkins & White; Hecht § 6.3) — on the same singlet, seeded half a shape
 * factor away with the image plane already placed, so that the SHAPE is the
 * only defect the merit is looking at. A wavefront merit recovers q* to
 * 1.1·10⁻³. Every contrast merit here leaves the shape where it found it and
 * buys its contrast with a third of a wave of defocus instead, converging to a
 * true fixed point 21% below what the same operand reaches when the shape is
 * placed first. An MTF wish is a wish about the PLANE.
 */

registerMedium(constantIndex("MTF-N15", 1.5));

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
      medium: "MTF-N15",
      isStop: true,
    },
    { kind: "refract", curvature: 0, semiAperture: SEMI * 1.2, thickness: F, medium: "AIR" },
  ],
};
const VARS: SolveVariable[] = [
  { kind: "curvature", surface: 0 },
  { kind: "curvature", surface: 1 },
];
/** § 1.8.12's and § 1.8.13's own seed: half a shape factor from the best form. */
const SEED = fromQ(qStar(N) + 0.5);

const systemAt = (x: readonly number[], plane: number): OpticalSystem => {
  const p = withVariables(BASE, VARS, x);
  return {
    prescription: {
      ...p,
      surfaces: p.surfaces.map((s, i) => (i === 1 ? { ...s, thickness: plane } : s)),
    },
    aperture: { kind: "stopRadius", value: SEMI },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
};

/**
 * The plane the seed actually focuses on, placed by the engine's own criterion.
 *
 * § 1.8.12 and § 1.8.13 leave it at F, where the thick singlet's back focus
 * misses by 1.7 mm and the seed carries four waves of DEFOCUS on top of its
 * shape error. That is the right fixture for those two — both readings are
 * norms and defocus is just more of the thing they minimise — and it is the
 * wrong one here, because this rung's whole question is what a contrast merit
 * spends its freedom on. Placed, the seed's only defect is the shape.
 */
const PLANE = bestFocus(systemAt(SEED, F), "minRmsWavefront").offsetFromLastVertex;
const at = (x: readonly number[]): OpticalSystem => systemAt(x, PLANE);

const OPTS = { pupilSamples: 32, padFactor: 4, traceSamples: 21, zernikeTerms: 28 };
const fitAt = (x: readonly number[]) => fitZernike(opdMap(at(x), 0, LINE_D, GRID).samples, TERMS);
/** The reading `mtfRead` takes, spelled through the same two calls. */
const contrastAt = (x: readonly number[], nu: number): number => {
  const image = psfFromSystemPupil(systemPupil(at(x), 0, LINE_D, OPTS), 0, OPTS);
  return mtfAt(mtf(image), nu, image.pupilSamples);
};

const mtfOp = (nu: number): TracedOperand => ({
  kind: "mtf",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  nu,
  ...OPTS,
  // Unreachable on a singlet, which is the point: an unreachable target still
  // has its least-squares minimum at maximum contrast, and § 1.8.8 refuses to
  // let the closed form be read as a target a design could hit.
  target: diffractionLimitedMtf(nu),
});
const wfTerms: TracedOperand = {
  kind: "wavefront",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  pupil: GRID,
  terms: TERMS,
  target: 0,
  weight: 1,
  reading: "rms",
  form: "terms",
};

/** § 1.8.13's operand from the same seed — the shape a wavefront merit finds. */
const WAVEFRONT = optimizeSystem(at(SEED), VARS, [wfTerms], { maxIterations: 400 });

describe("§ 1.8.14 — the rows exist, and they are not the merit", () => {
  /** The complex transform `mtf()` takes the modulus of, recomputed here. */
  const transform = (x: readonly number[]) => {
    const image = psfFromSystemPupil(systemPupil(at(x), 0, LINE_D, OPTS), 0, OPTS);
    const n = image.size;
    const re = Float64Array.from(image.intensity);
    const im = new Float64Array(n * n);
    fft2d(re, im, n);
    return { re, im, dc: Math.hypot(re[0]!, im[0]!), m: mtf(image), image };
  };

  it("at a frequency BIN, the reading IS a pair of signed rows — to the bit", () => {
    // ν·pupilSamples an integer means `mtfAt` interpolates nothing, so the
    // reading is one stored cell: |OTF|/OTF(0) at that bin. The two rows are
    // its real and imaginary parts over the same normalisation, and they
    // reproduce the reading exactly rather than nearly.
    const { re, im, dc, m } = transform(SEED);
    for (const nu of [0.25, 0.5, 0.75]) {
      const k = nu * OPTS.pupilSamples;
      const value = mtfAt(m, nu, OPTS.pupilSamples);
      expect(Math.hypot(re[k]!, im[k]!) / dc).toBe(value);
      // …and as a sum of squares, which is the spelling a decomposed form
      // would hand the solver: the same number to the last bit or one before.
      const rows = [re[k]! / dc, im[k]! / dc];
      const sum = rows[0]! * rows[0]! + rows[1]! * rows[1]!;
      expect(Math.abs(Math.sqrt(sum) / value - 1)).toBeLessThan(1e-15);
    }
  });

  it("…and OFF a bin there is no complex pair at all: the reading blends two MODULI", () => {
    // `mtfAt` is linear between the two straddling bins of the MODULUS array.
    // A blend of two moduli is not the modulus of the blended complex pair
    // whenever the transform turns between them — and on an aberrated design
    // it turns hard: the OTF changes sign, the complex parts cancel, the moduli
    // do not. So the decomposition is unavailable at a general ν, before the
    // question of what merit it would spell is even asked.
    const { re, im, dc, m } = transform(SEED);
    const gap = (nu: number): number => {
      const t = nu * OPTS.pupilSamples;
      const i = Math.floor(t);
      const f = t - i;
      const blended = Math.hypot(
        (re[i]! * (1 - f) + re[i + 1]! * f) / dc,
        (im[i]! * (1 - f) + im[i + 1]! * f) / dc,
      );
      return blended / mtfAt(m, nu, OPTS.pupilSamples) - 1;
    };
    expect(gap(0.15)).toBeCloseTo(-0.796, 3);
    expect(gap(0.35)).toBeCloseTo(-0.368, 3);
  });

  it("the other candidate — one row per pupil overlap — measures nothing at all", () => {
    // The identity the header of `mtf.ts` states: the OTF is the pupil's
    // autocorrelation, OTF(ν) = Σ_k P_k·conj(P_{k+s}). That IS a sum, so its
    // terms look like rows. They are not: |P_k·conj(P_{k+s})| is a product of
    // AMPLITUDES, which no amount of design changes, so Σ|row|² is a constant
    // where |Σ row| — the reading — is not. Rows whose squares cannot see the
    // design are a merit that measures nothing, which is the same defect the
    // term-count floor of § 1.8.7 refuses in the wavefront's currency.
    const rowSums = (x: readonly number[], shiftBins: number) => {
      const { pupil } = systemPupil(at(x), 0, LINE_D, OPTS);
      const n = OPTS.pupilSamples;
      const step = 2 / n;
      let sumRe = 0;
      let sumIm = 0;
      let sumSq = 0;
      for (let iy = 0; iy < n; iy++) {
        const py = -1 + (iy + 0.5) * step;
        for (let ix = 0; ix + shiftBins < n; ix++) {
          const px = -1 + (ix + 0.5) * step;
          const qx = -1 + (ix + shiftBins + 0.5) * step;
          const aA = pupil.amplitude(px, py);
          const bA = pupil.amplitude(qx, py);
          if (aA === 0 || bA === 0) continue;
          const aP = 2 * Math.PI * pupil.phaseWaves(px, py);
          const bP = 2 * Math.PI * pupil.phaseWaves(qx, py);
          const [ar, ai] = [aA * Math.cos(aP), aA * Math.sin(aP)];
          const [br, bi] = [bA * Math.cos(bP), bA * Math.sin(bP)];
          const rowRe = ar * br + ai * bi;
          const rowIm = ai * br - ar * bi;
          sumRe += rowRe;
          sumIm += rowIm;
          sumSq += rowRe * rowRe + rowIm * rowIm;
        }
      }
      return { sumSq, modulus: Math.hypot(sumRe, sumIm) };
    };
    const seed = rowSums(SEED, OPTS.pupilSamples / 2);
    const answer = rowSums(WAVEFRONT.x, OPTS.pupilSamples / 2);
    // The reading at ν = 0.5 moves 14.8× between these two designs, and this
    // sum's own modulus — the same quantity through a different machinery —
    // moves 9.0×…
    expect(contrastAt(WAVEFRONT.x, 0.5) / contrastAt(SEED, 0.5)).toBeGreaterThan(10);
    expect(answer.modulus / seed.modulus).toBeGreaterThan(8);
    // …while Σ|row|² moves by 8.6·10⁻⁷. What is left of even that is the traced
    // pupil's own amplitude at the rim, not the phase: the phase cannot enter a
    // sum of squared moduli at all.
    expect(Math.abs(answer.sumSq / seed.sumSq - 1)).toBeLessThan(1e-5);
  });

  it("a `form` on a contrast operand is refused BY NAME rather than ignored", () => {
    // The type has no such field, and the type is not there at run time. A
    // field that falls through a switch is § 1.8.13's own defect — silently
    // wrong rather than broken — so this is refused at the point it would have
    // been introduced, with the reason in the message.
    expect(() =>
      optimizeSystem(at(SEED), VARS, [{ ...mtfOp(0.5), form: "terms" } as TracedOperand], {}),
    ).toThrow(/no decomposed spelling/);
  });
});

describe("§ 1.8.14 — rank one, and a run that converges anyway", () => {
  /** Differenced outside the solver, at the step `designSteps` would choose. */
  const H = Math.cbrt(Number.EPSILON) / (SEMI * 1.2);
  const jacobian = (x: readonly number[], nus: readonly number[]): number[][] =>
    [0, 1].map((i) => {
      const plus = [...x];
      plus[i] = plus[i]! + H;
      const minus = [...x];
      minus[i] = minus[i]! - H;
      return nus.map((nu) => (contrastAt(plus, nu) - contrastAt(minus, nu)) / (2 * H));
    });
  const eigenvalues = (J: number[][]): [number, number] => {
    const a = J[0]!.reduce((s, v) => s + v * v, 0);
    const b = J[0]!.reduce((s, v, k) => s + v * J[1]![k]!, 0);
    const d = J[1]!.reduce((s, v) => s + v * v, 0);
    const tr = a + d;
    const disc = Math.sqrt(Math.max(0, tr * tr - 4 * (a * d - b * b)));
    return [(tr + disc) / 2, (tr - disc) / 2];
  };

  it("one row over two variables is singular — and NOT exactly zero, as § 1.8.13's was", () => {
    // Same construction, and a claim that would have been wrong if transferred
    // verbatim: § 1.8.13 measured the second eigenvalue at exactly 0 and this
    // one is 10⁻¹⁶ of the first, because the outer product's determinant is a
    // cancellation in f64 rather than a structural zero. Singular either way —
    // there is a direction in the design space one row cannot see — but the
    // digit is the fixture's, not the algebra's.
    const [big, small] = eigenvalues(jacobian(SEED, [0.15]));
    expect(big).toBeGreaterThan(1e10);
    expect(small / big).toBeLessThan(1e-14);
  });

  it("…and two frequencies are rank two, which is the only thing more rows buy", () => {
    // 8.97·10¹⁰ against 6.01·10², so rank two and conditioned at 1.5·10⁸ —
    // twenty times worse than § 1.8.13's decomposed wavefront, which is what
    // two rows of one quantity should look like beside ten of a basis. Enough
    // for the KKT test to leave 1; not enough to change where the run lands.
    const [big, small] = eigenvalues(jacobian(SEED, [0.15, 0.5]));
    expect(small).toBeGreaterThan(1e2);
    expect(big / small).toBeLessThan(1e9);
  });
});

describe("§ 1.8.14 — what a contrast merit spends its freedom on", () => {
  const alone15 = optimizeSystem(at(SEED), VARS, [mtfOp(0.15)], { maxIterations: 200 });
  const after15 = optimizeSystem(at(WAVEFRONT.x), VARS, [mtfOp(0.15)], { maxIterations: 200 });
  const alone50 = optimizeSystem(at(SEED), VARS, [mtfOp(0.5)], { maxIterations: 200 });
  const after50 = optimizeSystem(at(WAVEFRONT.x), VARS, [mtfOp(0.5)], { maxIterations: 200 });

  it("the seed's only defect is its SHAPE, and the wavefront merit removes it", () => {
    // The plane is placed, so the defocus term is 1.5·10⁻² waves against 0.27
    // of total error — the fixture's premise, asserted rather than assumed.
    expect(Math.abs(coefficient(fitAt(SEED), 4))).toBeLessThan(0.02);
    expect(fitRms(fitAt(SEED))).toBeCloseTo(0.2731, 4);
    expect(qOf(SEED[0], SEED[1])).toBeCloseTo(qStar(N) + 0.5, 12);
    // § 1.8.13's operand, on this fixture: Coddington's best form to 1.1e-3.
    expect(Math.abs(qOf(WAVEFRONT.x[0]!, WAVEFRONT.x[1]!) - qStar(N))).toBeLessThan(1.2e-3);
    expect(fitRms(fitAt(WAVEFRONT.x))).toBeCloseTo(0.2145, 4);
  });

  it("THE rung: a contrast merit leaves the shape where it found it and buys DEFOCUS", () => {
    // Half a shape factor of error, and the merit moves 8·10⁻⁴ of it — while
    // spending a third of a wave on the plane it was already given. Both
    // frequencies, and the ν = 0.5 run walks two waves out to a side lobe.
    for (const r of [alone15, alone50]) {
      expect(Math.abs(qOf(r.x[0]!, r.x[1]!) - qOf(SEED[0], SEED[1]))).toBeLessThan(6e-3);
      expect(Math.abs(qOf(r.x[0]!, r.x[1]!) - qStar(N))).toBeGreaterThan(0.49);
      // the balanced error — what the shape actually controls — is untouched
      expect(balancedRms(fitAt(r.x))).toBeCloseTo(balancedRms(fitAt(SEED)), 2);
      // …and the defocus it did buy is an order above the seed's
      expect(Math.abs(coefficient(fitAt(r.x), 4))).toBeGreaterThan(0.4);
    }
    expect(coefficient(fitAt(alone15.x), 4)).toBeCloseTo(-0.4295, 3);
    expect(fitRms(fitAt(alone50.x))).toBeCloseTo(2.051, 2);
  });

  it("…and it has CONVERGED: restarted there it does not move, on a merit that is a fixed point", () => {
    // The complaint is not that the run stops early. Both runs stop on `step`,
    // and restarting at the answer moves it by less than a nanometre of
    // curvature — this is § 1.8.12's "a converged answer is a fixed point"
    // applied to a design nobody would ship.
    for (const r of [alone15, alone50]) {
      expect(r.reason).toBe("step");
      expect(r.evaluations).toBeLessThan(200);
      // one row: the KKT cosine is 1 by construction, exactly as § 1.8.12 and
      // § 1.8.13 measured, so it is not what stopped this run either
      expect(r.gradient).toBe(1);
    }
    const again = optimizeSystem(at(alone15.x), VARS, [mtfOp(0.15)], { maxIterations: 200 });
    expect(Math.hypot(again.x[0]! - alone15.x[0]!, again.x[1]! - alone15.x[1]!)).toBeLessThan(1e-9);

    // …while a wavefront merit started at that same point walks to the same q*
    // it reached from the seed, and drops the error by 58%.
    const rescued = optimizeSystem(at(alone15.x), VARS, [wfTerms], { maxIterations: 400 });
    expect(Math.abs(qOf(rescued.x[0]!, rescued.x[1]!) - qStar(N))).toBeLessThan(1.2e-3);
    expect(1 - fitRms(fitAt(rescued.x)) / fitRms(fitAt(alone15.x))).toBeCloseTo(0.579, 2);
  });

  it("the price, in contrast's own currency", () => {
    // The same operand, the same frequency, the same variables — asked after a
    // wavefront merit has placed the shape instead of instead of it. 21.0% more
    // contrast at ν = 0.15 and 9.2% at ν = 0.5, and the ν = 0.5 pair is the
    // narrower gap only because the run that skipped the shape landed on a
    // side lobe that reads well.
    expect(contrastAt(after15.x, 0.15) / contrastAt(alone15.x, 0.15) - 1).toBeCloseTo(0.21, 2);
    expect(contrastAt(after50.x, 0.5) / contrastAt(alone50.x, 0.5) - 1).toBeCloseTo(0.092, 2);
    // …and the shape survives being asked for contrast: given q*, both runs
    // keep it to 4·10⁻⁴, so the two merits agree about the GLASS.
    for (const r of [after15, after50]) {
      expect(Math.abs(qOf(r.x[0]!, r.x[1]!) - qOf(WAVEFRONT.x[0]!, WAVEFRONT.x[1]!))).toBeLessThan(
        4e-4,
      );
    }
  });

  it("…and they disagree about the PLANE, which each frequency asks for differently", () => {
    // From one design, two frequencies and two answers: 0.32 waves of defocus
    // at ν = 0.15 and 0.22 at ν = 0.5, 45% apart, where the wavefront merit
    // asks for none at all. That best focus depends on the spatial frequency
    // is ordinary optics; what is new here is that it is the merit's whole
    // output on this fixture.
    expect(Math.abs(coefficient(fitAt(WAVEFRONT.x), 4))).toBeLessThan(1e-3);
    expect(coefficient(fitAt(after15.x), 4)).toBeCloseTo(-0.3218, 3);
    expect(coefficient(fitAt(after50.x), 4)).toBeCloseTo(-0.2221, 3);
  });

  it("a second frequency changes the readout and not the answer", () => {
    // Rank two, so the KKT test can leave 1 and the run can report the optimum
    // it reached rather than the cap it hit. It reaches the same one: the shape
    // is within 1.5e-4 of the one-row landing, for two traces instead of one.
    const two = optimizeSystem(at(SEED), VARS, [mtfOp(0.15), mtfOp(0.5)], { maxIterations: 200 });
    expect(two.reason).toBe("step");
    expect(two.gradient).toBeLessThan(1e-2);
    expect(Math.abs(qOf(two.x[0]!, two.x[1]!) - qOf(alone15.x[0]!, alone15.x[1]!))).toBeLessThan(
      2e-4,
    );
    expect(Math.abs(qOf(two.x[0]!, two.x[1]!) - qStar(N))).toBeGreaterThan(0.49);
  });
});
