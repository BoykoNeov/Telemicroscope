import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
  type MosaicSeamShift,
} from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6by — the jump is a handover between two branches of one max.
 *
 * § 6bx.8 measured the cost threshold JUMPING UP at 2 mm and at 3 mm once the
 * tile half extent passes about 1.8 times the field offset, bracketed the onset
 * at both offsets, and offered **no mechanism**: "which of the four cells or
 * which probe supplies the jump is unmeasured, and so is whether the ratio 1.8
 * is the same 0.5115 of § 6bw.7 seen in another guise."
 *
 * It is neither a cell nor a probe. `mosaicSeamShiftMm` reports `mm` as the MAX
 * over two axes — the worst seam between two COLUMNS and the worst between two
 * ROWS — and those are different quantities off the axis, which is the whole of
 * § 6bj.5. Read on either axis ALONE the cost is smooth and its threshold is
 * smooth. The two axes are equal exactly where § 6bw's own anisotropy readout
 * `betweenRowsMm / betweenColumnsMm` passes through 1, and there the max hands
 * over from one branch to the other. § 6bx.8's jump is that handover.
 *
 * ## Why this does not contradict § 6bx.2
 *
 * § 6bx.2 licensed the bisection by walking consecutive lattice steps and
 * finding zero breaks in strict decrease. The kink it feared is real and is
 * exactly the handover: the crossing locus moves with the GUARD as well as with
 * the anchor (§ 6by.3), so a bisection in the handover zone must pass through
 * it. What § 6bx.2 measured is monotonicity, not smoothness, and monotonicity
 * is what a bisection needs — walked across the whole legal range the cost
 * changes sign exactly once (§ 6by.0). A kink that does not break the ordering
 * costs a bisection nothing.
 *
 * ## What it explains, and what it corrects
 *
 * - § 6bx.3's monotone fall at 4 mm is the ROW branch's own law. At 4 mm the
 *   anisotropy never reaches 1 in the reachable field — 2.13 at k = 8 and still
 *   1.20 at k = 13.25, the last anchor before § 6bu.7's chief-ray refusal — so
 *   the row branch owns the readout everywhere and nothing hands over (§ 6by.5).
 * - § 6bx.1's "every bit of the cost's probe dependence lives in the field
 *   factor" is true where the stage worst sits on a CORNER, which is what
 *   § 6bw.4 measured and what its own test pins at k = 4. Where the worst moves
 *   to an interior along-seam probe the stage factor moves with the probe count
 *   too — below the handover at 2 mm, and at the top of the 4 mm range as well
 *   (§ 6by.6). That is also the mechanism § 6bx.5 recorded without one: "k = 13
 *   is where the probe sensitivity is worst, 1064 against ~320 elsewhere".
 * - § 6bx.8 read the two offsets' agreement at a ratio of 1.871 as evidence of
 *   a shared ratio. The crossing locus moves with the guard, so there is no
 *   constant to share (§ 6by.3): the two offsets agree because their threshold
 *   curves meet a moving locus at similar places. And it is not § 6bw.7's
 *   0.5115 in another guise (§ 6by.7).
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6bx used it: no render, so no focus stage. */
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

/**
 * Which of the two axes a reading is taken on. `"max"` is what `mm` reports and
 * what § 6bu…§ 6bx read; the other two are the branches under it.
 */
type Branch = "max" | "rows" | "columns";
const read = (s: MosaicSeamShift, b: Branch): number =>
  b === "max" ? s.mm : b === "rows" ? s.betweenRowsMm : s.betweenColumnsMm;

/** § 6bx's `costI`, with the branch as a parameter. `"max"` IS § 6bx's cost. */
const costOn = (b: Branch, j: number, i: number, probes: number, x: number): number =>
  inter4(
    CELLS.map(
      (c) =>
        read(shiftAt(c, j, i, probes, x, "stage"), b) / read(shiftAt(c, j, i, probes, x, "field"), b),
    ),
  );

/** § 6bx.1's stage factor, likewise. */
const stageOn = (b: Branch, j: number, i: number, probes: number, x: number): number =>
  inter4(CELLS.map((c) => read(shiftAt(c, j, i, probes, x, "stage"), b)));

/** § 6bw's own anisotropy readout, per cell: rows over columns on a stage scan. */
const aniso = (c: Cell, j: number, i: number, probes: number, x: number): number => {
  const st = shiftAt(c, j, i, probes, x, "stage");
  return st.betweenRowsMm / st.betweenColumnsMm;
};

/** The tile half extent over the field offset — § 6bw.7's variable, and
 *  § 6bx.8's, both read on the slow 20× and so both in the same frame. */
const ratioOfHalf = (j: number, x: number): number =>
  objectFieldTile(LENS.s20, {
    size: BIG,
    pupilSamples: PS_AT("s20", j),
    wavelengthNm: DESIGN,
    centreMm: { x, y: 0 },
  }).halfExtentMm / x;

/** `i` is the threshold on branch `b`: at it the cost still exceeds 1, at
 *  `i + 1` it does not. Both halves are re-measured, never remembered. */
const locatedOn = (b: Branch, j: number, i: number, x: number, probes = 65): void => {
  expect(costOn(b, j, i, probes, x)).toBeGreaterThan(1);
  expect(costOn(b, j, i + 1, probes, x)).toBeLessThan(1);
};

/** The guard lattice § 6bx.8 read the 2 mm onset at. */
const I_ONSET = 490080;

describe("§ 6by.0 — the gate: one crossing, so the jump is the threshold's", () => {
  it("changes sign exactly once across the whole legal range, on both sides", () => {
    // Under § 6by's own mechanism a bisection in the handover zone MUST cross a
    // kink, so before anything is explained the bisection has to be shown to be
    // finding THE threshold and not one of several. Both ends of the bracket are
    // asserted too: a bisection whose crossing has left [1, 8e6] returns an
    // endpoint silently, and § 6bx.8's own 3 mm reading climbs to 1256455.
    for (const j of [124, 128] as const) {
      expect(costOn("max", j, 1, 65, 2)).toBeGreaterThan(1);
      expect(costOn("max", j, 7999999, 65, 2)).toBeLessThan(1);
    }
    // Walked coarsely over that whole range the value falls at every step and
    // changes sign once. § 6by's probes ran 88 log-spaced points at j = 120, 124
    // and 128 at 2 mm and at 4 mm: one crossing each, zero non-decreasing steps.
    let previous = Infinity;
    let crossings = 0;
    for (let e = 0; e <= 21; e += 3) {
      const v = costOn("max", 128, 2 ** e, 65, 2);
      if (previous !== Infinity && previous > 1 !== v > 1) crossings++;
      expect(v).toBeLessThan(previous);
      previous = v;
    }
    expect(crossings).toBe(1);
  });
});

describe("§ 6by.1 — two smooth branches, about 2% apart, and the max hands over", () => {
  it("is flat on rows, smooth on columns, and neither during the handover", () => {
    const rows: number[] = [];
    const columns: number[] = [];
    for (const j of [114, 122, 124, 126, 140] as const) {
      rows.push(stageOn("rows", j, I_ONSET, 65, 2));
      columns.push(stageOn("columns", j, I_ONSET, 65, 2));
    }
    // The row branch barely moves across the whole span — its spread is 0.085%,
    // and that INCLUDES the j = 140 outlier rather than setting it aside.
    const spread = Math.max(...rows) / Math.min(...rows) - 1;
    expect(spread).toBeLessThan(9e-4);
    // The column branch rises smoothly and monotonically, and sits ~2% above.
    for (let n = 1; n < columns.length; n++) expect(columns[n]!).toBeGreaterThan(columns[n - 1]!);
    const gap = columns[0]! / rows[0]! - 1;
    expect(gap).toBeCloseTo(0.0198, 4);
    // 23x: the branches are far enough apart that which one is read matters far
    // more than where on either one it is read. That is the whole mechanism.
    expect(gap / spread).toBeGreaterThan(23);
  });

  it("reads the row branch below the handover and the column branch above it", () => {
    // Below: the max IS the row interact, bit for bit.
    expect(stageOn("max", 122, I_ONSET, 65, 2)).toBe(stageOn("rows", 122, I_ONSET, 65, 2));
    // Above: it is the column interact, bit for bit.
    expect(stageOn("max", 126, I_ONSET, 65, 2)).toBe(stageOn("columns", 126, I_ONSET, 65, 2));
    // And in between it is NEITHER — not a blend of the two either. The reading
    // is the interact of the per-cell maxes, and an interact is a ratio of
    // ratios: raising one cell's denominator LOWERS it, so the handover value
    // can and does fall outside the interval the two branches span.
    const mid = stageOn("max", 124, I_ONSET, 65, 2);
    expect(mid).not.toBe(stageOn("rows", 124, I_ONSET, 65, 2));
    expect(mid).not.toBe(stageOn("columns", 124, I_ONSET, 65, 2));
  });
});

describe("§ 6by.2 — the handover is where the anisotropy passes through one", () => {
  it("switches which axis the max reads exactly at the crossing, cell by cell", () => {
    for (const [c, before, after] of [
      ["s10", 122, 124],
      ["f10", 122, 124],
      ["f20", 124, 125],
      ["s20", 125, 126],
    ] as const) {
      // § 6bw's readout is above 1 at the anchor below and below 1 at the one
      // above, so the two axes are equal somewhere between them...
      expect(aniso(c, before, I_ONSET, 65, 2)).toBeGreaterThan(1);
      expect(aniso(c, after, I_ONSET, 65, 2)).toBeLessThan(1);
      // ...and that is precisely where `mm` stops reading rows and starts
      // reading columns. The max is the same number either side of it, which is
      // why nothing here is a discontinuity in a cell.
      const lo = shiftAt(c, before, I_ONSET, 65, 2, "stage");
      const hi = shiftAt(c, after, I_ONSET, 65, 2, "stage");
      expect(lo.mm).toBe(lo.betweenRowsMm);
      expect(hi.mm).toBe(hi.betweenColumnsMm);
    }
  });

  it("and the four cells cross at four different anchors, which is why it shows", () => {
    // A crossing cancels out of the interact when the two cells of a pair cross
    // together and does not when they cross apart. The 10x pair crosses inside
    // one grid step of itself, and the interact barely moves; the 20x pair is
    // two steps apart, and the interact carries the whole 2%.
    expect(aniso("s10", 122, I_ONSET, 65, 2)).toBeCloseTo(aniso("f10", 122, I_ONSET, 65, 2), 3);
    expect(Math.abs(aniso("s20", 122, I_ONSET, 65, 2) / aniso("f20", 122, I_ONSET, 65, 2) - 1)).
      toBeGreaterThan(0.015);
  });
});

describe("§ 6by.3 — the crossing locus moves with the guard, so 1.8 is not a constant", () => {
  it("sits at a higher anchor the larger the guard is read at", () => {
    // s20's crossing, bracketed on the anchor lattice at three guards an order
    // of magnitude apart. The locus is a curve in (anchor, guard) and the
    // threshold chases it, which is why the located value climbs rather than
    // stepping to the column branch outright.
    for (const [i, before, after] of [
      [100000, 120, 121],
      [I_ONSET, 125, 126],
      [716088, 129, 130],
    ] as const) {
      expect(aniso("s20", before, i, 65, 2)).toBeGreaterThan(1);
      expect(aniso("s20", after, i, 65, 2)).toBeLessThan(1);
    }
    // In § 6bx.8's own variable that is a ratio of 1.754 at the small guard and
    // 1.886 at the large one — a 7.5% spread in the very number § 6bx.8 read as
    // shared between two offsets. What the two offsets share is not a constant
    // of the geometry; it is where two similar threshold curves meet a moving
    // locus. § 6bx.8's measurements stand; its reading of them does not.
    expect(ratioOfHalf(120, 2)).toBeCloseTo(1.754, 3);
    expect(ratioOfHalf(129, 2)).toBeCloseTo(1.8856, 4);
    // Far enough out and there is no crossing at all inside the reachable field.
    expect(aniso("s20", 136, 2000000, 65, 2)).toBeGreaterThan(1.18);
  });
});

describe("§ 6by.4 — each branch's threshold is smooth; the jump is the handover", () => {
  it("moves 1.6% on the row branch where the max reading moves 132.8%", () => {
    // The row branch's own threshold, located on the same 2^-24 lattice: it goes
    // on drifting gently through the whole zone in which the max reading jumps.
    const ROWS: Record<number, number> = { 116: 486643, 120: 485678, 124: 483418, 128: 479700, 132: 478948 };
    for (const j of [116, 120, 124, 128, 132] as const) locatedOn("rows", j, ROWS[j]!, 2);
    const rowSpan = Math.max(...Object.values(ROWS)) / Math.min(...Object.values(ROWS)) - 1;
    expect(rowSpan).toBeLessThan(0.017);
    // The column branch's threshold is a different curve entirely — three times
    // higher, and rising where the row branch falls.
    locatedOn("columns", 116, 1428323, 2);
    locatedOn("columns", 136, 1498204, 2);
    expect(1428323 / ROWS[116]!).toBeGreaterThan(2.9);
    expect(1498204).toBeGreaterThan(1428323);
    // And the max reading, which is what § 6bx.8 bisected: it tracks the row
    // branch until the handover starts and then climbs away from it, 132.8%
    // over the same anchors on which the row branch moved 1.6%.
    locatedOn("max", 116, 486643, 2);
    locatedOn("max", 120, 485678, 2);
    locatedOn("max", 124, I_ONSET, 2);
    locatedOn("max", 136, 1133020, 2);
    expect(486643).toBe(ROWS[116]!);
    expect(1133020 / 486643 - 1).toBeCloseTo(1.3282, 4);
    // It does not arrive at the column branch either: it is still below it at
    // the last anchor, because the locus it is chasing moves with it (§ 6by.3).
    expect(1133020).toBeLessThan(1498204);
  });
});

describe("§ 6by.5 — at 4 mm nothing hands over, and that is § 6bx.3's window", () => {
  it("keeps the anisotropy above one at every anchor the design reaches", () => {
    // § 6bu.7's chief-ray refusal stops 4 mm at k = 13.25. The anisotropy is
    // still 1.2 there and falling far too slowly to reach 1 — so the row branch
    // owns the readout over the whole reachable range and § 6bx.3's monotone
    // fall is that branch's own law, not a property of "the cost".
    for (const j of [128, 192, 208, 212] as const) {
      for (const c of CELLS) expect(aniso(c, j, I_ONSET, 65, 4)).toBeGreaterThan(1.19);
    }
    expect(aniso("s10", 128, I_ONSET, 65, 4)).toBeGreaterThan(2);
    expect(ratioOfHalf(212, 4)).toBeCloseTo(1.55, 2);
    // At the LAST anchor the design reaches, the located threshold is still the
    // row branch's, bit for bit — which is where this explanation was thinnest.
    locatedOn("max", 212, 515374, 4);
    locatedOn("rows", 212, 515374, 4);
    for (const c of CELLS) {
      const st = shiftAt(c, 212, 515374, 65, 4, "stage");
      expect(st.mm).toBe(st.betweenRowsMm);
    }
    // 5 mm is further still from a handover: 3.79 at the top of its own range.
    expect(aniso("s20", 80, I_ONSET, 65, 5)).toBeGreaterThan(3.7);
  });
});

describe("§ 6by.6 — the stage factor is exact where its worst sits on a corner", () => {
  it("is bit-identical at a corner and moves with the probe count away from one", () => {
    // § 6bw.4's argument is about WHERE the worst sits, not about which scan it
    // came from: `along(0) = 0` puts an along-seam coordinate of 0 on every
    // probe grid there is. At 4 mm, k = 12, all four worsts sit at (0, pitch)...
    for (const c of CELLS) expect(shiftAt(c, 192, I_ONSET, 65, 4, "stage").atPx.x).toBe(0);
    expect(stageOn("max", 192, I_ONSET, 17, 4)).toBe(stageOn("max", 192, I_ONSET, 65, 4));
    // ...and at k = 13.25 they have moved to an interior along-seam probe, where
    // the stage factor is no longer probe-exact. So § 6bx.1's "every bit of the
    // cost's probe dependence lives in the field factor" is a statement about
    // the corner, not about the stage scan — and this is the mechanism § 6bx.5
    // recorded without one: "k = 13 is where the probe sensitivity is worst".
    expect(CELLS.some((c) => shiftAt(c, 212, I_ONSET, 65, 4, "stage").atPx.x !== 0)).toBe(true);
    expect(stageOn("max", 212, I_ONSET, 17, 4)).not.toBe(stageOn("max", 212, I_ONSET, 65, 4));
    // The same at 2 mm, and it is the handover that moves the worst onto the
    // corner: below it the worst is interior and the factor moves with probes,
    // above it the column branch's worst is the corner (pitch, 0) and it does
    // not. § 6bx.1's own test pins k = 4 at 4 mm, which is a corner, so nothing
    // it asserts is disturbed.
    expect(stageOn("max", 124, I_ONSET, 17, 2)).not.toBe(stageOn("max", 124, I_ONSET, 65, 2));
    for (const c of CELLS) expect(shiftAt(c, 126, I_ONSET, 65, 2, "stage").atPx.y).toBe(0);
    expect(stageOn("max", 126, I_ONSET, 17, 2)).toBe(stageOn("max", 126, I_ONSET, 65, 2));
    expect(stageOn("max", 130, I_ONSET, 17, 2)).toBe(stageOn("max", 130, I_ONSET, 65, 2));
  });
});

describe("§ 6by.7 — and it is not § 6bw.7's 0.5115 in another guise", () => {
  it("refuses the identification in the frame both numbers are read in", () => {
    // Both are the slow 20x's half extent over the field offset. § 6bw's law
    // probe built it as § 6bw.2's own 0.46769328761900353·k and § 6bx.8 traces
    // it at the offset instead, which is NOT the same number — the half extent
    // creeps with the field position, by 0.009% at 2 mm and 0.035% at 4 mm. It
    // is the same frame to better than 0.06% either way, and everything below is
    // compared against a 7.5% spread, so the comparison is legitimate.
    for (const [x, rel] of [
      [2, 8.9e-5],
      [4, 3.6e-4],
    ] as const) {
      expect((ratioOfHalf(16, x) * x) / 0.46769328761900353 - 1).toBeLessThan(rel);
    }
    // The naive inverse is refused outright: 1/0.5115 = 1.955 lies above both of
    // § 6bx.8's onset brackets, (1.754, 1.812) at 2 mm and (1.793, 1.871) at
    // 3 mm.
    expect(1 / 0.5115).toBeGreaterThan(1.871);
    // But the refusal that settles it is § 6by.3's: the onset is not a number at
    // all. 0.5115 is where the anisotropy THRESHOLD turns; this is where the
    // anisotropy VALUE passes 1, on a locus that moves with the guard. They are
    // features of different order, and there is nothing here to identify.
    expect(ratioOfHalf(129, 2) / ratioOfHalf(120, 2) - 1).toBeGreaterThan(0.07);
  });
});
