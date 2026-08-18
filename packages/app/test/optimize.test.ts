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
  shapeFactor,
  trailWorkLevels,
  type OptimizeSpec,
} from "../src/optimize";
import { getMedium, LINE_D } from "@telemicroscope/core/materials";
import { systemProperties } from "@telemicroscope/core/trace";

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
  // …and the seed's own variables, as `pickSeed` does: a selection is a list
  // of ids that belong to one seed, so carrying another's over is how a spec
  // ends up asking a question about surfaces this lens does not have.
  return { ...defaultSpec(), seed: id, wishes: seed.wishes, variables: seed.defaultVariables, ...part };
};

/**
 * A seed's default selection as the engine takes it. The seeds carry a MENU
 * now, and the ids are the panel's storage; a test that wants "what this seed
 * moves out of the box" has to resolve them the same way the panel does.
 */
const defaultVars = (seed: (typeof OPTIMIZE_SEEDS)[number]): SolveVariable[] =>
  seed.menu.filter((c) => seed.defaultVariables.includes(c.id)).map((c) => c.variable);

const ok = (spec: OptimizeSpec) => {
  const r = describeOptimize(spec);
  if (!r.ok) throw new Error(`describeOptimize refused: ${r.error}`);
  return r;
};

describe("the trail is a replay of the same run, not a reconstruction", () => {
  it("a capped run is the longer run's prefix, on every field the result carries", () => {
    const seed = optimizeSeedById("retarget");
    const operands = seed.wishes.map((w) => operandFor(w, seed, "power"));
    const full = optimizePrescription(seed.prescription, defaultVars(seed), operands, {});
    expect(full.iterations).toBeGreaterThan(4);

    let previous: ReturnType<typeof optimizePrescription> | null = null;
    for (let k = 1; k <= full.iterations; k++) {
      const step = optimizePrescription(seed.prescription, defaultVars(seed), operands, {
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
    const capped = optimizePrescription(seed.prescription, defaultVars(seed), operands, {
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

    // The row's first cell is the lens BEFORE anything moved — briefly the
    // solved one instead, which is the whole point of the comparison: all three
    // rows share a target and differ in where they started.
    //
    // And it is 499.714 rather than the 500 the design is named for, which is
    // § 5j.2's own residual arriving on a screen: that step imposes the
    // thin-lens power split on a thick doublet and leaves the Gullstrand
    // thickness term in on purpose, a few parts in 10⁴ low. The panel prints
    // what the lens traces, not what it is called.
    expect(r.startEflMm).toBeCloseTo(499.714, 3);
    expect(1 - r.startEflMm / 500).toBeGreaterThan(1e-4);
    expect(1 - r.startEflMm / 500).toBeLessThan(1e-3);
    expect(r.startEflMm).not.toBeCloseTo(r.wishes[0]!.value, 3);

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

/**
 * The best-form seed's merit, run on the same singlet with its centre thickness
 * (and optionally the focal wish's weight) changed: how far the shape factor
 * lands from Coddington's published minimum. The panel offers neither control,
 * which is why the sweep lives here and the panel shows two points off it.
 */
function gapAtThickness(
  thicknessMm: number,
  focalWeight?: number,
  steps?: readonly number[],
): number {
  const seed = optimizeSeedById("bestform");
  const prescription = {
    ...seed.prescription,
    surfaces: [
      { ...seed.prescription.surfaces[0]!, thickness: thicknessMm },
      seed.prescription.surfaces[1]!,
    ],
  };
  const operands = seed.wishes.map((w, i) =>
    operandFor(i === 0 && focalWeight !== undefined ? { ...w, weight: focalWeight } : w, seed, "power"),
  );
  const r = optimizePrescription(prescription, defaultVars(seed), operands, steps ? { steps } : {});
  return shapeFactor(r.x[0]!, r.x[1]!) / bestFormShapeFactor(getMedium("N-BK7").n(LINE_D)) - 1;
}

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

  it("…and the thickness half of that gap is LINEAR in the thickness", () => {
    // APP.md Part N's finding 5 states this sweep, so it is run rather than
    // remembered. The panel itself computes only the two ends of it — the lens
    // as shipped and a 1 nm control — and a claim no test reads is exactly the
    // drift `surfaces.test.ts` exists to catch.
    const gaps = [0.05, 0.5, 5, 20].map((t) => Math.abs(gapAtThickness(t)));
    for (let i = 1; i < gaps.length; i++) {
      const thicknessRatio = [0.5, 5, 20][i - 1]! / [0.05, 0.5, 5][i - 1]!;
      expect(gaps[i]! / gaps[i - 1]!).toBeCloseTo(thicknessRatio, 0);
    }
    // The numbers the document quotes, to the digit it quotes them at.
    expect(gaps[0]!).toBeCloseTo(4.0e-5, 6);
    expect(gaps[2]!).toBeCloseTo(4.07e-3, 5);
    // …and at 1 nm the thickness has stopped being the story.
    expect(Math.abs(gapAtThickness(1e-6))).toBeLessThan(1e-6);
  });

  it("…while the WEIGHT half improves, and then reverses — at the DEFAULT step", () => {
    // The other half of finding 5. Run on the thin lens so the thickness is out
    // of the way. The sweep is real and the panel draws two points off it, but
    // read the next rung before reading a mechanism into its shape.
    const gaps = [1, 1e2, 1e4, 1e6, 1e7].map((w) => Math.abs(gapAtThickness(1e-6, w)));
    for (let i = 1; i < 4; i++) expect(gaps[i]!).toBeLessThan(gaps[i - 1]!);
    expect(gaps[3]!).toBeLessThan(gaps[0]! / 100);
    // Past 1e6 the answer gets WORSE — the measured end of "tighten it by
    // weighting".
    expect(gaps[4]!).toBeGreaterThan(gaps[3]! * 5);
  });

  it("…and that sweep is the differencing STEP, not the weight — § 1.8.6's correction", () => {
    // These curvatures are ~1.3e-3 and the module's default step floors at 1, so
    // the default differences them over half a percent of themselves. State a
    // step and the whole sweep collapses: every weight from 1 to 1e7 lands
    // within 1e-8 of the same shape, four orders better than the best cell of
    // the sweep above, and the ordering between the cells is gone.
    const stated = [1, 1e2, 1e4, 1e6, 1e7].map((w) =>
      Math.abs(gapAtThickness(1e-6, w, [1e-9, 1e-9])),
    );
    for (const g of stated) expect(g).toBeLessThan(1e-8);
    const coarse = [1, 1e2, 1e4, 1e6, 1e7].map((w) => Math.abs(gapAtThickness(1e-6, w)));
    expect(Math.max(...coarse) / Math.max(...stated)).toBeGreaterThan(100);

    // The shape cannot see the weight because q* does not depend on the power:
    // at weight 1 the recovered shape is right and the LENS is 55% wrong.
    const seed = optimizeSeedById("bestform");
    const thin = {
      ...seed.prescription,
      surfaces: [{ ...seed.prescription.surfaces[0]!, thickness: 1e-6 }, seed.prescription.surfaces[1]!],
    };
    const loose = optimizePrescription(
      thin,
      defaultVars(seed),
      seed.wishes.map((w, i) => operandFor(i === 0 ? { ...w, weight: 1 } : w, seed, "power")),
      { steps: [1e-9, 1e-9] },
    );
    const efl = systemProperties(
      {
        ...thin,
        surfaces: [
          { ...thin.surfaces[0]!, curvature: loose.x[0]! },
          { ...thin.surfaces[1]!, curvature: loose.x[1]! },
        ],
      },
      LINE_D,
    ).efl;
    expect(Math.abs(efl / 500 - 1)).toBeGreaterThan(0.5);
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
        expect(r.to.length).toBe(seed.defaultVariables.length);
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

  it("every seed's menu is distinct, and names surfaces the seed has", () => {
    for (const seed of OPTIMIZE_SEEDS) {
      const ids = seed.menu.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The engine refuses the same variable twice, so the menu must not be
      // able to offer it twice under two names either.
      const keys = seed.menu.map((c) => `${c.variable.kind}:${c.variable.surface}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const c of seed.menu) {
        expect(c.variable.surface).toBeLessThan(seed.prescription.surfaces.length);
        expect(c.label.length).toBeGreaterThan(0);
      }
      expect(seed.defaultVariables.length).toBeGreaterThan(0);
      for (const id of seed.defaultVariables) expect(ids).toContain(id);
      // Part M's comparison looks its curvature up by id and asserts it is
      // there, so a typo would take the panel down rather than refuse. Same
      // fault class as the whole id change: a name that resolves to nothing.
      if (seed.singleVariable !== null) expect(ids).toContain(seed.singleVariable.id);
    }
  });
});

/**
 * The variable-selection control, and the readout it forced.
 *
 * Letting a reader choose which numbers may move breaks two things that were
 * silently safe while the variables were the seed's own, and adds one the panel
 * could not say at all:
 *
 *  1. **Everything keyed by position becomes wrong quietly.** The closed-form
 *     comparisons and Part M's single-variable solve used to index the variable
 *     list. Change the set and `x[0]` is a different quantity, and a textbook
 *     value gets printed against it with no error and no NaN. The selection is
 *     stored as ids, the comparisons read curvatures off the built lens, and
 *     the closed forms withhold themselves when the selection is not the one
 *     they describe.
 *  2. **The second start's disagreement stops meaning what it said.** That
 *     control reports "a different lens" — which reads as a second minimum. On
 *     a degenerate selection it is not: both runs reach the same merit at
 *     different points of a flat direction, and on a selection containing a
 *     variable nothing can move it is not even that.
 *  3. **Nothing on the screen carried the degeneracy.** VALIDATION § 1.8.9
 *     measures that the rejected-step count — the number this panel already
 *     printed, and the one APP.md nominated — moves the *other* way.
 */
describe("which numbers may move, and what the merit can see of them", () => {
  it("a selection is a set of ids: clicking the two in the other order is the same run", () => {
    const forward = ok(specFor("retarget", { variables: ["c0", "c2"] }));
    const backward = ok(specFor("retarget", { variables: ["c2", "c0"] }));
    // Bit-identical, because the run takes the menu's order and not the
    // click's — otherwise the same question asked twice is two questions.
    expect(backward.to).toEqual(forward.to);
    expect(backward.variables.map((v) => v.id)).toEqual(["c0", "c2"]);
    expect(backward.geometry.conditionNumber).toBe(forward.geometry.conditionNumber);
  });

  it("the closed form withholds itself when the selection is not the one it describes", () => {
    const asDescribed = ok(specFor("split"));
    expect(asDescribed.reference!.withheld).toBeNull();
    expect(asDescribed.reference!.expected).toHaveLength(2);
    // The textbook split, as before — and now read off the built lens rather
    // than out of the answer vector.
    for (let i = 0; i < 2; i++) {
      const e = asDescribed.reference!.expected[i]!;
      expect(Math.abs(asDescribed.reference!.found[i]! / e - 1)).toBeLessThan(1e-9);
    }

    // Free the cemented face as well and the split is no longer the question
    // being asked: the closed form holds that face fixed. THIS is the rung the
    // whole change is for — before it, the panel would have printed the same
    // two textbook numbers against x[0] and x[1] of a three-variable answer.
    const other = ok(specFor("split", { variables: ["c0", "c1", "c2"] }));
    expect(other.reference!.withheld).not.toBeNull();
    expect(other.reference!.withheld).toMatch(/crown front curvature and flint back curvature/);
    expect(other.reference!.expected).toEqual([]);
    expect(other.reference!.found).toEqual([]);

    // Coddington's shape is withheld the same way, and for the same reason: it
    // is the shape a lens settles at when its SHAPE is what is free.
    const bent = ok(specFor("bestform"));
    expect(bent.reference!.withheld).toBeNull();
    expect(bent.reference!.shapeFactor).toBeCloseTo(0.7367, 3);
    const thickToo = ok(specFor("bestform", { variables: ["c0", "c1", "t0"] }));
    expect(thickToo.reference!.withheld).not.toBeNull();
  });

  it("Part M's comparison names the same curvature whatever is selected", () => {
    // It is a question about ONE curvature on this lens, not about whichever
    // variable happens to be first in the current selection.
    const asShipped = ok(specFor("retarget"));
    const without = ok(specFor("retarget", { variables: ["c2"] }));
    expect(without.variables.map((v) => v.id)).toEqual(["c2"]);
    expect(without.single!.label).toBe("crown front curvature");
    expect(without.single!.to).toBeCloseTo(asShipped.single!.to, 12);
    expect(without.single!.spreadRatio).toBeCloseTo(29.11, 1);
  });

  it("a variable no wish can see is reported dead — and the run's answer does not notice", () => {
    const two = ok(specFor("retarget"));
    const three = ok(specFor("retarget", { variables: ["c0", "c2", "t2"] }));
    // The distance to the image plane: no first-order wish here mentions
    // anything it changes, so its column is exactly zero.
    expect(three.geometry.dead).toEqual([2]);
    expect(three.geometry.response[2]).toBe(0);
    expect(three.geometry.weakest[2]).toBe(0);
    expect(three.geometry.conditionNumber).toBe(two.geometry.conditionNumber);
    // …and the two live curvatures land where they did without it — to ten
    // figures, not to the bit: a zero column still occupies a column of the
    // least-squares step, so the arithmetic around it is not the same
    // arithmetic. The dead one has not moved from the seed's 500 mm at all.
    expect(three.to[0]!).toBeCloseTo(two.to[0]!, 9);
    expect(three.to[1]!).toBeCloseTo(two.to[1]!, 9);
    expect(three.to[0]).not.toBe(two.to[0]);
    expect(three.to[2]).toBe(500);

    // The control that WOULD have reported this reports it as a different
    // lens: the second start nudges the dead variable by 8% and nothing can
    // ever bring it back, so the two runs "disagree" about a number neither of
    // them can move. Not a second basin, and until this readout there was
    // nothing on the screen to say which it was.
    expect(three.basin.agreed).toBe(false);
    expect(three.basin.worstRelative).toBeCloseTo(0.0741, 3);
    expect(three.merit).toBeLessThan(1e-25);
  });

  it("more freedom than wishes reads as unbounded, and the second start then disagrees at the SAME merit", () => {
    const three = ok(specFor("retarget", { variables: ["c0", "c1", "c2"] }));
    expect(three.geometry.conditionNumber).toBe(Infinity);
    expect(three.geometry.dead).toEqual([]);
    expect(three.geometry.wishCount).toBe(2);
    // Two wishes cannot see three directions; the surplus is not a bug and the
    // run still converges. What it costs is uniqueness.
    expect(three.merit).toBeLessThan(1e-25);
    expect(three.basin.agreed).toBe(false);
    expect(three.basin.worstRelative).toBeGreaterThan(1e-2);
    expect(three.basin.merit).toBeLessThan(1e-25);

    const two = ok(specFor("retarget"));
    expect(two.basin.agreed).toBe(true);
    expect(Number.isFinite(two.geometry.conditionNumber)).toBe(true);
  });

  it("the currency moves the conditioning by five orders, and THAT is when the run stops converging", () => {
    const inPower = ok(specFor("retarget"));
    const inFocal = ok(specFor("retarget", { currency: "focal" }));
    expect(inPower.geometry.conditionNumber).toBeCloseTo(169.25, 1);
    expect(inFocal.geometry.conditionNumber).toBeGreaterThan(1e7);
    // The same lens, the same two variables, the same two wishes — and in
    // millimetres the two columns are parallel to eight figures. § 1.8.3's
    // currency finding, seen from the variables rather than from the target.
    expect(inFocal.geometry.worst!.cosine).toBeGreaterThan(1 - 1e-8);
    expect(inPower.reason).toBe("step");
    expect(inFocal.reason).toBe("iterations");
    expect(inFocal.basin.agreed).toBe(false);
  });

  it("the conditioning at the answer is not the conditioning at the start", () => {
    // The best-form seed starts at 2·10³ and STOPS at 2·10⁹: bending the lens
    // towards its least-spherical shape walks the two curvatures' columns into
    // line. A single reading taken before the run would have called this a
    // well-posed question, and one taken after would have called the same
    // question hopeless.
    const r = ok(specFor("bestform"));
    expect(r.geometry.conditionNumber).toBeCloseTo(1999, -1);
    expect(r.geometry.conditionAfter).toBeGreaterThan(1e8);
    expect(r.geometry.conditionAfter / r.geometry.conditionNumber).toBeGreaterThan(1e5);
  });

  it("the readout is over the SELECTED variables, and an empty selection is refused", () => {
    const r = ok(specFor("retarget", { variables: ["c0", "c2", "t2"] }));
    expect(r.geometry.response).toHaveLength(3);
    expect(r.geometry.weakest).toHaveLength(3);
    expect(r.variables.map((v) => v.label)).toEqual([
      "crown front curvature",
      "flint back curvature",
      "to the image plane",
    ]);
    // The live pair carries the whole of the direction the merit can least see.
    expect(r.geometry.weakest[0]! ** 2 + r.geometry.weakest[1]! ** 2).toBeCloseTo(1, 12);

    const nothing = describeOptimize(specFor("retarget", { variables: [] }));
    expect(nothing.ok).toBe(false);
    if (!nothing.ok) {
      expect(nothing.stage).toBe("build");
      expect(nothing.source).toBe("app");
      expect(nothing.error).toMatch(/nothing may move/);
    }
    // An id from another seed names a surface this one may not have, and is
    // dropped rather than trusted.
    const stale = ok(specFor("bestform", { variables: ["c0", "c1", "c2", "t9"] }));
    expect(stale.variables.map((v) => v.id)).toEqual(["c0", "c1"]);
  });
});
