import { describe, it, expect } from "vitest";
import { achromaticObjective } from "../src/designs/achromat";
import { seidelSums } from "../src/analysis/seidel";
import {
  fieldSurfaces,
  thirdOrderSags,
  thirdOrderDistortionMm,
  distortionProfile,
} from "../src/analysis/field";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { systemProperties } from "../src/trace/paraxial";
import { asCompiled } from "../src/trace/compile";
import { toImageSpace } from "../src/trace/axis";
import { traceRay } from "../src/trace/sequential";
import { chiefRay } from "../src/pupil/aiming";
import { pupils } from "../src/pupil/pupils";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex, LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the astigmatic focal surfaces and distortion — docs/VALIDATION.md
 * § 6ac.
 *
 * VALIDATION recorded "astigmatism and field curvature are present in the trace
 * and unpinned" in four places. They are present because the trace never had a
 * choice: an off-axis pencil focuses at two different axial positions and the
 * existing spot and OPD machinery has been reporting whichever one it landed on
 * ever since § 6a. What was missing was the CLAIM — that those two positions are
 * the third-order astigmatism and Petzval sums of a published closed form — and a
 * claim is what this file adds.
 *
 * Two anchors, and they are independent of each other:
 *
 *  1. **The thin lens with the stop in contact**, whose field sums have closed
 *     forms carrying no shape factor at all (Kingslake, *Lens Design
 *     Fundamentals*, ch. 6; Welford, *Aberrations of Optical Systems*, ch. 8):
 *
 *         S_III = H²·φ        S_IV = H²·Σ(φₖ/nₖ)        S_V = 0
 *
 *     Astigmatism and Petzval curvature at a stop in contact depend only on the
 *     power and the glass, so a shape scan that moves S_I over a factor of eight
 *     must leave these two numerically fixed. That is a sharper test than matching
 *     one number: an error in Ā, in H, or in the Δ(1/n) of the S_IV term would
 *     show up as a spurious shape dependence rather than as an offset.
 *
 *  2. **The § 5j achromat, traced.** The two focal surfaces are `bestSpotZ` on a
 *     `pupilFan` per section, and the published third-order sags
 *
 *         x_s = −(S_III + S_IV)/(2n′u′²)      x_t = −(3S_III + S_IV)/(2n′u′²)
 *
 *     predict them to 0.04% and 0.09% — held over 32× of field, so the residual is
 *     the honest fifth-order term and not a fitted offset. Their classical
 *     corollary is the headline: the tangential surface departs from the Petzval
 *     surface exactly three times as far as the sagittal one, measured 2.9948.
 *
 * WHY THE RATIO IS NOT THE WHOLE RUNG. A 3:1 ratio is sign-blind — it would pass
 * on a system with both sags mirrored, or with the tangential and sagittal
 * sections swapped. So the sags are asserted signed and individually (both
 * negative: both surfaces bend toward the lens, inside the paraxial focus), the
 * section convention is asserted by which fan is the larger, and the on-axis case
 * is a negative control that must be identically zero rather than small.
 *
 * WHY THE FLOOR IS MEASURED AND NOT ASSUMED. An astigmatic interval is a
 * difference of two traced focal planes ~1005 mm from the origin, so f64 leaves
 * ~2.2e-13 mm of room there. The interval at the smallest field used is 7.6e-4 mm
 * — 3.4e9 ulps — so the ratio below is two real numbers dividing each other and
 * not two floors. That is pinned, because it is the assumption the whole step
 * rests on.
 */

const LAM = LINE_D;
const D = 100;
const F = 10;

const N15 = constantIndex("FIELD-N15", 1.5);
const N16 = constantIndex("FIELD-N16", 1.6);
registerMedium(N15);
registerMedium(N16);

/**
 * A thin lens at Coddington shape factor q, stop in contact — § 5j's own
 * construction, reused because the field anchors are stated for exactly this
 * system. Paraxial only: the surfaces cross off axis, so this is for the sums and
 * never for the tracer.
 */
function thinLens(f: number, n: number, q: number, dia: number, medium: string): Prescription {
  const dc = 1 / ((n - 1) * f);
  const c1 = (dc * (q + 1)) / 2;
  const c2 = c1 - dc;
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: dia / 2, thickness: 1e-6, medium, isStop: true },
      { kind: "refract", curvature: c2, semiAperture: dia / 2, thickness: f, medium: "AIR" },
    ],
  };
}

const achromat = achromaticObjective({ apertureMm: D, focalRatio: F });
const system = (deg: number): OpticalSystem => ({
  prescription: achromat.prescription,
  aperture: { kind: "stopRadius", value: D / 2 },
  field: { kind: "angle", values: [deg] },
  wavelengths: [{ nm: LAM, weight: 1 }],
  conjugate: { kind: "infinite" },
});

/** Field angles spanning 128×, so a power law has somewhere to show itself. */
const FIELDS = [0.0125, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6];

describe("Seidel field sums — the thin lens with the stop in contact", () => {
  const f = 1000;
  const dia = 100;
  const h = dia / 2;
  const th = 0.01;
  const sums = (n: number, medium: string, q: number, distortion = false) =>
    seidelSums(thinLens(f, n, q, dia, medium), LAM, {
      marginalHeightMm: h,
      fieldAngleRad: th,
      ...(distortion ? { distortion: true } : {}),
    });

  it("reproduces S_III = H²φ and S_IV = H²Σφ/n, at two indices", () => {
    for (const [n, medium] of [[1.5, "FIELD-N15"], [1.6, "FIELD-N16"]] as const) {
      for (const q of [-2, -0.5, 0, 0.5, 1, 2]) {
        const s = sums(n, medium, q);
        const H = th * h;
        // 6.4e-9 at worst. The next rung shows that residual IS the centre
        // thickness rather than a tolerance chosen to fit.
        expect(s.s3 / ((H * H) / f)).toBeCloseTo(1, 7);
        expect(s.s4 / ((H * H) / (n * f))).toBeCloseTo(1, 7);
      }
    }
  });

  it("leaves a residual that is the CENTRE THICKNESS — linear in it, like § 5j's", () => {
    // The closed forms are thin-lens statements and the construction is a real
    // two-surface lens, so something must be left over. Which something is
    // testable: a thickness ×10 must cost ×10, and it does — 6.4e-9 at 1 nm,
    // 6.4e-8 at 10 nm, 6.4e-7 at 100 nm. That identifies the residual instead of
    // absorbing it, which is the difference between a tolerance and a physics
    // statement.
    const H = th * h;
    const residual = (t: number): number => {
      const dc = 1 / (0.5 * f);
      const c1 = (dc * (-2 + 1)) / 2;
      const p: Prescription = {
        surfaces: [
          { kind: "refract", curvature: c1, semiAperture: h, thickness: t, medium: "FIELD-N15", isStop: true },
          { kind: "refract", curvature: c1 - dc, semiAperture: h, thickness: f, medium: "AIR" },
        ],
      };
      const s = seidelSums(p, LAM, { marginalHeightMm: h, fieldAngleRad: th });
      return Math.abs(s.s3 / ((H * H) / f) - 1);
    };
    const base = residual(1e-6);
    expect(base).toBeGreaterThan(1e-9);
    for (const decade of [1e-5, 1e-4]) {
      expect(residual(decade) / base / (decade / 1e-6)).toBeCloseTo(1, 2);
    }
  });

  it("carries NO shape factor, while S_I over the same scan moves 8×", () => {
    // This is the sharp half of the anchor: bending the lens cannot touch either
    // field sum, so a spurious q-dependence would be a broken Ā, H or Δ(1/n).
    for (const [n, medium] of [[1.5, "FIELD-N15"], [1.6, "FIELD-N16"]] as const) {
      const ref = sums(n, medium, 0);
      let s1min = Infinity;
      let s1max = 0;
      for (const q of [-2, -0.5, 0, 0.5, 1, 2]) {
        const s = sums(n, medium, q);
        expect(s.s3 / ref.s3).toBeCloseTo(1, 8);
        expect(s.s4 / ref.s4).toBeCloseTo(1, 8);
        s1min = Math.min(s1min, s.s1);
        s1max = Math.max(s1max, s.s1);
      }
      expect(s1max / s1min).toBeGreaterThan(8);
    }
  });

  it("puts the Petzval sum at exactly 1/n of the astigmatism — the index, read off two sums", () => {
    for (const [n, medium] of [[1.5, "FIELD-N15"], [1.6, "FIELD-N16"]] as const) {
      expect(sums(n, medium, 0.5).s4 / sums(n, medium, 0.5).s3).toBeCloseTo(1 / n, 8);
    }
  });

  it("reports the Lagrange invariant the sums were built with", () => {
    // With the stop at the first surface ȳ = 0, so H = n·ū·y = θ·h in air, and it
    // must not move with the bending either.
    for (const q of [-2, 0, 2]) {
      expect(sums(1.5, "FIELD-N15", q).lagrangeInvariant).toBeCloseTo(th * h, 15);
    }
  });

  it("nulls S_V — the published zero, and it is a CANCELLATION not a triviality", () => {
    for (const [n, medium] of [[1.5, "FIELD-N15"], [1.6, "FIELD-N16"]] as const) {
      for (const q of [-2, -0.5, 0, 0.5, 1, 2]) {
        const s = sums(n, medium, q, true);
        const perSurface = Math.abs(s.surfaces[0]!.s5!);
        // Each surface carries ~3e-5 and the pair cancels to ~1e-13: the sum is
        // seven orders below its own terms, so the zero is the formula's and not
        // an artefact of both terms being small.
        expect(perSurface).toBeGreaterThan(1e-5);
        expect(Math.abs(s.s5!) / perSurface).toBeLessThan(1e-6);
      }
    }
  });

  it("leaves every field sum identically zero on axis", () => {
    const s = seidelSums(thinLens(f, 1.5, 0.5, dia, "FIELD-N15"), LAM, {
      marginalHeightMm: h,
      distortion: true,
    });
    expect(s.s2).toBe(0);
    expect(s.s3).toBe(0);
    expect(s.s4).toBe(0);
    expect(s.s5).toBe(0);
    expect(s.lagrangeInvariant).toBe(0);
    // …while the on-axis sum that does not vanish still does not.
    expect(Math.abs(s.s1)).toBeGreaterThan(1e-3);
  });

  it("refuses distortion where the classical term is 0/0, and only then", () => {
    // q = −1 is the plano-convex singlet turned back-to-front: a flat first
    // surface in a collimated beam, so A = n(y·0 + 0) = 0 exactly. Not an exotic
    // system — the everyday one — which is why the refusal is loud.
    expect(() => sums(1.5, "FIELD-N15", -1, true)).toThrow(/singular|0\/0/);
    // The same lens is fine for the sums that do not divide by A.
    const ok = sums(1.5, "FIELD-N15", -1);
    expect(ok.s3 / ((th * h * (th * h)) / f)).toBeCloseTo(1, 8);
    expect(ok.s5).toBeUndefined();
  });
});

describe("The traced focal surfaces of the § 5j achromat", () => {
  const surfaces = fieldSurfaces(system(0), FIELDS, LAM, { fanSamples: 41 });

  it("keeps every ray: the sags are not a vignetting artefact", () => {
    for (const focus of surfaces.foci) expect(focus.lost).toBe(0);
  });

  it("reproduces the published third-order sags, over 128× of field", () => {
    for (const focus of surfaces.foci) {
      const pred = thirdOrderSags(system(focus.fieldValue), focus.fieldValue, LAM);
      // 0.09% and 0.04%, and — the part that makes them a residual rather than a
      // fudge — near-constant across the whole field range.
      expect(Math.abs(focus.tangentialSagMm / pred.tangentialMm - 1)).toBeLessThan(2e-3);
      expect(Math.abs(focus.sagittalSagMm / pred.sagittalMm - 1)).toBeLessThan(1e-3);
    }
  });

  it("puts the tangential surface 3× as far from Petzval as the sagittal", () => {
    for (const focus of surfaces.foci) {
      const { petzvalMm } = thirdOrderSags(system(focus.fieldValue), focus.fieldValue, LAM);
      const ratio = (focus.tangentialSagMm - petzvalMm) / (focus.sagittalSagMm - petzvalMm);
      expect(Math.abs(ratio / 3 - 1)).toBeLessThan(2.5e-3);
    }
  });

  it("puts BOTH surfaces inside focus, on the same side — what the ratio cannot check", () => {
    for (const focus of surfaces.foci) {
      expect(focus.sagittalSagMm).toBeLessThan(0);
      expect(focus.tangentialSagMm).toBeLessThan(0);
      // …and the tangential is the further of the two, which is also the
      // assertion that the x fan really is the meridional section.
      expect(focus.tangentialSagMm).toBeLessThan(focus.sagittalSagMm);
      expect(focus.astigmaticIntervalMm).toBeLessThan(0);
    }
  });

  it("grows the astigmatic interval as h² — ×4.000 per doubling of field", () => {
    // FIELDS doubles each step, so consecutive ratios are the power law directly.
    for (let i = 1; i < surfaces.foci.length; i++) {
      const r = surfaces.foci[i]!.astigmaticIntervalMm / surfaces.foci[i - 1]!.astigmaticIntervalMm;
      expect(Math.abs(r / 4 - 1)).toBeLessThan(1e-3);
    }
  });

  it("NEGATIVE CONTROL: on axis both sections focus at the same plane, exactly", () => {
    const axis = fieldSurfaces(system(0), [0], LAM, { fanSamples: 41 });
    expect(axis.foci[0]!.astigmaticIntervalMm).toBe(0);
    expect(axis.foci[0]!.tangentialSagMm).toBe(0);
    expect(axis.foci[0]!.sagittalSagMm).toBe(0);
  });

  it("measures the interval against the f64 floor rather than assuming it clears it", () => {
    // The floor at a focal plane 1005 mm out, in ulps of that z.
    const ulp = Number.EPSILON * Math.abs(surfaces.axialZ);
    const smallest = Math.abs(surfaces.foci[0]!.astigmaticIntervalMm);
    expect(smallest / ulp).toBeGreaterThan(1e6);
    // The number itself, so a later change that quietly shrinks it is visible.
    expect(smallest).toBeGreaterThan(4e-5);
  });

  it("is why the axial reference is traced inside the call and not passed in", () => {
    // The hazard the module's API refuses: the on-axis best-spot plane depends on
    // the fan's sampling, because a fifth-order spherical residual is sampled by
    // it. Two densities disagree by 59× the astigmatic interval at the smallest
    // field here — a field-INDEPENDENT offset that would flatten the h² law and
    // read the 3:1 ratio as 1.02.
    const coarse = fieldSurfaces(system(0), [0.0125], LAM, { fanSamples: 21 });
    const fine = fieldSurfaces(system(0), [0.0125], LAM, { fanSamples: 41 });
    const offset = Math.abs(coarse.axialZ - fine.axialZ);
    expect(offset / Math.abs(fine.foci[0]!.astigmaticIntervalMm)).toBeGreaterThan(50);
    // The interval itself, being a difference at one field, barely moves — which
    // is what makes the offset a reference error and not a measurement error.
    expect(
      Math.abs(
        coarse.foci[0]!.astigmaticIntervalMm / fine.foci[0]!.astigmaticIntervalMm - 1,
      ),
    ).toBeLessThan(1e-2);
  });

  it("refuses the conjugate and the stop placement it has not been pinned for", () => {
    const finite: OpticalSystem = { ...system(0.1), conjugate: { kind: "finite", distance: 5000 } };
    expect(() => thirdOrderSags(finite, 0.1, LAM)).toThrow(/infinite conjugate/);
    expect(() => distortionProfile(finite, [0.1], LAM)).toThrow(/infinite conjugate/);
  });
});

describe("Distortion — the chief ray against its own paraxial height", () => {
  const profile = distortionProfile(system(0), FIELDS, LAM);
  const efl = systemProperties(achromat.prescription, LAM).efl;

  it("has a paraxial reference that IS f·tanθ for a stop at the front vertex", () => {
    // A construction check on the reference: with the entrance pupil at surface 0
    // the paraxial chief ray's image height is the rectilinear one, so a broken
    // trace would show up here before it could hide in the departure.
    for (const s of profile.samples) {
      const ftan = efl * Math.tan((s.fieldValueDeg * Math.PI) / 180);
      expect(Math.abs(s.paraxialHeightMm / ftan - 1)).toBeLessThan(1e-9);
    }
  });

  it("is BARREL — the direction a stop ahead of a positive lens must give", () => {
    for (const s of profile.samples) expect(s.relative).toBeLessThan(0);
  });

  it("is cubic in field: the relative departure grows ×4.00 per doubling", () => {
    for (let i = 1; i < profile.samples.length; i++) {
      const r = profile.samples[i]!.relative / profile.samples[i - 1]!.relative;
      expect(Math.abs(r / 4 - 1)).toBeLessThan(1e-3);
    }
  });

  it("matches S_V/(2n′u′) — the sums and the trace, from disjoint machinery", () => {
    for (const s of profile.samples) {
      const traced = s.tracedHeightMm - s.paraxialHeightMm;
      const predicted = thirdOrderDistortionMm(system(s.fieldValueDeg), s.fieldValueDeg, LAM);
      // 1e-6 at the small fields, 4.6e-4 by 1.6° as fifth order arrives.
      expect(Math.abs(traced / predicted - 1)).toBeLessThan(1e-3);
    }
    // The tight end quoted on its own, so the fifth-order growth cannot hide
    // inside a tolerance chosen for the loose end.
    const s = profile.samples[2]!;
    const traced = s.tracedHeightMm - s.paraxialHeightMm;
    expect(
      Math.abs(traced / thirdOrderDistortionMm(system(s.fieldValueDeg), s.fieldValueDeg, LAM) - 1),
    ).toBeLessThan(1e-5);
  });

  it("is why the plane is the module's choice: the wrong one is 13× the signal", () => {
    // The refused alternative, measured. A chief ray is straight in image space,
    // so at a plane Δz from the paraxial one its height scales by ~(1 + Δz/f):
    // a constant relative error with NO field dependence, which is the one shape
    // distortion cannot have.
    const c = asCompiled(achromat.prescription);
    const wrongPlane = fieldSurfaces(system(0), [], LAM, { fanSamples: 41 }).axialZ;
    const relAt = (deg: number, z: number): number => {
      const s = system(deg);
      const tr = traceRay(achromat.prescription, chiefRay(s, pupils(s, LAM), deg, LAM));
      const im = toImageSpace(c, tr.ray!);
      const y = im.origin.x + im.dir.x * ((z - im.origin.z) / im.dir.z);
      return y / (efl * Math.tan((deg * Math.PI) / 180)) - 1;
    };
    const near = relAt(0.1, wrongPlane);
    const far = relAt(1.6, wrongPlane);
    expect(Math.abs(near)).toBeGreaterThan(3e-5);
    // Over a 16× span of field the lever moves 7% — and the 7% is the real cubic
    // term riding on top of it, not a field dependence of the lever. Against that,
    // the same span multiplies the real distortion by 256: a reading dominated by
    // the lever is nearly flat where the physics is steep, which is exactly how a
    // wrong plane makes distortion look absent.
    expect(Math.abs(far / near - 1)).toBeLessThan(0.1);
    const trueGrowth =
      profile.samples[profile.samples.length - 1]!.relative / profile.samples[3]!.relative;
    expect(trueGrowth).toBeGreaterThan(250);
    expect(Math.abs(near / profile.samples[profile.samples.length - 1]!.relative)).toBeGreaterThan(10);
  });
});
