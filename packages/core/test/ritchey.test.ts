import { describe, it, expect } from "vitest";
import { vec3 } from "../src/math/vec3";
import { traceRay, makeRay } from "../src/trace";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, coefficient } from "../src/wave/zernike";
import { psf } from "../src/wave/psf";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { imagePointOf } from "../src/imaging/scene";
import { Prescription } from "../src/trace/prescription";
import { ritcheyChretien } from "../src/designs/ritchey";
import { cassegrain } from "../src/designs/cassegrain";

/**
 * Rungs for the Ritchey-Chrétien preset (docs/VALIDATION.md § 5f).
 *
 * An RC is a Cassegrain-form telescope with BOTH mirrors hyperboloidal, the
 * conics chosen to make it *aplanatic* — free of third-order coma AND spherical
 * aberration. Its layout is identical to the classical Cassegrain (§ 5e): the
 * two presets share `twoMirrorLayout` and differ only in the two conics, which
 * is the textbook fact this suite pins from both sides — the layout is shown
 * equal to the Cassegrain's, and the conics shown to be the published closed
 * form. The headline rung is the coma null: at a field angle where the classical
 * Cassegrain shows full third-order coma, the RC's is orders of magnitude below,
 * while its astigmatism is untouched — proving the correction is coma-specific.
 */

const LAM = 550;

function system(p: Prescription, D: number): OpticalSystem {
  return {
    prescription: p,
    aperture: { kind: "stopRadius", value: D / 2 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

const comaOf = (s: OpticalSystem, deg: number): number => {
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  const map = opdMap(withFocus(s, focus.offsetFromLastVertex), deg, LAM, pupilGrid(33));
  return coefficient(fitZernike(map.samples, 28), 8);
};

/** RMS of the two astigmatism terms (Noll j = 5, 6), at best focus. */
const astigOf = (s: OpticalSystem, deg: number): number => {
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  const z = fitZernike(opdMap(withFocus(s, focus.offsetFromLastVertex), deg, LAM, pupilGrid(33)).samples, 28);
  return Math.hypot(coefficient(z, 5), coefficient(z, 6));
};

/** Best-focus on-axis RMS wavefront error (waves). */
const onAxisRms = (s: OpticalSystem): number => {
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAM, pupilGrid(21)).rmsWaves;
};

describe("Ritchey-Chrétien geometry", () => {
  const D = 200;
  const rc = ritcheyChretien({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });

  it("has the system focal length its focal ratio names, and reports it paraxially", () => {
    expect(rc.focalLengthMm).toBe(D * 12);
    expect(rc.primaryFocalLengthMm).toBe(D * 4);
    expect(systemProperties(rc.prescription, LAM).efl).toBeCloseTo(2400, 4);
    expect(rc.secondaryMagnification).toBeCloseTo(3, 12); // F/F₁ = 12/4
  });

  it("shares the classical Cassegrain's layout exactly — only the conics differ", () => {
    // The load-bearing anti-drift rung: an RC and a classical Cassegrain built
    // from the same spec are the same paraxial instrument (identical radii,
    // separations, obstruction and secondary footprint), because they share
    // `twoMirrorLayout`. What changes is ONLY the two conics — the textbook fact
    // the whole preset rests on.
    const c = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
    expect(rc.focalLengthMm).toBe(c.focalLengthMm);
    expect(rc.primarySeparationMm).toBe(c.primarySeparationMm);
    expect(rc.secondaryRadiusMm).toBe(c.secondaryRadiusMm);
    expect(rc.obstruction).toBe(c.obstruction);
    // Same primary curvature and same secondary clear-aperture footprint.
    expect(rc.prescription.surfaces[0]!.curvature).toBe(c.prescription.surfaces[0]!.curvature);
    expect(rc.prescription.surfaces[1]!.semiAperture).toBe(c.prescription.surfaces[1]!.semiAperture);
    // But the conics genuinely differ: the RC primary is a hyperboloid (not the
    // Cassegrain's paraboloid), and its secondary is a stronger hyperboloid.
    expect(rc.primaryConic).not.toBe(-1);
    expect(rc.secondaryConic).not.toBeCloseTo(c.secondaryConic, 3);
  });

  it("has the two conics the published aplanatic closed form gives — both hyperboloids", () => {
    // Wikipedia, "Ritchey–Chrétien telescope":
    //   K₁ = −1 − (2/m³)·(B/D),  K₂ = −1 − (2/(m−1)³)·[m(2m−1) + B/D]
    // where B is the secondary→focus distance s₂ = d + b (NOT the primary back
    // focus b) and D the mirror separation d. Swapping s₂ for b corrupts the
    // whole design and still typechecks, so the exact number is pinned here.
    const m = 3;
    const d = 537.5;
    const s2 = d + 250; // = 787.5
    const k1 = -1 - (2 / m ** 3) * (s2 / d);
    const k2 = -1 - (2 / (m - 1) ** 3) * (m * (2 * m - 1) + s2 / d);
    expect(rc.primaryConic).toBeCloseTo(k1, 9); // ≈ −1.10853
    expect(rc.secondaryConic).toBeCloseTo(k2, 9); // ≈ −5.11628
    expect(rc.primaryConic).toBeLessThan(-1); // a hyperboloid, just past parabolic
    expect(rc.secondaryConic).toBeLessThan(-1);
    // The RC secondary is a STRONGER hyperboloid than the classical Cassegrain's
    // (−4 at m = 3): that extra figuring is what buys the coma correction.
    expect(rc.secondaryConic).toBeLessThan(-(((m + 1) / (m - 1)) ** 2));
  });

  it("brings focus out the back, b behind the primary vertex", () => {
    const res = traceRay(rc.prescription, makeRay(vec3(1, 0, -50), vec3(0, 0, 1), LAM));
    expect(res.status).toBe("ok");
    const r = res.ray!;
    const crossZ = r.origin.z + (-r.origin.x / r.dir.x) * r.dir.z;
    expect(crossZ).toBeCloseTo(rc.backFocusMm, 6);
  });

  it("refuses a system faster than its primary, and an oversize back focus", () => {
    expect(() => ritcheyChretien({ apertureMm: 200, focalRatio: 4, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    expect(() =>
      ritcheyChretien({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 3000 }),
    ).toThrow(/back focus/);
  });
});

/**
 * Rung: on axis the RC corrects spherical aberration to THIRD ORDER only.
 *
 * This is where the RC differs from the classical Cassegrain, and the difference
 * is pinned rather than glossed. The confocal Cassegrain is stigmatic to all
 * orders (~1e-10 waves); the RC balances third-order spherical to zero but keeps
 * a fifth-order residual, so on axis it is diffraction-limited yet distinctly
 * nonzero — orders of magnitude above the Cassegrain — and that residual falls
 * steeply as the primary is slowed, the signature of a higher-order term.
 */
describe("Ritchey-Chrétien on axis", () => {
  const D = 200;
  const rc = ritcheyChretien({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
  const s = system(rc.prescription, D);

  it("is diffraction-limited but NOT exactly stigmatic, unlike the confocal Cassegrain", () => {
    const rcRms = onAxisRms(s); // ≈ 4.5e-5 waves
    expect(rcRms).toBeGreaterThan(1e-6); // genuinely nonzero: only 3rd order is nulled
    expect(rcRms).toBeLessThan(1e-3); // yet far inside the Maréchal diffraction limit
    expect(psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 }).strehl).toBeGreaterThan(0.999);

    // The classical Cassegrain, same spec, is exactly stigmatic — its confocal
    // conics leave ~1e-10 (pinned in § 5e). Through this best-focus search path
    // it reads ~1e-8, the search's own numerical floor; the RC sits at 4.5e-5,
    // three orders above it. The price of correcting coma is a fifth-order
    // spherical residual on axis that the confocal design does not carry.
    const c = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
    const cassRms = onAxisRms(system(c.prescription, D));
    expect(cassRms).toBeLessThan(1e-7);
    expect(rcRms / cassRms).toBeGreaterThan(1e3);
  });

  it("carries a FIFTH-order residual: it falls steeply as the primary slows", () => {
    // At fixed magnification (m = 3), slow the primary from f/4 to f/8. A
    // third-order defect would be nulled at both; a fifth-order one drops as a
    // steep power of the marginal ray angle. Measured ~34× for a 2× slowdown.
    const fast = onAxisRms(system(ritcheyChretien({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 0.25 * D }).prescription, D));
    const slow = onAxisRms(system(ritcheyChretien({ apertureMm: D, focalRatio: 24, primaryFocalRatio: 8, backFocusMm: 0.25 * D }).prescription, D));
    expect(fast / slow).toBeGreaterThan(20);
  });

  it("passes the whole beam; a secondary cut to the paraxial cone would clip it", () => {
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);
    const s1 = rc.primaryFocalLengthMm - rc.primarySeparationMm;
    const paraxialCone = (D / 2) * (s1 / rc.primaryFocalLengthMm);
    const shaved: Prescription = {
      ...rc.prescription,
      surfaces: [rc.prescription.surfaces[0]!, { ...rc.prescription.surfaces[1]!, semiAperture: paraxialCone }],
    };
    expect(opdMap(system(shaved, D), 0, LAM, pupilGrid(21)).lost).toBeGreaterThan(0);
  });

  it("puts a star at ≈ f·tan(θ), with a distortion residual, at its azimuth", () => {
    const focused = withFocus(s, bestFocus(s, "paraxial").offsetFromLastVertex);
    const f = rc.focalLengthMm;
    for (const deg of [0.1, 0.3]) {
      const p = imagePointOf(focused, deg, 0, LAM);
      const ideal = f * Math.tan((deg * Math.PI) / 180);
      expect(Math.abs(Math.hypot(p.x, p.y) / ideal - 1)).toBeLessThan(2e-3);
    }
    const up = imagePointOf(focused, 0.2, Math.PI / 2, LAM);
    expect(up.x).toBeCloseTo(0, 6);
    expect(Math.abs(up.y / (f * Math.tan((0.2 * Math.PI) / 180)) - 1)).toBeLessThan(2e-3);
  });
});

/**
 * Rung: the RC is aplanatic — third-order coma is nulled.
 *
 * The headline external number. The classical Cassegrain and the RC have the
 * SAME geometry (same D, F, layout), so they carry the same third-order coma
 * budget — except the RC's conics zero it. So the traced RC coma is orders of
 * magnitude below both the classical Cassegrain's coma and the third-order
 * formula θ·D/(32·F²√72) at the system focal ratio (the same closed form the
 * Newtonian and Cassegrain use). The astigmatism negative control proves the
 * correction is coma-specific: it is untouched, ~equal to the Cassegrain's and
 * hundreds of times the RC's residual coma.
 */
describe("Ritchey-Chrétien is aplanatic (the coma null)", () => {
  const D = 200;

  const thirdOrder = (F: number, deg: number): number => {
    const theta = (deg * Math.PI) / 180;
    return (((theta * D) / (32 * F * F)) * 1e6) / LAM / Math.sqrt(72);
  };

  it("nulls coma: the RC's is a small fraction of the classical Cassegrain's, same D and F", () => {
    for (const [F1, F, deg] of [
      [4, 12, 0.1],
      [3, 8, 0.1],
      [4, 16, 0.2],
    ] as const) {
      const rc = ritcheyChretien({ apertureMm: D, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * D });
      const c = cassegrain({ apertureMm: D, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * D });
      const rcComa = Math.abs(comaOf(system(rc.prescription, D), deg));
      const cassComa = Math.abs(comaOf(system(c.prescription, D), deg));
      // Two-to-three orders down (measured 0.0013–0.0067). That the classical
      // sibling shows full coma on the identical geometry is what makes this the
      // aplanatic property and not merely a small number.
      expect(rcComa / cassComa).toBeLessThan(0.01);
      // …and below the third-order line itself: the RC has no third-order coma.
      expect(rcComa / thirdOrder(F, deg)).toBeLessThan(0.015);
    }
  });

  it("does NOT null astigmatism — the correction is coma-specific", () => {
    // The negative control that proves the RC targets coma rather than every
    // off-axis term. Its astigmatism is essentially the classical Cassegrain's
    // (the RC barely touches it) and hundreds of times its own residual coma.
    for (const [F1, F] of [
      [4, 12],
      [3, 8],
    ] as const) {
      const rc = ritcheyChretien({ apertureMm: D, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * D });
      const c = cassegrain({ apertureMm: D, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * D });
      const rcAstig = astigOf(system(rc.prescription, D), 0.3);
      const cassAstig = astigOf(system(c.prescription, D), 0.3);
      const rcComa = Math.abs(comaOf(system(rc.prescription, D), 0.3));
      expect(rcAstig / cassAstig).toBeGreaterThan(0.8);
      expect(rcAstig / cassAstig).toBeLessThan(1.5);
      expect(rcAstig / rcComa).toBeGreaterThan(50);
    }
  });
});
