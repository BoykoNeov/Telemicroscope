import { describe, it, expect } from "vitest";
import { objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6ce — the bend is one algebraic number, and the map's next order is one
 * coefficient.
 *
 * § 6cd closed the seam into four evaluations of the map's radial function and
 * left one bullet standing: "**Why `PHI` bends where it does is not derived** —
 * the closed form says what the anisotropy is at any `w` and every turn on this
 * branch follows from it, but the shape of `PHI`'s own log slope, which is what
 * puts the 10× lever at 61.7 rather than at 67, is measured and not solved."
 * This solves it, and the answer is that `PHI` is an ELEMENTARY function.
 *
 * ## The map's leading order cancels, and what is left has no lens in it
 *
 * Write the map as `R(t) = mu·t·(1 + a·t² + b·t⁴ + …)` — a radial map is odd, so
 * that is the general form, and `mu` is the plate scale. § 6cd's four
 * evaluations then expand in the tile. Both seams are IDENTICALLY ZERO at
 * `a = 0`: with `R` a pure scaling the two tiles at a seam are a pitch apart in
 * object space too, and there is nothing to misalign. So both seams are first
 * order in `a`, `mu` divides out of each, and `a` divides out of the RATIO:
 *
 *     rows -> 2·a·mu·xi·(2c² + 2c·xi - xi²)          [c = cx]
 *     cols -> 2·a·mu·xi²·hypot(xi, 2c)
 *
 * which on `w = xi/cx` is, with no lens left anywhere in it,
 *
 *     PHI0(w) = (2 + 2w - w²) / (w·sqrt(w² + 4))
 *
 * That is why § 6cd.2 found four cells collapsing onto one curve, and it says
 * more than the collapse did: the curve is not merely shared, it is a ratio of
 * two polynomials, it needs no ray trace, and it holds at any field offset
 * (§ 6ce.1 — this branch had only ever read `cx = 4`).
 *
 * The numerator and the denominator are the two seams and can be checked apart
 * (§ 6ce.0): the row seam grows like `w·(2 + 2w - w²)` and the column seam like
 * `w²·hypot(w, 2)`, each measured at ONE cell so that cell's own `a` cancels in
 * the comparison. `cols` carrying the extra power of `w` is the whole anisotropy.
 *
 * ## So -0.6149 is -5/8, and the rest is the map's SECOND coefficient
 *
 * `PHI0·w = 1 + w - (5/8)w² + …` exactly. § 6cd.2 measured -0.6149…-0.6169 and
 * could only say the cells "first differ at order w²". They differ by `b`: at
 * first order in `eps = (b/a)·cx²` the whole departure from `PHI0` is
 *
 *     PHI/PHI0 - 1 = eps·[ Br(w)/Nr(w) - D(w)/(w² + 4) ]
 *     Nr = 2 + 2w - w²,  Br = 4 + 4w + 2w² + 8w³ - 3w⁴,  D = 8 + 22w² + 3w⁴
 *
 * whose small-`w` limit is `-3·eps·w²`, so `c2 = -5/8 - 3·eps` (§ 6ce.2). One
 * number per cell, fitted from the MAP and not from the seam, then reproduces
 * the residual across the whole domain and across four field offsets. It also
 * says why the residual grew with the field: `eps` carries `cx²`.
 *
 * ## And the bend is where the log slope turns, which is an algebraic number
 *
 * `L = dln(PHI0)/dln(w)` is elementary too, and it does NOT fall monotonically:
 * it starts at exactly -1 (the `1/w` in `PHI0`), rises, and comes back down
 * through exactly -6/5 at `w = 1`. Its single maximum on the domain is the bend,
 * and differentiating gives a polynomial condition with integer coefficients:
 *
 *     w⁶ + 8w⁵ - 10w⁴ + 32w³ + 32w² + 80w - 32 = 0
 *
 * one positive real root, `w* = 0.33945277306050325` (§ 6ce.3). Nothing about a
 * lens, a guard, a wavelength or a frame enters it.
 *
 * ## Which is why the levers sit where they sit, and why 61.7 is not 67
 *
 * § 6cd.3's lever is stationary where `L` reads equal at `w` and `sigma·w`, so
 * its two reading points STRADDLE `w*` — 0.3378 and 0.3411 for the 10× lever,
 * 0.3332 and 0.3457 for the 20×, around 0.33945. Solving that as a root instead
 * of searching for an extremum returns § 6cd.3's own anchors: 61.68 and 67.79
 * (§ 6ce.4), with no ternary walk.
 *
 * And "61.7 rather than 67" is a small denominator AT the bend. The geometric
 * part of the condition is `L0(sigma·w) - L0(w)`, which vanishes identically at
 * `w*`; so the cells' own departures from `PHI0` — a log-slope gap of 1.7e-4,
 * the `eps` term above — are divided by a quantity that is `(sigma - 1)`-sized
 * and going to zero. The 10× lever has the SMALLER sigma, so it has the smaller
 * denominator and moves the further: -4.66 anchor steps against -1.15 for the
 * 20×, which a one-term linearisation puts at -5.01 and -1.17. The lever with
 * less aperture leverage is the one the maps move most — which is the ordering
 * § 6cd.3's one-curve reading recorded (3.02% out at 20× against 8.97% at 10×)
 * and could not account for.
 */

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

type Cell = "s10" | "f10" | "s20" | "f20";
const LENS: Record<Cell, OpticalSystem> = {
  s10: build(10, 0.1),
  f10: build(10, 0.2),
  s20: build(20, 0.1),
  f20: build(20, 0.2),
};
const MAG: Record<Cell, number> = { s10: 10, f10: 10, s20: 20, f20: 20 };
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

/** § 6cd's own device, with the field offset opened up as a parameter. */
function seamAt(c: Cell, cx: number, w: number): { rows: number; cols: number; A: number } {
  const R = (t: number): number =>
    (t < 0 ? -1 : 1) *
    objectHeightForImageRadius(LENS[c], Math.abs(t), 430, { magnification: MAG[c] });
  const m = (t: number): number => R(t) / t;
  const xi = w * cx;
  const P = cx + xi;
  const Q = cx - xi;
  const rP = Math.hypot(P, xi);
  const rQ = Math.hypot(Q, xi);
  const rows = Math.abs(2 * xi * m(rQ) - R(P) + R(Q));
  const cols = Math.hypot(P * (m(rP) - m(P)) - Q * (m(rQ) - m(Q)), xi * (m(rP) - m(rQ)));
  return { rows, cols, A: rows / cols };
}
/** § 6cd's `PHI`, at that step's own field offset. */
const PHI = (c: Cell, w: number): number => seamAt(c, 4, w).A;

/** The anisotropy with the map's leading order divided out — no lens in it. */
const PHI0 = (w: number): number => (2 + 2 * w - w * w) / (w * Math.hypot(w, 2));
/** dln(PHI0)/dln(w), in closed form. */
const L0 = (w: number): number =>
  (w * (2 - 2 * w)) / (2 + 2 * w - w * w) - 1 - (w * w) / (w * w + 4);
/** dL0/dw, in closed form — the bend's own condition before clearing fractions. */
const dL0 = (w: number): number => {
  const N = 2 + 2 * w - w * w;
  const S = w * w + 4;
  return (4 - 8 * w - 2 * w * w) / (N * N) - (8 * w) / (S * S);
};
/** `dL0 = 0` with the two denominators cleared: integer coefficients throughout. */
const SEXTIC = (w: number): number => (((((w + 8) * w - 10) * w + 32) * w + 32) * w + 80) * w - 32;

/** The shape the map's second coefficient multiplies (first order in `eps`). */
const UNIV = (w: number): number => {
  const Nr = 2 + 2 * w - w * w;
  const Br = 4 + 4 * w + 2 * w * w + 8 * w ** 3 - 3 * w ** 4;
  const D = 8 + 22 * w * w + 3 * w ** 4;
  return Br / Nr - D / (w * w + 4);
};

/**
 * A log slope of a TRACED curve, by central difference at a relative step of
 * 1e-5. The step is not free to choose: the anchor § 6ce.4 solves for drifts by
 * 0.001 between relative steps of 1e-4 and 1e-5 and by 0.13 by 1e-7, where
 * cancellation in the traced map takes over. 1e-5 is inside the flat region.
 */
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
const WSTAR = root(SEXTIC, 0.1, 0.9);

/** The map's own two coefficients, from `m(t)/m(0) - 1 = a·t² + b·t⁴`. The plate
 *  scale has to come out first: `m` is object mm per image mm, so it tends to
 *  1/M and not to 1, and a fit that skips that returns the magnification. */
function mapCoefficients(c: Cell, t1: number, t2: number): { a: number; b: number } {
  const mOf = (t: number): number =>
    objectHeightForImageRadius(LENS[c], t, 430, { magnification: MAG[c] }) / t;
  const mu = mOf(1e-4);
  const y1 = mOf(t1) / mu - 1;
  const y2 = mOf(t2) / mu - 1;
  const det = t1 ** 2 * t2 ** 4 - t2 ** 2 * t1 ** 4;
  return { a: (y1 * t2 ** 4 - y2 * t1 ** 4) / det, b: (t1 ** 2 * y2 - t2 ** 2 * y1) / det };
}
/** `eps = (b/a)·cx²` — the one number per cell and field offset. */
const epsOf = (c: Cell, cx: number): number => {
  const { a, b } = mapCoefficients(c, 2, 4);
  return (b / a) * cx * cx;
};

const BIG = 2 ** 26;
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};
const K: Record<Cell, number> = {
  s10: 5.349951073357e-3,
  f10: 5.268227568822e-3,
  s20: 5.349955971825e-3,
  f20: 5.268242954812e-3,
};
const fOf = (c: Cell, i: number): number => (BIG - 2 - 2 * ((64 * i) / Q6BO[c][1])) / BIG;
const wOf = (c: Cell, j: number, i: number): number => fOf(c, i) * K[c] * j;
const I70 = 809443;

describe("§ 6ce.0 — the anisotropy is elementary, and the map cancels because both seams are first order in it", () => {
  it("equals a ratio of polynomials, with no ray trace in it", () => {
    // The claim is not that PHI0 approximates the seam — it is that the seam's
    // leading term IS PHI0, so the departure has to fall away like the map's
    // next order and not settle at some fitted floor. It falls by four decades
    // between w = 0.002 and w = 0.99.
    const BOUNDS: readonly (readonly [number, number])[] = [
      [0.002, 5e-8],
      [0.01, 1.1e-6],
      [0.1, 1.0e-4],
      [0.3, 8.0e-4],
      [0.99, 5.5e-3],
    ];
    for (const [w, bound] of BOUNDS) {
      for (const c of CELLS) {
        const rel = PHI(c, w) / PHI0(w) - 1;
        expect(Math.abs(rel)).toBeLessThan(bound);
        // One-signed: the traced seam reads ABOVE the pure-geometry curve at
        // every w and every cell, which is what makes it one coefficient's
        // worth of correction rather than noise.
        expect(rel).toBeGreaterThan(0);
      }
    }
    // And it is genuinely a formula: no lens is consulted anywhere in PHI0.
    expect(PHI0(1)).toBeCloseTo(3 / Math.sqrt(5), 15);
    expect(PHI0(WSTAR)).toBeCloseTo(3.722948655259, 11);
  });

  it("splits into the two seams' own shapes", () => {
    // rows ~ w(2 + 2w - w²) and cols ~ w²·hypot(w, 2), each read against the
    // SAME cell at w = 0.02 so that cell's own `a` and plate scale cancel. The
    // extra power of w in cols is the anisotropy itself; everything else in the
    // ratio is the two polynomials.
    const W0 = 0.02;
    const rowShape = (w: number): number => w * (2 + 2 * w - w * w);
    const colShape = (w: number): number => w * w * Math.hypot(w, 2);
    for (const c of CELLS) {
      const base = seamAt(c, 4, W0);
      for (const [w, bound] of [
        [0.1, 2.0e-4],
        [0.3, 1.6e-3],
        [0.6, 6.0e-3],
        [0.9, 1.3e-2],
      ] as const) {
        const k = seamAt(c, 4, w);
        expect(Math.abs(k.rows / base.rows / (rowShape(w) / rowShape(W0)) - 1)).toBeLessThan(bound);
        expect(Math.abs(k.cols / base.cols / (colShape(w) / colShape(W0)) - 1)).toBeLessThan(bound);
      }
    }
  });
});

describe("§ 6ce.1 — so it is the same curve at every field offset", () => {
  it("holds at cx = 0.5, 1, 2 and 4, the departure scaling as cx²", () => {
    // Everything on this branch from § 6bn to § 6cd sat at cx = 4 mm, and
    // nothing said whether the curve was the field offset's or the tile's.
    // PHI0 has no cx in it at all, so the answer is that a field offset only
    // rescales w — and the leftover, being `eps`, carries exactly cx².
    for (const w of [0.1, 0.5, 0.9]) {
      for (const c of CELLS) {
        const scaled = [0.5, 1, 2, 4].map((cx) => (seamAt(c, cx, w).A / PHI0(w) - 1) / (cx * cx));
        // A 64× span in cx² holds the quotient to under 3%.
        expect(Math.min(...scaled) / Math.max(...scaled)).toBeGreaterThan(0.97);
      }
    }
    // At the small end the closed form is essentially exact: a millimetre of
    // field offset puts the whole domain inside 6e-5.
    for (const c of CELLS) {
      expect(Math.abs(seamAt(c, 1, 0.3).A / PHI0(0.3) - 1)).toBeLessThan(6e-5);
    }
  });
});

describe("§ 6ce.2 — and -0.6149 is -5/8 plus the map's second coefficient", () => {
  it("has -5/8 exactly as its geometric part", () => {
    // PHI0·w = (2 + 2w - w²)/sqrt(w² + 4) = 1 + w - (5/8)w² - (1/8)w³ + …, so the
    // whole of § 6cd.2's measured spread lives in the correction and not in the
    // geometry. Pinned as a series and not at one point: the coefficient a
    // finite w reads is -5/8 - w/8, and reading -0.625 off w = 1e-4 would be
    // reading the truncation rather than the number.
    // Not read at a smaller w to get a tighter number: below w ~ 1e-3 the
    // subtraction of two order-1 doubles is what limits it, not the series, and
    // at w = 1e-4 that floor is already 1.4e-8 — a tolerance bought there would
    // be pinning cancellation.
    for (const w of [1e-2, 3e-2]) {
      expect((PHI0(w) * w - (1 + w)) / (w * w) + w / 8).toBeCloseTo(-0.625, 3);
    }
    // The exact pin is what is LEFT after both terms are named: 11/128·w⁴.
    for (const w of [1e-2, 3e-2, 1e-1]) {
      const rest = PHI0(w) * w - (1 + w - 0.625 * w * w - 0.125 * w ** 3);
      expect(rest / w ** 4).toBeGreaterThan(0.08);
      expect(rest / w ** 4).toBeLessThan(0.09);
    }
  });

  it("predicts each cell's w² coefficient from the map alone", () => {
    // `a` and `b` are read off the radial function itself — no seam, no mosaic —
    // and c2 = -5/8 - 3·eps then lands on § 6cd.2's four measured coefficients
    // to 4e-4 absolute, the leftover being the map's own sixth order.
    const MEASURED: Record<Cell, number> = {
      s10: -0.61490693,
      f10: -0.61611925,
      s20: -0.61538359,
      f20: -0.61686210,
    };
    for (const c of CELLS) {
      const w = 0.002;
      const c2 = (PHI(c, w) * w - (1 + w)) / (w * w);
      expect(c2).toBeCloseTo(MEASURED[c], 7);
      expect(-0.625 - 3 * epsOf(c, 4)).toBeCloseTo(MEASURED[c], 3);
      // The correction is small and negative, and it is what orders the cells:
      // more distortion curvature reads a less negative c2.
      expect(epsOf(c, 4)).toBeLessThan(0);
      expect(epsOf(c, 4)).toBeGreaterThan(-4e-3);
    }
    // The two apertures differ in `b/a` by 14% at 10×, which is the whole of the
    // 0.32% spread § 6cd.2 saw at order w².
    expect(epsOf("s10", 4) / epsOf("f10", 4)).toBeCloseTo(1.13, 2);
  });

  it("reproduces the whole residual curve as one number times one shape", () => {
    // The strong form: divide the measured departure by UNIV(w) and what is left
    // must not depend on w. Across a 20× span in w and a 64× span in cx² the
    // quotient holds to 1.5%, so the correction really is first order in a
    // single coefficient rather than a curve that happens to fit.
    for (const c of CELLS) {
      for (const cx of [0.5, 1, 2, 4]) {
        const q = [0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99].map(
          (w) => (seamAt(c, cx, w).A / PHI0(w) - 1) / (epsOf(c, cx) * UNIV(w)),
        );
        expect(Math.min(...q) / Math.max(...q)).toBeGreaterThan(0.985);
        // And the scale is right, not just the shape.
        for (const v of q) expect(Math.abs(v - 1)).toBeLessThan(0.012);
      }
    }
  });
});

describe("§ 6ce.3 — the bend is one algebraic number", () => {
  it("turns at the sextic's only positive root", () => {
    // The two ends are exact: PHI0 goes as 1/w at the origin and the slope is
    // -1 there, and at w = 1 it is -6/5. In between it does NOT interpolate —
    // it rises to -0.8531 and comes back, and that rise is the bend.
    expect(L0(1e-12)).toBeCloseTo(-1, 11);
    expect(L0(1)).toBe(-1.2);
    expect(L0(WSTAR)).toBeGreaterThan(L0(1e-12));
    expect(L0(WSTAR)).toBeGreaterThan(L0(1));

    // Clearing the two denominators out of dL0 leaves integer coefficients, and
    // the root of the polynomial is the root of the derivative to the last bit.
    expect(WSTAR).toBeCloseTo(0.33945277306050325, 15);
    expect(root(dL0, 0.1, 0.9)).toBe(WSTAR);
    expect(Math.abs(dL0(WSTAR))).toBeLessThan(1e-16);
    expect(L0(WSTAR)).toBeCloseTo(-0.853076250296794, 14);

    // One positive real root, so the bend is a single isolated point rather than
    // the near end of a flat region: the sextic changes sign once on (0, 20).
    let crossings = 0;
    let prev = SEXTIC(1e-9);
    for (let w = 0.005; w <= 20; w += 0.005) {
      const v = SEXTIC(w);
      if (v * prev < 0) crossings++;
      prev = v;
    }
    expect(crossings).toBe(1);

    // And L0 turns once and only once across the domain § 6cd.1 measured out to.
    let turns = 0;
    let p = dL0(0.01);
    for (let w = 0.02; w <= 2.2; w += 0.01) {
      const v = dL0(w);
      if (v * p < 0) turns++;
      p = v;
    }
    expect(turns).toBe(1);
  });

  it("is where each cell's own traced slope turns too", () => {
    // The cells carry the `eps` correction, so their slopes are not L0 — they
    // sit 1.4e-3 to 1.8e-3 above it at the bend. That is far too small to move
    // the turn out of a window of ±0.08, which is what makes w* the right thing
    // to call the bend for the traced seams and not only for the polynomial.
    for (const c of CELLS) {
      const Lc = (w: number): number => L((x) => PHI(c, x), w);
      const here = Lc(WSTAR);
      expect(here).toBeGreaterThan(Lc(WSTAR - 0.08));
      expect(here).toBeGreaterThan(Lc(WSTAR + 0.08));
      expect(here - L0(WSTAR)).toBeGreaterThan(1.4e-3);
      expect(here - L0(WSTAR)).toBeLessThan(1.8e-3);
    }
  });
});

describe("§ 6ce.4 — so every anchor on this branch is a root of that slope", () => {
  it("returns § 6cd.3's anchors without searching for an extremum", () => {
    // § 6cd.3 found its anchors by a ternary search on the lever itself. The
    // same numbers come out of a ROOT of `L_f(sigma·w) = L_s(w)` — one
    // bisection, no walk — which is the statement that a lever is stationary
    // where the log slope reads equal at its two points.
    const jTrue = (s: Cell, f: Cell): number =>
      root((j) => L((x) => PHI(f, x), wOf(f, j, I70)) - L((x) => PHI(s, x), wOf(s, j, I70)), 20, 160);
    expect(jTrue("s10", "f10")).toBeCloseTo(61.683, 2);
    expect(jTrue("s20", "f20")).toBeCloseTo(67.792, 2);

    // § 6cd.3's one-curve reading — every cell given the slow 10×'s map — comes
    // back the same way, at its own 67.21 and 69.84.
    const jOne = (s: Cell, f: Cell): number =>
      root(
        (j) => L((x) => PHI("s10", x), wOf(f, j, I70)) - L((x) => PHI("s10", x), wOf(s, j, I70)),
        20,
        160,
      );
    expect(jOne("s10", "f10")).toBeCloseTo(67.21, 1);
    expect(jOne("s20", "f20")).toBeCloseTo(69.84, 1);
  });

  it("straddles the bend with the lever's two reading points", () => {
    // This is the mechanism in one line. On the pure-geometry curve the lever is
    // stationary where L0 reads equal at w and sigma·w, and a function that
    // takes one value twice has turned in between: both levers' pairs bracket
    // w* = 0.33945, the wider sigma bracketing it wider.
    const jGeom = (s: Cell, f: Cell): number =>
      root((j) => L0(wOf(f, j, I70)) - L0(wOf(s, j, I70)), 20, 160);
    for (const [s, f, lo, hi] of [
      ["s10", "f10", 0.3378, 0.3411],
      ["s20", "f20", 0.3332, 0.3457],
    ] as const) {
      const j = jGeom(s, f);
      const wS = wOf(s, j, I70);
      const wF = wOf(f, j, I70);
      expect(wS).toBeLessThan(WSTAR);
      expect(wF).toBeGreaterThan(WSTAR);
      expect(wS).toBeCloseTo(lo, 4);
      expect(wF).toBeCloseTo(hi, 4);
      // Equal readings, which is what "stationary" meant.
      expect(L0(wF)).toBeCloseTo(L0(wS), 12);
    }
    expect(jGeom("s10", "f10")).toBeCloseTo(66.345, 2);
    expect(jGeom("s20", "f20")).toBeCloseTo(68.942, 2);
  });

  it("moves 61.7 off 66.3 by dividing a small gap by a smaller one", () => {
    // The geometric part of the stationarity condition vanishes AT the bend, so
    // near it the condition is (cells' own log-slope gap) over something of
    // order (sigma - 1). The gaps are nearly equal between the two levers —
    // 1.7e-4 and 1.4e-4 — and the denominators are not: 3.4e-5 against 1.2e-4,
    // a factor 3.7, which is the factor between the two sigmas. So the lever
    // with LESS aperture leverage is the one the cells' maps move furthest.
    const shift = (s: Cell, f: Cell): { gap: number; slope: number; pred: number; act: number } => {
      const jG = root((j) => L0(wOf(f, j, I70)) - L0(wOf(s, j, I70)), 20, 160);
      const jT = root(
        (j) => L((x) => PHI(f, x), wOf(f, j, I70)) - L((x) => PHI(s, x), wOf(s, j, I70)),
        20,
        160,
      );
      const wS = wOf(s, jG, I70);
      const wF = wOf(f, jG, I70);
      const gap = L((x) => PHI(f, x), wF) - L0(wF) - (L((x) => PHI(s, x), wS) - L0(wS));
      const h = 1e-3;
      const at = (j: number): number => L0(wOf(f, j, I70)) - L0(wOf(s, j, I70));
      const slope = (at(jG + h) - at(jG - h)) / (2 * h);
      return { gap, slope, pred: -gap / slope, act: jT - jG };
    };
    const ten = shift("s10", "f10");
    const twenty = shift("s20", "f20");

    expect(ten.gap).toBeCloseTo(-1.684e-4, 6);
    expect(twenty.gap).toBeCloseTo(-1.440e-4, 6);
    expect(ten.slope).toBeCloseTo(-3.362e-5, 7);
    expect(twenty.slope).toBeCloseTo(-1.2296e-4, 7);
    // The denominators stand in the ratio of the two levers' (sigma - 1).
    const RHO = K.f10 / K.s10;
    const sigma = (s: Cell, f: Cell): number => (RHO * fOf(f, I70)) / fOf(s, I70);
    expect(twenty.slope / ten.slope).toBeCloseTo(3.66, 2);
    expect((sigma("s20", "f20") - 1) / (sigma("s10", "f10") - 1)).toBeCloseTo(3.85, 2);

    // A single linear term already carries the move, and it is a large move:
    // -4.66 anchor steps at 10× against -1.15 at 20×.
    expect(ten.act).toBeCloseTo(-4.662, 2);
    expect(twenty.act).toBeCloseTo(-1.150, 2);
    expect(ten.pred).toBeCloseTo(-5.008, 2);
    expect(twenty.pred).toBeCloseTo(-1.171, 2);
    expect(Math.abs(ten.pred / ten.act - 1)).toBeLessThan(0.08);
    expect(Math.abs(twenty.pred / twenty.act - 1)).toBeLessThan(0.02);
    // Which is the ordering the bullet asked about: the 10× lever's 61.7 is
    // 66.3 moved by 4.7, and the 20×'s 67.8 is 68.9 moved by 1.2.
    expect(Math.abs(ten.act)).toBeGreaterThan(3 * Math.abs(twenty.act));
  });
});
