import { describe, it, expect } from "vitest";
import { achromaticObjective } from "../src/designs/achromat";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { systemProperties } from "../src/trace/paraxial";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { getMedium, CAF2, N_BK7, F2 } from "../src/materials/catalog";
import { abbeNumber, indexD, Medium, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";

/**
 * Rungs for the ED (fluorite) refractor — docs/VALIDATION.md § 5k.
 *
 * The ED objective needs no new design code: it is `achromaticObjective` driven
 * with CaF₂ as the crown, and everything that makes it better comes from the glass
 * data. That is the claim under test, and it splits in two.
 *
 *  1. **Why CaF₂ helps at all.** Secondary spectrum is (P₁−P₂)/(V₁−V₂), so the
 *     lever is not the famous Vd = 95 but the ANOMALOUS relative partial
 *     dispersion: CaF₂'s P sits far BELOW the line the ordinary glasses in the
 *     catalog fall on, so pairing it with N-BK7 nearly matches the two P's while
 *     keeping a large ΔV. Both quantities come from Malitson's coefficients and
 *     Schott's, with nothing from this design.
 *  2. **What the trace then delivers.** ~10× less secondary spectrum in closed
 *     form, and a focus spread across the visible band ~4× tighter — the reason a
 *     fluorite doublet is worth its price.
 *
 * And two honest costs, pinned as such: the fluorite doublet's elements are more
 * strongly curved (CaF₂'s low index and the steeper power split), so its
 * higher-order residual is worse at the same focal ratio; and CaF₂ paired with a
 * heavy FLINT has no spherically-corrected cemented solution at all.
 *
 * This file also carries the cross-glass evidence for the branch criterion, since
 * the fluorite pair is where the obvious alternative (pick the lower coma) fails.
 */

const D = 100;
const LAM = LINE_D;

const system = (p: Prescription, lam = LAM): OpticalSystem => ({
  prescription: p,
  aperture: { kind: "stopRadius", value: D / 2 },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: lam, weight: 1 }],
  conjugate: { kind: "infinite" },
});

function onAxisRms(p: Prescription, lam = LAM): number {
  const s = system(p, lam);
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21, wavelengthNm: lam });
  return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, lam, pupilGrid(21)).rmsWaves;
}

/** Relative partial dispersion P = (n_d − n_C)/(n_F − n_C). */
const partial = (m: Medium): number =>
  (m.n(LINE_D) - m.n(LINE_C)) / (m.n(LINE_F) - m.n(LINE_C));

type Branch = "shallow" | "steep";
const branchOf = (branch?: Branch) => (branch ? { branch } : {});

const ed = (F: number, branch?: Branch) =>
  achromaticObjective({
    apertureMm: D,
    focalRatio: F,
    crownMedium: "CAF2",
    flintMedium: "N-BK7",
    ...branchOf(branch),
  });
const crownFlint = (F: number, branch?: Branch) =>
  achromaticObjective({ apertureMm: D, focalRatio: F, ...branchOf(branch) });

describe("CaF₂ is in the catalog for its ANOMALOUS partial dispersion", () => {
  it("sits far below the normal line the catalog's ordinary glasses define", () => {
    // The normal line: ordinary glasses fall close to a straight P(V). Two of them
    // define it here — F2 and N-BK7 — and CaF₂ is judged against their line
    // extrapolated to its own Abbe number. This is the textbook construction, run
    // on the catalog rather than quoted.
    const slope = (partial(N_BK7) - partial(F2)) / (abbeNumber(N_BK7) - abbeNumber(F2));
    const onLineAtCaF2 = partial(N_BK7) + slope * (abbeNumber(CAF2) - abbeNumber(N_BK7));
    const deviation = partial(CAF2) - onLineAtCaF2;

    // Deterministic from the Sellmeier coefficients, so pinned to the value.
    expect(deviation).toBeCloseTo(-0.018399, 5); // far off the line, and BELOW it
    // For scale: the two ordinary glasses are on their own line by construction,
    // and fused silica — a normal material — misses it by 24× less.
    const silica = getMedium("FUSED-SILICA");
    const silicaDeviation =
      partial(silica) - (partial(N_BK7) + slope * (abbeNumber(silica) - abbeNumber(N_BK7)));
    expect(silicaDeviation).toBeCloseTo(0.000762, 5);
    expect(Math.abs(deviation) / Math.abs(silicaDeviation)).toBeCloseTo(24.15, 1);
  });

  it("has the huge Abbe number too, but that is the smaller half of the story", () => {
    expect(abbeNumber(CAF2)).toBeGreaterThan(94);
    // The clean demonstration that ΔV is not the lever: pairing CaF₂ with a heavy
    // flint nearly DOUBLES the Abbe difference (58.6 against 30.8) and yet ends up
    // with about twice the secondary spectrum, because ΔP grows faster than ΔV.
    // The pair with the smaller ΔV wins — so what is bought is the anomaly, not
    // the Abbe number.
    // Pinned to the actual numbers, two-sided: these are deterministic functions
    // of the Sellmeier coefficients, so there is no tolerance to spend.
    const secondary = (c: Medium, f: Medium) =>
      Math.abs(-(partial(c) - partial(f)) / (abbeNumber(c) - abbeNumber(f)));
    expect(
      (abbeNumber(CAF2) - abbeNumber(F2)) / (abbeNumber(CAF2) - abbeNumber(N_BK7)),
    ).toBeCloseTo(1.9018, 3);
    expect(secondary(CAF2, F2) / secondary(CAF2, N_BK7)).toBeCloseTo(1.9032, 3);
  });
});

describe("the fluorite ED objective — what the glass buys", () => {
  const a = ed(15);
  const b = crownFlint(15);

  it("needs no new design code: same solver, same conditions, different glasses", () => {
    expect(a.crownMedium).toBe("CAF2");
    expect(a.crownIndex).toBe(CAF2.n(LINE_D));
    expect(a.crownAbbe).toBe(abbeNumber(CAF2));
    // The classical split, evaluated on this pair: the crown works harder than in
    // a crown-flint achromat (3.08φ against 2.31φ) because ΔV is larger relative
    // to V₂ — the price in curvature the rung below measures.
    expect(a.crownPower * a.focalLengthMm).toBeCloseTo(
      a.crownAbbe / (a.crownAbbe - a.flintAbbe), 12,
    );
    expect(a.crownPower * a.focalLengthMm).toBeGreaterThan(b.crownPower * b.focalLengthMm);
  });

  it("cuts the secondary spectrum 5.1×, from the catalog alone", () => {
    // Catalog arithmetic, so pinned to the number rather than bounded: f/10259
    // against the crown-flint achromat's f/2003.
    expect(Math.abs(b.secondarySpectrum) / Math.abs(a.secondarySpectrum)).toBeCloseTo(5.1226, 3);
    expect(1 / Math.abs(a.secondarySpectrum)).toBeCloseTo(10258.8, 0);
    expect(1 / Math.abs(b.secondarySpectrum)).toBeCloseTo(2002.7, 0);
    // And it changes SIGN: CaF₂'s partial dispersion is below its partner's, so
    // the middle of the band now focuses LONG of the united F–C focus, where the
    // crown-flint achromat's focuses short.
    expect(a.secondarySpectrum).toBeGreaterThan(0);
    expect(b.secondarySpectrum).toBeLessThan(0);
  });

  it("delivers a visibly tighter focus across the band — the reason it costs more", () => {
    const spread = (p: Prescription, f: number): number => {
      const foci = [450, 500, 550, 600, 650].map((lam) => systemProperties(p, lam).bfd);
      return (Math.max(...foci) - Math.min(...foci)) / f;
    };
    const edSpread = spread(a.prescription, a.focalLengthMm);
    const achSpread = spread(b.prescription, b.focalLengthMm);
    expect(edSpread).toBeLessThan(achSpread / 3);
    expect(edSpread).toBeLessThan(5e-4);
    // Both still unite F and C: the ED gain is in the SECONDARY spectrum, which is
    // what is left after the achromatic condition has done its work.
    for (const x of [a, b]) {
      const fc = Math.abs(
        systemProperties(x.prescription, LINE_F).bfd - systemProperties(x.prescription, LINE_C).bfd,
      ) / x.focalLengthMm;
      expect(fc).toBeLessThan(2.5e-4);
    }
  });

  it("is diffraction-limited on axis at f/15, where its own spherical solve holds", () => {
    expect(onAxisRms(a.prescription)).toBeLessThan(0.02);
    expect(opdMap(system(a.prescription), 0, LAM, pupilGrid(21)).lost).toBe(0);
  });
});

describe("the fluorite ED objective — the costs, pinned as such", () => {
  it("carries steeper surfaces and a worse higher-order residual than the achromat", () => {
    // CaF₂'s low index (1.434 against N-BK7's 1.517) and the harder-working crown
    // both push curvature up, and the fifth order that third-order theory does not
    // model rises with it. The honest consequence: at f/10 the fluorite doublet is
    // NOT diffraction-limited while the crown-flint achromat is, and the ED lens
    // must be slowed to about f/15 to match it.
    const edFast = ed(10);
    const achFast = crownFlint(10);
    expect(Math.max(...edFast.curvatures.map((c) => Math.abs(c) * (D / 2))))
      .toBeGreaterThan(Math.max(...achFast.curvatures.map((c) => Math.abs(c) * (D / 2))));
    expect(onAxisRms(edFast.prescription)).toBeGreaterThan(onAxisRms(achFast.prescription));
    expect(onAxisRms(edFast.prescription)).toBeGreaterThan(0.02); // outside λ/14
    expect(onAxisRms(ed(15).prescription)).toBeLessThan(onAxisRms(achFast.prescription) * 2);
  });

  it("has no cemented solution at all against a heavy flint, and says so", () => {
    // CaF₂/F2: S_I stays strictly positive at every bending — the pair cannot be
    // spherically corrected as a cemented doublet. Returning the least-bad bending
    // would be worse than refusing.
    expect(() => achromaticObjective({
      apertureMm: D,
      focalRatio: 10,
      crownMedium: "CAF2",
      flintMedium: "F2",
    })).toThrow(/does not admit the classical doublet solution/);
  });
});

/**
 * Rung: the branch criterion, across three glass pairs.
 *
 * Both roots of S_I = 0 null the same third order, so the choice is about what
 * third-order theory leaves behind. The preset chooses on Σ|S_I,ᵢ| — how violently
 * the surfaces cancel — and the trace has to agree that this is the better lens,
 * in every pair. The fluorite pair is why the criterion is not coma: there the
 * lower-|S_II| root is EIGHT TIMES worse on axis, and its coma advantage is 2%.
 */
describe("branch selection: cancellation violence, not coma", () => {
  const pairs = [
    { name: "N-BK7/F2", make: crownFlint },
    { name: "CaF₂/N-BK7", make: ed },
    {
      name: "silica/F2",
      make: (F: number, branch?: Branch) =>
        achromaticObjective({
          apertureMm: D,
          focalRatio: F,
          crownMedium: "FUSED-SILICA",
          ...branchOf(branch),
        }),
    },
  ];

  it("picks the branch the exact trace prefers, in all three pairs", () => {
    for (const { name, make } of pairs) {
      for (const F of [10, 15]) {
        const shallow = make(F);
        const steep = make(F, "steep");
        const rShallow = onAxisRms(shallow.prescription);
        const rSteep = onAxisRms(steep.prescription);
        expect(rShallow, `${name} f/${F}`).toBeLessThan(rSteep);
        // The criterion the code actually applies, and the shape it corresponds to.
        const chosen = shallow.branches.find((x) => x.curvatures[0] === shallow.curvatures[0])!;
        const other = shallow.branches.find((x) => x.curvatures[0] !== shallow.curvatures[0])!;
        expect(chosen.cancellation, `${name} f/${F}`).toBeLessThan(other.cancellation);
        expect(chosen.maxSurfaceSlope, `${name} f/${F}`).toBeLessThan(other.maxSurfaceSlope);
      }
    }
  });

  it("would choose wrongly on coma for the fluorite pair — 8× worse for a 2% coma gain", () => {
    const shallow = ed(10);
    const steep = ed(10, "steep");
    // The trace's verdict.
    expect(onAxisRms(steep.prescription) / onAxisRms(shallow.prescription)).toBeGreaterThan(5);
    // …and coma would have pointed the other way, by a margin of a few percent.
    expect(Math.abs(steep.comaPerRadian)).toBeLessThan(Math.abs(shallow.comaPerRadian));
    expect(Math.abs(steep.comaPerRadian) / Math.abs(shallow.comaPerRadian)).toBeGreaterThan(0.9);
  });

  it("agrees with coma where coma happens to be right, so the two are not opposed", () => {
    // For N-BK7/F2 the shallow root ALSO has the lower coma — which is how the coma
    // criterion survived the first glass pair it was tried on.
    const shallow = crownFlint(10);
    const steep = crownFlint(10, "steep");
    expect(Math.abs(shallow.comaPerRadian)).toBeLessThan(Math.abs(steep.comaPerRadian));
  });
});

describe("catalog: CaF₂ against Malitson 1963", () => {
  // nd/Vd are pinned to the datasheet with the rest of the catalog, in
  // test/materials.test.ts. What belongs here is the property this design uses.
  it("disperses normally across the visible, despite the anomalous partials", () => {
    // "Anomalous partial dispersion" is about the SHAPE of n(λ), not its direction:
    // CaF₂ is still an ordinary, normally-dispersing material.
    expect(CAF2.n(LINE_F)).toBeGreaterThan(CAF2.n(LINE_D));
    expect(CAF2.n(LINE_D)).toBeGreaterThan(CAF2.n(LINE_C));
    expect(getMedium("CAF2")).toBe(CAF2);
  });
});
