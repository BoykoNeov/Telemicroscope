import { describe, it, expect } from "vitest";
import { mosaicSeamShiftMm, type FluorescenceMosaicOptions } from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6bz — the anisotropy's law outside the window, and the hump is a shoulder.
 *
 * § 6bw located the anisotropy threshold across k = 1…8 at 4 mm off axis and
 * found a single smooth hump: the guard's share of the tile rises 8.6% to a
 * maximum near a tile half extent of 0.5115 of the field offset and falls back
 * to within 1% of where it started. § 6bx and § 6by both left the same bullet
 * standing: "the anisotropy has still never been read past a ratio of 1.55.
 * Until that is done, 'the two laws are qualitatively different' remains a
 * statement about the reachable window."
 *
 * **The window was the COST's and not the anisotropy's.** § 6bu.7's chief-ray
 * refusal stops 4 mm at k = 13.25 because a FIELD scan puts a separate frame at
 * every tile centre, and the outermost of those runs out of objective. A stage
 * scan has one frame, at the anchor's own centre (§ 6bj.7), and the anisotropy
 * is a stage-only readout — so it traces to k = 28 at 4 mm and k = 31.375 at
 * 2 mm, which is a ratio of 3.275 and of 7.338. There was nothing to build.
 *
 * ## What is out there
 *
 * The threshold falls from § 6bw's hump to a sharp MINIMUM near a ratio of 2.08
 * and then climbs by a factor of 13, until the guard is eating four fifths of
 * the tile and the climb saturates against that bound (§ 6bz.1, § 6bz.3). So
 * § 6bw's hump is not the law: it is a 59% shoulder on the front of a curve
 * that spans 13×, and "the two ends land level to 1%" is a property of where
 * the ladder stopped.
 *
 * ## The ratio is the variable, and now that is measured
 *
 * § 6bw.7 declined to claim it — "the interval bounds the turn and does NOT say
 * the ratio is constant to 0.8%", because a sixteenth of a rung is 2.9% of the
 * ratio at 2 mm against 1.1% at 5 mm. Located rather than bracketed, matched
 * anchors at 2 mm and 4 mm agree to 1.3e-4 at a ratio of 0.234 and to under
 * 0.4% out to 3.27 (§ 6bz.2). The one place it fails is the turn itself, where
 * the two offsets put the minimum ~0.8% apart in ratio and the curve is steep
 * enough to turn that into 3.6%.
 *
 * ## Two things the bisection had to survive
 *
 * - **Monotonicity is lost above a ratio of about 2.05** — past it the readout
 *   RISES with the guard over most of the legal range and falls through the
 *   branch value only at the far end. § 6bw.5's "strictly decreasing throughout"
 *   is its own window's. What a bisection needs is the unique crossing, and
 *   that survives everywhere (§ 6bz.0), which is § 6by.0's argument again.
 * - **Probe-exactness is lost at the turn.** § 6bw.4's corner puts the stage
 *   worst on every probe grid there is; at the turn it is interior and the
 *   located value moves 2.8% between 17 and 65 probes (§ 6bz.5).
 *
 * ## And the turn has a mechanism
 *
 * At a fixed guard each cell's OWN anisotropy falls with the ratio and turns
 * back up, at a ratio that differs from cell to cell — and the interact turns as
 * the four pass through one by one (§ 6bz.4). The 10× pair's own lever steps
 * through 1 exactly at the threshold's minimum. As in § 6by.3 the locus moves
 * with the guard, so there is no constant ratio to quote for it either.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6by used it: no render, so no focus stage. */
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

/** § 6bo's own denominator: the anisotropy threshold is where the interact
 *  crosses THIS, not 1 — `anisoGrowth = 1` is exactly this value (§ 6bs). */
const BRANCH_ANISO = 0.9772598554705617;

const BIG = 2 ** 26;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;
/** The slow 20×'s guard share at lattice point `i`, which is `i/2^23`. */
const shareOfI = (i: number): number => i / 2 ** 23;

const stageShift = (c: Cell, j: number, i: number, probes: number, x: number, size = BIG) =>
  mosaicSeamShiftMm(
    LENS[c],
    mosaicOptions(size, PS_AT(c, j), {
      guardCells: guardAt(j, i),
      centreMm: { x, y: 0 },
      scan: "stage",
    }),
    probes,
  );

/** § 6bw's own readout, per cell: rows over columns on a stage scan. */
const aniso = (c: Cell, j: number, i: number, probes: number, x: number, size = BIG): number => {
  const s = stageShift(c, j, i, probes, x, size);
  return s.betweenRowsMm / s.betweenColumnsMm;
};
const anisoI = (j: number, i: number, probes: number, x: number, size = BIG): number =>
  inter4(CELLS.map((c) => aniso(c, j, i, probes, x, size)));

/** § 6bw.7's variable and § 6bx.8's: the slow 20×'s tile half extent as a
 *  fraction of the mosaic's own field offset. */
const ratioOfHalf = (j: number, x: number): number =>
  objectFieldTile(LENS.s20, {
    size: BIG,
    pupilSamples: PS_AT("s20", j),
    wavelengthNm: DESIGN,
    centreMm: { x, y: 0 },
  }).halfExtentMm / x;

/** `i` is the threshold: at it the interact still exceeds the branch value, at
 *  `i + 1` it does not. Both halves are re-measured, never remembered. */
const located = (j: number, i: number, x: number, probes = 65): void => {
  expect(anisoI(j, i, probes, x)).toBeGreaterThan(BRANCH_ANISO);
  expect(anisoI(j, i + 1, probes, x)).toBeLessThan(BRANCH_ANISO);
};

/**
 * The located thresholds, on § 6bx's own 2⁻²⁴ lattice, at 65 probes.
 *
 * `AT4` is 4 mm off axis, which is § 6bw's own field position, and `AT2` is
 * 2 mm — so `AT2[j]` and `AT4[2j]` are the same RATIO and § 6bz.2 is their
 * comparison. Every one is a step-1 bisection over the whole legal range.
 */
const AT4: Record<number, number> = {
  32: 777926,
  64: 808622,
  70: 809443,
  128: 752587,
  192: 610978,
  256: 547993,
  280: 533023,
  284: 508373,
  288: 609253,
  320: 1502379,
  448: 3812602,
};
const AT2: Record<number, number> = {
  16: 777825,
  32: 808189,
  64: 751833,
  96: 611601,
  128: 550015,
  140: 514082,
  144: 633846,
  224: 3827159,
  320: 5474972,
  502: 6700859,
};

describe("§ 6bz.0 — the gate: one crossing, though no longer a monotone one", () => {
  it("crosses once across the whole legal range, on both sides of the turn", () => {
    // § 6bw.5 walked this range at k = 1 and found it strictly decreasing. Past
    // the turn it is not: the readout RISES with the guard over most of the
    // range and falls through the branch value only at the end. So the licence
    // is re-taken where it is needed, and it is the CROSSING COUNT that carries
    // it — monotonicity is sufficient for a bisection and not necessary.
    for (const [j, x] of [
      [128, 4],
      [280, 4],
      [502, 2],
    ] as const) {
      // Both ends of the bracket, because a bisection whose crossing has left
      // [1, 8e6] returns an endpoint silently.
      expect(anisoI(j, 1, 65, x)).toBeGreaterThan(BRANCH_ANISO);
      expect(anisoI(j, 8000000, 65, x)).toBeLessThan(BRANCH_ANISO);
      let crossings = 0;
      let above = true;
      const walk = [1];
      for (let e = 3; e <= 22.5; e += 1.5) walk.push(Math.round(2 ** e));
      walk.push(8000000);
      for (const i of walk) {
        const v = anisoI(j, i, 65, x);
        if (above !== v > BRANCH_ANISO) {
          crossings++;
          above = v > BRANCH_ANISO;
        }
      }
      expect(crossings).toBe(1);
    }
  });

  it("is strictly decreasing below the turn and mostly rising above it", () => {
    // The two regimes, side by side on the same coarse walk. Below the turn
    // every step falls, which is § 6bw.5's finding at a ratio of 0.94; above it
    // all but one step RISES, and the fall to the crossing is the last one.
    const walk = (j: number, x: number): number[] =>
      [6, 9, 12, 15, 18].map((e) => anisoI(j, Math.round(2 ** e), 65, x));
    const below = walk(128, 4);
    for (let n = 1; n < below.length; n++) expect(below[n]!).toBeLessThan(below[n - 1]!);
    const above = walk(288, 4);
    for (let n = 1; n < above.length; n++) expect(above[n]!).toBeGreaterThan(above[n - 1]!);
  });
});

describe("§ 6bz.1 — the hump is a shoulder on a curve that spans 13×", () => {
  it("reproduces § 6bw's peak and then falls to a minimum and climbs past it", () => {
    // § 6bw's own two anchors come back unchanged, which is what makes the rest
    // of this table an extension of that curve rather than a different one.
    // (§ 6bw published 777926 at k = 2 and 752587 at k = 8, at 17 probes.)
    located(32, AT4[32]!, 4);
    located(128, AT4[128]!, 4);
    // The peak, at § 6bw.7's own 0.5115.
    located(70, AT4[70]!, 4);
    expect(ratioOfHalf(70, 4)).toBeCloseTo(0.5117, 4);
    expect(AT4[70]!).toBeGreaterThan(AT4[32]!);
    expect(AT4[70]!).toBeGreaterThan(AT4[128]!);
    // Then down, through the whole of § 6bw's unreachable window, to a minimum
    // at a ratio of 2.076 — 37.2% below the peak.
    located(192, AT4[192]!, 4);
    located(256, AT4[256]!, 4);
    located(284, AT4[284]!, 4);
    expect(ratioOfHalf(284, 4)).toBeCloseTo(2.0761, 4);
    for (const j of [192, 256] as const) expect(AT4[j]!).toBeGreaterThan(AT4[284]!);
    expect(1 - AT4[284]! / AT4[70]!).toBeCloseTo(0.3719, 4);
    // And then up, by a factor of 13 before the design runs out of anchor.
    located(320, AT4[320]!, 4);
    located(448, AT4[448]!, 4);
    located(502, AT2[502]!, 2);
    expect(AT2[502]! / AT4[284]!).toBeCloseTo(13.181, 3);
    // Which is the whole point: § 6bw's hump is 59% of the way from the minimum
    // to the peak, on a curve whose full span is 13×. "The two ends land level
    // to 1%" was a statement about where the ladder stopped.
    expect(AT4[70]! / AT4[284]!).toBeCloseTo(1.5922, 4);
  });
});

describe("§ 6bz.2 — the ratio is the variable, to 0.4% away from the turn", () => {
  it("puts matched anchors at 2 mm and 4 mm on the same threshold", () => {
    // `AT2[j]` and `AT4[2j]` sit at the same half-extent-over-offset: the half
    // extent goes as the anchor exactly (§ 6bw.2), so doubling both the anchor
    // and the offset holds the ratio — up to the half extent's own creep with
    // field position, 2.7e-4 here, which § 6by.7 measured.
    for (const [j, tol] of [
      [16, 1.4e-4],
      [32, 5.4e-4],
      [64, 1.1e-3],
      [96, 1.1e-3],
      [128, 3.7e-3],
    ] as const) {
      located(j, AT2[j]!, 2);
      located(2 * j, AT4[2 * j]!, 4);
      expect(Math.abs(ratioOfHalf(j, 2) / ratioOfHalf(2 * j, 4) - 1)).toBeLessThan(3e-4);
      expect(Math.abs(AT2[j]! / AT4[2 * j]! - 1)).toBeLessThan(tol);
    }
    // The pair at a ratio of 0.468 is the one that matters for § 6bw.7's own
    // turn: it sits one anchor short of the peak, and the two offsets put it in
    // the same place to five parts in ten thousand.
    expect(Math.abs(AT2[32]! / AT4[64]! - 1)).toBeLessThan(5.4e-4);
    // Over a range in which the threshold itself moves by a factor of 1.5, so
    // this is a collapse and not two flat curves agreeing. § 6bw.7 could only
    // say "0.511 to 0.515 across a 2.5× of offset, and the grid is too coarse
    // to call that constant"; located, the agreement is three decimal places.
    expect(Math.max(AT2[16]!, AT2[128]!) / Math.min(AT2[16]!, AT2[128]!)).toBeGreaterThan(1.41);
  });

  it("except at the turn, where the minimum's own ratio moves with the offset", () => {
    // 2 mm bottoms out at a ratio of 2.046 and 4 mm has not yet bottomed there
    // — its minimum is 0.8% further on. The V is steep enough that a shift that
    // small is a 3.6% disagreement in the located value, which is the one place
    // in the whole range where the ratio does not carry the reading.
    located(140, AT2[140]!, 2);
    located(280, AT4[280]!, 4);
    expect(Math.abs(ratioOfHalf(140, 2) / ratioOfHalf(280, 4) - 1)).toBeLessThan(3e-4);
    expect(1 - AT2[140]! / AT4[280]!).toBeCloseTo(0.0355, 4);
    // 2 mm is already climbing at the ratio where 4 mm is still at its floor.
    located(144, AT2[144]!, 2);
    expect(AT2[144]!).toBeGreaterThan(AT2[140]!);
    expect(AT2[144]! / AT2[140]!).toBeGreaterThan(1.23);
  });
});

describe("§ 6bz.3 — the far climb saturates against the guard's own bound", () => {
  it("reaches four fifths of the tile and decelerates because it must", () => {
    located(320, AT2[320]!, 2);
    located(502, AT2[502]!, 2);
    // At the top of the anchor range the guard is eating 79.9% of the tile, so
    // the readout is being taken on a tile that is mostly guard. The share
    // cannot pass 1, and the climb is already flattening against it: the last
    // 57% of ratio buys 22% of threshold where the first 80% bought 240%.
    expect(shareOfI(AT2[320]!)).toBeCloseTo(0.6527, 4);
    expect(shareOfI(AT2[502]!)).toBeCloseTo(0.7988, 4);
    const early = AT2[320]! / AT2[144]! - 1;
    const late = AT2[502]! / AT2[320]! - 1;
    const dEarly = ratioOfHalf(320, 2) / ratioOfHalf(144, 2) - 1;
    const dLate = ratioOfHalf(502, 2) / ratioOfHalf(320, 2) - 1;
    expect(early).toBeCloseTo(7.638, 3);
    expect(late).toBeCloseTo(0.2239, 4);
    // Sixteen times less threshold per unit of ratio at the far end than at the
    // near one, which is what a bounded quantity running out of room looks like.
    expect(early / dEarly / (late / dLate)).toBeGreaterThan(15);
  });
});

describe("§ 6bz.4 — the turn is four per-cell turns that do not coincide", () => {
  it("turns each cell's own anisotropy up, at a ratio of its own", () => {
    // At the guard the threshold itself sits at, each cell's rows-over-columns
    // falls with the ratio and then turns back up — and the four turns are at
    // four different ratios. The interact turns as they pass one by one, which
    // is § 6by.2's shape: what shows in a quotient of quotients is the cells
    // being out of step, not any one of them doing something.
    const I = 508520;
    const at = (c: Cell, j: number): number => aniso(c, j, I, 65, 4);
    // The 10x pair has turned by a ratio of 2.062 and the slow 20x has not.
    expect(at("s10", 282)).toBeGreaterThan(at("s10", 280));
    expect(at("f10", 282)).toBeGreaterThan(at("f10", 280));
    expect(at("s20", 282)).toBeLessThan(at("s20", 280));
    // Both 20x cells are still falling one step later, where both 10x cells rise.
    expect(at("s20", 284)).toBeLessThan(at("s20", 282));
    expect(at("s10", 284)).toBeGreaterThan(at("s10", 282));
    // The fast 20x turns two steps after the 10x pair and the slow 20x five,
    // which is what makes this four turns and not one.
    expect(at("f20", 286)).toBeGreaterThan(at("f20", 284));
    expect(at("f20", 284)).toBeLessThan(at("f20", 282));
    expect(at("s20", 292)).toBeGreaterThan(at("s20", 290));
    expect(at("s20", 290)).toBeLessThan(at("s20", 288));
  });

  it("steps the 10x lever through 1 exactly at the threshold's minimum", () => {
    const lever = (j: number, i: number): number =>
      aniso("f10", j, i, 65, 4) / aniso("s10", j, i, 65, 4);
    // Read at the minimum's own guard, the 10x pair's anisotropy lever crosses 1
    // between the anchor before the minimum and the minimum itself.
    expect(lever(280, 508520)).toBeLessThan(1);
    expect(lever(282, 508520)).toBeGreaterThan(1);
    located(280, AT4[280]!, 4);
    located(284, AT4[284]!, 4);
    expect(AT4[284]!).toBeLessThan(AT4[280]!);
    // And the locus moves with the guard, which is § 6by.3 in a new place: at a
    // guard of 300000 the same lever has already crossed by a ratio of 2.032,
    // where at 508520 it has not. So the ratio at which the turn happens is not
    // a constant of the geometry any more than § 6bx.8's 1.8 was.
    expect(lever(278, 300000)).toBeLessThan(1);
    expect(lever(278, 508520)).toBeGreaterThan(0.999);
    expect(lever(278, 508520)).toBeLessThan(1);
  });
});

describe("§ 6bz.5 — probe-exactness is lost at the turn, and only there", () => {
  it("moves the located value with the probe count where § 6bw.4 does not", () => {
    // § 6bw.4's argument is that the stage worst sits at a corner, which
    // `along(0) = 0` puts on every probe grid there is — so the readout is the
    // same at any probe count. That holds below the turn...
    located(128, AT4[128]!, 4, 17);
    located(128, AT4[128]!, 4, 257);
    // ...and fails at it. The located value is 518268 at 17 probes against
    // 533023 at 65 and 534912 at 257: 2.8% between the first two, and 0.35%
    // between the last two, so it is converging and it is not converged. The
    // V's floor is therefore known to a few tenths of a percent and no better,
    // which is the same order as § 6bz.2's disagreement between the offsets.
    located(280, 518268, 4, 17);
    located(280, 534912, 4, 257);
    expect(1 - 518268 / AT4[280]!).toBeCloseTo(0.0277, 4);
    expect(534912 / AT4[280]! - 1).toBeCloseTo(0.0035, 4);
    // Away from the turn it is tight again: at a ratio of 3.74 the 65- and
    // 257-probe values differ by 4.4e-5.
    located(256, 4530056, 2);
    located(256, 4529858, 2, 257);
    expect(Math.abs(4529858 / 4530056 - 1)).toBeLessThan(5e-5);
  });
});

describe("§ 6bz.6 — and the frame has converged, above the turn as below it", () => {
  it("locates the same threshold at three frames spanning 4×", () => {
    // § 6bw.3's collapse says the frame reaches the seam only through the kept
    // share, and § 6bx.4 checked the convergence below the turn. It survives
    // above it: 1502376 at 2^24 against 1502379 at 2^26, two parts in a million.
    // The lattice coarsens with the frame — a guard has to land on a whole
    // pixel in all four cells, so 2^24 admits every fourth point and 2^25 every
    // second — which is § 6bw.5's "the frame is not the finest guard, it is the
    // finest RULER" read from the other end.
    for (const [size, i, next] of [
      [2 ** 24, 1502376, 1502380],
      [2 ** 25, 1502378, 1502380],
    ] as const) {
      expect(anisoI(320, i, 65, 4, size)).toBeGreaterThan(BRANCH_ANISO);
      expect(anisoI(320, next, 65, 4, size)).toBeLessThan(BRANCH_ANISO);
      expect(Math.abs(i / AT4[320]! - 1)).toBeLessThan(3e-6);
    }
    located(320, AT4[320]!, 4);
  });
});

describe("§ 6bz.7 — the handover locus is the ratio's too, and 4 mm does hand over", () => {
  it("crosses one inside the same matched anchor interval at both offsets", () => {
    // § 6by.5 measured "at 4 mm nothing hands over" and read it as § 6bx.3's
    // window — correctly, for the COST, which stops at k = 13.25. The anisotropy
    // goes further and 4 mm hands over like everything else: at a held guard
    // every cell is above 1 at a ratio of 1.784 and below it at 1.915.
    const I = 490080;
    for (const c of CELLS) {
      expect(aniso(c, 244, I, 65, 4)).toBeGreaterThan(1);
      expect(aniso(c, 262, I, 65, 4)).toBeLessThan(1);
    }
    expect(ratioOfHalf(244, 4)).toBeCloseTo(1.7837, 4);
    // And it is the same ratio at 2 mm. Matched anchors (`j` at 2 mm, `2j` at
    // 4 mm) straddle each 10x cell's crossing identically, so § 6by.3's locus —
    // which moves with the GUARD — does not move with the offset at a held one.
    for (const c of ["s10", "f10"] as const) {
      expect(aniso(c, 122, I, 65, 2)).toBeGreaterThan(1);
      expect(aniso(c, 124, I, 65, 2)).toBeLessThan(1);
      expect(aniso(c, 244, I, 65, 4)).toBeGreaterThan(1);
      expect(aniso(c, 248, I, 65, 4)).toBeLessThan(1);
    }
    // The slow 20x is the one cell where the two brackets are not identical, and
    // they are adjacent: 2 mm crosses inside matched (124, 126) and 4 mm inside
    // (126, 127), overlapping at their shared end. One anchor step, not a law.
    expect(aniso("s20", 124, I, 65, 2)).toBeGreaterThan(1);
    expect(aniso("s20", 126, I, 65, 2)).toBeLessThan(1);
    expect(aniso("s20", 252, I, 65, 4)).toBeGreaterThan(1);
    expect(aniso("s20", 254, I, 65, 4)).toBeLessThan(1);
    // So the two readouts' turns are two landmarks on ONE per-cell curve: the
    // cost's jump is where it passes 1 (§ 6by) at a ratio of ~1.8, and the
    // anisotropy's minimum is where the same curve turns (§ 6bz.4) at ~2.08.
    // Both collapse onto the ratio, and neither is the same feature.
    expect(ratioOfHalf(284, 4) / ratioOfHalf(244, 4)).toBeGreaterThan(1.13);
  });
});
