import { describe, it, expect } from "vitest";
import {
  StopPlacement,
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { plosslEyepiece } from "../src/designs/eyepiece";
import { visualMicroscope } from "../src/designs/visual-microscope";
import { pupils } from "../src/pupil/pupils";
import {
  lagrangeExitPupilRadiusMm,
  objectNumericalAperture,
  paraxialObjectNumericalAperture,
  visualMagnification,
} from "../src/pupil/microscope";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";
import { OpticalSystem } from "../src/trace/system";

/**
 * Step 6ah — the paraxial NA of a lens whose entrance pupil is at infinity.
 *
 * **A shipped readout that returned NaN, found by taking the branch the fixture
 * did not.** `paraxialObjectNumericalAperture` is documented as "n·u, with u the
 * entrance pupil's semi-diameter over its distance from the specimen", and it
 * computed exactly that. § 6v then moved `microscopeObjective`'s stop to the
 * back focal plane by DEFAULT, which sends the entrance pupil to infinity — and
 * sends both terms of that ratio there with it. ∞/∞ is NaN, `visualDetailRatio`
 * refuses a non-positive NA, and the app's eyepiece panel answered *"the engine
 * refuses this design"* for every infinity cemented doublet in its catalogue —
 * three shipped rows — from § 6v until this step. Nothing failed: the eyepiece
 * rungs' fixture is a DIN, which is still rim-stopped, and § 6v's own rungs
 * never asked this readout for a number.
 *
 * That is the branch-and-fixture form of a finding this repo has now recorded
 * three times: a shipped option with no rung is a shipped claim with no
 * evidence. Here the unmeasured branch was the DEFAULT one, and the fixture that
 * hid it was the *other* architecture's.
 *
 * The repair is not an approximation. `PupilPlane` has carried `slopeRadius`
 * since § 6u — the aperture as a slope, which is what a pupil at infinity has
 * instead of a radius — and its stated invariant is `radius` finite XOR
 * `slopeRadius` defined. So the two spellings are ONE quantity with two
 * constructions, and § 6ah.2 pins that they agree **to the bit**: on the same
 * 4×/0.10 design the rim lens's semi-diameter-over-arm and the telecentric
 * lens's slope are the same double, and both are the same double as the closed
 * form NA/√(1 − NA²). A limit that is reached exactly is worth more than a
 * tolerance, and it is what makes this a repair rather than a second answer.
 *
 * What the readout is FOR is § 6q.5's Lagrange invariant, which is a statement
 * about paraxial SLOPES — so § 6ah.4 checks the law itself survives, on a
 * telecentric visual instrument, at the same order the rim one holds it to.
 */

const L = LINE_D;
const NA = 0.1;

/**
 * `n·tan u` for a cone of numerical aperture NA in a medium of index n — the
 * paraxial NA in closed form. NA is `n·sin u`, so `sin u = NA/n` and
 * `n·tan u = NA/√(1 − (NA/n)²)`: the index cancels out of the numerator and
 * survives only inside the root, which is why air's form is not the glass one
 * with a factor in front of it.
 */
const tanOf = (na: number, n = 1) => na / Math.sqrt(1 - (na / n) ** 2);

const infinityAt = (stopPlacement: StopPlacement, na = NA, magnification = 4): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification, numericalAperture: na, stopPlacement }),
    tubeLens: tubeLens(),
  }).system;

const dinAt = (
  stopPlacement: StopPlacement,
  over: Parameters<typeof finiteConjugateObjective>[0] | Record<string, unknown> = {},
): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({
      magnification: 4,
      numericalAperture: NA,
      stopPlacement,
      ...(over as object),
    }),
  }).system;

describe("§ 6ah.1 — THE REGRESSION: the default infinity objective had no paraxial NA at all", () => {
  it("answers with a number on every infinity doublet the catalogue ships", () => {
    // The three rows: 4×, 10× and 20×, all NA 0.10, all telecentric by § 6v's
    // default. Before this step each returned NaN and the app printed an engine
    // refusal in place of the panel.
    for (const magnification of [4, 10, 20]) {
      const na = paraxialObjectNumericalAperture(infinityAt("backFocal", NA, magnification), L);
      expect(Number.isFinite(na)).toBe(true);
      expect(na).toBeGreaterThan(0);
    }
  });

  it("and the pupil it reads really is at infinity — the branch is not dead code", () => {
    // The XOR `PupilPlane` states, asserted on both placements rather than
    // assumed: this is what makes the two arms exhaustive instead of one being
    // a fallback for the other.
    const tele = pupils(infinityAt("backFocal"), L).entrance;
    expect(Number.isFinite(tele.radius)).toBe(false);
    expect(tele.slopeRadius).toBeDefined();

    const rim = pupils(infinityAt("rim"), L).entrance;
    expect(Number.isFinite(rim.radius)).toBe(true);
    expect(rim.slopeRadius).toBeUndefined();
  });
});

describe("§ 6ah.2 — THE FINDING: the two constructions are one quantity, to the bit", () => {
  it("the telecentric slope IS the rim lens's semi-diameter over its arm — bitwise", () => {
    // Not "close": the same double. Both lenses are spelled by the same NA and
    // the aperture is the only thing that decides this number, so a limit taken
    // correctly has to reproduce it exactly. `toBe` rather than `toBeCloseTo`
    // is the assertion the finding deserves.
    const tele = paraxialObjectNumericalAperture(infinityAt("backFocal"), L);
    const rim = paraxialObjectNumericalAperture(infinityAt("rim"), L);
    expect(tele).toBe(rim);
    expect(tele).toBe(tanOf(NA));
  });

  it("and it is tan u over three octaves of aperture, where the sine reading is not", () => {
    for (const na of [0.05, 0.1, 0.2, 0.25]) {
      const system = infinityAt("backFocal", na);
      const paraxial = paraxialObjectNumericalAperture(system, L);
      // The closed form to within an ulp — the two differ only in the order the
      // same operations are performed in.
      expect(Math.abs(paraxial / tanOf(na) - 1)).toBeLessThan(3e-16);
      // …and the tangent-vs-sine gap § 6q.5 is about is still there and still
      // grows: 0.13% at NA 0.05, 3.3% at NA 0.25. The repaired branch reports a
      // DIFFERENT number from `objectNumericalAperture`, which is the point.
      const sine = objectNumericalAperture(system, L);
      expect(paraxial / sine - 1).toBeCloseTo(1 / Math.sqrt(1 - na * na) - 1, 6);
    }
  });

  it("the DIN carries it too, once its own stop is asked for (§ 6ae)", () => {
    // Three ulp rather than zero: the finite conjugate reaches the same slope
    // through a different arithmetic path (a solved object distance), so the
    // agreement is a computation's, not an expression's.
    const tele = paraxialObjectNumericalAperture(dinAt("backFocal"), L);
    const rim = paraxialObjectNumericalAperture(dinAt("rim"), L);
    expect(Math.abs(tele / rim - 1)).toBeLessThan(1e-15);
    expect(tele).toBeCloseTo(tanOf(NA), 12);
  });
});

describe("§ 6ah.3 — the index that multiplies the slope is the SPECIMEN's, not air's", () => {
  it("a specimen inside the cover glass reads a different closed form, and lands on it", () => {
    // NA = n·sin u, so a specimen in glass of index n subtends a SMALLER angle
    // for the same engraved NA, and n·tan u = NA/√(1 − (NA/n)²) rather than
    // NA/√(1 − NA²). The two differ by 0.29% at NA 0.10 — small, and a sign
    // error away from being invisible, which is why it is pinned on the branch
    // that has no arm to carry the index for it.
    const n = getMedium("D263").n(L);
    for (const placement of ["backFocal", "rim"] as const) {
      const na = paraxialObjectNumericalAperture(
        dinAt(placement, { coverslip: { thicknessMm: 0.17 } }),
        L,
      );
      expect(na).toBeCloseTo(tanOf(NA, n), 12);
    }
    // The slip's own effect, stated rather than left in the digits.
    expect(tanOf(NA, n) / tanOf(NA) - 1).toBeCloseTo(-0.00286, 5);
  });
});

describe("§ 6ah.4 — what the readout is FOR: § 6q.5's Lagrange law, on a telecentric instrument", () => {
  const visualAt = (stopPlacement: StopPlacement) =>
    visualMicroscope({
      microscope: infinityCorrectedMicroscope({
        objective: microscopeObjective({
          magnification: 4,
          numericalAperture: NA,
          stopPlacement,
        }),
        tubeLens: tubeLens(),
      }),
      eyepiece: plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 20 }).prescription,
      wavelengthNm: L,
      nearPointMm: 250,
    });

  it("r_xp = D·NA_paraxial/|M| holds telecentric at the order it holds rim-stopped", () => {
    const residual = (stopPlacement: StopPlacement): number => {
      const visual = visualAt(stopPlacement);
      const M = visualMagnification(visual.system, 0.05, L, 250);
      const paraxial = paraxialObjectNumericalAperture(visual.system, L);
      return lagrangeExitPupilRadiusMm(paraxial, 250, M) / pupils(visual.system, L).exit.radius - 1;
    };
    // Both miss by the distortion a REAL chief ray carries and a paraxial law
    // does not — 6.5e-5 telecentric against 5.7e-5 rim, the same order, which is
    // the statement. A branch that had merely been made finite could sit
    // anywhere; this one lands where the law does.
    expect(Math.abs(residual("backFocal"))).toBeLessThan(1e-4);
    expect(Math.abs(residual("backFocal")) / Math.abs(residual("rim"))).toBeCloseTo(1.15, 1);
  });

  it("CONTROL: the engraved sine NA misses the same pupil, telecentric as well", () => {
    // § 6q.5's finding is that the textbook D·NA/|M| takes the WRONG NA. That
    // has to survive the repair, or the fix has quietly made the two spellings
    // the same number: 0.50% at NA 0.10, and it is the tangent-vs-sine gap.
    const visual = visualAt("backFocal");
    const M = visualMagnification(visual.system, 0.05, L, 250);
    const engraved = lagrangeExitPupilRadiusMm(objectNumericalAperture(visual.system, L), 250, M);
    expect(engraved / pupils(visual.system, L).exit.radius - 1).toBeCloseTo(-0.005, 3);
  });
});
