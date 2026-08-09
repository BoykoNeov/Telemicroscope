import { describe, it, expect } from "vitest";
import {
  BARREL_DIAMETER_MM,
  FLANGE_FOCAL_DISTANCE_MM,
  PARFOCAL_DISTANCE_MM,
  THREADS,
  backFocusBudget,
  cameraBody,
  filter,
  focusReach,
  glassFocusShiftMm,
  mechanicalLengthMm,
  mirrorDiagonal,
  parfocalBarrelLengthMm,
  prismDiagonal,
  spacer,
  withGlassPath,
} from "../src/mech";
import { achromaticObjective } from "../src/designs/achromat";
import { finiteConjugateObjective } from "../src/designs/microscope";
import { plateFocusShiftMm, plateW040Mm, plateWavefrontErrorMm } from "../src/designs/coverslip";
import { getMedium } from "../src/materials/catalog";
import { LINE_C, LINE_D, LINE_F } from "../src/materials/dispersion";
import { OpticalSystem, simpleSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { bestFocus } from "../src/analysis/focus";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";

/**
 * Rungs for the mechanical layer — docs/VALIDATION.md § 5u.
 *
 * The layer is mostly a parts list, and a parts list is not physics. What makes
 * it a ladder step is the one claim it exists to get right: **a part's
 * mechanical length and its optical cost are different numbers**, and the
 * difference is exactly the glass inside it.
 *
 * So the discipline here is inverted from the rest of the ladder. The
 * *standards* (31.75 mm, 55 mm, 45 mm) are transcribed data and are deliberately
 * NOT rungs — asserting a constant equals itself is a spelling check. What is
 * pinned is what the engine computes when the mech layer hands it glass: the
 * focus moves by t(1−1/n) **because the tracer refracts through a plate**, never
 * because this layer applied a formula to an image.
 */

const LAMBDA = LINE_D;
const N_BK7_D = getMedium("N-BK7").n(LAMBDA);

/**
 * A 2″ prism star diagonal, representative rather than transcribed: ~110 mm of
 * light path with ~40 mm of it prism glass. Both figures are in the ballpark of
 * commercial parts and neither is a datasheet value — every assertion below is
 * against what the engine does with them, not against the numbers themselves.
 */
const PRISM_PATH_MM = 110;
const PRISM_GLASS_MM = 40;
const prism = prismDiagonal({
  pathLengthMm: PRISM_PATH_MM,
  prismThicknessMm: PRISM_GLASS_MM,
});
const mirror = mirrorDiagonal({ pathLengthMm: PRISM_PATH_MM });

/** An f/10 achromat with a long back focus — room to put a diagonal inside. */
function refractor(focalRatio: number): {
  prescription: Prescription;
  system: (p: Prescription) => OpticalSystem;
  apertureMm: number;
} {
  const apertureMm = 100;
  const obj = achromaticObjective({ apertureMm, focalRatio });
  return {
    prescription: obj.prescription,
    apertureMm,
    system: (p: Prescription) => simpleSystem(p, { kind: "EPD", value: apertureMm }, LAMBDA),
  };
}

/** Paraxial image-plane z of a prescription, absolute in the unfolded frame. */
function paraxialFocusZ(sysFor: (p: Prescription) => OpticalSystem, p: Prescription): number {
  return bestFocus(sysFor(p), "paraxial").z;
}

describe("§ 5u.1 — the glass path is not its own length", () => {
  it("a spliced chain moves the focus by exactly t(1−1/n), traced", () => {
    const { prescription, system } = refractor(10);
    const before = paraxialFocusZ(system, prescription);
    const after = paraxialFocusZ(system, withGlassPath(prescription, [prism], { gapMm: 200 }));

    const closedForm = plateFocusShiftMm(PRISM_GLASS_MM, N_BK7_D);
    expect(after - before).toBeCloseTo(closedForm, 9);

    // And the mech layer's own budget says the same thing without tracing.
    expect(glassFocusShiftMm([prism], LAMBDA)).toBeCloseTo(closedForm, 12);
  });

  it("the shift is a third of the glass, and a mirror diagonal hands back none", () => {
    // 1 − 1/n for N-BK7 at the d line. The "a prism diagonal buys you back about
    // a third of its glass" folk result, with the engine's own index in it.
    expect(glassFocusShiftMm([prism], LAMBDA) / PRISM_GLASS_MM).toBeCloseTo(1 - 1 / N_BK7_D, 12);
    expect(glassFocusShiftMm([prism], LAMBDA)).toBeCloseTo(13.6287, 4);
    expect(glassFocusShiftMm([mirror], LAMBDA)).toBe(0);
  });

  it("is linear in thickness and additive across layers", () => {
    const thin = filter({ thicknessMm: 3 });
    const thick = filter({ thicknessMm: 9 });
    expect(glassFocusShiftMm([thick], LAMBDA)).toBeCloseTo(
      3 * glassFocusShiftMm([thin], LAMBDA),
      12,
    );
    // Two different glasses in one train: the stack is a sum, term by term.
    const silica = filter({ thicknessMm: 5, medium: "FUSED-SILICA", name: "silica window" });
    expect(glassFocusShiftMm([thin, silica], LAMBDA)).toBeCloseTo(
      glassFocusShiftMm([thin], LAMBDA) + glassFocusShiftMm([silica], LAMBDA),
      12,
    );
  });
});

describe("§ 5u.2 — where the glass sits in the converging beam does not matter", () => {
  it("the same glass at two gaps gives the same focus and the same wavefront", () => {
    const { prescription, system, apertureMm } = refractor(10);
    const near = withGlassPath(prescription, [prism], { gapMm: 50 });
    const far = withGlassPath(prescription, [prism], { gapMm: 600 });

    // Focus: identical, not merely close. A perpendicular plane slid along a
    // cone of straight lines meets every ray at the same angle.
    expect(paraxialFocusZ(system, far) - paraxialFocusZ(system, near)).toBeCloseTo(0, 11);

    // Wavefront: the OPD map at the exit pupil, point for point.
    const grid = pupilGrid(9);
    const opdNear = opdMap(system(near), 0, LAMBDA, grid);
    const opdFar = opdMap(system(far), 0, LAMBDA, grid);
    expect(opdNear.samples.length).toBe(49); // a 9×9 grid clipped to the disc
    expect(opdFar.samples.length).toBe(opdNear.samples.length);
    expect(opdFar.lost).toBe(opdNear.lost);
    let worst = 0;
    for (let i = 0; i < opdNear.samples.length; i++) {
      const a = opdNear.samples[i]!;
      const b = opdFar.samples[i]!;
      expect(b.px).toBeCloseTo(a.px, 12);
      worst = Math.max(worst, Math.abs(a.waves - b.waves));
    }
    // Waves, over a 100 mm aperture. Anything a display could show is orders
    // above this — the plate does not know where along the cone it was put.
    expect(worst).toBeLessThan(1e-6);
    expect(opdFar.rmsWaves).toBeCloseTo(opdNear.rmsWaves, 9);
    expect(apertureMm).toBe(100);
  });
});

describe("§ 5u.3 — the budget, and where the naive sum lands", () => {
  it("a budget that counts glass as air over-reports the cost by Σt(1−1/n)", () => {
    const chain = [prism, spacer(20, "extension"), cameraBody({ flangeFocalDistanceMm: FLANGE_FOCAL_DISTANCE_MM.canonEf })];
    const b = backFocusBudget(chain, LAMBDA);

    expect(b.mechanicalLengthMm).toBeCloseTo(PRISM_PATH_MM + 20 + 44, 12);
    expect(b.glassThicknessMm).toBe(PRISM_GLASS_MM);
    expect(b.naiveConsumedMm - b.consumedMm).toBeCloseTo(b.focusShiftMm, 12);
    expect(b.focusShiftMm).toBeCloseTo(plateFocusShiftMm(PRISM_GLASS_MM, N_BK7_D), 12);

    // The naive sum is wrong by 7.8% of the chain's length here — not a rounding
    // error, and always in the direction that says a train will not reach.
    expect(b.focusShiftMm / b.mechanicalLengthMm).toBeCloseTo(0.0783, 4);
  });

  it("the honest budget matches the traced focus of the same chain", () => {
    const { prescription, system } = refractor(10);
    const chain = [prism, filter({ thicknessMm: 3, name: "UV/IR cut" })];
    const before = paraxialFocusZ(system, prescription);
    const after = paraxialFocusZ(system, withGlassPath(prescription, chain, { gapMm: 100 }));
    expect(after - before).toBeCloseTo(backFocusBudget(chain, LAMBDA).focusShiftMm, 9);
  });
});

describe("§ 5u.4 — reach: rules over data", () => {
  // A focuser with almost no in-travel, which is the ordinary case: a drawtube
  // racked fully in is against its own stop, and the back focus is what it is.
  const focuser = { backFocusMm: 150, inwardTravelMm: 2, outwardTravelMm: 30 };

  it("the prism reaches where the mirror does not, and the glass is the whole difference", () => {
    const camera = cameraBody({ flangeFocalDistanceMm: FLANGE_FOCAL_DISTANCE_MM.canonEf });
    const withPrism = focusReach(focuser, [prism, camera], LAMBDA);
    const withMirror = focusReach(focuser, [mirror, camera], LAMBDA);

    // Same length, same camera. Only the glass differs.
    expect(mechanicalLengthMm([prism, camera])).toBe(mechanicalLengthMm([mirror, camera]));
    expect(withPrism.requiredTravelMm - withMirror.requiredTravelMm).toBeCloseTo(
      glassFocusShiftMm([prism], LAMBDA),
      12,
    );
    expect(withMirror.reaches).toBe(false);
    expect(withPrism.reaches).toBe(true);
  });

  it("the naive verdict is the pessimistic one, and it is wrong here", () => {
    const camera = cameraBody({ flangeFocalDistanceMm: FLANGE_FOCAL_DISTANCE_MM.canonEf });
    const r = focusReach(focuser, [prism, camera], LAMBDA);
    // The spreadsheet says no; the physics says yes with 9.6 mm to spare.
    expect(r.naiveReaches).toBe(false);
    expect(r.reaches).toBe(true);
    expect(r.naiveRequiredTravelMm).toBeLessThan(r.requiredTravelMm);
  });

  it("a T-threaded train consumes 55 mm whatever body is behind it", () => {
    // Rules over transcribed data, not a rung: the T2 convention IS that every
    // T-ring makes up 55 mm minus its own body's flange distance.
    const ringFor = (flange: number): number => FLANGE_FOCAL_DISTANCE_MM.t2 - flange;
    for (const flange of [
      FLANGE_FOCAL_DISTANCE_MM.canonEf,
      FLANGE_FOCAL_DISTANCE_MM.nikonF,
      FLANGE_FOCAL_DISTANCE_MM.sonyE,
    ]) {
      const chain = [spacer(ringFor(flange), "T-ring"), cameraBody({ flangeFocalDistanceMm: flange })];
      expect(mechanicalLengthMm(chain)).toBeCloseTo(FLANGE_FOCAL_DISTANCE_MM.t2, 12);
    }
    // A mirrorless body needs a thicker ring than an SLR one — the whole reason
    // short-flange bodies are easier to bring to focus on a telescope.
    expect(ringFor(FLANGE_FOCAL_DISTANCE_MM.sonyE)).toBeGreaterThan(
      ringFor(FLANGE_FOCAL_DISTANCE_MM.nikonF),
    );
  });

  it("refuses a part carrying more glass than its light path", () => {
    expect(() => mechanicalLengthMm([{ name: "bad", pathLengthMm: 10, glass: [{ thicknessMm: 20, medium: "N-BK7" }] }])).toThrow(
      /glass in a 10 mm light path/,
    );
  });

  it("refuses glass that does not fit between the last surface and the image", () => {
    const { prescription } = refractor(10);
    expect(() => withGlassPath(prescription, [prism], { gapMm: 5000 })).toThrow(/do not fit/);
  });
});

describe("§ 5u.5 — the chromatic half a mechanical budget cannot see", () => {
  it("the focus shift is itself dispersive: t(1/n_C − 1/n_F), traced", () => {
    const apertureMm = 100;
    const obj = achromaticObjective({ apertureMm, focalRatio: 5 });
    const spliced = withGlassPath(obj.prescription, [prism], { gapMm: 100 });
    const at = (nm: number, p: Prescription): number =>
      bestFocus(simpleSystem(p, { kind: "EPD", value: apertureMm }, nm), "paraxial").z;

    const spreadWithGlass = at(LINE_F, spliced) - at(LINE_C, spliced);
    const spreadBare = at(LINE_F, obj.prescription) - at(LINE_C, obj.prescription);
    const added = spreadWithGlass - spreadBare;

    const nF = getMedium("N-BK7").n(LINE_F);
    const nC = getMedium("N-BK7").n(LINE_C);
    expect(added).toBeCloseTo(PRISM_GLASS_MM * (1 / nC - 1 / nF), 8);

    // The SIGN is the finding, and it belongs to the PLATE: t(1−1/n) grows with
    // n, so a plate pushes blue LONG. A positive element does the reverse — a
    // larger n is a shorter focal length — and that half IS a law.
    expect(added).toBeGreaterThan(0);
  });

  it("which compensates BOTH doublets measured — but that is a residual's sign, not a law", () => {
    // Careful about what this pins. An achromat's F−C spread is a *residual*:
    // F and C are united by design and what is left is the thin-lens split's
    // Gullstrand remainder, whose sign is a property of the lens rather than of
    // lenses. So both glass pairs are measured rather than one being asserted
    // and the other assumed — § 5j and § 5k already show partial dispersions are
    // exactly the delicate quantity here.
    const at = (nm: number, p: Prescription): number =>
      bestFocus(simpleSystem(p, { kind: "EPD", value: 100 }, nm), "paraxial").z;
    const spread = (pair: { crownMedium: string; flintMedium: string }) => {
      const obj = achromaticObjective({ apertureMm: 100, focalRatio: 5, ...pair });
      const spliced = withGlassPath(obj.prescription, [prism], { gapMm: 100 });
      return {
        bare: at(LINE_F, obj.prescription) - at(LINE_C, obj.prescription),
        glassed: at(LINE_F, spliced) - at(LINE_C, spliced),
      };
    };

    const crownFlint = spread({ crownMedium: "N-BK7", flintMedium: "F2" });
    const ed = spread({ crownMedium: "CAF2", flintMedium: "N-BK7" });

    // Both residuals are undercorrected the same way, so the diagonal reduces
    // both. The ED pair's residual is 2.4× the larger of the two, so the same
    // 40 mm of glass buys proportionally less of it back.
    expect(crownFlint.bare).toBeCloseTo(-0.2098, 3);
    expect(ed.bare).toBeCloseTo(-0.5068, 3);
    for (const s of [crownFlint, ed]) {
      expect(Math.abs(s.glassed)).toBeLessThan(Math.abs(s.bare));
      // And the amount it moves each is identical — the plate does not know
      // what it is bolted to.
      expect(s.glassed - s.bare).toBeCloseTo(0.139742, 6);
    }
  });

  it("and at f/5 that colour is several depths of focus, so it is not a rounding term", () => {
    const nF = getMedium("N-BK7").n(LINE_F);
    const nC = getMedium("N-BK7").n(LINE_C);
    const added = PRISM_GLASS_MM * (1 / nC - 1 / nF);
    // Rayleigh depth of focus, 2λ(f/#)² — § 6j's own form, in air.
    const depthOfFocus = (fNumber: number): number => 2 * LAMBDA * 1e-6 * fNumber * fNumber;
    expect(added / depthOfFocus(5)).toBeGreaterThan(4);
    // At f/10 it is inside one. A diagonal's colour is a fast-scope problem.
    expect(added / depthOfFocus(10)).toBeLessThan(1.5);
  });
});

describe("§ 5u.6 — what the glass costs, and the f-ratio where it stops being free", () => {
  const sinTheta = (fNumber: number): number => 1 / (2 * fNumber);

  it("the cost goes as the fourth power of the aperture", () => {
    const w = (f: number): number => plateWavefrontErrorMm(PRISM_GLASS_MM, N_BK7_D, sinTheta(f));
    // Halving the focal ratio doubles sinθ and multiplies the third-order
    // coefficient by 16. The EXACT form is close to it but not equal, and
    // departs the way § 6l's does — upward, and faster the steeper the cone.
    expect(w(10) / w(20)).toBeGreaterThan(16);
    expect(w(10) / w(20)).toBeCloseTo(16.0216, 3);
    // The departure grows as the cone steepens: ×16.02 between f/20 and f/10,
    // ×16.56 between f/4 and f/2.
    expect(w(2) / w(4)).toBeCloseTo(16.563, 2);
    expect(w(2) / w(4)).toBeGreaterThan(w(10) / w(20));
  });

  it("the third-order form under-reports, and by how much is a function of the f-ratio", () => {
    const ratio = (f: number): number =>
      plateWavefrontErrorMm(PRISM_GLASS_MM, N_BK7_D, sinTheta(f)) /
      plateW040Mm(PRISM_GLASS_MM, N_BK7_D, sinTheta(f));
    expect(ratio(20)).toBeCloseTo(1, 3);
    expect(ratio(2)).toBeCloseTo(1.0469, 3);
    // Monotone: it never turns round on the way in.
    expect(ratio(2)).toBeGreaterThan(ratio(4));
    expect(ratio(4)).toBeGreaterThan(ratio(10));
  });

  it("a quarter wave of it lands at f/5.3 for this diagonal", () => {
    const quarterWaveMm = LAMBDA * 1e-6 * 0.25;
    const w = (f: number): number => plateWavefrontErrorMm(PRISM_GLASS_MM, N_BK7_D, sinTheta(f));
    // Bisect the f-ratio at which the plate alone spends Rayleigh's quarter wave.
    let lo = 1.5;
    let hi = 20;
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      if (w(mid) > quarterWaveMm) lo = mid;
      else hi = mid;
    }
    const critical = 0.5 * (lo + hi);
    expect(critical).toBeCloseTo(5.315, 2);
    // Which is the whole practical statement, and it lands harder than the
    // guess this rung was written to check (f/3–f/4): 40 mm of glass spends
    // Rayleigh's quarter wave at **f/5.3**, so an ordinary prism diagonal is
    // free on an f/10 refractor, already AT the limit on a common f/5, and an
    // aberration on anything faster. The margin at f/10 is what makes visual
    // use of a diagonal uncontroversial and imaging use of one not.
    expect(w(10) / quarterWaveMm).toBeCloseTo(0.0794, 3);
    expect(w(5) / quarterWaveMm).toBeGreaterThan(0.9);
  });
});

describe("§ 5u.7 — parfocality, and the magnification a single group cannot reach", () => {
  /** Front vertex → last vertex (mm): the objective's own axial glass length. */
  const glassLengthMm = (p: Prescription): number =>
    p.surfaces.slice(0, -1).reduce((a, s) => a + s.thickness, 0);

  const built = (magnification: number) =>
    finiteConjugateObjective({ magnification, numericalAperture: 0.1 });

  const barrelFor = (magnification: number): number => {
    const obj = built(magnification);
    return parfocalBarrelLengthMm({
      parfocalDistanceMm: PARFOCAL_DISTANCE_MM.din,
      objectDistanceMm: obj.objectDistanceMm,
      glassLengthMm: glassLengthMm(obj.prescription),
    });
  };

  it("the objectives that fit put their specimen at the same distance below the shoulder", () => {
    for (const magnification of [10, 20, 40]) {
      const obj = built(magnification);
      const barrel = barrelFor(magnification);
      expect(barrel).toBeGreaterThan(0);
      expect(barrel + glassLengthMm(obj.prescription) + obj.objectDistanceMm).toBeCloseTo(
        PARFOCAL_DISTANCE_MM.din,
        10,
      );
    }
  });

  it("and the barrel is what absorbs the difference — it is not a constant", () => {
    // A 10× still sits well back from its specimen and needs a short barrel; a
    // 40× is almost against it and needs nearly the whole 45 mm as mount. The
    // standard is met by the barrel, not by the glass.
    expect(barrelFor(10)).toBeLessThan(barrelFor(40));
    expect(barrelFor(40) - barrelFor(10)).toBeGreaterThan(10);
  });

  /**
   * **A single group cannot be a low-power DIN objective, and the floor is a
   * closed form.** A lens working at magnification M against Newton's x′ has
   * focal length f = x′/M and stands off its object by f(1+1/M), so the
   * *shortest* a single group can be from its specimen is x′(M+1)/M² — before
   * any glass, and before any mount. Setting that equal to the parfocal
   * distance P gives P·M² − x′·M − x′ = 0 and
   *
   *     M_min = [x′ + √(x′² + 4·P·x′)] / (2P)
   *
   * which for the DIN pair (x′ = 150, P = 45) is 4.139. Below it the standard
   * is unreachable by construction: the objective's own object distance already
   * exceeds the whole shoulder-to-specimen budget.
   */
  it("a 4× single group cannot be DIN-parfocal at all, and the floor is 4.14×", () => {
    const xPrime = 150;
    const parfocal = PARFOCAL_DISTANCE_MM.din;
    const floor =
      (xPrime + Math.sqrt(xPrime * xPrime + 4 * parfocal * xPrime)) / (2 * parfocal);
    expect(floor).toBeCloseTo(4.1387, 4);

    // The engine agrees, and by more than the closed form demands — the built
    // objective is thick, so its glass eats into a budget the thin-lens floor
    // has already spent.
    expect(() => barrelFor(4)).toThrow(/does not fit the mount/);
    expect(built(4).objectDistanceMm).toBeGreaterThan(parfocal);

    // Where the REAL floor sits, glass included. Bisected on the refusal.
    let lo = 4;
    let hi = 10;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      let fits = true;
      try {
        barrelFor(mid);
      } catch {
        fits = false;
      }
      if (fits) hi = mid;
      else lo = mid;
    }
    const realFloor = 0.5 * (lo + hi);
    expect(realFloor).toBeGreaterThan(floor);
    expect(realFloor).toBeCloseTo(4.236, 2);

    // This is why a real 4× DIN objective is not one doublet. The standard is a
    // MECHANICAL constraint that reaches back into the optical design and says
    // the front group must sit closer than a single group can — which is the
    // sixth geometric ceiling in this repo, and the first that comes from a
    // mount rather than from the ray invariant.
  });

  it("refuses an objective that does not fit its own standard", () => {
    expect(() =>
      parfocalBarrelLengthMm({
        parfocalDistanceMm: PARFOCAL_DISTANCE_MM.din,
        objectDistanceMm: 40,
        glassLengthMm: 20,
      }),
    ).toThrow(/does not fit the mount/);
  });
});

describe("§ 5u — the transcribed table is data, and is checked as data", () => {
  it("the inch barrels are exact conversions", () => {
    expect(BARREL_DIAMETER_MM.small).toBe(31.75);
    expect(BARREL_DIAMETER_MM.large).toBe(50.8);
    expect(THREADS.rms.pitchMm).toBeCloseTo(25.4 / 36, 12);
    expect(THREADS.rms.diameterMm).toBeCloseTo(20.32, 12);
    expect(FLANGE_FOCAL_DISTANCE_MM.cMount).toBeCloseTo(17.526, 12);
  });
});
