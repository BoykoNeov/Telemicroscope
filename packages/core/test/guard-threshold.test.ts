import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6bv — § 6bu's threshold, located; and it is not a share.
 *
 * § 6bu left the threshold bracketed and not located: "the cost crosses 1
 * between kept shares of about 0.90 and 0.94 at every anchor measured, and the
 * anisotropy inverts a little below that; neither is pinned to better than one
 * guard cell, and whether the threshold drifts with the anchor in some regular
 * way is unmeasured." This step pins all three clauses, and two of them come
 * out otherwise.
 *
 * ## The resolution is a quarter cell, and nothing finer exists
 *
 * `mosaicGuardPixels` refuses a guard that is not a whole number of pixels
 * rather than rounding it — `latticeMatchedSource`'s argument, that a rounded
 * guard is a plausible mosaic whose seam error is not the one asked for. Three
 * of the four cells carry four pixels per resolution cell, so a quarter cell is
 * the finest legal step, and § 6bs.7's ladder holds `size / pupilSamples`, so it
 * is the finest step at EVERY rung. What the rung changes is what a quarter cell
 * is worth in the doc's ruler: the slow 20x's kept share moves `0.03125 / k`,
 * which is 3.1% at the first rung and 0.39% at the last. The threshold is
 * therefore locatable to one quarter cell and no better, and that is a property
 * of the guard's arithmetic, not of how hard this step looked.
 *
 * ## It drifts, and § 6bu's band is wrong at the first rung
 *
 * Bracketed at all four anchors (§ 6bv.2), the cost's crossing sits at kept
 * shares (0.859375, 0.890625], (0.882813, 0.898438], (0.902344, 0.910156] and
 * (0.919922, 0.923828]. The first and the third are disjoint, and so are the
 * third and the fourth: the drift is larger than the resolution and is not an
 * artifact of it. § 6bu's "about 0.90 and 0.94 at every anchor" holds at the top
 * two rungs and fails at the first, where the crossing is below 0.891 — § 6bu
 * had a two-sided bracket at one anchor only and generalised it to four.
 *
 * The drift needs no interpolation to see. At the first rung a guard of 0.75
 * cells keeps 0.890625 of the tile and reads 1.00622, above 1; at the last rung
 * § 6bu.3's own six cells keep MORE of the tile, 0.904297, and read 0.992704,
 * below it. A higher kept share is the direction that pushes the cost up, and it
 * is the reading that came out lower. One ruler, two anchors, opposite verdicts.
 *
 * ## Which refuses both of § 6bu's ladders
 *
 * The threshold's own guard grows from (0.75, 1] cells to (4.75, 5] over the
 * same 8x of anchor — a factor measured to lie in [4.75, 6.67]. Holding the
 * kept share would demand exactly 8x and holding the pixel count exactly 1x, and
 * the measured interval contains neither. § 6bu showed its two candidate ladders
 * disagree about the SIGN of the anchor's effect; the threshold locus is a third
 * ladder lying between them, nearer the held-share one.
 *
 * ## The two thresholds separate as the anchor grows
 *
 * § 6bu.4 put them "3.1% of kept share apart". That number is the spacing of the
 * two guards it happened to read, not the separation of the thresholds, which is
 * measured here at that same anchor as 0.78% to 2.34%. And the separation is not
 * a constant: at the first rung both crossings fall in ONE quarter cell and this
 * ladder cannot separate them at all, while at the last they are at least three
 * quarter cells apart. § 6bu.4's "two nearby but distinct thresholds" is right
 * about the top rungs and has no content at the bottom one.
 *
 * ## Why the failure lands where it does
 *
 * § 6bh.4 floors the guard at four cells, and the threshold crosses that floor
 * between the third rung (2.75 to 3 cells) and the fourth (4.75 to 5). So at the
 * first three rungs § 6bs.7's verdicts could only be failed by a guard below the
 * floor — a mosaic nobody could build — and the fourth is the first rung where a
 * buildable guard of four already sits on the failing side. That is the whole of
 * why 3.7415 mm is where both verdicts went, and it is the same statement as
 * § 6bu.3's from the threshold's side.
 *
 * ## Four anchors, for a second reason
 *
 * § 6bu.7 refused a fifth rung by the chief ray. There are no rungs BETWEEN the
 * four either: the frame must be a power of two, so `k` 3, 5, 6 and 7 are all
 * refused before any ray is traced, and the crossings above are bracketed by the
 * only anchors this family has.
 *
 * Every threshold below the branch's four cells is a geometry-only reading in
 * § 6bu.3's sense — `mosaicSeamShiftMm` renders nothing, so the number exists,
 * but the mosaic it describes would not contain a PSF wrap. Only the fourth
 * rung's threshold sits at a guard that could actually be built.
 */

const DESIGN = 587.5618;
const AXIS = { x: 0, y: 0 };
const ANCHOR = 4;
const EDGE = { x: ANCHOR, y: 0 };
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device, as § 6bu used it: no render, so no focus stage can enter. */
const FREE_STAGE: TileStageMm = () => 0;

/** § 6bu's options exactly, with the guard left open. */
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
    centreMm: EDGE,
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

const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};

const BRANCH_SHAPE: readonly [number, number] = [128, 32];
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

interface Cost {
  readonly ratio: number;
  readonly aniso: number;
}

function measure(system: OpticalSystem, size: number, ps: number, guardCells: number): Cost {
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { guardCells }));
  const scan = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { guardCells, scan: "stage" }));
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
}

/** One memo for the file: a bracket shares quartets with the rung beside it. */
const held = new Map<string, Cost>();
function cell(c: Cell, size: number, ps: number, guardCells = 4): Cost {
  const key = `${c}|${size}|${ps}|${guardCells}`;
  let v = held.get(key);
  if (v === undefined) {
    v = measure(LENS[c], size, ps, guardCells);
    held.set(key, v);
  }
  return v;
}

const quartet = (k: number, guardCells = 4): Record<Cell, Cost> =>
  Object.fromEntries(
    CELLS.map((c) => [c, cell(c, Q6BO[c][0] * k, Q6BO[c][1] * k, guardCells)]),
  ) as Record<Cell, Cost>;

const branchQuartet = (): Record<Cell, Cost> =>
  Object.fromEntries(CELLS.map((c) => [c, cell(c, BRANCH_SHAPE[0], BRANCH_SHAPE[1])])) as Record<
    Cell,
    Cost
  >;

const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
const departure = (x: number): number => (x < 1 ? 1 / x : x);

const costI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.ratio, q.f10.ratio, q.s20.ratio, q.f20.ratio);
const anisoI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.aniso, q.f10.aniso, q.s20.aniso, q.f20.aniso);
const anisoGrowth = (q: Record<Cell, Cost>): number =>
  (departure(anisoI(q)) - 1) / (departure(anisoI(branchQuartet())) - 1);

const anchorOf = (k: number): number =>
  objectFieldTile(LENS.s20, {
    size: Q6BO.s20[0] * k,
    pupilSamples: Q6BO.s20[1] * k,
    wavelengthNm: DESIGN,
    centreMm: AXIS,
  }).halfExtentMm;

const keptShare = (c: Cell, k: number, guardCells: number): number => {
  const g = fluorescenceMosaicGeometry(
    LENS[c],
    mosaicOptions(Q6BO[c][0] * k, Q6BO[c][1] * k, { guardCells }),
  );
  return g.keptPixels / g.tileSize;
};

/** The slow 20x's kept share in closed form — `kept = size − 2·cropped −
 *  2·guardCells·p` with `size` 128k, `p` 8 px per cell and `cropped` 1. This is
 *  the ruler § 6bu's bracket is quoted in, and § 6bv.1 pins it against the
 *  geometry rather than converting guards to shares by hand. */
const shareClosed = (k: number, guardCells: number): number =>
  1 - guardCells / (8 * k) - 1 / (64 * k);

const KS = [1, 2, 4, 8] as const;

/** The quarter-cell window that brackets both crossings at each anchor. */
const WINDOW: Record<number, readonly number[]> = {
  1: [0.5, 0.75, 1, 1.25],
  2: [1.25, 1.5, 1.75, 2],
  4: [2.75, 3, 3.25, 3.5],
  8: [4.75, 5, 5.25, 5.5, 5.75, 6],
};

/** Largest guard in the window whose cost is still above 1, and the next one. */
const COST_BRACKET: Record<number, readonly [number, number]> = {
  1: [0.75, 1],
  2: [1.5, 1.75],
  4: [2.75, 3],
  8: [4.75, 5],
};

/** The same for the anisotropy, whose interaction falls THROUGH the branch's. */
const ANISO_BRACKET: Record<number, readonly [number, number]> = {
  1: [0.75, 1],
  2: [1.5, 1.75],
  4: [3.25, 3.5],
  8: [5.75, 6],
};

/** The branch's own anisotropy interaction — § 6bo's denominator, read from
 *  source. `anisoGrowth` divides by a constant built from it, so growth = 1 is
 *  exactly `anisoI(q) === this`, which is what ANISO_BRACKET straddles. */
const BRANCH_ANISO = 0.9772598554705617;

describe("§ 6bv.1 — a quarter cell is the finest guard that exists, at every rung", () => {
  it("an eighth of a cell is refused rather than rounded, and the message names the knob", () => {
    expect(() => quartet(8, 0.125)).toThrow(
      /a guard of 0\.125 cells is 0\.5 pixels at size 1024 and pupilSamples 256/,
    );
    expect(() => quartet(8, 0.125)).toThrow(/rather than having it rounded/);
    // And a quarter cell is legal at every rung, because the ladder holds
    // `size / pupilSamples`: 4 px per cell on three of the four, 8 on the slow
    // 20x, so a quarter cell is 1 px and 2 px at k = 1 and at k = 8 alike.
    for (const k of KS) expect(() => quartet(k, 0.25)).not.toThrow();
  });

  it("so the ruler's resolution is 0.03125 / k — 3.1% at the first rung, 0.39% at the last", () => {
    for (const k of KS) {
      const step = keptShare("s20", k, 1) - keptShare("s20", k, 1.25);
      expect(step).toBeCloseTo(0.03125 / k, 12);
    }
    expect(0.03125 / 8).toBeCloseTo(0.00390625, 15);
  });

  it("and the closed form for that ruler agrees with the geometry, guard by guard", () => {
    for (const k of KS) {
      for (const g of WINDOW[k]!) {
        expect(keptShare("s20", k, g)).toBeCloseTo(shareClosed(k, g), 15);
      }
    }
    // The two published corners of § 6bu's own table, from the same form.
    expect(shareClosed(1, 4)).toBeCloseTo(0.484375, 15);
    expect(shareClosed(8, 4)).toBeCloseTo(0.935546875, 15);
  });
});

describe("§ 6bv.2 — both crossings bracketed to one quarter cell, at all four anchors", () => {
  it("both readouts are strictly monotone across every window, so a bracket IS the crossing", () => {
    // Asserted for the anisotropy as well as the cost: without it a straddling
    // pair is only a sign change, and the claim these brackets make is that the
    // crossing is single and inside. Both windows contain both brackets.
    for (const k of KS) {
      const window = WINDOW[k]!;
      const costs = window.map((g) => costI(quartet(k, g)));
      const anisos = window.map((g) => anisoI(quartet(k, g)));
      for (let i = 1; i < window.length; i++) {
        expect(costs[i]!).toBeLessThan(costs[i - 1]!);
        expect(anisos[i]!).toBeLessThan(anisos[i - 1]!);
      }
      for (const bracket of [COST_BRACKET[k]!, ANISO_BRACKET[k]!]) {
        for (const g of bracket) expect(window).toContain(g);
      }
    }
  });

  it("the cost's bracket: (0.75, 1], (1.5, 1.75], (2.75, 3] and (4.75, 5] cells", () => {
    // Above at the low guard, below at the next quarter cell. Full precision at
    // each of the eight readings, so the bracket is a measurement and not a sign.
    expect(costI(quartet(1, 0.75))).toBeCloseTo(1.006220877411483, 12);
    expect(costI(quartet(1, 1))).toBeCloseTo(0.9956763820166348, 12);
    expect(costI(quartet(2, 1.5))).toBeCloseTo(1.0013708813353621, 12);
    expect(costI(quartet(2, 1.75))).toBeCloseTo(0.9961102506775426, 12);
    expect(costI(quartet(4, 2.75))).toBeCloseTo(1.0004173126357376, 12);
    expect(costI(quartet(4, 3))).toBeCloseTo(0.9976792616666094, 12);
    expect(costI(quartet(8, 4.75))).toBeCloseTo(1.0003687577092277, 12);
    expect(costI(quartet(8, 5))).toBeCloseTo(0.9988566541119908, 12);
    for (const k of KS) {
      const [lo, hi] = COST_BRACKET[k]!;
      expect(costI(quartet(k, lo))).toBeGreaterThan(1);
      expect(costI(quartet(k, hi))).toBeLessThan(1);
      expect(hi - lo).toBeCloseTo(0.25, 15);
    }
  });

  it("and the anisotropy's, which is the guard where it meets the BRANCH's own", () => {
    // `anisoGrowth` divides the quartet's departure from 1 by the branch's, a
    // constant, and every reading here is below 1 — so growth = 1 is exactly
    // `anisoI === BRANCH_ANISO`, and the crossing can be stated against a fixed
    // measured number instead of against a derived ratio.
    expect(anisoI(branchQuartet())).toBeCloseTo(BRANCH_ANISO, 15);
    for (const k of KS) {
      const [lo, hi] = ANISO_BRACKET[k]!;
      expect(anisoI(quartet(k, lo))).toBeGreaterThan(BRANCH_ANISO);
      expect(anisoI(quartet(k, hi))).toBeLessThan(BRANCH_ANISO);
      expect(anisoGrowth(quartet(k, lo))).toBeLessThan(1);
      expect(anisoGrowth(quartet(k, hi))).toBeGreaterThan(1);
      expect(hi - lo).toBeCloseTo(0.25, 15);
    }
    expect(anisoI(quartet(8, 5.75))).toBeCloseTo(0.9781095338938914, 12);
    expect(anisoI(quartet(8, 6))).toBeCloseTo(0.9770580095880759, 12);
    expect(anisoI(quartet(4, 3.25))).toBeCloseTo(0.9774702343297584, 12);
    expect(anisoI(quartet(4, 3.5))).toBeCloseTo(0.9753828231503209, 12);
  });
});

describe("§ 6bv.3 — the threshold DRIFTS with the anchor, and § 6bu's band fails at the first rung", () => {
  it("the four brackets in kept share, first and third disjoint", () => {
    const bands = KS.map((k) => {
      const [lo, hi] = COST_BRACKET[k]!;
      return [keptShare("s20", k, hi), keptShare("s20", k, lo)] as const;
    });
    expect(bands[0]).toEqual([0.859375, 0.890625]);
    expect(bands[1]).toEqual([0.8828125, 0.8984375]);
    expect(bands[2]).toEqual([0.90234375, 0.91015625]);
    expect(bands[3]).toEqual([0.919921875, 0.923828125]);
    // Disjoint first-to-third and third-to-fourth: the drift is bigger than the
    // quarter cell that limits it, so it is not the resolution talking. The
    // first two overlap, and nothing here separates them.
    expect(bands[0]![1]).toBeLessThan(bands[2]![0]);
    expect(bands[2]![1]).toBeLessThan(bands[3]![0]);
    expect(bands[1]![1]).toBeGreaterThan(bands[0]![0]);
  });

  it("§ 6bu's 'about 0.90 and 0.94 at every anchor' holds at the top two and not at the first", () => {
    // The band as published. At k = 8 and k = 4 the crossing is inside it...
    for (const k of [4, 8] as const) {
      const [lo, hi] = COST_BRACKET[k]!;
      expect(keptShare("s20", k, hi)).toBeGreaterThan(0.9);
      expect(keptShare("s20", k, lo)).toBeLessThan(0.94);
    }
    // ...and at the first rung the whole bracket is below 0.90. § 6bu had a
    // two-sided bracket at one anchor only — six cells and four at k = 8 — and
    // its k = 1 reading (0.5 cells, 0.921875, above 1) bounds the crossing from
    // one side alone, which is consistent with a crossing anywhere below.
    expect(keptShare("s20", 1, COST_BRACKET[1]![0])).toBeLessThan(0.9);
    expect(costI(quartet(1, 0.5))).toBeCloseTo(1.0160990060983277, 12);
    expect(costI(quartet(1, 0.5))).toBeGreaterThan(1);
  });

  it("and the drift shows without interpolating: a HIGHER share reads lower at the last rung", () => {
    // 0.75 cells at the first rung keeps 0.890625 and reads above 1; § 6bu.3's
    // own six cells at the last keep MORE, 0.904297, and read below it. More
    // kept is the direction that pushes the cost up, and it came out down — so
    // no single kept share is the threshold for both anchors.
    expect(keptShare("s20", 1, 0.75)).toBeCloseTo(0.890625, 15);
    expect(keptShare("s20", 8, 6)).toBeCloseTo(0.904296875, 15);
    expect(keptShare("s20", 8, 6)).toBeGreaterThan(keptShare("s20", 1, 0.75));
    expect(costI(quartet(1, 0.75))).toBeGreaterThan(1);
    expect(costI(quartet(8, 6))).toBeCloseTo(0.992703686090584, 12);
    expect(costI(quartet(8, 6))).toBeLessThan(1);
  });
});

describe("§ 6bv.4 — the drift refuses BOTH of § 6bu's ladders", () => {
  it("the threshold guard grows 4.75x to 6.67x over 8x of anchor, and 1x and 8x are outside", () => {
    const [lo1, hi1] = COST_BRACKET[1]!;
    const [lo8, hi8] = COST_BRACKET[8]!;
    // The extreme ratios the brackets allow, from the four measured guards.
    expect(lo8 / hi1).toBeCloseTo(4.75, 12);
    expect(hi8 / lo1).toBeCloseTo(6.666666666666667, 12);
    // Holding the pixel count is 1x and holding the kept share is 8x. Neither
    // is in [4.75, 6.67], so the threshold locus is a third ladder — and it
    // lies between § 6bs.7's and § 6bu.5's, nearer the second.
    expect(lo8 / hi1).toBeGreaterThan(1);
    expect(hi8 / lo1).toBeLessThan(8);
    expect(anchorOf(8) / anchorOf(1)).toBeCloseTo(8, 9);
  });

  it("the anisotropy's grows faster and FAILS TO EXCLUDE the held share", () => {
    const [lo1, hi1] = ANISO_BRACKET[1]!;
    const [lo8, hi8] = ANISO_BRACKET[8]!;
    expect(lo8 / hi1).toBeCloseTo(5.75, 12);
    expect(hi8 / lo1).toBeCloseTo(8, 12);
    // 8x is ATTAINED at the upper end, not excluded — so this ladder excludes
    // the held pixel count and says nothing either way about the held share.
    // That is weaker than the cost's finding and is not the same sentence: a
    // quarter cell either side of where this grid happens to fall would settle
    // it, and no such guard exists.
    expect(lo8 / hi1).toBeGreaterThan(1);
    expect(hi8 / lo1).toBeGreaterThanOrEqual(8);
  });
});

describe("§ 6bv.5 — the two thresholds SEPARATE as the anchor grows", () => {
  it("one quarter cell or less at the first rung, at least three at the last", () => {
    // At k = 1 both crossings are in the same quarter cell and this ladder
    // cannot separate them; by k = 8 the anisotropy's is a clear cell further
    // out. § 6bu.4's "two nearby but distinct thresholds" is a statement about
    // the top rungs.
    expect(COST_BRACKET[1]).toEqual(ANISO_BRACKET[1]);
    expect(COST_BRACKET[2]).toEqual(ANISO_BRACKET[2]);
    expect(ANISO_BRACKET[4]![0] - COST_BRACKET[4]![1]).toBeCloseTo(0.25, 15);
    expect(ANISO_BRACKET[8]![0] - COST_BRACKET[8]![1]).toBeCloseTo(0.75, 15);
    expect(ANISO_BRACKET[8]![1] - COST_BRACKET[8]![0]).toBeCloseTo(1.25, 15);
  });

  it("so § 6bu.4's '3.1% of kept share' was its two guards' spacing, not the separation", () => {
    // § 6bu.4 read guards of 3 and 4 cells at k = 4 and quoted the share
    // difference between them. The thresholds themselves are 0.25 to 0.75 of a
    // cell apart there, which is 0.78% to 2.34% of kept share — the published
    // number is an upper bound and misses the true separation by up to 4x.
    expect(keptShare("s20", 4, 3) - keptShare("s20", 4, 4)).toBeCloseTo(0.03125, 15);
    const loSep = (ANISO_BRACKET[4]![0] - COST_BRACKET[4]![1]) / 32;
    const hiSep = (ANISO_BRACKET[4]![1] - COST_BRACKET[4]![0]) / 32;
    expect(loSep).toBeCloseTo(0.0078125, 15);
    expect(hiSep).toBeCloseTo(0.0234375, 15);
    expect(hiSep).toBeLessThan(0.03125);
  });
});

describe("§ 6bv.6 — the fourth rung is where the threshold clears the buildable floor", () => {
  it("the crossing passes four cells between the third rung and the fourth", () => {
    // § 6bh.4 floors the guard at four resolution cells. Below the fourth rung
    // the threshold is under that floor, so § 6bs.7's verdicts could only be
    // failed by a mosaic nobody could build; at the fourth it is above it, and
    // the branch's own four cells already sit on the failing side.
    for (const k of [1, 2, 4] as const) expect(COST_BRACKET[k]![1]).toBeLessThanOrEqual(4);
    expect(COST_BRACKET[8]![0]).toBeGreaterThan(4);
    // Which is § 6bs.7's ladder read from the threshold's side: at a fixed
    // guard of four the cost crosses 1 between exactly those two rungs.
    expect(costI(quartet(4))).toBeCloseTo(0.9863246838710185, 12);
    expect(costI(quartet(8))).toBeCloseTo(1.0048044909202725, 12);
    expect(costI(quartet(4))).toBeLessThan(1);
    expect(costI(quartet(8))).toBeGreaterThan(1);
    expect(anchorOf(4)).toBeCloseTo(1.8707731504760141, 12);
    expect(anchorOf(8)).toBeCloseTo(3.7415463009520282, 12);
  });

  it("so three of the four thresholds are geometry-only readings, in § 6bu.3's sense", () => {
    // `mosaicSeamShiftMm` renders nothing, so a sub-floor guard has a reading;
    // the mosaic it describes would not contain a PSF wrap. Carried explicitly
    // at every rung rather than left for the reader to notice.
    for (const k of [1, 2, 4] as const) {
      for (const g of COST_BRACKET[k]!) expect(g).toBeLessThan(4);
      for (const g of ANISO_BRACKET[k]!) expect(g).toBeLessThan(4);
    }
    for (const g of COST_BRACKET[8]!) expect(g).toBeGreaterThan(4);
  });
});

describe("§ 6bv.7 — four anchors, and now for a second reason", () => {
  it("there is no rung BETWEEN the four: the frame must be a power of two", () => {
    // § 6bu.7 refused a FIFTH rung by the chief ray. The gaps are refused
    // earlier than that, before a ray is traced, so the crossings above are
    // bracketed by the only anchors this family has.
    for (const k of [3, 5, 6, 7] as const) {
      expect(() => quartet(k)).toThrow(/frame size must be a power of two/);
    }
    expect(() => quartet(3)).toThrow(/got 384/);
    expect(() => quartet(7)).toThrow(/got 896/);
  });
});
