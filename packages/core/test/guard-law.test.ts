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
 * § 6bw — the drift is a hump, and § 6bs.7's ladder was holding two knobs.
 *
 * § 6bv located § 6bu's threshold to a quarter cell, found that it DRIFTS, and
 * left three things open: no drift LAW, only the bracket [4.75, 6.67] on its
 * growth; no mechanism for the two thresholds' separation; and the flat
 * statement that "anything sharper needs an anchor family that is not this
 * one". This step finds that family without leaving the design, and the law
 * turns out to be non-monotone — which is why no ladder fitted it.
 *
 * ## The anchor is `pupilSamples`, and `size` is not part of it
 *
 * `imagePixelScaleMm` is `lambda*R / (n*size*deltaPupil)` with `deltaPupil =
 * 2*exitRadius/pupilSamples`, so it is proportional to `pupilSamples/size`, and
 * `halfExtentMm = (size/2) * pixelScaleMm` cancels `size` EXACTLY. The half
 * extent is a function of `pupilSamples` alone (§ 6bw.2), to the last bit, over
 * an 8x of frame. § 6bs.7's ladder held `size/pupilSamples` and so moved both
 * together; nothing in the optics ties them.
 *
 * ## And the frame reaches the seam only through the kept share
 *
 * `objectAt` forms `(cropped + guard + x - col*pitch - tileSize/2) *
 * pixelScale` with `tileSize = size` and `pitch = keptPixels`. Divide the
 * bracket by `size`: `cropped/size + guard/size` is `1/size + g/pupilSamples`,
 * which is `(1 - share)/2`, and `pitch/size` is `share` itself. Every term is a
 * function of the kept share alone except `x/size` — and the ACROSS-seam probe
 * sits at `x = seam*pitch`, which is `seam*share`. The only survivor is the
 * ALONG-seam probe, `round((composed - 1)*p/(probes - 1))`, whose rounding is
 * O(1/size) (§ 6bw.3).
 *
 * That is exactly what the two scans show (§ 6bw.4). A stage scan has one frame
 * and its worst sits at the corner `{x: 0, y: pitch}`, so it is EXACT: bit for
 * bit across a 16x of `size` and across every probe count from 17 to 129. A
 * field scan's worst sits at an interior along-seam probe, and it carries the
 * whole residual — moving `probes` at one fixed size moves it by 3.8e-4, an
 * order of magnitude MORE than moving `size` does. § 6bv.4 called the
 * anisotropy "the weaker finding"; it is the exact one, and the cost is the
 * quantised one.
 *
 * ## So the quarter cell bounds the guard, not the ruler
 *
 * § 6bv.1's quarter cell is real and is still the finest GUARD. It is not the
 * finest RULER: the share moves in steps of `2/size`, `size` is free, and a
 * quartet that holds every cell's share while the frame grows walks the same
 * curve on a lattice refined by the blow-up. The threshold is therefore located
 * outright rather than bracketed (§ 6bw.5), and the readout is strictly
 * decreasing across the WHOLE legal guard range with exactly one crossing —
 * where § 6bv.2 could only assert monotonicity inside a four-point window.
 *
 * ## The rungs between the four exist
 *
 * § 6bv.7 refused `k` = 3, 5, 6, 7 because "the frame must be a power of two".
 * The frame must; the ANCHOR need not, and they are not the same thing.
 * `pupilSamples` of 17, 18, 20, 48, 80 and 112 all trace (§ 6bw.6). § 6bv.7's
 * conclusion holds for its own family — `base*k` is the frame there, so `k` is
 * forced — and its reason does not survive the frame being untied.
 *
 * ## The law: a single hump, and it tracks the field
 *
 * Take the real one-pixel crop and let the frame grow. The crop's share `2/size`
 * goes to zero, the threshold converges, and what is left is a function of the
 * anchor alone, defined at every anchor rather than at four. In the guard's own
 * share of the tile, `2g/pupilSamples`, it RISES from 0.0888 at the first rung
 * to 0.09649 near k = 4.375 and FALLS back to 0.0897 at the last (§ 6bw.7).
 *
 * A single smooth maximum, 8.6% from end to peak. Every monotone form was
 * always going to fail on it, and the two ends land level by accident — which
 * is precisely why § 6bv measured a growth factor sitting between § 6bu's two
 * ladders and matching neither, and why k = 4 looked anomalous in every
 * representation: it sits almost exactly on the turning point.
 *
 * The maximum is not an artifact of this field position. Moved to 2 mm and to
 * 5 mm off axis it moves with them, staying at a tile half extent of 0.511 to
 * 0.515 of the offset. No closed form is claimed for that number, and it is NOT
 * one half: 0.5115 is 2.3% away from 0.5, and this grid resolves 1%.
 */

const DESIGN = 587.5618;
const AXIS = { x: 0, y: 0 };
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu and § 6bv used it: no render, so no focus stage. */
const FREE_STAGE: TileStageMm = () => 0;

type Cell = "s10" | "f10" | "s20" | "f20";
const LENS: Record<Cell, OpticalSystem> = {
  s10: build(10, 0.1),
  f10: build(10, 0.2),
  s20: build(20, 0.1),
  f20: build(20, 0.2),
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

/** § 6bo's shapes at k = 1. `size` and `pupilSamples`, in that order. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};
/** Rendered pixels per resolution cell at k = 1 — `size/pupilSamples`, held by
 *  § 6bs.7's ladder at every rung, and what § 6bv.1's quarter cell is made of. */
const PX_PER_CELL: Record<Cell, number> = { s10: 4, f10: 4, s20: 8, f20: 4 };

/** § 6bo's own denominator, read from source: `anisoGrowth = 1` is exactly this. */
const BRANCH_ANISO = 0.9772598554705617;

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

const interact = (sl: number, fl: number, sh: number, fh: number): number => fh / sh / (fl / sl);

const anisoOf = (c: Cell, size: number, ps: number, g: number, x = 4): number => {
  const scan = mosaicSeamShiftMm(
    LENS[c],
    mosaicOptions(size, ps, { guardCells: g, scan: "stage", centreMm: { x, y: 0 } }),
  );
  return scan.betweenRowsMm / scan.betweenColumnsMm;
};

const ratioOf = (c: Cell, size: number, ps: number, g: number, probes = 17): number => {
  const field = mosaicSeamShiftMm(LENS[c], mosaicOptions(size, ps, { guardCells: g }), probes);
  const scan = mosaicSeamShiftMm(
    LENS[c],
    mosaicOptions(size, ps, { guardCells: g, scan: "stage" }),
    probes,
  );
  return scan.mm / field.mm;
};

const shareOf = (c: Cell, size: number, ps: number, g: number): number => {
  const geo = fluorescenceMosaicGeometry(LENS[c], mosaicOptions(size, ps, { guardCells: g }));
  return geo.keptPixels / geo.tileSize;
};

// ---------------------------------------------------------------------------
// § 6bv's published brackets, as the doc carries them.
// ---------------------------------------------------------------------------

/** § 6bv.2's cost brackets, `(lo, hi]` in guard cells, at k = 1, 2, 4, 8. */
const Q6BV_COST: Record<number, readonly [number, number]> = {
  1: [0.75, 1],
  2: [1.5, 1.75],
  4: [2.75, 3],
  8: [4.75, 5],
};
/** And § 6bv.2's anisotropy brackets. */
const Q6BV_ANISO: Record<number, readonly [number, number]> = {
  1: [0.75, 1],
  2: [1.5, 1.75],
  4: [3.25, 3.5],
  8: [5.75, 6],
};

// ---------------------------------------------------------------------------
// The two families this step measures.
// ---------------------------------------------------------------------------

/**
 * § 6bs.7's own ladder, refined. Cell `c` at anchor `k` keeps exactly the share
 * it keeps at the ladder's own frame `Q6BO*k`, but on a frame `blow` times
 * larger — holding `share = 1 - 2g/ps - 2/size` needs the guard to rise by
 * `(1 - 1/blow)/PX_PER_CELL`, which is a DIFFERENT amount in each cell. So a
 * refined threshold is the crossing of the share-parametrised curve, and its
 * guard-in-cells value is a label back-computed for a quartet that does not sit
 * on the ladder's own lattice at all.
 */
const LADDER_BLOW = 2 ** 20;
const ladderAnisoI = (k: number, g: number): number => {
  const v = CELLS.map((c) =>
    anisoOf(
      c,
      Q6BO[c][0] * k * LADDER_BLOW,
      Q6BO[c][1] * k,
      g + (1 - 1 / LADDER_BLOW) / PX_PER_CELL[c],
    ),
  );
  return interact(v[0]!, v[1]!, v[2]!, v[3]!);
};

/** § 6bv's own ladder thresholds, in units of 2^-22 of a cell. */
const LADDER_THRESHOLD: Record<number, number> = {
  1: 3773496,
  2: 7015817,
  4: 13737986,
  8: 24965002,
};

/**
 * The frame-free family. The crop stays at its real one pixel; the frame goes
 * to 2^26, where the crop's own share of the tile is 3e-8 and the threshold has
 * converged. The anchor is `pupilSamples` and nothing else, so it runs in steps
 * of 1/16 of § 6bs.7's rung rather than in powers of two.
 */
const BIG = 2 ** 26;
/** `pupilSamples` at anchor `j/16`: § 6bo's shape scaled by the anchor alone. */
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
/** The guard lattice at anchor `j/16` — `j/2^24` of a cell keeps every cell whole. */
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;
const bigAnisoI = (j: number, i: number, x = 4): number => {
  const g = guardAt(j, i);
  const v = CELLS.map((c) => anisoOf(c, BIG, PS_AT(c, j), g, x));
  return interact(v[0]!, v[1]!, v[2]!, v[3]!);
};

/** The frame-free threshold: `i` is the last guard still above the branch's own
 *  anisotropy, `i + 1` the first below it. Measured at 4 mm off axis. */
const BIG_THRESHOLD: Record<number, number> = {
  16: 745108,
  32: 777926,
  48: 798974,
  64: 808622,
  69: 809408,
  70: 809443,
  71: 809437,
  80: 807621,
  96: 797046,
  112: 778213,
  128: 752587,
};
/** The same at two other field offsets, around each one's own maximum. */
const BIG_THRESHOLD_AT: Record<number, Record<number, number>> = {
  2: { 34: 808854, 35: 808941, 36: 808868 },
  5: { 87: 809764, 88: 809782, 89: 809773 },
};

/** The guard's share of the tile at the threshold — `2g/pupilSamples`, read on
 *  the slow 20x, whose `pupilSamples` is `j`. This is the step's one ruler. */
const guardShare = (j: number, i: number): number => (2 * guardAt(j, i)) / j;

describe("§ 6bw.1 — § 6bv's own brackets refuse every AFFINE law, not just two points", () => {
  // `g(k) = A + B*k`. Each pair of brackets bounds `B` on its own, and two of
  // those bounds are disjoint — so no straight line passes through all four,
  // whatever `A` is. § 6bv refuted two POINTS of this family: a held kept share
  // is `A = 0` and a held pixel count is `B = 0`. The family dies whole, and on
  // data § 6bv already published.
  const slope = (
    brackets: Record<number, readonly [number, number]>,
    lo: number,
    hi: number,
  ): readonly [number, number] => {
    // `g(hi) - g(lo)` lies in `(hi.lo - lo.hi, hi.hi - lo.lo)`, open at both
    // ends because both brackets are half-open and the endpoints cannot be
    // attained together. Divided by the span in `k`.
    const span = hi - lo;
    return [
      (brackets[hi]![0] - brackets[lo]![1]) / span,
      (brackets[hi]![1] - brackets[lo]![0]) / span,
    ];
  };

  it("the cost's first-to-third and third-to-fourth slopes are disjoint", () => {
    const [aLo, aHi] = slope(Q6BV_COST, 1, 4);
    const [bLo, bHi] = slope(Q6BV_COST, 4, 8);
    expect(aLo).toBeCloseTo(1.75 / 3, 15);
    expect(aHi).toBeCloseTo(2.25 / 3, 15);
    expect(bLo).toBeCloseTo(1.75 / 4, 15);
    expect(bHi).toBeCloseTo(2.25 / 4, 15);
    // (0.5833, 0.75) against (0.4375, 0.5625): disjoint, and with a gap.
    expect(bHi).toBeLessThan(aLo);
    expect(aLo - bHi).toBeCloseTo(0.0208333333333333, 12);
  });

  it("and so are the anisotropy's, so neither readout admits a straight line", () => {
    const [aLo] = slope(Q6BV_ANISO, 1, 4);
    const [, bHi] = slope(Q6BV_ANISO, 4, 8);
    expect(aLo).toBeCloseTo(2.25 / 3, 15);
    expect(bHi).toBeCloseTo(2.75 / 4, 15);
    expect(bHi).toBeLessThan(aLo);
  });

  it("the refined thresholds miss the best straight line by two hundred cells' worth", () => {
    // Pinned against the located values rather than the brackets: fit `A + B*k`
    // to the two ends and read the middle two. The misses are 3% and 6% of the
    // threshold, where the ruler under them is 2e-7.
    const g = (k: number): number => LADDER_THRESHOLD[k]! / 2 ** 22;
    const B = (g(8) - g(1)) / 7;
    const A = g(1) - B;
    expect(A + 2 * B).toBeCloseTo(1.6214499473571777, 12);
    expect(A + 4 * B).toBeCloseTo(3.065006732940674, 12);
    expect(g(2) - (A + 2 * B)).toBeGreaterThan(0.05);
    expect(g(4) - (A + 4 * B)).toBeGreaterThan(0.2);
  });
});

describe("§ 6bw.2 — the anchor is `pupilSamples` alone, and `size` cancels", () => {
  const half = (size: number, ps: number): number =>
    objectFieldTile(LENS.s20, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS })
      .halfExtentMm;

  it("the half extent is bit-identical across an 8x of frame, at every anchor", () => {
    for (const [ps, expected] of [
      [16, 0.46769328761900353],
      [32, 0.9353865752380071],
      [64, 1.8707731504760141],
      [128, 3.7415463009520282],
    ] as const) {
      for (const size of [128, 256, 512, 1024]) {
        // Not `toBeCloseTo`: `size` cancels in the product, so this is equality.
        expect(half(size, ps)).toBe(expected);
      }
    }
  });

  it("and doubling `pupilSamples` doubles it, which is what the ladder was reading", () => {
    expect(half(128, 32)).toBe(2 * half(128, 16));
    expect(half(128, 128)).toBe(8 * half(128, 16));
    // § 6bs.7's four rungs are these four anchors, and the frame it moved with
    // them was never part of the anchor.
    expect(half(1024, 128)).toBe(half(128, 128));
  });
});

describe("§ 6bw.3 — the frame reaches the seam only through the kept share", () => {
  it("the closed form `1 - 2g/ps - 2*cropped/size` is the geometry's own share", () => {
    for (const c of CELLS) {
      for (const size of [128, 256, 1024]) {
        for (const g of [0.5, 1, 2]) {
          const ps = Q6BO[c][1];
          expect(shareOf(c, size, ps, g)).toBeCloseTo(1 - (2 * g) / ps - 2 / size, 15);
        }
      }
    }
    // Which is § 6bv.1's `1 - g/8k - 1/64k` on the slow 20x, where `8k` is
    // `ps/2` and `64k` is `size/2`. The two forms are the same statement.
    expect(1 - 4 / (8 * 8) - 1 / (64 * 8)).toBeCloseTo(0.935546875, 15);
  });

  it("matched shares give matched readouts, and the anisotropy's are bit-identical", () => {
    // Doubling `size` and adding `1/(2*PX_PER_CELL)` to the guard holds the
    // share exactly. Five frames spanning 16x, one share, one number.
    for (const [c, ps, rows, aniso] of [
      [
        "s20",
        16,
        [
          [128, 0.75],
          [256, 0.8125],
          [512, 0.84375],
          [1024, 0.859375],
          [2048, 0.8671875],
        ],
        14.069442486047695,
      ],
      [
        "s10",
        32,
        [
          [128, 0.75],
          [256, 0.875],
          [512, 0.9375],
          [1024, 0.96875],
          [2048, 0.984375],
        ],
        13.411102923799945,
      ],
    ] as const) {
      const share = shareOf(c, rows[0]![0], ps, rows[0]![1]);
      for (const [size, g] of rows) {
        expect(shareOf(c, size, ps, g)).toBe(share);
        expect(anisoOf(c, size, ps, g)).toBe(aniso);
      }
    }
  });
});

describe("§ 6bw.4 — the stage scan is exact; the field scan owns the whole residual", () => {
  const stageMm = (size: number, g: number, probes = 17): number =>
    mosaicSeamShiftMm(
      LENS.s20,
      mosaicOptions(size, 16, { guardCells: g, scan: "stage" }),
      probes,
    ).mm;

  it("a stage scan's worst sits at the corner, so `size` and `probes` cannot move it", () => {
    const worst = 0.00013069279220897373;
    for (const [size, g] of [
      [128, 0.75],
      [256, 0.8125],
      [512, 0.84375],
      [2048, 0.8671875],
    ] as const) {
      expect(stageMm(size, g)).toBe(worst);
    }
    for (const probes of [17, 18, 19, 33, 65, 129]) {
      expect(stageMm(128, 0.75, probes)).toBe(worst);
    }
    // And it is a corner: `along(0)` is 0 for every probe count, so the maximum
    // is found at a position no grid can miss.
    const scan = mosaicSeamShiftMm(
      LENS.s20,
      mosaicOptions(128, 16, { guardCells: 0.75, scan: "stage" }),
    );
    expect(scan.atPx).toEqual({ x: 0, y: 114 });
  });

  it("a field scan's worst sits inside, and `probes` moves it MORE than `size` does", () => {
    const byProbes = [17, 18, 19, 65].map((p) => ratioOf("s20", 128, 16, 0.75, p));
    expect(byProbes[0]!).toBeCloseTo(35.55529232713288, 12);
    expect(byProbes[1]!).toBeCloseTo(35.56086136746724, 12);
    expect(byProbes[2]!).toBeCloseTo(35.56446578995567, 12);
    expect(byProbes[3]!).toBeCloseTo(35.55094119505324, 12);
    const probeSpread = (Math.max(...byProbes) - Math.min(...byProbes)) / byProbes[0]!;

    const bySize = [
      ratioOf("s20", 128, 16, 0.75),
      ratioOf("s20", 256, 16, 0.8125),
      ratioOf("s20", 2048, 16, 0.8671875),
    ];
    const sizeSpread = (Math.max(...bySize) - Math.min(...bySize)) / bySize[0]!;

    expect(probeSpread).toBeGreaterThan(3.7e-4);
    expect(sizeSpread).toBeLessThan(2.5e-5);
    // An order of magnitude. The residual belongs to the along-seam probe grid,
    // not to the frame — which is why § 6bv.4's ranking inverts: the anisotropy
    // is the exact readout of the two, and the cost is the quantised one.
    expect(probeSpread / sizeSpread).toBeGreaterThan(10);

    const field = mosaicSeamShiftMm(LENS.s20, mosaicOptions(128, 16, { guardCells: 0.75 }));
    expect(field.atPx).toEqual({ x: 234, y: 114 });
  });
});

describe("§ 6bw.5 — the threshold is located outright, and there is exactly one", () => {
  it("§ 6bv's own four thresholds, to 2^-22 of a cell, inside § 6bv's own brackets", () => {
    for (const k of [1, 2, 4, 8]) {
      const i = LADDER_THRESHOLD[k]!;
      const lo = i / 2 ** 22;
      const hi = (i + 1) / 2 ** 22;
      const [bLo, bHi] = Q6BV_ANISO[k]!;
      expect(lo).toBeGreaterThan(bLo);
      expect(hi).toBeLessThanOrEqual(bHi);
      expect(ladderAnisoI(k, lo)).toBeGreaterThan(BRANCH_ANISO);
      expect(ladderAnisoI(k, hi)).toBeLessThan(BRANCH_ANISO);
    }
    // A million times finer than § 6bv's quarter cell, and § 6bv's brackets hold.
    expect(LADDER_THRESHOLD[1]! / 2 ** 22).toBeCloseTo(0.8996715545654297, 15);
    expect(LADDER_THRESHOLD[8]! / 2 ** 22).toBeCloseTo(5.952120304107666, 15);
  });

  it("and the readout falls through the branch's value once, across the WHOLE range", () => {
    // § 6bv.2 asserted monotonicity inside a four-point window, which makes a
    // straddling pair a crossing and not a sign change. Here the whole legal
    // guard range is walked, from a guard of 1/2^20 of a cell to one that eats
    // 95% of the tile, and it is strictly decreasing throughout — so the
    // crossing found above is the only one there is.
    const walk = [1, 100000, 300000, 500000, 745108, 745109, 900000, 2000000, 4000000, 8000000];
    let previous = Infinity;
    let crossings = 0;
    let above = true;
    for (const i of walk) {
      const v = bigAnisoI(16, i);
      expect(v).toBeLessThan(previous);
      if (above && v < BRANCH_ANISO) {
        crossings++;
        above = false;
      }
      previous = v;
    }
    expect(crossings).toBe(1);
  });
});

describe("§ 6bw.6 — the rungs between the four exist once the frame is untied", () => {
  it("the FRAME must be a power of two; the anchor need not, and they are not the same", () => {
    expect(() =>
      objectFieldTile(LENS.s20, {
        size: 384,
        pupilSamples: 48,
        wavelengthNm: DESIGN,
        centreMm: AXIS,
      }),
    ).toThrow(/frame size must be a power of two/);
    // § 6bv.7 read that refusal as a refusal of the ANCHOR. It is not: with a
    // power-of-two frame and a guard that lands whole, every one of these
    // pupil counts traces, including the odd ones and § 6bv.7's own k = 3.
    for (const ps of [17, 18, 20, 48, 80, 112]) {
      expect(() => anisoOf("s10", 4096, ps, ps / 64)).not.toThrow();
    }
  });

  it("§ 6bv.7's conclusion still holds for § 6bv's own family, and only there", () => {
    // In the ladder the frame IS `Q6BO*k`, so a rung between the four asks for a
    // frame that is not a power of two and is refused before a ray is traced.
    // The claim was true of its family and the reason given was the frame's.
    for (const k of [3, 5, 6, 7]) {
      expect(Number.isInteger(Math.log2(Q6BO.s20[0] * k))).toBe(false);
    }
    for (const k of [1, 2, 4, 8]) {
      expect(Number.isInteger(Math.log2(Q6BO.s20[0] * k))).toBe(true);
    }
    // And the anchor those rungs would have carried is reachable anyway.
    expect(PS_AT("s20", 48)).toBe(48);
    expect(PS_AT("f10", 48)).toBe(192);
  });
});

describe("§ 6bw.7 — the drift is a single hump, and it tracks the field", () => {
  const located = (j: number, i: number, x = 4): void => {
    expect(bigAnisoI(j, i, x)).toBeGreaterThan(BRANCH_ANISO);
    expect(bigAnisoI(j, i + 1, x)).toBeLessThan(BRANCH_ANISO);
  };

  it("the guard's share of the tile rises, turns near k = 4.375, and falls", () => {
    const share: Record<number, number> = {};
    for (const j of [16, 32, 48, 64, 70, 80, 96, 112, 128]) {
      const i = BIG_THRESHOLD[j]!;
      located(j, i);
      share[j] = guardShare(j, i);
    }
    // Rising to the turn.
    for (const [a, b] of [
      [16, 32],
      [32, 48],
      [48, 64],
      [64, 70],
    ] as const) {
      expect(share[b]!).toBeGreaterThan(share[a]!);
    }
    // Falling after it.
    for (const [a, b] of [
      [70, 80],
      [80, 96],
      [96, 112],
      [112, 128],
    ] as const) {
      expect(share[b]!).toBeLessThan(share[a]!);
    }
    expect(share[16]!).toBeCloseTo(0.08882379531860352, 12);
    expect(share[70]!).toBeCloseTo(0.09649312496185303, 12);
    expect(share[128]!).toBeCloseTo(0.08971536159515381, 12);
    // 8.6% from the first rung to the peak — and the two ENDS are level to 1%,
    // which is the accident that made § 6bv's growth factor look like a ladder
    // between § 6bu's two. It is not a ladder; it is a hump sampled at four
    // points, one of which sits on the turn.
    expect(share[70]! / share[16]!).toBeCloseTo(1.0863, 4);
    expect(share[128]! / share[16]!).toBeCloseTo(1.01003, 4);
  });

  it("the turn is a real maximum on the 1/16 grid, not the coarse grid's guess", () => {
    for (const j of [69, 70, 71]) located(j, BIG_THRESHOLD[j]!);
    const at = (j: number): number => guardShare(j, BIG_THRESHOLD[j]!);
    expect(at(70)).toBeGreaterThan(at(69));
    expect(at(70)).toBeGreaterThan(at(71));
    // The peak is flat: its neighbours a sixteenth of a rung away differ in the
    // sixth digit. That flatness is why four powers of two could not see it.
    expect(at(70) - at(71)).toBeLessThan(1e-5);
  });

  it("and it moves with the field offset, at 0.511 to 0.515 of it", () => {
    const HALF_AT_K1 = 0.46769328761900353;
    const peaks: Array<readonly [number, number]> = [
      [2, 35],
      [4, 70],
      [5, 88],
    ];
    for (const [x, jPeak] of peaks) {
      const table = x === 4 ? BIG_THRESHOLD : BIG_THRESHOLD_AT[x]!;
      const at = (j: number): number => {
        const i = table[j]!;
        located(j, i, x);
        return guardShare(j, i);
      };
      const step = x === 4 ? 1 : 1;
      expect(at(jPeak)).toBeGreaterThan(at(jPeak - step));
      expect(at(jPeak)).toBeGreaterThan(at(jPeak + step));
      // The tile half extent at the peak, against the mosaic's own offset.
      const ratio = (HALF_AT_K1 * (jPeak / 16)) / x;
      expect(ratio).toBeGreaterThan(0.511);
      expect(ratio).toBeLessThan(0.515);
    }
    // Not one half. 0.5115 is 2.3% off 0.5, and the 1/16 grid resolves 1% here,
    // so the difference is measured rather than assumed. No closed form is
    // offered for it.
    expect((HALF_AT_K1 * (70 / 16)) / 4).toBeCloseTo(0.5115395333332851, 15);
    expect(Math.abs((HALF_AT_K1 * (70 / 16)) / 4 - 0.5)).toBeGreaterThan(0.011);
  });
});
