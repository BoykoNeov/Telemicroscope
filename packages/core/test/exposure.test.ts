import { describe, it, expect } from "vitest";
import {
  exposureScale,
  extendedSourceIlluminance,
  imageSpaceMarginalSin,
  pointSourceCollection,
} from "../src/imaging/exposure";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { pupils } from "../src/pupil/pupils";
import { limitingStop } from "../src/pupil/aperture-stop";
import { paraxialObjectNumericalAperture } from "../src/pupil/microscope";
import { LINE_D } from "../src/materials/dispersion";
import { visualSystem } from "../src/pupil/visual";
import { achromaticObjective, plosslEyepiece } from "../src/designs";
import {
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { EPD_MM, FOCAL_MM, FOCUS_NM, heroPair, heroSystem } from "./support/heroScene";

/**
 * Camera mode, part 2: relative exposure (VALIDATION § 5s).
 *
 * Everything here is a ratio — the absolute photon zero point is § 3a's named
 * deferral. The validated, trace-emergent law is E ∝ 1/F² for an extended
 * source, read from the traced marginal cone rather than from the formula it is
 * usually derived from.
 */

/** The hero achromat re-stopped to a given entrance-pupil diameter. */
function atEpd(epd: number): OpticalSystem {
  return { ...heroSystem(heroPair().achromat), aperture: { kind: "EPD", value: epd } };
}

const f10 = atEpd(EPD_MM); // 10 mm on a 100 mm EFL → f/10
const f5 = atEpd(2 * EPD_MM); // 20 mm → f/5

describe("§ 5s.1 — the image-space cone comes from the traced marginal ray", () => {
  it("sin u′ ≈ 1/(2F), departing by the sine condition — more at the faster stop", () => {
    const efl = systemProperties(f10.prescription, FOCUS_NM).efl;
    const par10 = EPD_MM / (2 * efl);
    const par5 = (2 * EPD_MM) / (2 * efl);
    const s10 = imageSpaceMarginalSin(f10, FOCUS_NM);
    const s5 = imageSpaceMarginalSin(f5, FOCUS_NM);
    // Close to the paraxial 1/(2F), but not equal to it: the traced sine departs,
    // and the tolerance is tight enough (∼1% at f/10) to fail a gross error.
    expect(s10).toBeCloseTo(par10, 3);
    expect(s5).toBeCloseTo(par5, 2);
    // The non-tautological pin: the departure is the sine condition, so it GROWS
    // with aperture. A stub returning the paraxial formula would read zero for
    // both and fail here.
    const dev10 = Math.abs(s10 / par10 - 1);
    const dev5 = Math.abs(s5 / par5 - 1);
    expect(dev5).toBeGreaterThan(2 * dev10);
    expect(dev10).toBeGreaterThan(1e-4);
  });
});

describe("§ 5s.2 — relative exposure follows the f-ratio law", () => {
  it("extended-source illuminance ∝ 1/F² — the exposure law, from the trace", () => {
    // A stop faster by 2× (f/10 → f/5) lights each pixel 4× as hard. The ratio
    // is built from the *traced* sin u′, so it lands at the paraxial 1/F²
    // prediction of 4 but not exactly on it: the faster stop's larger
    // sine-condition departure pushes it slightly ABOVE 4. A stub returning the
    // paraxial formula would read exactly 4 and fail the directional check.
    const eF10 = extendedSourceIlluminance(f10, FOCUS_NM);
    const eF5 = extendedSourceIlluminance(f5, FOCUS_NM);
    expect(eF5 / eF10).toBeCloseTo(4, 1); // 1/F² law
    expect(eF5 / eF10).toBeGreaterThan(4); // ...carrying the sine-condition excess
  });
});

describe("§ 5s.3 — point-source light grasp, on a front stop", () => {
  it("point-source light grasp ∝ D² (light-grasp bookkeeping)", () => {
    // Consistency check, not an independent pin: with a front stop the entrance
    // radius is the declared one, so this exercises the π·r² bookkeeping, not
    // the trace. The validated law is the 1/F² above. § 5s.6 is where the
    // entrance pupil stops being the declared aperture and this becomes a pin.
    expect(pointSourceCollection(f5, FOCUS_NM) / pointSourceCollection(f10, FOCUS_NM)).toBeCloseTo(
      4,
      6,
    );
  });
});

describe("§ 5s.4 — the exposure scale", () => {
  it("exposure scale is illuminance × time × gain", () => {
    const e = extendedSourceIlluminance(f10, FOCUS_NM);
    expect(exposureScale(e, { seconds: 2 })).toBeCloseTo(2 * e, 12); // gain defaults to 1
    expect(exposureScale(e, { seconds: 2, gain: 3 })).toBeCloseTo(6 * e, 12);
    // Doubling time and halving gain leave the frame where it was.
    expect(exposureScale(e, { seconds: 4, gain: 0.5 })).toBeCloseTo(
      exposureScale(e, { seconds: 2, gain: 1 }),
      12,
    );
  });
});

// ── § 5s.5 / § 5s.6 — the entrance pupil is not always a radius, and not always
//    the declared aperture ──────────────────────────────────────────────────

/** The 4×/0.10 objective in its tube, at either stop placement (§ 6v, § 6ai). */
function scope(stopPlacement: "backFocal" | "rim"): OpticalSystem {
  return infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement }),
    tubeLens: tubeLens({ apertureMm: 25 }),
  }).system;
}

/**
 * A thick singlet with a diaphragm a stated distance behind it. At exactly the
 * singlet's own back focal distance the stop is object-space telecentric and the
 * entrance pupil goes to infinity — at an INFINITE conjugate, which is the corner
 * that makes § 5s.5 more than a microscope story.
 *
 * The glass is 12 mm semi-aperture and the diaphragm 5 mm, so the two apertures
 * are never confusable: whichever one a reading lands on names itself.
 */
const singletSurfaces = (gapMm: number): Prescription["surfaces"] => [
  { kind: "refract", curvature: 1 / 51.68, semiAperture: 12, thickness: 4, medium: "N-BK7" },
  { kind: "refract", curvature: -1 / 51.68, semiAperture: 12, thickness: gapMm, medium: "AIR" },
  { kind: "refract", curvature: 0, semiAperture: 5, thickness: 100, medium: "AIR", isStop: true },
];

const SINGLET_BFD = systemProperties(
  { objectMedium: "AIR", surfaces: singletSurfaces(0).slice(0, 2) },
  FOCUS_NM,
).bfd;

const singletAt = (gapMm: number, policy?: "declared" | "limiting"): OpticalSystem => ({
  prescription: { objectMedium: "AIR", surfaces: singletSurfaces(gapMm) },
  aperture: { kind: "stopRadius", value: 5 },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: FOCUS_NM, weight: 1 }],
  conjugate: { kind: "infinite" },
  ...(policy === undefined ? {} : { apertureStop: { kind: policy } }),
});

/** The objective's own design line — the only wavelength it is telecentric AT. */
const DESIGN_NM = LINE_D;

describe("§ 5s.5 — the pupil that is not an area", () => {
  it("HEADLINE: the telecentric member's grasp spans 13 orders across one spectrum", () => {
    // The finding, and the reason the refusal is not keyed on ∞. The DEFAULT 4×
    // objective's entrance pupil is at infinity only at the line it was designed
    // on; a wavelength either side it comes back finite and enormous, and π·r²
    // returns those as ordinary numbers. Left unrefused, a five-wavelength
    // spectral render would have collected a different universe per plane.
    const tele = scope("backFocal");
    const radii = [430, 486.1327, FOCUS_NM, DESIGN_NM].map(
      (nm) => pupils(tele, nm).entrance.radius,
    );
    expect(radii[0]).toBeCloseTo(2039.721255561574, 6); //   430 nm
    expect(radii[1]).toBeCloseTo(11028.931252624274, 6); //  F line
    expect(radii[2]).toBeCloseTo(64338.90508117544, 5); //   550 nm
    expect(radii[3]).toBe(Infinity); //                      the design line
    // Monotone on the way there, so this is a pole and not noise.
    expect(radii[1]! / radii[0]!).toBeGreaterThan(5);
    expect(radii[2]! / radii[1]!).toBeGreaterThan(5);

    // The same lens, one stop placement apart, with its pupil AT its stop: flat
    // to the bit at every one of those wavelengths. This column is what makes
    // the other one damning — the spread is the pupil's placement, not the glass.
    const rim = scope("rim");
    for (const nm of [430, 486.1327, FOCUS_NM, DESIGN_NM, 656.2725, 670]) {
      expect.soft(pointSourceCollection(rim, nm), `rim @${nm}`).toBe(75.27838708883591);
    }
  });

  it("so the refusal is on the PLACEMENT, and fires at every wavelength", () => {
    const tele = scope("backFocal");
    // Surface 3, behind the front group's power — not the front rim.
    expect(pupils(tele, DESIGN_NM).stopIndex).toBe(3);
    expect(pupils(scope("rim"), DESIGN_NM).stopIndex).toBe(0);
    for (const nm of [430, 486.1327, FOCUS_NM, DESIGN_NM, 656.2725, 670]) {
      expect
        .soft(() => pointSourceCollection(tele, nm), `tele @${nm}`)
        .toThrow(/the flux is a SOLID ANGLE/);
    }
    // A guard keyed on ∞ alone would have caught exactly one of those six.
    expect(pupils(tele, FOCUS_NM).entrance.radius).toBeLessThan(Infinity);
  });

  it("the cone the refusal redirects to IS stop-placement free at the design line", () => {
    // § 6ah's identity, and the reason "read the cone instead" is a redirection
    // and not a consolation: at the line the objective is telecentric AT, the
    // slope branch and the semi-diameter-over-arm branch are the same double.
    const slope = pupils(scope("backFocal"), DESIGN_NM).entrance.slopeRadius;
    expect(slope).toBe(0.1 / Math.sqrt(1 - 0.1 * 0.1));
    expect(paraxialObjectNumericalAperture(scope("backFocal"), DESIGN_NM)).toBe(
      paraxialObjectNumericalAperture(scope("rim"), DESIGN_NM),
    );
  });

  it("an NA is a magnitude: a VIRTUAL entrance pupil must not return it negative", () => {
    // Found by asking what the refusal redirects TO. At 550 nm the telecentric
    // member's pupil has crossed through infinity and sits BEHIND the specimen,
    // so the arm is negative — and this came back −0.100517 on the shipped
    // default objective, into a readout (`visualDetailRatio`) that refuses a
    // non-positive NA. § 6ah repaired the ∞/∞ at the design line and this sat
    // one wavelength away from it.
    const tele = scope("backFocal");
    expect(pupils(tele, FOCUS_NM).entrance.z + 48.70547841678924).toBeLessThan(0); // virtual
    const na = paraxialObjectNumericalAperture(tele, FOCUS_NM);
    expect(na).toBeGreaterThan(0);
    expect(na).toBeCloseTo(0.1005172697, 9);
    // The rim member never had the sign to get wrong, and is unmoved — so this
    // is a repair to one branch and not a rescaling of the quantity.
    expect(paraxialObjectNumericalAperture(scope("rim"), FOCUS_NM)).toBe(0.10050378152592121);
  });

  it("an INFINITE conjugate reaches a pupil at infinity too, and refuses differently", () => {
    // Not microscope-only, and NOT the same sentence: a source at infinity is
    // where π·r² genuinely IS the collected flux, so what fails here is only
    // that there is no area — the second clause, with its own remedy.
    const p = pupils(singletAt(SINGLET_BFD), FOCUS_NM);
    expect(p.entrance.z).toBe(-Infinity);
    expect(p.entrance.radius).toBe(Infinity);
    expect(p.entrance.slopeRadius).toBeCloseTo(0.09900741585098002, 12);
    expect(() => pointSourceCollection(singletAt(SINGLET_BFD), FOCUS_NM)).toThrow(
      /this pupil is at infinity/,
    );
    expect(() => pointSourceCollection(singletAt(SINGLET_BFD), FOCUS_NM)).toThrow(
      /apertureStop: \{kind: "limiting"\}/,
    );
  });

  it("...and THERE the limiting policy is the remedy — the glass rim, across the basin", () => {
    // A 5 mm diaphragm a micrometre off the back focal plane images back to a
    // quarter-kilometre pupil, which is paraxially correct and physically
    // irrelevant: filling it would need a collimated beam 253 m wide against
    // 12 mm of glass. So the ∞ is the centre of a basin, and `limiting` is flat
    // across the whole of it.
    expect(pointSourceCollection(singletAt(SINGLET_BFD - 0.001), FOCUS_NM)).toBeCloseTo(
      200306221831.60373,
      -4,
    );
    expect(pointSourceCollection(singletAt(SINGLET_BFD * 0.99), FOCUS_NM)).toBeCloseTo(
      828618.8143141862,
      4,
    );
    const rim = Math.PI * 12 * 12;
    for (const gap of [
      SINGLET_BFD,
      SINGLET_BFD - 0.001,
      SINGLET_BFD + 0.001,
      SINGLET_BFD * 0.99,
    ]) {
      const s = singletAt(gap, "limiting");
      expect.soft(pupils(s, FOCUS_NM).stopIndex).toBe(0);
      expect.soft(pointSourceCollection(s, FOCUS_NM)).toBe(rim);
    }
    expect(rim).toBeCloseTo(452.3893421169302, 10);
  });

  it("NEGATIVE CONTROL: that remedy does NOT generalise, and the objective is why", () => {
    // The honest limit on the sentence above. It works because the singlet's
    // declared stop is not its limiting one — a fixture built to make the point.
    // On the objective `limitingStop` AGREES with the declared stop (surface 3),
    // so there is nothing to escape to and the first clause has to carry it.
    const tele = scope("backFocal");
    expect(limitingStop(tele, DESIGN_NM).index).toBe(3);
    expect(() => pointSourceCollection({ ...tele, apertureStop: { kind: "limiting" } }, DESIGN_NM))
      .toThrow(/SOLID ANGLE/);
    // Whereas on the singlet the two genuinely differ, which is the whole
    // difference between the two cases.
    expect(limitingStop(singletAt(SINGLET_BFD), FOCUS_NM).index).toBe(0);
  });

  it("CONTROL: the image-space cone is untouched, so § 5s.2's law is untouched", () => {
    // The defect belongs to the object-space AREA construction alone. At the
    // design line both members deliver the same image-space cone to 4.2e-15
    // relative, through `aimRay`'s own infinity branch — which is why nothing
    // in the 1/F² half of this file had to change. Had that branch not existed
    // this would throw rather than agree, so it is a control and not a restatement.
    const tele = extendedSourceIlluminance(scope("backFocal"), DESIGN_NM);
    const rim = extendedSourceIlluminance(scope("rim"), DESIGN_NM);
    expect(Math.abs(tele / rim - 1)).toBeLessThan(1e-13);
    expect(tele).toBeCloseTo(0.0019382524468777732, 15);
  });
});

describe("§ 5s.6 — light grasp on a pupil that is NOT the declared aperture", () => {
  // § 5s said the D² rung would stay a consistency check until a preset put the
  // entrance pupil somewhere other than the declared aperture — "a stop imaged
  // through preceding power". § 5q's visual telescope is that preset: below the
  // exit pupil the eye's own iris becomes the stop, and the entrance pupil is
  // that iris imaged BACKWARD through the eyepiece and the objective both.
  //
  // The external law is § 5q's two-stop competition, effective aperture
  // min(D, d_eye·|M|), so the grasp is π·min(D, d_eye·|M|)²/4. An infinite
  // conjugate, so § 5s.5's first clause does not apply and an area is exactly
  // the right kind of thing to be collecting.
  const OBJECTIVE = achromaticObjective({ apertureMm: 100, focalRatio: 10 });
  const APERTURE_RADIUS = 50;
  const DECLARED_GRASP = Math.PI * APERTURE_RADIUS * APERTURE_RADIUS;

  const telescope = (eyePupilDiameterMm: number) =>
    visualSystem({
      objective: OBJECTIVE.prescription,
      eyepiece: plosslEyepiece({ focalLengthMm: 25 }).prescription,
      apertureRadiusMm: APERTURE_RADIUS,
      eye: { pupilDiameterMm: eyePupilDiameterMm },
      wavelengthNm: FOCUS_NM,
    });

  it("the iris-limited grasp is π(d_eye·|M|)²/4, and the pupil is the IRIS imaged back", () => {
    for (const dEye of [2.5, 2, 1.5, 1]) {
      const v = telescope(dEye);
      const closedForm = (Math.PI * (dEye * Math.abs(v.magnification)) ** 2) / 4;
      const grasp = pointSourceCollection(v.system, FOCUS_NM);
      expect.soft(v.irisLimited, `d_eye=${dEye}`).toBe(true);
      // The stop is the eye's iris — the LAST surface of the composed chain, not
      // the objective the aperture spec declares.
      expect
        .soft(pupils(v.system, FOCUS_NM).stopIndex, `d_eye=${dEye}`)
        .toBe(v.system.prescription.surfaces.length - 1);
      expect.soft(Math.abs(grasp / closedForm - 1), `d_eye=${dEye}`).toBeLessThan(1e-10);
    }
  });

  it("...which is 6.25× BELOW the declared aperture's answer, so a stub fails", () => {
    // The load-bearing assertion, and the reason it is the under-filling case:
    // a stub that returned π·(declared radius)² reads 1.000000 here instead of
    // 0.159917, and reads it at EVERY eye pupil, so it cannot follow the law either.
    const grasp = pointSourceCollection(telescope(1).system, FOCUS_NM);
    expect(grasp / DECLARED_GRASP).toBeCloseTo(0.1599167208359418, 12);
    expect(DECLARED_GRASP / grasp).toBeCloseTo(6.253253, 5);
    expect(grasp).toBeCloseTo(1255.9829884109115, 8);
  });

  it("CONTROL: above the exit pupil the objective limits and the two DO coincide", () => {
    // 7 mm and 4 mm both clear the 2.5 mm exit pupil, so the declared aperture is
    // the pupil and π·r² recovers what was typed in — exactly the coincidence
    // that makes § 5s.3 a bookkeeping check. Kept as the control so the rung
    // above is read as the case where they part, not as a claim they never meet.
    for (const dEye of [7, 4]) {
      const v = telescope(dEye);
      expect.soft(v.irisLimited, `d_eye=${dEye}`).toBe(false);
      expect.soft(pupils(v.system, FOCUS_NM).stopIndex, `d_eye=${dEye}`).toBe(0);
      expect.soft(pointSourceCollection(v.system, FOCUS_NM), `d_eye=${dEye}`).toBe(DECLARED_GRASP);
    }
  });
});

