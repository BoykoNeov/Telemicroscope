import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6cf — the guard constant is two log slopes, and it is not monotone.
 *
 * § 6ca left two bullets that § 6cb…§ 6ce did not touch: "**Why the stage seam
 * is more guard-sensitive on one axis than the other is not derived.** § 6ca.2
 * says the number belongs to the mosaic's geometry rather than to any cell, and
 * § 6ca.3 says it depends on the ratio and nothing else. It does not say what
 * function of the ratio, and no closed form is offered", and "**The axis
 * constant's own turn is not located.**"
 *
 * The first closes here in one line of calculus, with no sweep: § 6ce's `PHI0`
 * is a QUOTIENT of two seams that each have a closed form, and § 6ca's constant
 * is those same two seams read as a RATIO OF LOG SLOPES rather than as a ratio.
 * The second closes differently from the way § 6ca framed it — the constant has
 * a turn § 6ca never saw, inside the domain, and the collapse § 6ca did see is
 * outside it.
 *
 * ## The guard moves one variable, so a guard sensitivity is a log slope
 *
 * § 6cd.1: the stage seam depends on the anchor, the guard, the wavelength and
 * the frame ONLY through `w = xi/cx`, the kept half tile over the field offset.
 * So "how fast does the seam move when the guard moves" is `dln(seam)/dln(w)`
 * and nothing else, and § 6ce already has both seams:
 *
 *     rows ∝ w·(2 + 2w − w²)        cols ∝ w²·sqrt(w² + 4)
 *
 * Differentiate each in place of dividing them:
 *
 *     Lr(w) = (2 + 4w − 3w²) / (2 + 2w − w²)
 *     Lc(w) = (3w² + 8) / (w² + 4)
 *
 * and `Lr − Lc` is § 6ce's own `L0` term for term (§ 6cf.0) — the same two
 * polynomials, taken apart instead of together. § 6ca's axis constant, which is
 * the column seam's guard sensitivity over the row seam's, is therefore
 *
 *     A(w) = Lc(w) / Lr(w) = (3w² + 8)(2 + 2w − w²) / [(w² + 4)(2 + 4w − 3w²)]
 *
 * with no lens, no guard, no wavelength and no frame in it. That is § 6ca.2's
 * "the map's own shape divides out" and § 6ca.3's "it is a function of the
 * ratio" as a consequence rather than as an observation, and against the LIVE
 * `mosaicSeamShiftMm` the secant form of it holds to 1.7e-3 across the domain
 * and four cells (§ 6cf.1) — reproducing § 6ca.2's own published 1.8211.
 *
 * ## And the mechanism is one power of the tile
 *
 * `Lr(0) = 1` and `Lc(0) = 2`: the row seam is FIRST order in the kept tile and
 * the column seam is SECOND, so at a small tile the guard moves the column seam
 * exactly twice as fast. That is the whole of § 6ca's undecided "why one axis
 * and not the other", and the rest is shape:
 *
 *     A(w) = 2 − 2w + (25/4)w² − (61/4)w³ + (635/16)w⁴ − …    (§ 6cf.2)
 *
 * ## The constant has a minimum, and § 6ca stepped over it
 *
 * § 6ca recorded "the constant GROWS with the ratio". It does not, below one
 * point: `A` FALLS from 2, turns, and climbs back. The turn is algebraic —
 * `Lc'/Lc = Lr'/Lr` clears to
 *
 *     3w⁶ + 24w⁵ − 26w⁴ + 80w³ + 40w² + 144w − 64 = 0
 *
 * one positive real root, `w = 0.37736072206222404`, `A = 1.7242148` (§ 6cf.3).
 * It is NOT § 6ce's bend at 0.33945: that root is where the DIFFERENCE `Lr − Lc`
 * is stationary and this is where the QUOTIENT is. § 6ca's two lowest anchors
 * sit either side of it, and § 6ca published a value at each: 1.727 at its ratio
 * 0.468, in the paragraph that says the constant GROWS with the ratio, and
 * 1.72618 at 0.585, four paragraphs later in § 6ca.3's own collapse check.
 * They go DOWN. The step that recorded the rise had already printed the
 * counter-example.
 *
 * `A` then returns to exactly 2 — its own zero-tile value — at the root of
 *
 *     3w³ − 2w² + 18w − 16 = 0,   w = 0.8642856628747042
 *
 * because `A − 2` factors as `w·(3w³ − 2w² + 18w − 16)` over the two
 * denominators (§ 6cf.4), and all four cells cross 2 live inside the anchors
 * that bracket it.
 *
 * ## Which leaves § 6ca's collapse where § 6cd.1 said it would be
 *
 * Two things have to be said before § 6ca's own anchors can be read against
 * this. First a unit: § 6ca's quoted "ratio" is `objectFieldTile`'s half extent
 * at the DESIGN wavelength over the field offset, and the seam lives on the
 * mosaic's RULER tile at 430 nm, with `halfExtentMm` ∝ λ to 8e-11 — so § 6ca's
 * ratio is 1.36642× this `w` (§ 6cf.5). Second a domain: only § 6ca's two
 * lowest anchors are inside § 6cd.1's `w < 1`.
 *
 * Past it the form degrades exactly as § 6cd.1 says it must — 26% out at
 * `w = 1.24` — and its extrapolation has a pole where `Lr` vanishes, at
 * `(2 + sqrt(10))/3 = 1.7207592`, which is the row seam's own maximum. **That
 * pole is not offered as § 6ca's collapse**: the form is already a quarter wrong
 * at w = 1.24, well below it, and the live seam has left the corner. § 6ca's
 * "whether that is one event or two" answers ONE, and the event is § 6cd.1's
 * domain edge — the same edge § 6bz.4's per-cell turns sit past.
 */

const DESIGN = 587.5618;
/** The mosaic's ruler: the bluest sample, and the tile the seam actually has. */
const RULER = 430;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6ce used it: no render, so no focus stage. */
const FREE_STAGE: TileStageMm = () => 0;

type Cell = "s10" | "f10" | "s20" | "f20";
const LENS: Record<Cell, OpticalSystem> = {
  s10: build(10, 0.1),
  f10: build(10, 0.2),
  s20: build(20, 0.1),
  f20: build(20, 0.2),
};
const MAG: Record<Cell, number> = { s10: 10, f10: 10, s20: 20, f20: 20 };
/** § 6bo's shapes at k = 1. `size` and `pupilSamples`, in that order. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

const BIG = 2 ** 26;
/** § 6ca's own field offset, and `cx` throughout. */
const CX = 2;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;

const optsFor = (c: Cell, j: number, i: number): FluorescenceMosaicOptions => ({
  size: BIG,
  pupilSamples: PS_AT(c, j),
  slabs: THIN,
  samples: [
    { nm: RULER, weight: 1 },
    { nm: DESIGN, weight: 1 },
    { nm: 656.2725, weight: 1 },
  ],
  tiles: 3,
  guardCells: (i * j) / 2 ** 24,
  stageMm: FREE_STAGE,
  radialMapSeed: "magnification",
  centreMm: { x: CX, y: 0 },
  scan: "stage",
});

/** § 6ca's two guard settings: 2⁻²⁰ of a cell, and a guard share of 1/16. */
const TINY = 8;
const WIDE = 524288;

/** The corner's own offset over the field offset, read off the live geometry —
 *  § 6cd's `wOfLive`, at § 6ca's field offset. */
function wOfLive(c: Cell, j: number, i: number): number {
  const g = fluorescenceMosaicGeometry(LENS[c], optsFor(c, j, i));
  const frame = g.planes[g.rulerIndex]!.frame;
  return ((g.tileSize / 2 - g.croppedPixels - g.guardPixels) * frame.pixelScaleMm) / CX;
}

/** § 6cd's seam in four evaluations of the map's radial function, at any `cx`. */
function seamOf(c: Cell, cx: number, w: number): { rows: number; cols: number } {
  const system = LENS[c];
  const R = (t: number): number =>
    (t < 0 ? -1 : 1) *
    objectHeightForImageRadius(system, Math.abs(t), RULER, { magnification: MAG[c] });
  const m = (t: number): number => R(t) / t;
  const xi = w * cx;
  const P = cx + xi;
  const Q = cx - xi;
  const rP = Math.hypot(P, xi);
  const rQ = Math.hypot(Q, xi);
  return {
    rows: Math.abs(2 * xi * m(rQ) - R(P) + R(Q)),
    cols: Math.hypot(P * (m(rP) - m(P)) - Q * (m(rQ) - m(Q)), xi * (m(rP) - m(rQ))),
  };
}

/** The two seams' guard sensitivities, in closed form. */
const Lr = (w: number): number => (2 + 4 * w - 3 * w * w) / (2 + 2 * w - w * w);
const Lc = (w: number): number => (3 * w * w + 8) / (w * w + 4);
/** § 6ca's axis constant. */
const A = (w: number): number => Lc(w) / Lr(w);
/** § 6ce's own `L0`, verbatim — `Lr − Lc` has to equal it. */
const L0 = (w: number): number =>
  (w * (2 - 2 * w)) / (2 + 2 * w - w * w) - 1 - (w * w) / (w * w + 4);

/** `A` stationary — `Lc'/Lc = Lr'/Lr` with both denominators cleared. */
const MIN6 = (w: number): number =>
  ((((((3 * w + 24) * w - 26) * w + 80) * w + 40) * w + 144) * w) - 64;
/** `A = 2` off the axis — the cofactor of `w` in the numerator of `A − 2`. */
const TWO3 = (w: number): number => ((3 * w - 2) * w + 18) * w - 16;

/** § 6ce's log slope of a TRACED curve: central difference at a relative step
 *  of 1e-5, which is inside that step's own flat region. */
const L = (F: (w: number) => number, w: number): number =>
  (Math.log(F(w * 1.00001)) - Math.log(F(w * 0.99999))) / 2e-5;

/** Bisection, to the last bit a double holds. */
function root(g: (x: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let n = 0; n < 200; n++) {
    const mid = (a + b) / 2;
    if (g(a) * g(mid) <= 0) b = mid;
    else a = mid;
  }
  return (a + b) / 2;
}
const WMIN = root(MIN6, 0.2, 0.6);
const WTWO = root(TWO3, 0.5, 1.5);

/** § 6ca's own quantity, per cell: the column seam's log change over the row
 *  seam's, between the two guards. */
const axisRatio = (c: Cell, j: number): number => {
  const at = (i: number) => mosaicSeamShiftMm(LENS[c], optsFor(c, j, i), 65);
  const hi = at(WIDE);
  const lo = at(TINY);
  return (
    Math.log(hi.betweenColumnsMm / lo.betweenColumnsMm) /
    Math.log(hi.betweenRowsMm / lo.betweenRowsMm)
  );
};
/** The same quantity from the closed forms alone, over the cell's OWN guard
 *  interval — the four cells eat different fractions of the tile at one `i`. */
const axisSecant = (c: Cell, j: number): number => {
  const w0 = wOfLive(c, j, TINY);
  const w1 = wOfLive(c, j, WIDE);
  const lnR = (w: number): number => Math.log(w * (2 + 2 * w - w * w));
  const lnC = (w: number): number => Math.log(w * w * Math.hypot(w, 2));
  return (lnC(w1) - lnC(w0)) / (lnR(w1) - lnR(w0));
};
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

describe("§ 6cf.0 — the two seams' guard sensitivities are Lr and Lc", () => {
  it("is § 6ce's own L0 taken apart instead of together", () => {
    // If this failed, the two closed forms below would not be the same object
    // § 6ce validated — they are its numerator and its denominator,
    // differentiated separately rather than after the division.
    for (let w = 0.01; w < 1.69; w += 0.01) {
      expect(Math.abs(Lr(w) - Lc(w) - L0(w))).toBeLessThan(1e-14);
    }
    // The two orders the whole step rests on, at the tile's own zero.
    expect(Lr(0)).toBe(1);
    expect(Lc(0)).toBe(2);
  });

  it("matches the traced seams, one-signed and growing as cx²", () => {
    // The traced corner form carries the map's SECOND coefficient, which the
    // closed forms drop (§ 6ce.2), so the departure is that step's `eps` term:
    // one-signed, and carrying `cx²`. At cx = 1/2 it is 2.2e-5 and at 4 it is
    // 1.5e-3 — 64× of field offset for 67× of departure.
    for (const c of CELLS) {
      for (const w of [0.05, 0.2, 0.34, 0.6848, 0.99]) {
        const lr = L((x) => seamOf(c, CX, x).rows, w);
        const lc = L((x) => seamOf(c, CX, x).cols, w);
        expect(Math.abs(lr / Lr(w) - 1)).toBeLessThan(6e-3);
        expect(Math.abs(lc / Lc(w) - 1)).toBeLessThan(4e-3);
        expect(lr).toBeLessThan(Lr(w));
        expect(lc).toBeLessThan(Lc(w));
      }
    }
    const at = (cx: number): number => {
      const lr = L((x) => seamOf("s10", cx, x).rows, 0.6848);
      const lc = L((x) => seamOf("s10", cx, x).cols, 0.6848);
      return lc / lr / A(0.6848) - 1;
    };
    expect(at(0.5)).toBeCloseTo(2.24e-5, 6);
    expect(at(4)).toBeCloseTo(1.494e-3, 5);
    expect(at(4) / at(0.5)).toBeGreaterThan(60);
  });
});

describe("§ 6cf.1 — so § 6ca's axis constant is their quotient", () => {
  it("holds against the live mosaic at eight anchors and four cells", () => {
    // No lens, no guard, no wavelength, no frame: the whole of § 6ca.2 and
    // § 6ca.3, out of two polynomials. The comparison is against the SECANT
    // because § 6ca reads a finite guard interval, and each cell eats a
    // different fraction of the tile at one `i` — 1/16 of it for the slow 20×,
    // 1/64 for the fast 10×.
    let worst = 0;
    for (const j of [16, 24, 32, 40, 56, 64, 72, 88]) {
      for (const c of CELLS) {
        worst = Math.max(worst, Math.abs(axisRatio(c, j) / axisSecant(c, j) - 1));
      }
    }
    expect(worst).toBeLessThan(1.7e-3);
  });

  it("reproduces § 6ca.2's own published number", () => {
    // § 6ca.2 measured 1.8211 at j = 64 as the mean of four cells and could
    // only say that the cells agree; this says what the number is.
    const live = mean(CELLS.map((c) => axisRatio(c, 64)));
    expect(live).toBeCloseTo(1.8211, 3);
    expect(Math.abs(mean(CELLS.map((c) => axisSecant(c, 64))) / live - 1)).toBeLessThan(3e-4);
    // Read as a derivative instead of a secant it is 0.61% high, and that gap
    // is the guard interval's own curvature, not a departure from the form:
    // the secant above closes it to 3e-4 on the same anchor.
    expect(A(wOfLive("s20", 64, TINY)) / live - 1).toBeCloseTo(0.00608, 5);
  });

  it("and § 6ca.1's four-cell stage slope is the same number, not a second one", () => {
    // § 6ca.1's 2.33 and § 6ca.2's 2.32 were recorded as two findings. They are
    // one: the interact is a signed sum of four cells' log seams, and `Lr` and
    // `Lc` are cell-independent, so whatever each cell's guard-to-`w` factor is,
    // it is common to both axes and cancels out of the quotient. It is the
    // looser reading of the two — a slope per unit SHARE across a wide
    // interval, where the cells' different kept fractions no longer cancel the
    // curvature — so it is pinned at a percent and not at a part in a thousand.
    const j = 64;
    const share = (i: number): number => i / 2 ** 23;
    const interact = (v: readonly number[]): number => v[3]! / v[2]! / (v[1]! / v[0]!);
    const seams = (i: number) => CELLS.map((c) => mosaicSeamShiftMm(LENS[c], optsFor(c, j, i), 65));
    const lo = seams(TINY);
    const hi = seams(WIDE);
    const slope = (pick: (s: (typeof lo)[number]) => number): number =>
      Math.log(interact(hi.map(pick)) / interact(lo.map(pick))) / (share(WIDE) - share(TINY));
    const stageR = slope((s) => s.betweenRowsMm);
    const stageC = slope((s) => s.betweenColumnsMm);
    expect(stageR).toBeCloseTo(0.31069, 4);
    expect(stageC).toBeCloseTo(0.56174, 4);
    expect(Math.abs(stageC / stageR / A(wOfLive("s20", j, TINY)) - 1)).toBeLessThan(1.4e-2);
  });
});

describe("§ 6cf.2 — and at zero tile it is exactly 2, one power of the tile apart", () => {
  it("expands as 2 − 2w + (25/4)w² − (61/4)w³ + (635/16)w⁴", () => {
    // `Lr(0) = 1` and `Lc(0) = 2` because the row seam is first order in the
    // kept tile and the column seam second (§ 6ce). That is the mechanism
    // § 6ca left undecided, and everything else on this curve is shape.
    expect(A(0)).toBe(2);
    const series = (w: number): number =>
      2 - 2 * w + (25 / 4) * w ** 2 - (61 / 4) * w ** 3 + (635 / 16) * w ** 4;
    for (const [w, tol] of [
      [1e-3, 1e-12],
      [1e-2, 1.2e-8],
      [3e-2, 3e-6],
    ] as const) {
      expect(Math.abs(A(w) - series(w))).toBeLessThan(tol);
    }
    // The traced seams carry it too, read at the smallest field offset — where
    // § 6ce's `eps` correction, which goes as `cx²`, is out of the way. `w` is
    // squeezed from both ends here and 0.05 is the middle of it: above it the
    // four-term series runs out (4.5e-4 at w = 0.1), and below it the traced
    // seam does, because `rows` is a difference of order-`cx` quantities
    // producing an order-`a·xi` result and the cancellation costs digits as the
    // tile shrinks (1.4e-4 at w = 0.01). Neither end is the form's.
    const traced = (w: number): number =>
      L((x) => seamOf("s10", 0.5, x).cols, w) / L((x) => seamOf("s10", 0.5, x).rows, w);
    expect(Math.abs(traced(0.05) / series(0.05) - 1)).toBeLessThan(1e-5);
  });
});

describe("§ 6cf.3 — the constant is not monotone: it has a minimum", () => {
  it("locates it at a sextic's one positive root", () => {
    let changes = 0;
    for (let w = 0.001; w < 3; w += 0.001) if (MIN6(w) * MIN6(w + 0.001) < 0) changes++;
    expect(changes).toBe(1);
    expect(WMIN).toBeCloseTo(0.37736072206222404, 15);
    expect(A(WMIN)).toBeCloseTo(1.724214787804253, 12);
    // A minimum, and it is NOT § 6ce's bend at 0.33945: that root is where the
    // DIFFERENCE `Lr − Lc` is stationary and this is where the QUOTIENT is.
    expect(A(WMIN * 0.98)).toBeGreaterThan(A(WMIN));
    expect(A(WMIN * 1.02)).toBeGreaterThan(A(WMIN));
    expect(Math.abs(WMIN / 0.33945277306050325 - 1)).toBeGreaterThan(0.1);
    // Falling below it and rising above it, so § 6ca.5's "it GROWS with the
    // ratio" is the rising side of a curve that starts at 2 and comes down.
    expect(A(0.1)).toBeGreaterThan(A(0.3));
    expect(A(0.5)).toBeGreaterThan(A(WMIN));
  });

  it("and the live constant turns in the same place, in all four cells", () => {
    // § 6ca's two lowest anchors — j = 32 and j = 40, its quoted ratios 0.468
    // and 0.585 — sit either side of this, on a curve that is 2.7% higher at
    // w = 0.2 below and 6.9% higher at w = 0.7 above. That is not the start of
    // a rise; it is a minimum.
    const J = [32, 34, 36, 38, 40];
    const V = CELLS.map((c) => J.map((j) => axisRatio(c, j)));
    for (let k = 0; k < CELLS.length; k++) {
      const v = V[k]!;
      const c = CELLS[k]!;
      expect(v.indexOf(Math.min(...v))).toBe(2);
      expect(wOfLive(c, 34, TINY)).toBeLessThan(WMIN);
      expect(wOfLive(c, 38, TINY)).toBeGreaterThan(WMIN);
      expect(Math.abs(v[0]! / v[4]! - 1)).toBeLessThan(6e-4);
    }
    // And § 6ca published BOTH of these, four paragraphs apart: 1.727 at 0.468
    // in the paragraph that says the constant grows with the ratio, and
    // 1.72618 at 0.585 in § 6ca.3's own two-offset collapse. They go DOWN. The
    // step that recorded the rise had already printed the counter-example.
    const at = (n: number): number => mean(V.map((v) => v[n]!));
    expect(at(0)).toBeCloseTo(1.7267, 4);
    expect(Math.abs(at(4) / 1.72618 - 1)).toBeLessThan(1e-5);
    expect(at(4)).toBeLessThan(at(0));
    expect(A(0.2) / A(WMIN) - 1).toBeCloseTo(0.0265, 4);
    expect(A(0.7) / A(WMIN) - 1).toBeCloseTo(0.0690, 4);
  });
});

describe("§ 6cf.4 — and it returns to exactly 2 at a cubic's root", () => {
  it("factors A − 2 and locates the crossing", () => {
    // `A − 2 = w·(3w³ − 2w² + 18w − 16) / [(w² + 4)(2 + 4w − 3w²)]`, so the
    // curve comes back through its own zero-tile value once, inside the domain.
    for (const w of [0.1, 0.4, 0.8643, 0.99]) {
      const num = w * TWO3(w);
      const den = (w * w + 4) * (2 + 4 * w - 3 * w * w);
      expect(A(w) - 2).toBeCloseTo(num / den, 14);
    }
    let changes = 0;
    for (let w = 0.001; w < 5; w += 0.001) if (TWO3(w) * TWO3(w + 0.001) < 0) changes++;
    expect(changes).toBe(1);
    expect(WTWO).toBeCloseTo(0.8642856628747042, 15);
    expect(A(WTWO)).toBeCloseTo(2, 14);
    expect(WTWO).toBeLessThan(1);
  });

  it("and every cell crosses 2 live, inside the anchors that bracket it", () => {
    // The live reading is a secant over each cell's own guard interval, so a
    // cell that eats more of the tile crosses at a slightly larger anchor than
    // the derivative form does — and the closed-form secant, cell by cell,
    // moves with it. The two are never more than one anchor apart, and the
    // anchors here are 0.6% of `w` each, so "the same place" is what that is.
    for (const c of CELLS) {
      const js = [78, 80, 82, 84, 86];
      const live = js.map((j) => axisRatio(c, j));
      const sec = js.map((j) => axisSecant(c, j));
      const cross = (v: readonly number[]): number => v.findIndex((x) => x > 2);
      expect(cross(live)).toBeGreaterThan(0);
      expect(Math.abs(cross(live) - cross(sec))).toBeLessThanOrEqual(1);
      expect(live[0]!).toBeLessThan(2);
      expect(live[4]!).toBeGreaterThan(2);
      for (let n = 0; n < js.length; n++) {
        expect(Math.abs(live[n]! / sec[n]! - 1)).toBeLessThan(1.5e-3);
      }
    }
    // The algebraic root sits inside that window on the derivative form.
    expect(wOfLive("s10", 78, TINY)).toBeLessThan(WTWO);
    expect(wOfLive("s10", 86, TINY)).toBeGreaterThan(WTWO);
  });
});

describe("§ 6cf.5 — § 6ca's collapse is § 6cd.1's domain edge, not this form's pole", () => {
  it("says what § 6ca's quoted ratio is: the DESIGN-wavelength tile", () => {
    // § 6ca's `ratioOfHalf` reads `objectFieldTile` at 587.5618 nm; the seam
    // lives on the mosaic's ruler tile at 430, and `halfExtentMm` is ∝ λ
    // exactly. So every ratio § 6ca quotes is 1.36642× the `w` this form takes,
    // which is why § 6ca's anchors look further out than they are.
    const halfOver = (j: number, nm: number): number =>
      objectFieldTile(LENS.s20, {
        size: BIG,
        pupilSamples: PS_AT("s20", j),
        wavelengthNm: nm,
        centreMm: { x: CX, y: 0 },
      }).halfExtentMm / CX;
    for (const j of [32, 64, 116]) {
      // "∝ λ exactly", to 8.2e-11 — the traced scale's own last few bits, and
      // the same at all three anchors, which is what says it is a floor and not
      // a wavelength dependence that has been missed.
      expect(Math.abs(halfOver(j, RULER) / halfOver(j, DESIGN) / (RULER / DESIGN) - 1)).toBeLessThan(
        1e-10,
      );
      // And what is left between the ruler tile and `w` is bookkeeping that can
      // be named to the pixel: two cropped pixels to the common ruler, and the
      // 2⁻²⁰-of-a-cell guard `TINY` itself, both out of the 2²⁶ tile.
      expect(wOfLive("s20", j, 0) / halfOver(j, RULER)).toBeCloseTo(1 - 2 / BIG, 15);
      expect(wOfLive("s20", j, TINY) / wOfLive("s20", j, 0)).toBeCloseTo(1 - 64 / BIG, 13);
    }
    expect(DESIGN / RULER).toBeCloseTo(1.36642, 5);
    // The two roots in § 6ca's own units, which is where § 6ca would have had
    // to look for them: its lowest published anchor is 0.468 and the minimum
    // sits at 0.5156, one unlisted anchor away.
    expect(WMIN * (DESIGN / RULER)).toBeCloseTo(0.515634, 5);
    expect(WTWO * (DESIGN / RULER)).toBeCloseTo(1.1809796, 6);
  });

  it("degrades past w = 1 and has already failed before its pole", () => {
    // § 6cd.1: past `w = 1` the live maximum leaves the corner and is strictly
    // larger, so the closed form stops being the seam. It shows.
    const off = (j: number): number => {
      const live = mean(CELLS.map((c) => axisRatio(c, j)));
      return A(wOfLive("s20", j, TINY)) / live - 1;
    };
    expect(off(116)).toBeCloseTo(0.259, 2);
    expect(off(200)).toBeLessThan(-1);
    // The extrapolation's pole is `Lr = 0`, the row seam's own maximum, at an
    // algebraic number — and it is NOT offered as § 6ca's collapse: the form is
    // already a quarter wrong at w = 1.24, well below it, and stays negative
    // past it where the live constant is still positive.
    const POLE = (2 + Math.sqrt(10)) / 3;
    expect(POLE).toBeCloseTo(1.7207592200561266, 15);
    expect(Math.abs(Lr(POLE))).toBeLessThan(1e-15);
    expect(A(wOfLive("s20", 200, TINY))).toBeLessThan(0);
    expect(mean(CELLS.map((c) => axisRatio(c, 200)))).toBeGreaterThan(0);
  });
});
