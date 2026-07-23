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
import { schmidtCassegrain } from "../src/designs/schmidt-cassegrain";
import { cassegrain } from "../src/designs/cassegrain";

/**
 * Rungs for the Schmidt-Cassegrain preset (docs/VALIDATION.md § 5h).
 *
 * This is a *Schmidt-corrected Cassegrain*: a spherical primary + a Schmidt
 * corrector plate at its centre of curvature (nulling the sphere's spherical
 * aberration) + a convex confocal-hyperboloid secondary. It COMPOSES the two
 * units before it — the Schmidt camera's corrector figure (§ 5g) and the
 * Cassegrain-form layout + confocal secondary (§ 5e) — so most of it is already
 * pinned; these rungs pin what is genuinely new when they are combined.
 *
 * It is NOT the commercial all-spherical "compact SCT", whose corrector is an
 * optimised proprietary surface with no external number (recorded in
 * cassegrain.ts). Every number here is a closed form: the corrector figure is the
 * Schmidt A₄ referenced to the PRIMARY radius, and the secondary conic is the
 * classical Cassegrain's confocal hyperboloid, both reused verbatim.
 *
 * The pin has two genuinely-new faces, and they are exactly the two prices the
 * cheap spherical primary buys: (1) on axis it is diffraction-limited but NOT
 * exactly stigmatic — a fifth-order residual survives the third-order correction
 * (unlike the confocal Cassegrain's ~1e-10), falling steeply as the primary
 * slows; and (2) spherochromatism — the refractive corrector is figured for one
 * wavelength, so the correction drifts with colour, by the corrector's own r⁴
 * figure scaled by the index change. The anti-drift rung ties its mirror geometry
 * to the classical Cassegrain's shared layout so the two cannot diverge.
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

/** Rebuild an SCT prescription with a different corrector front figure. */
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

describe("Schmidt-Cassegrain geometry", () => {
  const D = 200;
  const sc = schmidtCassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });

  it("has the system focal length its focal ratio names, and reports it paraxially", () => {
    expect(sc.focalLengthMm).toBe(D * 12); // 2400
    expect(sc.primaryFocalLengthMm).toBe(D * 4); // 800
    expect(sc.primaryRadiusMm).toBe(2 * D * 4); // R₁ = 2f₁ = 1600
    // Two mirrors, so the paraxial EFL comes back positive; its magnitude is
    // m·f₁ = D·F, and the magnification is the ratio of the two focal ratios.
    expect(systemProperties(sc.prescription, LAM).efl).toBeCloseTo(2400, 4);
    expect(sc.secondaryMagnification).toBeCloseTo(3, 12); // F/F₁ = 12/4
  });

  it("figures the corrector to the Schmidt closed form A₄ = −1/(4(n−1)R₁³), on the PRIMARY radius", () => {
    // The external number, computed from scalars — n at the design wavelength and
    // the PRIMARY radius R₁ = 2f₁ — with no reference to the engine's own sag.
    const n = getMedium("FUSED-SILICA").n(LAM);
    const R1 = sc.primaryRadiusMm;
    expect(sc.correctorIndex).toBe(n);
    expect(sc.designWavelengthNm).toBe(550);
    expect(sc.correctorMedium).toBe("FUSED-SILICA");
    expect(sc.correctorA4).toBeCloseTo(-1 / (4 * (n - 1) * R1 ** 3), 18);
    expect(sc.correctorA4).toBeLessThan(0); // thickest at the rim
    // The corrector sits at the primary's centre of curvature, R₁ in front of it.
    expect(sc.correctorToPrimaryMm).toBe(R1);
  });

  it("shares the classical Cassegrain's MIRROR layout — only the stop, primary conic and corrector differ", () => {
    // The anti-drift rung: the two mirrors are the same paraxial pair as the
    // classical Cassegrain built from the same spec (identical secondary radius,
    // separation, obstruction and confocal conic), because both go through
    // `twoMirrorLayout`. What the SCT changes is the SPHERICAL primary (conic 0,
    // corrector-nulled) and the stop moving to the corrector — not the mirror
    // geometry the confocal secondary depends on.
    const c = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
    expect(sc.focalLengthMm).toBe(c.focalLengthMm);
    expect(sc.primarySeparationMm).toBe(c.primarySeparationMm);
    expect(sc.secondaryRadiusMm).toBe(c.secondaryRadiusMm);
    expect(sc.secondaryConic).toBe(c.secondaryConic); // both −4 at m = 3, the confocal hyperboloid
    expect(sc.obstruction).toBe(c.obstruction);
    // But the primary is a SPHERE here, not the Cassegrain's paraboloid.
    const sctPrimary = sc.prescription.surfaces[2]!; // corrector-front, corrector-back, primary, secondary
    const cassPrimary = c.prescription.surfaces[0]!;
    expect(sctPrimary.curvature).toBe(cassPrimary.curvature); // same radius R₁
    expect(sctPrimary.conic ?? 0).toBe(0); // sphere
    expect(cassPrimary.conic).toBe(-1); // paraboloid
  });

  it("reports the obstruction the secondary projects onto the pupil", () => {
    const s1 = sc.primaryFocalLengthMm - sc.primarySeparationMm;
    expect(sc.obstruction).toBeCloseTo(s1 / sc.primaryFocalLengthMm, 12);
    expect(sc.obstruction).toBeCloseTo(0.3281, 3);
  });

  it("brings focus out the back, b behind the primary vertex (which sits at z = R₁)", () => {
    // The corrector is at z = 0 (the primary's centre of curvature) and the
    // primary vertex at z = R₁, so a near-axis ray crosses the axis at z = R₁ + b.
    const res = traceRay(sc.prescription, makeRay(vec3(1, 0, -50), vec3(0, 0, 1), LAM));
    expect(res.status).toBe("ok");
    const r = res.ray!;
    const crossZ = r.origin.z + (-r.origin.x / r.dir.x) * r.dir.z;
    expect(crossZ).toBeCloseTo(sc.primaryRadiusMm + sc.backFocusMm, 4); // 1850
  });

  it("refuses impossible geometry, an oversize back focus, and a bad corrector", () => {
    expect(() => schmidtCassegrain({ apertureMm: 200, focalRatio: 4, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    expect(() => schmidtCassegrain({ apertureMm: 200, focalRatio: 3, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    expect(() =>
      schmidtCassegrain({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 3000 }),
    ).toThrow(/back focus/);
    expect(() =>
      schmidtCassegrain({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, plateThicknessMm: 1e6 }),
    ).toThrow(/thickness/);
    expect(() =>
      schmidtCassegrain({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, correctorMedium: "UNOBTAINIUM" }),
    ).toThrow(/unknown medium/);
  });
});

/**
 * Rung: on axis, the corrector nulls the spherical primary's spherical
 * aberration — to third order.
 *
 * The spherical primary carries r⁴/(4R₁³) of spherical aberration; the corrector's
 * (n−1)·A₄·r⁴ figure cancels it, and the confocal secondary relays the corrected
 * beam stigmatically, so the on-axis wavefront collapses from a badly-aberrated
 * bare sphere to diffraction-limited. The negative controls prove the figure
 * earns its keep: a flat corrector restores the full sphere error, and FLIPPING
 * its sign roughly doubles it. Because only the third order is nulled, a
 * fifth-order residual survives — this is NOT the confocal Cassegrain's exact
 * stigmatism — so the bar is "diffraction-limited and a large factor better than
 * the bare sphere", never Strehl = 1.
 */
describe("Schmidt-Cassegrain on axis", () => {
  const D = 200;
  const sc = schmidtCassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
  const s = system(sc.prescription, D);
  const corrected = onAxisRms(s); // ≈ 0.0069 waves
  const bare = onAxisRms(system(withCorrector(sc.prescription, null), D)); // ≈ 0.84

  it("passes the whole beam — nothing vignettes on axis", () => {
    // The corrector refracts the marginal ray outward past the bare Cassegrain
    // cone, so the secondary carries the extra margin that keeps the pupil's own
    // rim ring from being shaved.
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);
    expect(opdMap(s, 0, LAM, pupilGrid(33)).lost).toBe(0);
  });

  it("is diffraction-limited, and a large factor better than the corrector-removed sphere", () => {
    // ~0.007 waves corrected vs ~0.84 bare: the corrector buys ~120×, landing
    // well inside the Maréchal λ/14 ≈ 0.071-wave diffraction limit.
    expect(bare).toBeGreaterThan(0.5);
    expect(corrected).toBeLessThan(0.02);
    expect(bare / corrected).toBeGreaterThan(50);
    expect(psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 }).strehl).toBeGreaterThan(0.95);
  });

  it("needs the corrector's SIGN, not just its magnitude", () => {
    // Flip A₄: the corrector now adds r⁴/(4R₁³) on top of the sphere's, so the
    // error is ≈ twice the bare sphere's — the sharpest proof the sign is real.
    const flipped = onAxisRms(system(withCorrector(sc.prescription, [-sc.correctorA4]), D));
    expect(flipped / bare).toBeCloseTo(2, 1); // measured ≈ 1.99
    expect(flipped / corrected).toBeGreaterThan(10);
  });

  it("is diffraction-limited but NOT exactly stigmatic, unlike the confocal Cassegrain", () => {
    // The load-bearing distinction from its all-reflective sibling. The classical
    // Cassegrain, same spec, is stigmatic to ~1e-8 through this best-focus path;
    // the SCT sits ~5 orders above it, because the corrector nulls only the THIRD
    // order and a fifth-order spherical residual survives — the same honest story
    // as the Schmidt camera (§ 5g) and the RC on axis (§ 5f).
    const c = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
    const cassRms = onAxisRms(system(c.prescription, D));
    expect(corrected).toBeGreaterThan(1e-4); // genuinely nonzero
    expect(cassRms).toBeLessThan(1e-6);
    expect(corrected / cassRms).toBeGreaterThan(1e3); // measured ~5e5
  });

  it("carries a FIFTH-order residual: it falls steeply as the primary slows", () => {
    // At fixed magnification (m = 3), slow the primary from f/4 to f/8. A
    // third-order defect would be nulled at both; a fifth-order one drops as a
    // steep power of the marginal ray angle. Measured ~32× for a 2× slowdown —
    // the 2⁵ signature of a fifth-order term, the same the RC shows (§ 5f).
    const fast = onAxisRms(
      system(schmidtCassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 0.25 * D }).prescription, D),
    );
    const slow = onAxisRms(
      system(schmidtCassegrain({ apertureMm: D, focalRatio: 24, primaryFocalRatio: 8, backFocusMm: 0.25 * D }).prescription, D),
    );
    expect(fast / slow).toBeGreaterThan(20);
  });

  it("keeps the obstruction out of the geometry and in the pupil function", () => {
    // The secondary is not traced as a blocker, so an obstructed PSF must differ
    // from an unobstructed one only because the pupil function was told to.
    const clear = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    const blocked = psf(s, 0, LAM, {
      traceSamples: 13,
      pupilSamples: 32,
      padFactor: 2,
      obstruction: sc.obstruction,
    });
    expect(blocked.energy).toBeLessThan(clear.energy);
    expect(blocked.energy / clear.energy).toBeCloseTo(1 - sc.obstruction ** 2, 2);
  });
});

/**
 * Rung: spherochromatism — the price of a refractive corrector.
 *
 * The corrector is figured for one wavelength; away from it (n−1) drifts, so the
 * spherical-aberration cancellation is imperfect. The residual is exactly the
 * corrector's own r⁴ figure scaled by the index change: a PURE primary-spherical
 * term, (n(λ)−n(550))·A₄·r⁴, refocus-invariant, whose Zernike j=11 projection is
 * the closed form
 *
 *     Δc₁₁(λ) = (n(λ)−n(550))·A₄·(D/2)⁴ / (6√5) / λ        [waves]
 *
 * Pinned on a slow camera (primary f/10, system f/20), where the 5th-order
 * MONOCHROMATIC residual — which also lands on j=11 and scales as 1/F⁵ — has
 * shrunk to a few percent, so the traced chromatic shift sits just under the
 * pure-third-order line, the way the Schmidt camera's does (§ 5g). This is the one
 * behaviour no all-mirror design has, and it is why the SCT is its own preset.
 */
describe("Schmidt-Cassegrain spherochromatism", () => {
  const D = 200;
  const sc = schmidtCassegrain({ apertureMm: D, focalRatio: 20, primaryFocalRatio: 10, backFocusMm: 0.2 * D });
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
    // At a primary f/10 the 5th-order residual has all but vanished (< 1e-3
    // waves), the on-axis proof that A₄ nulls the THIRD-order term exactly — what
    // remains at f/4 was pure 5th-order.
    expect(onAxisRms(s)).toBeLessThan(1e-3); // measured ~7e-5
  });

  it("shifts the primary-spherical term with wavelength, by the corrector's own r⁴ figure", () => {
    const j550 = j11At(550);
    for (const lam of [450, 500, 600, 650]) {
      const measured = j11At(lam) - j550;
      const ratio = measured / predictDelta(lam);
      // Opposite in the engine's OPD-sign convention, and just under unity in
      // magnitude because the trace carries the 5th-order the closed form omits.
      expect(ratio).toBeLessThan(0);
      expect(Math.abs(ratio)).toBeGreaterThan(0.9); // measured 0.965–0.979
      expect(Math.abs(ratio)).toBeLessThan(1.0);
    }
  });

  it("moves monotonically across the visible band", () => {
    const j = [450, 500, 550, 600, 650].map(j11At);
    for (let i = 1; i < j.length; i++) expect(j[i]!).toBeLessThan(j[i - 1]!);
  });
});
