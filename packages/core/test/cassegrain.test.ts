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
import { cassegrain } from "../src/designs/cassegrain";

/**
 * Rungs for the classical Cassegrain preset (docs/VALIDATION.md § 5e).
 *
 * A classical Cassegrain is a paraboloidal primary and a convex hyperboloidal
 * secondary whose near focus sits on the primary's focus. That confocal pairing
 * makes it stigmatic on axis *exactly* — the strongest external number there is,
 * needing no design table — and its coma is precisely that of a paraboloid of
 * the same system focal ratio, which is the cross-validation the coma block
 * leans on. It is authored on ONE axis (`unfolded`), so it needs no new trace
 * machinery: the two-curved-mirror trace is already pinned against the mirror
 * equation in compile.test.ts.
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

/** The equivalent prime-focus paraboloid: focal length f, aperture D. */
function paraboloid(f: number, D: number): Prescription {
  return {
    surfaces: [
      { kind: "reflect", curvature: -1 / (2 * f), conic: -1, semiAperture: D / 2, thickness: -f, isStop: true },
    ],
  };
}

describe("classical Cassegrain geometry", () => {
  const D = 200;
  const scope = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });

  it("has the system focal length its focal ratio names, and reports it paraxially", () => {
    expect(scope.focalLengthMm).toBe(D * 12);
    expect(scope.primaryFocalLengthMm).toBe(D * 4);
    // Two mirrors, so the paraxial EFL comes back positive; its magnitude is
    // m·f₁ = D·F, and the magnification is the ratio of the two focal ratios.
    expect(systemProperties(scope.prescription, LAM).efl).toBeCloseTo(2400, 4);
    expect(scope.secondaryMagnification).toBeCloseTo(3, 12); // F/F₁ = 12/4
  });

  it("derives the secondary from the confocal layout, in closed form", () => {
    const f1 = 800;
    const m = 3;
    const b = 250;
    const d = (m * f1 - b) / (m + 1);
    const s1 = f1 - d;
    expect(scope.primarySeparationMm).toBeCloseTo(d, 9); // 537.5
    expect(scope.secondaryRadiusMm).toBeCloseTo((2 * m * s1) / (m - 1), 9); // 787.5
    expect(scope.secondaryConic).toBeCloseTo(-(((m + 1) / (m - 1)) ** 2), 12); // −4, a hyperboloid
  });

  it("reports the obstruction the secondary projects onto the pupil", () => {
    // The converging beam has shrunk to s₁/f₁ of the aperture radius where the
    // secondary intercepts it, so that fraction is the central obstruction.
    const s1 = scope.primaryFocalLengthMm - scope.primarySeparationMm;
    expect(scope.obstruction).toBeCloseTo(s1 / scope.primaryFocalLengthMm, 12);
    expect(scope.obstruction).toBeCloseTo(0.3281, 3);
  });

  it("brings focus out the back, b behind the primary vertex", () => {
    // The Cassegrain's defining payoff — an accessible focus behind the primary,
    // reached by folding the beam back and forward on one axis. A near-axis ray
    // crosses at exactly z = b past the primary vertex (which sits at z = 0).
    const res = traceRay(scope.prescription, makeRay(vec3(1, 0, -50), vec3(0, 0, 1), LAM));
    expect(res.status).toBe("ok");
    const r = res.ray!;
    const crossZ = r.origin.z + (-r.origin.x / r.dir.x) * r.dir.z;
    expect(crossZ).toBeCloseTo(scope.backFocusMm, 6);
  });

  it("refuses a system faster than its primary, and an oversize back focus", () => {
    expect(() => cassegrain({ apertureMm: 200, focalRatio: 4, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    expect(() => cassegrain({ apertureMm: 200, focalRatio: 3, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    // m·f₁ = 3·800 = 2400; a back focus past that pushes the secondary through
    // the primary.
    expect(() =>
      cassegrain({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 3000 }),
    ).toThrow(/back focus/);
  });
});

/**
 * Rung: on axis, two confocal conics are perfect.
 *
 * The external number is exact and needs no table: a paraboloid brings an
 * axial point at infinity to its focus with zero error, and a hyperboloid
 * images one of its foci onto the other with zero error, so placing the
 * hyperboloid's near focus on the paraboloid's focus makes the pair stigmatic —
 * the wavefront error is zero and the PSF is the Airy pattern of the (annular)
 * aperture. A spherical secondary is the negative control that proves the conic
 * is doing the work rather than the layout alone.
 */
describe("classical Cassegrain on axis", () => {
  const D = 200;
  const scope = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
  const s = system(scope.prescription, D);

  it("has no wavefront error at all", () => {
    const map = opdMap(s, 0, LAM, pupilGrid(21));
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeLessThan(1e-6);
  });

  it("is diffraction-limited: Strehl 1", () => {
    const p = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    expect(p.strehl).toBeCloseTo(1, 6);
  });

  it("the confocal formula is stigmatic across magnifications, not just at m=3", () => {
    // A wrong secondary conic k₂ at another magnification injects rotationally
    // symmetric SPHERICAL aberration, which the j=8 coma rungs are blind to — so
    // the k₂ = −((m+1)/(m−1))² formula is only pinned where an on-axis wavefront
    // rung actually runs. Cover m = 2, 3, 4 (and a second route to m = 4).
    for (const [F1, F] of [
      [4, 8], // m = 2
      [4, 12], // m = 3
      [4, 16], // m = 4
      [3, 12], // m = 4, different primary
    ] as const) {
      const sc = cassegrain({ apertureMm: D, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * D });
      const map = opdMap(system(sc.prescription, D), 0, LAM, pupilGrid(21));
      expect(map.lost).toBe(0);
      expect(map.rmsWaves).toBeLessThan(1e-6);
    }
  });

  it("is NOT stigmatic with a spherical secondary (the conic earns its keep)", () => {
    const spherical: Prescription = {
      ...scope.prescription,
      surfaces: [scope.prescription.surfaces[0]!, { ...scope.prescription.surfaces[1]!, conic: 0 }],
    };
    const ss = system(spherical, D);
    const focus = bestFocus(ss, "minRmsWavefront", { pupilSamples: 21 });
    // Even at its own best focus the spherical version carries a third of a wave;
    // the hyperboloid is at 1e-10. The conic is the difference.
    expect(opdMap(withFocus(ss, focus.offsetFromLastVertex), 0, LAM, pupilGrid(21)).rmsWaves).toBeGreaterThan(0.1);
    expect(psf(ss, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 }).strehl).toBeLessThan(0.1);
  });

  it("passes the whole beam, which a secondary cut to the paraxial cone would not", () => {
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);

    // The marginal ray leaves the paraboloid rim at the sag plane, so the true
    // footprint is a hair wider than the paraxial cone (D/2)·s₁/f₁; cut the
    // secondary to that paraxial figure and the pupil's own rim clips.
    const s1 = scope.primaryFocalLengthMm - scope.primarySeparationMm;
    const paraxialCone = (D / 2) * (s1 / scope.primaryFocalLengthMm);
    const shaved: Prescription = {
      ...scope.prescription,
      surfaces: [scope.prescription.surfaces[0]!, { ...scope.prescription.surfaces[1]!, semiAperture: paraxialCone }],
    };
    expect(opdMap(system(shaved, D), 0, LAM, pupilGrid(21)).lost).toBeGreaterThan(0);
  });

  it("keeps the obstruction out of the geometry and in the pupil function", () => {
    // The secondary is not traced as a blocker, so an obstructed PSF must differ
    // from an unobstructed one only because the pupil function was told to.
    const clear = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    const blocked = psf(s, 0, LAM, {
      traceSamples: 13,
      pupilSamples: 32,
      padFactor: 2,
      obstruction: scope.obstruction,
    });
    expect(blocked.energy).toBeLessThan(clear.energy);
    expect(blocked.energy / clear.energy).toBeCloseTo(1 - scope.obstruction ** 2, 2);
  });

  it("puts a star at ≈ f·tan(θ) — with a real distortion residual — at its azimuth", () => {
    // Plate scale is the system focal length, but only APPROXIMATELY f·tan θ: a
    // Cassegrain has distortion (unlike the single-paraboloid Newtonian, whose
    // rung holds to machine precision), so the image height departs by a cubic
    // term that grows with angle — 4e-5 relative at 0.3°. Pinned as ≈, the way
    // the field-render ladder (§ 3c) pins it, because the gap is the physics.
    const focused = withFocus(s, bestFocus(s, "paraxial").offsetFromLastVertex);
    const f = scope.focalLengthMm;
    for (const deg of [0.1, 0.3]) {
      const p = imagePointOf(focused, deg, 0, LAM);
      const ideal = f * Math.tan((deg * Math.PI) / 180);
      expect(Math.abs(Math.hypot(p.x, p.y) / ideal - 1)).toBeLessThan(2e-3);
    }
    // The azimuth is exact regardless of distortion (which is radial), so a
    // vertical star must land on +y with no x — this is what catches the image
    // arriving rotated.
    const up = imagePointOf(focused, 0.2, Math.PI / 2, LAM);
    expect(up.x).toBeCloseTo(0, 6);
    expect(Math.abs(up.y / (f * Math.tan((0.2 * Math.PI) / 180)) - 1)).toBeLessThan(2e-3);
  });
});

/**
 * Rung: classical Cassegrain coma, against third-order theory AND against the
 * equivalent paraboloid.
 *
 * The classical Cassegrain corrects spherical aberration but not coma, and the
 * textbook result is exact and unusually clean: its third-order coma is
 * identical to that of a single paraboloid working at the SYSTEM focal ratio.
 * So the strong rung is a cross-validation — the traced coma equals the traced
 * coma of a prime-focus paraboloid of the system focal length, to four figures —
 * which pins it against the already-validated single-mirror coma rather than
 * against a formula alone. The third-order comparison is the same
 * `A = θ·D/(32·F²)` the Newtonian uses, with F the system focal ratio, and it
 * sits just under 1 for the same reason: the trace carries the higher-order coma
 * the theory omits, and the shortfall shrinks as the system slows.
 */
describe("classical Cassegrain coma", () => {
  const D = 200;

  const comaOf = (s: OpticalSystem, deg: number): number => {
    const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const map = opdMap(withFocus(s, focus.offsetFromLastVertex), deg, LAM, pupilGrid(33));
    return coefficient(fitZernike(map.samples, 28), 8);
  };

  const cassComa = (F1: number, F: number, deg: number, aperture = D): number => {
    const scope = cassegrain({ apertureMm: aperture, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * aperture });
    return comaOf(system(scope.prescription, aperture), deg);
  };

  const thirdOrder = (aperture: number, F: number, deg: number): number => {
    const theta = (deg * Math.PI) / 180;
    return (((theta * aperture) / (32 * F * F)) * 1e6) / LAM / Math.sqrt(72);
  };

  it("equals the coma of a paraboloid of the same system focal length", () => {
    for (const [F1, F] of [
      [4, 12],
      [3, 8],
      [4, 16],
    ] as const) {
      const scope = cassegrain({ apertureMm: D, focalRatio: F, primaryFocalRatio: F1, backFocusMm: 0.25 * D });
      const cass = comaOf(system(scope.prescription, D), 0.1);
      const para = comaOf(system(paraboloid(scope.focalLengthMm, D), D), 0.1);
      expect(cass / para).toBeCloseTo(1, 3);
    }
  });

  it("matches the third-order coefficient at the system focal ratio", () => {
    for (const [F1, F, deg] of [
      [4, 12, 0.1],
      [3, 8, 0.1],
      [4, 16, 0.2],
    ] as const) {
      const traced = Math.abs(cassComa(F1, F, deg));
      const theory = thirdOrder(D, F, deg);
      // Just below the third-order line, as the Newtonian is: the residual is
      // the higher-order coma the theory drops, not a scaling error.
      expect(traced / theory).toBeGreaterThan(0.99);
      expect(traced / theory).toBeLessThan(1.0);
    }
  });

  it("grows in proportion to field angle", () => {
    // Pinned in the small-angle regime (0.05° → 0.1°) where the linear coma
    // dominates: 1.9999, tight. The project's discipline is to tighten the
    // regime rather than widen the band — and the Cassegrain earns it, because
    // its fast (F/4) primary carries a genuine higher-order field term that a
    // 4× lever would fold in: measured, the coma is 3.994× (not 4×) from 0.1° to
    // 0.4°, and the equivalent-paraboloid cross-check drifts from 0.99991 at 0.1°
    // to 0.99857 at 0.4° in lockstep — the sublinearity is real, so it is kept
    // out of the linearity rung rather than absorbed into a loose tolerance.
    expect(cassComa(4, 12, 0.1) / cassComa(4, 12, 0.05)).toBeCloseTo(2, 3);
  });

  it("falls as 1/F² — the same reason a fast scope has a small usable field", () => {
    // Same primary, two system focal ratios: doubling F quarters the coma.
    expect(cassComa(4, 8, 0.2) / cassComa(4, 16, 0.2)).toBeCloseTo(4, 1);
  });

  it("is proportional to aperture at fixed focal ratios", () => {
    expect(cassComa(4, 12, 0.2, 200) / cassComa(4, 12, 0.2, 100)).toBeCloseTo(2, 2);
  });
});
