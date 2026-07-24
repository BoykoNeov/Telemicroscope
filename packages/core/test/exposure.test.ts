import { describe, it, expect } from "vitest";
import {
  exposureScale,
  extendedSourceIlluminance,
  imageSpaceMarginalSin,
  pointSourceCollection,
} from "../src/imaging/exposure";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
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

describe("the image-space cone comes from the traced marginal ray", () => {
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

describe("relative exposure follows the f-ratio and aperture laws", () => {
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

  it("point-source light grasp ∝ D² (light-grasp bookkeeping)", () => {
    // Consistency check, not an independent pin: with a front stop the entrance
    // radius is the declared one, so this exercises the π·r² bookkeeping, not
    // the trace. The validated law is the 1/F² above.
    expect(pointSourceCollection(f5, FOCUS_NM) / pointSourceCollection(f10, FOCUS_NM)).toBeCloseTo(
      4,
      6,
    );
  });

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
