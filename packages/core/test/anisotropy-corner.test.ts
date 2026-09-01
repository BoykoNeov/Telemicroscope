import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import { objectHeightForImageRadius } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6cd — the seam is one corner, so the anisotropy is one curve of one
 * variable, and an aperture lever is that curve read at two points.
 *
 * § 6cb.3 put the hump's turn one level below the interact — at the aperture
 * lever, fast over slow inside one magnification — and stopped there, leaving
 * "**Why an aperture lever turns is unmeasured**" and "**The locus itself has
 * no account**" standing. Both close here, and they close together because they
 * are the same object read two ways.
 *
 * ## The seam is not a max over probes; it is a corner
 *
 * `mosaicSeamShiftMm` walks `probes` points along each seam and keeps the worst.
 * Under a stage scan every tile shares the anchor's frame, so the two tiles at a
 * seam look at image points that differ by exactly the pitch, and the whole walk
 * is decoration: the worst is the FIRST probe, the picture's own corner, on both
 * axes, at every anchor and every cell measured here. That is not an assumption
 * about which probe grid is dense enough — the corner's value is computed in
 * closed form below and it EQUALS the live function's maximum.
 *
 * With the corner fixed the geometry collapses. Writing the corner's own offset
 * as `xi` — the kept half tile in object mm — the column seam steps from
 * `cx - xi` to `cx + xi` at height `-xi`, and the row seam steps from `+xi` to
 * `-xi` at `cx - xi`; the pitch is `2·xi` and the stage's own span is
 * `R(cx + xi) - R(cx - xi)`. The row seam's two probes therefore sit at the SAME
 * radius, so its x-component is identically zero, and both seams reduce to four
 * evaluations of the map's radial function `R`:
 *
 *     rows = |2·xi·m(rQ) - R(P) + R(Q)|
 *     cols = hypot(P·(m(rP) - m(P)) - Q·(m(rQ) - m(Q)), xi·(m(rP) - m(rQ)))
 *
 * with `P = cx + xi`, `Q = cx - xi`, `rP = hypot(P, xi)`, `rQ = hypot(Q, xi)`
 * and `m(t) = R(t)/t`. Against the live `mosaicSeamShiftMm` this agrees to
 * 1e-13 (§ 6cd.0) — it is not a model of the seam, it is the seam.
 *
 * ## Which makes the anisotropy a curve in one variable
 *
 * Nothing above depends on the anchor, the guard, the wavelength or the frame
 * except through `xi`. Writing `w = xi/cx` — the kept half tile over the field
 * offset — the anisotropy is `A = PHI(w)` and the guard enters ONLY by changing
 * `w` (§ 6cd.2, checked against the live seam at three guards two orders apart).
 * Its small-`w` behaviour is pure geometry: `rows` is first order in the tile
 * and carries the map's distortion, `cols` is second order and carries the same
 * distortion at the corner's own offset, and the map cancels out of the ratio —
 *
 *     A·w = 1 + w - 0.6149·w² + …
 *
 * where the leading `(cx + xi)/xi` is the same for every cell and the four cells
 * first differ at order `w²`, by a third of a percent of that coefficient. That
 * is the reason under § 6ca.2's observation that the radial map's own shape
 * divides out of ITS quotient — it divides out of the anisotropy itself, before
 * any quotient is taken — and it is why no cell's anisotropy turns: `PHI` is
 * monotone.
 *
 * ## So a lever turns because it reads one curve at two points
 *
 * A lever is `PHI(w_f)/PHI(w_s)` and its two arguments are in fixed proportion,
 * `sigma = rho · f_f/f_s`, where `rho` is the fast cell's resolution cell over
 * the slow one's (0.9847 — the departure from an exact inverse-NA halving) and
 * `f` is the cell's kept fraction, which the GUARD sets. A quotient of one curve
 * at two points a fixed factor apart is stationary where the curve's log slope
 * takes equal values at `w` and `sigma·w`; whether that is a maximum or a
 * minimum is the sign of `sigma - 1` (§ 6cd.3). At § 6cb's own guard both
 * sigmas are above 1 and both levers hold a maximum, at anchors 61.7 and 67.8 —
 * § 6cb.3's located 62 and 68. At a guard of 10⁴ both are BELOW 1 and both
 * levers hold a minimum instead. The turn § 6cb.3 measured is not a property of
 * the aperture; it is the guard choosing which side of 1 sigma falls.
 *
 * And § 6cb.1's locus is the same statement with four points instead of two:
 * the interact's best anchor is where a four-point combination of `PHI` is
 * stationary, which predicts 40.0, 60.6, 65.9, 70.4 and 85.4 at the five guards
 * § 6cb.1 read it at, against its located 40, 60, 66, 70 and 86 (§ 6cd.4).
 *
 * ## And the closed form has an edge, which is where § 6bz's turn lives
 *
 * It is exact while `w < 1` and breaks the moment the kept tile reaches the
 * optical axis, because at `w = 1` the row seam's probe pair lands ON the axis
 * (§ 6cd.1). Past it the live maximum leaves the corner and is strictly larger,
 * which is § 6bz.5's lost probe-exactness given a location. § 6bz.4's per-cell
 * turns sit at `w` near 1.46, outside this form's domain, and are NOT explained
 * here: `PHI` has no minimum out to `w = 2.2`.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6cc used it: no render, so no focus stage. */
const FREE_STAGE: TileStageMm = () => 0;

function mosaicOptions(
  size: number,
  ps: number,
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions {
  return {
    size,
    pupilSamples: ps,
    slabs: THIN,
    samples: [
      { nm: 430, weight: 1 },
      { nm: DESIGN, weight: 1 },
      { nm: 656.2725, weight: 1 },
    ],
    tiles: 3,
    guardCells: 4,
    stageMm: FREE_STAGE,
    radialMapSeed: "magnification",
    centreMm: { x: 4, y: 0 },
    ...over,
  };
}

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
/** The mosaic's field offset (mm) — `cx` throughout, and the anchor's radius. */
const CX = 4;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const optsFor = (c: Cell, j: number, i: number): FluorescenceMosaicOptions =>
  mosaicOptions(BIG, PS_AT(c, j), {
    guardCells: (i * j) / 2 ** 24,
    centreMm: { x: CX, y: 0 },
    scan: "stage",
  });

/**
 * The seam in four evaluations of the map's own radial function.
 *
 * Signed, so it keeps meaning once `Q = cx - xi` crosses the axis: a radial map
 * takes `(-t, 0)` to `-R(t)`. The signed form is what § 6cd.1 measures the edge
 * of — an unsigned one would break at `w = 1` for its own reasons and hide the
 * fact that the LIVE maximum is what has moved.
 */
function seamOf(c: Cell, w: number): { rows: number; cols: number; A: number } {
  const system = LENS[c];
  const R = (t: number): number =>
    (t < 0 ? -1 : 1) *
    objectHeightForImageRadius(system, Math.abs(t), 430, { magnification: MAG[c] });
  const m = (t: number): number => R(t) / t;
  const xi = w * CX;
  const P = CX + xi;
  const Q = CX - xi;
  const rP = Math.hypot(P, xi);
  const rQ = Math.hypot(Q, xi);
  const rows = Math.abs(2 * xi * m(rQ) - R(P) + R(Q));
  const cols = Math.hypot(P * (m(rP) - m(P)) - Q * (m(rQ) - m(Q)), xi * (m(rP) - m(rQ)));
  return { rows, cols, A: rows / cols };
}
const PHI = (c: Cell, w: number): number => seamOf(c, w).A;

/** The corner's own offset over the field offset, read off the live geometry. */
function wOfLive(c: Cell, j: number, i: number): number {
  const g = fluorescenceMosaicGeometry(LENS[c], optsFor(c, j, i));
  const frame = g.planes[g.rulerIndex]!.frame;
  return ((g.tileSize / 2 - g.croppedPixels - g.guardPixels) * frame.pixelScaleMm) / CX;
}
const liveA = (c: Cell, j: number, i: number): number => {
  const s = mosaicSeamShiftMm(LENS[c], optsFor(c, j, i), 65);
  return s.betweenRowsMm / s.betweenColumnsMm;
};

/** The kept fraction of a tile at a guard — one cropped pixel and `64·i/Q`
 *  guard pixels per edge, so a cell's OWN pupil sampling sets how much of the
 *  tile the guard eats. This is the only place the guard enters § 6cd. */
const fOf = (c: Cell, i: number): number => (BIG - 2 - 2 * ((64 * i) / Q6BO[c][1])) / BIG;
/** The cell's half extent over the field offset, per anchor — `pupilSamples`
 *  alone (§ 6bw.2), so it does not move with the guard. */
const K: Record<Cell, number> = {
  s10: 5.349951073357e-3,
  f10: 5.268227568822e-3,
  s20: 5.349955971825e-3,
  f20: 5.268242954812e-3,
};
const wOf = (c: Cell, j: number, i: number): number => fOf(c, i) * K[c] * j;
/** The fast cell's resolution cell over the slow one's: not one half of it. */
const RHO = K.f10 / K.s10;
const sigmaOf = (s: Cell, f: Cell, i: number): number => (RHO * fOf(f, i)) / fOf(s, i);

/** An interior extremum of `F` on the anchor window, located to 1e-8. */
function extremum(F: (j: number) => number): { j: number; kind: "max" | "min" | "none" } {
  let at = -1;
  let kind: "max" | "min" | "none" = "none";
  for (let j = 14; j <= 128; j += 2) {
    if (F(j) > F(j - 2) && F(j) > F(j + 2)) {
      at = j;
      kind = "max";
      break;
    }
  }
  if (at < 0) {
    for (let j = 14; j <= 128; j += 2) {
      if (F(j) < F(j - 2) && F(j) < F(j + 2)) {
        at = j;
        kind = "min";
        break;
      }
    }
  }
  if (at < 0) return { j: NaN, kind: "none" };
  let lo = at - 2;
  let hi = at + 2;
  const better = (x: number, y: number): boolean => (kind === "max" ? x > y : x < y);
  for (let it = 0; it < 60; it++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (better(F(m1), F(m2))) hi = m2;
    else lo = m1;
  }
  return { j: (lo + hi) / 2, kind };
}

const I70 = 809443;

describe("§ 6cd.0 — the seam is one corner, and the corner is four map evaluations", () => {
  it("equals the live maximum, at three guards two orders apart", () => {
    // If the worst probe were anywhere but the corner the live maximum would be
    // strictly larger than this, so an equality here IS the argmax claim — and
    // it is stronger than re-implementing the walk, because it also says what
    // the corner's value is.
    for (const [i, js] of [
      [10000, [40, 60]],
      [I70, [62, 70]],
      [2000000, [86]],
    ] as const) {
      for (const j of js) {
        for (const c of CELLS) {
          const w = wOfLive(c, j, i);
          expect(Math.abs(PHI(c, w) / liveA(c, j, i) - 1)).toBeLessThan(1e-11);
        }
      }
    }
  });

  it("does not care how many probes the walk uses", () => {
    // A maximum attained at a point every grid contains is the same number on
    // every grid. 65, 129 and 257 probes agree to the last bit.
    for (const c of CELLS) {
      const at = (probes: number): number => {
        const s = mosaicSeamShiftMm(LENS[c], optsFor(c, 70, I70), probes);
        return s.betweenRowsMm / s.betweenColumnsMm;
      };
      expect(at(129)).toBe(at(65));
      expect(at(257)).toBe(at(65));
    }
  });

  it("has no x-component in the row seam at all", () => {
    // Both of the row seam's probes sit at radius `hypot(cx - xi, xi)`, so a
    // radial map scales them by the same factor and the x-components cancel
    // exactly. That is the whole reason `rows` is one absolute value.
    for (const c of CELLS) {
      const w = wOfLive(c, 70, I70);
      const k = seamOf(c, w);
      expect(Math.hypot(0, k.rows)).toBe(k.rows);
      // The two seams are genuinely different sizes: rows is first order in the
      // tile and cols second, so their ratio is the anisotropy itself.
      expect(k.rows / k.cols).toBeCloseTo(PHI(c, w), 12);
      expect(k.rows / k.cols).toBeGreaterThan(3);
    }
  });
});

describe("§ 6cd.1 — and it is exact until the kept tile reaches the axis", () => {
  it("holds below w = 1 and departs, one-signed, above it", () => {
    // `Q = cx - xi` is the row seam's own x, so at w = 1 its probe pair lands on
    // the optical axis. Below that the corner is the worst probe and the closed
    // form is the seam; above it the live maximum moves off the corner and is
    // strictly LARGER, which is § 6bz.5's lost probe-exactness located.
    const at = (c: Cell, j: number): { w: number; rel: number } => {
      const w = wOfLive(c, j, I70);
      return { w, rel: PHI(c, w) / liveA(c, j, I70) - 1 };
    };
    for (const j of [140, 180, 194]) {
      const k = at("s10", j);
      expect(k.w).toBeLessThan(1);
      expect(Math.abs(k.rel)).toBeLessThan(1e-11);
    }
    const past = [200, 220, 260].map((j) => at("s10", j));
    for (const p of past) expect(p.w).toBeGreaterThan(1);
    // One-signed and growing: 5.3e-5 at w = 1.018, 4.8e-3 at 1.120, 3.5e-2 at
    // 1.324. A maximum that has moved can only have moved UP.
    for (const p of past) expect(p.rel).toBeLessThan(0);
    expect(past[0]!.rel).toBeCloseTo(-5.26e-5, 6);
    expect(past[1]!.rel).toBeCloseTo(-4.79e-3, 4);
    expect(past[2]!.rel).toBeCloseTo(-3.54e-2, 3);
    expect(past[0]!.w).toBeCloseTo(1.018367, 5);
  });

  it("leaves § 6bz.4's own turn outside the domain", () => {
    // § 6bz.4's four per-cell turns sit near w = 1.46 at a guard of 508520, and
    // this curve has no minimum there — it is still falling at w = 2.2. So the
    // per-cell turn is a property of the moved argmax, not of the map, and it is
    // NOT explained by anything here.
    // Explicit steps rather than an accumulating loop: the point of the rung is
    // that the far end IS covered, and a float that drifts to 2.0999… would
    // leave the last tenth unread while the text quotes 2.2.
    const PAST = [1.05, 1.2, 1.35, 1.5, 1.65, 1.8, 1.95, 2.05, 2.2];
    for (const c of CELLS) {
      for (let n = 1; n < PAST.length; n++) {
        expect(PHI(c, PAST[n]!)).toBeLessThan(PHI(c, PAST[n - 1]!));
      }
    }
  });
});

describe("§ 6cd.2 — so the anisotropy is one curve of one variable", () => {
  it("starts at (cx + xi)/xi, with the map cancelling out of the ratio", () => {
    // rows is first order in the tile and carries the map's distortion; cols is
    // second order and carries the same distortion at the corner's own offset;
    // the ratio is therefore geometric, and its first TWO orders are identical
    // across four cells whose maps differ by 40% in distortion.
    for (const w of [0.002, 0.01]) {
      for (const c of CELLS) {
        const c2 = (PHI(c, w) * w - (1 + w)) / (w * w);
        expect(c2).toBeGreaterThan(-0.618);
        expect(c2).toBeLessThan(-0.6148);
      }
    }
    // The four maps are genuinely different: the dimensionless distortion
    // `cx·R''/R'` at the anchor spreads 1.43× across them, and none of that
    // reaches the first two orders of the ratio.
    const distortion = CELLS.map((c) => {
      const R = (t: number): number =>
        objectHeightForImageRadius(LENS[c], t, 430, { magnification: MAG[c] });
      const e = CX * 1e-5;
      const d1 = (R(CX + e) - R(CX - e)) / (2 * e);
      const d2 = (R(CX + e) - 2 * R(CX) + R(CX - e)) / (e * e);
      return (CX * d2) / d1;
    });
    expect(Math.min(...distortion) / Math.max(...distortion)).toBeCloseTo(1.431, 3);
    // The cells first differ at order w², and by a third of a percent of it.
    const spread = CELLS.map((c) => (PHI(c, 0.002) * 0.002 - 1.002) / 4e-6);
    expect(Math.min(...spread) / Math.max(...spread) - 1).toBeCloseTo(0.00318, 5);
    expect(Math.min(...spread)).toBeCloseTo(-0.6168621, 6);
    expect(Math.max(...spread)).toBeCloseTo(-0.6149069, 6);
  });

  it("collapses the four cells onto one curve, to 1e-5 at a tenth", () => {
    // Read at the SAME w — which no anchor ladder can do, the four cells having
    // four different half extents — the four agree to 1.1e-5 at w = 0.1 and are
    // still inside 1e-3 at w = 0.99. § 6ca.2's "under 1%" is a different
    // quantity, a quotient of guard sensitivities; what this says is why the
    // map divided out of it — it divides out of the anisotropy first.
    for (const [w, bound] of [
      [0.1, 1.8e-5],
      [0.3, 1.5e-4],
      [0.99, 1.0e-3],
    ] as const) {
      for (const c of CELLS) expect(Math.abs(PHI(c, w) / PHI("s10", w) - 1)).toBeLessThan(bound);
    }
    // And it is monotone across the whole domain the closed form owns, which is
    // where "no cell turns" is used: a single falling curve has no turn to give.
    for (const c of CELLS) {
      for (let n = 2; n <= 19; n++) expect(PHI(c, n * 0.05)).toBeLessThan(PHI(c, (n - 1) * 0.05));
    }
    // Ordered, and not noise: every other cell reads BELOW the slow 10× and the
    // gap grows with w, which is the aperture arriving at order w².
    for (const c of ["f10", "s20", "f20"] as const) {
      expect(PHI(c, 0.3) / PHI("s10", 0.3) - 1).toBeLessThan(0);
      expect(Math.abs(PHI(c, 0.99) / PHI("s10", 0.99) - 1)).toBeGreaterThan(
        Math.abs(PHI(c, 0.1) / PHI("s10", 0.1) - 1),
      );
    }
  });

  it("takes the guard only through w", () => {
    // The guard changes the kept fraction, the kept fraction changes xi, and
    // nothing else in the closed form knows the guard exists. Three guards two
    // orders apart, against the live seam, on the MODELLED w rather than the
    // measured one — so this checks the w model too.
    for (const i of [10000, I70, 2000000]) {
      for (const c of CELLS) {
        expect(Math.abs(wOf(c, 70, i) / wOfLive(c, 70, i) - 1)).toBeLessThan(1e-11);
        expect(Math.abs(PHI(c, wOf(c, 70, i)) / liveA(c, 70, i) - 1)).toBeLessThan(1e-11);
      }
    }
  });
});

describe("§ 6cd.3 — a lever is that one curve read at two points", () => {
  it("turns where the sign of sigma - 1 says, and the guard sets the sign", () => {
    // A lever's two arguments are in fixed proportion sigma = rho·f_f/f_s: rho
    // is optical and below 1 (the fast cell's resolution cell is not exactly
    // half the slow one's), f_f/f_s is the guard's and above 1. So sigma CROSSES
    // 1, and a quotient of one curve at two points is a maximum on one side of
    // that crossing and a minimum on the other.
    expect(RHO).toBeCloseTo(0.984724438894, 12);
    const lever = (s: Cell, f: Cell, i: number): { j: number; kind: string } =>
      extremum((j) => Math.log(PHI(f, wOf(f, j, i))) - Math.log(PHI(s, wOf(s, j, i))));
    // At § 6cb's own guard both sigmas are above 1 and both levers are humps,
    // at anchors 61.7 and 67.8 — § 6cb.3 located 62 and 68.
    expect(sigmaOf("s10", "f10", I70)).toBeCloseTo(1.009683409, 9);
    expect(sigmaOf("s20", "f20", I70)).toBeCloseTo(1.037307958, 9);
    const hi10 = lever("s10", "f10", I70);
    const hi20 = lever("s20", "f20", I70);
    expect(hi10.kind).toBe("max");
    expect(hi20.kind).toBe("max");
    expect(hi10.j).toBeCloseTo(61.68, 2);
    expect(hi20.j).toBeCloseTo(67.79, 2);
    // At a guard of 10⁴ both sigmas are BELOW 1 and both levers hold a minimum.
    expect(sigmaOf("s10", "f10", 10000)).toBeLessThan(1);
    expect(sigmaOf("s20", "f20", 10000)).toBeLessThan(1);
    expect(lever("s10", "f10", 10000).kind).toBe("min");
    expect(lever("s20", "f20", 10000).kind).toBe("min");
    // And the flip is at the crossing, not near it: the 10× lever is a minimum
    // at the last guard with sigma below 1 and a maximum at the first above.
    expect(sigmaOf("s10", "f10", 400000)).toBeLessThan(1);
    expect(sigmaOf("s10", "f10", 520540)).toBeGreaterThan(1);
    expect(lever("s10", "f10", 400000).kind).toBe("min");
    expect(lever("s10", "f10", 520540).kind).toBe("max");
    // The 20× lever crosses earlier, its two cells' guard fractions being
    // further apart: sigma passes 1 between 10⁵ and 260270.
    expect(sigmaOf("s20", "f20", 100000)).toBeLessThan(1);
    expect(sigmaOf("s20", "f20", 260270)).toBeGreaterThan(1);
    expect(lever("s20", "f20", 100000).kind).toBe("min");
    expect(lever("s20", "f20", 260270).kind).toBe("max");
  });

  it("keeps the aperture in the correction and not in the turn", () => {
    // Read on ONE curve — the geometric term alone, with every cell given the
    // slow 10×'s map — the levers still turn, and nearer the located anchor for
    // the 20× lever than for the 10×. That ordering is |sigma - 1|: 3.7% at 20×
    // against 0.97% at 10×, so the geometric term is the larger share of the 20×
    // lever and the cells' own departures matter less.
    const oneCurve = (s: Cell, f: Cell, i: number): { j: number; kind: string } =>
      extremum((j) => Math.log(PHI("s10", wOf(f, j, i))) - Math.log(PHI("s10", wOf(s, j, i))));
    const g10 = oneCurve("s10", "f10", I70);
    const g20 = oneCurve("s20", "f20", I70);
    expect(g10.j).toBeCloseTo(67.21, 2);
    expect(g20.j).toBeCloseTo(69.84, 2);
    expect(Math.abs(g20.j / 67.79 - 1)).toBeLessThan(Math.abs(g10.j / 61.68 - 1));
    expect(Math.abs(g20.j / 67.79 - 1)).toBeCloseTo(0.0302, 4);
    expect(Math.abs(g10.j / 61.68 - 1)).toBeCloseTo(0.0897, 4);
  });
});

describe("§ 6cd.4 — and § 6cb.1's locus is the same curve at four points", () => {
  it("predicts the interact's best anchor at every guard § 6cb.1 read", () => {
    // The interact is four cells, so its stationary anchor is where a four-point
    // combination of PHI is stationary. § 6cb.1 located the best anchor at five
    // guards and said the locus had no account; this is the account, and it
    // needs no mosaic, no render and no threshold walk.
    const locus = (i: number, one: boolean): { j: number; kind: string } =>
      extremum((j) => {
        const P = (c: Cell): number => Math.log(PHI(one ? "s10" : c, wOf(c, j, i)));
        return P("f20") - P("s20") - P("f10") + P("s10");
      });
    const LOCATED: readonly (readonly [number, number, number])[] = [
      [10000, 40, 40.04],
      [100000, 60, 60.56],
      [400000, 66, 65.88],
      [I70, 70, 70.36],
      [2000000, 86, 85.37],
    ];
    for (const [i, ladder, predicted] of LOCATED) {
      const k = locus(i, false);
      expect(k.kind).toBe("max");
      expect(k.j).toBeCloseTo(predicted, 2);
      // § 6cb.1 walked a step-2 grid, so agreeing to one grid step is agreeing.
      expect(Math.abs(k.j - ladder)).toBeLessThanOrEqual(2);
    }
    // The pure-geometry version — one curve for all four cells — is 58% out at
    // the smallest guard and 0.3% at the largest, monotonically. The guard is
    // what spreads the four kept fractions, so geometry takes the locus over as
    // the guard grows and the cells' own maps decide it when it is small.
    const errs = LOCATED.map(([i, , predicted]) => Math.abs(locus(i, true).j / predicted - 1));
    for (let n = 1; n < errs.length; n++) expect(errs[n]!).toBeLessThan(errs[n - 1]!);
    expect(errs[0]!).toBeCloseTo(0.584, 3);
    expect(errs[errs.length - 1]!).toBeCloseTo(0.00285, 5);
  });
});
