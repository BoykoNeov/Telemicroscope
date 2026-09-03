import { describe, expect, it } from "vitest";
import { seidelSums } from "../src/analysis/seidel";
import { thirdOrderSags } from "../src/analysis/field";
import { finiteConjugateObjective } from "../src/designs/microscope";
import type { Prescription } from "../src/trace/prescription";
import type { OpticalSystem } from "../src/trace/system";

/**
 * Step 6cm — the stop shift, moved out of the caller and into the engine.
 *
 * `analysis/seidel` computed every off-axis sum for one stop position only: the
 * first surface, where the chief ray is (ȳ = 0, ū = θ) and there is nothing to
 * solve. Anywhere else it threw. That was honest while it lasted — the module's
 * header said so in as many words — but it made a whole class of question
 * unanswerable in the engine, and it left the one place the project needed an
 * answer, § 6ae/§ 6ai's telecentric objective, writing Welford's stop-shift
 * polynomial out BY HAND in the test to get a number the engine could not
 * produce.
 *
 * ## What actually blocked it, and why it was never a search
 *
 * The paraxial recursion is LINEAR in the launch, so the chief-ray height at any
 * surface k is
 *
 *     ȳ_k = α·ȳ₀ + β·ū₀        α = ȳ_k of the launch (1, 0)
 *                              β = ȳ_k of the launch (0, 1)
 *
 * and two trial traces give α and β outright. Requiring ȳ_k = 0 at the stop then
 * leaves one equation in one unknown, closed form, no iteration. The refusal was
 * never protecting a hard problem; it was protecting an unwritten one.
 *
 * ## The external pin
 *
 * Welford, *Aberrations of Optical Systems*, ch. 8 — the stop-shift equations.
 * Move the stop and the five sums transform as
 *
 *     S_I*   = S_I                          S_IV*  = S_IV
 *     S_II*  = S_II + E·S_I
 *     S_III* = S_III + 2E·S_II + E²·S_I
 *     S_V*   = S_V + E(3·S_III + S_IV) + 3E²·S_II + E³·S_I
 *
 * with E = Δ(Ā/A), one number for the whole system. They are written HERE and
 * nowhere in `src`: computed on both sides they would be a same-process
 * identity. What is being checked is that two machineries agree while sharing no
 * line — a chief ray traced to a new stop plane, against a published polynomial
 * in E applied to the old sums.
 *
 * The degrees matter, which is why the primary rung is a SCAN over stop position
 * rather than one placement. S_II* is linear in E, S_III* quadratic, S_V* cubic;
 * a single stop tests one point on each and would pass for a system that had the
 * coefficients wrong and the argument small. Four positions spread E over a
 * factor of thirteen.
 *
 * ## What the scan can pin that a single placement cannot
 *
 *  - **E is one number.** Every text asserts the eccentricity is the same at
 *    every surface, and nothing in this repo could check it while the stop was
 *    fixed. `SeidelSurfaceTerms` now reports A and Ā, so the claim is measured
 *    surface by surface (1e-13) instead of quoted.
 *  - **E has a second, independent spelling.** The physical content of the shift
 *    is that the new chief ray is the old one plus E times the MARGINAL ray, so
 *    E is also Δȳ/y — and at the first surface that is just the solved chief
 *    height over the marginal height. The two agree to 1e-14, and they are
 *    computed from different quantities.
 *  - **S_I and S_IV come out BIT-identical, not merely equal.** Their invariance
 *    is not a tolerance here: neither involves the chief ray, the marginal ray
 *    genuinely did not move, and a flat diaphragm in air contributes exactly
 *    zero to every sum. The engine reproduces the two trivial stop-shift
 *    equations by not doing arithmetic, which is the strongest form the claim
 *    has.
 *
 * ## And the headline, which is a lens that ships
 *
 * `finiteConjugateObjective` builds the same glass twice — `"rim"` with the stop
 * at the front vertex, `"backFocal"` with a diaphragm at the rear focal plane.
 * Surface for surface the two prescriptions are identical: same curvatures, same
 * semi-apertures, same media, same air-equivalent object distance to the last
 * digit. The only differences are which surface carries `isStop` and a trailing
 * gap that reaches the diaphragm. So the engine's DIRECT sums on the back-focal
 * member must be the rim member's sums put through Welford — and they are, to
 * 4e-16.
 *
 * That closes the loop § 6ae opened and § 6ai carried: the −70.7001 distortion
 * lever those steps predicted by hand is now what the engine returns when simply
 * asked, and § 6ai's traced ray still sits 0.024% away from it.
 *
 * The solve gets one check that does not go through the sums at all. A stop at
 * the objective's rear focal plane puts the entrance pupil at infinity, so the
 * chief ray in object space is parallel to the axis: ū₀ = 0 and ȳ₀ = η, exactly.
 * That is *why* § 6ai's hand-written E was η/h, and it is now a property of the
 * solve rather than an assumption behind it.
 */

const LAM = 587.5618;

/**
 * A thick cemented doublet with its stop at the front vertex — the unshifted
 * member. Nothing about the design matters except that all five sums are
 * non-zero, so no term of any stop-shift equation is tested against a system
 * that happened to null it.
 */
const DOUBLET: Prescription = {
  surfaces: [
    { kind: "refract", curvature: 1 / 300, semiAperture: 25, thickness: 8, medium: "N-BK7", isStop: true },
    { kind: "refract", curvature: -1 / 180, semiAperture: 25, thickness: 4, medium: "F2" },
    { kind: "refract", curvature: 1 / 900, semiAperture: 25, thickness: 0, medium: "AIR" },
  ],
};

/**
 * The same doublet with the stop moved to a flat air diaphragm `d` behind it.
 * The diaphragm has zero curvature in a medium it does not change, so φ = 0 and
 * Δ(u/n) = 0 there: it contributes exactly nothing to any sum and the two
 * members differ by the chief ray alone. That is what makes this a stop shift
 * rather than a comparison of two lenses.
 */
const withDiaphragmAt = (d: number): Prescription => ({
  surfaces: [
    { ...DOUBLET.surfaces[0]!, isStop: false },
    DOUBLET.surfaces[1]!,
    { ...DOUBLET.surfaces[2]!, thickness: d },
    { kind: "refract", curvature: 0, semiAperture: 25, thickness: 0, medium: "AIR", isStop: true },
  ],
});

const H = 25;
const THETA = 0.02;

/** The stop does not move the marginal ray, so both members get the same one. */
const APERTURE = { marginalHeightMm: H, distortion: true } as const;

describe("§ 6cm.0 — a displaced stop, against Welford's stop-shift equations", () => {
  const rim = seidelSums(DOUBLET, LAM, { ...APERTURE, fieldAngleRad: THETA });
  const PLACEMENTS = [20, 60, 140, 300];

  it("has all five sums live, so no equation is checked against an accidental zero", () => {
    for (const v of [rim.s1, rim.s2, rim.s3, rim.s4, rim.s5!]) {
      expect(Math.abs(v)).toBeGreaterThan(1e-9);
    }
  });

  it("EXTERNAL: reproduces S_II*, S_III* and S_V* across a 13× range of E", () => {
    for (const d of PLACEMENTS) {
      const shifted = seidelSums(withDiaphragmAt(d), LAM, { ...APERTURE, fieldAngleRad: THETA });
      const E = (shifted.surfaces[0]!.ab - rim.surfaces[0]!.ab) / rim.surfaces[0]!.a;

      expect(shifted.s2).toBeCloseTo(rim.s2 + E * rim.s1, 12);
      expect(Math.abs(shifted.s2 / (rim.s2 + E * rim.s1) - 1)).toBeLessThan(1e-13);

      const p3 = rim.s3 + 2 * E * rim.s2 + E * E * rim.s1;
      expect(Math.abs(shifted.s3 / p3 - 1)).toBeLessThan(1e-13);

      const p5 = rim.s5! + E * (3 * rim.s3 + rim.s4) + 3 * E * E * rim.s2 + E * E * E * rim.s1;
      expect(Math.abs(shifted.s5! / p5 - 1)).toBeLessThan(1e-13);
    }
    // The range itself, so the rung above cannot quietly become four copies of
    // one placement: E runs from −0.023 to −0.293.
    const es = PLACEMENTS.map((d) => {
      const s = seidelSums(withDiaphragmAt(d), LAM, { ...APERTURE, fieldAngleRad: THETA });
      return (s.surfaces[0]!.ab - rim.surfaces[0]!.ab) / rim.surfaces[0]!.a;
    });
    expect(Math.abs(es[3]! / es[0]!)).toBeGreaterThan(12);
  });

  it("S_I and S_IV are stop-invariant to the BIT, not to a tolerance", () => {
    // The two trivial equations of the set, and the engine satisfies them by
    // arithmetic it never performs: S_I and S_IV carry no chief ray, the
    // marginal ray is the same object, and the diaphragm's own contribution is
    // an exact zero on all four terms.
    for (const d of PLACEMENTS) {
      const shifted = seidelSums(withDiaphragmAt(d), LAM, { ...APERTURE, fieldAngleRad: THETA });
      expect(shifted.s1).toBe(rim.s1);
      expect(shifted.s4).toBe(rim.s4);
      // `Math.abs` because an exact zero still carries a sign bit, and which
      // one a product of signed factors lands on is not physics.
      const dia = shifted.surfaces[3]!;
      for (const term of [dia.s1, dia.s2, dia.s3, dia.s4, dia.s5!]) expect(Math.abs(term)).toBe(0);
    }
  });

  it("E is ONE number — the same at every surface, and the same measured two ways", () => {
    for (const d of PLACEMENTS) {
      const shifted = seidelSums(withDiaphragmAt(d), LAM, { ...APERTURE, fieldAngleRad: THETA });
      // Δ(Ā/A), surface by surface. Textbooks assert this is constant; with A
      // and Ā reported it is now measured.
      const perSurface = rim.surfaces.map((s, k) => (shifted.surfaces[k]!.ab - s.ab) / s.a);
      for (const e of perSurface) {
        expect(Math.abs(e / perSurface[0]! - 1)).toBeLessThan(1e-13);
      }
      // The other spelling: the new chief ray is the old one plus E times the
      // MARGINAL ray, so E is also Δȳ/y — at the first surface, the solved
      // chief height over the marginal height. Different quantities entirely.
      const fromLaunch = (shifted.chiefHeightMm - rim.chiefHeightMm) / H;
      expect(Math.abs(fromLaunch / perSurface[0]! - 1)).toBeLessThan(1e-14);
    }
  });
});

describe("§ 6cm.1 — the shipped telecentric objective, asked directly", () => {
  const rimObj = finiteConjugateObjective({
    magnification: 4,
    numericalAperture: 0.1,
    stopPlacement: "rim",
  });
  const bfObj = finiteConjugateObjective({
    magnification: 4,
    numericalAperture: 0.1,
    stopPlacement: "backFocal",
  });
  const s = rimObj.airEquivalentObjectDistanceMm;
  const marginalHeightMm = s * (0.1 / Math.sqrt(1 - 0.01));
  const at = (objectHeightMm: number) =>
    ({
      marginalHeightMm,
      objectDistanceMm: s,
      fieldAngleRad: -objectHeightMm / s,
      distortion: true,
    }) as const;
  const HEIGHTS = [0.25, 0.5, 1];

  it("is the same glass twice — only `isStop` and a trailing gap differ", () => {
    // The premise of every comparison below. If the two placements re-solved the
    // design, this would be two lenses and not one stop shift.
    expect(bfObj.airEquivalentObjectDistanceMm).toBe(s);
    const rimS = rimObj.prescription.surfaces;
    const bfS = bfObj.prescription.surfaces;
    expect(bfS.length).toBe(rimS.length + 1);
    for (let i = 0; i < rimS.length; i++) {
      expect(bfS[i]!.curvature).toBe(rimS[i]!.curvature);
      expect(bfS[i]!.semiAperture).toBe(rimS[i]!.semiAperture);
      expect(bfS[i]!.medium).toBe(rimS[i]!.medium);
      // Every gap but the last, which is what reaches the diaphragm.
      if (i < rimS.length - 1) expect(bfS[i]!.thickness).toBe(rimS[i]!.thickness);
    }
    const diaphragm = bfS[bfS.length - 1]!;
    expect(diaphragm.curvature).toBe(0);
    expect(diaphragm.isStop).toBe(true);
    expect(rimS.some((x) => x.isStop === true)).toBe(true);
  });

  it("the solve says telecentric without being told: ū₀ = 0 and ȳ₀ = η, exactly", () => {
    // A stop at the rear focal plane puts the entrance pupil at infinity, so the
    // object-space chief ray is parallel to the axis. Nothing about the sums is
    // involved — this checks the chief-ray solve on its own, against a pupil
    // position the design places by construction.
    for (const objectHeightMm of HEIGHTS) {
      const b = seidelSums(bfObj.prescription, LAM, at(objectHeightMm));
      // Exactly zero — `Math.abs` only because the sign bit of a zero is not a
      // statement about the ray.
      expect(Math.abs(b.chiefSlopeRad)).toBe(0);
      expect(b.chiefHeightMm).toBe(objectHeightMm);
      // Which is exactly why § 6ai could write E = η/h by hand.
      const r = seidelSums(rimObj.prescription, LAM, at(objectHeightMm));
      const engineE = (b.surfaces[0]!.ab - r.surfaces[0]!.ab) / r.surfaces[0]!.a;
      expect(Math.abs(engineE / (objectHeightMm / marginalHeightMm) - 1)).toBeLessThan(1e-14);
    }
  });

  it("EXTERNAL: the −70.7001 distortion lever now falls out of the engine, not the test", () => {
    // § 6ae predicted this ratio by applying Welford's S_V* equation to the rim
    // member's sums by hand, because `seidelSums` refused the back-focal member
    // outright. Asked directly, it returns the same number — and the identity is
    // field-free, E going as η and S_V as η³, which is the check that E is a
    // ratio and not a height.
    const direct = HEIGHTS.map((objectHeightMm) => {
      const r = seidelSums(rimObj.prescription, LAM, at(objectHeightMm));
      const b = seidelSums(bfObj.prescription, LAM, at(objectHeightMm));
      const E = objectHeightMm / marginalHeightMm;
      const welford = r.s5! + E * (3 * r.s3 + r.s4) + 3 * E * E * r.s2 + E * E * E * r.s1;
      // ΣS_I is zero by construction (§ 6b), so the cubic term never appears.
      expect(Math.abs(r.s1)).toBeLessThan(1e-15);
      expect(Math.abs(b.s5! / welford - 1)).toBeLessThan(1e-12);
      return b.s5! / r.s5!;
    });
    for (const ratio of direct) {
      expect(ratio).toBeCloseTo(-70.7001, 3);
      expect(Math.abs(ratio / direct[0]! - 1)).toBeLessThan(1e-12);
    }
    // § 6ai's traced skew ray reads −70.7169 on the same pair. The gap is the
    // fifth-order residue, and it has not moved by the engine learning to
    // compute the third-order side itself.
    expect(Math.abs(direct[0]! / -70.7169 - 1)).toBeLessThan(3e-4);
  });
});

describe("§ 6cm.2 — the sag readout inherits the lifted restriction", () => {
  const infiniteWithDiaphragm: OpticalSystem = {
    prescription: withDiaphragmAt(140),
    aperture: { kind: "stopRadius", value: 25 },
    field: { kind: "angle", values: [1] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("`thirdOrderSags` accepts a stop off the first surface, and stays 3:1", () => {
    // It refused any placement but surface 0 until this step, for no reason of
    // its own: the refusal was `seidelSums`' passed through. The classical
    // relation x_t − x_p = 3(x_s − x_p) is an identity in S_III and S_IV, so it
    // holds at any stop — but it only holds on numbers that were computed, and
    // before § 6cm there were none to check.
    const sags = thirdOrderSags(infiniteWithDiaphragm, 1, LAM);
    expect(Number.isFinite(sags.sagittalMm)).toBe(true);
    expect(Math.abs(sags.tangentialMm - sags.petzvalMm)).toBeGreaterThan(1e-9);
    expect(sags.tangentialMm - sags.petzvalMm).toBeCloseTo(3 * (sags.sagittalMm - sags.petzvalMm), 12);
  });

  it("and it fills the STOP, which off surface 0 is not the first surface's height", () => {
    // The radius `pupils()` reports is measured at the stop; the height
    // `seidelSums` launches from is at surface 0. They are the same number only
    // when the stop is surface 0, and pairing one with the other would be a
    // silent factor. The diaphragm sits 140 mm behind a converging doublet, so
    // the two differ by a lot.
    const solved = seidelSums(withDiaphragmAt(140), LAM, {
      marginalRadiusAtStopMm: 25,
      fieldAngleRad: (1 * Math.PI) / 180,
    });
    expect(solved.marginalHeightMm).toBeGreaterThan(25 * 1.05);
    // And the two spellings agree: launched from the solved height, the marginal
    // ray does arrive at the stop with the radius that was asked for.
    const check = seidelSums(withDiaphragmAt(140), LAM, {
      marginalHeightMm: solved.marginalHeightMm,
      fieldAngleRad: (1 * Math.PI) / 180,
    });
    expect(check.s1).toBe(solved.s1);
    expect(check.s2).toBe(solved.s2);
  });

  it("and it survives a stop PAST focus, where the marginal ray arrives inverted", () => {
    // The scan above puts every diaphragm ahead of the marginal focus, so the
    // trial trace that converts a stop radius into a first-surface height comes
    // back positive every time and the absolute value in `seidelSums` does
    // nothing. This doublet focuses about 2090 mm behind its last vertex; a
    // diaphragm at 4000 mm is past that, and the marginal ray reaches it having
    // already crossed the axis — the case the absolute value is for.
    //
    // That the crossing really happens is visible in the height needed to fill a
    // 25 mm stop: it diverges at focus and comes back down the far side. A ray
    // that merely converged more slowly would be monotone.
    const heightFor = (d: number) =>
      seidelSums(withDiaphragmAt(d), LAM, { marginalRadiusAtStopMm: 25, fieldAngleRad: THETA })
        .marginalHeightMm;
    expect(heightFor(2100)).toBeGreaterThan(10 * heightFor(140));
    expect(heightFor(4000)).toBeLessThan(heightFor(2100) / 100);

    // And the aperture is a RADIUS, so the height that fills it is positive on
    // both sides of focus. Signed, this would come back negative and the sums
    // odd in the marginal height — S_II, S_V — would quietly change sign.
    expect(heightFor(4000)).toBeGreaterThan(0);
    expect(heightFor(6000)).toBeGreaterThan(0);

    // Welford holds there too, and E has crossed with the ray: it is −0.129 at
    // 140 mm and +3.57 at 4000 mm, so this is not the scan re-run at a fourth
    // point on the same side.
    const unshifted = seidelSums(DOUBLET, LAM, { ...APERTURE, fieldAngleRad: THETA });
    const shifted = seidelSums(withDiaphragmAt(4000), LAM, { ...APERTURE, fieldAngleRad: THETA });
    const E = (shifted.surfaces[0]!.ab - unshifted.surfaces[0]!.ab) / unshifted.surfaces[0]!.a;
    expect(E).toBeGreaterThan(3);
    const p5 =
      unshifted.s5! +
      E * (3 * unshifted.s3 + unshifted.s4) +
      3 * E * E * unshifted.s2 +
      E * E * E * unshifted.s1;
    expect(Math.abs(shifted.s5! / p5 - 1)).toBeLessThan(1e-13);
    expect(Math.abs(shifted.s2 / (unshifted.s2 + E * unshifted.s1) - 1)).toBeLessThan(1e-13);
  });

  it("with the stop AT surface 0 the two spellings are the same number, bit for bit", () => {
    const byHeight = seidelSums(DOUBLET, LAM, { marginalHeightMm: 25, fieldAngleRad: THETA });
    const byStop = seidelSums(DOUBLET, LAM, { marginalRadiusAtStopMm: 25, fieldAngleRad: THETA });
    expect(byStop.marginalHeightMm).toBe(25);
    expect(byStop.s1).toBe(byHeight.s1);
    expect(byStop.s2).toBe(byHeight.s2);
    expect(byStop.s3).toBe(byHeight.s3);
    expect(byStop.s4).toBe(byHeight.s4);
  });
});

describe("§ 6cm.3 — what a displaced stop still refuses", () => {
  it("refuses an off-axis sum with no stop flagged anywhere", () => {
    const noStop: Prescription = { surfaces: DOUBLET.surfaces.map((s) => ({ ...s, isStop: false })) };
    expect(() => seidelSums(noStop, LAM, { marginalHeightMm: H, fieldAngleRad: THETA })).toThrow(/isStop/);
    // On axis it is still fine: no chief ray is involved, so no stop is needed.
    expect(seidelSums(noStop, LAM, { marginalHeightMm: H }).s1).toBe(seidelSums(DOUBLET, LAM, { marginalHeightMm: H }).s1);
  });

  it("refuses the entrance pupil at infinity when the object is too", () => {
    // A concave mirror with the diaphragm exactly at its focal plane. The
    // curvature is a power of two so that α is an exact zero rather than a small
    // number, which is the only case that is genuinely unsolvable: at a finite
    // conjugate the same placement is merely telecentric and computes fine.
    const atFocus: Prescription = {
      surfaces: [
        { kind: "reflect", curvature: -1 / 1024, semiAperture: 100, thickness: -512 },
        { kind: "refract", curvature: 0, semiAperture: 50, thickness: 0, medium: "AIR", isStop: true },
      ],
    };
    expect(() => seidelSums(atFocus, 550, { marginalHeightMm: 100, fieldAngleRad: 0.01 })).toThrow(
      /entrance pupil is at infinity/,
    );
    expect(seidelSums(atFocus, 550, { marginalHeightMm: 100, objectDistanceMm: 4000, fieldAngleRad: 0.01 }).s3).toBeTypeOf(
      "number",
    );
  });

  it("refuses an aperture stated twice, or not at all", () => {
    expect(() => seidelSums(DOUBLET, LAM, { marginalHeightMm: H, marginalRadiusAtStopMm: H })).toThrow(
      /exactly one/,
    );
    expect(() => seidelSums(DOUBLET, LAM, {})).toThrow(/exactly one/);
    expect(() => seidelSums(DOUBLET, LAM, { marginalRadiusAtStopMm: 0 })).toThrow(/positive/);
  });
});
