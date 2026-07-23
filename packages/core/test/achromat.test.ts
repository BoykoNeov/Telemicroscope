import { describe, it, expect } from "vitest";
import { achromaticObjective } from "../src/designs/achromat";
import { seidelSums } from "../src/analysis/seidel";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { systemProperties } from "../src/trace/paraxial";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, coefficient } from "../src/wave/zernike";
import { psf } from "../src/wave/psf";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { getMedium } from "../src/materials/catalog";
import { abbeNumber, indexD, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";

/**
 * Rungs for the achromatic doublet objective — the refractor preset
 * (docs/VALIDATION.md § 5j).
 *
 * The design is computed, not transcribed: the power split comes from the glass
 * catalog's Abbe numbers, and the one remaining freedom — the bending — is solved
 * by setting the third-order spherical aberration sum S_I to zero, using the
 * published Seidel formulas pinned in § 5j's first half. So every claim below is a
 * *prediction* the exact trace can refuse:
 *
 *  - the closed-form power split, and an EFL that misses D·F only by the thick-lens
 *    term the design honestly leaves in;
 *  - F and C landing together (two orders better than a singlet of the same power),
 *    because the Abbe numbers say so — a thin-lens closed form applied to a thick
 *    lens, so the residual is O(t/f) and shrinks as the lens slows;
 *  - the secondary spectrum, the residual the glass PAIR cannot fix, matching
 *    −(P₁−P₂)/(V₁−V₂) from the catalog's partial dispersions;
 *  - spherical aberration nulled to third order — diffraction-limited at ordinary
 *    focal ratios, ~60× better than an equal-power singlet — with a FIFTH-order
 *    residual that falls 32× per doubling of focal ratio, the 2⁵ signature;
 *  - the two SA-null bendings straddling the coma-free one, their S_II values
 *    predicting the traced Zernike coma of each to ~2%.
 */

const LAM = LINE_D;
const D = 100;

const system = (p: Prescription, deg = 0, lam = LAM): OpticalSystem => ({
  prescription: p,
  aperture: { kind: "stopRadius", value: D / 2 },
  field: { kind: "angle", values: [deg] },
  wavelengths: [{ nm: lam, weight: 1 }],
  conjugate: { kind: "infinite" },
});

/** On-axis RMS wavefront error at best focus (waves), and the rays it kept. */
function onAxis(s: OpticalSystem, lam = LAM): { rms: number; lost: number } {
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21, wavelengthNm: lam });
  const map = opdMap(withFocus(s, focus.offsetFromLastVertex), 0, lam, pupilGrid(21));
  return { rms: map.rmsWaves, lost: map.lost };
}

/** Traced Zernike coma (j = 8, waves) at best focus for that field point. */
function tracedComa(p: Prescription, deg: number): { c8: number; lost: number } {
  const s = system(p, deg);
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21, fieldValue: deg });
  const map = opdMap(withFocus(s, focus.offsetFromLastVertex), deg, LAM, pupilGrid(33));
  return { c8: coefficient(fitZernike(map.samples, 28), 8), lost: map.lost };
}

/** An equiconvex N-BK7 singlet of the same aperture and power — the thing to beat. */
function singlet(focalLengthMm: number): Prescription {
  const n = indexD(getMedium("N-BK7"));
  const R = 2 * (n - 1) * focalLengthMm;
  return {
    surfaces: [
      { kind: "refract", curvature: 1 / R, semiAperture: (D / 2) * 1.005, thickness: 0.1 * D, medium: "N-BK7", isStop: true },
      { kind: "refract", curvature: -1 / R, semiAperture: (D / 2) * 1.02, thickness: focalLengthMm, medium: "AIR" },
    ],
  };
}

describe("achromatic doublet — the design comes from the catalog", () => {
  const a = achromaticObjective({ apertureMm: D, focalRatio: 10 });

  it("splits the power by φ₁ = φ·V₁/(V₁−V₂), from the Abbe numbers alone", () => {
    const V1 = abbeNumber(getMedium("N-BK7"));
    const V2 = abbeNumber(getMedium("F2"));
    const phi = 1 / 1000;
    expect(a.crownAbbe).toBe(V1);
    expect(a.flintAbbe).toBe(V2);
    expect(a.crownPower).toBeCloseTo((phi * V1) / (V1 - V2), 15);
    expect(a.flintPower).toBeCloseTo((-phi * V2) / (V1 - V2), 15);
    // The crown over-corrects and the flint takes some back: |φ₁| > φ > 0 > φ₂.
    expect(a.crownPower).toBeGreaterThan(phi);
    expect(a.flintPower).toBeLessThan(0);
    expect(a.crownPower + a.flintPower).toBeCloseTo(phi, 15);
  });

  it("puts the element powers into the curvature differences the maker's equation asks for", () => {
    const [c1, c2, c3] = a.curvatures;
    expect((a.crownIndex - 1) * (c1 - c2)).toBeCloseTo(a.crownPower, 15);
    expect((a.flintIndex - 1) * (c2 - c3)).toBeCloseTo(a.flintPower, 15);
    expect(a.radiiMm[0]).toBeCloseTo(1 / c1, 9);
    // The recognisable Fraunhofer shape: biconvex crown, near-flat rear face.
    expect(a.radiiMm[0]).toBeGreaterThan(0);
    expect(a.radiiMm[1]).toBeLessThan(0);
    expect(Math.abs(a.radiiMm[2])).toBeGreaterThan(5 * Math.abs(a.radiiMm[1]));
  });

  it("lands the traced EFL on D·F up to the thick-lens term, and says so", () => {
    expect(a.focalLengthMm).toBe(1000);
    // Gullstrand's separation term: the split is the THIN-lens closed form applied
    // to elements 10 and 6 mm thick, so the traced EFL sits a few parts in 10⁴ low.
    // It is reported, not absorbed by a fitted split — which is what keeps the
    // achromatism rung below a prediction rather than a construction.
    expect(a.paraxialFocalLengthMm).toBeCloseTo(systemProperties(a.prescription, LAM).efl, 12);
    const miss = a.paraxialFocalLengthMm / a.focalLengthMm - 1;
    expect(miss).toBeLessThan(0);
    expect(Math.abs(miss)).toBeLessThan(1e-3);
  });

  it("solves the bending to null S_I, and reports the residual it actually achieved", () => {
    const s = seidelSums(a.prescription, LAM, { marginalHeightMm: D / 2 });
    expect(a.seidelS1).toBeCloseTo(s.s1, 15);
    // Zero to solver precision — against a scale set by how much SA is on the table:
    // an unbent doublet of the same powers carries ~1e-2 mm of S_I.
    expect(Math.abs(a.seidelS1)).toBeLessThan(1e-12);
  });

  it("finds exactly two SA-null bendings, and builds the lower-coma one by default", () => {
    expect(a.branches).toHaveLength(2);
    for (const b of a.branches) {
      const p: Prescription = {
        ...a.prescription,
        surfaces: a.prescription.surfaces.map((s, i) => ({ ...s, curvature: b.curvatures[i]! })),
      };
      expect(Math.abs(seidelSums(p, LAM, { marginalHeightMm: D / 2 }).s1)).toBeLessThan(1e-12);
    }
    expect(a.branches[0].curvatures[0]).not.toBeCloseTo(a.branches[1].curvatures[0], 6);
    expect(Math.abs(a.comaPerRadian)).toBe(
      Math.min(...a.branches.map((b) => Math.abs(b.comaPerRadian))),
    );
    const other = achromaticObjective({ apertureMm: D, focalRatio: 10, branch: "highComa" });
    expect(Math.abs(other.comaPerRadian)).toBeGreaterThan(Math.abs(a.comaPerRadian));
  });

  it("refuses what it cannot build", () => {
    expect(() => achromaticObjective({ apertureMm: -1, focalRatio: 10 })).toThrow(/positive/);
    expect(() => achromaticObjective({ apertureMm: D, focalRatio: 0 })).toThrow(/positive/);
    expect(() => achromaticObjective({ apertureMm: D, focalRatio: 10, crownMedium: "UNOBTAINIUM" })).toThrow(/unknown medium/);
    // Crown and flint the wrong way round: the front element must be the LESS
    // dispersive glass, or the "achromat" is a differently-shaped singlet.
    expect(() => achromaticObjective({ apertureMm: D, focalRatio: 10, crownMedium: "F2", flintMedium: "N-BK7" }))
      .toThrow(/less dispersive/);
    // Two glasses of the same dispersion cannot be achromatised at all.
    expect(() => achromaticObjective({ apertureMm: D, focalRatio: 10, crownMedium: "N-BK7", flintMedium: "N-BK7" }))
      .toThrow(/less dispersive/);
    // Explicit thicknesses that leave no glass at the edge.
    expect(() => achromaticObjective({ apertureMm: D, focalRatio: 10, crownThicknessMm: 0.5 }))
      .toThrow(/edge thickness/);
    expect(() => achromaticObjective({ apertureMm: D, focalRatio: 10, crownThicknessMm: -1 }))
      .toThrow(/positive/);
  });

  it("thickens a fast crown enough to keep an edge, without being asked", () => {
    // At f/5 the sag difference alone exceeds the 0.10·D an ordinary objective
    // uses, so the default has to follow the geometry rather than a fixed ratio.
    const fast = achromaticObjective({ apertureMm: D, focalRatio: 5 });
    expect(fast.crownThicknessMm).toBeGreaterThan(0.1 * D);
    expect(achromaticObjective({ apertureMm: D, focalRatio: 20 }).crownThicknessMm).toBe(0.1 * D);
  });
});

/**
 * Rung: the colours land together, because the Abbe numbers say so.
 *
 * The achromatic condition φ₁/V₁ + φ₂/V₂ = 0 is imposed on the THIN-lens powers;
 * whether the real thick doublet then brings F and C to a common focus is a
 * prediction of the trace, and it is one the design does not get for free. The
 * measure is the F−C back-focus split as a fraction of f: for a singlet it is
 * 1/V ≈ 1/64, and for the doublet it is what is left of the closed form after
 * thickness — 1.5·10⁻⁴, two orders down, and shrinking as t/f does.
 */
describe("achromatic doublet — F and C land together", () => {
  const bfdSplit = (p: Prescription, f: number): number =>
    (systemProperties(p, LINE_F).bfd - systemProperties(p, LINE_C).bfd) / f;

  it("unites F and C two orders better than an equal-power singlet", () => {
    const a = achromaticObjective({ apertureMm: D, focalRatio: 10 });
    const doublet = Math.abs(bfdSplit(a.prescription, a.focalLengthMm));
    const bare = Math.abs(bfdSplit(singlet(1000), 1000));

    // The singlet's split is its own 1/V — the definition of the Abbe number.
    expect(bare).toBeCloseTo(1 / abbeNumber(getMedium("N-BK7")), 3);
    expect(doublet).toBeLessThan(2e-4);
    expect(bare / doublet).toBeGreaterThan(80);
  });

  it("closes on the thin-lens closed form as the elements thin relative to f", () => {
    // t/f falls as 1/F at fixed aperture, and the residual falls with it: this is
    // the thick-lens correction to a thin-lens design, not a broken condition.
    const residuals = [6, 10, 20, 50].map((F) => {
      const a = achromaticObjective({ apertureMm: D, focalRatio: F });
      return Math.abs(bfdSplit(a.prescription, a.focalLengthMm));
    });
    for (let i = 1; i < residuals.length; i++) expect(residuals[i]!).toBeLessThan(residuals[i - 1]!);
    expect(residuals[0]! / residuals[3]!).toBeGreaterThan(5);
    expect(residuals[3]!).toBeLessThan(5e-5);
  });
});

/**
 * Rung: the secondary spectrum — the residual the glass PAIR cannot fix.
 *
 * With F and C united, the d line does not join them. Writing the relative
 * partial dispersion P(λ) = (n(λ)−n_C)/(n_F−n_C), the thin-lens algebra gives
 *
 *     Δf(λ)/f = −(P₁(λ) − P₂(λ))/(V₁ − V₂)
 *
 * — everything on the right from the catalog, nothing from this design. For
 * N-BK7/F2 it is −4.99·10⁻⁴, the famous ≈ f/2000 of a crown-flint achromat, and
 * the trace has to produce it. The measured value carries the same O(t/f)
 * thick-lens excess as the rung above, so it is pinned as converging to the closed
 * form from above as the lens slows — 1.08× at f/10, 1.02× at f/50.
 */
describe("achromatic doublet — secondary spectrum", () => {
  const measured = (F: number): { meas: number; pred: number } => {
    const a = achromaticObjective({ apertureMm: D, focalRatio: F });
    const bfd = (lam: number) => systemProperties(a.prescription, lam).bfd;
    return { meas: (bfd(LINE_D) - bfd(LINE_C)) / a.focalLengthMm, pred: a.secondarySpectrum };
  };

  it("computes −(P₁−P₂)/(V₁−V₂) from the catalog, ≈ −1/2000 for N-BK7/F2", () => {
    const a = achromaticObjective({ apertureMm: D, focalRatio: 10 });
    const P = (name: string): number => {
      const m = getMedium(name);
      return (m.n(LINE_D) - m.n(LINE_C)) / (m.n(LINE_F) - m.n(LINE_C));
    };
    expect(a.crownPartialDispersion).toBeCloseTo(P("N-BK7"), 15);
    expect(a.flintPartialDispersion).toBeCloseTo(P("F2"), 15);
    expect(a.secondarySpectrum).toBeCloseTo(-(P("N-BK7") - P("F2")) / (a.crownAbbe - a.flintAbbe), 15);
    // The number every crown-flint achromat is judged by, and its sign: the middle
    // of the band focuses SHORT of the united F and C focus.
    expect(a.secondarySpectrum).toBeLessThan(0);
    expect(1 / Math.abs(a.secondarySpectrum)).toBeGreaterThan(1900);
    expect(1 / Math.abs(a.secondarySpectrum)).toBeLessThan(2100);
    // It belongs to the glass pair, not the design: aperture and focal ratio move
    // every radius in the lens and leave it untouched.
    expect(achromaticObjective({ apertureMm: 60, focalRatio: 15 }).secondarySpectrum)
      .toBeCloseTo(a.secondarySpectrum, 15);
  });

  it("is what the trace measures, converging on the closed form as the lens slows", () => {
    for (const [F, tol] of [[10, 0.09], [20, 0.05], [50, 0.02]] as const) {
      const { meas, pred } = measured(F);
      expect(meas / pred).toBeGreaterThan(1); // the thick-lens excess is one-sided
      expect(meas / pred).toBeLessThan(1 + tol);
    }
  });

  it("dwarfs the F−C residual, so it is the real colour limit of this glass pair", () => {
    const a = achromaticObjective({ apertureMm: D, focalRatio: 10 });
    const bfd = (lam: number) => systemProperties(a.prescription, lam).bfd;
    const fc = Math.abs(bfd(LINE_F) - bfd(LINE_C));
    const secondary = Math.abs(bfd(LINE_D) - bfd(LINE_C));
    expect(secondary).toBeGreaterThan(3 * fc);
  });
});

/**
 * Rung: spherical aberration nulled to third order — the bending earning its keep.
 *
 * S_I = 0 was solved in closed form; that the EXACT trace then finds a
 * diffraction-limited wavefront is the independent confirmation. The negative
 * control is an equal-power N-BK7 singlet: same aperture, same focal length, same
 * glass as the crown, ~60× the wavefront error. What survives is fifth order, and
 * it announces itself by scaling: 1/F⁵ at fixed aperture, so 32× per doubling.
 */
describe("achromatic doublet — spherical aberration on axis", () => {
  const a = achromaticObjective({ apertureMm: D, focalRatio: 10 });
  const s = system(a.prescription);

  it("passes the whole beam — nothing vignettes on axis", () => {
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);
  });

  it("is diffraction-limited where a singlet of the same power is nowhere near", () => {
    const doublet = onAxis(s);
    const bare = onAxis(system(singlet(1000)));
    expect(doublet.rms).toBeLessThan(0.01); // ~0.0054 waves, well inside λ/14
    expect(bare.rms).toBeGreaterThan(0.3);
    expect(bare.rms / doublet.rms).toBeGreaterThan(40);

    const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const strehl = psf(withFocus(s, focus.offsetFromLastVertex), 0, LAM, {
      traceSamples: 13,
      pupilSamples: 32,
      padFactor: 2,
    }).strehl;
    expect(strehl).toBeGreaterThan(0.99);
  });

  it("needs the SOLVED bending, and pays for a plausible wrong one", () => {
    // Negative controls that isolate the bending: same glasses, same powers, same
    // achromatism, only c₁ moved. Two are worth measuring.
    //
    //  - The MIDPOINT of the two SA-null roots. This is not an arbitrary offset:
    //    it is where |S_I| peaks and — because the roots straddle the coma-free
    //    bending — where coma nearly vanishes. It is the design one would pick by
    //    chasing an aplanat, and it costs the on-axis image: 0.089 waves.
    //  - The EQUICONVEX crown, the naive choice. It fares much better than it
    //    deserves, because for this glass pair it happens to land within 5% of the
    //    solved root — a near-coincidence worth recording rather than hiding — and
    //    it is still several times worse, with an S_I that is plainly not zero.
    const [c1, c2, c3] = a.curvatures;
    const dc1 = c1 - c2;
    const dc2 = c2 - c3;
    const withBending = (x: number): Prescription => ({
      ...a.prescription,
      surfaces: a.prescription.surfaces.map((sf, i) => ({
        ...sf,
        curvature: [x, x - dc1, x - dc1 - dc2][i]!,
      })),
    });
    const roots = a.branches.map((b) => b.curvatures[0]);
    const midpoint = withBending((roots[0]! + roots[1]!) / 2);
    const equiconvex = withBending(dc1 / 2); // c₁ = −c₂

    const solved = onAxis(s).rms;
    const seidelOf = (p: Prescription) => seidelSums(p, LAM, { marginalHeightMm: D / 2, fieldAngleRad: 1 });

    // The midpoint: worst spherical aberration of any bending, least coma.
    expect(Math.abs(seidelOf(midpoint).s1)).toBeGreaterThan(1e-3);
    expect(Math.abs(seidelOf(midpoint).s2)).toBeLessThan(0.15 * Math.abs(a.comaPerRadian));
    const midRms = onAxis(system(midpoint)).rms;
    expect(midRms).toBeGreaterThan(0.05);
    expect(midRms / solved).toBeGreaterThan(15);

    // The equiconvex crown: close to the solved root, but not it.
    expect(dc1 / 2 / roots[1]!).toBeCloseTo(1, 1);
    expect(Math.abs(seidelOf(equiconvex).s1)).toBeGreaterThan(1e-3);
    expect(onAxis(system(equiconvex)).rms / solved).toBeGreaterThan(4);

    // …and none of it is an achromatism difference. The achromatic condition is
    // on the POWERS, which bending leaves alone, so all three unite F and C to the
    // same order — within 2·10⁻⁴ f, two orders below the singlet's 1/V — while
    // their on-axis wavefronts differ 15-fold. (They are not bit-identical in
    // colour: what does move is the O(t/f) thick-lens residual, which depends on
    // where the surfaces sit. That is the same residual the § "F and C land
    // together" rung watches shrink as the lens slows, not a change of design.)
    const split = (p: Prescription) =>
      Math.abs(systemProperties(p, LINE_F).bfd - systemProperties(p, LINE_C).bfd) / 1000;
    for (const p of [midpoint, equiconvex, a.prescription]) {
      expect(split(p)).toBeLessThan(2e-4);
      expect(split(p)).toBeLessThan(abbeNumber(getMedium("N-BK7")) ** -1 / 50);
    }
  });

  it("leaves a FIFTH-order residual: 32× per doubling of focal ratio", () => {
    // At fixed aperture a fifth-order wavefront term scales as 1/F⁵, so the 2⁵
    // signature is the proof that what the solve nulled was exactly the third
    // order — the same test §§ 5f–5i apply to their own corrector residuals.
    for (const F of [5, 6, 8]) {
      const fast = onAxis(system(achromaticObjective({ apertureMm: D, focalRatio: F }).prescription));
      const slow = onAxis(system(achromaticObjective({ apertureMm: D, focalRatio: 2 * F }).prescription));
      expect(fast.rms / slow.rms).toBeGreaterThan(28);
      expect(fast.rms / slow.rms).toBeLessThan(36);
    }
    // And an ordinary objective is comfortably inside the diffraction limit while
    // a fast one is not: 0.072 waves at f/6 against 0.00017 at f/20.
    expect(onAxis(system(achromaticObjective({ apertureMm: D, focalRatio: 6 }).prescription)).rms)
      .toBeGreaterThan(0.05);
    expect(onAxis(system(achromaticObjective({ apertureMm: D, focalRatio: 20 }).prescription)).rms)
      .toBeLessThan(1e-3);
  });
});

/**
 * Rung: coma, and what choosing between the two SA-null bendings is worth.
 *
 * S_II is the same third-order machinery as S_I, so the trace pins it the same
 * way: W = (S_II/2)·ρ³cos θ projects onto the Noll j = 8 Zernike with a factor
 * 1/(3√8), and the measured coefficient must match — for BOTH branches, whose
 * S_II differ in sign. That is what makes the branch choice a physical statement
 * rather than a coin toss. It also shows its limit honestly: for a crown/flint
 * pair the coma-free bending lies BETWEEN the two roots, so neither is aplanatic
 * and the chosen one is better by ~12%, not by orders.
 */
describe("achromatic doublet — coma and the branch choice", () => {
  const lo = achromaticObjective({ apertureMm: D, focalRatio: 10 });
  const hi = achromaticObjective({ apertureMm: D, focalRatio: 10, branch: "highComa" });
  const predictC8 = (s2: number, deg: number): number =>
    ((s2 * ((deg * Math.PI) / 180)) / 2) / (3 * Math.sqrt(8)) / (LAM * 1e-6);

  it("predicts the traced Zernike coma of both branches from S_II", () => {
    for (const a of [lo, hi]) {
      for (const deg of [0.25, 0.5]) {
        const t = tracedComa(a.prescription, deg);
        expect(t.lost).toBe(0);
        const ratio = t.c8 / predictC8(a.comaPerRadian, deg);
        // Opposite in the engine's OPD-sign convention, unity in magnitude to ~2%.
        expect(ratio).toBeLessThan(0);
        expect(Math.abs(ratio)).toBeGreaterThan(0.97);
        expect(Math.abs(ratio)).toBeLessThan(1.03);
      }
    }
  });

  it("has the two branches straddle the coma-free bending, so neither is aplanatic", () => {
    // Opposite signs is the whole finding: bending trades coma monotonically and
    // crosses zero between the roots, where S_I is at its worst. An aplanatic
    // cemented doublet is a constraint on the GLASS PAIR, not on the bending.
    expect(lo.comaPerRadian * hi.comaPerRadian).toBeLessThan(0);
    expect(Math.abs(hi.comaPerRadian / lo.comaPerRadian)).toBeGreaterThan(1);
    expect(Math.abs(hi.comaPerRadian / lo.comaPerRadian)).toBeLessThan(2);
    // Both really are spherical-aberration-free; the field is the only difference.
    expect(onAxis(system(hi.prescription)).rms).toBeLessThan(0.02);
    expect(Math.abs(hi.seidelS1)).toBeLessThan(1e-12);
  });

  it("scales its coma with field angle, linearly, as third-order coma must", () => {
    const quarter = tracedComa(lo.prescription, 0.25).c8;
    const half = tracedComa(lo.prescription, 0.5).c8;
    expect(half / quarter).toBeCloseTo(2, 2);
  });
});
