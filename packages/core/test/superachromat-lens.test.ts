import { describe, it, expect } from "vitest";
import {
  superachromaticObjective,
  cementedQuadrupletForm,
  QuadrupletApertureRefusal,
} from "../src/designs/superachromat";
import { apochromaticObjective } from "../src/designs/apochromat";
import { seidelSums } from "../src/analysis/seidel";
import { paraxialTrace } from "../src/trace/paraxial";
import { traceRay } from "../src/trace/sequential";
import { makeRay } from "../src/trace/ray";
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
 *  - **`designs/achromat`'s edge-thickness condition**, which is elementary
 *    solid geometry and has been in this repo since § 6b: a cemented element
 *    whose two faces meet before the rim cannot be made. § 6av.8 is where this
 *    design starts obeying it, and what it costs is most of the step's headline
 *    numbers.
 *  - **§ 6at.6's bending-independent focal-ratio bound**, f/7.25, which the
 *    built lens must not beat and does not: it needs f/21.9, three times the
 *    bound rather than the 1.49× a steepness-only wall reported.
 *  - **§ 6at.7's traced sensitivity**, 4.999e−2 for the apochromatic triplet.
 *    § 6av.6 re-measures it here by an independently written route and lands
 *    within 0.5%, which is what licenses comparing the two lenses at all.
 *
 * ## Two scope limits shaped this module, and neither was the one predicted
 *
 * § 6at expected the thick step to be "five surfaces, four joints,
 * `analysis/seidel` already generalizes". Seidel does generalize, and the
 * surfaces were never the difficulty.
 *
 * **The first difficulty is that the thin split stops being a start.** At
 * conditioning 12.29 the element powers are ~12× the total power, so
 * Gullstrand's separation term exceeds the power it corrects and the thick lens
 * sits 1.06 total powers from the thin split it was started at — the
 * apochromatic triplet sits 0.040 away (§ 6ar.1). Newton from that start does
 * not fail; it converges to a DIFFERENT lens at neighbouring bendings, and every
 * measurement downstream is then reading a function that is not one. § 6av.2 is
 * that rung, and the thickness continuation is the answer to it.
 *
 * **The second is that a root can be a surface and still not be a solid**, and
 * this design's cement joints are curved enough that it usually is not: the
 * lens § 6av first shipped had every surface shallower than a hemisphere and a
 * rear element that closed 1.4 mm inside its own rim. § 6av.8 is that rung. It
 * moves the focal-ratio wall from f/10.81 to f/21.88 and it is the reason every
 * number in this file is quoted at f/25 rather than at f/12.
 *
 * That is the third and fourth time on this ladder that the expensive part of a
 * step was not the physics the deferral named (§ 6r's resampler Jacobian, § 6l's
 * convention coupling, a solver's start, and now a condition the repo already
 * had and this design did not apply).
 */

const D_MM = 10;
/**
 * The default lens, built once: f/25 at 10 mm, the ratio most of the step reads
 * its numbers at, and the roundest ratio that clears the f/21.88 solidity wall
 * with an edge a shop could hold (0.156 mm). Constructing it scans 400 bendings
 * through an eight-step thickness continuation each, so it is shared rather than
 * rebuilt per rung.
 */
const F25 = superachromaticObjective({ apertureMm: D_MM, focalRatio: 25 });
/** The focal length every form-level rung below is solved at, and F25's. */
const FL_MM = 250;
/** The band the four united lines span. NOT a neutral choice — see § 6at.5. */
const SPANNED: readonly [number, number] = [430, 680];
/** The whole traced band, where both lenses extrapolate. */
const FULL: readonly [number, number] = [380, 800];

const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;

/** Sag of a sphere of curvature c at radius y — the edge-thickness arithmetic. */
const sag = (c: number, y: number): number => (c * y * y) / (1 + Math.sqrt(1 - c * c * y * y));

/** The four element edge thicknesses at semi-diameter y (mm). */
const edgesAt = (
  cs: readonly number[],
  ts: readonly number[],
  y: number,
): number[] => ts.map((t, k) => t + sag(cs[k + 1]!, y) - sag(cs[k]!, y));

/** The shipped centre thicknesses, which every rung here leaves at their default. */
const THICKNESSES = [1.6, 1.2, 1.2, 1.2] as const;

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
    const q = F25;

    // The four colour conditions, on the thick first order. This is the solve's
    // own target and on its own proves only that it converged — exactly what
    // § 6aq.1's 1e−14 proved for the triplet.
    expect(q.unitedLinesNm).toEqual([435.8343, 486.1327, 587.5618, 656.2725]);
    for (const l of q.unitedLinesNm) {
      expect(Math.abs(efl(q.prescription, l) / q.focalLengthMm - 1)).toBeLessThan(1e-13);
    }
    expect(q.paraxialFocalLengthMm).toBeCloseTo(FL_MM, 8);

    // S_I nulled by the published formulas at the marginal height it was solved
    // for. THIS is the external number that picks the bending.
    expect(Math.abs(q.seidelS1)).toBeLessThan(1e-9);

    // The design's headline radii (mm), front to back. A strongly NEGATIVE front
    // element — φ₁·f = −13.4 — which is why the back focus is longer than the
    // focal length: 264.0 mm against 250.
    const radii = q.radiiMm.map((r) => Number(r.toFixed(3)));
    expect(radii).toEqual([-33.177, 13.664, 14.723, 30.282, -20.192]);
    expect(q.backFocusMm).toBeCloseTo(264.037, 3);
    expect(q.elementPowers.map((p) => Number((p * FL_MM).toFixed(3)))).toEqual([
      -13.35, 0.816, 3.785, 9.461,
    ]);

    // The conditioning is § 6at.2's, recomputed from the catalogue by a
    // separately written row construction: 12.292 for this quadruple. It is
    // scale-free, so it is the ONE headline number § 6av.8 did not move.
    expect(q.conditioning).toBeCloseTo(12.292, 3);

    // And it is a SOLID: every element still has glass at the rim. § 6av.8 is
    // where that stopped being an assumption.
    expect(q.bendings).toHaveLength(1);
    expect(q.bendings[0]!.minEdgeMm).toBeCloseTo(0.1555, 4);
    expect(q.bendings[0]!.maxSurfaceSlope).toBeCloseTo(0.3659, 4);
    expect(Math.min(...edgesAt(q.curvatures, THICKNESSES, D_MM / 2))).toBeCloseTo(0.1555, 4);
  });

  it("and the thick solve is a TOTAL POWER from the split, which is why it needs a continuation", () => {
    // The number that separates this design from `designs/apochromat`. There the
    // thick solve sits 0.040 of the total power from the thin split (§ 6ar.1's
    // `thinPowerGap`) and the split is a good start. Here it is 1.06 — the thin
    // split is not a nearby lens, it is a different one. (§ 6av first quoted
    // 3.30 at f/12; the gap is a property of the FOCAL LENGTH and the
    // thicknesses, so moving the shipped lens to 250 mm moved it.)
    const q = F25;
    const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: 6 });
    expect(q.thinPowerGap).toBeCloseTo(1.0576, 4);
    expect(tri.thinPowerGap).toBeCloseTo(0.0397, 3);
    expect(q.thinPowerGap / tri.thinPowerGap).toBeGreaterThan(25);

    // It IS the glass being thick, and the way to prove that is to make the
    // glass thin: § 6ar.1's halving check, one design further on. The gap falls
    // towards a ratio of 2 per halving as the lens gets close enough to thin for
    // the linear term to be the whole story.
    //
    // The series runs at a 2 mm aperture and the SAME 250 mm focal length,
    // because thinner glass is less solid and the 10 mm lens refuses at the
    // first halving (§ 6av.8). That it reproduces the shipped lens's own 1.0576
    // at a fifth of the aperture is the rung's own control: the gap belongs to
    // the focal length and the thicknesses, and the aperture only decides
    // whether the result can be made.
    const gaps = [1, 0.5, 0.25, 0.125].map(
      (s) =>
        superachromaticObjective({
          apertureMm: 2,
          focalRatio: 125,
          thicknessesMm: [1.6 * s, 1.2 * s, 1.2 * s, 1.2 * s],
        }).thinPowerGap,
    );
    expect(gaps[0]!).toBeCloseTo(q.thinPowerGap, 10);
    expect(gaps[0]!).toBeCloseTo(1.0576, 4);
    expect(gaps[1]!).toBeCloseTo(0.4649, 4);
    expect(gaps[2]!).toBeCloseTo(0.2194, 4);
    expect(gaps[3]!).toBeCloseTo(0.1068, 4);
    expect(gaps[0]! / gaps[1]!).toBeCloseTo(2.275, 2);
    expect(gaps[2]! / gaps[3]!).toBeCloseTo(2.056, 2);
    expect(gaps[2]! / gaps[3]!).toBeGreaterThan(2);
  });
});

describe("§ 6av.2 — the thin split does not SELECT a thick lens, and the continuation does", () => {
  it("Newton from the split lands on a different lens at 6 of 125 bendings", () => {
    // The rung the whole module rests on. `designs/apochromat` solves its
    // trailing curvatures by damped Newton started at the thin split, and if
    // that method carried over there would be no continuation here. It does not
    // carry over — and the failure is silent, which is what makes it worth a
    // rung rather than a comment. Newton CONVERGES; it converges to another root
    // of the same residual system.
    const form = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: FL_MM });
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
    expect(shared).toBe(125);
    expect(differing).toBe(6);
    // And where they differ the direct solve is not slightly off — it is a lens
    // more than four times as steep, which at any real aperture is not the same
    // article at all.
    expect(worstRatio).toBeGreaterThan(4.3);

    // Both ARE solutions: the direct one unites the four lines just as exactly.
    // So this is not "one of them is wrong", it is "the residual has more than
    // one root and the split does not say which", and that is precisely why
    // S_I(c₁) built on the direct solve has jump discontinuities in it.
    expect(worstPair).not.toBeNull();
    for (const cs of [worstPair!.direct, worstPair!.continued]) {
      const g = form.build(cs as Parameters<typeof form.build>[0], 0);
      for (const l of form.unitedLinesNm) {
        expect(Math.abs(efl(g, l) / FL_MM - 1)).toBeLessThan(1e-13);
      }
    }
    // The continuation's lens is a shallow one and the direct solve's is nowhere
    // near it.
    expect(slope(worstPair!.continued)).toBeLessThan(slope(worstPair!.direct) / 4.3);
  });

  it("...and the answer does not depend on how many steps the continuation takes", () => {
    // What says the walk is tracking a branch rather than manufacturing a
    // step-size artefact. Three times the steps, same lens to 1e−9 relative —
    // they are separate Newton paths converging on one root, so they agree to
    // solver precision and not bit for bit.
    const shallow = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: FL_MM });
    const deep = cementedQuadrupletForm({
      apertureMm: D_MM,
      focalLengthMm: FL_MM,
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
    // grows with sampling. It is stable in both, and the count survives BOTH
    // filters: the one root is a surface and it is a solid.
    const form = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: FL_MM });
    const s1Of = (c1: number): number | null => {
      const cs = form.tryCurvaturesAt(c1);
      if (cs === null) return null;
      const s1 = seidelSums(form.build(cs, FL_MM), LINE_D, { marginalHeightMm: D_MM / 2 }).s1;
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
      let solids = 0;
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
            const surface = Math.max(...cs.map((x) => Math.abs(x) * (D_MM / 2))) < 1;
            if (surface) lenses++;
            if (surface && Math.min(...edgesAt(cs, THICKNESSES, D_MM / 2)) > 0) solids++;
          }
        }
        prevC = c;
        prevS = s;
      }
      expect({ window, steps, roots, lenses, solids }).toEqual({
        window,
        steps,
        roots: 1,
        lenses: 1,
        solids: 1,
      });
    }

    // For scale, the design one glass back, at the same aperture and ratio: two.
    const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: 25 });
    expect(tri.branches).toHaveLength(2);
    expect(F25.bendings).toHaveLength(1);
  });
});

describe("§ 6av.4 — the wall, and what actually sets it", () => {
  it("builds at f/21.9 and refuses at f/21.8, three times the bending-free bound", () => {
    // § 6at.6's f/7.25 is a bound over EVERY bending and stays true; what it
    // cannot say is where the design actually lands. It is a STEEPNESS bound —
    // no surface deeper than a hemisphere — and the wall this design runs into
    // is not a steepness at all. At f/21.9 the steepest surface is 0.42 of a
    // hemisphere and the thinnest element has 1.2 µm of glass at the rim.
    const built = superachromaticObjective({ apertureMm: D_MM, focalRatio: 21.9 });
    expect(built.bendings[0]!.maxSurfaceSlope).toBeCloseTo(0.4228, 3);
    expect(built.bendings[0]!.minEdgeMm).toBeCloseTo(0.00124, 5);

    // f·max|c|/2 — the ratio this bending would require if steepness were what
    // bound it, in § 6at.6's own units. f/9.26: only 1.28× the bound, and
    // nowhere near the f/21.88 the lens actually needs.
    const needs = (o: { curvatures: readonly number[]; focalLengthMm: number }): number =>
      (o.focalLengthMm * Math.max(...o.curvatures.map(Math.abs))) / 2;
    expect(needs(built)).toBeCloseTo(9.26, 1);
    expect(needs(built) / 7.25).toBeCloseTo(1.277, 2);
    // What binds is three times the bound, not half again — § 6av first reported
    // 1.49× because it was measuring the wrong condition (§ 6av.8).
    expect(21.8785 / 7.25).toBeCloseTo(3.018, 2);

    // The refusal is the APERTURE one and says so, since the root is there and
    // is merely unbuildable: slowing the ratio fixes it, changing the glass does
    // not. That distinction is `TripletApertureRefusal`'s and is kept.
    let refusal: Error | undefined;
    try {
      superachromaticObjective({ apertureMm: D_MM, focalRatio: 21.8 });
    } catch (e) {
      refusal = e as Error;
    }
    expect(refusal).toBeInstanceOf(QuadrupletApertureRefusal);
    const message = refusal!.message;
    expect(message).toContain("are not solids");
    expect(message).toContain("slow the focal ratio");
  });

  it("and at f/11 the scan ALSO finds a root that is not a surface, which the triplet never does", () => {
    // `designs/achromat` needs its root-is-a-lens filter for a ghost past the
    // aperture wall (§ 6b.5.7); `designs/apochromat` keeps the filter although
    // nothing it ever built needed it, and § 6ar.2 records that it removes
    // nothing on any input in this repo. Here it removes something on a real
    // input: at f/11 the scan finds two roots, one of them more than two
    // hemispheres deep — and the OTHER one, shallow enough to be a surface, is
    // still not a solid. Both filters fire on the same input, which is why the
    // refusal message names both.
    let refusal: Error | undefined;
    try {
      superachromaticObjective({ apertureMm: D_MM, focalRatio: 11 });
    } catch (e) {
      refusal = e as Error;
    }
    expect(refusal).toBeInstanceOf(QuadrupletApertureRefusal);
    expect(refusal!.message).toContain("found 2, of which 0 are lenses");
    expect(refusal!.message).toContain("1 further root is past hemispherical");
    expect(refusal!.message).toContain("are not solids");
  });
});

describe("§ 6av.5 — the bending belongs to the focal length, the SOLID to the aperture", () => {
  it("f/30 at 10 mm and f/15 at 20 mm are the same five curvatures, and only one is a lens", () => {
    // Worth pinning because it says which knob does what, and the answer is not
    // symmetric: the colour solve and the S_I null are both properties of the
    // 300 mm focal length and the centre thicknesses — S_I ∝ h⁴ scales the whole
    // sum uniformly, so its ZERO does not move with the marginal height. The
    // aperture then decides whether that bending is a lens, and § 6av.8 makes
    // that a stronger condition than it was: not only whether each surface is
    // shallower than a hemisphere, but whether any PAIR of them meets first.
    const a = superachromaticObjective({ apertureMm: 10, focalRatio: 30 });
    const b = cementedQuadrupletForm({ apertureMm: 20, focalLengthMm: 300 });
    expect(a.focalLengthMm).toBe(300);
    const same = b.curvaturesAt(a.bending);
    a.curvatures.forEach((c, i) => expect(same[i]!).toBeCloseTo(c, 12));

    // Same five curvatures, same four thicknesses. At 10 mm every element still
    // has glass at the rim; at 20 mm the last two have crossed, by 0.44 and
    // 2.36 mm. A steepness test cannot tell these apart at all — doubling the
    // aperture doubles max|c|·D/2 from 0.30 to 0.60 and both pass it.
    const at10 = edgesAt(a.curvatures, THICKNESSES, 5);
    const at20 = edgesAt(a.curvatures, THICKNESSES, 10);
    expect(at10.map((e) => Number(e.toFixed(3)))).toEqual([2.678, 1.143, 0.836, 0.334]);
    expect(at20.map((e) => Number(e.toFixed(3)))).toEqual([6.192, 0.912, -0.44, -2.358]);
    expect(Math.max(...a.curvatures.map((c) => Math.abs(c) * 10))).toBeLessThan(1);

    // …so the 20 mm version refuses, and it is the SOLID that refuses it.
    let refusal: Error | undefined;
    try {
      superachromaticObjective({ apertureMm: 20, focalRatio: 15 });
    } catch (e) {
      refusal = e as Error;
    }
    expect(refusal).toBeInstanceOf(QuadrupletApertureRefusal);
    expect(refusal!.message).toContain("are not solids");
    expect(() => superachromaticObjective({ apertureMm: 40, focalRatio: 7.5 })).toThrow(
      QuadrupletApertureRefusal,
    );
  });
});

describe("§ 6av.6 — the band becomes a number, and it is OUTSIDE the band", () => {
  it("the traced crossing is 0.077% of radius, where § 6at predicted 0.09-0.14%", () => {
    // THE HEADLINE, and the reason the step exists. § 6at.8 could only quote a
    // band because the deciding quantity moves 4.6× with the bending and it had
    // no bending; this has one, and both lenses are traced rather than thin.
    //
    // COMMENSURABILITY, first, because a comparison of two lenses at two
    // geometries measures the geometry: the triplet and the quadruplet are built
    // at the SAME aperture and the SAME focal ratio, and the ratio is one the
    // quadruplet can be built at. The triplet would rather be f/6; it is f/25
    // here because the quadruplet cannot be, and that is the honest direction to
    // resolve the difference in.
    const q = F25;
    const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: 25 });

    const triR = worstResidual(tri.prescription, SPANNED);
    const quadR = worstResidual(q.prescription, SPANNED);
    const triX = chromaticSensitivity(tri.prescription, SPANNED);
    const quadX = chromaticSensitivity(q.prescription, SPANNED);

    // The check that licenses the comparison: this file's traced sensitivity for
    // the TRIPLET reproduces § 6at.7's traced 4.999e−2 by an independently
    // written route, to 0.5%.
    expect(triX).toBeCloseTo(5.023e-2, 4);
    expect(Math.abs(triX / 4.999e-2 - 1)).toBeLessThan(0.01);

    expect(triR).toBeCloseTo(2.2301e-4, 7);
    expect(quadR).toBeCloseTo(2.4401e-6, 9);
    expect(quadX).toBeCloseTo(2.8780e-1, 3);

    // The crossing, in § 6at.8's own definition: the error at which the
    // quadruplet's delivered colour equals a PERFECT triplet's.
    const tie = (triR - quadR) / quadX;
    expect(tie).toBeCloseTo(7.664e-4, 6);
    // § 6at.8's band was 9.493e−4 to 1.358e−3. The traced answer is below all of
    // it — the band did not contain the answer, and § 6av.6's second rung says
    // why in one number. The lens moving from f/12 to f/25 (§ 6av.8) moved this
    // from 7.012e−4 to 7.664e−4 and did not change the finding.
    expect(tie).toBeLessThan(9.493e-4);

    // And where BOTH are degraded equally, which is the crossing the delivered
    // table in § 6at.8 actually walks: 9.28e−4.
    expect((triR - quadR) / (quadX - triX)).toBeCloseTo(9.284e-4, 6);

    // The perfect-glass advantage, traced: 91.4× on the band the four lines
    // span, against the thin split's 102.4×. The thick lens keeps 89% of what
    // the thin arithmetic promised, where at f/12 it kept 74% — a slower lens is
    // a thinner one in units of its own focal length.
    expect(triR / quadR).toBeCloseTo(91.4, 0);
    expect(triR / quadR).toBeLessThan(102.4);

    // The wide band, where 430-680 is not doing the quadruplet any favours:
    // 7.7× perfect, against the thin 8.7×, and a crossing at 0.18%.
    const triF = worstResidual(tri.prescription, FULL);
    const quadF = worstResidual(q.prescription, FULL);
    const quadFX = chromaticSensitivity(q.prescription, FULL);
    expect(triF / quadF).toBeCloseTo(7.70, 1);
    expect((triF - quadF) / quadFX).toBeCloseTo(1.840e-3, 5);
  });

  it("...because the S_I bending is worse than BOTH bendings the band was built from", () => {
    // The mechanism, and the lesson worth more than the number: § 6at.8's band
    // came from two bendings — the shallowest (thin sensitivity 2.334e−1) and
    // the most favourable in its scan (1.631e−1) — and neither is the bending a
    // lens is actually built at. The S_I null traces at 2.878e−1, worse than the
    // shallowest by 23% and worse than the favourable one by 77%. A band built
    // from two samples of a quantity is not a bound on it.
    const quadX = chromaticSensitivity(F25.prescription, SPANNED);
    expect(quadX).toBeGreaterThan(2.334e-1);
    expect(quadX / 2.334e-1).toBeCloseTo(1.23, 1);
    expect(quadX / 1.631e-1).toBeCloseTo(1.76, 1);
  });

  it("and the crossing is a property of the DESIGN, not of the fixture it was measured on", () => {
    // The grid, because a headline claimed for one configuration and measured on
    // one configuration is how the last two app parts went wrong. Five
    // configurations — three focal ratios and two glass thicknesses — and the
    // crossing moves by 3%, from 7.57e−4 to 7.83e−4. It drifts towards the thin
    // limit as the glass thins and the ratio slows, which is the direction it
    // should drift and is a check in itself.
    //
    // Every configuration here is a SOLID one: the grid § 6av first ran included
    // f/12 and a halved thickness, and neither is a lens (§ 6av.8). That is why
    // the thickness leg runs 1.5× and 0.75× rather than 1× and 0.5×.
    const crossings = ([
      [25, 1],
      [30, 1],
      [40, 1],
      [30, 1.5],
      [40, 0.75],
    ] as const).map(([F, scale]) => {
      const q = superachromaticObjective({
        apertureMm: D_MM,
        focalRatio: F,
        thicknessesMm: [1.6 * scale, 1.2 * scale, 1.2 * scale, 1.2 * scale],
      });
      expect(q.bendings[0]!.minEdgeMm).toBeGreaterThan(0);
      const tri = apochromaticObjective({ apertureMm: D_MM, focalRatio: F });
      const triR = worstResidual(tri.prescription, SPANNED);
      const quadR = worstResidual(q.prescription, SPANNED);
      return (triR - quadR) / chromaticSensitivity(q.prescription, SPANNED);
    });
    expect(crossings[0]!).toBeCloseTo(7.664e-4, 6);
    expect(crossings[1]!).toBeCloseTo(7.724e-4, 6);
    expect(crossings[2]!).toBeCloseTo(7.790e-4, 6);
    expect(crossings[3]!).toBeCloseTo(7.570e-4, 6);
    expect(crossings[4]!).toBeCloseTo(7.829e-4, 6);
    // Every one of them below the band's lower end, so the finding is not an
    // artefact of the ratio the headline was quoted at.
    for (const c of crossings) expect(c).toBeLessThan(9.493e-4);
    expect(Math.max(...crossings) / Math.min(...crossings)).toBeLessThan(1.04);
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
    // § 6av.8 raised the aperture wall a long way and this refusal is untouched
    // by it, which is the type distinction earning its keep.
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

describe("§ 6av.8 — a root can be a surface and still not be a SOLID", () => {
  /**
   * The lens § 6av shipped, rebuilt from the form so that it can be examined at
   * all: the constructor now refuses it. Every number in this rung is the
   * prescription this file used to call the default.
   */
  const f12 = (() => {
    const form = cementedQuadrupletForm({ apertureMm: D_MM, focalLengthMm: 120 });
    const s1Of = (c1: number): number | null => {
      const cs = form.tryCurvaturesAt(c1);
      if (cs === null) return null;
      const s1 = seidelSums(form.build(cs, 120), LINE_D, { marginalHeightMm: D_MM / 2 }).s1;
      return Number.isFinite(s1) ? s1 : null;
    };
    const lo = form.shallowestBending - 3 * form.bendingSpan;
    const hi = form.shallowestBending + 3 * form.bendingSpan;
    let root: number | null = null;
    let prevC = lo;
    let prevS = s1Of(lo);
    for (let i = 1; i <= 400 && root === null; i++) {
      const c = lo + ((hi - lo) * i) / 400;
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
        if (!hole) root = 0.5 * (a + b);
      }
      prevC = c;
      prevS = s;
    }
    const curvatures = form.curvaturesAt(root!);
    const group = form.build(curvatures, 0);
    const m = paraxialTrace(group, LINE_D, { y: 1, u: 0 });
    return { form, root: root!, curvatures, prescription: form.build(curvatures, -m.y / m.u) };
  })();

  it("the lens § 6av shipped closes 1.4 mm inside its own rim, in closed form", () => {
    // Elementary solid geometry, no ray trace in it: an element's edge thickness
    // at semi-diameter y is t + sag(c_{k+1}, y) − sag(c_k, y), and where that is
    // negative the two faces have crossed and there is no glass. The rear
    // element is 1.2 mm thick between radii of +15.58 and −8.82 mm; at a 5 mm
    // semi-aperture the front face has sagged +0.82 mm and the rear −1.36, so
    // the element ran out 1.18 mm ago.
    expect(f12.curvatures.map((c) => Number((1 / c).toFixed(3)))).toEqual([
      -12.838, 5.765, 6.295, 15.576, -8.823,
    ]);
    const e = edgesAt(f12.curvatures, THICKNESSES, D_MM / 2);
    expect(e.map((x) => Number(x.toFixed(3)))).toEqual([5.509, 0.775, -0.446, -1.178]);

    // Where each of the two closes, bisected on the same closed form. The rear
    // element runs out at 3.62 mm of a 5 mm semi-aperture — 72% of the way out —
    // and the third at 4.46 mm.
    const closesAt = (k: number): number => {
      let lo = 0;
      let hi = D_MM / 2;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (edgesAt(f12.curvatures, THICKNESSES, mid)[k]! > 0) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    expect(closesAt(3)).toBeCloseTo(3.6152, 3);
    expect(closesAt(2)).toBeCloseTo(4.4596, 3);
  });

  it("...and a steepness test cannot see it, which is why the wall was in the wrong place", () => {
    // The two conditions are independent, and this lens is the proof: every one
    // of its five surfaces is comfortably shallower than a hemisphere — 0.867 at
    // the steepest — while two of its four elements have no glass at the rim.
    // `maxSurfaceSlope` is a property of ONE surface at the entering height; an
    // edge thickness is a relation between a PAIR of them, and no amount of
    // per-surface testing is going to notice a pair.
    expect(Math.max(...f12.curvatures.map((c) => Math.abs(c) * (D_MM / 2)))).toBeCloseTo(0.8673, 3);
    expect(Math.min(...edgesAt(f12.curvatures, THICKNESSES, D_MM / 2))).toBeLessThan(-1);
    // And the constructor now refuses it, as the APERTURE refusal: this is a
    // "slow it down" problem and slowing it down is exactly what fixes it.
    expect(() => superachromaticObjective({ apertureMm: D_MM, focalRatio: 12 })).toThrow(
      QuadrupletApertureRefusal,
    );
  });

  it("the ray trace agrees with the arithmetic, and the beam it passes is f/18.6", () => {
    // The independent route, and the reason the defect was found at all: a
    // tolerance budget on this lens kept only 137 of the 313 pupil samples the
    // triplet keeps at the same aperture. Rays entering above 3.231 mm MISS the
    // last surface — not clipped by a glass margin, which would be a different
    // and much smaller defect, but arriving where the prescription has no
    // surface left. So a lens labelled f/12 passes an f/18.6 beam.
    const status = (h: number): string => {
      const r = traceRay(
        f12.prescription,
        makeRay({ x: 0, y: h, z: -50 }, { x: 0, y: 0, z: 1 }, LINE_D),
      );
      return r.status === "ok" ? "ok" : `${r.status}@${String(r.failedAt)}`;
    };
    let lo = 0;
    let hi = D_MM / 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (status(mid) === "ok") lo = mid;
      else hi = mid;
    }
    expect(lo).toBeCloseTo(3.2307, 3);
    expect(120 / (2 * lo)).toBeCloseTo(18.57, 1);
    expect(status(3.2)).toBe("ok");
    expect(status(3.3)).toBe("miss@4");
    // The trace stops a little before the arithmetic does (3.23 entering against
    // the rear element's 3.62) because a marginal ray does not keep its entering
    // height: it climbs to 5.72 mm inside a lens whose entrance is 5 mm.
    const inside = [0, 1, 2, 3, 4].map(
      (i) =>
        paraxialTrace({ surfaces: f12.prescription.surfaces.slice(0, i + 1) }, LINE_D, {
          y: D_MM / 2,
          u: 0,
        }).y,
    );
    expect(Math.max(...inside)).toBeCloseTo(5.724, 2);
  });

  it("and thickening the glass does not rescue the fast end — the null goes away", () => {
    // The obvious repair, measured rather than assumed: give the elements the
    // centre thickness their sags demand and the four-glass system stops having
    // a spherical-aberration null at all at this focal length. So f/12 is not a
    // thickness choice this design got wrong; there is no solid aplanatic
    // quadruplet of these glasses at 10 mm and 120 mm, and the wall at f/21.88
    // is where one starts existing.
    for (const thicknessesMm of [
      [1.6, 1.2, 1.85, 2.6],
      [2, 2, 3, 4],
    ] as const) {
      let error: Error | undefined;
      try {
        superachromaticObjective({
          apertureMm: D_MM,
          focalRatio: 12,
          thicknessesMm: thicknessesMm as unknown as [number, number, number, number],
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(QuadrupletApertureRefusal);
      expect(error!.message).toContain("found 0");
    }
  });

  it("the wall is a joint property of the focal length AND the aperture", () => {
    // The steepness wall scales: max|c|·D/2 doubles when the aperture doubles,
    // so a ratio that builds at one aperture builds at any, which is what
    // § 6av.5 said. Solidity does not scale, because the centre thicknesses are
    // absolute millimetres and the sags grow with the aperture. So the wall is
    // f/20.97 at 5 mm, f/21.88 at 10 mm and f/43.14 at 20 mm — the same glass,
    // the same thicknesses, three different walls.
    const builds = (D: number, F: number): boolean => {
      try {
        superachromaticObjective({ apertureMm: D, focalRatio: F });
        return true;
      } catch {
        return false;
      }
    };
    for (const [D, wall] of [
      [5, 20.9693],
      [10, 21.8785],
      [20, 43.1413],
    ] as const) {
      expect(builds(D, wall * 1.002)).toBe(true);
      expect(builds(D, wall * 0.998)).toBe(false);
    }
  });
});
