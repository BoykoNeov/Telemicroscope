import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { getMedium } from "../src/materials/catalog";
import {
  afocalTelescope,
  collimatingGap,
  collimatingObjectDistance,
  spliceModules,
} from "../src/trace/compose";
import { OpticalSystem } from "../src/trace/system";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  oilImmersionObjective,
  plosslEyepiece,
  tubeLens,
  visualMicroscope,
  MAX_USEFUL_EXIT_PUPIL_MM,
  MIN_USEFUL_EXIT_PUPIL_MM,
  NEAR_POINT_MM,
} from "../src/designs";
import {
  exitVergenceDiopters,
  lagrangeExitPupilRadiusMm,
  microscopeVisualProperties,
  objectNumericalAperture,
  paraxialObjectNumericalAperture,
  pupils,
  usefulMagnificationRange,
  visualDetailRatio,
  visualMagnification,
  visualMicroscopeSystem,
} from "../src/pupil";
import { LINE_C, LINE_D, LINE_F } from "../src/materials/dispersion";

/**
 * Rungs for the eyepiece on the intermediate image (docs/VALIDATION.md § 6q).
 *
 * The capability is one solve. `afocalTelescope` finds its objective↔eyepiece
 * spacing from a ray entering COLLIMATED — an object at infinity — which is what
 * a telescope objective sees and what a microscope eyepiece never does. A
 * microscope eyepiece collimates a real intermediate image formed a finite
 * distance in front of it, so the ray that has to leave flat starts at the
 * SPECIMEN, and the separation that flattens it is a different number. § 6q.3
 * measures how different, in the currency that decides whether it matters: the
 * diopters of accommodation the observer would have to supply.
 *
 * Everything else here is a closed form the composed trace can refuse:
 *
 *  - the gap → the intermediate image distance plus the eyepiece's own front
 *    focal distance (a check; the gap itself is solved on the trace);
 *  - visual magnification → M_obj·(D/f_e), from the REAL chief ray's exit angle,
 *    against a near point D that is a stated convention and not a law;
 *  - the exit pupil → D·NA/|M|, the Lagrange invariant, which is the textbook
 *    "500·NA/M mm" with the 500 shown to be 2·250 — and § 6q.5 is which NA that
 *    law actually takes;
 *  - empty magnification → not the 500·NA–1000·NA rule but the reason for it:
 *    above the two-stop crossover the ratio of what the objective delivers to
 *    what the eye can carry does not move with M at all;
 *  - the field number → a REAL annular stop at the intermediate image, so a
 *    field beyond it vignettes in the trace rather than being printed about.
 */

const L = LINE_D;

/** A 25 mm Plössl wide enough for a field number of 20. See § 6q.9. */
const eyepiece25 = plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 22 });
/** The eyepieces the magnification sweeps run on, sized inside the form's wall. */
const eyepieceOf = (fe: number): Prescription =>
  plosslEyepiece({ focalLengthMm: fe, clearApertureMm: 0.86 * fe }).prescription;

const dinMicroscope = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
});
const infinityMicroscope = infinityCorrectedMicroscope({
  objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1 }),
  tubeLens: tubeLens(),
});
const oilMicroscope = infinityCorrectedMicroscope({
  objective: oilImmersionObjective({
    magnification: 100,
    numericalAperture: 1.4,
    tubeFocalLengthMm: 200,
  }),
  tubeLens: tubeLens({ focalLengthMm: 200 }),
});

const dinVisual = visualMicroscope({
  microscope: dinMicroscope,
  eyepiece: eyepiece25.prescription,
  wavelengthNm: L,
});
const infinityVisual = visualMicroscope({
  microscope: infinityMicroscope,
  eyepiece: eyepiece25.prescription,
  wavelengthNm: L,
});
const oilVisual = visualMicroscope({
  microscope: oilMicroscope,
  eyepiece: eyepieceOf(10),
  wavelengthNm: L,
});

describe("§ 6q.1 — the collimating gap: the exit is flat for the SPECIMEN", () => {
  const cases = [
    ["DIN 4×/0.10", dinVisual],
    ["infinity 4×/0.10 + tube lens", infinityVisual],
    ["100×/1.40 oil", oilVisual],
  ] as const;

  for (const [label, visual] of cases) {
    it(`${label}: the axial cone leaves collimated — zero vergence`, () => {
      const stopRadius = pupils(visual.system, L).stopRadius;
      const diopters = exitVergenceDiopters(visual.system, L, stopRadius);
      // Collimated to f64 noise: the solve is exact (affine in the gap), not
      // iterative, so anything else would be a bug rather than a tolerance.
      expect(Math.abs(diopters)).toBeLessThan(1e-8);
    });
  }

  it("both architectures reach the same solve — the contract is the instrument, not the preset", () => {
    // A DIN objective forms its image with no tube lens at all and an
    // infinity-corrected one cannot form an image without one. Both satisfy
    // `ImageFormingMicroscope` and both collimate; that is what makes the
    // eyepiece an eyepiece for a MICROSCOPE rather than for one architecture.
    expect(dinVisual.gapMm).toBeGreaterThan(0);
    expect(infinityVisual.gapMm).toBeGreaterThan(0);
    expect(dinVisual.gapMm).not.toBeCloseTo(infinityVisual.gapMm, 3);
  });

  it("a powerless second module is refused, not solved", () => {
    const flat: Prescription = {
      surfaces: [{ kind: "refract", curvature: 0, semiAperture: 10, thickness: 5, medium: "AIR" }],
    };
    expect(() =>
      collimatingGap(dinMicroscope.prescription, flat, dinMicroscope.objectDistanceMm, L),
    ).toThrow(/no power/);
  });

  it("a negative eyepiece is refused — it cannot collimate a real image", () => {
    const negative: Prescription = {
      surfaces: [
        { kind: "refract", curvature: -0.02, semiAperture: 10, thickness: 2, medium: "N-BK7" },
        { kind: "refract", curvature: 0.02, semiAperture: 10, thickness: 0, medium: "AIR" },
      ],
    };
    expect(() =>
      visualMicroscope({ microscope: dinMicroscope, eyepiece: negative, wavelengthNm: L }),
    ).toThrow(/must be positive/);
  });
});

describe("§ 6q.2 — the gap IS the intermediate image plus the eyepiece's front focus", () => {
  // The solve is run on the trace; this is the closed form it lands on, so the
  // agreement is a check and not the construction. Thick-group correct: FFD_e is
  // measured from the eyepiece's own first vertex, never from a thin-lens f_e.
  const cases = [
    ["DIN 4×/0.10", dinVisual],
    ["infinity 4×/0.10 + tube lens", infinityVisual],
    ["100×/1.40 oil", oilVisual],
  ] as const;

  for (const [label, visual] of cases) {
    it(`${label}: solved gap = imageDistance + FFD_eyepiece`, () => {
      const rel = Math.abs(visual.gapMm - visual.gapFromFrontFocalDistanceMm) / visual.gapMm;
      expect(rel).toBeLessThan(1e-12);
    });
  }

  it("the front focal distance is NOT the focal length — the eyepiece is thick", () => {
    // 18.32 mm against 25 mm: 27% short. A composition that used f_e for the
    // spacing would put the eyepiece 6.7 mm wrong, which § 6q.3 prices.
    expect(dinVisual.eyepieceFocalLengthMm).toBeCloseTo(25, 6);
    expect(dinVisual.eyepieceFrontFocalDistanceMm).toBeLessThan(19);
    expect(dinVisual.eyepieceFrontFocalDistanceMm).toBeGreaterThan(18);
  });
});

describe("§ 6q.3 — the negative control: the telescope's own solve, in diopters", () => {
  it("afocalTelescope's gap leaves the exit CONVERGING by tens of diopters", () => {
    const telescope = afocalTelescope({
      objective: dinMicroscope.prescription,
      eyepiece: eyepiece25.prescription,
      wavelengthNm: L,
    });
    // Same two modules, same wavelength; only the ray the gap was solved from
    // differs — collimated in, versus from the specimen.
    const wrong = spliceModules(
      [
        { surfaces: dinMicroscope.prescription.surfaces, gapAfterMm: telescope.gapMm },
        { surfaces: eyepiece25.prescription.surfaces, gapAfterMm: 0 },
      ],
      dinMicroscope.prescription.objectMedium ?? "AIR",
    );
    const wrongSystem: OpticalSystem = {
      ...dinVisual.system,
      prescription: { ...wrong, surfaces: wrong.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })) },
    };
    const stopRadius = pupils(dinVisual.system, L).stopRadius;
    const diopters = exitVergenceDiopters(wrongSystem, L, stopRadius);

    // The gap is 150.8 mm short — the telescope's solve knows nothing about
    // where the intermediate image is, because for a telescope it is at the
    // objective's focus and for a microscope it is 150 mm of tube further on.
    expect(telescope.gapMm).toBeLessThan(dinVisual.gapMm - 150);
    // ...which puts the eyepiece BEFORE the intermediate image rather than
    // behind it, so its object is virtual.
    expect(telescope.gapMm).toBeLessThan(dinMicroscope.imageDistanceMm - 100);

    // +70.5 D, and the SIGN is the diagnosis: positive means the exit beam
    // converges to a real point ~14 mm past the eye lens. That is not merely
    // more than an eye accommodates — it is the wrong side of infinity, since
    // accommodation only ever adds positive power. A quarter diopter is the
    // usual threshold of noticing, so the wrong solve is ~280× past unusable
    // in a direction no observer can compensate at all.
    expect(diopters).toBeGreaterThan(60); // signed: converging, not diverging
    expect(1000 / diopters).toBeLessThan(20); // crosses the axis within 20 mm
    expect(diopters / 0.25).toBeGreaterThan(200);
    // The solved gap is the other side of zero by 12 orders of magnitude.
    expect(Math.abs(exitVergenceDiopters(dinVisual.system, L, stopRadius))).toBeLessThan(1e-8);
  });
});

describe("§ 6q.4 — visual magnification: M_obj × (D/f_e), from the real chief ray", () => {
  const smallHeightMm = 1e-3;

  it("DIN: the traced angle gives M_obj·(D/f_e), and it INVERTS", () => {
    const M = visualMagnification(dinVisual.system, smallHeightMm, L, NEAR_POINT_MM);
    expect(dinVisual.nominalVisualMagnification).toBeCloseTo(40, 12);
    expect(M).toBeLessThan(0); // a microscope's image is inverted
    expect(Math.abs(M) / dinVisual.nominalVisualMagnification - 1).toBeLessThan(1e-5);
  });

  it("infinity-corrected: the same law on a different instrument", () => {
    const M = visualMagnification(infinityVisual.system, smallHeightMm, L, NEAR_POINT_MM);
    expect(infinityVisual.nominalVisualMagnification).toBeCloseTo(40, 12);
    expect(Math.abs(M) / infinityVisual.nominalVisualMagnification - 1).toBeLessThan(1e-3);
  });

  it("the sign is pinned by a magnifier: a single positive lens reads +D/f, ERECT", () => {
    // The control that decides the convention, and it caught a real sign error.
    // A loupe with the object on its front focus is the degenerate case of this
    // whole composition — one collimating group, no objective — and everyone
    // knows its answer: +250/f, upright. A microscope's is negative on the same
    // definition, so "inverted" is measured against something rather than
    // asserted from a formula's leading minus.
    const n = getMedium("N-BK7").n(L);
    const f = 50;
    const C = 1 / (2 * (n - 1) * f);
    const loupe: Prescription = {
      surfaces: [
        { kind: "refract", curvature: C, semiAperture: 12, thickness: 1e-3, medium: "N-BK7", isStop: true },
        { kind: "refract", curvature: -C, semiAperture: 12, thickness: 0, medium: "AIR" },
      ],
    };
    const loupeSystem: OpticalSystem = {
      prescription: loupe,
      aperture: { kind: "stopRadius", value: 5 },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: L, weight: 1 }],
      conjugate: { kind: "finite", distance: collimatingObjectDistance(loupe, L) },
    };
    const magnifier = visualMagnification(loupeSystem, 1e-3, L, 250);
    expect(magnifier).toBeGreaterThan(0);
    expect(magnifier).toBeCloseTo(250 / f, 3);
    // ...and the compound instrument is the other sign, on the same definition.
    expect(visualMagnification(dinVisual.system, smallHeightMm, L, 250)).toBeLessThan(0);
  });

  it("the near point is a CONVENTION: M is exactly proportional to D", () => {
    // 250 mm is a statement about human eyes, not optics, so nothing in the
    // trace may depend on the digits — exactly the split § 6a makes for the
    // 200/180/165 tube lengths. Doubling D doubles M and changes no ray.
    const at250 = visualMagnification(dinVisual.system, smallHeightMm, L, 250);
    const at254 = visualMagnification(dinVisual.system, smallHeightMm, L, 254);
    expect(at254 / at250).toBeCloseTo(254 / 250, 12);
    expect(NEAR_POINT_MM).toBe(250);
  });

  it("the eyepiece's own share is D/f_e and the objective's is unchanged", () => {
    expect(dinVisual.eyepieceMagnification).toBeCloseTo(250 / 25, 9);
    expect(dinVisual.nominalVisualMagnification).toBeCloseTo(
      dinMicroscope.nominalMagnification * dinVisual.eyepieceMagnification,
      12,
    );
  });

  it("it is a REAL ray's answer: M grows toward the field edge, and converges as h → 0", () => {
    // § 5n's distortion, arriving on the microscope's conjugate. The local
    // visual magnification at the field edge is 20% above the paraxial value —
    // pincushion — so "the magnification" is only a single number near the axis,
    // and every rung above is taken there deliberately.
    const near = Math.abs(visualMagnification(dinVisual.system, 1e-4, L, 250));
    const mid = Math.abs(visualMagnification(dinVisual.system, 1, L, 250));
    const edge = Math.abs(visualMagnification(dinVisual.system, 2.49, L, 250));
    expect(near).toBeCloseTo(40, 5);
    expect(mid).toBeGreaterThan(40.9);
    expect(edge / 40 - 1).toBeGreaterThan(0.15);
    // Cubic: the departure from paraxial falls ×~100 per decade of height.
    const d1 = Math.abs(visualMagnification(dinVisual.system, 0.1, L, 250)) - near;
    const d2 = Math.abs(visualMagnification(dinVisual.system, 0.01, L, 250)) - near;
    expect(d1 / d2).toBeGreaterThan(50);
  });
});

describe("§ 6q.5 — the exit pupil, and WHICH numerical aperture the invariant takes", () => {
  it("the two object NAs are the tangent and the sine of one angle — exactly", () => {
    // `objectNumericalAperture` reads n·sin u off the real marginal ray;
    // `paraxialObjectNumericalAperture` reads n·u off the entrance pupil's own
    // geometry. With the stop ON surface 0 and no glass between it and the
    // specimen the marginal ray is a straight line, so the second is exactly
    // n·tan u and their ratio is exactly sec u = 1/√(1−NA²). To f64.
    for (const na of [0.1, 0.15]) {
      const scope = finiteConjugateMicroscope({
        objective: finiteConjugateObjective({ magnification: 10, numericalAperture: na }),
      });
      const v = visualMicroscope({
        microscope: scope,
        eyepiece: eyepiece25.prescription,
        wavelengthNm: L,
      });
      const sine = objectNumericalAperture(v.system, L);
      const tangent = paraxialObjectNumericalAperture(v.system, L);
      expect(sine).toBeCloseTo(na, 9);
      expect(tangent / sine).toBeCloseTo(1 / Math.sqrt(1 - na * na), 12);
    }
  });

  it("Lagrange holds with the PARAXIAL NA: r_xp = D·NA/|M| at NA 0.10", () => {
    const M = visualMagnification(dinVisual.system, 1e-3, L, 250);
    const measured = pupils(dinVisual.system, L).exit.radius;
    const law = lagrangeExitPupilRadiusMm(
      paraxialObjectNumericalAperture(dinVisual.system, L),
      250,
      M,
    );
    // Two genuinely independent routes: `pupils` images the stop through the
    // eyepiece; the law comes from the chief ray's exit angle and the marginal
    // ray's launch. They agree to the real-ray residual of M itself.
    expect(Math.abs(law / measured - 1)).toBeLessThan(1e-5);
    // ...and the textbook 500·NA/M is that law with D = 250 and nothing else.
    expect(2 * law).toBeCloseTo(
      (2 * 250 * paraxialObjectNumericalAperture(dinVisual.system, L)) / Math.abs(M),
      12,
    );
  });

  it("...and the SINE NA misses it by exactly √(1−NA²) − 1 at NA 0.10", () => {
    const M = visualMagnification(dinVisual.system, 1e-3, L, 250);
    const measured = pupils(dinVisual.system, L).exit.radius;
    const withSine = lagrangeExitPupilRadiusMm(objectNumericalAperture(dinVisual.system, L), 250, M);
    const na = 0.1;
    // −0.50%, and it is not a tolerance question — it is cos u, in closed form.
    expect(withSine / measured - 1).toBeCloseTo(Math.sqrt(1 - na * na) - 1, 6);
  });

  it("at NA 1.40 the sine form misses by 61%, and the tangent form is still exact", () => {
    // The § 6h move: pin the law that holds, and measure what the other one
    // costs where it stops being a rounding error. "Exit pupil = 500·NA/M" is
    // the formula every microscopy text prints, and at an oil objective's
    // aperture it is wrong by a factor of 2.5.
    const M = visualMagnification(oilVisual.system, 1e-5, L, 250);
    const measured = pupils(oilVisual.system, L).exit.radius;
    const tangent = paraxialObjectNumericalAperture(oilVisual.system, L);
    const sine = objectNumericalAperture(oilVisual.system, L);

    expect(sine).toBeCloseTo(1.4, 6);
    // The paraxial figure is 3.55 — LARGER than the oil's own index, so it is
    // not a physically realizable aperture at all. It is a slope, and Lagrange
    // is a law about slopes; that is the whole content of this rung.
    expect(tangent).toBeGreaterThan(3);
    expect(Math.abs(lagrangeExitPupilRadiusMm(tangent, 250, M) / measured - 1)).toBeLessThan(1e-7);
    expect(lagrangeExitPupilRadiusMm(sine, 250, M) / measured - 1).toBeLessThan(-0.55);
  });

  it("eye relief is the exit pupil's distance from the eye lens, and it is positive", () => {
    const props = microscopeVisualProperties(dinVisual, L);
    expect(props.exitPupilRadiusMm).toBeCloseTo(pupils(dinVisual.system, L).exit.radius, 12);
    expect(props.eyeReliefMm).toBeGreaterThan(15);
  });

  it("...and it shortens with the eyepiece's focal length — ONE microscope, three eyepieces", () => {
    // The classic complaint about high power, and it falls out of the pupil
    // imaging rather than a rule. Held on one instrument deliberately: comparing
    // a 25 mm eyepiece on a 4× against a 10 mm on a 100× oil would confound the
    // eyepiece with the whole objective and the intermediate image's position.
    const reliefs = [30, 20, 10].map(
      (fe) =>
        microscopeVisualProperties(
          visualMicroscope({
            microscope: dinMicroscope,
            eyepiece: eyepieceOf(fe),
            wavelengthNm: L,
          }),
          L,
        ).eyeReliefMm,
    );
    expect(reliefs[0]!).toBeGreaterThan(reliefs[1]!);
    expect(reliefs[1]!).toBeGreaterThan(reliefs[2]!);
    for (const r of reliefs) expect(r).toBeGreaterThan(0);
    // Roughly proportional to f_e — a 3× drop in focal length costs most of the
    // relief, which is why short eyepieces are uncomfortable.
    expect(reliefs[0]! / reliefs[2]!).toBeGreaterThan(2);
  });
});

describe("§ 6q.6 — the two-stop competition decides which pupil carries the beam", () => {
  const eyePupilMm = 2;

  it("`limiting` selection flips exactly where the exit pupil crosses the iris", () => {
    // § 5p's capability, on the microscope's conjugate. Nothing here asserts a
    // crossover; the trace picks whichever surface actually limits the beam and
    // the crossover is read off where the pick changes.
    const at = (fe: number) =>
      visualMicroscopeSystem({
        visual: visualMicroscope({
          microscope: dinMicroscope,
          eyepiece: eyepieceOf(fe),
          wavelengthNm: L,
        }),
        eye: { pupilDiameterMm: eyePupilMm },
        wavelengthNm: L,
      });

    const wide = at(40); // exit pupil 2.010 mm — wider than the iris
    const narrow = at(39); // exit pupil 1.960 mm — narrower
    expect(wide.exitPupilDiameterMm).toBeGreaterThan(eyePupilMm);
    expect(narrow.exitPupilDiameterMm).toBeLessThan(eyePupilMm);
    expect(wide.irisLimited).toBe(true);
    expect(narrow.irisLimited).toBe(false);
    // And the working pupil is the smaller of the two, on both sides.
    expect(wide.workingPupilDiameterMm).toBeCloseTo(eyePupilMm, 12);
    expect(narrow.workingPupilDiameterMm).toBeCloseTo(narrow.exitPupilDiameterMm, 12);
  });
});

describe("§ 6q.7 — empty magnification, as an invariance rather than as a rule", () => {
  const eyePupilMm = 2;
  const ratioAt = (fe: number): { M: number; ratio: number; iris: boolean } => {
    const v = visualMicroscope({
      microscope: dinMicroscope,
      eyepiece: eyepieceOf(fe),
      wavelengthNm: L,
    });
    const vs = visualMicroscopeSystem({
      visual: v,
      eye: { pupilDiameterMm: eyePupilMm },
      wavelengthNm: L,
    });
    const M = visualMagnification(v.system, 1e-3, L, 250);
    return {
      M: Math.abs(M),
      ratio: visualDetailRatio(
        M,
        paraxialObjectNumericalAperture(v.system, L),
        250,
        vs.workingPupilDiameterMm,
      ),
      iris: vs.irisLimited,
    };
  };

  it("ABOVE the crossover the ratio does not move with M — a 4× sweep, flat to 1e-6", () => {
    // The statement empty magnification actually is. Past the crossover the
    // working pupil IS the exit pupil, which is D·NA/|M| by § 6q.5, so the M
    // cancels identically: more magnification cannot change whether the eye
    // resolves what the objective transmits. The residual is the real chief
    // ray's own departure from paraxial, nothing else.
    const rows = [39, 30, 20, 10].map(ratioAt);
    for (const r of rows) {
      expect(r.iris).toBe(false);
      expect(Math.abs(r.ratio - 1)).toBeLessThan(1e-6);
    }
    expect(rows[3]!.M / rows[0]!.M).toBeGreaterThan(3.8); // a real 4× span of M
  });

  it("BELOW it the ratio is exactly proportional to M — magnification buys resolution", () => {
    const rows = [100, 60, 45, 40].map(ratioAt);
    for (const r of rows) {
      expect(r.iris).toBe(true);
      expect(r.ratio).toBeLessThan(1);
    }
    // ratio/M is constant while the iris rules: the working pupil is fixed at
    // the iris, so the ratio carries the M linearly.
    const slopes = rows.map((r) => r.ratio / r.M);
    for (const s of slopes) expect(s).toBeCloseTo(slopes[0]!, 12);
  });

  it("the crossover is where the ratio reaches 1, and it is the exit pupil = iris point", () => {
    expect(ratioAt(40).ratio).toBeGreaterThan(0.99);
    expect(ratioAt(40).ratio).toBeLessThan(1);
    expect(ratioAt(39).ratio).toBeGreaterThan(1 - 1e-6);
  });

  it("λ cancels: the ratio is 1 at F and C too, though every input moved", () => {
    // Both limits scale with wavelength — Abbe's λ/(2·NA) and the eye pupil's
    // λ/p — so the ratio carries no λ. The honest way to pin that is not to
    // observe the formula has no λ argument (it would be true of a wrong
    // formula too) but to TRACE the same instrument at three lines and check
    // the answer does not move while its inputs do: the glass disperses, so M,
    // the NA and the exit pupil all shift between F and C.
    const v = visualMicroscope({
      microscope: dinMicroscope,
      eyepiece: eyepieceOf(20),
      wavelengthNm: L,
    });
    const at = (nm: number) => {
      const M = visualMagnification(v.system, 1e-3, nm, 250);
      const na = paraxialObjectNumericalAperture(v.system, nm);
      const dxp = 2 * pupils(v.system, nm).exit.radius;
      // Above the crossover on every line: the exit pupil is ~1.0 mm and the
      // iris is 2 mm, so the working pupil is the instrument's throughout.
      expect(dxp).toBeLessThan(2);
      return { M, na, dxp, ratio: visualDetailRatio(M, na, 250, dxp) };
    };
    const f = at(LINE_F);
    const d = at(LINE_D);
    const c = at(LINE_C);

    // The inputs genuinely move — this is a real achromat with real residual
    // colour, not a wavelength-independent stand-in.
    expect(Math.abs(f.M - c.M)).toBeGreaterThan(1e-6 * Math.abs(d.M));
    expect(Math.abs(f.dxp - c.dxp)).toBeGreaterThan(1e-6 * d.dxp);
    // ...and the ratio does not.
    for (const row of [f, d, c]) expect(Math.abs(row.ratio - 1)).toBeLessThan(1e-6);
  });

  it("500·NA and 1000·NA fall out of the two exit-pupil conventions — the digits are nowhere", () => {
    const na = 0.1;
    const range = usefulMagnificationRange(
      na,
      NEAR_POINT_MM,
      MIN_USEFUL_EXIT_PUPIL_MM,
      MAX_USEFUL_EXIT_PUPIL_MM,
    );
    // r_xp = D·NA/|M| inverted at p = 1 mm and p = 0.5 mm, with D = 250.
    expect(range.min).toBeCloseTo(500 * na, 12);
    expect(range.max).toBeCloseTo(1000 * na, 12);
    // A different near point moves both, which is what "convention" means.
    const at200 = usefulMagnificationRange(na, 200, 0.5, 1);
    expect(at200.max / range.max).toBeCloseTo(200 / 250, 12);
  });
});

describe("§ 6q.8 — the field number is a real aperture, not a printed number", () => {
  const fieldNumberMm = 20;
  const withStop = visualMicroscope({
    microscope: dinMicroscope,
    eyepiece: eyepiece25.prescription,
    wavelengthNm: L,
    fieldNumberMm,
  });

  it("the specimen circle is FN/M_obj — 5 mm on a 4×", () => {
    expect(withStop.objectFieldDiameterMm).toBeCloseTo(5, 12);
    // And it is the objective, not the eyepiece, that sets it: the same field
    // stop on a 10× shows a fifth as much specimen.
    const ten = visualMicroscope({
      microscope: finiteConjugateMicroscope({
        objective: finiteConjugateObjective({ magnification: 10, numericalAperture: 0.1 }),
      }),
      eyepiece: eyepiece25.prescription,
      wavelengthNm: L,
      fieldNumberMm,
    });
    expect(ten.objectFieldDiameterMm).toBeCloseTo(2, 12);
  });

  it("a field beyond it VIGNETTES in the trace, bracketing FN/(2·M_obj) to 0.4%", () => {
    // The stop is spliced in as a real annular surface at the intermediate
    // image, so the chief ray is clipped by the tracer rather than by a check.
    expect(() => visualMagnification(withStop.system, 2.49, L, 250)).not.toThrow();
    expect(() => visualMagnification(withStop.system, 2.51, L, 250)).toThrow(/vignetted/);
  });

  it("the apparent field of view is the stop's angular size at f_e", () => {
    expect(withStop.apparentFieldOfViewDeg).toBeCloseTo(
      (2 * Math.atan(fieldNumberMm / (2 * withStop.eyepieceFocalLengthMm)) * 180) / Math.PI,
      12,
    );
    expect(withStop.apparentFieldOfViewDeg).toBeGreaterThan(43);
    expect(withStop.apparentFieldOfViewDeg).toBeLessThan(44);
  });

  it("the field stop does not disturb the aperture: same gap, same magnification", () => {
    // A field stop limits the FIELD. It sits where the axial marginal cone is at
    // its narrowest, so it must not become the aperture stop, and splitting the
    // gap around it must not move the eyepiece.
    expect(withStop.gapMm).toBeCloseTo(dinVisual.gapMm, 12);
    expect(visualMagnification(withStop.system, 1e-3, L, 250)).toBeCloseTo(
      visualMagnification(dinVisual.system, 1e-3, L, 250),
      9,
    );
    expect(pupils(withStop.system, L).exit.radius).toBeCloseTo(
      pupils(dinVisual.system, L).exit.radius,
      9,
    );
    expect(withStop.fieldStopSurfaceIndex).toBe(dinMicroscope.prescription.surfaces.length);
  });
});

describe("§ 6q.9 — the guards", () => {
  it("exactly one aperture stop survives the splice, on surface 0", () => {
    for (const visual of [dinVisual, infinityVisual, oilVisual]) {
      const flags = visual.prescription.surfaces.filter((s) => s.isStop);
      expect(flags.length).toBe(1);
      expect(visual.prescription.surfaces[0]!.isStop).toBe(true);
    }
  });

  it("a second declared stop is refused rather than arbitrated", () => {
    // § 6a was bitten by three flagged stops and § 5q by a stripped one, so the
    // composition checks rather than trusts. An eyepiece that declares its own
    // aperture is a plausible mistake with a plausible-looking image behind it.
    const flagged: Prescription = {
      ...eyepiece25.prescription,
      surfaces: eyepiece25.prescription.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })),
    };
    expect(() =>
      visualMicroscope({ microscope: dinMicroscope, eyepiece: flagged, wavelengthNm: L }),
    ).toThrow(/exactly one aperture stop/);
  });

  it("the computed Plössl's clear aperture walls out at ~0.88·f_e", () => {
    // Not a § 6q capability — a § 5j one, arriving where it bites. A field
    // number of 20 needs 20 mm of glass, and the cemented-doublet form admits
    // 22 mm at f_e = 25 and refuses 24. So FN 20 is near the wall rather than
    // comfortably inside it, and a wider field is a different eyepiece form
    // (the transcribed patent members), not a wider aperture on this one.
    expect(() => plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 22 })).not.toThrow();
    // § 6b.5 identified this as the doublet's three-root refusal rather than a
    // glass failure, and § 6b.5.5 now makes the message say so: the aperture is
    // what is binding, which is exactly this rung's own sentence.
    expect(() => plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 24 })).toThrow(
      /found 3 — .*binding here is the APERTURE and not the glass pair/,
    );
  });
});
