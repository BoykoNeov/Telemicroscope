import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { psf } from "../src/wave/psf";
import { bestFocus, withFocus } from "../src/analysis/focus";
import {
  applyPerturbation,
  sensitivity,
  toleranceBudget,
  Perturbation,
} from "../src/analysis/tolerance";
import { achromaticObjective } from "../src/designs/achromat";
import { newtonian } from "../src/designs/newtonian";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for TOLERANCING — how the image degrades when a parameter drifts by its
 * manufacturing tolerance (docs/VALIDATION.md § 5t).
 *
 * The module adds no physics; it composes `opdMap` and `bestFocus`. So the
 * validation burden is on the ORCHESTRATION — the currency, the compensator, and
 * the aggregation — not on new optics. Every EXTERNAL rung is therefore pinned on
 * a PERFECT nominal (a paraboloid at focus, or a flat fold), where the currency's
 * one design subtlety — linear defocus projection vs a physical refocus — cannot
 * bite: the two coincide only when the nominal carries no aberration of its own.
 *
 *  - **Boresight = 2θ** — tilting a flat fold by θ deviates the beam by twice
 *    that. The reflection law, measured straight off the chief ray.
 *  - **Conic compensator** — a conic error induces spherical, which a refocus
 *    only partly removes; the residual is the balanced spherical RMS in closed
 *    form. (A CURVATURE error on a mirror induces pure defocus, fully removed —
 *    the tautology this rung is built to avoid.)
 *  - **RSS budget** — independent (orthogonal-mode) tolerances add in quadrature;
 *    the combined single trace confirms it. The negative control is two
 *    perfectly-correlated tolerances, which add LINEARLY instead.
 *  - **Diffraction-limit threshold** — the perturbation that costs σ = λ/14 RMS
 *    lands the real PSF Strehl on ≈ 0.8 (Maréchal, RMS-native — not Rayleigh's
 *    λ/4 peak-to-valley).
 */

const LAM = LINE_D;

// The step-2b paraboloid: R = −200, semi-aperture 10 → NA 0.1, focus at R/2.
const R = -200;
const AP = 10;
const CURV = 1 / R;
const paraboloid = (): Prescription => ({
  surfaces: [
    { kind: "reflect", curvature: CURV, conic: -1, semiAperture: AP, thickness: R / 2, isStop: true },
  ],
});
const mirrorSystem = (p: Prescription): OpticalSystem => ({
  prescription: p,
  aperture: { kind: "stopRadius", value: AP },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LAM, weight: 1 }],
  conjugate: { kind: "infinite" },
});

const lamMm = LAM * 1e-6;

describe("tolerancing — external rungs (perfect nominals)", () => {
  it("boresight = 2θ: tilting a flat fold deviates the beam by twice the tilt", () => {
    // A Newtonian's diagonal is a 45° flat (surface 1). Tilt it by θ and the
    // chief ray — the whole beam — must swing by 2θ. The cleanest external
    // number in optics, and it exercises the tilt-perturbation path end to end.
    const scope = newtonian({ apertureMm: 200, focalRatio: 5 });
    const system: OpticalSystem = {
      prescription: scope.prescription,
      aperture: { kind: "stopRadius", value: 100 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LAM, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    for (const thetaDeg of [0.05, 0.1, 0.2]) {
      const pert: Perturbation = { surface: 1, target: "tiltX", delta: thetaDeg };
      const s = sensitivity(system, pert);
      const expected = 2 * ((thetaDeg * Math.PI) / 180);
      expect(s.boresightRad).toBeCloseTo(expected, 6);
    }
  });

  it("conic compensator: residual = balanced spherical RMS |ΔK·c³h⁴/4|/(6√5)", () => {
    // A conic error ΔK adds W = W₀₄₀·ρ⁴ to a mirror, W₀₄₀ = ΔK·c³·h⁴/4 (the r⁴
    // conic-sag term, doubled by reflection). A focus compensator removes the
    // balancing defocus ρ² buys but not the spherical itself; what is left is the
    // balanced-focus RMS W₀₄₀/(6√5) that step 1.6 / 2a already pinned. So the
    // tolerance currency reproduces an external closed form — NOT the engine.
    const nominal = mirrorSystem(paraboloid());
    for (const dK of [5e-4, 1e-3, 2e-3]) {
      const s = sensitivity(nominal, { surface: 0, target: "conic", delta: dK });
      const w040Mm = (dK * CURV ** 3 * AP ** 4) / 4;
      const predicted = Math.abs(w040Mm / lamMm) / (6 * Math.sqrt(5));
      expect(s.sigmaWaves).toBeGreaterThan(0);
      expect(s.sigmaWaves / predicted).toBeCloseTo(1, 1); // within a few %
      // On a perfect nominal the linear projection IS the physical refocus.
      expect(s.physicalRefocusWaves / s.sigmaWaves).toBeCloseTo(1, 1);
    }
  });

  it("curvature error on a mirror is pure defocus — fully removed by the compensator", () => {
    // The negative control for the conic rung: a curvature change shifts focus
    // and nothing else on a single mirror, so after the focus compensator the
    // residual collapses. This is why the compensator rung perturbs the CONIC.
    const nominal = mirrorSystem(paraboloid());
    const s = sensitivity(nominal, { surface: 0, target: "curvature", delta: 2e-6 });
    expect(s.sigmaBeforeFocusWaves).toBeGreaterThan(20 * s.sigmaWaves);
    expect(s.sigmaWaves).toBeLessThan(1e-3); // essentially fully compensated
  });

  it("RSS: orthogonal tolerances add in quadrature; correlated ones add linearly", () => {
    // Spherical-from-conic (even) is orthogonal to coma-from-tilt (odd), so their
    // delta wavefronts are uncorrelated and variances add: the single combined
    // trace equals √(Σσ²). The law can go RED — it needs the engine to actually
    // superpose the two aberrations. (A tilt is used, not a decenter: surface 0 is
    // itself the stop, so decentering it shifts the pupil with it and produces no
    // relative aberration — a real feature, checked below.)
    const nominal = mirrorSystem(paraboloid());
    const curvP: Perturbation = { surface: 0, target: "conic", delta: 3e-2 };
    const tiltP: Perturbation = { surface: 0, target: "tiltY", delta: 0.014 };
    const budget = toleranceBudget(nominal, [curvP, tiltP]);
    const [a, b] = budget.contributions.map((c) => c.sigmaWaves);
    // COMPARABLE magnitudes are what give this rung teeth: if one term dominated,
    // √(a²+b²) ≈ combined ≈ that term and a superposition bug would pass. With
    // a ≈ b, a linear (non-RSS) combine would read ≈ √2 high — well outside the
    // 5% gate below.
    expect(a!).toBeGreaterThan(5e-4);
    expect(b!).toBeGreaterThan(5e-4);
    expect(b! / a!).toBeGreaterThan(0.5);
    expect(b! / a!).toBeLessThan(2);
    // Orthogonal: combined² = a² + b². Tolerance bounded by the 2nd-order cross
    // term of the finite perturbations.
    expect(budget.combinedWaves / budget.rssWaves).toBeCloseTo(1, 1);

    // Negative control: two IDENTICAL perturbations are perfectly correlated, so
    // the combined trace is their LINEAR sum (2σ), not the RSS (√2·σ).
    const twin = toleranceBudget(nominal, [curvP, curvP]);
    const single = twin.contributions[0]!.sigmaWaves;
    expect(twin.rssWaves / single).toBeCloseTo(Math.SQRT2, 2);
    expect(twin.combinedWaves / single).toBeCloseTo(2, 1); // linear, not RSS
    expect(twin.combinedWaves).toBeGreaterThan(1.3 * twin.rssWaves);
  });

  it("diffraction limit: the perturbation costing σ = λ/14 lands Strehl ≈ 0.8", () => {
    // Bisect a conic error until the tolerance currency reads λ/14 RMS, then read
    // the REAL PSF Strehl (OPD → FFT, the § 2b pin) of that perturbed system at
    // its best focus. Maréchal says exp(−(2π/14)²) ≈ 0.817; the diffraction-limit
    // convention rounds it to 0.8. This pins the RMS-native threshold, not the
    // λ/4 peak-to-valley one (they coincide only for balanced defocus).
    const nominal = mirrorSystem(paraboloid());
    const target = 1 / 14;
    const sigmaOf = (dK: number) =>
      sensitivity(nominal, { surface: 0, target: "conic", delta: dK }).sigmaWaves;
    let lo = 0;
    let hi = 10;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (sigmaOf(mid) < target) lo = mid;
      else hi = mid;
    }
    const dK = (lo + hi) / 2;
    expect(sigmaOf(dK)).toBeCloseTo(target, 3);

    const perturbed = mirrorSystem(applyPerturbation(paraboloid(), { surface: 0, target: "conic", delta: dK }));
    const focus = bestFocus(perturbed, "minRmsWavefront", { pupilSamples: 64, wavelengthNm: LAM });
    const p = psf(withFocus(perturbed, focus.offsetFromLastVertex), 0, LAM, { pupilSamples: 64, padFactor: 8 });
    expect(p.strehl).toBeGreaterThan(0.79);
    expect(p.strehl).toBeLessThan(0.84);
  });
});

describe("tolerancing — consistency checks (NOT validation)", () => {
  const D = 100;
  const achromatSystem = (p: Prescription): OpticalSystem => ({
    prescription: p,
    aperture: { kind: "stopRadius", value: D / 2 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  });
  const totalRms = (p: Prescription): number => {
    const s = achromatSystem(p);
    const f = bestFocus(s, "minRmsWavefront", { pupilSamples: 21, wavelengthNm: LAM });
    return opdMap(withFocus(s, f.offsetFromLastVertex), 0, LAM, pupilGrid(21)).rmsWaves;
  };

  it("the kink: central-diff of total RMS reads ≈0 where the currency reads the true slope", () => {
    // WHY the currency is a delta-wavefront σ and not d(RMS)/dparameter. A
    // decenter of the achromat is dominated by coma, nearly orthogonal to its
    // spherical residual, so the total RMS is nearly stationary — a central
    // difference reports a slope several-fold below the true sensitivity (the
    // residual's tiny parallel component is all it sees). The delta-σ currency
    // does not have this blind spot.
    const obj = achromaticObjective({ apertureMm: D, focalRatio: 8 });
    const p = obj.prescription;
    const h = 5e-4;
    const decen = (d: number): Prescription =>
      applyPerturbation(p, { surface: 0, target: "decenterY", delta: d });
    const central = Math.abs((totalRms(decen(h)) - totalRms(decen(-h))) / (2 * h));
    const sigma = sensitivity(achromatSystem(p), {
      surface: 0,
      target: "decenterY",
      delta: h,
    }).sigmaWaves;
    const trueSlope = sigma / h;
    // The naive derivative understates the real sensitivity several-fold: here
    // the delta-σ slope is >8× what the central difference of total RMS reports.
    expect(trueSlope).toBeGreaterThan(8 * central);
    expect(trueSlope).toBeGreaterThan(1e-3);
  });

  it("physical refocus differs from the linear projection on an ABERRATED nominal", () => {
    // The flip side of the conic rung's equality: on the achromat (a real
    // spherical residual), physical refocus is pulled by the nominal's own ρ⁴
    // because ρ² and ρ⁴ are not orthogonal, so it lands below the linear
    // projection. Recorded as a measurement, not asserted to any external value.
    const obj = achromaticObjective({ apertureMm: D, focalRatio: 8 });
    const s = sensitivity(achromatSystem(obj.prescription), {
      surface: 0,
      target: "curvature",
      delta: 5e-6,
    });
    expect(s.physicalRefocusWaves).toBeLessThan(0.8 * s.sigmaWaves);
  });

  it("applyPerturbation edits exactly one field and does not mutate the input", () => {
    const p = paraboloid();
    const before = JSON.stringify(p);
    const q = applyPerturbation(p, { surface: 0, target: "curvature", delta: 1e-4 });
    expect(JSON.stringify(p)).toBe(before); // input untouched
    expect(q.surfaces[0]!.curvature).toBeCloseTo(CURV + 1e-4, 12);
    expect(q.surfaces[0]!.conic).toBe(p.surfaces[0]!.conic); // nothing else moved
  });
});
