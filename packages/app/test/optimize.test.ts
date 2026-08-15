import { describe, it, expect } from "vitest";
import { optimizePrescription, type SolveVariable } from "@telemicroscope/core/analysis";
import {
  OPTIMIZE_SEEDS,
  TRAIL_MAX_POINTS,
  bestFormShapeFactor,
  defaultSpec,
  describeOptimize,
  optimizeSeedById,
  operandFor,
  trailWorkLevels,
  type OptimizeSpec,
} from "../src/optimize";
import { getMedium, LINE_D } from "@telemicroscope/core/materials";

/**
 * APP.md Part N — design mode's second half on a screen.
 *
 * App wiring only: the physics is VALIDATION § 1.8's and no rung here pins an
 * external number that step does not already carry. What this file pins is the
 * three things the PANEL claims that the engine does not:
 *
 *  1. **The convergence trail is a replay.** Both plots are drawn by running the
 *     optimiser again with its iteration cap set to 1, 2, 3 …, which is only
 *     honest if a capped run is exactly the longer run's prefix. That is a
 *     property of the engine nothing asserted, because nothing needed it until a
 *     picture was drawn from it.
 *  2. **The one-against-two comparison is computed, not quoted.** Part M
 *     measured 29× of colour-correction damage from a single-variable retarget.
 *     If this panel printed that constant in prose beside its own number the two
 *     could drift apart silently, so both sides are recomputed and both are
 *     pinned here.
 *  3. **The currency control changes the ANSWER, not only the work.** § 1.8
 *     measures the extreme case — a target on the far side of an afocal
 *     configuration, unreachable in millimetres. The panel offers the same
 *     switch on every seed, and what it does to a *reachable* target is the
 *     units lesson: in millimetres a focal miss is a million times larger than
 *     the same miss in diopters, so it swamps whatever else the merit wanted.
 */

const specFor = (id: (typeof OPTIMIZE_SEEDS)[number]["id"], part: Partial<OptimizeSpec> = {}) => {
  const seed = optimizeSeedById(id);
  return { ...defaultSpec(), seed: id, wishes: seed.wishes, ...part };
};

const ok = (spec: OptimizeSpec) => {
  const r = describeOptimize(spec);
  if (!r.ok) throw new Error(`describeOptimize refused: ${r.error}`);
  return r;
};

describe("the trail is a replay of the same run, not a reconstruction", () => {
  it("a capped run is the longer run's prefix, on every field the result carries", () => {
    const seed = optimizeSeedById("retarget");
    const operands = seed.wishes.map((w) => operandFor(w, seed, "power"));
    const full = optimizePrescription(seed.prescription, seed.variables, operands, {});
    expect(full.iterations).toBeGreaterThan(4);

    let previous: ReturnType<typeof optimizePrescription> | null = null;
    for (let k = 1; k <= full.iterations; k++) {
      const step = optimizePrescription(seed.prescription, seed.variables, operands, {
        maxIterations: k,
      });
      // While it is still running, work is exactly the cap — a rejected step
      // spends an iteration and moves nothing, which is why the panel's x axis
      // is labelled work rather than progress.
      if (step.reason === "iterations") {
        expect(step.accepted + step.rejected).toBe(k);
        expect(step.iterations).toBe(k);
      }
      if (previous !== null) {
        // An extension: never fewer accepted or rejected steps, never a worse
        // merit, and the damping carried forward rather than restarted.
        expect(step.accepted).toBeGreaterThanOrEqual(previous.accepted);
        expect(step.rejected).toBeGreaterThanOrEqual(previous.rejected);
        expect(step.merit).toBeLessThanOrEqual(previous.merit);
        if (step.accepted === previous.accepted) {
          // No accepted step between them, so the answer cannot have moved.
          expect(step.x).toEqual(previous.x);
        }
      }
      previous = step;
    }
    // And the cap set at exactly the full run's length reproduces it bit for bit.
    const capped = optimizePrescription(seed.prescription, seed.variables, operands, {
      maxIterations: full.iterations,
    });
    expect(capped.x).toEqual(full.x);
    expect(capped.merit).toBe(full.merit);
    expect(capped.accepted).toBe(full.accepted);
    expect(capped.rejected).toBe(full.rejected);
    expect(capped.damping).toBe(full.damping);
    expect(capped.evaluations).toBe(full.evaluations);
  });

  it("the trail the panel draws is bounded, and keeps both ends", () => {
    for (const iterations of [1, 5, TRAIL_MAX_POINTS, TRAIL_MAX_POINTS + 1, 100, 1000]) {
      const levels = trailWorkLevels(iterations);
      expect(levels.length).toBeLessThanOrEqual(TRAIL_MAX_POINTS + 1);
      expect(levels[0]).toBe(1);
      expect(levels[levels.length - 1]).toBe(iterations);
      expect([...levels]).toEqual([...levels].sort((a, b) => a - b));
      expect(new Set(levels).size).toBe(levels.length);
    }
    // The trail on the panel's own default is drawn at every iteration.
    const r = ok(specFor("retarget"));
    expect(r.trail.length).toBe(r.iterations);
    expect(r.trail[r.trail.length - 1]!.merit).toBe(r.merit);
  });
});

describe("one number against two, recomputed rather than quoted", () => {
  it("reproduces Part M's damage and undoes it with a second freedom", () => {
    const r = ok(specFor("retarget"));
    expect(r.single).not.toBeNull();
    const single = r.single!;

    // Part M's finding, recomputed: the single-variable retarget to 400 mm hits
    // the focal length and takes the F−C spread from −0.0439 mm to −1.277 mm.
    expect(single.eflMm).toBeCloseTo(400, 6);
    expect(Math.abs(single.spreadRatio)).toBeGreaterThan(25);
    expect(Math.abs(single.spreadRatio)).toBeLessThan(35);

    // Two curvatures with the colour as a wish: the same focal length, and a
    // spread that is gone rather than merely smaller.
    expect(r.wishes[0]!.value).toBeCloseTo(400, 9);
    expect(Math.abs(r.spreadAfterMm)).toBeLessThan(1e-12);
    expect(Math.abs(r.spreadAfterMm)).toBeLessThan(Math.abs(single.spreadMm) * 1e-10);
  });

  it("the wishes read back in their OWN units, whatever the merit saw", () => {
    // The focal wish is solved in 1/mm and reported in mm: "you are 400 mm
    // short" is the sentence that means something, and the panel's whole answer
    // block depends on this not being the residual vector.
    const r = ok(specFor("retarget"));
    expect(r.wishes[0]!.unit).toBe("mm");
    expect(r.wishes[0]!.solvedUnit).toBe("1/mm");
    expect(r.wishes[0]!.value).toBeGreaterThan(100);
    const inFocal = ok(specFor("retarget", { currency: "focal" }));
    expect(inFocal.wishes[0]!.solvedUnit).toBe("mm");
  });
});

describe("the currency changes the answer, not only the work", () => {
  it("a target on the far side of afocal is reachable in one currency and not the other", () => {
    const inPower = ok(specFor("currency"));
    expect(inPower.wishes[0]!.value).toBeCloseTo(150, 6);
    expect(inPower.iterations).toBeLessThan(10);

    const inFocal = ok(specFor("currency", { currency: "focal" }));
    // § 1.8's rung, from the panel's side: it stops with the convergence test
    // satisfied, 150 mm from what was asked for.
    expect(inFocal.reason).toBe("gradient");
    expect(Math.abs(inFocal.wishes[0]!.leftover)).toBeCloseTo(150, 2);
    expect(inFocal.wishes[0]!.relative).toBeGreaterThan(0.9);
  });

  it("and on a REACHABLE target it changes which wish gets granted", () => {
    // Both runs hit the focal length. In millimetres the focal residual is a
    // million times the colour one, so the colour wish is spent buying a
    // precision on the focal length nobody asked for.
    const inPower = ok(specFor("retarget"));
    const inFocal = ok(specFor("retarget", { currency: "focal" }));
    expect(inFocal.wishes[0]!.value).toBeCloseTo(400, 4);
    expect(Math.abs(inFocal.spreadAfterMm)).toBeGreaterThan(1);
    expect(Math.abs(inFocal.spreadAfterMm)).toBeGreaterThan(
      Math.abs(inPower.spreadAfterMm) * 1e10,
    );
    // And it costs the whole iteration budget to get there.
    expect(inFocal.reason).toBe("iterations");
  });

  it("…except where every wish can be granted at once", () => {
    // The thin doublet's two wishes reach zero together, so there is nothing for
    // a change of units to trade off. Both currencies land on the same lens.
    const inPower = ok(specFor("split"));
    const inFocal = ok(specFor("split", { currency: "focal" }));
    expect(inFocal.to[0]!).toBeCloseTo(inPower.to[0]!, 12);
    expect(inFocal.to[1]!).toBeCloseTo(inPower.to[1]!, 12);
  });
});

describe("the closed forms the seeds are checked against", () => {
  it("the thin doublet lands on the textbook split, and the weights cannot move it", () => {
    const r = ok(specFor("split"));
    expect(r.reference).not.toBeNull();
    const ref = r.reference!;
    expect(ref.kind).toBe("thin-split");
    ref.expected.forEach((e, i) => expect(ref.found[i]! / e).toBeCloseTo(1, 12));

    const seed = optimizeSeedById("split");
    const heavy = ok(
      specFor("split", {
        wishes: seed.wishes.map((w, i) => (i === 1 ? { ...w, weight: 1e6 } : w)),
      }),
    );
    expect(heavy.to[0]! / r.to[0]!).toBeCloseTo(1, 11);
  });

  it("the best-form gap separates into a thickness and a weight", () => {
    const r = ok(specFor("bestform"));
    const ref = r.reference!;
    expect(ref.kind).toBe("best-form");
    const n = getMedium("N-BK7").n(LINE_D);
    expect(ref.shapeFactorStar!).toBeCloseTo(bestFormShapeFactor(n), 12);

    // On the real 5 mm singlet the shape sits 4.1e-3 from the published minimum,
    // and that is the lens rather than the optimiser: the same solve on a 1 nm
    // version of it is four orders closer. Coddington's q* is a thin-lens result.
    expect(Math.abs(ref.gapHere!)).toBeGreaterThan(1e-3);
    expect(Math.abs(ref.gapHere!)).toBeLessThan(1e-2);
    expect(Math.abs(ref.gapThin!)).toBeLessThan(Math.abs(ref.gapHere!) / 100);
    expect(ref.thicknessMm).toBe(5);

    // And the residual it settles on is a floor, not a miss: a singlet cannot
    // null its own spherical aberration at any shape.
    expect(r.wishes[1]!.value).toBeGreaterThan(1e-3);
  });
});

describe("the basin, which is all a descent can report", () => {
  it("agrees with a second start where the answer is unique, and does not pretend to elsewhere", () => {
    const clean = ok(specFor("retarget"));
    expect(clean.basin.agreed).toBe(true);
    expect(clean.basin.worstRelative).toBeLessThan(1e-9);

    // The same lens asked in the wrong currency does not even reach the same
    // place from 8% away — the run is out of iterations rather than converged,
    // and the panel says so instead of calling the difference a second root.
    const wrong = ok(specFor("retarget", { currency: "focal" }));
    expect(wrong.basin.agreed).toBe(false);
    expect(wrong.reason).toBe("iterations");
  });
});

describe("every seed draws, and the refusals are refusals", () => {
  it("all four seeds produce a readout in both currencies", () => {
    for (const seed of OPTIMIZE_SEEDS) {
      for (const currency of ["power", "focal"] as const) {
        const r = ok(specFor(seed.id, { currency }));
        expect(r.to.length).toBe(seed.variables.length);
        expect(r.wishes.length).toBe(seed.wishes.length);
        expect(r.trail.length).toBeGreaterThan(0);
        expect(r.lines.length).toBe(3);
      }
    }
  });

  it("names what it will not accept", () => {
    const seed = optimizeSeedById("retarget");
    const withWish = (part: Partial<(typeof seed.wishes)[number]>) =>
      describeOptimize(specFor("retarget", { wishes: seed.wishes.map((w, i) => (i === 0 ? { ...w, ...part } : w)) }));

    const zeroWeight = withWish({ weight: 0 });
    expect(zeroWeight.ok).toBe(false);
    if (!zeroWeight.ok) expect(zeroWeight.error).toMatch(/exchange rate/);

    const negative = withWish({ weight: -1 });
    expect(negative.ok).toBe(false);

    const nan = withWish({ target: Number.NaN });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.error).toMatch(/not something to ask for/);

    const zeroFocal = withWish({ target: 0 });
    expect(zeroFocal.ok).toBe(false);
    if (!zeroFocal.ok) expect(zeroFocal.error).toMatch(/not a design target/);
  });

  it("holds the marginal ray height fixed, because S_I carries h⁴", () => {
    // Not a control the panel offers, and that is the point: a height that moved
    // with the design would change the merit for a reason that is not the design.
    const seed = optimizeSeedById("bestform");
    expect(seed.marginalHeightMm).toBe(25);
    const operand = operandFor(seed.wishes[1]!, seed, "power");
    expect(operand.kind).toBe("seidelS1");
    if (operand.kind === "seidelS1") expect(operand.marginalHeightMm).toBe(25);
  });

  it("every seed's variables are distinct, which the engine refuses", () => {
    for (const seed of OPTIMIZE_SEEDS) {
      const keys = seed.variables.map((v: SolveVariable) => `${v.kind}:${v.surface}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(seed.variableLabels.length).toBe(seed.variables.length);
      expect(seed.variableUnits.length).toBe(seed.variables.length);
    }
  });
});
