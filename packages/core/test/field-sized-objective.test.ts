import { describe, it, expect } from "vitest";
import {
  DEFAULT_TUBE_FOCAL_LENGTH_MM,
  MicroscopeObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { pupils } from "../src/pupil/pupils";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { exitBundle } from "../src/analysis/spot";
import { traceRay } from "../src/trace/sequential";
import { objectNumericalAperture, lateralMagnification } from "../src/pupil/microscope";
import { OpticalSystem } from "../src/trace/system";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Step 6w — the objective knows what field it must pass.
 *
 * § 6v moved the stop to the back focal plane and measured the price it did not
 * go looking for: a telecentric bundle's footprint TRANSLATES with object height
 * where a rim-stopped one pivots through one hole, so it walks off an element
 * sized for the axial beam. That step named the fix rather than doing it
 * quietly, on the grounds that "the field an objective must pass is not
 * something the objective's own spec currently states". This is that parameter,
 * and — as at § 6v — **no physics is added**: the glass is `f·NA + h` instead of
 * `f·NA`, and everything below is a consequence of the h.
 *
 * ## Why the default stays OFF, which is the opposite of what § 6v did
 *
 * § 6v could default telecentricity on because a stop position is intrinsic to
 * an objective. A field is not: it is a property of the objective TOGETHER with
 * whatever stops the field behind it — an eyepiece's field stop, a sensor's
 * diagonal — so no physics picks a value, and ROADMAP's own phrasing is "a new
 * spec parameter … not a constant". An objective built without one is therefore
 * still the § 6v lens, and that is what makes every rung here a comparison
 * against a shipped control rather than against a hypothetical.
 *
 * The § 6v rungs deliberately pass no field number, and should keep passing
 * none: they are now this step's negative control.
 *
 * ## What the step turned out to be about
 *
 * Not the sizing — that is one line — but the fact that **every number in it is
 * magnification-independent**. § 6v.5's figures were quoted in millimetres of
 * field and therefore did not travel: 11% of the pupil at 1 mm on the 4×, past
 * total occlusion at 40×. Asked in the currency an objective is actually
 * catalogued in — a field NUMBER, the field diameter at the intermediate image —
 * the M cancels out of all of it, because the object-space semi-field
 * `FN/(2·M)` and the beam `f·NA = (f_tube/M)·NA` are both ∝ 1/M. The 4× and the
 * 40× need the same proportional element, lose the same fraction of pupil
 * without it, cost the same fraction of working distance with it, and wall out
 * at the same aperture. They are one lens, scaled.
 */

const L = LINE_D;
const NA = 0.1;
/** The app's stage runs at 18 mm (`FIELD_NUMBER_MM`); § 6q's panel offers 20. */
const FN = 18;
const F_TUBE = DEFAULT_TUBE_FOCAL_LENGTH_MM;

/**
 * A wide tube lens, so that what clips a bundle is the OBJECTIVE and the claim
 * stays about the objective. The shipped 25 mm one is checked separately in
 * § 6w.3 — it passes FN 18 at every magnification, so this is isolation and not
 * a thumb on the scale.
 */
const WIDE_TUBE_MM = 60;

const objectiveAt = (fieldNumberMm: number | undefined, magnification = 4, na = NA) =>
  microscopeObjective({
    magnification,
    numericalAperture: na,
    ...(fieldNumberMm === undefined ? {} : { fieldNumberMm }),
  });

const scopeAt = (
  fieldNumberMm: number | undefined,
  magnification = 4,
  na = NA,
  tubeApertureMm = WIDE_TUBE_MM,
) => {
  const objective = objectiveAt(fieldNumberMm, magnification, na);
  return {
    objective,
    ...infinityCorrectedMicroscope({
      objective,
      tubeLens: tubeLens({ apertureMm: tubeApertureMm }),
    }),
  };
};

/** Fraction of an aimed pupil grid that survives to the image, at object height h. */
const throughput = (s: { system: OpticalSystem }, h: number, n = 21): number => {
  const b = exitBundle(s.system, h, L, pupilGrid(n));
  return b.rays.length / (b.rays.length + b.lost);
};

/** The object-space semi-field a field number implies. */
const semiField = (fieldNumberMm: number, magnification: number) =>
  fieldNumberMm / (2 * magnification);

const MAGNIFICATIONS = [4, 10, 40];

describe("§ 6w.1 — the glass is the beam plus the walk, and the oversize is a RATIO", () => {
  it("sizes the element to f·NA + h, h being the object-space semi-field", () => {
    for (const M of MAGNIFICATIONS) {
      const o = objectiveAt(FN, M);
      const h = semiField(FN, M);
      expect(o.objectFieldRadiusMm).toBe(h);
      expect(o.pupilRadiusMm).toBeCloseTo((F_TUBE / M) * NA, 12);
      expect(o.glassRadiusMm).toBeCloseTo(o.pupilRadiusMm + h, 12);
      // The axial lens is the same constructor with the walk taken out, which is
      // what makes the pair below a controlled comparison.
      const axial = objectiveAt(undefined, M);
      expect(axial.glassRadiusMm).toBe(axial.pupilRadiusMm);
      expect(axial.objectFieldRadiusMm).toBe(0);
      expect(axial.fieldNumberMm).toBeUndefined();
    }
  });

  it("has NO MAGNIFICATION in it as a ratio — 1 + FN/(2·f_tube·NA), the same for every lens", () => {
    // The step's headline, and the sentence of § 6v.5's it corrects. Both terms
    // of `f·NA + h` are ∝ 1/M — the beam because f = f_tube/M, the walk because
    // h = FN/(2M) — so the M cancels out of the fraction entirely. A 4× and a
    // 40× asked to pass the same FIELD NUMBER need the same proportional glass,
    // and only their absolute sizes differ, which is exactly what made § 6v.5's
    // millimetres look like a verdict about the 40× when they were a verdict
    // about the units.
    const predicted = 1 + FN / (2 * F_TUBE * NA); // 1.45 at FN 18, NA 0.10
    expect(predicted).toBeCloseTo(1.45, 15);
    for (const M of MAGNIFICATIONS) {
      const o = objectiveAt(FN, M);
      expect(o.glassRadiusMm / o.pupilRadiusMm).toBeCloseTo(predicted, 12);
    }
    // …and it moves with NA and with the field number, in opposite directions:
    // a faster objective already has the glass, a wider field asks for more.
    for (const na of [0.05, 0.1, 0.2]) {
      for (const fn of [10, 18, 25]) {
        const o = objectiveAt(fn, 10, na);
        expect(o.glassRadiusMm / o.pupilRadiusMm).toBeCloseTo(1 + fn / (2 * F_TUBE * na), 12);
      }
    }
  });
});

describe("§ 6w.2 — the family is ONE LENS, scaled: every length goes as 1/M", () => {
  it("reproduces the 4× exactly at 40×, ten times smaller", () => {
    // Not a restatement of § 6w.1: that was one ratio inside one lens, this is
    // every dimension of two lenses. It is what licenses quoting a single set of
    // figures for the whole catalogue below, and it is why the panning surfaces
    // (§§ 6o, 6t) — which run at the high magnifications — are fixed by the same
    // field number as the low ones rather than needing one each.
    const low = objectiveAt(FN, 4);
    const high = objectiveAt(FN, 40);
    const ratio = (a: number, b: number) => a / b;
    expect(ratio(low.focalLengthMm, high.focalLengthMm)).toBeCloseTo(10, 12);
    expect(ratio(low.glassRadiusMm, high.glassRadiusMm)).toBeCloseTo(10, 12);
    expect(ratio(low.pupilRadiusMm, high.pupilRadiusMm)).toBeCloseTo(10, 12);
    expect(ratio(low.stopRadiusMm, high.stopRadiusMm)).toBeCloseTo(10, 9);
    expect(ratio(low.objectDistanceMm, high.objectDistanceMm)).toBeCloseTo(10, 9);
    expect(ratio(low.stopDistanceMm, high.stopDistanceMm)).toBeCloseTo(10, 9);
    // Curvatures are the reciprocal of a length, so they scale the other way —
    // and a bending is a SHAPE, so the two lenses have the same one. This is the
    // third-order solve's own scale-freedom (S_I ∝ h⁴) showing up as a property
    // of the catalogue rather than of one design.
    for (let i = 0; i < 3; i++) {
      const cLow = low.prescription.surfaces[i]!.curvature;
      const cHigh = high.prescription.surfaces[i]!.curvature;
      expect(cHigh / cLow).toBeCloseTo(10, 9);
    }
  });
});

describe("§ 6w.3 — it passes the field it was sized for, where the § 6v objective does not", () => {
  it("delivers the WHOLE pupil at the field edge, at every magnification", () => {
    // The point of the step, against the shipped control. The axially-sized
    // objective loses 84 of 313 lattice points at its own field edge — 26.8% of
    // the pupil — and it loses exactly the same 84 at 4×, 10× and 40×, which is
    // § 6w.2 arriving in a discrete count: the same lens, so the same rays.
    for (const M of MAGNIFICATIONS) {
      const h = semiField(FN, M);
      const sized = exitBundle(scopeAt(FN, M).system, h, L, pupilGrid(21));
      const axial = exitBundle(scopeAt(undefined, M).system, h, L, pupilGrid(21));
      expect(sized.lost).toBe(0);
      expect(sized.rays.length).toBe(313);
      expect(axial.rays.length).toBe(229);
      expect(axial.lost).toBe(84);
    }
  });

  it("reproduces § 6v.5's own numbers as the control, in millimetres", () => {
    // The bridge to the step this one pays for: the same axially-sized 4×/0.10,
    // read at the absolute field § 6v.5 quotes rather than at a field number.
    const axial = scopeAt(undefined, 4);
    expect(throughput(axial, 1)).toBeCloseTo(0.888, 3); // § 6v.5's "11% at 1 mm"
    const sized = scopeAt(FN, 4);
    expect(throughput(sized, 1)).toBe(1);
    // …and it is not magic past what it was sized for: 3 mm is well outside an
    // FN 18 objective's 2.25 mm semi-field and it vignettes there too, gently.
    expect(throughput(sized, 3)).toBeLessThan(1);
    expect(throughput(sized, 3)).toBeGreaterThan(0.9);
  });

  it("is the OBJECTIVE's claim: the shipped 25 mm tube lens passes FN 18 as well", () => {
    // The isolation above uses a 60 mm tube lens so that nothing behind the
    // objective can be what clips. That would be a thumb on the scale if the
    // real one could not carry the field, so it is checked rather than assumed —
    // the chief angle in the infinity space is FN/(2·f_tube), which has no
    // magnification in it either, so one check covers the catalogue.
    for (const M of MAGNIFICATIONS) {
      expect(throughput(scopeAt(FN, M, NA, 25), semiField(FN, M))).toBe(1);
    }
  });
});

describe("§ 6w.4 — the closed form is an UPPER BOUND, and the last glass face is what binds", () => {
  it("never reaches f·NA + h anywhere on the glass, and the residual has a sign", () => {
    // `f·NA + h` is two paraxial statements added: the sine condition puts the
    // emergent marginal ray at f·sin u, and telecentricity puts the chief ray at
    // exactly h. Neither is a height at a VERTEX — the first is a height on the
    // equivalent refracting sphere, the same distinction § 6a records for the
    // stop radius — so the traced footprint lands INSIDE the size it asks for,
    // at every surface, by about 1%. Reported with its sign rather than as a
    // tolerance: the sizing is conservative, which is the safe direction, and the
    // margin is a real 1.1% of glass a tighter derivation could reclaim.
    for (const M of [4, 40]) {
      const h = semiField(FN, M);
      const s = scopeAt(FN, M);
      const pupil = pupils(s.system, L);
      const perSurface = [0, 0, 0];
      for (const p of pupilGrid(31)) {
        const res = traceRay(s.system.prescription, aimRay(s.system, pupil, h, p, L));
        for (let i = 0; i < 3; i++) {
          const hit = res.path[i];
          if (hit !== undefined) perSurface[i] = Math.max(perSurface[i]!, Math.hypot(hit.x, hit.y));
        }
      }
      const bound = s.objective.glassRadiusMm;
      // Monotone across the three glass faces: the beam is still climbing toward
      // its emergent height as it crosses the doublet.
      expect(perSurface[0]!).toBeLessThan(perSurface[1]!);
      expect(perSurface[1]!).toBeLessThan(perSurface[2]!);
      const worst = perSurface[2]!;
      expect(worst).toBeLessThan(bound);
      expect(worst / bound).toBeCloseTo(0.98922, 4);
      expect(perSurface.every((r) => r > 0)).toBe(true);
    }
  });

  it("delivers 5.3% MORE field than asked, and the surface that stops it is the last one", () => {
    // Bisected rather than asserted, and the number is not arbitrary: the extra
    // is the 1.1% above (glass the bundle never reaches) plus
    // `cementedDoubletForm`'s own 0.5% rim margin on the binding face, divided by
    // the ~0.965 mm of footprint each mm of field walks. The binding face is the
    // CROWN's outer one — surface 2 of the mirrored chain — because it carries
    // the 0.5% margin where the two specimen-side faces carry 2%.
    for (const M of [4, 40]) {
      const s = scopeAt(FN, M);
      const h = semiField(FN, M);
      let lo = 0;
      let hi = (20 * 4) / M;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (throughput(s, mid, 31) === 1) lo = mid;
        else hi = mid;
      }
      expect(lo).toBeGreaterThan(h);
      expect(lo / h).toBeCloseTo(1.052698, 6);

      const pupil = pupils(s.system, L);
      const stoppedAt = new Set<number>();
      for (const p of pupilGrid(31)) {
        const res = traceRay(s.system.prescription, aimRay(s.system, pupil, hi, p, L));
        if (res.status !== "ok") stoppedAt.add(res.failedAt ?? -1);
      }
      expect([...stoppedAt]).toEqual([2]);
      expect(s.prescription.surfaces[2]!.semiAperture).toBeCloseTo(
        1.005 * s.objective.glassRadiusMm,
        12,
      );
    }
  });
});

describe("§ 6w.5 — what it costs, and the delivered NA is not what pays", () => {
  it("keeps the engraving to 14 digits while the lens underneath it changes", () => {
    // The aperture survives because it is re-derived on the lens actually built:
    // `f·tan u` at the back focal plane, § 6v.1's slope aperture, with the f read
    // off THIS group. So the stop radius moves (below) and the NA does not.
    for (const M of MAGNIFICATIONS) {
      expect(objectNumericalAperture(scopeAt(FN, M).system, L)).toBeCloseTo(NA, 14);
      expect(objectNumericalAperture(scopeAt(undefined, M).system, L)).toBeCloseTo(NA, 14);
    }
  });

  it("pays in WORKING DISTANCE — 2.1% of it, and the same 2.1% at every magnification", () => {
    // Building the doublet at the wider aperture rather than widening its rim is
    // what makes this cost exist, and it is why that route was taken:
    // `achromaticObjective` defaults thicknesses off D and checks edge thickness
    // at D/2, so a rim widened afterwards would have passed a check for an
    // element that cannot be made. Thicker glass moves the principal planes, and
    // the specimen sits on the front focus, so the specimen comes closer.
    for (const M of MAGNIFICATIONS) {
      const axial = objectiveAt(undefined, M);
      const sized = objectiveAt(FN, M);
      expect(sized.objectDistanceMm / axial.objectDistanceMm - 1).toBeCloseTo(-0.02115, 5);
      // The flint's default centre thickness is 0.06·D and therefore scales with
      // the glass EXACTLY; the crown's is finalised from the sags, which grow
      // faster than the aperture, so it more than doubles.
      const t = (o: MicroscopeObjective, i: number) => o.prescription.surfaces[i]!.thickness;
      expect(t(sized, 0) / t(axial, 0)).toBeCloseTo(1.45, 12);
      expect(t(sized, 1) / t(axial, 1)).toBeCloseTo(2.031, 3);
      expect(t(sized, 1) / t(axial, 1)).toBeGreaterThan(t(sized, 0) / t(axial, 0));
    }
  });

  it("moves the traced magnification by 0.08% — TOWARD the label, not away from it", () => {
    // A thicker doublet's Gullstrand term is smaller, so its traced EFL sits
    // closer to the design focal length (49.9694 → 49.9871 on the 4×) and the
    // magnification it delivers moves closer to the nominal f_tube/f_obj. That is
    // a real change to a shipped number and is recorded rather than buried; it is
    // not an improvement the step was aiming for, and nothing downstream reads
    // the traced magnification as a specification.
    const shifts = MAGNIFICATIONS.map((M) => {
      const h = semiField(FN, M);
      const mAxial = lateralMagnification(scopeAt(undefined, M).system, h, L);
      const mSized = lateralMagnification(scopeAt(FN, M).system, h, L);
      expect(Math.abs(mSized)).toBeGreaterThan(M);
      expect(Math.abs(mSized) - M).toBeLessThan(Math.abs(mAxial) - M);
      return mSized / mAxial - 1;
    });
    for (const shift of shifts) expect(shift).toBeCloseTo(-8.04e-4, 5);

    // AND THIS IS THE ONE NUMBER IN THE STEP THAT CARRIES A MAGNIFICATION, which
    // is worth more than the number itself: −8.0516e-4 at 4× against −8.0368e-4
    // at 40×, a spread of 0.18% over a 10× range. § 6w.2's scale invariance is a
    // property of the OBJECTIVE family — the microscope is not scale-free,
    // because every member is composed against the same 200 mm tube lens, which
    // does not shrink with the objective. Everything else here is measured inside
    // the objective and is therefore exactly invariant; a magnification is a
    // property of the pair.
    expect(shifts[0]! / shifts[2]! - 1).toBeCloseTo(1.85e-3, 4);
  });
});

describe("§ 6w.6 — the wall: a field number is a second door onto the doublet's own ceiling", () => {
  const builds = (na: number, fn: number | undefined, M = 10): boolean => {
    try {
      objectiveAt(fn, M, na);
      return true;
    } catch {
      return false;
    }
  };
  const ceiling = (fn: number | undefined, M = 10): number => {
    let lo = 0.01;
    let hi = 0.6;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (builds(mid, fn, M)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  it("costs NA at exactly FN/(2·f_tube), with no magnification in it", () => {
    // The glass is `2(f·NA + h)` against a focal length that does not grow with
    // h, so the element's own focal ratio is
    //
    //     D/f = 2·NA + FN/f_tube
    //
    // — magnification-free, because both terms lose their M the same way. The
    // cemented doublet refuses past a fixed D/f (§ 6b.5.7's geometric wall: a
    // bending reaching a hemisphere), so the aperture ceiling must fall LINEARLY
    // in the field number, at half the reciprocal tube length. Bisected, it does,
    // to nine digits — which is two steps' constants agreeing by a route neither
    // was derived through.
    const axial = ceiling(undefined);
    expect(axial).toBeCloseTo(0.287401975, 9);
    // § 6b.5.7 pins the same wall as a focal ratio, F* = 1.7397236 at infinite
    // conjugate, and 1/(2·F*) is what an axially-sized objective's NA ceiling is.
    expect(axial).toBeCloseTo(1 / (2 * 1.7397236), 7);
    for (const fn of [18, 25]) {
      expect(axial - ceiling(fn)).toBeCloseTo(fn / (2 * F_TUBE), 9);
    }
    for (const M of [4, 40]) {
      expect(ceiling(18, M)).toBeCloseTo(ceiling(18, 10), 12);
    }
  });

  it("names the field number in the refusal, not only the aperture", () => {
    // § 6b.5.5's rule: a refusal should say which input to back off. NA 0.25
    // builds axially and refuses at FN 18, so the aperture alone cannot be the
    // whole message — the same NA is buildable with a narrower field.
    expect(builds(0.25, undefined)).toBe(true);
    expect(builds(0.25, FN)).toBe(false);
    expect(() => objectiveAt(FN, 10, 0.25)).toThrow(/field number 18 mm at NA 0.25/);
    expect(() => objectiveAt(FN, 10, 0.25)).toThrow(/axial beam plus/);
    // And a refusal that has nothing to do with the field is passed straight
    // through, unwrapped: NA 0.3 does not build at any field number.
    expect(builds(0.3, undefined)).toBe(false);
    expect(() => objectiveAt(undefined, 10, 0.3)).toThrow(/achromaticObjective/);
  });
});

describe("§ 6w.7 — refused where it would mean nothing", () => {
  it("will not size a RIM-stopped objective for a field", () => {
    // A rim stop pivots every bundle through surface 0, so its footprint does not
    // translate and there is no walk to size for — what § 6v.5's control loses off
    // axis is the tube lens catching the image height, which no amount of
    // objective glass fixes. Refused rather than ignored, and refused rather than
    // accepted-and-wasted, because the rim objective's whole job is to be the
    // negative control: its surface 0 has to stay the rim it is named for.
    expect(() =>
      microscopeObjective({
        magnification: 4,
        numericalAperture: NA,
        stopPlacement: "rim",
        fieldNumberMm: FN,
      }),
    ).toThrow(/rim/);
    // The control itself still builds, untouched by this step.
    expect(() =>
      microscopeObjective({ magnification: 4, numericalAperture: NA, stopPlacement: "rim" }),
    ).not.toThrow();
  });

  it("refuses a field number that is not a length", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => objectiveAt(bad)).toThrow(/positive length/);
    }
  });
});
