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
import { getMedium } from "../src/materials/catalog";
import { SurfaceSpec, Prescription } from "../src/trace/prescription";
import { schmidt } from "../src/designs/schmidt";

/**
 * Rungs for the Schmidt camera preset (docs/VALIDATION.md § 5g).
 *
 * A Schmidt camera is a spherical mirror with an aspheric corrector plate at its
 * centre of curvature. It is the first preset to use the engine's even-asphere
 * path for PHYSICS rather than a round-trip geometry check, and the corrector's
 * fourth-order figure is the external number it pins:
 *
 *     A₄ = −1/(4·(n−1)·R³)      (Rutten & van Venrooij; Schroeder)
 *
 * The pin has three faces. (1) The reported A₄ equals that closed form, computed
 * from the scalars n and R alone. (2) With it, the sphere's spherical aberration
 * is nulled to third order — the on-axis wavefront collapses from ~0.84 waves
 * (bare sphere) to a few hundredths, diffraction-limited, and the WRONG sign
 * roughly doubles the bare error (the sign is load-bearing). (3) The stop at the
 * centre of curvature makes it an anastigmat: off-axis coma and astigmatism are
 * three to four orders below an equal-f/D paraboloid's, which is the Schmidt's
 * whole reason to exist. Unlike the confocal Cassegrain it is only 3rd-order
 * corrected, so the on-axis rung is "diffraction-limited and a large factor
 * better than the bare sphere", never "Strehl = 1".
 */

const LAM = 550;

function system(p: Prescription, D: number, deg = 0): OpticalSystem {
  return {
    prescription: p,
    aperture: { kind: "stopRadius", value: D / 2 },
    field: { kind: "angle", values: [deg] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** The equivalent prime-focus paraboloid: focal length f, aperture D, stop at the mirror. */
function paraboloid(f: number, D: number): Prescription {
  return {
    surfaces: [
      { kind: "reflect", curvature: -1 / (2 * f), conic: -1, semiAperture: D / 2, thickness: -f, isStop: true },
    ],
  };
}

/** Rebuild a Schmidt prescription with a different corrector front figure. */
function withCorrector(p: Prescription, coeffs: readonly number[] | null): Prescription {
  const front = { ...p.surfaces[0]! };
  if (coeffs === null) delete (front as { asphereCoeffs?: readonly number[] }).asphereCoeffs;
  else (front as { asphereCoeffs?: readonly number[] }).asphereCoeffs = coeffs;
  return { ...p, surfaces: [front, ...p.surfaces.slice(1)] as SurfaceSpec[] };
}

/** On-axis RMS wavefront error at best focus (waves). */
const onAxisRms = (s: OpticalSystem): number => {
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAM, pupilGrid(21)).rmsWaves;
};

describe("Schmidt camera geometry", () => {
  const D = 200;
  const F = 4;
  const sc = schmidt({ apertureMm: D, focalRatio: F });

  it("has f = R/2 = D·F, and a mirror radius twice that", () => {
    expect(sc.focalLengthMm).toBe(D * F); // 800
    expect(sc.mirrorRadiusMm).toBe(2 * D * F); // 1600
    // One mirror, so the paraxial EFL comes back negative; its magnitude is f.
    expect(systemProperties(sc.prescription, LAM).efl).toBeCloseTo(-(D * F), 4);
  });

  it("figures the corrector to the closed form A₄ = −1/(4(n−1)R³)", () => {
    // The external number, computed from scalars — n at the design wavelength
    // and the mirror radius — with no reference to the engine's own sag.
    const n = getMedium("FUSED-SILICA").n(LAM);
    const R = sc.mirrorRadiusMm;
    expect(sc.correctorIndex).toBe(n);
    expect(sc.designWavelengthNm).toBe(550);
    expect(sc.correctorMedium).toBe("FUSED-SILICA");
    expect(sc.correctorA4).toBeCloseTo(-1 / (4 * (n - 1) * R ** 3), 18);
    expect(sc.correctorA4).toBeLessThan(0); // thickest at the rim
  });

  it("forms the image at the prime focus, R/2 in front of the mirror", () => {
    // A near-axis ray crosses the axis at z = R/2 (the mirror vertex is at z = R,
    // the corrector at z = 0): the collimated beam converges to the sphere's
    // focal length. The corrector plate is in the path and barely moves it.
    const res = traceRay(sc.prescription, makeRay(vec3(1, 0, -50), vec3(0, 0, 1), LAM));
    expect(res.status).toBe("ok");
    const r = res.ray!;
    const crossZ = r.origin.z + (-r.origin.x / r.dir.x) * r.dir.z;
    expect(crossZ).toBeCloseTo(sc.mirrorRadiusMm / 2, 6);
  });

  it("refuses impossible geometry and an unknown corrector glass", () => {
    expect(() => schmidt({ apertureMm: -1, focalRatio: 4 })).toThrow(/positive/);
    expect(() => schmidt({ apertureMm: 200, focalRatio: 0 })).toThrow(/positive/);
    // A plate thicker than the mirror radius has the glass swallow the mirror.
    expect(() => schmidt({ apertureMm: 200, focalRatio: 4, plateThicknessMm: 5000 })).toThrow(/thickness/);
    expect(() => schmidt({ apertureMm: 200, focalRatio: 4, correctorMedium: "UNOBTAINIUM" })).toThrow(/unknown medium/);
  });
});

/**
 * Rung: on axis, the corrector nulls the sphere's spherical aberration.
 *
 * A spherical mirror carries r⁴/(4R³) of spherical aberration against the
 * paraboloid; the corrector's (n−1)·A₄·r⁴ figure cancels it to third order. So
 * the wavefront collapses from a badly-aberrated bare sphere to diffraction-
 * limited. The negative controls prove the figure earns its keep: removing it
 * (a flat plate) restores the full sphere error, and FLIPPING its sign roughly
 * doubles that error — the corrector then adds its aberration to the mirror's
 * instead of subtracting it. A 5th-order residual remains (this is not the
 * Cassegrain's exact confocal null), so the bar is "diffraction-limited", not 1.
 */
describe("Schmidt camera on axis", () => {
  const D = 200;
  const sc = schmidt({ apertureMm: D, focalRatio: 4 });
  const s = system(sc.prescription, D);
  const corrected = onAxisRms(s);
  const bare = onAxisRms(system(withCorrector(sc.prescription, null), D));

  it("passes the whole beam — nothing vignettes on axis", () => {
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);
  });

  it("is diffraction-limited, and a large factor better than the bare sphere", () => {
    // ~0.008 waves corrected vs ~0.84 bare: the corrector buys ~100×, landing
    // well inside the Maréchal λ/14 ≈ 0.071-wave diffraction limit.
    expect(bare).toBeGreaterThan(0.5);
    expect(corrected).toBeLessThan(0.02);
    expect(bare / corrected).toBeGreaterThan(50);
    expect(psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 }).strehl).toBeGreaterThan(0.95);
  });

  it("needs the corrector's SIGN, not just its magnitude", () => {
    // Flip A₄: the corrector now adds r⁴/(4R³) on top of the mirror's, so the
    // error is ≈ twice the bare sphere's — the sharpest proof the sign is real.
    const flipped = onAxisRms(system(withCorrector(sc.prescription, [-sc.correctorA4]), D));
    expect(flipped / bare).toBeCloseTo(2, 1);
    expect(flipped / corrected).toBeGreaterThan(10);
  });
});

/**
 * Rung: the Schmidt is an anastigmat — its wide field is the point.
 *
 * With the stop at the mirror's centre of curvature every field angle sees the
 * sphere down a radius, so third-order coma and astigmatism vanish by symmetry.
 * The cross-check is a paraboloid of the SAME system focal ratio with its stop
 * at the mirror (a prime-focus reflector): it carries the full coma and
 * astigmatism of a fast mirror, and the Schmidt's are three to four orders of
 * magnitude smaller. Measured by Zernike coefficient at best focus, so the
 * Schmidt's curved focal surface (a defocus term, j=4) does not enter.
 */
describe("Schmidt camera off axis", () => {
  const D = 200;
  const sc = schmidt({ apertureMm: D, focalRatio: 4 });

  const comaAstig = (sys: OpticalSystem, deg: number) => {
    const focus = bestFocus(sys, "minRmsWavefront", { pupilSamples: 21, fieldValue: deg });
    const map = opdMap(withFocus(sys, focus.offsetFromLastVertex), deg, LAM, pupilGrid(33));
    const fit = fitZernike(map.samples, 28);
    return {
      coma: Math.abs(coefficient(fit, 8)),
      astig: Math.hypot(coefficient(fit, 5), coefficient(fit, 6)),
      lost: map.lost,
    };
  };

  it("nulls coma and astigmatism a paraboloid of the same focal ratio has in full", () => {
    for (const deg of [0.3, 0.5]) {
      const sch = comaAstig(system(sc.prescription, D, deg), deg);
      const par = comaAstig(system(paraboloid(sc.focalLengthMm, D), D, deg), deg);

      expect(sch.lost).toBe(0); // the oversized mirror clears the walked pencil

      // The paraboloid has real coma and astigmatism; the Schmidt has ~none.
      expect(par.coma).toBeGreaterThan(0.4);
      expect(par.astig).toBeGreaterThan(0.06);
      expect(sch.coma).toBeLessThan(0.001);
      expect(sch.astig).toBeLessThan(0.001);
      // Both aberrations suppressed by at least two orders of magnitude.
      expect(sch.coma / par.coma).toBeLessThan(0.01);
      expect(sch.astig / par.astig).toBeLessThan(0.01);
    }
  });
});

/**
 * Rung: spherochromatism — the price of a refractive corrector.
 *
 * The corrector is figured for one wavelength; away from it (n−1) drifts, so the
 * spherical-aberration cancellation is imperfect. The residual is exactly the
 * corrector's own r⁴ figure scaled by the index change: a PURE primary-spherical
 * term, (n(λ)−n(550))·A₄·r⁴, and therefore refocus-invariant. Its Zernike j=11
 * projection is the closed form
 *
 *     Δc₁₁(λ) = (n(λ)−n(550))·A₄·(D/2)⁴ / (6√5) / λ        [waves]
 *
 * (ρ⁴ = Z₁₁/(6√5) + defocus + piston, and best-focus removes only the defocus).
 * Pinned on a slow (f/10) camera, where the 5th-order MONOCHROMATIC residual —
 * which also lands on j=11 and scales as 1/F⁵ — has shrunk to a few percent, so
 * the traced chromatic shift sits just under the pure-3rd-order line, the way
 * the Cassegrain's traced coma sits just under its third-order coefficient.
 */
describe("Schmidt camera spherochromatism", () => {
  const D = 200;
  const sc = schmidt({ apertureMm: D, focalRatio: 10 });
  const s = system(sc.prescription, D);
  const n = (lam: number) => getMedium("FUSED-SILICA").n(lam);

  const j11At = (lam: number): number => {
    const ss: OpticalSystem = { ...s, wavelengths: [{ nm: lam, weight: 1 }] };
    const focus = bestFocus(ss, "minRmsWavefront", { pupilSamples: 21, wavelengthNm: lam });
    const map = opdMap(withFocus(ss, focus.offsetFromLastVertex), 0, lam, pupilGrid(21));
    return coefficient(fitZernike(map.samples, 15), 11);
  };
  const predictDelta = (lam: number): number =>
    ((n(lam) - n(550)) * sc.correctorA4 * (D / 2) ** 4) / (6 * Math.sqrt(5)) / (lam * 1e-6);

  it("is corrected essentially perfectly at the design wavelength on a slow camera", () => {
    // At f/10 the 5th-order residual has all but vanished (< 1e-3 waves), which
    // is the on-axis proof that A₄ nulls the THIRD-order term exactly — what is
    // left at f/4 was pure 5th-order.
    expect(onAxisRms(s)).toBeLessThan(1e-3);
  });

  it("shifts the primary-spherical term with wavelength, by the corrector's own r⁴ figure", () => {
    const j550 = j11At(550);
    for (const lam of [450, 500, 600, 650]) {
      const measured = j11At(lam) - j550;
      const ratio = measured / predictDelta(lam);
      // Opposite in the engine's OPD-sign convention, and just under unity in
      // magnitude because the trace carries the 5th-order the closed form omits.
      expect(ratio).toBeLessThan(0);
      expect(Math.abs(ratio)).toBeGreaterThan(0.9);
      expect(Math.abs(ratio)).toBeLessThan(1.0);
    }
  });

  it("moves monotonically across the visible band", () => {
    const j = [450, 500, 550, 600, 650].map(j11At);
    for (let i = 1; i < j.length; i++) expect(j[i]!).toBeLessThan(j[i - 1]!);
  });
});
