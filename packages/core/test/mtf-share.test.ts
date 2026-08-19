import { describe, it, expect, vi } from "vitest";

/**
 * The counters have to exist before the factory below runs, and `vi.mock` is
 * hoisted above every import in this file — `vi.hoisted` is the only place a
 * value can be put that is initialised in time for it.
 */
const TRACES = vi.hoisted(() => ({ pupil: 0, psf: 0 }));

/**
 * The only mock in this suite, and it measures rather than replaces: both
 * wrappers call straight through, so every number this file reads is the
 * engine's own. It is here because the saving this step is about happens
 * INSIDE one evaluation, where `DlsResult.evaluations` cannot see it — the
 * question "how many times was the lens traced" has no other honest answer
 * than counting the calls.
 */
vi.mock("../src/wave/psf", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/wave/psf")>();
  return {
    ...real,
    systemPupil: (...a: Parameters<typeof real.systemPupil>) => {
      TRACES.pupil++;
      return real.systemPupil(...a);
    },
    psfFromSystemPupil: (...a: Parameters<typeof real.psfFromSystemPupil>) => {
      TRACES.psf++;
      return real.psfFromSystemPupil(...a);
    },
  };
});

import type { OpticalSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex, LINE_D } from "../src/materials/dispersion";
import { pupilGrid } from "../src/pupil/aiming";
import {
  optimizeSystem,
  withVariables,
  type TracedOperand,
  type MtfCondition,
} from "../src/analysis/optimize";
import { bestFocus } from "../src/analysis/focus";
import { systemPupil, psfFromSystemPupil } from "../src/wave/psf";
import { mtf, mtfAt, diffractionLimitedMtf } from "../src/wave/mtf";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * Step 1.8.15 — several frequencies are readings off ONE array, and now cost
 * one trace.
 *
 * § 1.8.14 closed the operand-decomposition ladder and left one thing measured
 * and unbuilt: two contrast frequencies were two full traces and two transform
 * pairs per evaluation, "where they are two readings off one array". That
 * paragraph also recorded why it had not been built — the rows channel returns
 * per-operand residuals carrying a target of 0 by construction, and N
 * frequencies have N targets of their own — and that reason was about the wrong
 * mechanism. Sharing does not need the rows channel at all. N operands still
 * return N residuals against N targets; what they stop doing is tracing the
 * same lens N times to get them.
 *
 * **What is actually shared, which is more than the paragraph claimed.** A
 * contrast reading is a pupil TRACE, a transform to the PSF, a transform to the
 * MTF, and then one array lookup. Measured on this fixture at 32 pupil samples
 * the trace is ~29–36% of it and the two transforms ~64–71%, and the lookup is
 * 1·10⁻⁵ of it. § 1.8.14 called the saving "sharing the transform" and that
 * names about two thirds of it: ν enters at the lookup and nowhere earlier, so
 * everything before it is shared and a second frequency is free to five decimal
 * places.
 *
 * **The channel is one slot, not a history.** Both entry points build a trial
 * prescription once per evaluation and hand that same object to every operand,
 * and `withVariable` copies rather than mutates — so object identity implies
 * the design, and a slot keyed on it is hit by every operand of one evaluation
 * and by none of the next. A map over every trial would hold megabyte
 * modulation arrays alive; a slot's worst case is a cache MISS, which is the
 * speed this file's rungs measure and not an answer.
 *
 * **Neutrality is the claim that matters and it is checked two ways.** The
 * residual vector a shared read produces is compared BITWISE against the same
 * reading spelled out longhand, at the seed and at the design the run converges
 * on; and the run's own bookkeeping — evaluation count, accepted steps, stop
 * reason, KKT test — reproduces § 1.8.14's recorded numbers exactly, which a
 * saving that changed any digit could not do.
 *
 * The fixture is § 1.8.14's own singlet, seeded half a shape factor from
 * Coddington's best form with the plane already placed, so the runs this file
 * counts are the runs that step measured.
 */

registerMedium(constantIndex("MTF-SHARE-N15", 1.5));

const N = 1.5;
const F = 1000;
const SEMI = 50;
/** Coddington's best form at infinite conjugate. */
const qStar = (n: number): number => (2 * (n * n - 1)) / (n + 2);
const DC = 1 / ((N - 1) * F);
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
      medium: "MTF-SHARE-N15",
      isStop: true,
    },
    { kind: "refract", curvature: 0, semiAperture: SEMI * 1.2, thickness: F, medium: "AIR" },
  ],
};
const VARS: SolveVariable[] = [
  { kind: "curvature", surface: 0 },
  { kind: "curvature", surface: 1 },
];
/** § 1.8.14's seed: half a shape factor from the best form. */
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
/** § 1.8.14's placed plane, so the seed's only defect is its shape. */
const PLANE = bestFocus(systemAt(SEED, F), "minRmsWavefront").offsetFromLastVertex;
const at = (x: readonly number[]): OpticalSystem => systemAt(x, PLANE);

const OPTS = { pupilSamples: 32, padFactor: 4, traceSamples: 21, zernikeTerms: 28 };
const mtfOp = (nu: number, over: Partial<MtfCondition> = {}): TracedOperand => ({
  kind: "mtf",
  fieldValue: 0,
  wavelengthNm: LINE_D,
  nu,
  ...OPTS,
  target: diffractionLimitedMtf(nu),
  ...over,
});

/** The reading, spelled out longhand — the three calls `mtfRead` shares. */
const contrastAt = (x: readonly number[], nu: number): number => {
  const image = psfFromSystemPupil(systemPupil(at(x), 0, LINE_D, OPTS), 0, OPTS);
  return mtfAt(mtf(image), nu, image.pupilSamples);
};

/** A run, with the traced stages it cost — counted from zero across the call. */
const counted = (operands: readonly TracedOperand[]) => {
  TRACES.pupil = 0;
  TRACES.psf = 0;
  const r = optimizeSystem(at(SEED), VARS, operands, { maxIterations: 200 });
  return { r, pupil: TRACES.pupil, psf: TRACES.psf };
};

describe("§ 1.8.15 — N frequencies, one trace", () => {
  const one = counted([mtfOp(0.15)]);
  const two = counted([mtfOp(0.15), mtfOp(0.5)]);
  const four = counted([mtfOp(0.15), mtfOp(0.3), mtfOp(0.5), mtfOp(0.7)]);

  it("the cost is ONE traced stage per evaluation, whatever the frequency count", () => {
    // The +1 is the survivor lock's own read at the starting design, which is a
    // design like any other and therefore shares too: N frequencies key it once
    // rather than N times. So the whole run's traced stages are `evaluations`
    // + 1 for every operand count, which is what "several frequencies are one
    // question" means once it is stated in cost.
    expect(one.pupil).toBe(one.r.evaluations + 1);
    expect(two.pupil).toBe(two.r.evaluations + 1);
    expect(four.pupil).toBe(four.r.evaluations + 1);
    // The transform count follows the trace count exactly — there is no branch
    // where a pupil is traced and not transformed, or the reverse.
    expect(one.psf).toBe(one.pupil);
    expect(two.psf).toBe(two.pupil);
    expect(four.psf).toBe(four.pupil);
  });

  it("…against the 2× and 4× it was, which is the saving stated as a count", () => {
    // What § 1.8.14 measured and did not spend: 2.020 traced stages per
    // evaluation at two frequencies and 4.006 at four, both of them N + N/evals
    // exactly. Asserted here as the counterfactual those numbers came from, so
    // the rung fails if the sharing is ever removed rather than merely slowed.
    expect(2 * (two.r.evaluations + 1)).toBe(202);
    expect(4 * (four.r.evaluations + 1)).toBe(2664);
    expect(two.pupil).toBe(101);
    expect(four.pupil).toBe(666);
  });

  it("one frequency is unchanged — nothing was bought from the single-operand case", () => {
    // The saving is between operands, so a run with one of them must cost what
    // it always did. § 1.8.14's own digits: 135 evaluations, KKT exactly 1.
    expect(one.r.evaluations).toBe(135);
    expect(one.pupil).toBe(136);
    expect(one.r.gradient).toBe(1);
    expect(one.r.reason).toBe("step");
  });
});

describe("§ 1.8.15 — and the answer does not move, to the bit", () => {
  const two = optimizeSystem(at(SEED), VARS, [mtfOp(0.15), mtfOp(0.5)], { maxIterations: 200 });

  it("a shared residual IS the longhand reading — at the seed and at the answer", () => {
    // The direct check, and the reason it is worth more than a recorded digit:
    // it recomputes the whole chain from the trace up, in this process, and
    // compares with `toBe`. `maxIterations: 0` evaluates the start and stops,
    // so this is the residual vector the solver's first step is built on.
    const start = optimizeSystem(at(SEED), VARS, [mtfOp(0.15), mtfOp(0.5)], { maxIterations: 0 });
    expect(start.residuals[0]).toBe(contrastAt(SEED, 0.15) - diffractionLimitedMtf(0.15));
    expect(start.residuals[1]).toBe(contrastAt(SEED, 0.5) - diffractionLimitedMtf(0.5));
    // …and again at the design the run stopped on, which is the check a stale
    // slot would fail: a reading held over from an earlier trial would agree
    // here with nothing at all.
    expect(two.residuals[0]).toBe(contrastAt(two.x, 0.15) - diffractionLimitedMtf(0.15));
    expect(two.residuals[1]).toBe(contrastAt(two.x, 0.5) - diffractionLimitedMtf(0.5));
  });

  it("…and the run reproduces § 1.8.14's recorded bookkeeping exactly", () => {
    // Measured on this fixture before the sharing existed and pinned here. The
    // integers are the sharp end: a merit that had changed in the last place
    // would take a different number of steps long before it changed a digit
    // anyone quotes.
    expect(two.evaluations).toBe(100);
    expect(two.accepted).toBe(6);
    expect(two.reason).toBe("step");
    expect(two.gradient).toBeCloseTo(1.5350096313156713e-3, 15);
    expect(two.merit).toBeCloseTo(3.802189683875607e-1, 15);
    expect(two.x[0]).toBeCloseTo(2.2148389641969157e-3, 17);
    expect(two.x[1]).toBeCloseTo(2.1372559787005162e-4, 17);
  });
});

describe("§ 1.8.15 — what shares, and what must not", () => {
  it("the same sampling spelled two ways shares — the key is the RESOLVED options", () => {
    // `padFactor` omitted against `padFactor: 4` is the same array by
    // definition, and the defaults are resolved above the key so that it is
    // also the same KEY. Keyed off the operand's own fields instead, these two
    // would trace twice and the saving would silently not happen for the caller
    // who spelled one of them the short way.
    const short: TracedOperand = {
      kind: "mtf",
      fieldValue: 0,
      wavelengthNm: LINE_D,
      nu: 0.5,
      pupilSamples: OPTS.pupilSamples,
      target: diffractionLimitedMtf(0.5),
    };
    const run = counted([mtfOp(0.15), short]);
    expect(run.pupil).toBe(run.r.evaluations + 1);
  });

  it("…and a DIFFERENT sampling does not — two arrays are two traces", () => {
    // The boundary on the other side. 32 samples and 16 are two different
    // modulation arrays that read two different numbers at the same ν — § 1.8.8's
    // 0.66/N bias is why they differ — so sharing them would be wrong rather
    // than merely surprising. Two keys, two traces, and the count says so.
    const run = counted([mtfOp(0.15), mtfOp(0.15, { pupilSamples: 16 })]);
    expect(run.pupil).toBe(2 * (run.r.evaluations + 1));
    // …and they are indeed two readings of one design, not one reading twice.
    const fineOpts = { ...OPTS, pupilSamples: 16 };
    const coarse = psfFromSystemPupil(systemPupil(at(SEED), 0, LINE_D, OPTS), 0, OPTS);
    const fine = psfFromSystemPupil(systemPupil(at(SEED), 0, LINE_D, fineOpts), 0, fineOpts);
    expect(mtfAt(mtf(coarse), 0.15, coarse.pupilSamples)).not.toBe(
      mtfAt(mtf(fine), 0.15, fine.pupilSamples),
    );
  });

  it("a wavefront operand beside two frequencies traces its own map and shares neither", () => {
    // Mixed merits are the ordinary case, and the slot is per-reading rather
    // than per-evaluation: the two frequencies collapse to one traced stage
    // while the wavefront operand goes through `opdMap`, which is a different
    // chain and is not counted here at all. What this pins is that adding one
    // does not break the frequencies' sharing.
    const wf: TracedOperand = {
      kind: "wavefront",
      fieldValue: 0,
      wavelengthNm: LINE_D,
      pupil: pupilGrid(11),
      terms: 11,
      target: 0,
      reading: "rms",
    };
    const run = counted([wf, mtfOp(0.15), mtfOp(0.5)]);
    expect(run.pupil).toBe(run.r.evaluations + 1);
  });
});

describe("§ 1.8.15 — where the cost actually is", () => {
  it("the trace is a THIRD of a reading, so 'the transform' names two thirds of it", () => {
    // § 1.8.14's note called this "sharing the transform". Measured, the two
    // transforms are the larger half and the trace is not a rounding error, so
    // the saving is BOTH stages and the sentence is corrected here rather than
    // inherited. Bounds rather than values: a timing is about the machine, and
    // what this rung is for is the SHAPE of the split.
    const sys = at(SEED);
    const time = (f: () => unknown, reps: number): number => {
      for (let i = 0; i < 3; i++) f();
      const t0 = performance.now();
      for (let i = 0; i < reps; i++) f();
      return (performance.now() - t0) / reps;
    };
    const pupil = systemPupil(sys, 0, LINE_D, OPTS);
    const image = psfFromSystemPupil(pupil, 0, OPTS);
    const m = mtf(image);

    const trace = time(() => systemPupil(sys, 0, LINE_D, OPTS), 10);
    const transform = time(() => mtf(psfFromSystemPupil(pupil, 0, OPTS)), 10);
    const sample = time(() => mtfAt(m, 0.15, image.pupilSamples), 2000);
    const total = trace + transform + sample;

    expect(trace / total).toBeGreaterThan(0.15);
    expect(trace / total).toBeLessThan(0.55);
    // …and the part a second frequency still pays: one array lookup, five
    // decades below the reading it comes from. THIS is why the count above is
    // 1 per evaluation and not 1.02.
    expect(sample / total).toBeLessThan(1e-3);
  });
});
