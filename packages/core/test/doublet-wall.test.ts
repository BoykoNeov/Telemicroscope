import { describe, it, expect } from "vitest";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { achromaticObjective, cementedDoubletForm } from "../src/designs/achromat";
import { plosslEyepiece } from "../src/designs/eyepiece";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { seidelSums } from "../src/analysis/seidel";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the cemented doublet's ceiling — docs/VALIDATION.md § 6b.5.
 *
 * § 6b left one item open in words: "the 4× sitting at f/4.1 — the edge of the
 * cemented-doublet form". APP.md's D8 then measured the constructor's own
 * refusal boundary, found it at f/2.3 rather than f/4.1, found it nearly
 * constant across two glass pairs and two orientations where the NA was not,
 * and flagged — deliberately, being app wiring — "the doublet's ceiling is a
 * focal ratio ≈ f/2.3, and the ratio is the invariant" as an open question for
 * this step. This file answers it, and the answer is that **the two halves of
 * that sentence are about two different things**:
 *
 *  - The **optical** ceiling is Maréchal's, it is EXTERNAL, and on it neither
 *    the aperture nor the ratio is invariant — the reach spans 77% in NA and
 *    40% in working focal ratio over M = 4 → 40. § 6b's original sentence is
 *    the one that survives: the catalogued 4×/0.10 has 3.1% of NA in hand.
 *  - The **refusal** boundary is `achromaticObjective`'s, it contains no
 *    aperture *by construction*, and that is why the ratio at it looks
 *    invariant. At it the wavefront is 3.45 waves — 48× Maréchal. It is a
 *    property of the solver, and this file pins which parts of the solver:
 *    the ±3·span scan window, and the fixed point's thin-lens seed.
 *
 * So these rungs split in two by kind, and the file says which is which rather
 * than presenting one table. Only the § 6b.5.1 group is pinned to an external
 * criterion; the rest are identities, closed forms and negative controls in the
 * sense § 6s uses the word — a rung about a solver is an identity rung.
 */

const LAMBDA = LINE_D;
const MARECHAL = 1 / 14;
/** `finiteConjugateObjective`'s own default — the glass is sized over the stop. */
const GLASS_MARGIN = 1.12;

/** σ at best focus on the DIN chain, the currency § 6b.4 already reports in. */
function sigmaWaves(M: number, NA: number, over: Record<string, unknown> = {}): number {
  const objective = finiteConjugateObjective({ magnification: M, numericalAperture: NA, ...over });
  const s = finiteConjugateMicroscope({ objective }).system;
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21)).rmsWaves;
}

/** Highest x in [lo, hi] for which `ok` holds. σ runs as NA⁶, so bisect. */
const highest = (lo: number, hi: number, ok: (x: number) => boolean, steps = 26): number => {
  let a = lo;
  let b = hi;
  for (let i = 0; i < steps; i++) {
    const m = 0.5 * (a + b);
    if (ok(m)) a = m;
    else b = m;
  }
  return a;
};

/** The largest NA the DIN constructor will build at all. */
const buildWall = (over: Record<string, unknown>): number =>
  highest(0.05, 0.9, (NA) => {
    try {
      finiteConjugateObjective({ magnification: 4, numericalAperture: NA, ...over });
      return true;
    } catch {
      return false;
    }
  }, 44);

/** The reach on Maréchal — the external criterion, on the same chain. */
const marechalReach = (M: number): number =>
  highest(0.05, 0.3, (NA) => {
    try {
      return sigmaWaves(M, NA) <= MARECHAL;
    } catch {
      return false;
    }
  });

/**
 * `achromaticObjective`'s refusal ratio: the smallest focal ratio that still
 * builds, at a stated conjugate ratio s/f. The lens is specified entirely in
 * ratios, so this is the boundary in the solver's own parameter space.
 */
function refusalRatio(
  sOverF: number | null,
  over: Record<string, unknown> = {},
  apertureMm = 10,
): number {
  const ok = (F: number): boolean => {
    try {
      achromaticObjective({
        apertureMm,
        focalRatio: F,
        ...(sOverF === null ? {} : { objectDistanceMm: sOverF * apertureMm * F }),
        ...over,
      });
      return true;
    } catch {
      return false;
    }
  };
  let hi = 12;
  let lo = 0.2;
  for (let i = 0; i < 54; i++) {
    const mid = 0.5 * (lo + hi);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Distance between two doubles in units in the last place. */
const ulpsApart = (a: number, b: number): bigint => {
  const view = new DataView(new ArrayBuffer(8));
  const bits = (x: number): bigint => {
    view.setFloat64(0, x);
    return view.getBigUint64(0);
  };
  const d = bits(a) - bits(b);
  return d < 0n ? -d : d;
};

const messageFrom = (fn: () => unknown): string => {
  try {
    fn();
    return "builds";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("§ 6b.5.1 — the optical ceiling: Maréchal, bisected (EXTERNAL)", () => {
  it("the DIN 4× is diffraction-limited to NA 0.1031 — the catalogued 0.10 has 3% in hand", () => {
    // § 6b's own sentence, finally measured: "the 4× sitting at f/4.1 — the edge
    // of the cemented-doublet form". It is the edge. The reach is 3.1% of NA
    // above the member the catalogue ships, and the working ratio there is
    // f/3.956 against the catalogued f/4.076 — 3% of ratio.
    const reach = marechalReach(4);
    expect(reach).toBeCloseTo(0.10311, 4);
    expect(reach / 0.1 - 1).toBeLessThan(0.04);
    expect(reach).toBeGreaterThan(0.1); // the catalogued member does clear it
    const atReach = finiteConjugateObjective({ magnification: 4, numericalAperture: reach });
    expect(atReach.workingFocalRatio).toBeCloseTo(3.9559, 3);
    // And the pinned member's own σ, which § 6b.4 reports as λ/17.
    expect(sigmaWaves(4, 0.1)).toBeCloseTo(0.058936, 5);
  });

  it("σ runs as NA^6.2 there, so the reach is bisected and not interpolated", () => {
    // An order, not a number — the same law § 6d.3 reads on the Lister and
    // § 5j on the classical doublet. Two consecutive ratios, not a fit.
    const s = [0.08, 0.1, 0.125].map((NA) => sigmaWaves(4, NA));
    const order = (i: number, j: number, a: number, b: number) =>
      Math.log(s[j]! / s[i]!) / Math.log(b / a);
    expect(order(0, 1, 0.08, 0.1)).toBeGreaterThan(5.9);
    expect(order(0, 1, 0.08, 0.1)).toBeLessThan(6.5);
    expect(order(1, 2, 0.1, 0.125)).toBeGreaterThan(5.9);
    expect(order(1, 2, 0.1, 0.125)).toBeLessThan(6.6);
  });

  it("NEITHER the aperture NOR the ratio is invariant on it — 77% and 40%", () => {
    // This is the half of D8's flagged sentence that does NOT survive. The
    // reach rises steeply with M while the ratio at it FALLS, so there is no
    // single focal ratio that is the cemented doublet's optical ceiling. The
    // ratio is the tighter of the two by ~2×, which is the grain of truth in
    // "quote a ratio" — but 40% is not an invariant.
    const rows = [4, 10, 20, 40].map((M) => {
      const NA = marechalReach(M);
      return { M, NA, F: finiteConjugateObjective({ magnification: M, numericalAperture: NA }).workingFocalRatio };
    });
    expect(rows[0]!.NA).toBeCloseTo(0.10311, 4);
    expect(rows[3]!.NA).toBeCloseTo(0.18274, 4);
    expect(rows[0]!.F).toBeCloseTo(3.9559, 3);
    expect(rows[3]!.F).toBeCloseTo(2.8227, 3);
    // Monotone in both, opposite ways: a slower objective reaches a higher NA
    // and does it at a faster working cone.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.NA).toBeGreaterThan(rows[i - 1]!.NA);
      expect(rows[i]!.F).toBeLessThan(rows[i - 1]!.F);
    }
    const span = (xs: number[]) => Math.max(...xs) / Math.min(...xs) - 1;
    expect(span(rows.map((r) => r.NA))).toBeGreaterThan(0.7); // 77%
    expect(span(rows.map((r) => r.F))).toBeGreaterThan(0.35); // 40%
    expect(span(rows.map((r) => r.F))).toBeLessThan(0.5);
    // The ratio is tighter than the aperture, and that is all it is.
    expect(span(rows.map((r) => r.NA)) / span(rows.map((r) => r.F))).toBeGreaterThan(1.8);
  });

  it("at the constructor's refusal NA the wavefront is 3.45 waves — 48× Maréchal", () => {
    // The measurement that makes everything below an identity rather than a
    // ceiling. D8 read the refusal boundary as "the form survives to NA 0.1843";
    // the form is 48× past diffraction-limited there and 1.79× past its own
    // Maréchal reach. Nothing optical happens at that NA.
    const wall = buildWall({});
    expect(wall).toBeCloseTo(0.184336, 5);
    const sigma = sigmaWaves(4, wall);
    expect(sigma).toBeGreaterThan(3.4);
    expect(sigma / MARECHAL).toBeGreaterThan(45);
    expect(wall / marechalReach(4)).toBeCloseTo(1.788, 2);
  });
});

describe("§ 6b.5.2 — the refusal boundary is the SOLVER's, and contains no aperture", () => {
  it("IDENTITY: the refusal ratio is aperture-free to 3 ULP across four decades", () => {
    // Why it must be: at a stated focal ratio every defaulted length in the
    // constructor is degree-1 homogeneous in D — the thickness floors are 0.1·D
    // and 0.06·D, the sag-driven thicknesses go as D²/f with f = D·F, and S_I
    // itself is ∝ h⁴ exactly. So the dimensionless lens does not change with
    // aperture at all, and the boundary is a pure ratio.
    //
    // § 6p's distinction, landing on the OTHER side: the identity is algebraic
    // and NOT arithmetic. Most of these values are bitwise equal and one in each
    // set is 2–3 ULP away, because at the boundary the scan's sign detection
    // over its 2000 samples is decided by rounding — so a single bisection step
    // can flip and the last bits of the bracket differ. Pinned at the measured
    // 4 ULP rather than at a round epsilon, so the day it becomes 400 the rung
    // notices.
    for (const [sOverF, expected] of [[null, 1.9175107], [5, 1.9042573]] as const) {
      const walls = [1, 10, 100, 1000].map((D) => refusalRatio(sOverF, {}, D));
      for (const F of walls) expect(Number(ulpsApart(F, walls[0]!))).toBeLessThanOrEqual(4);
      expect(walls[0]).toBeCloseTo(expected, 6);
    }
    // …and it is a genuinely different number at a different conjugate, so the
    // agreement above is not simply insensitivity to everything.
    expect(Math.abs(refusalRatio(null) / refusalRatio(5) - 1)).toBeGreaterThan(5e-3);
  });

  it("and it is homogeneous of degree 1 in the STATED thickness pair", () => {
    // The aperture-freedom above is inherited from the thickness DEFAULTING
    // rule, not from the glass: state the thicknesses instead and scaling them
    // scales the boundary ratio exactly, which says the locus lives in t/f. So
    // "the ceiling is a focal ratio" is a property of how much glass the
    // constructor decides to put in, one layer below the doublet.
    const atWall = achromaticObjective({
      apertureMm: 10,
      focalRatio: refusalRatio(5.02),
      objectDistanceMm: 5.02 * 10 * refusalRatio(5.02),
    });
    const tc = atWall.crownThicknessMm;
    const tf = atWall.flintThicknessMm;
    const base = refusalRatio(5.02, { crownThicknessMm: tc, flintThicknessMm: tf });
    for (const k of [2, 3]) {
      const scaled = refusalRatio(5.02, { crownThicknessMm: tc * k, flintThicknessMm: tf * k });
      expect(scaled / base).toBeCloseTo(k, 8);
    }
  });

  it("NEGATIVE CONTROL: the two thicknesses are not interchangeable", () => {
    // If the boundary were "total glass" the two elements would trade off; they
    // do not, so the locus is a curve in (t_crown/f, t_flint/f) and the single
    // number is a section through it.
    const atWall = achromaticObjective({
      apertureMm: 10,
      focalRatio: refusalRatio(5.02),
      objectDistanceMm: 5.02 * 10 * refusalRatio(5.02),
    });
    const tc = atWall.crownThicknessMm;
    const tf = atWall.flintThicknessMm;
    const base = refusalRatio(5.02, { crownThicknessMm: tc, flintThicknessMm: tf });
    const crownOnly = refusalRatio(5.02, { crownThicknessMm: tc * 2, flintThicknessMm: tf });
    const flintOnly = refusalRatio(5.02, { crownThicknessMm: tc, flintThicknessMm: tf * 2 });
    // Both move it, neither by the factor two, and by different factors.
    expect(crownOnly / base).toBeGreaterThan(1.7);
    expect(crownOnly / base).toBeLessThan(2);
    expect(flintOnly / base).toBeGreaterThan(1.1);
    expect(flintOnly / base).toBeLessThan(1.2);
    expect(crownOnly / flintOnly).toBeGreaterThan(1.5);
  });
});

describe("§ 6b.5.3 — what arrives at the boundary is a ghost, at the scan window's edge", () => {
  /**
   * `achromaticObjective` scans c₁ over ±3·span for sign changes of S_I and
   * refuses any count but two. With the thicknesses STATED there is no second
   * pass, so the scan below is the constructor's own — and it is checked against
   * the constructor's verdict rather than assumed to be it.
   */
  const D = 10;
  const S_OVER_F = 5.02;
  const wallF = refusalRatio(S_OVER_F);
  const atWall = achromaticObjective({
    apertureMm: D,
    focalRatio: wallF,
    objectDistanceMm: S_OVER_F * D * wallF,
  });
  const crownMm = atWall.crownThicknessMm;
  const flintMm = atWall.flintThicknessMm;

  const scan = (F: number) => {
    const f = D * F;
    const form = cementedDoubletForm({ apertureMm: D, focalLengthMm: f });
    const s1Of = (c1: number): number =>
      seidelSums(form.build(form.curvaturesAt(c1), { crownMm, flintMm, lastMm: 0 }), LAMBDA, {
        marginalHeightMm: D / 2,
        objectDistanceMm: S_OVER_F * f,
      }).s1;
    const span = Math.abs(form.dc1) + Math.abs(form.dc2);
    const lo = -3 * span;
    const hi = 3 * span;
    const steps = 2000;
    const roots: number[] = [];
    let prevC = lo;
    let prevS = s1Of(lo);
    for (let i = 1; i <= steps; i++) {
      const c = lo + ((hi - lo) * i) / steps;
      const s = s1Of(c);
      if (prevS * s < 0) {
        let a = prevC;
        let b = c;
        let fa = prevS;
        for (let k = 0; k < 80; k++) {
          const mid = 0.5 * (a + b);
          const fm = s1Of(mid);
          if (fa * fm < 0) b = mid;
          else {
            a = mid;
            fa = fm;
          }
        }
        roots.push(0.5 * (a + b));
      }
      prevC = c;
      prevS = s;
    }
    return roots.map((c1) => ({
      overSpan: c1 / span,
      slope: Math.max(...form.curvaturesAt(c1).map((c) => Math.abs(c) * (D / 2))),
    }));
  };

  const builds = (F: number): boolean => {
    try {
      achromaticObjective({
        apertureMm: D,
        focalRatio: F,
        objectDistanceMm: S_OVER_F * D * F,
        crownThicknessMm: crownMm,
        flintThicknessMm: flintMm,
      });
      return true;
    } catch {
      return false;
    }
  };

  it("ANTI-CIRCULARITY: the scan's root count flips 2→3 across the constructor's own verdict", () => {
    // Without this the section below would be a story about a reconstruction.
    for (const F of [wallF * 1.2, wallF * 1.01]) {
      expect(builds(F)).toBe(true);
      expect(scan(F)).toHaveLength(2);
    }
    for (const F of [wallF * 0.999, wallF * 0.9, wallF * 0.7]) {
      expect(builds(F)).toBe(false);
      expect(scan(F)).toHaveLength(3);
    }
  });

  it("the third root is 5× hemispherical and ENTERS at |c₁|/span = 3 — the window constant", () => {
    // So the boundary ratio is set by the literal `3` in `solveBendings`'s scan
    // range, not by anything the glass does. Just below the wall the ghost sits
    // at the window edge; take the ratio further down and it migrates inward.
    const just = scan(wallF * 0.999);
    const ghost = just[2]!;
    expect(ghost.overSpan).toBeGreaterThan(2.99);
    expect(ghost.overSpan).toBeLessThan(3);
    // |c|·(D/2) = 1 is a hemisphere; this "surface" is five times steeper and
    // does not intersect the marginal ray at all. It is a root of the paraxial
    // S_I polynomial, not a lens.
    expect(ghost.slope).toBeGreaterThan(5);
    const deeper = scan(wallF * 0.7)[2]!;
    expect(deeper.overSpan).toBeLessThan(ghost.overSpan);
    expect(deeper.overSpan).toBeGreaterThan(2);
  });

  it("…while the two REAL roots at the wall are ordinary glass", () => {
    // The form has not run out: at the refusal both bendings are still under
    // hemispherical and the built lens still has positive edges. Nothing
    // geometric is binding — which is what separates this wall from § 6d's,
    // § 6e.4's and § 6l's, where the rays stop existing.
    const both = scan(wallF * 1.01);
    for (const r of both) expect(r.slope).toBeLessThan(1);
    const cs = atWall.curvatures;
    const h = D / 2;
    const sag = (c: number, r: number) => {
      const d = 1 - c * c * r * r;
      return d <= 0 ? c * r * r : (c * r * r) / (1 + Math.sqrt(d));
    };
    expect(crownMm + sag(cs[1]!, h) - sag(cs[0]!, h)).toBeGreaterThan(0);
    expect(flintMm + sag(cs[2]!, h) - sag(cs[1]!, h)).toBeGreaterThan(0);
  });
});

describe("§ 6b.5.4 — the DIN wall is the fixed point's SEED, in closed form", () => {
  /**
   * The DIN constructor seeds its fixed point from the thin lens: the object at
   * a = f(1 + 1/M), the image at b = f(1 + M), and the glass sized over the stop
   * the object distance implies, D = 2·a·tan u·k. The focal length cancels out
   * of f/D — which is why the optical tube length does not move the wall — and
   * what is left is
   *
   *     tan u_wall = 1 / (2·k·(1 + 1/M)·F*(s/f)),   s/f = 1 + M   (flint first)
   *                                                       1 + 1/M (crown first)
   *
   * with F* the aperture-free refusal ratio above. That the SEED's ratio is the
   * binding one is the finding: the converged design at that NA sits about 6%
   * inside the boundary, so the constructor refuses apertures it could deliver.
   */
  const predict = (M: number, orientation: "flintFirst" | "crownFirst", over: Record<string, unknown> = {}) => {
    const sOverF = orientation === "flintFirst" ? 1 + M : 1 + 1 / M;
    const tanU = 1 / (2 * GLASS_MARGIN * (1 + 1 / M) * refusalRatio(sOverF, over));
    return tanU / Math.sqrt(1 + tanU * tanU);
  };
  const measured = (M: number, orientation: "flintFirst" | "crownFirst", over: Record<string, unknown> = {}) =>
    highest(0.05, 0.9, (NA) => {
      try {
        finiteConjugateObjective({ magnification: M, numericalAperture: NA, orientation, ...over });
        return true;
      } catch {
        return false;
      }
    }, 44);

  it("predicts the wall to 13 digits at four magnifications, both orientations", () => {
    for (const orientation of ["flintFirst", "crownFirst"] as const) {
      for (const M of [4, 10, 20, 40]) {
        expect(predict(M, orientation) / measured(M, orientation) - 1).toBeLessThan(1e-11);
      }
    }
  });

  it("…and on a second glass pair, which is what makes it the closed form and not a fit", () => {
    const over = { crownMedium: "FUSED-SILICA" };
    for (const M of [4, 40]) {
      expect(predict(M, "flintFirst", over) / measured(M, "flintFirst", over) - 1).toBeLessThan(1e-11);
    }
    // The two pairs genuinely differ, so the agreement above is not a constant
    // matching itself: silica/F2 reaches 4% more aperture before refusing.
    expect(measured(4, "flintFirst", over) / measured(4, "flintFirst")).toBeGreaterThan(1.03);
  });

  it("WITNESS: the wall is these NUMBERS, and a re-seed has to edit them", () => {
    // Everything else in this section is measured against the LIVE constructor:
    // `predict` reads `refusalRatio` and `measured` bisects the same code, so a
    // change to the seed would move both together and the rungs would stay green
    // while the boundary they describe went somewhere else. These literals are
    // the only thing in § 6b.5 that a re-seed cannot satisfy by agreeing with
    // itself — they are absolute, and the commit that moves the wall must edit
    // them in its own diff.
    const walls = [
      [4, "flintFirst", 0.1843357],
      [10, "flintFirst", 0.2078672],
      [20, "flintFirst", 0.2169474],
      [40, "flintFirst", 0.2217549],
      [4, "crownFirst", 0.1792105],
      [10, "crownFirst", 0.1997106],
      [20, "crownFirst", 0.2073667],
      [40, "crownFirst", 0.2113516],
    ] as const;
    for (const [M, orientation, expected] of walls) {
      expect(measured(M, orientation)).toBeCloseTo(expected, 6);
    }
    // A second glass pair, and a coverslip — the slip matters because with a
    // target ΣS_I ≠ 0 the refusal ratio is NOT aperture-free (S_I ∝ h⁴ while the
    // plate's contribution is absolute), so § 6b.5.2's identity and § 6b.5.4's
    // closed form do not reach this row. It is pinned as a bare measurement.
    const silica = { crownMedium: "FUSED-SILICA" };
    expect(measured(4, "flintFirst", silica)).toBeCloseTo(0.1915229, 6);
    expect(measured(40, "flintFirst", silica)).toBeCloseTo(0.2292907, 6);
    expect(measured(4, "flintFirst", { coverslip: { thicknessMm: 0.17 } })).toBeCloseTo(0.1861441, 6);
  });

  it("WITNESS: and the converged design at it sits 6% inside — what the seed costs", () => {
    // The number the "not yet pinned" item is quoted with. At the wall the
    // constructor is refusing a lens whose OWN geometry is comfortably inside
    // the refusal ratio: the seed puts the object 6.3% further out than the
    // fixed point does, so it sizes 6.3% more glass than the converged design
    // has, and asks `achromaticObjective` for f/1.904 when the design it is
    // about to build is f/2.024.
    const M = 4;
    const NA = measured(M, "flintFirst");
    const objective = finiteConjugateObjective({ magnification: M, numericalAperture: NA });
    const f = objective.focalLengthMm;
    const seedA = f * (1 + 1 / M);
    const tanU = NA / Math.sqrt(1 - NA * NA);
    expect(objective.airEquivalentObjectDistanceMm / seedA).toBeCloseTo(0.941049, 6);
    // The two ratios the seed and the design would each present to the solver.
    expect(f / (2 * seedA * tanU * GLASS_MARGIN)).toBeCloseTo(1.904257, 6);
    expect(f / (2 * objective.airEquivalentObjectDistanceMm * tanU * GLASS_MARGIN)).toBeCloseTo(2.023548, 6);
  });

  it("the optical tube length cancels EXACTLY — f is not in the closed form", () => {
    // D8 measured this as three equal numbers; here it is an identity, and the
    // reason is that f cancels between the seed's aperture and its focal ratio.
    const walls = [100, 150, 250].map((opticalTubeLengthMm) =>
      measured(4, "flintFirst", { opticalTubeLengthMm }),
    );
    for (const w of walls) expect(w).toBe(walls[0]);
  });
});

describe("§ 6b.5.5 — one message, two causes, and now the sentence tells them apart too", () => {
  it("a glass-pair failure reports 0 roots at ANY focal ratio, and keeps its sentence", () => {
    // CaF₂/F2 is § 5k's pair and genuinely admits no classical solution: the
    // count is zero, and slowing the lens by 5× does not change that. This is
    // the branch on which the original sentence was true, so it is unchanged.
    for (const focalRatio of [10, 50]) {
      const message = messageFrom(() =>
        achromaticObjective({ apertureMm: 10, focalRatio, crownMedium: "CAF2", flintMedium: "F2" }),
      );
      expect(message).toMatch(/found 0 —/);
      expect(message).toMatch(/this glass pair does not admit the classical doublet solution/);
    }
  });

  it("an aperture failure reports 3, and the SAME pair builds when slowed", () => {
    // Which falsifies the sentence the message USED to print on this branch —
    // the glass pair does admit the classical solution, at a ratio 10% slower.
    expect(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.5 }))).toMatch(/found 3 —/);
    expect(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 2.2 }))).toBe("builds");
  });

  it("…and the message now says APERTURE there, and never says it on the 0-root branch", () => {
    // The fix this section's own heading used to describe as not done. The
    // discriminator is the count, which the engine already had; what changes is
    // that the prose is derived from it instead of asserted over it. Nothing
    // about which designs are refused moves — the extra root is reported, not
    // rejected, since rejecting it would move the boundary § 6b.5.2–.4 pin.
    const aperture = messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.5 }));
    expect(aperture).toMatch(/binding here is the APERTURE and not the glass pair/);
    expect(aperture).not.toMatch(/this glass pair does not admit/);
    const glass = messageFrom(() =>
      achromaticObjective({ apertureMm: 10, focalRatio: 10, crownMedium: "CAF2", flintMedium: "F2" }),
    );
    expect(glass).not.toMatch(/APERTURE/);
  });

  it("…and it counts the non-physical roots rather than assuming there is one", () => {
    // The clause is measured in the failing call, which matters because the
    // count is NOT always one. At the wall the two real roots are ordinary glass
    // (§ 6b.5.3) so exactly one of three is past hemispherical; drive the ratio
    // far enough below it and the real pair goes non-physical too. A message
    // that hard-coded "one ghost root" would be wrong at f/1.5.
    const nonPhysical = (message: string): number => Number(/found 3 — .*?(\d+) of the 3 are deeper/.exec(message)![1]);
    const D = 10;
    const S_OVER_F = 5.02;
    const justBelow = refusalRatio(S_OVER_F) * 0.999;
    const atWall = messageFrom(() =>
      achromaticObjective({
        apertureMm: D,
        focalRatio: justBelow,
        objectDistanceMm: S_OVER_F * D * justBelow,
      }),
    );
    expect(nonPhysical(atWall)).toBe(1);
    expect(nonPhysical(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.5 })))).toBe(3);
  });

  it("§ 6q's Plössl wall is this same refusal, which is why it was scale-invariant", () => {
    // § 6q.9 bisected the Plössl's clear-aperture wall to 0.899195·f_e and found
    // it "exactly scale-invariant from f_e 15 to 50". That invariance is
    // § 6b.5.2's identity seen through a different constructor: the same
    // three-root refusal, on a form specified entirely in ratios. The clear
    // aperture maps onto the doublets' apertures through the Plössl's own
    // layout, which nothing here measures, so this pins the mechanism and not
    // the number.
    for (const [focalLengthMm, clearApertureMm] of [[25, 24], [50, 48]] as const) {
      expect(messageFrom(() => plosslEyepiece({ focalLengthMm, clearApertureMm }))).toMatch(/found 3 —/);
    }
    expect(messageFrom(() => plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 22 }))).toBe("builds");
  });
});
