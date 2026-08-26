import { describe, it, expect } from "vitest";
import {
  superachromaticObjective,
  cementedQuadrupletForm,
  QuadrupletApertureRefusal,
} from "../src/designs/superachromat";
import { apochromaticObjective } from "../src/designs/apochromat";
import { seidelSums } from "../src/analysis/seidel";
import { paraxialTrace } from "../src/trace/paraxial";
import { LINE_D } from "../src/materials/dispersion";
import type { Prescription } from "../src/trace/prescription";

/**
 * Step 6av — the thick cemented quadruplet, and where the band actually falls.
 *
 * § 6at answered the oldest open question on the colour branch — four united
 * wavelengths ARE reachable from `materials/catalog`, and the fourth row is
 * conditioned by non-coplanarity in (V, P_dC, P_gF) rather than by a second
 * anomalous glass — and then could not price the answer. Its closing number is a
 * BAND: the relative curvature error at which the fourth glass stops paying for
 * itself is "between 0.09% and 0.14%", because the quantity that decides it
 * moves 4.6× with a bending § 6at did not solve for. **This step builds the
 * lens, and the band becomes a number.**
 *
 * ## What is measured, and against what
 *
 *  - **The classical m-glass / m-line split**, which is § 6ar.1's external
 *    number reached through § 6at.1's reduction: at m = 3 and F, d, C the rows
 *    are Σφ/V = 0 and ΣφP/V = 0 exactly, pinned over all sixty ordered triples
 *    to 1e−12. `cementedQuadrupletForm` writes the same rows at m = 4, and its
 *    conditioning reproduces § 6at.2's 12.292 and 59.224 — figures computed
 *    there from catalogue dispersions and the closed form alone.
 *  - **Welford's third-order Seidel formulas** through `analysis/seidel`, pinned
 *    to the thin-lens closed form and the spherical-mirror figure at § 5j. The
 *    bending is chosen by nulling S_I on the real thick prescription, so what
 *    selects the design rests on an external number and not on a residual this
 *    repo invented.
 *  - **§ 6at.6's bending-independent focal-ratio bound**, f/7.25, which the
 *    built lens must not beat and does not: it needs f/11.
 *  - **§ 6at.7's traced sensitivity**, 4.999e−2 for the apochromatic triplet.
 *    § 6av.6 re-measures it here by an independently written route and lands
 *    within 0.4%, which is what licenses comparing the two lenses at all.
 *
 * ## The scope limit that shaped the module, and it is not the one predicted
 *
 * § 6at expected the thick step to be "five surfaces, four joints,
 * `analysis/seidel` already generalizes". Seidel does generalize, and the
 * surfaces were never the difficulty. **The difficulty is that the thin split
 * stops being a start.** At conditioning 12.29 the element powers are ~12× the
 * total power, so Gullstrand's separation term exceeds the power it corrects and
 * the thick lens sits 3.3 total powers from the thin split it was started at —
 * the apochromatic triplet sits 0.038 away (§ 6ar.1). Newton from that start
 * does not fail; it converges to a DIFFERENT lens at neighbouring bendings, and
 * every measurement downstream is then reading a function that is not one.
 * § 6av.2 is that rung, and the thickness continuation is the answer to it.
 *
 * That is the third time on this ladder that the expensive part of a step was
 * not the physics the deferral named (§ 6r's resampler Jacobian, § 6l's
 * convention coupling, and now a solver's start).
 */

const D_MM = 10;
/**
 * The default lens, built once: f/12 at 10 mm, the ratio most of the step reads
 * its numbers at. Constructing it scans 400 bendings through an eight-step
 * thickness continuation each, so it is shared rather than rebuilt per rung.
 */
const F12 = superachromaticObjective({ apertureMm: D_MM, focalRatio: 12 });
/** The band the four united lines span. NOT a neutral choice — see § 6at.5. */
const SPANNED: readonly [number, number] = [430, 680];
/** The whole traced band, where both lenses extrapolate. */
const FULL: readonly [number, number] = [380, 800];

const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;

/**
 * R(λ) = f_d/f_λ − 1, worst over a band, against the prescription's OWN d line.
 * The reference is not a detail: measured against the UNPERTURBED lens's focal
 * length instead, the refocusable part of a curvature error is 74× the chromatic
 * one and drowns it completely (§ 6at.7).
 */
const worstResidual = (g: Prescription, band: readonly [number, number], step = 2.5): number => {
  const fd = efl(g, LINE_D);
  let worst = 0;
  for (let l = band[0]; l <= band[1]; l += step) worst = Math.max(worst, Math.abs(fd / efl(g, l) - 1));
  return worst;
};

/**
 * The chromatic part of a relative curvature error, per unit ε, worst over the
 * surfaces and the band — traced, not the thin closed form § 6at.8 had to use.
 */
const chromaticSensitivity = (
  g: Prescription,
  band: readonly [number, number],
  step = 2.5,
): number => {
  const EPS = 1e-6;
  const fd = efl(g, LINE_D);
  const base: number[] = [];
  for (let l = band[0]; l <= band[1]; l += step) base.push(fd / efl(g, l) - 1);
  let worst = 0;
  for (let s = 0; s < g.surfaces.length; s++) {
    const bumped: Prescription = {
      surfaces: g.surfaces.map((x, i) =>
        i === s ? { ...x, curvature: x.curvature * (1 + EPS) } : x,
      ),
    };
    const bd = efl(bumped, LINE_D);
    let j = 0;
    for (let l = band[0]; l <= band[1]; l += step) {
      worst = Math.max(worst, Math.abs((bd / efl(bumped, l) - 1 - base[j]!) / EPS));
      j++;
    }
  }
  return worst;
};

describe("§ 6av.1 — the quadruplet exists as a THICK lens, and the thin split is its limit", () => {
  it("unites four wavelengths and nulls S_I on the built prescription", () => {
    const q = F12;

    // The four colour conditions, on the thick first order. This is the solve's
    // own target and on its own proves only that it converged — exactly what
    // § 6aq.1's 1e−14 proved for the triplet.
    expect(q.unitedLinesNm).toEqual([435.8343, 486.1327, 587.5618, 656.2725]);
    for (const l of q.unitedLinesNm) {
      expect(Math.abs(efl(q.prescription, l) / q.focalLengthMm - 1)).toBeLessThan(1e-13);
    }
    expect(q.paraxialFocalLengthMm).toBeCloseTo(120, 8);

    // S_I nulled by the published formulas at the marginal height it was solved
    // for. THIS is the external number that picks the bending.
    expect(Math.abs(q.seidelS1)).toBeLessThan(1e-9);

    // The design's headline radii (mm), front to back. A strongly NEGATIVE front
    // element — φ₁·f = −15.6 — which is why the back focus is longer than the
    // focal length: 137.4 mm against 120.
    const radii = q.radiiMm.map((r) => Number(r.toFixed(3)));
    expect(radii).toEqual([-12.838, 5.765, 6.295, 15.576, -8.823]);
    expect(q.backFocusMm).toBeCloseTo(137.377, 3);
    expect(q.elementPowers.map((p) => Number((p * 120).toFixed(3)))).toEqual([
      -15.588, 1.087, 4.928, 9.767,
    ]);

    // The conditioning is § 6at.2's, recomputed from the catalogue by a
    // separately written row construction: 12.292 for this quadruple.
    expect(q.conditioning).toBeCloseTo(12.292, 3);
  });

  it("and the thick solve is 3.3 TOTAL POWERS from the split, which is why it needs a continuation", () => {
    // The number that separates this design from `designs/apochromat`. There the
    // thick solve sits 0.038 of the total power from the thin split (§ 6ar.1's
    // `thinPowerGap`) and the split is a good start. Here it is 3.30 — the thin
    // split is not a nearby lens, it is a different one.
    const q = F12;
    const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: 6 });
    expect(q.thinPowerGap).toBeCloseTo(3.2955, 3);
    expect(tri.thinPowerGap).toBeCloseTo(0.038, 2);
    expect(q.thinPowerGap / tri.thinPowerGap).toBeGreaterThan(80);

    // It IS the glass being thick, and the way to prove that is to make the
    // glass thin: § 6ar.1's halving check, one design further on. The gap falls
    // towards a ratio of 2 per halving as the lens gets close enough to thin for
    // the linear term to be the whole story.
    const gaps = [1, 0.5, 0.25, 0.125].map(
      (s) =>
        superachromaticObjective({
          apertureMm: D_MM,
          focalRatio: 12,
          thicknessesMm: [1.6 * s, 1.2 * s, 1.2 * s, 1.2 * s],
        }).thinPowerGap,
    );
    expect(gaps[0]!).toBeCloseTo(3.2955, 3);
    expect(gaps[1]!).toBeCloseTo(1.1147, 3);
    expect(gaps[2]!).toBeCloseTo(0.4867, 3);
    expect(gaps[3]!).toBeCloseTo(0.2291, 3);
    expect(gaps[0]! / gaps[1]!).toBeCloseTo(2.96, 1);
    expect(gaps[2]! / gaps[3]!).toBeCloseTo(2.12, 1);
    expect(gaps[2]! / gaps[3]!).toBeGreaterThan(2);
  });
});

describe("§ 6av.2 — the thin split does not SELECT a thick lens, and the continuation does", () => {
  it("Newton from the split lands on a different lens at 10 of 104 bendings", () => {
    // The rung the whole module rests on. `designs/apochromat` solves its
    // trailing curvatures by damped Newton started at the thin split, and if
    // that method carried over there would be no continuation here. It does not
    // carry over — and the failure is silent, which is what makes it worth a
    // rung rather than a comment. Newton CONVERGES; it converges to another root
    // of the same residual system.
    const form = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: 120 });
    const slope = (cs: readonly number[]): number =>
      Math.max(...cs.map((c) => Math.abs(c) * (D_MM / 2)));
    let shared = 0;
    let differing = 0;
    let worstRatio = 1;
    let worstPair: { direct: readonly number[]; continued: readonly number[] } | null = null;
    for (let i = 0; i <= 200; i++) {
      const c1 = form.shallowestBending + form.bendingSpan * (-1 + i / 100);
      const continued = form.tryCurvaturesAt(c1);
      const direct = form.directCurvaturesAt(c1);
      if (continued === null || direct === null) continue;
      shared++;
      if (Math.abs(slope(direct) / slope(continued) - 1) > 1e-6) {
        differing++;
        if (slope(direct) / slope(continued) > worstRatio) {
          worstRatio = slope(direct) / slope(continued);
          worstPair = { direct, continued };
        }
      }
    }
    expect(shared).toBe(104);
    expect(differing).toBe(10);
    // And where they differ the direct solve is not slightly off — it is a lens
    // more than twice as steep, which at any real aperture is not the same
    // article at all.
    expect(worstRatio).toBeGreaterThan(2.2);

    // Both ARE solutions: the direct one unites the four lines just as exactly.
    // So this is not "one of them is wrong", it is "the residual has more than
    // one root and the split does not say which", and that is precisely why
    // S_I(c₁) built on the direct solve has jump discontinuities in it.
    expect(worstPair).not.toBeNull();
    for (const cs of [worstPair!.direct, worstPair!.continued]) {
      const g = form.build(cs as Parameters<typeof form.build>[0], 0);
      for (const l of form.unitedLinesNm) {
        expect(Math.abs(efl(g, l) / 120 - 1)).toBeLessThan(1e-13);
      }
    }
    // The continuation's lens is a buildable one at a reachable aperture and the
    // direct solve's is nowhere near: 2.4 hemispheres against 5.4 at 10 mm.
    expect(slope(worstPair!.continued)).toBeLessThan(slope(worstPair!.direct) / 2.2);
  });

  it("...and the answer does not depend on how many steps the continuation takes", () => {
    // What says the walk is tracking a branch rather than manufacturing a
    // step-size artefact. Three times the steps, same lens to 1e−9 relative —
    // they are separate Newton paths converging on one root, so they agree to
    // solver precision and not bit for bit.
    const shallow = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: 120 });
    const deep = cementedQuadrupletForm({
      apertureMm: D_MM,
      focalLengthMm: 120,
      continuationSteps: 24,
    });
    let compared = 0;
    let worst = 0;
    for (let i = 0; i <= 200; i++) {
      const c1 = shallow.shallowestBending + shallow.bendingSpan * (-1 + i / 100);
      const a = shallow.tryCurvaturesAt(c1);
      const b = deep.tryCurvaturesAt(c1);
      if (a === null || b === null) continue;
      compared++;
      worst = Math.max(worst, Math.max(...a.map((x, j) => Math.abs(x / b[j]! - 1))));
    }
    expect(compared).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("§ 6av.3 — ONE spherical-aberration null, where doublet and triplet have two", () => {
  it("the count is one at four scan windows and two sampling densities", () => {
    // § 6at deferred this as "§ 6b's root-count and root-is-a-lens filters would
    // both have to be re-asked", and the answer is not the inherited one. A
    // doublet has two S_I roots and so does the apochromatic triplet, which is
    // why `designs/apochromat` types the pair into its signature. Inside the
    // bending family this solve reaches there is exactly ONE.
    //
    // The measurement has to be stable in the two directions it could be an
    // artefact of — how wide the scan looks and how finely it samples — because
    // § 6ar.3 showed the reachable set is a convergence basin whose piece count
    // grows with sampling. It is stable in both.
    const form = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: 120 });
    const s1Of = (c1: number): number | null => {
      const cs = form.tryCurvaturesAt(c1);
      if (cs === null) return null;
      const s1 = seidelSums(form.build(cs, 120), LINE_D, { marginalHeightMm: D_MM / 2 }).s1;
      return Number.isFinite(s1) ? s1 : null;
    };
    for (const [window, steps] of [
      [2, 400],
      [3, 400],
      [3, 1600],
      [5, 400],
    ] as const) {
      const lo = form.shallowestBending - window * form.bendingSpan;
      const hi = form.shallowestBending + window * form.bendingSpan;
      let roots = 0;
      let lenses = 0;
      let prevC = lo;
      let prevS = s1Of(lo);
      for (let i = 1; i <= steps; i++) {
        const c = lo + ((hi - lo) * i) / steps;
        const s = s1Of(c);
        if (prevS !== null && s !== null && prevS * s < 0) {
          let a = prevC;
          let b = c;
          let fa = prevS;
          let hole = false;
          for (let k = 0; k < 100 && b - a > Math.abs(b) * 1e-15; k++) {
            const mid = 0.5 * (a + b);
            const fm = s1Of(mid);
            if (fm === null) {
              hole = true;
              break;
            }
            if (fa * fm < 0) b = mid;
            else {
              a = mid;
              fa = fm;
            }
          }
          if (!hole) {
            roots++;
            const cs = form.tryCurvaturesAt(0.5 * (a + b))!;
            if (Math.max(...cs.map((x) => Math.abs(x) * (D_MM / 2))) < 1) lenses++;
          }
        }
        prevC = c;
        prevS = s;
      }
      expect({ window, steps, roots, lenses }).toEqual({ window, steps, roots: 1, lenses: 1 });
    }

    // For scale, the design one glass back, at the same aperture and ratio: two.
    const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: 12 });
    expect(tri.branches).toHaveLength(2);
    expect(F12.bendings).toHaveLength(1);
  });
});

describe("§ 6av.4 — the wall, and a root that is not a surface", () => {
  it("builds at f/11 and refuses at f/10.75, half again the bending-free bound", () => {
    // § 6at.6's f/7.25 is a bound over EVERY bending and stays true; what it
    // cannot say is where the design actually lands, because the S_I-null
    // bending is not the shallowest one. The built lens needs f/10.8.
    const built = superachromaticObjective({ apertureMm: D_MM, focalRatio: 11 });
    expect(Math.max(...built.curvatures.map((c) => Math.abs(c) * (D_MM / 2)))).toBeCloseTo(0.983, 3);
    // f·max|c|/2 — the ratio this bending REQUIRES, in § 6at.6's own units.
    const needs = (o: { curvatures: readonly number[]; focalLengthMm: number }): number =>
      (o.focalLengthMm * Math.max(...o.curvatures.map(Math.abs))) / 2;
    expect(needs(built)).toBeCloseTo(10.813, 2);


    // Half again steeper than the bound, against the apochromatic triplet's 3%
    // (§ 6at.6). Both are the same statement — a bound is not a prediction — and
    // the two designs sit very differently far from it.
    expect(11 / 7.25).toBeCloseTo(1.517, 3);
    expect(needs(built) / 7.25).toBeGreaterThan(1.48);

    // The refusal is the APERTURE one and says so, since the root is there and
    // is merely unbuildable: slowing the ratio fixes it, changing the glass does
    // not. That distinction is `TripletApertureRefusal`'s and is kept.
    let refusal: Error | undefined;
    try {
      superachromaticObjective({ apertureMm: D_MM, focalRatio: 10.75 });
    } catch (e) {
      refusal = e as Error;
    }
    expect(refusal).toBeInstanceOf(QuadrupletApertureRefusal);
    const message = refusal!.message;
    expect(message).toContain("deeper than hemispherical");
    expect(message).toContain("slow the focal ratio");
  });

  it("and at f/11 the scan finds a root that is NOT a lens, which the triplet never does", () => {
    // `designs/achromat` needs its root-is-a-lens filter for a ghost past the
    // aperture wall (§ 6b.5.7); `designs/apochromat` keeps the filter although
    // nothing it ever built needed it, and § 6ar.2 records that it removes
    // nothing on any input in this repo. Here it removes something on a shipping
    // input: at f/11 the scan finds two roots and exactly one is a surface.
    const q = superachromaticObjective({ apertureMm: D_MM, focalRatio: 11 });
    expect(q.bendings.length).toBe(2);
    expect(q.bendings.filter((b) => b.maxSurfaceSlope < 1)).toHaveLength(1);
    const ghost = q.bendings.find((b) => b.maxSurfaceSlope >= 1)!;
    expect(ghost.maxSurfaceSlope).toBeGreaterThan(2);
    // The one built is the one that is a surface, and it is not the first found.
    expect(q.bending).toBeCloseTo(-9.0259e-2, 6);
    expect(Math.max(...q.curvatures.map((c) => Math.abs(c) * (D_MM / 2)))).toBeLessThan(1);
  });
});

describe("§ 6av.5 — the bending belongs to the focal length, not to the aperture", () => {
  it("f/30 at 10 mm and f/15 at 20 mm are the same lens, and only one of them is buildable at 40", () => {
    // Worth pinning because it says which knob does what, and the answer is not
    // symmetric: the colour solve and the S_I null are both properties of the
    // 300 mm focal length and the centre thicknesses — S_I ∝ h⁴ scales the whole
    // sum uniformly, so its ZERO does not move with the marginal height. The
    // aperture then decides one thing only: whether that bending is a surface.
    const a = superachromaticObjective({ apertureMm: 10, focalRatio: 30 });
    const b = superachromaticObjective({ apertureMm: 20, focalRatio: 15 });
    expect(a.focalLengthMm).toBe(300);
    expect(b.focalLengthMm).toBe(300);
    expect(b.bending).toBeCloseTo(a.bending, 12);
    a.curvatures.forEach((c, i) => expect(b.curvatures[i]!).toBeCloseTo(c, 12));

    // …and the steepness scales exactly with the aperture, which is what makes
    // the wall an aperture statement.
    expect(b.bendings[0]!.maxSurfaceSlope / a.bendings[0]!.maxSurfaceSlope).toBeCloseTo(2, 9);
    expect(() => superachromaticObjective({ apertureMm: 40, focalRatio: 7.5 })).toThrow(
      QuadrupletApertureRefusal,
    );
  });
});

describe("§ 6av.6 — the band becomes a number, and it is OUTSIDE the band", () => {
  it("the traced crossing is 0.070% of radius, where § 6at predicted 0.09-0.14%", () => {
    // THE HEADLINE, and the reason the step exists. § 6at.8 could only quote a
    // band because the deciding quantity moves 4.6× with the bending and it had
    // no bending; this has one, and both lenses are traced rather than thin.
    //
    // COMMENSURABILITY, first, because a comparison of two lenses at two
    // geometries measures the geometry: the triplet and the quadruplet are built
    // at the SAME aperture and the SAME focal ratio, and the ratio is one the
    // quadruplet can be built at. The triplet would rather be f/6; it is f/12
    // here because the quadruplet cannot be, and that is the honest direction to
    // resolve the difference in.
    const q = F12;
    const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: 12 });

    const triR = worstResidual(tri.prescription, SPANNED);
    const quadR = worstResidual(q.prescription, SPANNED);
    const triX = chromaticSensitivity(tri.prescription, SPANNED);
    const quadX = chromaticSensitivity(q.prescription, SPANNED);

    // The check that licenses the comparison: this file's traced sensitivity for
    // the TRIPLET reproduces § 6at.7's traced 4.999e−2 by an independently
    // written route, to 0.4%.
    expect(triX).toBeCloseTo(5.015e-2, 4);
    expect(Math.abs(triX / 4.999e-2 - 1)).toBeLessThan(0.005);

    expect(triR).toBeCloseTo(2.2221e-4, 7);
    expect(quadR).toBeCloseTo(2.9242e-6, 9);
    expect(quadX).toBeCloseTo(3.1273e-1, 3);

    // The crossing, in § 6at.8's own definition: the error at which the
    // quadruplet's delivered colour equals a PERFECT triplet's.
    const tie = (triR - quadR) / quadX;
    expect(tie).toBeCloseTo(7.012e-4, 6);
    // § 6at.8's band was 9.493e−4 to 1.358e−3. The traced answer is below all of
    // it — the band did not contain the answer, and § 6av.6's second rung says
    // why in one number.
    expect(tie).toBeLessThan(9.493e-4);

    // And where BOTH are degraded equally, which is the crossing the delivered
    // table in § 6at.8 actually walks: 8.35e−4.
    expect((triR - quadR) / (quadX - triX)).toBeCloseTo(8.352e-4, 6);

    // The perfect-glass advantage, traced: 76.0× on the band the four lines
    // span, against the thin split's 102.4×. The thick lens keeps three quarters
    // of what the thin arithmetic promised.
    expect(triR / quadR).toBeCloseTo(76.0, 0);
    expect(triR / quadR).toBeLessThan(102.4);

    // The wide band, where 430-680 is not doing the quadruplet any favours:
    // 6.3× perfect, against the thin 8.7×, and a crossing at 0.16%.
    const triF = worstResidual(tri.prescription, FULL);
    const quadF = worstResidual(q.prescription, FULL);
    const quadFX = chromaticSensitivity(q.prescription, FULL);
    expect(triF / quadF).toBeCloseTo(6.33, 1);
    expect((triF - quadF) / quadFX).toBeCloseTo(1.634e-3, 5);
  });

  it("...because the S_I bending is worse than BOTH bendings the band was built from", () => {
    // The mechanism, and the lesson worth more than the number: § 6at.8's band
    // came from two bendings — the shallowest (thin sensitivity 2.334e−1) and
    // the most favourable in its scan (1.631e−1) — and neither is the bending a
    // lens is actually built at. The S_I null traces at 3.127e−1, worse than the
    // shallowest by 34% and worse than the favourable one by 92%. A band built
    // from two samples of a quantity is not a bound on it.
    const quadX = chromaticSensitivity(F12.prescription, SPANNED);
    expect(quadX).toBeGreaterThan(2.334e-1);
    expect(quadX / 2.334e-1).toBeCloseTo(1.34, 1);
    expect(quadX / 1.631e-1).toBeCloseTo(1.92, 1);
  });

  it("and the crossing is a property of the DESIGN, not of the fixture it was measured on", () => {
    // The grid, because a headline claimed for one configuration and measured on
    // one configuration is how the last two app parts went wrong. Four
    // configurations — three focal ratios and a halved glass thickness — and the
    // crossing moves by 10%, from 7.01e−4 to 7.72e−4. It drifts monotonically
    // towards the thin limit as the glass thins and the ratio slows, which is
    // the direction it should drift and is a check in itself.
    const crossings = ([
      [12, 1],
      [20, 1],
      [30, 1],
      [15, 0.5],
    ] as const).map(([F, scale]) => {
      const q = superachromaticObjective({
        apertureMm: D_MM,
        focalRatio: F,
        thicknessesMm: [1.6 * scale, 1.2 * scale, 1.2 * scale, 1.2 * scale],
      });
      const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: F });
      const triR = worstResidual(tri.prescription, SPANNED);
      const quadR = worstResidual(q.prescription, SPANNED);
      return (triR - quadR) / chromaticSensitivity(q.prescription, SPANNED);
    });
    expect(crossings[0]!).toBeCloseTo(7.012e-4, 6);
    expect(crossings[1]!).toBeCloseTo(7.560e-4, 6);
    expect(crossings[2]!).toBeCloseTo(7.724e-4, 6);
    expect(crossings[3]!).toBeCloseTo(7.703e-4, 6);
    // Every one of them below the band's lower end, so the finding is not an
    // artefact of the ratio the headline was quoted at.
    for (const c of crossings) expect(c).toBeLessThan(9.493e-4);
    expect(Math.max(...crossings) / Math.min(...crossings)).toBeLessThan(1.11);
  });
});

describe("§ 6av.7 — and there is still no superachromat without fluorite", () => {
  it("the fluorite-free quadruple solves as a split and nulls S_I at no bending", () => {
    // § 6at.2's load-bearing rung is that this quadruple SOLVES — conditioning
    // 59.2, better than the fluorite-free apochromatic TRIPLE at 517.9 that
    // § 6ar.6 showed is a real, slow lens — and that is what killed the
    // deferral's reasoning. It is still true and it is still not a lens.
    const media = ["N-BK7", "F2", "FUSED-SILICA", "D263"] as const;
    const form = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: 100, media });
    expect(form.conditioning).toBeCloseTo(59.224, 2);

    // Slowing the ratio is what fixes an aperture problem, so if the aperture
    // were what is binding, f/200 would build. It is not: ΣS_I keeps one sign at
    // every bending the continuation reaches, so there is no bending to null it
    // at. Same shape of result as `designs/apochromat`'s "no apochromat without
    // fluorite", measured the same way — and note the type, an ordinary Error
    // and NOT the aperture refusal, because the glasses are what is binding.
    for (const focalRatio of [30, 200]) {
      let error: Error | undefined;
      try {
        superachromaticObjective({ apertureMm: D_MM, focalRatio, media });
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(QuadrupletApertureRefusal);
      expect(error!.message).toContain("found 0");
      expect(error!.message).toContain("nulls the third-order spherical aberration");
    }
  });
});
