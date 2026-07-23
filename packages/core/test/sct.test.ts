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
import { commercialSct } from "../src/designs/sct";
import { cassegrain } from "../src/designs/cassegrain";

/**
 * Rungs for the all-spherical commercial SCT preset (docs/VALIDATION.md § 5i).
 *
 * This is the "compact SCT" sold as a Celestron/Meade tube: TWO spherical mirrors
 * (the cheapest optics there are) and one aspheric corrector plate at the
 * primary's centre of curvature, figured to null the COMBINED spherical
 * aberration of both spheres. It is the sixth reflecting preset, and the last of
 * the Schmidt family — the one the roadmap held back until a closed form for the
 * two-mirror corrector was in hand.
 *
 * The external number is the two-mirror Seidel corrector (Schroeder, Astronomical
 * Optics Ch. 6; Rutten & van Venrooij, Telescope Optics). Because third-order SA
 * is exactly linear in each mirror's conic, the corrector nets two terms:
 *
 *     (n−1)·A₄ = −1/(4R₁³)  −  k₂·ε⁴/(4R₂³)          k₂ = −((m+1)/(m−1))²
 *
 * — the Schmidt primary term (§ 5g), MINUS the secondary sphere's own SA, which
 * the classical Cassegrain's confocal hyperboloid used to cancel. The secondary
 * term SUBTRACTS: a convex sphere is over-corrected, opposite in sense to the
 * concave primary, so the two spheres partially cancel and the corrector is
 * *weaker* than the primary-only Schmidt figure (≈ 0.6× here). The subtractive
 * sign is fixed EXTERNALLY by the Dall-Kirkham telescope (ellipsoidal primary,
 * spherical secondary), not by the trace — see sct.ts and § 5i.
 *
 * The pin has three faces the earlier Schmidt units do not reach:
 *  (1) the combined A₄ equals that closed form and nulls the two-sphere SA to
 *      diffraction-limited on axis;
 *  (2) the SECONDARY term's sign and size are exercised by a three-way ladder —
 *      combined ≪ primary-only-corrector ≪ wrong-sign-secondary, the last ≈ twice
 *      the middle — which no single-mirror negative control can reach;
 *  (3) it carries the same fifth-order residual and spherochromatism as the rest
 *      of the family, and is NOT an anastigmat (the two-mirror stop leaves coma
 *      and astigmatism off axis, unpinned here).
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

describe("all-spherical SCT geometry", () => {
  const D = 200;
  const sc = commercialSct({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });

  it("has the system focal length its focal ratio names, and reports it paraxially", () => {
    expect(sc.focalLengthMm).toBe(D * 12); // 2400
    expect(sc.primaryFocalLengthMm).toBe(D * 4); // 800
    expect(sc.primaryRadiusMm).toBe(2 * D * 4); // R₁ = 2f₁ = 1600
    expect(systemProperties(sc.prescription, LAM).efl).toBeCloseTo(2400, 4);
    expect(sc.secondaryMagnification).toBeCloseTo(3, 12); // F/F₁ = 12/4
  });

  it("has BOTH mirrors spherical — the defining feature of the commercial SCT", () => {
    // corrector-front, corrector-back, primary, secondary
    const primary = sc.prescription.surfaces[2]!;
    const secondary = sc.prescription.surfaces[3]!;
    expect(primary.kind).toBe("reflect");
    expect(secondary.kind).toBe("reflect");
    expect(primary.conic ?? 0).toBe(0); // sphere
    expect(secondary.conic ?? 0).toBe(0); // sphere — NOT the Cassegrain/SCass hyperboloid
  });

  it("figures the corrector to the two-mirror Seidel closed form, WEAKER than the primary-only Schmidt figure", () => {
    // The external number, computed from scalars — n at the design wavelength, the
    // primary and secondary radii, the magnification and the obstruction — with no
    // reference to the engine's own sag. The primary term is the Schmidt figure;
    // the secondary term subtracts.
    const n = getMedium("FUSED-SILICA").n(LAM);
    const R1 = sc.primaryRadiusMm;
    const R2 = sc.secondaryRadiusMm;
    const m = sc.secondaryMagnification;
    const eps = sc.obstruction;
    const k2mag = ((m + 1) / (m - 1)) ** 2; // |k₂| = magnitude of the confocal hyperboloid conic

    const primaryOnly = -1 / (4 * (n - 1) * R1 ** 3);
    const secondaryTerm = (k2mag * eps ** 4) / (4 * (n - 1) * R2 ** 3);
    const closed = primaryOnly + secondaryTerm;

    expect(sc.correctorIndex).toBe(n);
    expect(sc.designWavelengthNm).toBe(550);
    expect(sc.correctorMedium).toBe("FUSED-SILICA");
    expect(sc.primaryOnlyA4).toBeCloseTo(primaryOnly, 18);
    expect(sc.correctorA4).toBeCloseTo(closed, 18);
    expect(sc.correctorA4).toBeLessThan(0); // still thickest at the rim

    // The secondary term subtracts (partial cancellation): the corrector is WEAKER
    // than the primary-only Schmidt figure — measured ≈ 0.61× here.
    expect(secondaryTerm).toBeGreaterThan(0);
    expect(Math.abs(sc.correctorA4)).toBeLessThan(Math.abs(sc.primaryOnlyA4));
    expect(sc.correctorA4 / sc.primaryOnlyA4).toBeCloseTo(0.6111, 3);

    // The corrector sits at the primary's centre of curvature, R₁ in front of it.
    expect(sc.correctorToPrimaryMm).toBe(R1);
  });

  it("shares the classical Cassegrain's MIRROR layout, but with a SPHERICAL secondary", () => {
    // The anti-drift rung: the paraxial mirror pair is the same one `twoMirrorLayout`
    // builds for the classical Cassegrain from the same spec — identical secondary
    // radius, separation and obstruction. What the commercial SCT changes is that
    // BOTH conics are 0 (spheres) where the Cassegrain has a paraboloid + confocal
    // hyperboloid, and the stop moves to the corrector.
    const c = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
    expect(sc.focalLengthMm).toBe(c.focalLengthMm);
    expect(sc.primarySeparationMm).toBe(c.primarySeparationMm);
    expect(sc.secondaryRadiusMm).toBe(c.secondaryRadiusMm);
    expect(sc.obstruction).toBe(c.obstruction);
    // Same secondary RADIUS, but a sphere here vs the Cassegrain's confocal hyperboloid.
    const sctSecondary = sc.prescription.surfaces[3]!;
    const cassSecondary = c.prescription.surfaces[1]!;
    expect(sctSecondary.curvature).toBe(cassSecondary.curvature);
    expect(sctSecondary.conic ?? 0).toBe(0); // sphere
    expect(cassSecondary.conic).toBeCloseTo(-4, 12); // hyperboloid, −((m+1)/(m−1))² at m = 3
  });

  it("reports the obstruction the secondary projects onto the pupil", () => {
    const s1 = sc.primaryFocalLengthMm - sc.primarySeparationMm;
    expect(sc.obstruction).toBeCloseTo(s1 / sc.primaryFocalLengthMm, 12);
    expect(sc.obstruction).toBeCloseTo(0.3281, 3);
  });

  it("brings focus out the back, b behind the primary vertex (which sits at z = R₁)", () => {
    const res = traceRay(sc.prescription, makeRay(vec3(1, 0, -50), vec3(0, 0, 1), LAM));
    expect(res.status).toBe("ok");
    const r = res.ray!;
    const crossZ = r.origin.z + (-r.origin.x / r.dir.x) * r.dir.z;
    expect(crossZ).toBeCloseTo(sc.primaryRadiusMm + sc.backFocusMm, 4); // 1850
  });

  it("refuses impossible geometry, an oversize back focus, and a bad corrector", () => {
    expect(() => commercialSct({ apertureMm: 200, focalRatio: 4, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    expect(() => commercialSct({ apertureMm: 200, focalRatio: 3, primaryFocalRatio: 4 })).toThrow(/must exceed/);
    expect(() =>
      commercialSct({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 3000 }),
    ).toThrow(/back focus/);
    expect(() =>
      commercialSct({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, plateThicknessMm: 1e6 }),
    ).toThrow(/thickness/);
    expect(() =>
      commercialSct({ apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, correctorMedium: "UNOBTAINIUM" }),
    ).toThrow(/unknown medium/);
  });
});

/**
 * Rung: on axis, the corrector nulls the COMBINED two-sphere spherical
 * aberration, and the three-way ladder proves the secondary term earns its keep.
 *
 * The single corrector cancels both spheres' third-order SA, so the wavefront
 * collapses from a badly-aberrated pair of bare spheres to diffraction-limited.
 * The load-bearing rung is the ladder that isolates the SECONDARY term — a thing
 * the single-mirror Schmidt cannot test:
 *
 *   - the COMBINED corrector          → residual ≈ 0 (diffraction-limited)
 *   - the PRIMARY-ONLY Schmidt figure → residual ≈ |W_s| (secondary SA left)
 *   - the WRONG-SIGN secondary term   → residual ≈ 2|W_s|
 *
 * "Combined beats primary-only, and wrong-sign is twice primary-only" is what
 * pins the secondary term's sign and magnitude. Only the third order is nulled,
 * so a fifth-order residual survives — this is NOT the confocal Cassegrain's exact
 * stigmatism — and the bar is "diffraction-limited", never Strehl = 1.
 */
describe("all-spherical SCT on axis", () => {
  const D = 200;
  const sc = commercialSct({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
  const s = system(sc.prescription, D);
  const combined = onAxisRms(s); // ≈ 0.0032 waves
  const bare = onAxisRms(system(withCorrector(sc.prescription, null), D)); // ≈ 0.51 (both spheres, no plate)

  it("passes the whole beam — nothing vignettes on axis", () => {
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);
    expect(opdMap(s, 0, LAM, pupilGrid(33)).lost).toBe(0);
  });

  it("is diffraction-limited, and a large factor better than the corrector-removed pair", () => {
    // ~0.003 waves corrected vs ~0.51 bare: well inside the Maréchal λ/14 ≈
    // 0.071-wave diffraction limit.
    expect(bare).toBeGreaterThan(0.4);
    expect(combined).toBeLessThan(0.02);
    expect(bare / combined).toBeGreaterThan(50);
    expect(psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 }).strehl).toBeGreaterThan(0.95);
  });

  it("earns the secondary term: combined ≪ primary-only ≪ wrong-sign, wrong-sign ≈ 2× primary-only", () => {
    // primary-only = the Schmidt figure on the spherical secondary: it leaves the
    // secondary's own SA |W_s| uncorrected. wrong-sign = flip only the secondary
    // term (primaryOnlyA4 − secondaryTerm), which ADDS |W_s| instead of removing
    // it, so it lands at ≈ 2|W_s|. This is the ΔA₄ lever turned into a test — the
    // only rung in the family that exercises the secondary sign.
    const secondaryTerm = sc.correctorA4 - sc.primaryOnlyA4; // > 0
    const primaryOnly = onAxisRms(system(withCorrector(sc.prescription, [sc.primaryOnlyA4]), D)); // ≈ 0.32
    const wrongSign = onAxisRms(system(withCorrector(sc.prescription, [sc.primaryOnlyA4 - secondaryTerm]), D)); // ≈ 0.65

    expect(secondaryTerm).toBeGreaterThan(0);
    expect(primaryOnly).toBeGreaterThan(0.2); // |W_s| is large — well above the 5th-order floor
    expect(combined / primaryOnly).toBeLessThan(0.02); // measured ≈ 0.010: combined ≪ primary-only
    expect(wrongSign / primaryOnly).toBeCloseTo(2, 1); // measured ≈ 2.01: the secondary-sign discriminator
  });

  it("is diffraction-limited but NOT exactly stigmatic, unlike the confocal Cassegrain", () => {
    // The classical Cassegrain, same spec, is stigmatic to ~1e-8 through this
    // best-focus path; the SCT sits ~5 orders above it, a fifth-order spherical
    // residual the third-order corrector cannot reach — the family's honest story.
    const c = cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 });
    const cassRms = onAxisRms(system(c.prescription, D));
    expect(combined).toBeGreaterThan(1e-4); // genuinely nonzero
    expect(cassRms).toBeLessThan(1e-6);
    expect(combined / cassRms).toBeGreaterThan(1e3); // measured ~2e5
  });

  it("carries a FIFTH-order residual: it falls steeply as the primary slows", () => {
    // At fixed magnification (m = 2.5), slow the primary from f/4 to f/8. A
    // third-order defect would be nulled at both; a fifth-order one drops as ~2⁵.
    // Measured ~31× for a 2× slowdown — the fifth-order signature the whole family
    // shows (§ 5f–5h).
    const fast = onAxisRms(
      system(commercialSct({ apertureMm: D, focalRatio: 10, primaryFocalRatio: 4, backFocusMm: 0.25 * D }).prescription, D),
    );
    const slow = onAxisRms(
      system(commercialSct({ apertureMm: D, focalRatio: 20, primaryFocalRatio: 8, backFocusMm: 0.25 * D }).prescription, D),
    );
    expect(fast / slow).toBeGreaterThan(20);
  });

  it("keeps the obstruction out of the geometry and in the pupil function", () => {
    const clear = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    const blocked = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2, obstruction: sc.obstruction });
    expect(blocked.energy).toBeLessThan(clear.energy);
    expect(blocked.energy / clear.energy).toBeCloseTo(1 - sc.obstruction ** 2, 2);
  });
});

/**
 * Rung: spherochromatism — the price of a refractive corrector.
 *
 * The corrector is figured for one wavelength; away from it (n−1) drifts, so the
 * SA cancellation is imperfect. The residual is the corrector's own COMBINED r⁴
 * figure scaled by the index change: a pure primary-spherical term,
 * (n(λ)−n(550))·A₄·r⁴, refocus-invariant, whose Zernike j=11 projection is
 *
 *     Δc₁₁(λ) = (n(λ)−n(550))·A₄·(D/2)⁴ / (6√5) / λ        [waves]
 *
 * — the SAME closed form the Schmidt camera and Schmidt-Cassegrain carry (§ 5g/5h),
 * now with the combined two-mirror A₄. Pinned on a slow SCT (primary f/10) where
 * the fifth-order monochromatic residual has all but vanished, so the traced shift
 * sits just under the pure-third-order line.
 */
describe("all-spherical SCT spherochromatism", () => {
  const D = 200;
  const sc = commercialSct({ apertureMm: D, focalRatio: 20, primaryFocalRatio: 10, backFocusMm: 0.2 * D });
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

  it("is corrected essentially perfectly at the design wavelength on a slow SCT", () => {
    // At a primary f/10 the fifth-order residual has all but vanished (< 1e-3
    // waves, measured ~3e-5) — the on-axis proof that the combined A₄ nulls the
    // THIRD-order term exactly.
    expect(onAxisRms(s)).toBeLessThan(1e-3);
  });

  it("shifts the primary-spherical term with wavelength, by the corrector's own r⁴ figure", () => {
    const j550 = j11At(550);
    for (const lam of [450, 500, 600, 650]) {
      const measured = j11At(lam) - j550;
      const ratio = measured / predictDelta(lam);
      // Opposite in the engine's OPD-sign convention, and just under unity in
      // magnitude because the trace carries the fifth-order the closed form omits.
      expect(ratio).toBeLessThan(0);
      expect(Math.abs(ratio)).toBeGreaterThan(0.9); // measured 0.977–0.986
      expect(Math.abs(ratio)).toBeLessThan(1.0);
    }
  });

  it("moves monotonically across the visible band", () => {
    const j = [450, 500, 550, 600, 650].map(j11At);
    for (let i = 1; i < j.length; i++) expect(j[i]!).toBeLessThan(j[i - 1]!);
  });
});
