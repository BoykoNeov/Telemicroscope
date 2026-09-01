import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
  type MosaicSeamShift,
} from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6ca — the branches' separation is one slope, and there is no 3× to explain.
 *
 * § 6by found `mosaicSeamShiftMm`'s `mm` handing over between two branches — the
 * worst seam between columns and the worst between rows — and left this:
 * "**The two-branch structure is a mechanism for the jump and not for either
 * branch.** Why the column-axis threshold should sit three times above the
 * row-axis one, and why one rises where the other falls, is unmeasured."
 *
 * ## They start together, so it is a slope and not a gap
 *
 * At a guard of 2⁻²⁰ of a cell the two branch costs agree to 9 × 10⁻⁵ — 1.025839
 * against 1.025932 — and they do at every anchor tried (§ 6ca.0). Nothing
 * separates the branches at zero guard. The whole separation is the RATE at
 * which each falls, so the located thresholds are in inverse proportion to two
 * slopes and the question is which slope, and why.
 *
 * ## The field factor cannot tell the axes apart; the stage factor can
 *
 * § 6bx.1 factorises the cost exactly into the stage interact over the field
 * interact. Per unit of guard share at a ratio of 1.871 the FIELD interact rises
 * 0.7145 on rows and 0.7332 on columns — 2.6% apart, which is nothing — while
 * the STAGE interact rises 0.2637 and 0.6132, a factor of 2.33 (§ 6ca.1). Every
 * bit of the branch difference is in the stage factor, and that is the same
 * split § 6by.1 found in the VALUES, now in their guard derivative.
 *
 * So the column cost falls slowly because its stage factor nearly cancels its
 * field factor (0.613 against 0.733) where the row cost's does not (0.264
 * against 0.714). Two near-equal numbers differencing to a small one is the
 * whole of the "3×", and it predicts 3.76 to first order against the 3.06 the
 * located thresholds show — the gap being curvature over the column branch's
 * three times longer run (§ 6ca.4).
 *
 * ## The axis constant is the mosaic's, not the lens's, and it is the ratio's
 *
 * That factor of 2.33 is the same in all four cells to under 1% (§ 6ca.2): it is
 * a square lattice meeting a radial map at a given tile size and field offset,
 * which is § 6bj.5's subject, and no cell's optics enter it. And it is a
 * function of the tile half extent over the field offset — matched anchors at
 * 2 mm and 4 mm agree to 1.0 × 10⁻³ at a ratio of 0.935 (§ 6ca.3), which is
 * § 6bz.2's collapse again on a different quantity.
 *
 * ## Which disposes of the 3× and of the opposite drifts
 *
 * The axis constant GROWS with the ratio — 1.73 at 0.47, 2.32 at 1.87 — so the
 * column branch's near-cancellation tightens as the anchor grows and its
 * threshold rises, while the row branch's does not and its threshold falls.
 * § 6by's "one rises where the other falls" is one quantity moving (§ 6ca.5).
 *
 * And there is no 3× to explain: the separation runs 2.77 at a ratio of 1.40 to
 * 3.12 at 1.99, then **collapses and inverts** — past § 6bz's own turn the row
 * branch's threshold climbs 6.2× while the column branch drifts up 22%, and the
 * two CROSS between ratios 2.22 and 2.57 (§ 6ca.6). Three is a window's number.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6bz used it: no render, so no focus stage. */
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
/** § 6bo's shapes at k = 1. `size` and `pupilSamples`, in that order. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

const interact = (sl: number, fl: number, sh: number, fh: number): number => fh / sh / (fl / sl);
const inter4 = (v: readonly number[]): number => interact(v[0]!, v[1]!, v[2]!, v[3]!);

const BIG = 2 ** 26;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;
const shareOfI = (i: number): number => i / 2 ** 23;

const shiftAt = (
  c: Cell,
  j: number,
  i: number,
  probes: number,
  x: number,
  scan: "field" | "stage",
): MosaicSeamShift =>
  mosaicSeamShiftMm(
    LENS[c],
    mosaicOptions(BIG, PS_AT(c, j), {
      guardCells: guardAt(j, i),
      centreMm: { x, y: 0 },
      ...(scan === "stage" ? { scan: "stage" as const } : {}),
    }),
    probes,
  );

/** § 6by's own three readings: `"max"` is what `mm` reports and what § 6bu…
 *  § 6bx read; the other two are the branches under it. */
type Branch = "max" | "rows" | "columns";
const read = (s: MosaicSeamShift, b: Branch): number =>
  b === "max" ? s.mm : b === "rows" ? s.betweenRowsMm : s.betweenColumnsMm;

/** § 6bx.1's two factors and their quotient, all on one branch. */
const factors = (
  b: Branch,
  j: number,
  i: number,
  x: number,
  probes = 65,
): { stage: number; field: number; cost: number } => {
  const st = CELLS.map((c) => read(shiftAt(c, j, i, probes, x, "stage"), b));
  const fi = CELLS.map((c) => read(shiftAt(c, j, i, probes, x, "field"), b));
  return { stage: inter4(st), field: inter4(fi), cost: inter4(st.map((v, n) => v / fi[n]!)) };
};

/** The near-zero guard both branches are read at: 2⁻²⁰ of a cell. */
const TINY = 8;
/** The far end of the log-slope secant, a guard share of 1/16. */
const WIDE = 524288;

/** How fast a quantity rises per unit of the slow 20×'s guard share. */
const slope = (at: (i: number) => number): number =>
  Math.log(at(WIDE) / at(TINY)) / (shareOfI(WIDE) - shareOfI(TINY));

/** The ratio of a cell's column-axis guard sensitivity to its row-axis one, on
 *  a stage scan — § 6ca.2's quantity, one number per cell. */
const axisRatio = (c: Cell, j: number, x: number): number => {
  const sl = (axis: "rows" | "columns"): number =>
    Math.log(read(shiftAt(c, j, WIDE, 65, x, "stage"), axis) / read(shiftAt(c, j, TINY, 65, x, "stage"), axis));
  return sl("columns") / sl("rows");
};

const ratioOfHalf = (j: number, x: number): number =>
  objectFieldTile(LENS.s20, {
    size: BIG,
    pupilSamples: PS_AT("s20", j),
    wavelengthNm: DESIGN,
    centreMm: { x, y: 0 },
  }).halfExtentMm / x;

/** `i` is the branch's threshold: at it the branch cost still exceeds 1, at
 *  `i + 1` it does not. Both halves are re-measured, never remembered. */
const located = (b: Branch, j: number, i: number, x = 2): void => {
  expect(factors(b, j, i, x).cost).toBeGreaterThan(1);
  expect(factors(b, j, i + 1, x).cost).toBeLessThan(1);
};

/** Both branches located at 2 mm, on § 6bx's own 2⁻²⁴ lattice at 65 probes.
 *  § 6by published the rows column at j = 116…136; the columns column and
 *  everything past the turn are this step's. */
const ROWS: Record<number, number> = {
  96: 501061,
  116: 486643,
  136: 479661,
  144: 617446,
  152: 1064019,
  176: 2162216,
  200: 2992641,
};
const COLS: Record<number, number> = {
  96: 1386681,
  116: 1428323,
  136: 1498204,
  144: 1532181,
  152: 1569054,
  176: 1694388,
  200: 1837540,
};

describe("§ 6ca.0 — the two branches start together, so this is a slope", () => {
  it("agrees to a part in ten thousand at a guard of 2^-20 of a cell", () => {
    // If the branches were separated by an OFFSET the thresholds would differ
    // by whatever the offset is worth; they are not. At a guard this small both
    // costs are § 6bn's own reading, and the separation has not begun.
    for (const [j, tol] of [
      [64, 4e-5],
      [116, 1e-4],
      [200, 1.4e-4],
    ] as const) {
      const r = factors("rows", j, TINY, 2);
      const c = factors("columns", j, TINY, 2);
      expect(Math.abs(c.cost / r.cost - 1)).toBeLessThan(tol);
      // And so do the two factors separately, which is what makes the split
      // below a statement about derivatives and not about levels.
      expect(Math.abs(c.stage / r.stage - 1)).toBeLessThan(tol);
      expect(Math.abs(c.field / r.field - 1)).toBeLessThan(tol);
    }
    expect(factors("rows", 116, TINY, 2).cost).toBeCloseTo(1.025839024, 8);
    expect(factors("columns", 116, TINY, 2).cost).toBeCloseTo(1.025931601, 8);
  });
});

describe("§ 6ca.1 — the field factor is axis-blind and the stage factor is not", () => {
  it("splits the branch difference entirely into the stage factor", () => {
    const j = 128;
    const stageR = slope((i) => factors("rows", j, i, 2).stage);
    const stageC = slope((i) => factors("columns", j, i, 2).stage);
    const fieldR = slope((i) => factors("rows", j, i, 2).field);
    const fieldC = slope((i) => factors("columns", j, i, 2).field);
    // The field interact rises at nearly the same rate whichever axis it is
    // read on: 2.6% apart, against a stage factor that differs by 133%.
    expect(fieldR).toBeCloseTo(0.7145, 3);
    expect(fieldC).toBeCloseTo(0.7332, 3);
    expect(Math.abs(fieldC / fieldR - 1)).toBeLessThan(0.03);
    expect(stageR).toBeCloseTo(0.2637, 3);
    expect(stageC).toBeCloseTo(0.6132, 3);
    expect(stageC / stageR).toBeGreaterThan(2.3);
    // So the column cost falls slowly because two near-equal numbers difference
    // to a small one, and the row cost does not.
    expect(stageC - fieldC).toBeCloseTo(-0.1200, 3);
    expect(stageR - fieldR).toBeCloseTo(-0.4508, 3);
  });
});

describe("§ 6ca.2 — the axis constant is the mosaic's and not any cell's", () => {
  it("is the same in all four cells, at three anchors", () => {
    // The four cells span a 2x of magnification and a 2x of aperture, and the
    // ratio of the two axes' guard sensitivities does not notice: it is a square
    // stage lattice meeting a radial map (§ 6bj.5), and the map's own shape
    // divides out of the quotient.
    for (const [j, want] of [
      [64, 1.8211],
      [116, 2.2726],
      [200, 0.8462],
    ] as const) {
      const v = CELLS.map((c) => axisRatio(c, j, 2));
      expect(Math.max(...v) / Math.min(...v) - 1).toBeLessThan(0.01);
      expect(v.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(want, 3);
    }
  });
});

describe("§ 6ca.3 — and it is a function of the ratio, like everything else here", () => {
  it("puts matched anchors at 2 mm and 4 mm on the same axis constant", () => {
    // § 6bz.2's collapse, on a quantity § 6bz never read. `j` at 2 mm and `2j`
    // at 4 mm are one ratio, and the axis constant does not distinguish them.
    for (const [j, tol] of [
      [40, 1e-4],
      [64, 1.1e-3],
      [96, 7e-3],
    ] as const) {
      const two = CELLS.map((c) => axisRatio(c, j, 2)).reduce((a, b) => a + b, 0) / 4;
      const four = CELLS.map((c) => axisRatio(c, 2 * j, 4)).reduce((a, b) => a + b, 0) / 4;
      expect(Math.abs(ratioOfHalf(j, 2) / ratioOfHalf(2 * j, 4) - 1)).toBeLessThan(3e-4);
      expect(Math.abs(two / four - 1)).toBeLessThan(tol);
    }
  });
});

describe("§ 6ca.4 — so the separation is a near-cancellation, to first order", () => {
  it("predicts the located ratio from the two slopes", () => {
    const j = 128;
    const stageR = slope((i) => factors("rows", j, i, 2).stage);
    const stageC = slope((i) => factors("columns", j, i, 2).stage);
    const fieldR = slope((i) => factors("rows", j, i, 2).field);
    const fieldC = slope((i) => factors("columns", j, i, 2).field);
    // Equal intercepts (§ 6ca.0) and slopes in this proportion put the two
    // crossings in the inverse proportion: 3.76 predicted.
    const predicted = (stageR - fieldR) / (stageC - fieldC);
    expect(predicted).toBeCloseTo(3.758, 3);
    // Located, they are 3.06 apart. The first-order estimate overshoots by 23%
    // because the column branch has to run three times further in the guard to
    // reach its crossing, and neither factor is straight over that run — which
    // is a statement about the estimate, not about the mechanism.
    located("rows", 136, ROWS[136]!);
    located("columns", 136, COLS[136]!);
    expect(COLS[136]! / ROWS[136]!).toBeCloseTo(3.1235, 4);
    expect(predicted / (COLS[136]! / ROWS[136]!)).toBeLessThan(1.25);
  });
});

describe("§ 6ca.5 — the opposite drifts are the axis constant growing", () => {
  it("tightens the column branch's cancellation as the anchor grows", () => {
    // The axis constant rises with the ratio, so the column stage slope closes
    // on its field slope and the column threshold rises; the row branch has no
    // such cancellation to tighten and its threshold falls. One quantity.
    const a = CELLS.map((c) => axisRatio(c, 64, 2)).reduce((s, v) => s + v, 0) / 4;
    const b = CELLS.map((c) => axisRatio(c, 128, 2)).reduce((s, v) => s + v, 0) / 4;
    expect(a).toBeCloseTo(1.8211, 3);
    expect(b).toBeCloseTo(2.3204, 3);
    expect(b).toBeGreaterThan(a);
    for (const j of [96, 116, 136] as const) {
      located("rows", j, ROWS[j]!);
      located("columns", j, COLS[j]!);
    }
    // Down 4.3% on rows and up 8.0% on columns over the same three anchors.
    expect(ROWS[136]!).toBeLessThan(ROWS[116]!);
    expect(ROWS[116]!).toBeLessThan(ROWS[96]!);
    expect(COLS[136]!).toBeGreaterThan(COLS[116]!);
    expect(COLS[116]!).toBeGreaterThan(COLS[96]!);
    expect(1 - ROWS[136]! / ROWS[96]!).toBeCloseTo(0.0427, 4);
    expect(COLS[136]! / COLS[96]! - 1).toBeCloseTo(0.0804, 4);
  });
});

describe("§ 6ca.6 — and there is no 3×: the separation inverts past the turn", () => {
  it("climbs the row branch through the column branch and out the other side", () => {
    // Below § 6bz's turn the separation is what § 6by saw, and it is not
    // constant even there: 2.77 at a ratio of 1.40 against 3.12 at 1.99.
    expect(COLS[96]! / ROWS[96]!).toBeCloseTo(2.7675, 4);
    expect(COLS[136]! / ROWS[136]!).toBeCloseTo(3.1235, 4);
    // Past the turn the ROW branch's own falling law ends — § 6bx.3's fall and
    // § 6by.4's "still falling" are that window's — and it climbs 6.2× while
    // the column branch drifts up 22%.
    for (const j of [144, 152, 176, 200] as const) {
      located("rows", j, ROWS[j]!);
      located("columns", j, COLS[j]!);
    }
    expect(ROWS[200]! / ROWS[136]!).toBeCloseTo(6.2391, 4);
    expect(COLS[200]! / COLS[136]!).toBeCloseTo(1.2265, 4);
    // So they CROSS: rows is below columns at a ratio of 2.22 and above it at
    // 2.57, and by 2.92 it is 63% above. "Three times" is a window's number.
    expect(ROWS[152]!).toBeLessThan(COLS[152]!);
    expect(ROWS[176]!).toBeGreaterThan(COLS[176]!);
    expect(ROWS[200]! / COLS[200]!).toBeCloseTo(1.6286, 4);
    expect(ratioOfHalf(152, 2)).toBeCloseTo(2.2217, 4);
    expect(ratioOfHalf(176, 2)).toBeCloseTo(2.5725, 4);
  });

  it("and the row branch's cost stops falling with the guard at all", () => {
    // The reason the row threshold jumps: past the turn its stage slope passes
    // its field slope, so the row cost RISES with the guard over the middle of
    // the range and only collapses at the end. The crossing stays unique, which
    // is what the bisection needs — § 6bz.0's argument, on the cost this time.
    const j = 152;
    const stageR = slope((i) => factors("rows", j, i, 2).stage);
    const fieldR = slope((i) => factors("rows", j, i, 2).field);
    expect(stageR).toBeGreaterThan(fieldR);
    expect(stageR - fieldR).toBeCloseTo(0.1517, 3);
    let crossings = 0;
    let above = true;
    for (let e = 3; e <= 22.5; e += 1.5) {
      const v = factors("rows", j, Math.round(2 ** e), 2).cost;
      if (above !== v > 1) {
        crossings++;
        above = v > 1;
      }
    }
    expect(crossings).toBe(1);
  });
});
