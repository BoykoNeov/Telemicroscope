import { describe, it, expect } from "vitest";
import { seidelSums } from "../src/analysis/seidel";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, coefficient } from "../src/wave/zernike";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { registerMedium, getMedium } from "../src/materials/catalog";
import { constantIndex, indexD, LINE_D } from "../src/materials/dispersion";
import { systemProperties } from "../src/trace/paraxial";

/**
 * Rungs for the third-order (Seidel) sums (docs/VALIDATION.md § 5j).
 *
 * `analysis/seidel` exists so a lens can be *solved* rather than fitted: the
 * achromat preset picks its bending by setting S_I = 0 in closed form, and the
 * trace then confirms the result independently. That only works if the closed
 * form itself is right, so it is pinned here — before anything is built on it —
 * against two external numbers that between them fix the scale and the whole
 * shape dependence:
 *
 *  1. **A spherical mirror**: S_I/8 = h⁴/(4R³), the sphere-vs-paraboloid figure
 *     § 5g derived from the sag difference and pinned through the Schmidt
 *     corrector. Fixes the 1/8, the sign convention, and the n′ = −n handling.
 *  2. **The thin lens in air**, whose third-order spherical aberration has a
 *     published closed form in Coddington's shape factor q and position factor
 *     p (Jenkins & White, *Fundamentals of Optics*; Hecht, *Optics* § 6.3):
 *
 *         W₀₄₀ = h⁴/(32·f³·n(n−1)) · [ (n+2)/(n−1)·q² + 4(n+1)·p·q
 *                                      + (3n+2)(n−1)·p² + n³/(n−1) ]
 *
 *     with q = (c₁+c₂)/(c₁−c₂) = (R₂+R₁)/(R₂−R₁) and p = −1 for an object at
 *     infinity. This pins the entire polynomial — every cross-term and the
 *     absolute scale — not one evaluation, and it carries its own famous
 *     corollaries: the best-form minimum at q = 2(n²−1)/(n+2), and a
 *     plano-convex lens turned the wrong way round having 27/7 ≈ 3.86× the
 *     spherical aberration of one facing the collimated beam.
 *
 * A third rung closes the loop the other way: for a slow singlet the predicted
 * W₀₄₀ = S_I/8 matches the *traced* wavefront's spherical-aberration term.
 */

const N15 = constantIndex("SEIDEL-N15", 1.5);
const N16 = constantIndex("SEIDEL-N16", 1.6);
registerMedium(N15);
registerMedium(N16);

/** A single spherical mirror, concave toward the +z beam, focus at R/2. */
const sphereMirror = (R: number, D: number): Prescription => ({
  surfaces: [
    { kind: "reflect", curvature: -1 / R, semiAperture: D / 2, thickness: -R / 2, isStop: true },
  ],
});

/**
 * A thin lens of focal length f and index n at Coddington shape factor
 * q = (c₁ + c₂)/(c₁ − c₂), built as two surfaces 1 nm apart: numerically thin,
 * still a legal prescription. Paraxial only — the surfaces cross outside the
 * axis, so this is for the Seidel sums (which never trace a real ray), not for
 * the tracer.
 */
function thinLens(f: number, n: number, q: number, D: number, medium: string): Prescription {
  const dc = 1 / ((n - 1) * f); // c₁ − c₂ from the thin-lens maker's equation
  const c1 = (dc * (q + 1)) / 2;
  const c2 = c1 - dc;
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: D / 2, thickness: 1e-6, medium, isStop: true },
      { kind: "refract", curvature: c2, semiAperture: D / 2, thickness: f, medium: "AIR" },
    ],
  };
}

/** The published thin-lens bracket, object at infinity (p = −1). */
const thinLensBracket = (n: number, q: number, p = -1): number =>
  ((n + 2) / (n - 1)) * q * q + 4 * (n + 1) * p * q + (3 * n + 2) * (n - 1) * p * p + n ** 3 / (n - 1);

describe("Seidel S_I — the spherical mirror anchor (scale)", () => {
  it("reproduces the sphere's h⁴/(4R³), the figure § 5g pins independently", () => {
    for (const [R, h] of [[1600, 100], [800, 50], [2000, 25]] as const) {
      const sum = seidelSums(sphereMirror(R, 2 * h), 550, { marginalHeightMm: h });
      expect(sum.w040).toBeCloseTo(h ** 4 / (4 * R ** 3), 15);
    }
  });

  it("scales as h⁴ and 1/R³ exactly", () => {
    const a = seidelSums(sphereMirror(1600, 200), 550, { marginalHeightMm: 100 });
    const b = seidelSums(sphereMirror(1600, 200), 550, { marginalHeightMm: 50 });
    expect(a.w040 / b.w040).toBeCloseTo(16, 9);
    const c = seidelSums(sphereMirror(3200, 200), 550, { marginalHeightMm: 100 });
    expect(a.w040 / c.w040).toBeCloseTo(8, 9);
  });
});

describe("Seidel S_I — the thin-lens closed form (shape)", () => {
  const f = 1000;
  const D = 100;
  const w040 = (n: number, medium: string, q: number): number =>
    seidelSums(thinLens(f, n, q, D, medium), 550, { marginalHeightMm: D / 2 }).w040;
  const predicted = (n: number, q: number): number =>
    ((D / 2) ** 4 / (32 * f ** 3 * n * (n - 1))) * thinLensBracket(n, q);

  it("matches the published bracket over the whole shape range, at two indices", () => {
    for (const [n, medium] of [[1.5, "SEIDEL-N15"], [1.6, "SEIDEL-N16"]] as const) {
      for (const q of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        // 1e-8 relative: the residual is the honest thick-lens correction, which
        // falls linearly with the 1 nm centre thickness (1.5e-6 at 1 µm).
        expect(w040(n, medium, q) / predicted(n, q)).toBeCloseTo(1, 8);
      }
    }
  });

  it("puts the best-form minimum at q = 2(n²−1)/(n+2), the steep side toward the beam", () => {
    // The corollary of d(bracket)/dq = 0 at p = −1, and the reason a singlet for
    // parallel light is near-plano-convex with its curved face to the sky.
    for (const [n, medium] of [[1.5, "SEIDEL-N15"], [1.6, "SEIDEL-N16"]] as const) {
      const qBest = (2 * (n * n - 1)) / (n + 2);
      const best = w040(n, medium, qBest);
      for (const dq of [-0.4, -0.1, 0.1, 0.4]) expect(w040(n, medium, qBest + dq)).toBeGreaterThan(best);
      // The bending is genuinely biconvex-toward-the-beam, not plano-convex:
      expect(qBest).toBeGreaterThan(0.5);
      expect(qBest).toBeLessThan(1);
    }
  });

  it("makes a back-to-front plano-convex lens 27/7 worse, the classic orientation result", () => {
    // q = +1 is plano-convex facing the collimated beam; q = −1 is the same lens
    // turned round. bracket(1) = 7, bracket(−1) = 27 at n = 1.5.
    const ratio = w040(1.5, "SEIDEL-N15", -1) / w040(1.5, "SEIDEL-N15", 1);
    expect(ratio).toBeCloseTo(27 / 7, 5);
  });

  it("never reaches zero — a singlet cannot null its own spherical aberration", () => {
    // The parabola in q has a strictly positive minimum, which is exactly why a
    // doublet (a second glass, a second free curvature) is needed to null S_I.
    for (const q of [-2, -1, 0, 0.7143, 1, 2]) expect(w040(1.5, "SEIDEL-N15", q)).toBeGreaterThan(0);
    expect(thinLensBracket(1.5, (2 * (1.5 ** 2 - 1)) / 3.5)).toBeGreaterThan(6);
  });

  it("the shape-factor lens really is the paraxial lens it claims to be", () => {
    // Guard on the anchor's own construction: a q-scan varies only shape, so the
    // focal length must not move with q.
    for (const q of [-1, 0, 1]) {
      expect(systemProperties(thinLens(1000, 1.5, q, 100, "SEIDEL-N15"), 550).efl).toBeCloseTo(1000, 4);
    }
    expect(getMedium("SEIDEL-N15").n(550)).toBe(1.5);
  });
});

describe("Seidel S_I — the trace confirms the closed form", () => {
  /**
   * W₀₄₀ = S_I/8 is the peak wavefront error at the rim, and ρ⁴ projects onto the
   * Zernike primary-spherical term as Z₁₁/(6√5) + defocus + piston. Measured at
   * best focus (which removes the defocus) on a slow, REAL (thick) plano-convex
   * singlet — the same way the module is used on the achromat's thick
   * prescription — the traced j = 11 coefficient must be the closed form's.
   */
  const lam = LINE_D;
  const D = 50; // f/20 — slow, so fifth order has all but vanished
  const f = 1000;
  const n = indexD(getMedium("N-BK7"));
  const planoConvex: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / ((n - 1) * f), semiAperture: D / 2, thickness: 4, medium: "N-BK7", isStop: true },
      { kind: "refract", curvature: 0, semiAperture: D / 2, thickness: f, medium: "AIR" },
    ],
  };
  const s: OpticalSystem = {
    prescription: planoConvex,
    aperture: { kind: "stopRadius", value: D / 2 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: lam, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("predicts the traced primary-spherical Zernike of a slow singlet", () => {
    const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const map = opdMap(withFocus(s, focus.offsetFromLastVertex), 0, lam, pupilGrid(33));
    expect(map.lost).toBe(0);
    const traced = coefficient(fitZernike(map.samples, 15), 11);

    const w040 = seidelSums(planoConvex, lam, { marginalHeightMm: D / 2 }).w040;
    const predicted = w040 / (6 * Math.sqrt(5)) / (lam * 1e-6); // waves

    // Opposite sign in the engine's OPD convention, and just under unity in
    // magnitude because the trace carries the fifth order the closed form omits.
    const ratio = traced / predicted;
    expect(ratio).toBeLessThan(0);
    expect(Math.abs(ratio)).toBeGreaterThan(0.95);
    expect(Math.abs(ratio)).toBeLessThan(1.05);
  });
});

describe("Seidel sums refuse what they cannot compute", () => {
  it("rejects conics and aspheres rather than silently dropping their term", () => {
    const conic: Prescription = {
      surfaces: [{ kind: "reflect", curvature: -1 / 1600, conic: -1, semiAperture: 100, thickness: -800 }],
    };
    expect(() => seidelSums(conic, 550, { marginalHeightMm: 100 })).toThrow(/spherical surfaces only/);
    const asphere: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 0, asphereCoeffs: [1e-12], semiAperture: 100, thickness: 10, medium: "N-BK7" },
        { kind: "refract", curvature: 0, semiAperture: 100, thickness: 100, medium: "AIR" },
      ],
    };
    expect(() => seidelSums(asphere, 550, { marginalHeightMm: 100 })).toThrow(/spherical surfaces only/);
  });

  it("rejects an off-axis request when the stop is not the first surface", () => {
    const p: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 500, semiAperture: 50, thickness: 5, medium: "N-BK7" },
        { kind: "refract", curvature: 0, semiAperture: 50, thickness: 1000, medium: "AIR", isStop: true },
      ],
    };
    expect(() => seidelSums(p, 550, { marginalHeightMm: 50, fieldAngleRad: 0.01 })).toThrow(/stop at the first surface/);
    // On axis it is fine: no chief ray is involved.
    expect(seidelSums(p, 550, { marginalHeightMm: 50 }).s1).toBeGreaterThan(0);
  });

  it("rejects a non-positive marginal height", () => {
    expect(() => seidelSums(sphereMirror(1600, 200), 550, { marginalHeightMm: 0 })).toThrow(/positive/);
  });
});
