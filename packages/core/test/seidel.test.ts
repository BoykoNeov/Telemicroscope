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
 *
 * § 6b adds the **position factor** p to the same bracket — the object conjugate,
 * which the module previously fixed at infinity (p = −1). The p² and p·q terms
 * are what a finite conjugate switches on, and they are the reason a microscope
 * objective cannot reuse an infinity-solved bending.
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

/** The same mirror with a figure on it: conic K, still concave toward +z. */
const conicMirror = (R: number, K: number, D: number): Prescription => ({
  surfaces: [
    { kind: "reflect", curvature: -1 / R, conic: K, semiAperture: D / 2, thickness: -R / 2, isStop: true },
  ],
});

describe("§ 5j.3 — the conic's own third-order term", () => {
  it("W₀₄₀ = h⁴(1 + K)/(4R³): the sphere's anchor times the conic's own factor", () => {
    // The sphere's h⁴/(4R³) (above) is the K = 0 member of one closed form. The
    // (1 + K) is the same factor that appears in a conic's sag — the quartic
    // departure from the base sphere is K·c³·r⁴/8, and the sphere's own quartic
    // is c³r⁴/8 — so this row pins the new term's SIGN and SCALE against a
    // number the module already reproduces, at four conics and three fixtures.
    for (const [R, h] of [[1600, 100], [800, 50], [2000, 25]] as const) {
      for (const K of [0, -0.5, -1, -2, 1] as const) {
        const sum = seidelSums(conicMirror(R, K, 2 * h), 550, { marginalHeightMm: h });
        expect(sum.w040).toBeCloseTo((h ** 4 * (1 + K)) / (4 * R ** 3), 15);
      }
    }
  });

  it("is EXACTLY linear in K — § 5i's published claim, checkable for the first time", () => {
    // "Third-order spherical aberration is exactly linear in each mirror's
    // conic" is what § 5i's two-mirror corrector formula rests on, and until the
    // module took a conic nothing could check it. A straight line has no second
    // difference: three equally spaced conics must satisfy s1(K−δ) − 2s1(K) +
    // s1(K+δ) = 0, and it comes out at the f64 floor rather than at a tolerance.
    const scale = Math.abs(seidelSums(conicMirror(1600, 0, 200), 550, { marginalHeightMm: 100 }).s1);
    const at = (K: number): number =>
      seidelSums(conicMirror(1600, K, 200), 550, { marginalHeightMm: 100 }).s1;
    for (const [K, d] of [[-1, 0.25], [-4, 1], [0, 2]] as const) {
      const second = at(K - d) - 2 * at(K) + at(K + d);
      expect(Math.abs(second)).toBeLessThan(1e-14 * scale);
    }
  });

  it("THE PIN: a paraboloid images a collimated beam stigmatically, so ΣS_I = 0", () => {
    // This is what fixes the constant in front of the whole aspheric set, and
    // it is external to every convention in this module: a parabola's focus is
    // a focus, at any radius and any aperture. The cancellation is between two
    // separately-built expressions, so it lands at the f64 floor rather than at
    // exact zero — 15 orders below the sphere it cancels.
    for (const [R, h] of [[1600, 100], [800, 50], [2000, 25], [400, 100]] as const) {
      const sphere = seidelSums(conicMirror(R, 0, 2 * h), 550, { marginalHeightMm: h });
      const parabola = seidelSums(conicMirror(R, -1, 2 * h), 550, { marginalHeightMm: h });
      expect(Math.abs(parabola.s1)).toBeLessThan(1e-15 * Math.abs(sphere.s1));
      expect(Math.abs(sphere.s1)).toBeGreaterThan(0);
    }
  });

  it("a conic figured AT THE STOP moves S_I and nothing else, to the bit", () => {
    // Every aspheric field term carries the chief ray height ȳ, which is 0 at
    // the stop — so the whole set collapses to ΔS_I there. That is why a
    // paraboloid's coma is a sphere's, and it is the negative control on the new
    // code: S_II, S_III and S_IV must be the IDENTICAL doubles at every conic.
    const off = { marginalHeightMm: 100, fieldAngleRad: 0.005 };
    const base = seidelSums(conicMirror(1600, 0, 200), 550, off);
    for (const K of [-1, -2, -0.3, 3] as const) {
      const figured = seidelSums(conicMirror(1600, K, 200), 550, off);
      expect(figured.s2).toBe(base.s2);
      expect(figured.s3).toBe(base.s3);
      expect(figured.s4).toBe(base.s4);
      expect(figured.s1).not.toBe(base.s1);
    }
  });

  it("and the sagittal field of a mirror stopped at itself is FLAT, at every conic", () => {
    // S_III + S_IV = n²ū²y²c(n′ − n)(n + n′)/(n·n′²) for a single surface with
    // the stop on it, collimated in (a finite conjugate puts (u + y·c) where
    // the y·c is and keeps the same factor), and a mirror is n′ = −n, so the
    // bracket vanishes identically. `thirdOrderSags` turns that into x_s = 0: the sagittal focal
    // surface of a bare mirror IS the paraxial focal plane, however it is
    // figured. It cancels between two expressions, so it is a floor and not a
    // zero — quoted against S_IV, the larger of the two.
    for (const K of [0, -1, -2] as const) {
      const s = seidelSums(conicMirror(1600, K, 200), 550, {
        marginalHeightMm: 100,
        fieldAngleRad: 0.005,
      });
      expect(Math.abs(s.s3 + s.s4)).toBeLessThan(1e-15 * Math.abs(s.s4));
      expect(Math.abs(s.s4)).toBeGreaterThan(0);
    }
  });
});

describe("§ 5j.3 — the ellipsoid, where the conic and a finite conjugate meet", () => {
  // A prolate spheroid reflects one focus onto the other, exactly. Written from
  // the ELLIPSE rather than from any aberration formula: semi-major
  // a = (s + s′)/2, half focal separation c = (s′ − s)/2, so e = (s′ − s)/(s′ + s)
  // and the vertex radius is b²/a = a(1 − e²) = 2ss′/(s + s′). The conic
  // constant of an ellipse is −e². Nothing below is third-order theory; that is
  // the point — the module has to land on it.
  const S = 600;
  const SP = 1200;
  const E = (SP - S) / (SP + S);
  const R = (2 * S * SP) / (S + SP);
  const K_ELLIPSE = -(E * E);
  const H = 100;

  const mirror = (K: number): Prescription => ({
    surfaces: [
      { kind: "reflect", curvature: -1 / R, conic: K, semiAperture: H, thickness: -SP, isStop: true },
    ],
  });

  it("the geometry is the ellipse's own: e = 1/3, R = 800, K = −1/9", () => {
    expect(E).toBeCloseTo(1 / 3, 15);
    expect(R).toBeCloseTo(800, 12);
    expect(K_ELLIPSE).toBeCloseTo(-1 / 9, 15);
    // And the mirror equation the same radius satisfies, from the other side.
    expect(1 / S + 1 / SP).toBeCloseTo(2 / R, 15);
  });

  it("the module's S_I = 0 root lands on the ellipse's own conic", () => {
    const at = (K: number): number =>
      seidelSums(mirror(K), 550, { marginalHeightMm: H, objectDistanceMm: S }).s1;
    // Linear in K, so the root is one division — no search, and no fit.
    const a = at(0);
    const b = at(-1);
    // s1(K) = a + (a − b)·K, since b is its value at K = −1.
    const root = a / (b - a);
    expect(root).toBeCloseTo(K_ELLIPSE, 12);
    expect(Math.abs(at(K_ELLIPSE))).toBeLessThan(1e-15 * Math.abs(a));
  });

  it("and the trace agrees to ALL orders, where third-order theory only says the third", () => {
    const system = (K: number): OpticalSystem => ({
      prescription: mirror(K),
      aperture: { kind: "stopRadius", value: H },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: 550, weight: 1 }],
      conjugate: { kind: "finite", distance: S },
    });
    const map = opdMap(system(K_ELLIPSE), 0, 550, pupilGrid(21));
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeLessThan(1e-5);

    // NEGATIVE CONTROL: the sphere of the same vertex radius, same aperture.
    const sphere = opdMap(system(0), 0, 550, pupilGrid(21));
    expect(sphere.lost).toBe(0);
    expect(sphere.rmsWaves).toBeGreaterThan(1);
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

describe("Seidel S_I — the position factor (finite object conjugates, § 6b)", () => {
  const f = 1000;
  const D = 100;
  const h = D / 2;
  const w040 = (n: number, medium: string, q: number, objectDistanceMm?: number): number =>
    seidelSums(thinLens(f, n, q, D, medium), 550, {
      marginalHeightMm: h,
      ...(objectDistanceMm === undefined ? {} : { objectDistanceMm }),
    }).w040;
  const predicted = (n: number, q: number, p: number): number =>
    ((h ** 4 / (32 * f ** 3 * n * (n - 1))) * thinLensBracket(n, q, p));
  /** The published position factor p = 1 − 2f/s′, from the object distance. */
  const positionFactor = (s: number): number => 1 - 2 * f / (1 / (1 / f - 1 / s));

  const LENSES = [[1.5, "SEIDEL-N15"], [1.6, "SEIDEL-N16"]] as const;

  it("puts p = 0 at s = s′ = 2f — the case that fixes the sign", () => {
    // THE discriminating check. p = 0 is the symmetric conjugate pair, whose
    // geometry is known independently of the bracket: if the marginal ray's
    // launch slope u = h/s had the wrong sign, p = 0 would land at some other
    // object distance and every q below would disagree. It is checked across the
    // shape range so it cannot pass by a coincidence at one q.
    expect(positionFactor(2 * f)).toBeCloseTo(0, 12);
    for (const [n, medium] of LENSES) {
      for (const q of [-1, -0.5, 0, 0.5, 1]) {
        expect(w040(n, medium, q, 2 * f) / predicted(n, q, 0)).toBeCloseTo(1, 8);
      }
    }
  });

  it("matches the published bracket across the whole p range, at two indices", () => {
    // s/f from 1.5 (p = +1/3, the object close in) to 11 (p = −0.82, nearly
    // collimated). The p = −1 end is already pinned above; this is the rest of
    // the polynomial, including the p·q cross-term, which no infinite-conjugate
    // evaluation can see.
    for (const [n, medium] of LENSES) {
      for (const sOverF of [1.5, 2, 3, 5, 11]) {
        const s = sOverF * f;
        const p = positionFactor(s);
        for (const q of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
          expect(w040(n, medium, q, s) / predicted(n, q, p)).toBeCloseTo(1, 8);
        }
      }
    }
  });

  it("moves the best-form shape with the conjugate: q_best(p) = −2(n²−1)p/(n+2)", () => {
    // d(bracket)/dq = 0 generalised off p = −1. The classical best-form minimum
    // pinned above is this law's p = −1 case, which is the evidence that the two
    // agree about the sign of p rather than each being self-consistent.
    for (const [n, medium] of LENSES) {
      expect((-2 * (n * n - 1) * -1) / (n + 2)).toBeCloseTo((2 * (n * n - 1)) / (n + 2), 12);
      for (const sOverF of [1.5, 2, 3, 5]) {
        const s = sOverF * f;
        const qBest = (-2 * (n * n - 1) * positionFactor(s)) / (n + 2);
        const best = w040(n, medium, qBest, s);
        for (const dq of [-0.4, -0.1, 0.1, 0.4]) {
          expect(w040(n, medium, qBest + dq, s)).toBeGreaterThan(best);
        }
      }
    }
  });

  it("turns the best form ROUND once the object comes inside 2f", () => {
    // The corollary worth naming: q_best has the opposite sign to p, so a lens
    // working at p > 0 (object nearer than 2f) wants its steep face toward the
    // IMAGE — the reverse of the collimated-beam rule. This is the thin-lens
    // shadow of § 6a.1's orientation finding, and the reason § 6b re-solves.
    const n = 1.5;
    const medium = "SEIDEL-N15";
    const near = 1.5 * f; // p = +1/3
    expect(positionFactor(near)).toBeGreaterThan(0);
    const qNear = (-2 * (n * n - 1) * positionFactor(near)) / (n + 2);
    expect(qNear).toBeLessThan(0);
    // …and the classical collimated best form is genuinely the WORSE shape there.
    const qCollimated = (2 * (n * n - 1)) / (n + 2);
    expect(w040(n, medium, qCollimated, near)).toBeGreaterThan(w040(n, medium, qNear, near));
  });

  it("still cannot be nulled: a singlet's parabola in q stays positive at every p", () => {
    // The § 5j motivation, checked off p = −1 too: no conjugate rescues a singlet.
    for (const [n, medium] of LENSES) {
      for (const sOverF of [1.5, 2, 3, 5]) {
        for (const q of [-2, -1, 0, 0.5, 1, 2]) {
          expect(w040(n, medium, q, sOverF * f)).toBeGreaterThan(0);
        }
      }
    }
  });

  it("recovers the collimated case in the limit, and is identical when omitted", () => {
    const n = 1.5;
    const medium = "SEIDEL-N15";
    for (const q of [-1, 0, 0.7, 2]) {
      // Omitting the option is not "approximately infinity", it IS u = 0 — the
      // non-regression guarantee every pre-§ 6b caller rests on.
      expect(w040(n, medium, q)).toBe(predictedInfinity(n, medium, q));
      // …and a very distant object converges onto it from the finite side.
      expect(w040(n, medium, q, 1e9 * f) / w040(n, medium, q)).toBeCloseTo(1, 7);
    }
  });

  /** The infinite-conjugate value, computed the way every existing caller does. */
  function predictedInfinity(n: number, medium: string, q: number): number {
    return seidelSums(thinLens(f, n, q, D, medium), 550, { marginalHeightMm: h }).w040;
  }

  it("rejects an object distance that is not a positive finite length", () => {
    for (const bad of [0, -100, Infinity, NaN]) {
      expect(() =>
        seidelSums(thinLens(f, 1.5, 0, D, "SEIDEL-N15"), 550, {
          marginalHeightMm: h,
          objectDistanceMm: bad,
        }),
      ).toThrow(/positive finite distance/);
    }
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
  it("~~rejects conics and aspheres~~ — computes them (§ 5j.3)", () => {
    // The refusal was the scope note rather than a hard problem: a quartic
    // departure from the base sphere is a phase plate on the surface, and its
    // whole third-order set is one constant times powers of the two ray
    // heights. The rungs for what the answer has to satisfy are in the § 5j.3
    // blocks below and in `conic-field.test.ts`; what is left here is that the
    // request is no longer refused and that both shapes now return numbers.
    const conic: Prescription = {
      surfaces: [{ kind: "reflect", curvature: -1 / 1600, conic: -1, semiAperture: 100, thickness: -800 }],
    };
    expect(Number.isFinite(seidelSums(conic, 550, { marginalHeightMm: 100 }).s1)).toBe(true);
    const asphere: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 0, asphereCoeffs: [1e-12], semiAperture: 100, thickness: 10, medium: "N-BK7" },
        { kind: "refract", curvature: 0, semiAperture: 100, thickness: 100, medium: "AIR" },
      ],
    };
    expect(Number.isFinite(seidelSums(asphere, 550, { marginalHeightMm: 100 }).s1)).toBe(true);
  });

  it("still rejects a FOLDED chain's asphere past a mirror, whose unfolded sign is undefined", () => {
    // `unfoldedTwin` flips curvature by the mirror parity and leaves A₄ alone,
    // so the twin's sag would be right in its conic part and wrong in its
    // polynomial one. Nothing in the catalogue is shaped this way; the throw is
    // what keeps that from being discovered as a wrong number.
    const folded: Prescription = {
      mirrorFrames: "folded",
      surfaces: [
        { kind: "reflect", curvature: -1 / 1600, conic: -1, semiAperture: 100, thickness: 800 },
        { kind: "refract", curvature: 0, asphereCoeffs: [1e-12], semiAperture: 20, thickness: 5, medium: "N-BK7" },
        { kind: "refract", curvature: 0, semiAperture: 20, thickness: 100, medium: "AIR" },
      ],
    };
    expect(() => seidelSums(folded, 550, { marginalHeightMm: 100 })).toThrow(/folded chain/);
    // A conic past the same mirror is fine: the conic constant is
    // parity-invariant, because flipping c flips the whole sag term by term.
    const foldedConic: Prescription = {
      mirrorFrames: "folded",
      surfaces: [
        { kind: "reflect", curvature: -1 / 1600, conic: -1, semiAperture: 100, thickness: 800 },
        { kind: "reflect", curvature: 0, semiAperture: 20, thickness: 100 },
      ],
    };
    expect(Number.isFinite(seidelSums(foldedConic, 550, { marginalHeightMm: 100 }).s1)).toBe(true);
  });

  it("~~rejects an off-axis request when the stop is not the first surface~~ — answers it (§ 6cm)", () => {
    const p: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 500, semiAperture: 50, thickness: 5, medium: "N-BK7" },
        { kind: "refract", curvature: 0, semiAperture: 50, thickness: 1000, medium: "AIR", isStop: true },
      ],
    };
    // This threw until § 6cm, and the refusal was the scope note rather than a
    // hard problem: the stop is the flat a metre behind the lens, and the chief
    // ray through its centre is a two-unknown linear solve. The rungs for what
    // the answer has to satisfy are in test/stop-shift.ts; what is left here is
    // that the request is no longer refused, and that lifting it moved nothing
    // on axis.
    const axial = seidelSums(p, 550, { marginalHeightMm: 50 });
    const off = seidelSums(p, 550, { marginalHeightMm: 50, fieldAngleRad: 0.01 });
    expect(axial.s1).toBeGreaterThan(0);
    expect(off.chiefHeightMm).not.toBe(0);
    expect(Number.isFinite(off.s3)).toBe(true);
    // S_I carries no chief ray, so it is the same number to the bit either way.
    expect(off.s1).toBe(axial.s1);
  });

  it("rejects a non-positive marginal height", () => {
    expect(() => seidelSums(sphereMirror(1600, 200), 550, { marginalHeightMm: 0 })).toThrow(/positive/);
  });
});
