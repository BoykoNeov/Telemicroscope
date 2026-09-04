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
 * § 6cp — the stage seam's guard sensitivity, asked § 6cl's question.
 *
 * § 6cl took the FIELD interact's guard secant apart and found no optics in it:
 * a matched field forces `pupilSamples ∝ NA/M`, so each cell's guard share of
 * its tile is `(M/NA)/K`, and because the guard is SUBTRACTED from the tile the
 * four-cell contrast of the `w²` prefactor survives as four integers and a crop
 * — `P = 0.5372639930331878`, no lens, no anchor, no sampling rung. § 6cl closed
 * with the obvious next question and did not ask it: **§ 6ca.1's other pair.**
 * The stage interact's 0.2637 and 0.6132 are read over the same four cells and
 * the same guard secant, and the stage seams are first and second order in the
 * kept tile where the field's are second and second (§ 6cf.2, § 6ci.2) — so the
 * same arithmetic must apply with a different power in front, and nothing had
 * subtracted it.
 *
 * **The hypothesis.** The stage interact's guard secant is `P/2 + shape` on rows
 * and `P + shape` on columns, with `P` the SAME number § 6cl measured, because
 * the stage row seam carries one power of the kept tile and the column seam two
 * (§ 6ce.0). **The number that would refute it** is the split's residual: if the
 * two branches did not land within a percent or so of `P/2` and `P` plus their
 * own shapes, the axis difference would be carrying something the matched field's
 * arithmetic does not explain — a map coefficient moving with the guard, say —
 * and that would be a finding about the seam rather than about the design.
 *
 * They land. And the register's question was whether this "closes § 6ca.1's
 * second pair the same way or shows the field seam and the stage seam differ".
 * The answer is **both**, in three parts.
 *
 * ## One prefactor, because both scans read one `w`
 *
 * `fluorescenceMosaicGeometry` does not know which scan is coming, so the kept
 * half tile is the same object under `scan: "field"` and `scan: "stage"` — equal
 * to the BIT, not to a tolerance (§ 6cp.0). The four-integer prefactor is
 * therefore not two numbers that happen to agree; it is one number read twice,
 * and § 6cl's arithmetic reproduces it from the stage scan's own geometry.
 *
 * ## The split is P/2 and P, and that one power is § 6ca.1's 133%
 *
 * `rows ∝ w(2 + 2w − w²)` and `cols ∝ w²·hypot(w, 2)` (§ 6ce.0), so the
 * prefactor contributes half as much to one branch as to the other. Live, in
 * domain, the split reproduces both stage slopes to **0.17%** at w = 0.34
 * and 0.80% at 0.68, and on both of § 6cl's factorials (§ 6cp.1). The prefactors
 * alone stand in the ratio 2 — exactly, and by construction — which is
 * § 6cf.2's "one power of the tile" arriving in the four-cell interact rather
 * than in a single cell's log slope.
 *
 * ## And on the COST the prefactor cancels identically on one branch
 *
 * The registration cost is the stage interact over the field interact, so its
 * guard slope is the difference of the two. On COLUMNS both seams are second
 * order in the tile, so `2·ln w` subtracts term for term and the column cost
 * slope carries **no prefactor at all** — bitwise, since the two scans' `w` are
 * the same number. On ROWS the stage seam has one power against the field's two,
 * so `−P/2` survives, and it is **86%** of the whole row cost slope (§ 6cp.3).
 * § 6ca.4 read the branch separation as "a small number produced by two large
 * ones"; the two large ones are the same four integers, and on one branch they
 * cancel exactly.
 *
 * ## Where the two geometries differ: the stage form has an edge and the row
 * seam is the half that pays
 *
 * § 6cd.1: the stage corner form is exact only while the kept tile has not
 * reached the axis, `w < 1`. The field form has no such edge — "this form's
 * domain is a small field offset, not a small tile" (§ 6ci.3). Walked through
 * it, the column split stays inside **1.1%** out to w = 1.71, monotone at each
 * field offset, while the row split changes sign near w ≈ 1.05 and runs to **−25%** by w = 1.37 and
 * −80% by 1.54 (§ 6cp.4). That is § 6cd.1's own mechanism seen on the interact:
 * at w = 1 the ROW seam's probe pair lands on the axis and the column seam's
 * does not.
 *
 * **Which locates § 6ca.1's own pair outside the domain.** Its 0.2637 and 0.6132
 * are read at j = 128 and cx = 2 mm, and that is w = 1.3692 — § 6ca's quoted
 * "ratio 1.871" over § 6cf.5's own 1.36642 unit correction, to five figures. So
 * the published axis difference is a reading past the edge, its column half is
 * fine and its row half is 25% away from the form, and the in-domain axis
 * constant is 1.73 to 2.15 rather than 2.33.
 *
 * ## And it is the design, not the optics: balance the share and it goes
 *
 * Hold the guard in PIXELS rather than in resolution cells, leave the matched
 * field alone, and the stage interact's guard sensitivity falls by **12657×**
 * and **11806×** — further than the field's 2180× — with `P` at 7e-15 and both
 * shapes at 6e-8 (§ 6cp.5). The cost's two branches go with it, from −0.311 and
 * −0.104 to −1.5e-4 and −1.8e-4, which is § 6ca's whole separation. As at
 * § 6cl.4 the counterfactual is a measurement and not a proposal: equal pixels
 * is a different physical guard in every cell, and a guard is counted in cells
 * because the wrap it contains is.
 *
 * Source: measurement only — no engine change. The pin is arithmetic, as
 * § 6cl's was: four integers, a crop, and an exact cancellation, with no lens,
 * anchor or sampling rung in any of them.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };
const FREE_STAGE: TileStageMm = () => 0;
const BIG = 2 ** 26;

/** § 6ca's own guard secant, and the parameter it is taken in. */
const TINY = 8;
const WIDE = 524288;
const shareOfI = (i: number): number => i / 2 ** 23;

/** § 6cl's harness, carried rather than shared — a later step must not be able
 *  to move an earlier step's pin by editing one file. The one addition is the
 *  scan, which is what this step is about. */
type Scan = "field" | "stage";

function mosaicOptions(ps: number, scan: Scan, over: Partial<FluorescenceMosaicOptions>) {
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
    ...(scan === "stage" ? { scan: "stage" as const } : {}),
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
  readonly guardPixels: number;
  readonly guardCells: number;
}

const live = (
  M: number,
  NA: number,
  ps: number,
  guardCells: number,
  cx: number,
  scan: Scan,
): Seam => {
  const options = mosaicOptions(ps, scan, { guardCells, centreMm: { x: cx, y: 0 } });
  const system = sysOf(M, NA);
  const g = fluorescenceMosaicGeometry(system, options);
  const s = mosaicSeamShiftMm(system, options, 65);
  const U = g.tileSize / 2 - g.croppedPixels - g.guardPixels;
  return {
    rows: s.betweenRowsMm,
    cols: s.betweenColumnsMm,
    w: (U * g.pixelScaleMm) / cx,
    guardPixels: g.guardPixels,
    guardCells: g.guardCells,
  };
};

/**
 * The two geometries' shapes, with the powers of `w` taken out in front.
 *
 * Stage (§ 6ce.0): `rows ∝ w·SR(w)` and `cols ∝ w²·SC(w)` — ONE power and two.
 * Field (§ 6ci.2): both `∝ w²` — two and two. That asymmetry is the whole step.
 */
const stageShapeRows = (w: number): number => 2 + 2 * w - w * w;
const stageShapeCols = (w: number): number => Math.hypot(w, 2);
const fieldShapeRows = (w: number): number => Math.hypot(2 + 3 * w, w);
const fieldShapeCols = (w: number): number => Math.hypot(1 + 3 * w, 1 + w);

/** § 6ca's four-cell contrast, in logs: `ln(fh/sh) − ln(fl/sl)`. */
const SIGN = [1, -1, -1, 1] as const;
const contrast = (v: readonly number[]): number => v.reduce((a, x, k) => a + SIGN[k]! * x, 0);

interface Factorial {
  readonly name: string;
  /** `[magnification, numericalAperture, pupilSamples at j = 16]`. */
  readonly cells: readonly (readonly [number, number, number])[];
  readonly ends: readonly [number, number];
}

/** § 6bo's own four shapes — the set § 6ca.1 published both pairs on. */
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
  ends: [10, 524290],
};

const shares = (f: Factorial): number[] => f.cells.map(([, , ps0]) => 16 / ps0);
const levers = (f: Factorial): [number, number] => [
  f.cells[2]![0] / f.cells[0]![0],
  f.cells[1]![1] / f.cells[0]![1],
];

/** § 6cl.1's prefactor, from four shares, two guard ends and one crop. */
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
  /** The kept half tile over the offset, at the near-zero guard end. */
  readonly w: number;
  /** `2·Δ⟨ln w⟩ / Δshare`, read off the STAGE scan's geometry. */
  readonly P: number;
  /** The same, read off the FIELD scan's. Bitwise equal — § 6cp.0. */
  readonly Pfield: number;
  readonly stageRows: number;
  readonly stageCols: number;
  readonly fieldRows: number;
  readonly fieldCols: number;
  /** The four shapes' own contributions to the same secant. */
  readonly SsR: number;
  readonly SsC: number;
  readonly SfR: number;
  readonly SfC: number;
  readonly ends: readonly (readonly { st: Seam; fi: Seam }[])[];
}

/**
 * Both scans' guard secants at one (rung, anchor), and the split of each.
 *
 * `balanced` swaps the guard from a count of resolution CELLS to a count of
 * PIXELS — § 6cl.3's counterfactual, run here on the stage branch.
 */
function split(f: Factorial, j: number, cx: number, balanced = false): Split {
  const a = shares(f);
  const ends = f.cells.map(([M, NA, ps0], k) => {
    const ps = (ps0 * j) / 16;
    return f.ends.map((i) => {
      const guard = balanced
        ? (a[0]! * shareOfI(i) * ps) / 2
        : (a[k]! * shareOfI(i) * ps) / 2;
      return {
        st: live(M, NA, ps, guard, cx, "stage"),
        fi: live(M, NA, ps, guard, cx, "field"),
      };
    });
  });
  const d = (g: (p: { st: Seam; fi: Seam }) => number): number =>
    (contrast(ends.map((p) => g(p[1]!))) - contrast(ends.map((p) => g(p[0]!)))) /
    (shareOfI(f.ends[1]) - shareOfI(f.ends[0]));
  return {
    w: ends[0]![0]!.st.w,
    P: d((p) => 2 * Math.log(p.st.w)),
    Pfield: d((p) => 2 * Math.log(p.fi.w)),
    stageRows: d((p) => Math.log(p.st.rows)),
    stageCols: d((p) => Math.log(p.st.cols)),
    fieldRows: d((p) => Math.log(p.fi.rows)),
    fieldCols: d((p) => Math.log(p.fi.cols)),
    SsR: d((p) => Math.log(stageShapeRows(p.st.w))),
    SsC: d((p) => Math.log(stageShapeCols(p.st.w))),
    SfR: d((p) => Math.log(fieldShapeRows(p.fi.w))),
    SfC: d((p) => Math.log(fieldShapeCols(p.fi.w))),
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

/** A recorded reading is compared relatively — VALIDATION's *Rules*. */
const rel = (actual: number, recorded: number): number => Math.abs(actual / recorded - 1);

/** § 6cd.1's domain: the corner form is exact until the kept tile reaches the
 *  axis. Everything below w = 1 is in it; the ladder walks out of it on purpose. */
const IN_DOMAIN: readonly (readonly [number, number])[] = [
  [64, 4],
  [96, 4],
  [128, 4],
  [64, 2],
];
/** The walk through § 6cd.1's edge, in `w` order. Two offsets, so the ladder is
 *  not one anchor's ladder — cx = 4 at j = 128 and cx = 2 at j = 64 are one `w`. */
const LADDER: readonly (readonly [number, number])[] = [
  [32, 4],
  [64, 4],
  [96, 4],
  [128, 4],
  [160, 4],
  [96, 2],
  [112, 2],
  [128, 2],
  [144, 2],
  [160, 2],
];

describe("§ 6cp.0 — one prefactor, because both scans read one kept tile", () => {
  it("gives the same w to the bit under a field scan and a stage scan", () => {
    // `fluorescenceMosaicGeometry` is computed before anything knows which seam
    // is being asked for, so this is a same-process identity and not a
    // tolerance: the tile, the crop, the guard and the pixel scale are one set
    // of numbers. It is what makes the cancellation in § 6cp.3 exact.
    for (const [M, NA, ps] of [
      [10, 0.1, 128],
      [20, 0.2, 256],
      [4, 0.1, 256],
    ] as const) {
      for (const cx of [1, 2, 4] as const) {
        const st = live(M, NA, ps, 8, cx, "stage");
        const fi = live(M, NA, ps, 8, cx, "field");
        expect(st.w).toBe(fi.w);
        expect(st.guardPixels).toBe(fi.guardPixels);
      }
    }
  }, 900000);

  it("so § 6cl's four integers are the stage branch's prefactor too", () => {
    // Read off the STAGE scan's own geometry at five anchors, against the
    // arithmetic that has no trace in it at all.
    const arith = prefactorArithmetic(Q6BO, 2 / BIG);
    expect(rel(arith, 0.5372639930331878)).toBeLessThan(1e-13);
    for (const [j, cx] of [...IN_DOMAIN, [128, 2] as const]) {
      const s = at(Q6BO, j, cx);
      expect(rel(s.P, arith)).toBeLessThan(1e-13);
      expect(s.Pfield).toBe(s.P);
    }
    // And on the other factorial, whose floor is half again as big.
    const arith410 = prefactorArithmetic(STEP_4_10, 2 / BIG);
    expect(rel(arith410, 0.3101178,
    )).toBeLessThan(1e-6);
    expect(rel(at(STEP_4_10, 64, 4).P, arith410)).toBeLessThan(1e-13);
  }, 900000);
});

describe("§ 6cp.1 — the stage split is P/2 on rows and P on columns", () => {
  it("reproduces both stage slopes inside 1.4% wherever the form is exact", () => {
    // One power of the kept tile on rows, two on columns (§ 6ce.0). Nothing
    // else is fitted: the shapes are the closed forms and the prefactor is the
    // four integers.
    const recorded: Record<string, readonly [number, number]> = {
      "64|4": [0.31433761, 0.54310573],
      "96|4": [0.31638568, 0.54998846],
      "128|4": [0.30883693, 0.55891150],
      "64|2": [0.31069418, 0.56174279],
    };
    let worst = 0;
    for (const [j, cx] of IN_DOMAIN) {
      const s = at(Q6BO, j, cx);
      expect(s.w).toBeLessThan(1);
      const [wantR, wantC] = recorded[`${j}|${cx}`]!;
      expect(rel(s.stageRows, wantR)).toBeLessThan(1e-7);
      expect(rel(s.stageCols, wantC)).toBeLessThan(1e-7);
      worst = Math.max(
        worst,
        rel(s.P / 2 + s.SsR, s.stageRows),
        rel(s.P + s.SsC, s.stageCols),
      );
    }
    expect(worst).toBeLessThan(0.009);
    // The tightest anchor is the smallest tile, which is what a form whose
    // residual is the map's own next coefficient (§ 6ce.2) has to do.
    const near = at(Q6BO, 64, 4);
    expect(rel(near.P / 2 + near.SsR, near.stageRows)).toBeLessThan(0.002);
    expect(rel(near.P + near.SsC, near.stageCols)).toBeLessThan(0.002);
  }, 900000);

  it("and does it again on the 4x/10x factorial, at its own floor", () => {
    const s = at(STEP_4_10, 64, 4);
    expect(rel(s.stageRows, 0.18175507)).toBeLessThan(1e-7);
    expect(rel(s.stageCols, 0.31374183)).toBeLessThan(1e-7);
    expect(rel(s.P / 2 + s.SsR, s.stageRows)).toBeLessThan(0.003);
    expect(rel(s.P + s.SsC, s.stageCols)).toBeLessThan(0.003);
    // Per unit of the reference cell's own share the prefactor has § 6cl.1's
    // closed floor; halved on the row branch, because one power is.
    for (const f of [Q6BO, STEP_4_10]) {
      const [m, n] = levers(f);
      const floor = ((m - 1) * (n - 1)) / n;
      const half = at(f, 64, 4).P / 2 / shares(f)[0]!;
      expect(half).toBeGreaterThan(floor);
      expect(half / floor - 1).toBeLessThan(0.08);
    }
    expect(((2 - 1) * (2 - 1)) / 2).toBe(0.5);
    expect(((2.5 - 1) * (2 - 1)) / 2).toBe(0.75);
  }, 900000);
});

describe("§ 6cp.2 — so § 6ca.1's 133% is one power of the tile", () => {
  it("puts the two prefactors in the ratio 2 exactly, and live at 1.73 to 1.95", () => {
    // The prefactors' own ratio is 2 by construction — it is `P` over `P/2` —
    // which is § 6cf.2's `Lc(0)/Lr(0)` arriving in the four-cell interact. What
    // the shapes then add is the rest of the curve.
    for (const [j, cx] of IN_DOMAIN) {
      const s = at(Q6BO, j, cx);
      expect(s.P / (s.P / 2)).toBe(2);
      const A = s.stageCols / s.stageRows;
      expect(A).toBeGreaterThan(1.72);
      expect(A).toBeLessThan(1.95);
    }
    expect(rel(at(Q6BO, 64, 4).stageCols / at(Q6BO, 64, 4).stageRows, 1.727778)).toBeLessThan(1e-5);
    expect(rel(at(Q6BO, 128, 4).stageCols / at(Q6BO, 128, 4).stageRows, 1.809730)).toBeLessThan(
      1e-5,
    );
    // Against the FIELD interact at the same anchors, whose two branches differ
    // by 3% — because neither of them has a first-order term to differ in
    // (§ 6ci.2), and both prefactors are the whole `P`.
    for (const [j, cx] of IN_DOMAIN) {
      const s = at(Q6BO, j, cx);
      expect(Math.abs(s.fieldCols / s.fieldRows - 1)).toBeLessThan(0.037);
    }
  }, 900000);
});

describe("§ 6cp.3 — and on the cost the prefactor cancels identically on columns", () => {
  it("leaves the column cost slope with no prefactor at all, to the bit", () => {
    // The registration cost is the stage interact over the field interact, so
    // its guard slope is the difference. Both COLUMN seams are second order in
    // the kept tile and both scans read one `w` (§ 6cp.0), so the prefactor
    // subtracts term for term rather than nearly.
    for (const [j, cx] of IN_DOMAIN) {
      const s = at(Q6BO, j, cx);
      expect(s.P - s.Pfield).toBe(0);
    }
    const s = at(Q6BO, 64, 4);
    expect(rel(s.stageCols - s.fieldCols, -0.10387529)).toBeLessThan(1e-7);
    expect(rel(s.SsC - s.SfC, -0.10474046)).toBeLessThan(1e-7);
  }, 900000);

  it("and what the pure-shape prediction then misses by is the map, carrying cx²", () => {
    // With the prefactor gone the column cost slope is two closed-form shapes
    // and nothing else, so its residual against live is the whole of what those
    // shapes leave out — which § 6ce.2 names: the radial map's SECOND
    // coefficient, entering as `ε = (b/a)·cx²`. It is therefore a statement
    // about the field offset and not about the tile, and the check is that it
    // QUADRUPLES with the offset at one tile rather than that it is small.
    const near = at(Q6BO, 64, 2); // w = 0.6846, cx = 2 mm
    const far = at(Q6BO, 128, 4); // w = 0.6848, cx = 4 mm — the same tile
    expect(rel(near.w, far.w)).toBeLessThan(3e-4);
    const missOf = (t: Split): number => (t.SsC - t.SfC) / (t.stageCols - t.fieldCols) - 1;
    expect(rel(missOf(near), 0.005806)).toBeLessThan(2e-3);
    expect(rel(missOf(far), 0.022761)).toBeLessThan(2e-3);
    expect(rel(missOf(far) / missOf(near), 4)).toBeLessThan(0.03);
    // So each anchor is bounded by its own offset, and the cx = 2 mm readings
    // are the ones this branch's own anchors are taken at.
    for (const [j, cx] of IN_DOMAIN) {
      const t = at(Q6BO, j, cx);
      expect(Math.abs(missOf(t))).toBeLessThan(cx === 2 ? 0.006 : 0.023);
    }
  }, 900000);

  it("and the row cost slope with −P/2, which is 86% of it", () => {
    // One power against two, so half the prefactor survives the subtraction.
    // That is § 6ca.4's "small number produced by two large ones", except the
    // two large ones are the same four integers and only one branch keeps them.
    const s = at(Q6BO, 64, 4);
    expect(rel(s.stageRows - s.fieldRows, -0.31122450)).toBeLessThan(1e-7);
    expect(rel(-s.P / 2 + s.SsR - s.SfR, s.stageRows - s.fieldRows)).toBeLessThan(0.004);
    expect(rel(-s.P / 2 / (s.stageRows - s.fieldRows), 0.8631)).toBeLessThan(1e-3);
    for (const [j, cx] of IN_DOMAIN) {
      const t = at(Q6BO, j, cx);
      const share = -t.P / 2 / (t.stageRows - t.fieldRows);
      expect(share).toBeGreaterThan(0.74);
      expect(share).toBeLessThan(0.87);
    }
    // The same on the other factorial, at its own bigger floor.
    const q = at(STEP_4_10, 64, 4);
    expect(rel(-q.P / 2 + q.SsR - q.SfR, q.stageRows - q.fieldRows)).toBeLessThan(0.005);
    expect(rel(q.stageCols - q.fieldCols, q.SsC - q.SfC)).toBeLessThan(0.01);
  }, 900000);
});

describe("§ 6cp.4 — the stage form's edge is the ROW branch's alone", () => {
  it("walks w through 1 and breaks one split and not the other", () => {
    // § 6cd.1: at w = 1 the row seam's probe pair lands ON the axis, where the
    // corner form's `Q` vanishes; the column seam's does not. The field form
    // has no edge in `w` at all (§ 6ci.3), so this is the one place the two
    // geometries part company rather than differ by a power.
    const walked = LADDER.map(([j, cx]) => {
      const s = at(Q6BO, j, cx);
      return {
        w: s.w,
        rows: (s.P / 2 + s.SsR) / s.stageRows - 1,
        cols: (s.P + s.SsC) / s.stageCols - 1,
      };
    });
    // Sorted by w, and the ladder is two offsets — cx = 4 at j = 128 and cx = 2
    // at j = 64 are the same tile, which is § 6ce.1's collapse used as a check.
    for (let i = 1; i < walked.length; i++) expect(walked[i]!.w).toBeGreaterThan(walked[i - 1]!.w);
    const inDomain = walked.filter((p) => p.w < 1);
    const past = walked.filter((p) => p.w > 1.15);
    expect(inDomain.length).toBe(5);
    // In domain both halves are small; past the edge only the column half is.
    expect(Math.max(...inDomain.map((p) => Math.abs(p.rows)))).toBeLessThan(0.014);
    expect(Math.max(...walked.map((p) => Math.abs(p.cols)))).toBeLessThan(0.011);
    expect(Math.min(...past.map((p) => Math.abs(p.rows)))).toBeGreaterThan(0.09);
    expect(Math.max(...past.map((p) => Math.abs(p.rows)))).toBeGreaterThan(0.9);
    // The column half is monotone in w at each offset, which is what a form
    // still doing its job looks like. It is not monotone ACROSS the two, and
    // that is the same cx² the cost residual carries (§ 6cp.3): the ladder
    // steps from 4 mm to 2 mm at w = 0.86 → 1.03 and the miss drops with it.
    for (const off of [4, 2] as const) {
      const arm = LADDER.filter(([, cx]) => cx === off).map(([j, cx]) => at(Q6BO, j, cx))
        .map((t) => (t.P + t.SsC) / t.stageCols - 1);
      for (let i = 1; i < arm.length; i++) expect(arm[i]!).toBeGreaterThan(arm[i - 1]!);
    }
    const stepDown = walked.find((p) => p.w > 1 && p.w < 1.1)!;
    const before = walked.find((p) => p.w > 0.8 && p.w < 0.9)!;
    expect(stepDown.cols).toBeLessThan(before.cols);
  }, 1800000);

  it("locates § 6ca.1's own published pair outside the domain", () => {
    // j = 128 at cx = 2 mm is the anchor § 6ca.1 read 0.2637 and 0.6132 at, and
    // it is w = 1.3692 — which is § 6ca's own quoted "ratio 1.871" divided by
    // § 6cf.5's 1.36642 unit correction, to five figures. So that reading is
    // past § 6cd.1's edge, and it is the row half that pays.
    const s = at(Q6BO, 128, 2);
    expect(rel(s.w, 1.3692233)).toBeLessThan(1e-6);
    expect(rel(1.871 / 1.36642, s.w)).toBeLessThan(4e-4);
    expect(rel(s.stageRows, 0.2636662)).toBeLessThan(1e-6);
    expect(rel(s.stageCols, 0.6132130)).toBeLessThan(1e-6);
    // The column split is still doing its job here; the row split is a quarter
    // out, one-signed, and the axis constant it feeds is 2.33 against the
    // 1.73…1.95 the same four cells read in domain.
    expect(rel(s.P + s.SsC, s.stageCols)).toBeLessThan(0.006);
    expect((s.P / 2 + s.SsR) / s.stageRows - 1).toBeLessThan(-0.24);
    expect(rel(s.stageCols / s.stageRows, 2.3257)).toBeLessThan(1e-4);
  }, 900000);
});

describe("§ 6cp.5 — balance the share and both stage branches go", () => {
  it("falls by twelve thousand when the guard is held in pixels", () => {
    // The matched field is untouched: same four lenses, same four samplings.
    // Only the guard changes, from a count of cells to a count of pixels, and
    // the prefactor is then exactly zero by construction.
    for (const cx of [4, 2] as const) {
      const b = at(Q6BO, 64, cx, true);
      const u = at(Q6BO, 64, cx);
      expect(Math.abs(b.P)).toBeLessThan(1e-13);
      expect(Math.abs(b.SsR)).toBeLessThan(1e-6);
      expect(Math.abs(b.SsC)).toBeLessThan(1e-6);
      expect(Math.abs(u.stageRows / b.stageRows)).toBeGreaterThan(9000);
      expect(Math.abs(u.stageCols / b.stageCols)).toBeGreaterThan(9000);
      // And the cost's own two branches, which is § 6ca's whole separation.
      expect(Math.abs(b.stageRows - b.fieldRows)).toBeLessThan(2e-4);
      expect(Math.abs(b.stageCols - b.fieldCols)).toBeLessThan(2e-4);
      // Every tile really does keep the same guard, in pixels.
      const px = b.ends.map((p) => p[1]!.st.guardPixels);
      expect(new Set(px).size).toBe(1);
      expect(px[0]).toBe((Q6BO.cells[0]![2] * 64) / 16 === 128 ? 1048576 : px[0]);
    }
    const b4 = at(Q6BO, 64, 4, true);
    expect(rel(b4.stageRows, -2.48342e-5)).toBeLessThan(1e-4);
    expect(rel(b4.stageCols, -4.60014e-5)).toBeLessThan(1e-4);
    expect(rel(at(Q6BO, 64, 4).stageRows / b4.stageRows, -12657)).toBeLessThan(1e-3);
    expect(rel(at(Q6BO, 64, 4).stageCols / b4.stageCols, -11806)).toBeLessThan(1e-3);
  }, 1800000);

  it("but charges a different physical guard to every cell to do it", () => {
    // § 6cl.4's argument, and it did not depend on which seam was being read: a
    // guard is a count of resolution cells because the wrap it has to contain
    // is measured in them (§ 6bh.4). Equal pixels is four different guards.
    const design = at(Q6BO, 64, 4).ends.map((p) => p[1]!.st.guardCells);
    const balanced = at(Q6BO, 64, 4, true).ends.map((p) => p[1]!.st.guardCells);
    expect(new Set(design).size).toBe(1);
    expect(Math.max(...balanced) / Math.min(...balanced)).toBeCloseTo(4, 12);
  }, 1800000);
});
