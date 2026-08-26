import { describe, it, expect } from "vitest";
import { getMedium } from "../src/materials/catalog";
import {
  abbeNumber,
  LINE_G,
  LINE_D,
  LINE_F,
  LINE_C,
  type Medium,
} from "../src/materials/dispersion";
import { cementedTripletForm, apochromaticObjective } from "../src/designs/apochromat";
import { paraxialTrace } from "../src/trace/paraxial";
import type { Prescription } from "../src/trace/prescription";

/**
 * Step 6at — the fourth colour and its price.
 *
 * **The oldest open question on the colour branch, and the ladder predicted the
 * wrong answer for it.** § 6aq asked whether a superachromat — four united
 * wavelengths, and therefore four telecentric ones — is reachable from
 * `materials/catalog`, and both § 6aq and § 6ar.6 expected a refusal, on the
 * grounds that "a four-glass split would need a SECOND glass off that line, and
 * there is not one". It does not need one. **§ 6at.3 is the correction**, and it
 * is the finding this step exists for.
 *
 * ## What is measured, and against what
 *
 *  - **The split generalizes**, and § 6at.1 is the rung that earns the right to
 *    believe every later number: the N-glass / N-line system reduced to three
 *    glasses and F, d, C reproduces `cementedTripletForm`'s already-pinned
 *    three-glass split to 1.1e−12. The three-glass split is § 6ar.1's external
 *    number; this step inherits it rather than re-deriving it.
 *  - **The SCHOTT N-BK7 data sheet's printed partial dispersions**, P_g,F =
 *    0.5349 and P_d,C = 0.3076. **That is § 6at.4, and it is deliberately NOT
 *    in this file** — a datasheet pin on a catalogue medium belongs with the
 *    other datasheet pins, so it lives in `materials.test.ts`. The rungs here
 *    run .1, .2, .3, .5 …; the gap is that pin and not a missing one.
 *  - **The thin-lens derivative of the maker's equation**, § 6ar.6's own
 *    Δf/f = −ε·f·cₖ·Δnₖ, split into the part that refocuses and the part that
 *    does not (§ 6at.7) and **validated against a traced thick apochromat**.
 *
 * ## The formulation, and why it is the classical one
 *
 * A thin element's power scales across the spectrum as kᵢ(λ) = (nᵢ(λ)−1)/(nᵢ,d−1),
 * so uniting m wavelengths λ₁…λ_m with m glasses is m linear conditions on the
 * element powers:
 *
 *     Σ φᵢ                        = φ        the lens has the focal length asked for
 *     Σ φᵢ·(kᵢ(λⱼ) − kᵢ(λ_m))     = 0        for each j < m
 *
 * That is the classical split row-scaled. For m = 3 and λ = F, d, C the second
 * row is Σφᵢ/Vᵢ = 0 and the third Σφᵢ·Pᵢ/Vᵢ = 0 exactly — which is why § 6at.1
 * can check it against a solve written in the Abbe/partial-dispersion form. For
 * m = 4 the fourth row is the same statement at the g line, and the quantity it
 * is conditioned by is the second relative partial dispersion P_g,F.
 *
 * ## SCOPE — and one limit that shapes every number below
 *
 * **No lens is built here and no constructor ships.** These are thin splits: the
 * element powers, the shallowest bending they admit, and what a curvature error
 * does to them. A thick cemented quadruplet with its spherical-aberration
 * bending solved is a different exercise, and § 6at does not attempt it.
 *
 * The consequence is that the triplet's numbers and the quadruplet's are NOT
 * equally solid, and the prose says so wherever they appear together. The
 * triplet has a built, traced design behind it (`designs/apochromat`), so
 * § 6at.7 can check the thin sensitivity against a traced one and does — to
 * 3.2%. The quadruplet has none, so its sensitivity is thin-only and, worse,
 * **depends on a bending nothing here solves for**: over the scanned bendings it
 * moves by 4.6×. That is why § 6at.8's answer is a BAND and not a number.
 */

const LINES_3 = [LINE_F, LINE_D, LINE_C] as const;
const LINES_4 = [LINE_G, LINE_F, LINE_D, LINE_C] as const;

/** The five solid media in `materials/catalog`. Water, oil and the vitreous
 *  humour are fluids and the eye's idealization; none is an element. */
const SOLIDS = ["N-BK7", "F2", "CAF2", "FUSED-SILICA", "D263"] as const;
const G = Object.fromEntries(SOLIDS.map((n) => [n, getMedium(n)])) as Record<string, Medium>;

/** The one apochromatic triple, and the best of the five quadruples. */
const TRIPLE = ["CAF2", "F2", "N-BK7"] as const;
const QUAD = ["N-BK7", "F2", "CAF2", "FUSED-SILICA"] as const;

const F_MM = 100;
const PHI = 1 / F_MM;

/** Gaussian elimination with partial pivoting; null only if exactly singular. */
function solveN(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i]![k]!) > Math.abs(M[p]![k]!)) p = i;
    if (M[p]![k] === 0) return null;
    [M[k], M[p]] = [M[p]!, M[k]!];
    for (let i = k + 1; i < n; i++) {
      const f = M[i]![k]! / M[k]![k]!;
      for (let j = k; j <= n; j++) M[i]![j]! -= f * M[k]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = s / M[i]![i]!;
  }
  return x;
}

/** kᵢ(λ) — how an element's power scales across the spectrum. */
const k = (g: Medium, l: number): number => (g.n(l) - 1) / (g.n(LINE_D) - 1);

/** The split: unite `lines` (the last is the reference) with `media`. */
function unite(media: readonly Medium[], lines: readonly number[], phi: number): number[] | null {
  const m = media.length;
  if (lines.length !== m) throw new Error("one line per glass");
  const ref = lines[m - 1]!;
  const A: number[][] = [media.map(() => 1)];
  for (let j = 0; j < m - 1; j++) A.push(media.map((g) => k(g, lines[j]!) - k(g, ref)));
  return solveN(A, [phi, ...new Array<number>(m - 1).fill(0)]);
}

const mediaOf = (names: readonly string[]): Medium[] => names.map((n) => G[n]!);

/** max|φᵢ|/φ — the split's conditioning, scale-free, § 6ar.6's own measure. */
const conditioning = (p: readonly number[]): number => Math.max(...p.map((x) => Math.abs(x / PHI)));

/**
 * The cemented stack's curvatures at a given bending. The split fixes only the
 * DIFFERENCES cᵢ − cᵢ₊₁ = φᵢ/(nᵢ−1); c₁ slides all of them together and changes
 * no first-order and no chromatic property, exactly as in `designs/apochromat`.
 * `bend = 0` is the bending that minimizes max|cₖ| — the shallowest lens the
 * split admits, which is what makes § 6at.6's wall a bound rather than a sample.
 */
function curvatures(media: readonly Medium[], p: readonly number[], bend = 0): number[] {
  const S = [0];
  for (let i = 0; i < media.length; i++) S.push(S[i]! - p[i]! / (media[i]!.n(LINE_D) - 1));
  const shallowest = -(Math.max(...S) + Math.min(...S)) / 2;
  return S.map((s) => s + shallowest + bend);
}

/** R(λ) = φ(λ)/φ_d − 1: the residual colour, zero at d by construction. */
function residual(media: readonly Medium[], p: readonly number[], lo: number, hi: number): number {
  const phi = p.reduce((s, x) => s + x, 0);
  let w = 0;
  for (let l = lo; l <= hi; l += 0.25) {
    w = Math.max(w, Math.abs(media.reduce((s, g, i) => s + p[i]! * k(g, l), 0) / phi - 1));
  }
  return w;
}

/**
 * The CHROMATIC part of a relative curvature error, per unit ε, worst over the
 * surfaces and over the band. A curvature error moves the two element powers
 * that share the surface; the resulting δR(λ) = Σ δφᵢ·(kᵢ(λ)−1)/φ is zero at d
 * by construction, so it is purely the part a refocus cannot remove.
 *
 * `phi` is the lens's OWN total power and is not optional-with-a-default: the
 * quantity is a fraction of the focal length, so normalizing a 60 mm lens by a
 * 100 mm one silently scales every answer by 1.667 and still looks plausible.
 */
function chromaticSensitivity(
  media: readonly Medium[],
  cs: readonly number[],
  phi: number,
  lo: number,
  hi: number,
  step = 0.25,
): number {
  const m = media.length;
  let worst = 0;
  for (let s = 0; s <= m; s++) {
    const dphi = new Array<number>(m).fill(0);
    const dc = cs[s]!;
    if (s > 0) dphi[s - 1]! -= (media[s - 1]!.n(LINE_D) - 1) * dc;
    if (s < m) dphi[s]! += (media[s]!.n(LINE_D) - 1) * dc;
    for (let l = lo; l <= hi; l += step) {
      worst = Math.max(
        worst,
        Math.abs(media.reduce((a, g, i) => a + dphi[i]! * (k(g, l) - 1), 0) / phi),
      );
    }
  }
  return worst;
}

/** The band the four united lines span. NOT a neutral choice — see § 6at.5. */
const SPANNED: readonly [number, number] = [430, 680];
/** The whole traced band, where the triplet and the quadruplet both extrapolate. */
const FULL: readonly [number, number] = [380, 800];

describe("§ 6at.1 — the N-glass split reduces to the three-glass one already pinned", () => {
  it("reproduces cementedTripletForm's thin split to 1e-11 on every triple", () => {
    // The rung that licenses the rest. If the general row construction were
    // wrong, every conditioning and every residual below would be noise, and
    // nothing downstream would notice. So it is checked against the solve that
    // is written in the OTHER form — Cramer on Σφ = φ, Σφ/V = 0, ΣφP/V = 0,
    // § 6ar.1's external number — and not against another copy of itself.
    const worst = new Map<string, number>();
    for (let i = 0; i < SOLIDS.length; i++) {
      for (let j = 0; j < SOLIDS.length; j++) {
        for (let l = 0; l < SOLIDS.length; l++) {
          if (i === j || j === l || i === l) continue;
          const names = [SOLIDS[i]!, SOLIDS[j]!, SOLIDS[l]!] as const;
          const mine = unite(mediaOf(names), LINES_3, PHI);
          expect(mine).not.toBeNull();
          const theirs = cementedTripletForm({
            apertureMm: 10,
            focalLengthMm: F_MM,
            media: names,
          }).thinElementPowers;
          worst.set(
            names.join("/"),
            Math.max(...mine!.map((p, n) => Math.abs(p / theirs[n]! - 1))),
          );
        }
      }
    }
    expect(worst.size).toBe(60);
    for (const [, rel] of worst) expect(rel).toBeLessThan(1e-10);

    // And the agreement is TIGHTEST where the triple is best conditioned, which
    // is the arithmetic telling the truth about itself: the fluorite triple
    // agrees to ~1e-12 and the 518-conditioned one only to ~3e-11, the loss
    // being the conditioning amplifying each solve's own rounding.
    expect(worst.get("CAF2/F2/N-BK7")!).toBeLessThan(2e-12);
    expect(worst.get("F2/FUSED-SILICA/D263")!).toBeGreaterThan(1e-11);
  });
});

describe("§ 6at.2 — the four-glass split SOLVES, and the predicted refusal is not there", () => {
  it("all five quadruples solve, at conditioning 12.3 to 92.4", () => {
    // § 6aq and § 6ar.6 both expected this to fail for want of a second
    // anomalous glass. Every quadruple in the catalogue solves instead, and the
    // best of them is conditioned within a factor of five of the apochromatic
    // TRIPLE — not the two orders of magnitude that separated a fluorite triple
    // from an ordinary one.
    const conds = new Map<string, number>();
    for (let drop = 0; drop < SOLIDS.length; drop++) {
      const names = SOLIDS.filter((_, i) => i !== drop);
      const p = unite(mediaOf(names), LINES_4, PHI);
      expect(p).not.toBeNull();
      conds.set(names.join("/"), conditioning(p!));
    }
    expect(conds.size).toBe(5);
    expect(conds.get("N-BK7/F2/CAF2/FUSED-SILICA")!).toBeCloseTo(12.292, 2);
    expect(conds.get("F2/CAF2/FUSED-SILICA/D263")!).toBeCloseTo(12.891, 2);
    expect(conds.get("N-BK7/CAF2/FUSED-SILICA/D263")!).toBeCloseTo(15.540, 2);
    expect(conds.get("N-BK7/F2/CAF2/D263")!).toBeCloseTo(92.360, 2);

    // The apochromatic triple for scale: 2.578 (§ 6ar.6).
    const tri = conditioning(unite(mediaOf(TRIPLE), LINES_3, PHI)!);
    expect(tri).toBeCloseTo(2.578141, 5);
    expect(conds.get("N-BK7/F2/CAF2/FUSED-SILICA")! / tri).toBeLessThan(5);

    // Scale-free, exactly as the three-glass conditioning is.
    for (const f of [10, 1000]) {
      const p = unite(mediaOf(QUAD), LINES_4, 1 / f)!;
      expect(Math.max(...p.map((x) => Math.abs(x * f)))).toBeCloseTo(12.292, 2);
    }
  });

  it("and the FLUORITE-FREE quadruple solves too, which is the load-bearing one", () => {
    // This is what kills the deferral's reasoning outright. If the fourth
    // condition needed an anomalous glass, dropping the catalogue's only one
    // would leave the system unusable. It leaves it at 59.2 — worse than a
    // fluorite quadruple by 4.8×, but BETTER than the fluorite-free apochromatic
    // TRIPLE at 517.9, which § 6ar.6 already showed is a real (if slow) lens.
    const noCaF2 = unite(mediaOf(["N-BK7", "F2", "FUSED-SILICA", "D263"]), LINES_4, PHI);
    expect(noCaF2).not.toBeNull();
    expect(conditioning(noCaF2!)).toBeCloseTo(59.224, 2);
    expect(conditioning(noCaF2!)).toBeLessThan(
      conditioning(unite(mediaOf(["F2", "FUSED-SILICA", "D263"]), LINES_3, PHI)!),
    );
  });
});

describe("§ 6at.3 — the fourth row wants NON-COPLANARITY, not a second anomaly", () => {
  it("the four ordinary glasses miss the (1, V, P_dC) → P_gF plane by 5.8e-4", () => {
    // THE CORRECTION. § 6ar.6 measured the normal LINE, P = 0.2751 + 5.139e−4·V,
    // and read off it that a four-glass split "would need a SECOND glass off that
    // line". That reasoning does not survive being run: the fourth condition is
    // not a second line, it is a second DIMENSION, and what conditions it is
    // whether the glasses are coplanar in (V, P_dC, P_gF) — not whether any one
    // of them is anomalous.
    //
    // Fitted over the four ordinary glasses (three parameters, four points, so
    // one degree of freedom is left to be missed by), the miss is 5.8e−4. It is
    // small, and it is not zero, and being not zero is the whole of why the
    // fluorite-free quadruple of § 6at.2 solves at all.
    const P_dC = (g: Medium): number =>
      (g.n(LINE_D) - g.n(LINE_C)) / (g.n(LINE_F) - g.n(LINE_C));
    const P_gF = (g: Medium): number =>
      (g.n(LINE_G) - g.n(LINE_F)) / (g.n(LINE_F) - g.n(LINE_C));

    const ordinary = mediaOf(SOLIDS.filter((n) => n !== "CAF2"));
    const X = ordinary.map((g) => [1, abbeNumber(g), P_dC(g)]);
    const y = ordinary.map((g) => P_gF(g));
    const AtA = [0, 1, 2].map((a) => [0, 1, 2].map((b) => X.reduce((s, r) => s + r[a]! * r[b]!, 0)));
    const Aty = [0, 1, 2].map((a) => X.reduce((s, r, i) => s + r[a]! * y[i]!, 0));
    const co = solveN(AtA, Aty)!;
    const off = (g: Medium): number =>
      P_gF(g) - (co[0]! + co[1]! * abbeNumber(g) + co[2]! * P_dC(g));

    const worstOrdinary = Math.max(...ordinary.map((g) => Math.abs(off(g))));
    expect(worstOrdinary).toBeCloseTo(5.833e-4, 6);
    expect(worstOrdinary).toBeGreaterThan(0);

    // Fluorite is 33× further off the PLANE than the worst ordinary glass — the
    // same qualitative statement § 6ar.6 made about the LINE, where the factor
    // was 44. So fluorite is still the anomalous one, and it still buys the best
    // conditioning; what it is no longer is NECESSARY.
    const fluorite = Math.abs(off(G["CAF2"]!));
    expect(fluorite).toBeCloseTo(1.946e-2, 5);
    expect(fluorite / worstOrdinary).toBeGreaterThan(33);
    expect(fluorite / worstOrdinary).toBeLessThan(34);
  });

  it("...and the ordinary scatter is what the fluorite-free split rides on", () => {
    // The mechanism, stated as a proportionality rather than as a story: the
    // conditioning of a split goes as the reciprocal of how far off-plane its
    // glasses are, so a quadruple whose glasses miss by 33× less is conditioned
    // some 33× worse — 59.2 against a plane-miss of 5.8e−4, 12.3 against
    // fluorite's 1.95e−2. The two ratios are 4.8× and 33×, so it is a
    // proportionality in the right direction and NOT a clean 1/x; the split's
    // conditioning is a property of all four glasses at once and no single
    // pairwise distance can carry it. The rung claims the direction, which is
    // what the correction needs, and does not claim the law.
    const withCaF2 = conditioning(unite(mediaOf(QUAD), LINES_4, PHI)!);
    const without = conditioning(
      unite(mediaOf(["N-BK7", "F2", "FUSED-SILICA", "D263"]), LINES_4, PHI)!,
    );
    expect(without).toBeGreaterThan(withCaF2);
    expect(without / withCaF2).toBeCloseTo(4.818, 2);
  });
});

describe("§ 6at.5 — what the fourth colour buys, on two bands and against five lines", () => {
  it("102× over the band the four lines span, 8.7× over the whole traced band", () => {
    // Both numbers, because they answer different questions and the bigger one
    // is band-rigged by construction: 430–680 is very nearly the interval g…C
    // spans, so the quadruplet interpolates there and the triplet — united only
    // at F, d, C — extrapolates below 486. That is a real advantage and it is
    // also the most flattering way to state it, so the honest headline carries
    // the 380–800 figure beside it.
    const tri = unite(mediaOf(TRIPLE), LINES_3, PHI)!;
    const quad = unite(mediaOf(QUAD), LINES_4, PHI)!;
    const triM = mediaOf(TRIPLE);
    const quadM = mediaOf(QUAD);

    const triSpan = residual(triM, tri, ...SPANNED);
    const quadSpan = residual(quadM, quad, ...SPANNED);
    expect(triSpan).toBeCloseTo(2.237e-4, 6);
    expect(quadSpan).toBeCloseTo(2.184e-6, 8);
    expect(triSpan / quadSpan).toBeCloseTo(102.4, 0);

    const triFull = residual(triM, tri, ...FULL);
    const quadFull = residual(quadM, quad, ...FULL);
    expect(triFull).toBeCloseTo(1.045e-3, 5);
    expect(quadFull).toBeCloseTo(1.199e-4, 6);
    expect(triFull / quadFull).toBeCloseTo(8.7, 1);

    // The four lines really are united — this is the solve's own target and on
    // its own proves only that it converged, exactly as § 6aq.1's 1e−14 did.
    for (const l of LINES_4) {
      expect(Math.abs(quadM.reduce((s, g, i) => s + quad[i]! * k(g, l), 0) / PHI - 1)).toBeLessThan(
        1e-13,
      );
    }
  });

  it("and g is the MEASURED best fourth line in-band, h the best over 380–800", () => {
    // The fourth line is a choice, and a choice that is not measured is an
    // assumption wearing a number. Five candidates, same four glasses.
    const run = (l4: number): { inBand: number; full: number } => {
      const lines = l4 < LINE_C ? [l4, LINE_F, LINE_D, LINE_C] : [LINE_F, LINE_D, LINE_C, l4];
      const p = unite(mediaOf(QUAD), lines, PHI)!;
      return {
        inBand: residual(mediaOf(QUAD), p, ...SPANNED),
        full: residual(mediaOf(QUAD), p, ...FULL),
      };
    };
    const g = run(LINE_G);
    const h = run(404.6561); // Hg h
    const r = run(706.5188); // He r
    const e = run(546.074); // Hg e

    // g wins the band it spans, by 4.5× over h and an order over r.
    expect(g.inBand).toBeLessThan(h.inBand);
    expect(g.inBand).toBeLessThan(r.inBand);
    expect(g.inBand).toBeLessThan(e.inBand);
    expect(h.inBand / g.inBand).toBeCloseTo(4.53, 1);

    // ...and LOSES the full band to h, which reaches further into the violet
    // where the residual actually lives. The step keeps g because the in-band
    // figure is the one § 6aq's telecentric question is bounded by, and says so
    // rather than pretending one line is best at everything.
    expect(h.full).toBeLessThan(g.full);
    expect(g.full / h.full).toBeCloseTo(2.06, 1);
  });
});

describe("§ 6at.6 — the focal-ratio wall, bending-independent and scale-free", () => {
  it("no superachromat here is faster than f/7.2, against the apochromat's f/1.5", () => {
    // The split fixes the curvature DIFFERENCES and leaves the bending free, so
    // minimizing max|cₖ| over the bending is a closed-form lower bound on how
    // steep the lens must be — no S_I scan, no thick solve, and true of EVERY
    // bending rather than of one sampled one. With max|c|·(D/2) ≤ 1 the wall is
    // F ≥ f·max|c|/2, and f·max|c| is scale-free.
    const wall = (names: readonly string[], lines: readonly number[]): number => {
      const media = mediaOf(names);
      const cs = curvatures(media, unite(media, lines, PHI)!);
      return (F_MM * Math.max(...cs.map(Math.abs))) / 2;
    };
    expect(wall(TRIPLE, LINES_3)).toBeCloseTo(1.49, 2);
    expect(wall(QUAD, LINES_4)).toBeCloseTo(7.25, 2);
    expect(wall(["N-BK7", "F2", "FUSED-SILICA", "D263"], LINES_4)).toBeCloseTo(28.32, 2);

    // Scale-free, so it is a property of the glasses and the lines and not of a
    // focal length — the same statement § 6ar.6 makes about conditioning.
    for (const f of [10, 1000]) {
      const media = mediaOf(QUAD);
      const cs = curvatures(media, unite(media, LINES_4, 1 / f)!);
      expect((f * Math.max(...cs.map(Math.abs))) / 2).toBeCloseTo(7.25, 2);
    }

    // It is a LOWER bound and not a prediction, and the built lens shows the
    // gap: `designs/apochromat` picks its bending by nulling S_I, not by being
    // shallow, so the triplet it actually builds is steeper than the bound —
    // f/1.53 against f/1.49. The bound says what is impossible, not what is
    // achievable, and on this triple the two are 3% apart.
    const built = apochromaticObjective({ apertureMm: 10, focalRatio: 6 });
    const builtWall = (60 * Math.max(...built.curvatures.map(Math.abs))) / 2;
    expect(builtWall).toBeCloseTo(1.53, 2);
    expect(builtWall).toBeGreaterThan(wall(TRIPLE, LINES_3));
    expect(builtWall / wall(TRIPLE, LINES_3) - 1).toBeLessThan(0.03);
  });
});

describe("§ 6at.7 — the chromatic half of a curvature error, and it is traced", () => {
  it("the thin closed form matches a TRACED thick apochromat to 3.2%", () => {
    // § 6ar.6 pinned what a curvature error does to the FOCAL LENGTH. Most of
    // that is a uniform shift, which is a refocus and costs a corrected lens
    // nothing; the part that matters is what survives refocusing. Splitting them
    // is not bookkeeping — measured against the ORIGINAL d-line focal length
    // instead of the perturbed lens's own, the refocusable part is 74× the
    // chromatic one on the front surface and would drown it entirely.
    const obj = apochromaticObjective({ apertureMm: 10, focalRatio: 6 });
    const group = obj.prescription;
    const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;
    const media = mediaOf(TRIPLE);
    const EPS = 1e-6;

    // R(λ) against each prescription's OWN d line, so the refocus is gone.
    const tracedR = (g: Prescription, l: number): number => efl(g, LINE_D) / efl(g, l) - 1;

    for (let s = 0; s < 4; s++) {
      const bumped: Prescription = {
        surfaces: group.surfaces.map((x, i) =>
          i === s ? { ...x, curvature: x.curvature * (1 + EPS) } : x,
        ),
      };
      let traced = 0;
      for (let l = SPANNED[0]; l <= SPANNED[1]; l += 2.5) {
        traced = Math.max(traced, Math.abs((tracedR(bumped, l) - tracedR(group, l)) / EPS));
      }
      // The same surface's thin prediction, on the REAL built curvatures and
      // normalized by the REAL built power — the lens is f/6 at 10 mm, so 60 mm
      // and not this file's 100 mm reference.
      const thin = chromaticSensitivity(
        media,
        obj.curvatures.map((c, i) => (i === s ? c : 0)),
        1 / obj.paraxialFocalLengthMm,
        SPANNED[0],
        SPANNED[1],
        2.5,
      );
      expect(Math.abs(traced / thin - 1)).toBeLessThan(0.032);
    }
  });

  it("and the quadruplet's own sensitivity is 4.5× the triplet's at the same bending", () => {
    // Where the fourth glass is paid for. The powers are 4.8× larger, the
    // curvatures with them, and a relative curvature error injects colour in
    // proportion.
    const triM = mediaOf(TRIPLE);
    const quadM = mediaOf(QUAD);
    const triC = curvatures(triM, unite(triM, LINES_3, PHI)!);
    const quadC = curvatures(quadM, unite(quadM, LINES_4, PHI)!);
    const triX = chromaticSensitivity(triM, triC, PHI, ...SPANNED);
    const quadX = chromaticSensitivity(quadM, quadC, PHI, ...SPANNED);
    expect(triX).toBeCloseTo(5.180e-2, 4);
    expect(quadX).toBeCloseTo(2.334e-1, 3);
    expect(quadX / triX).toBeCloseTo(4.51, 1);

    // The triplet's shallowest-bending value is within 4% of what § 6at.7's
    // FIRST rung traced on the real f/6 triplet, whose bending is the S_I root
    // and not the shallow one. That agreement is this triple's luck and is NOT a
    // law — see the next rung, where the same quantity moves 4.6× with bending.
    expect(Math.abs(triX / 4.999e-2 - 1)).toBeLessThan(0.04);
  });
});

describe("§ 6at.8 — so the advantage is a BAND, and it closes at a shop tolerance", () => {
  it("the sensitivity moves 4.6× with a bending this step does not solve for", () => {
    // The reason § 6at.8 cannot quote one number. `designs/apochromat` picks its
    // bending by nulling third-order spherical aberration; no quadruplet is
    // built here, so where ITS bending would land is unknown, and the quantity
    // that decides the answer is not bending-independent the way § 6at.6's wall
    // is.
    const quadM = mediaOf(QUAD);
    const p = unite(quadM, LINES_4, PHI)!;
    let lo = Infinity;
    let hi = 0;
    for (let bend = -0.3; bend <= 0.3; bend += 0.002) {
      const x = chromaticSensitivity(quadM, curvatures(quadM, p, bend), PHI, ...SPANNED, 1);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    expect(lo).toBeCloseTo(1.631e-1, 3);
    expect(hi).toBeCloseTo(7.529e-1, 3);
    expect(hi / lo).toBeCloseTo(4.6, 1);
  });

  it("102× perfect becomes ~9-15× at 0.01% radius, and nothing by 0.1-0.2%", () => {
    // The break-even: the relative curvature error at which the colour a lens
    // INJECTS equals the colour it was built to remove. For the apochromatic
    // triplet that is 4.3e−3 — 0.43% of the radius, looser than any grade a shop
    // quotes, which is why an apochromat is a manufacturable article. For the
    // quadruplet it is 9.4e−6, a factor of 460 tighter.
    //
    // Published radius grades are around 0.1% (precision) and 0.01% (high
    // precision) — shop practice, not physics, so no number here is pinned to
    // them; they are the scale the reader brings.
    const triM = mediaOf(TRIPLE);
    const quadM = mediaOf(QUAD);
    const triP = unite(triM, LINES_3, PHI)!;
    const quadP = unite(quadM, LINES_4, PHI)!;
    const triR = residual(triM, triP, ...SPANNED);
    const quadR = residual(quadM, quadP, ...SPANNED);
    const triX = chromaticSensitivity(triM, curvatures(triM, triP), PHI, ...SPANNED);
    const quadX = chromaticSensitivity(quadM, curvatures(quadM, quadP), PHI, ...SPANNED);

    expect(triR / triX).toBeCloseTo(4.319e-3, 5);
    expect(quadR / quadX).toBeCloseTo(9.361e-6, 8);
    expect(triR / triX / (quadR / quadX)).toBeGreaterThan(460);

    // What each delivers at a given relative curvature error, both at the same
    // (shallowest) bending so the comparison is like for like.
    const delivered = (r: number, x: number, eps: number): number => r + x * eps;
    const ratio = (eps: number): number =>
      delivered(triR, triX, eps) / delivered(quadR, quadX, eps);
    expect(ratio(0)).toBeCloseTo(102.4, 0); // perfect glass
    expect(ratio(1e-4)).toBeCloseTo(8.97, 1); // 0.01%
    expect(ratio(1e-3)).toBeCloseTo(1.17, 1); // 0.1% — gone
    expect(ratio(2e-3)).toBeLessThan(1); // 0.2% — worse than the triplet

    // The band. At the bending most favourable to the quadruplet (§ 6at.8's own
    // scan) it keeps 15× at 0.01% and ties a PERFECT triplet only at 1.4e−3; at
    // the shallowest bending it keeps 9× and ties at 9.5e−4. So the crossing is
    // between 0.09% and 0.14% and the step does not pretend to place it closer.
    const quadBest = 1.631e-1;
    const tieShallow = (triR - quadR) / quadX;
    const tieBest = (triR - quadR) / quadBest;
    expect(tieShallow).toBeCloseTo(9.493e-4, 5);
    expect(tieBest).toBeCloseTo(1.358e-3, 5);
    expect(tieShallow).toBeGreaterThan(9e-4);
    expect(tieBest).toBeLessThan(1.4e-3);
  });
});
