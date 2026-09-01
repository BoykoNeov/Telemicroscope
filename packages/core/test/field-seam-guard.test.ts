import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6cl — why the guard's two ends are not one tile.
 *
 * § 6ci.5 measured the FIELD interact's guard sensitivity — § 6ca.1's own
 * 0.7145 and 0.7332 — and noticed in passing that the `w²` in front of each
 * seam does not cancel out of a four-cell contrast, "because each cell's guard
 * share is `2·guardCells/pupilSamples`". It left the reason as § 6bo's shape
 * choice reaching into a quantity nothing designed it for, and it left the one
 * number it quoted for the remainder — "shapes alone give 0.18" — unpinned.
 *
 * Both halves of that are corrected here.
 *
 * ## The share is not a choice: a matched field forces it
 *
 * § 6bo.1's frame has object half-extent `pupilSamples·λ/(4·NA/M)`, so holding
 * the field across a 2×2 of magnification and aperture forces
 * `pupilSamples ∝ NA/M` — that is what a matched field IS. The guard is a count
 * of resolution CELLS, because the wrap it exists to contain is (§ 6bh.4), so
 * the fraction of a tile it eats is
 *
 *     2·guardCells/pupilSamples  =  guardCells · (M/NA) / K
 *
 * with `K` the matched field's own constant. On § 6bo's four shapes that is
 * exact and bitwise: `16/ps0` IS `(M/NA)/200`, in every cell. **The confound
 * § 6bo removed from the field re-enters through the guard**, and it does so
 * whatever cell set is used, because the matched field is what puts it there.
 *
 * ## And a subtraction is what makes it survive the contrast
 *
 * A four-cell log-contrast annihilates anything additive in `ln M` and `ln NA`.
 * `ln(share)` is additive in them — `Σσ ln a = 0` to the last bit — so a seam
 * that depended on the guard as a POWER of the share would cancel exactly. It
 * does not depend on it that way: the guard is SUBTRACTED from the tile,
 * `U = size/2 − cropped − guard`, so `ln(seam)` responds linearly in the share,
 * and a linear contrast of a product returns `(ΔM)·Δ(1/NA)/K` rather than zero.
 * That is the whole mechanism, and it makes the prefactor's contribution four
 * integers and a crop — no lens, no anchor, no sampling rung:
 *
 *     P = 2·Σσ ln( (1 − ε − a_c·x_hi) / (1 − ε − a_c·x_lo) ) / (x_hi − x_lo)
 *
 * = 0.5372639930331878 at § 6ca's own two guard ends, reproduced from the
 * traced `w` at nine (rung, anchor) pairs to 1e-13 (§ 6cl.1). Per unit of the
 * reference cell's own share it has the closed floor `2(m−1)(n−1)/n` in the two
 * levers' ratios — exactly 1 for a double-and-double 2×2, 1.5 for § 6bo's
 * 4×→10× step — and it is zero only if one lever does not move at all.
 *
 * ## So the number was never an optical interaction
 *
 * The remainder is the same imbalance seen through the seam's own shape rather
 * than a second mechanism: at a vanishing guard the four tiles pair up by
 * aperture and the shape contrast is 5e-7 (§ 6cl.2). Balance the share — hold
 * the guard in PIXELS, keep the matched field — and the whole thing goes: the
 * live interact's guard sensitivity falls from 0.714483/0.733180 to
 * 3.28e-4/3.77e-4, a factor of 2180, with the prefactor exactly zero and the
 * shapes at 6e-8 (§ 6cl.3). What is left grows with the anchor, which is the
 * map's signature and not the guard's.
 *
 * But the share cannot be balanced. Equal pixels is a different physical guard
 * in every cell — a factor of four across these four — and the guard is a count
 * of cells precisely because that is the unit its job is measured in. So this
 * is not a flaw in § 6bo's shapes. It is what a matched field costs, and it is
 * paid by every field interact this branch has read (§ 6cl.4).
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };
const FREE_STAGE: TileStageMm = () => 0;
const BIG = 2 ** 26;

/** § 6ca's own guard secant, and the parameter it is taken in. */
const TINY = 8;
const WIDE = 524288;
const shareOfI = (i: number): number => i / 2 ** 23;

/** § 6ci's own harness, carried rather than shared — a later step must not be
 *  able to move an earlier step's pin by editing one file. */
function mosaicOptions(ps: number, over: Partial<FluorescenceMosaicOptions>) {
  return {
    size: BIG,
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
    radialMapSeed: "magnification" as const,
    centreMm: { x: 4, y: 0 },
    ...over,
  } as FluorescenceMosaicOptions;
}

const SYSTEMS = new Map<string, OpticalSystem>();
const sysOf = (M: number, NA: number): OpticalSystem => {
  const key = `${M}:${NA}`;
  let s = SYSTEMS.get(key);
  if (!s) {
    s = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
    }).system;
    SYSTEMS.set(key, s);
  }
  return s;
};

interface Seam {
  readonly rows: number;
  readonly cols: number;
  /** The kept half tile over the field offset, on the 430 nm ruler frame. */
  readonly w: number;
  /** That half tile as a fraction of the un-guarded one — `U / (size/2)`. */
  readonly kappa: number;
  readonly guardPixels: number;
  readonly guardCells: number;
}

const live = (M: number, NA: number, ps: number, guardCells: number, cx: number): Seam => {
  const options = mosaicOptions(ps, { guardCells, centreMm: { x: cx, y: 0 } });
  const system = sysOf(M, NA);
  const g = fluorescenceMosaicGeometry(system, options);
  const s = mosaicSeamShiftMm(system, options, 65);
  const U = g.tileSize / 2 - g.croppedPixels - g.guardPixels;
  return {
    rows: s.betweenRowsMm,
    cols: s.betweenColumnsMm,
    w: (U * g.pixelScaleMm) / cx,
    kappa: U / (g.tileSize / 2),
    guardPixels: g.guardPixels,
    guardCells: g.guardCells,
  };
};

/** § 6ci.2's two shapes at three tiles, and their log slopes' shape halves. */
const shapeRows = (w: number): number => Math.hypot(2 + 3 * w, w);
const shapeCols = (w: number): number => Math.hypot(1 + 3 * w, 1 + w);
const LR = (w: number): number => (15 * w * w + 15 * w + 4) / (5 * w * w + 6 * w + 2);
const LC = (w: number): number => (15 * w * w + 10 * w + 2) / (5 * w * w + 4 * w + 1);

/** § 6ca's four-cell contrast, in logs: `ln(fh/sh) − ln(fl/sl)`. */
const SIGN = [1, -1, -1, 1] as const;
const contrast = (v: readonly number[]): number => v.reduce((a, x, k) => a + SIGN[k]! * x, 0);

/**
 * A matched-field 2×2, in § 6ca's own cell order — slow/lo, fast/lo, slow/hi,
 * fast/hi. `ps0` is the sampling at rung `j = 16`, and it is `NA/M` times the
 * matched field's constant rather than a free choice.
 */
interface Factorial {
  readonly name: string;
  /** `[magnification, numericalAperture, pupilSamples at j = 16]`. */
  readonly cells: readonly (readonly [number, number, number])[];
  /** Guard ends, chosen so every cell's guard is a whole number of pixels. */
  readonly ends: readonly [number, number];
}

/** § 6bo's own four shapes — the set every field interact on this branch uses. */
const Q6BO: Factorial = {
  name: "10/20 x 0.10/0.20",
  cells: [
    [10, 0.1, 32],
    [10, 0.2, 64],
    [20, 0.1, 16],
    [20, 0.2, 32],
  ],
  ends: [TINY, WIDE],
};

/** § 6bo's other magnification step, matched to the same field. */
const STEP_4_10: Factorial = {
  name: "4/10 x 0.10/0.20",
  cells: [
    [4, 0.1, 80],
    [4, 0.2, 160],
    [10, 0.1, 32],
    [10, 0.2, 64],
  ],
  // 4x/0.20 samples the pupil 1280 ways at j = 128, so its guard lands on a
  // whole pixel only at multiples of five.
  ends: [10, 524290],
};

/** Each cell's guard share per unit of the common guard parameter. */
const shares = (f: Factorial): number[] => f.cells.map(([, , ps0]) => 16 / ps0);
/** The two levers' ratios. */
const levers = (f: Factorial): [number, number] => [
  f.cells[2]![0] / f.cells[0]![0],
  f.cells[1]![1] / f.cells[0]![1],
];

/** The prefactor's own arithmetic — four shares, two ends, one crop. */
const prefactorArithmetic = (f: Factorial, eps: number): number => {
  const [lo, hi] = f.ends;
  return (
    (2 *
      contrast(
        shares(f).map((a) =>
          Math.log((1 - eps - a * shareOfI(hi)) / (1 - eps - a * shareOfI(lo))),
        ),
      )) /
    (shareOfI(hi) - shareOfI(lo))
  );
};

interface Split {
  /** The live interact's guard secant on each branch. */
  readonly liveRows: number;
  readonly liveCols: number;
  /** `2·Δ⟨ln w⟩ / Δshare` — the `w²` prefactor's whole contribution. */
  readonly P: number;
  readonly Srows: number;
  readonly Scols: number;
  readonly ends: readonly (readonly Seam[])[];
}

/**
 * The interact's guard secant, split into the prefactor's part and the shape's.
 *
 * `balanced` swaps the guard from a count of resolution CELLS to a count of
 * PIXELS — every cell then loses the same fraction of its tile, which is the
 * counterfactual § 6ci's sentence describes and which no real mosaic can be.
 */
function split(f: Factorial, j: number, cx: number, balanced = false): Split {
  const a = shares(f);
  const ends = f.cells.map(([M, NA, ps0], k) => {
    const ps = (ps0 * j) / 16;
    return f.ends.map((i) => {
      const guard = balanced
        ? (a[0]! * shareOfI(i) * ps) / 2
        : (a[k]! * shareOfI(i) * ps) / 2;
      return live(M, NA, ps, guard, cx);
    });
  });
  const d = (g: (s: Seam) => number): number =>
    (contrast(ends.map((p) => g(p[1]!))) - contrast(ends.map((p) => g(p[0]!)))) /
    (shareOfI(f.ends[1]) - shareOfI(f.ends[0]));
  return {
    liveRows: d((s) => Math.log(s.rows)),
    liveCols: d((s) => Math.log(s.cols)),
    P: d((s) => 2 * Math.log(s.w)),
    Srows: d((s) => Math.log(shapeRows(s.w))),
    Scols: d((s) => Math.log(shapeCols(s.w))),
    ends,
  };
}

const memo = new Map<string, Split>();
const at = (f: Factorial, j: number, cx: number, balanced = false): Split => {
  const key = `${f.name}|${j}|${cx}|${balanced}`;
  let s = memo.get(key);
  if (!s) {
    s = split(f, j, cx, balanced);
    memo.set(key, s);
  }
  return s;
};

describe("§ 6cl.0 — the guard's share of a tile is the tile's own field of view", () => {
  it("is (M/NA) over the matched field's constant, bitwise, in every cell", () => {
    // A matched field is pupilSamples proportional to NA/M (§ 6bo.1), and a
    // guard is a count of resolution cells (§ 6bh.4). Those two together fix
    // the share; nothing chose it.
    for (const f of [Q6BO, STEP_4_10]) {
      const K = (f.cells[0]![0] / f.cells[0]![1]) * (f.cells[0]![2] / 16);
      expect(K).toBe(200);
      for (const [M, NA, ps0] of f.cells) expect(16 / ps0).toBe(M / NA / K);
    }
  });

  it("so the four-cell contrast of the share survives and of its log does not", () => {
    // The contrast kills anything additive in ln M and ln NA. ln(share) is
    // additive in them; the share itself is their PRODUCT, and a linear
    // contrast of a product is (ΔM)·Δ(1/NA)/K, which vanishes only if a lever
    // does not move.
    expect(contrast(shares(Q6BO))).toBe(-0.25);
    expect(contrast(shares(Q6BO).map(Math.log))).toBe(0);
    expect(contrast(shares(STEP_4_10))).toBeCloseTo(-0.15, 15);
    expect(Math.abs(contrast(shares(STEP_4_10).map(Math.log)))).toBeLessThan(1e-15);
    for (const f of [Q6BO, STEP_4_10]) {
      const [Mlo, NAlo] = [f.cells[0]![0], f.cells[0]![1]];
      const [Mhi, NAhi] = [f.cells[3]![0], f.cells[3]![1]];
      expect(contrast(shares(f))).toBeCloseTo(((Mhi - Mlo) * (1 / NAhi - 1 / NAlo)) / 200, 15);
    }
  });

  it("and the guard in pixels does not depend on the sampling rung at all", () => {
    // guardPixels = guardCells·size/pupilSamples with both proportional to the
    // rung, so the whole j ladder is one guard measured in pixels and four
    // different fractions of a tile.
    for (const j of [64, 128, 200] as const) {
      const s = at(Q6BO, j, 2);
      expect(s.ends.map((p) => p[1]!.guardPixels)).toEqual([1048576, 524288, 2097152, 1048576]);
    }
  }, 600000);
});

describe("§ 6cl.1 — so the interact's guard slope has a floor that is four integers", () => {
  it("reproduces the traced prefactor from arithmetic alone, at nine anchors", () => {
    // No lens, no anchor, no rung: the prefactor is the four shares, the two
    // guard ends and the crop the ruler plane takes.
    const arith = prefactorArithmetic(Q6BO, 2 / BIG);
    expect(arith).toBeCloseTo(0.5372639930331878, 13);
    for (const j of [64, 128, 200] as const)
      for (const cx of [1, 2, 4] as const) {
        if (j === 200 && cx === 4) continue; // the corner leaves the field
        expect(at(Q6BO, j, cx).P).toBeCloseTo(arith, 13);
      }
    // Dropping the crop moves it in the eighth digit — it is 1 pixel in 2^25.
    expect(prefactorArithmetic(Q6BO, 0)).toBeCloseTo(0.5372639758445537, 13);
  }, 900000);

  it("has the closed floor 2(m-1)(n-1)/n in the two levers' ratios", () => {
    // Per unit of the reference cell's OWN share, and in the limit of a guard
    // that eats nothing. The finite guard sits above it, by 7.5% at § 6ca's
    // ends and 3.4% at the 4x/10x step's.
    for (const f of [Q6BO, STEP_4_10]) {
      const [m, n] = levers(f);
      const floor = (2 * (m - 1) * (n - 1)) / n;
      expect(floor).toBeCloseTo(-2 * contrast(shares(f)) / shares(f)[0]!, 13);
      const P = at(f, 128, 2).P / shares(f)[0]!;
      expect(P).toBeGreaterThan(floor);
      expect(P / floor - 1).toBeLessThan(0.08);
    }
    expect(levers(Q6BO)).toEqual([2, 2]);
    expect(at(Q6BO, 128, 2).P / shares(Q6BO)[0]!).toBeCloseTo(1.074527986, 8);
    expect(levers(STEP_4_10)).toEqual([2.5, 2]);
    expect(at(STEP_4_10, 128, 2).P / shares(STEP_4_10)[0]!).toBeCloseTo(1.550588755, 8);
  }, 900000);

  it("is between two thirds and six sevenths of what § 6ca.1 published", () => {
    const s = at(Q6BO, 128, 2);
    // § 6ci.5's own two live numbers, reproduced by this file's harness.
    expect(s.liveRows).toBeCloseTo(0.714483, 5);
    expect(s.liveCols).toBeCloseTo(0.733180, 5);
    expect(s.P / (s.P + s.Srows)).toBeCloseTo(0.7474887, 6);
    expect(s.P / (s.P + s.Scols)).toBeCloseTo(0.7263937, 6);
    let lo = 1;
    let hi = 0;
    for (const j of [64, 128, 200] as const)
      for (const cx of [1, 2, 4] as const) {
        if (j === 200 && cx === 4) continue;
        const t = at(Q6BO, j, cx);
        for (const S of [t.Srows, t.Scols]) {
          lo = Math.min(lo, t.P / (t.P + S));
          hi = Math.max(hi, t.P / (t.P + S));
        }
      }
    expect(lo).toBeCloseTo(0.687729, 5);
    expect(hi).toBeCloseTo(0.856672, 5);
  }, 900000);
});

describe("§ 6cl.2 — and the remainder is the same imbalance, not a second mechanism", () => {
  it("pins the 0.18 § 6ci quoted for the shapes and left unmeasured", () => {
    const s = at(Q6BO, 128, 2);
    expect(s.Srows).toBeCloseTo(0.1814947, 7);
    expect(s.Scols).toBeCloseTo(0.2023679, 7);
    // And the two halves add to § 6ci.5's own composed form, which that rung
    // pinned only through its 0.6% and 0.9% overshoot of live.
    expect(s.P + s.Srows).toBeCloseTo(0.7187587, 7);
    expect(s.P + s.Scols).toBeCloseTo(0.7396319, 7);
    expect((s.P + s.Srows) / s.liveRows - 1).toBeCloseTo(0.0060, 3);
    expect((s.P + s.Scols) / s.liveCols - 1).toBeCloseTo(0.0088, 3);
  }, 600000);

  it("is zero at a vanishing guard, because the four tiles pair up by aperture", () => {
    // At the narrow end the guard has taken nothing, so w depends on the
    // aperture alone and the contrast of ANY function of it is zero. Both
    // halves of the split are made by the guard, and neither exists without it.
    for (const cx of [1, 2, 4] as const) {
      const s = at(Q6BO, 128, cx);
      const lnShape = (k: 0 | 1): number =>
        contrast(s.ends.map((p) => Math.log(shapeRows(p[k]!.w))));
      const lnPre = (k: 0 | 1): number => contrast(s.ends.map((p) => 2 * Math.log(p[k]!.w)));
      expect(Math.abs(lnShape(0))).toBeLessThan(2e-6);
      expect(Math.abs(lnPre(0))).toBeLessThan(1e-5);
      expect(Math.abs(lnShape(1))).toBeGreaterThan(8e-3);
      expect(Math.abs(lnPre(1))).toBeGreaterThan(3e-2);
    }
    // The prefactor's own contrast at the wide end is the anchor-free number
    // twice over — the same 0.03358 at all three anchors.
    for (const cx of [1, 2, 4] as const)
      expect(contrast(at(Q6BO, 128, cx).ends.map((p) => 2 * Math.log(p[1]!.w)))).toBeCloseTo(
        0.0335796,
        5,
      );
  }, 900000);

  it("carries the whole axis difference, because the prefactor has no branch", () => {
    // § 6ca.1's 2.6% cannot be in P — P is one number for both seams. So the
    // axis constant § 6ci.4 bounded lives entirely in the 0.18 and the 0.20.
    const s = at(Q6BO, 128, 2);
    expect(s.Scols / s.Srows).toBeCloseTo(1.1150076, 6);
    // It tracks the seam's OWN anisotropy at these anchors without being it:
    // as the tile vanishes the shape ratio goes to 4/3 and the seam's to sqrt2.
    const seam = live(10, 0.1, 256, (128 * 65536) / 2 ** 24, 2);
    expect(s.Scols / s.Srows / (seam.rows / seam.cols)).toBeCloseTo(1.000166, 5);
    const sr = (w: number): number => LR(w) - 2;
    const sc = (w: number): number => LC(w) - 2;
    expect(sc(1e-9) / sr(1e-9)).toBeCloseTo(4 / 3, 6);
    expect(shapeRows(1e-9) / shapeCols(1e-9)).toBeCloseTo(Math.SQRT2, 6);
    for (const cx of [1, 2, 4] as const) {
      const t = at(Q6BO, 128, cx);
      const l = live(10, 0.1, 256, (128 * 65536) / 2 ** 24, cx);
      expect(Math.abs(t.Scols / t.Srows / (l.rows / l.cols) - 1)).toBeLessThan(0.006);
    }
  }, 900000);
});

describe("§ 6cl.3 — balance the share and the whole sensitivity goes", () => {
  it("falls by three orders when the guard is held in pixels", () => {
    // The matched field is untouched — same four lenses, same four samplings.
    // Only the guard changes, from a count of cells to a count of pixels, so
    // every tile loses the same FRACTION. The prefactor is then exactly zero by
    // construction and the shapes follow it down.
    const s = at(Q6BO, 128, 2);
    const b = at(Q6BO, 128, 2, true);
    expect(Math.abs(b.P)).toBeLessThan(1e-13);
    expect(Math.abs(b.Srows)).toBeLessThan(1e-6);
    expect(Math.abs(b.Scols)).toBeLessThan(1e-6);
    expect(b.liveRows).toBeCloseTo(0.00032768, 7);
    expect(b.liveCols).toBeCloseTo(0.00037745, 7);
    expect(s.liveRows / b.liveRows).toBeCloseTo(2180, -1);
    expect(s.liveCols / b.liveCols).toBeCloseTo(1943, -1);
    // And every tile really does keep the same guard.
    expect(b.ends.map((p) => p[1]!.guardPixels)).toEqual([1048576, 1048576, 1048576, 1048576]);
  }, 900000);

  it("leaves a residue that grows with the anchor, which is the map's and not the guard's", () => {
    // P and S are both zero here, so the closed form predicts nothing at all
    // and what live reads is the one thing the form drops. § 6cj measured that
    // the map's departure grows with the field offset, and this does.
    const r = [1, 2, 4].map((cx) => at(Q6BO, 128, cx, true));
    expect(r[0]!.liveRows).toBeCloseTo(0.00030508, 7);
    expect(r[1]!.liveRows).toBeCloseTo(0.00032768, 7);
    expect(r[2]!.liveRows).toBeCloseTo(0.00037092, 7);
    expect(r[0]!.liveRows).toBeLessThan(r[1]!.liveRows);
    expect(r[1]!.liveRows).toBeLessThan(r[2]!.liveRows);
    expect(r[0]!.liveCols).toBeLessThan(r[1]!.liveCols);
    expect(r[1]!.liveCols).toBeLessThan(r[2]!.liveCols);
  }, 900000);

  it("does the same to the 4x/10x factorial, whose floor is half again as big", () => {
    const s = at(STEP_4_10, 128, 2);
    const b = at(STEP_4_10, 128, 2, true);
    expect(s.liveRows).toBeCloseTo(0.4134523, 6);
    expect(s.liveCols).toBeCloseTo(0.4239632, 6);
    expect(s.P).toBeCloseTo(0.3101178, 6);
    expect(Math.abs(b.P)).toBeLessThan(1e-13);
    expect(b.liveRows).toBeCloseTo(0.00040419, 7);
    expect(b.liveCols).toBeCloseTo(0.00046692, 7);
    expect(s.liveRows / b.liveRows).toBeGreaterThan(1000);
  }, 900000);
});

describe("§ 6cl.4 — but the share cannot be balanced, so this is what a matched field costs", () => {
  it("charges a different physical guard to every cell when it is balanced", () => {
    // A guard is a count of resolution cells because the wrap it has to contain
    // is measured in them (§ 6bh.4). Equal pixels is four different guards: the
    // widest cell is guarded four times as deeply as the narrowest, and the
    // 4x/10x set five times.
    for (const f of [Q6BO, STEP_4_10]) {
      const design = at(f, 128, 2).ends.map((p) => p[1]!.guardCells);
      const balanced = at(f, 128, 2, true).ends.map((p) => p[1]!.guardCells);
      // The design charges every cell the same guard and they keep different
      // tiles; balancing the tiles charges them different guards.
      expect(new Set(design).size).toBe(1);
      const ps0 = f.cells.map((c) => c[2]);
      expect(Math.max(...balanced) / Math.min(...balanced)).toBeCloseTo(
        Math.max(...ps0) / Math.min(...ps0),
        12,
      );
    }
    expect(Math.max(...Q6BO.cells.map((c) => c[2])) / Math.min(...Q6BO.cells.map((c) => c[2]))).toBe(4);
    expect(
      Math.max(...STEP_4_10.cells.map((c) => c[2])) / Math.min(...STEP_4_10.cells.map((c) => c[2])),
    ).toBe(5);
  });

  it("so the floor is zero only where a lever does not move", () => {
    // Any matched-field 2x2 pays it. The only way out is a degenerate factorial.
    const floor = (m: number, n: number): number => (2 * (m - 1) * (n - 1)) / n;
    expect(floor(1, 2)).toBe(0);
    expect(floor(2, 1)).toBe(0);
    for (const m of [1.5, 2, 2.5, 5] as const)
      for (const n of [1.25, 2, 4] as const) expect(floor(m, n)).toBeGreaterThan(0);
    expect(floor(2, 2)).toBe(1);
    expect(floor(2.5, 2)).toBe(1.5);
  });
});

describe("§ 6cl.5 — the published slope is a secant, and the derivative is 14% out at its ends", () => {
  it("but lands within 5.4e-4 of it at the geometric mean of the two", () => {
    // dln(seam)/dshare is −L(w)·a/kappa per cell, and L is § 6ci.2's rational.
    // Over § 6ca's own guard ends that derivative moves 14%, so the secant is
    // not it — and evaluating at the geometric mean of the two ends' w and
    // kappa closes the gap to five parts in ten thousand, on both branches and
    // at all three anchors.
    const deriv = (s: Split, f: Factorial, L: (w: number) => number, k: 0 | 1 | -1): number =>
      -contrast(
        s.ends.map((p, c) => {
          const w = k === -1 ? Math.sqrt(p[0]!.w * p[1]!.w) : p[k]!.w;
          const kap = k === -1 ? Math.sqrt(p[0]!.kappa * p[1]!.kappa) : p[k]!.kappa;
          return (L(w) * shares(f)[c]!) / kap;
        }),
      );
    const s = at(Q6BO, 128, 2);
    expect(deriv(s, Q6BO, LR, 0)).toBeCloseTo(0.6729012, 6);
    expect(deriv(s, Q6BO, LR, 1)).toBeCloseTo(0.7671824, 6);
    expect(deriv(s, Q6BO, LR, 1) / deriv(s, Q6BO, LR, 0)).toBeCloseTo(1.1401114, 6);
    for (const cx of [1, 2, 4] as const) {
      const t = at(Q6BO, 128, cx);
      expect(deriv(t, Q6BO, LR, -1) / (t.P + t.Srows) - 1).toBeCloseTo(0.00053, 4);
      expect(deriv(t, Q6BO, LC, -1) / (t.P + t.Scols) - 1).toBeCloseTo(0.00053, 4);
    }
  }, 900000);
});
