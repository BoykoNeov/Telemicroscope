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
 * § 6bu — § 6bs.7's anchor ladder moves a second thing, and it is the bigger one.
 *
 * § 6bs.7 walked the registration cost and its anisotropy over four anchor
 * fields, `size` and `pupilSamples` scaled together so the pixel pitch is held
 * and the field extent is what moves. Both curves came out monotone and rising
 * — 0.79487, 0.94043, 0.98632, 1.00480 and 0.78623, 0.92855, 0.97110, 0.98531
 * — and at the top rung two verdicts failed: the cost stopped crossing 1, so
 * § 6bo.2's reversal was gone, and the anisotropy's distance from 1 fell below
 * the branch's, so "understated" became its opposite. That rung, 3.7415 mm, is
 * also where § 6br.6 found the escape falling by 3× for a reason it could not
 * name, and § 6bs.7 published the coincidence as an open question: three
 * readouts misbehaving at one anchor, none of the three explained.
 *
 * ## The ladder is not a one-parameter family
 *
 * `guardCells` is a count of RESOLUTION CELLS, and a cell is `size /
 * pupilSamples` pixels. The ladder holds that ratio — that is what holding the
 * pixel pitch means — so the guard is a constant number of PIXELS at every
 * rung while the tile grows around it. The share of each tile that survives the
 * guard therefore climbs with the rung, and it climbs from four different
 * starting points because the four cells do not share a `size / pupilSamples`:
 * the slow 20× discards 51.6% of its tile at the first rung and 6.4% at the
 * last, the other three 26.6% falling to 3.3%. The readout is a double ratio
 * across exactly those four cells.
 *
 * So there are two levers in the ladder, not one, and § 6bu.2 measures which is
 * doing the work: at the single anchor 3.7415 mm, moving only the guard walks
 * the cost from 1.00480 to 0.65214 and the anisotropy from 0.98531 to 0.71250,
 * which covers the whole four-rung ladder on both readouts and then some. Every
 * guard in that sweep is at least the branch's own four cells — larger is a more
 * conservative mosaic, never a less valid one — so nothing in it is a mosaic
 * that could not be built.
 *
 * ## What that does to the two verdicts
 *
 * Both of them move with the guard at a FIXED anchor (§ 6bu.3). At 3.7415 mm a
 * guard of six cells puts the cost back below 1 at 0.99270 and the anisotropy's
 * growth back above 1 at 1.00908. Neither reading is the true one: 1.00480 and
 * 0.99270 are the same readout at the same anchor under two legitimate guards.
 * What the pair shows is that **the verdict is a property of the (anchor, guard
 * share) pair and not of the anchor**, so § 6bs.7's ladder is not an anchor
 * derivative of this readout — the same objection § 6bs.8 raises against reading
 * § 6bq.7's quotient as one, arrived at the same way, by measurement.
 *
 * § 6bs.7 is not thereby wrong about its own construction. `guardCells` in
 * resolution cells is the physical variable — it is what has to contain the PSF
 * wrap, § 6bh.4 — and four was the right count. Holding it is what a physicist
 * does; it is simply not the same thing as holding the geometry, and the ladder
 * cannot hold both while `size` changes.
 *
 * ## Two verdicts, two thresholds — and no shared mechanism is needed
 *
 * The tempting next sentence is that one lever flips both verdicts together.
 * § 6bu.4 refuses it: at 1.8708 mm with a guard of three cells the cost reads
 * 0.99768, still crossing and still reversed, while the anisotropy's growth is
 * already 0.89843 and has inverted. Two readouts, two nearby thresholds.
 *
 * The dissolution does not need them to share one. Both interactions converge
 * monotonically toward 1 in this variable, and both verdicts are tests of where
 * a number sits relative to 1 — a crossing for one, a distance for the other —
 * so any parameter that walks both toward 1 must trip both in the same
 * neighbourhood. That is close to arithmetic, and it is the whole of why the two
 * failures share a rung.
 *
 * ## What the anchor is actually worth
 *
 * § 6bu.5 holds the share instead and walks the anchor over the same 8×: the
 * cost moves 0.79487 → 0.76594, 3.64%, and the wrong way — away from 1, where
 * the published ladder moves 26.4% toward it. The anisotropy moves 2.98%. The
 * anchor is a second-order term in both readouts and the guard share is the
 * first-order one, which is the reverse of how § 6bs.7's table reads.
 *
 * ## The axis, refused
 *
 * There is a second candidate at that rung and it is a good-looking one. The
 * mosaic's image-plane footprint first contains the optical axis at exactly the
 * top rung, for all four cells at once: at 1.8708 mm the leading tile clears the
 * axis by 0.0436 to 0.2443 mm, and at 3.7415 mm its own CENTRE has crossed to
 * −1.1253 … −1.3051 mm. One anchor, four cells, a qualitative change in what the
 * objective's radial map is being asked about.
 *
 * § 6bu.6 refuses it on both halves. It is not sufficient: the held-share ladder
 * crosses the axis just as hard at that rung (−1.4677 to −3.4124 mm) and reads
 * 0.76594, nowhere near 1. And it is not necessary: moved out to a centre of
 * 9 mm the footprint clears the axis on all four cells, by 0.9529 mm at the
 * closest, and the cost still reads 1.00976 with the anisotropy still inverted.
 * A cause that is neither is not the cause.
 *
 * Nine millimetres and not a round eight because eight does not qualify: two of
 * the four cells still cross there, by 0.0441 and 0.0107 mm. Nor ten, which the
 * chief ray refuses (§ 6bu.7). The one centre that clears all four is the last
 * one that exists.
 *
 * ## What this does not reach
 *
 * The escape. § 6br.6's readout has no guard share to sweep: it renders at twice
 * its `size` and counts the intensity outside the central `size` box, so its
 * discarded annulus is half the rendered width at every rung by construction.
 * This account cannot touch it, and the third misbehaviour at 3.7415 mm stays
 * exactly as open as § 6br.6 left it. For the two readouts here the shared
 * address was a coincidence — they misbehave at that rung because their own
 * ladder swept their guard share past a threshold, and the escape's ladder does
 * not sweep anything of the kind.
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

/** § 6bn.1's device: the render-free grid is read at a stage of ZERO, because
 *  `mosaicSeamShiftMm` does no render and a focus stage cannot enter it. */
const FREE_STAGE: TileStageMm = () => 0;

/** § 6bs's own options, with the two things this step varies left open. */
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

/** § 6bo.2's `CELLS_MATCHED`: `pupilSamples` as NA / M puts all four at one
 *  field, and `size` fixes the pixel pitch beside it. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};

/** The branch's single sampling, unchanged from § 6bk through § 6bn. */
const BRANCH_SHAPE: readonly [number, number] = [128, 32];

const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

interface Cost {
  readonly ratio: number;
  readonly aniso: number;
}

/** What varies in this step, beside the rung: the guard, and where the mosaic
 *  sits. Both default to § 6bs.7's own choice. */
interface Knobs {
  readonly guardCells?: number;
  readonly centreX?: number;
}

const knobsOf = (kn: Knobs): Partial<FluorescenceMosaicOptions> => ({
  ...(kn.guardCells === undefined ? {} : { guardCells: kn.guardCells }),
  ...(kn.centreX === undefined ? {} : { centreMm: { x: kn.centreX, y: 0 } }),
});

/** § 6bj's registration cost and its anisotropy — geometry only, no render. */
function measure(system: OpticalSystem, size: number, ps: number, kn: Knobs): Cost {
  const over = knobsOf(kn);
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps, over));
  const scan = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { ...over, scan: "stage" }));
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
}

/** The whole file is one memo: a rung asks for quartets the rung before it
 *  already paid for, and each is four traced grids. */
const held = new Map<string, Cost>();
function cell(c: Cell, size: number, ps: number, kn: Knobs = {}): Cost {
  const key = `${c}|${size}|${ps}|${kn.guardCells ?? 4}|${kn.centreX ?? ANCHOR}`;
  let v = held.get(key);
  if (v === undefined) {
    v = measure(LENS[c], size, ps, kn);
    held.set(key, v);
  }
  return v;
}

/** § 6bs.7's anchor family: Q6BO's shape scaled by `k` in BOTH size and
 *  `pupilSamples`, which moves the common field and holds the pixel pitch. */
const quartet = (k: number, kn: Knobs = {}): Record<Cell, Cost> =>
  Object.fromEntries(CELLS.map((c) => [c, cell(c, Q6BO[c][0] * k, Q6BO[c][1] * k, kn)])) as Record<
    Cell,
    Cost
  >;

const branchQuartet = (): Record<Cell, Cost> =>
  Object.fromEntries(
    CELLS.map((c) => [c, cell(c, BRANCH_SHAPE[0], BRANCH_SHAPE[1])]),
  ) as Record<Cell, Cost>;

/** § 6bm's interaction: the aperture lever at the high M over the same at the low. */
const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
/** The same, as a departure from 1 in whichever direction it departs. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

const costI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.ratio, q.f10.ratio, q.s20.ratio, q.f20.ratio);
const anisoI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.aniso, q.f10.aniso, q.s20.aniso, q.f20.aniso);

/** § 6bo's and § 6bp's measure, against the branch's own column — read from
 *  source and not from § 6bs.1's published rounding of it. */
const anisoGrowth = (q: Record<Cell, Cost>): number =>
  (departure(anisoI(q)) - 1) / (departure(anisoI(branchQuartet())) - 1);

const anchorOf = (k: number): number =>
  objectFieldTile(LENS.s20, {
    size: Q6BO.s20[0] * k,
    pupilSamples: Q6BO.s20[1] * k,
    wavelengthNm: DESIGN,
    centreMm: AXIS,
  }).halfExtentMm;

const geometryOf = (c: Cell, k: number, kn: Knobs = {}) =>
  fluorescenceMosaicGeometry(
    LENS[c],
    mosaicOptions(Q6BO[c][0] * k, Q6BO[c][1] * k, knobsOf(kn)),
  );

/** Share of a tile that survives its own guard — `keptPixels / tileSize`. */
const keptShare = (c: Cell, k: number, kn: Knobs = {}): number => {
  const g = geometryOf(c, k, kn);
  return g.keptPixels / g.tileSize;
};

/** The image-plane x of the leading tile's outer edge: `centresMm[0]` less that
 *  tile's own half-width. Below zero, the mosaic contains the optical axis. */
const footprintMinX = (c: Cell, k: number, kn: Knobs = {}): number => {
  const g = geometryOf(c, k, kn);
  return g.centresMm[0]!.x - (g.tileSize / 2) * g.pixelScaleMm;
};

const KS = [1, 2, 4, 8] as const;

describe("§ 6bu.1 — the anchor ladder holds the guard's PIXELS, so its SHARE sweeps", () => {
  it("the guard is a constant pixel count at every rung, and two counts across the four cells", () => {
    // `guardCells · size / pupilSamples`, and the ladder holds `size /
    // pupilSamples`. The slow 20x is the odd cell: Q6BO gives it 8 pixels per
    // resolution cell where the other three get 4.
    for (const k of KS) {
      expect(geometryOf("s20", k).guardPixels).toBe(32);
      for (const c of ["s10", "f10", "f20"] as const) expect(geometryOf(c, k).guardPixels).toBe(16);
    }
  });

  it("so the share kept climbs from 0.4844 to 0.9355 on one cell and 0.7344 to 0.9668 on two", () => {
    expect(KS.map((k) => keptShare("s20", k))).toEqual([
      0.484375, 0.7421875, 0.87109375, 0.935546875,
    ]);
    expect(KS.map((k) => keptShare("s10", k))).toEqual([
      0.734375, 0.8671875, 0.93359375, 0.966796875,
    ]);
    // f20 shares s10's shape exactly, and f10 is s10's next rung throughout.
    expect(KS.map((k) => keptShare("f20", k))).toEqual(KS.map((k) => keptShare("s10", k)));
    expect(KS.slice(0, 3).map((k) => keptShare("f10", k))).toEqual(
      KS.slice(1).map((k) => keptShare("s10", k)),
    );

    // The DISCARDED share falls by exactly 8x on all four, which is what the
    // section claims and is not free: `kept = size − 2·guard − 2·cropped` with
    // `cropped` a constant 1, so the −2 term has to cancel for the ratio to come
    // out on the nose. It does at these sizes; asserted on every cell rather
    // than on the two the prose happens to quote.
    for (const c of CELLS) {
      const first = keptShare(c, 1);
      const last = keptShare(c, 8);
      expect((1 - first) / (1 - last)).toBeCloseTo(8.0, 9);
    }
  });
});

describe("§ 6bu.2 — at ONE anchor the guard alone spans the whole published ladder", () => {
  const GUARDS = [4, 6, 8, 16, 24, 32, 40] as const;

  it("the cost walks 1.00480 to 0.65214 at 3.7415 mm, on guards no smaller than the branch's", () => {
    expect(anchorOf(8)).toBeCloseTo(3.7415463009520282, 12);
    const costs = GUARDS.map((g) => costI(quartet(8, { guardCells: g })));
    expect(costs[0]!).toBeCloseTo(1.0048044909202725, 12);
    expect(costs[1]!).toBeCloseTo(0.992703686090584, 12);
    expect(costs[2]!).toBeCloseTo(0.9800800175097888, 12);
    expect(costs[3]!).toBeCloseTo(0.923365846634545, 12);
    expect(costs[4]!).toBeCloseTo(0.8537516487713016, 12);
    expect(costs[5]!).toBeCloseTo(0.7659438942044383, 12);
    expect(costs[6]!).toBeCloseTo(0.6521400275797776, 12);
    for (let i = 1; i < GUARDS.length; i++) expect(costs[i]!).toBeLessThan(costs[i - 1]!);

    // § 6bs.7's four rungs read 0.79487 … 1.00480. One anchor and one knob
    // cover that interval and overshoot its low end by 17.9%.
    expect(costs[0]!).toBeGreaterThan(1.0048044909202725 - 1e-12);
    expect(costs.at(-1)!).toBeLessThan(0.7948724057562382);
    expect(0.7948724057562382 / costs.at(-1)!).toBeCloseTo(1.21886769, 8);
  });

  it("and the anisotropy walks 0.98531 to 0.71250 over the same guards", () => {
    const anisos = GUARDS.map((g) => anisoI(quartet(8, { guardCells: g })));
    expect(anisos[0]!).toBeCloseTo(0.9853104600763398, 12);
    expect(anisos[1]!).toBeCloseTo(0.9770580095880759, 12);
    expect(anisos[2]!).toBeCloseTo(0.9684226376063382, 12);
    expect(anisos[3]!).toBeCloseTo(0.9289665582722904, 12);
    expect(anisos[4]!).toBeCloseTo(0.878230670405621, 12);
    expect(anisos[5]!).toBeCloseTo(0.8096168829705173, 12);
    expect(anisos[6]!).toBeCloseTo(0.7125048606483599, 12);
    for (let i = 1; i < GUARDS.length; i++) expect(anisos[i]!).toBeLessThan(anisos[i - 1]!);
    // § 6bs.7's four rungs read 0.78623 … 0.98531; the sweep covers that too.
    expect(anisos.at(-1)!).toBeLessThan(0.7862300730210287);
  });

  it("every guard in the sweep is at least the branch's four cells", () => {
    // Which is what makes the sweep legitimate rather than a probe of mosaics
    // nobody could build: a LARGER guard discards more and contains more, and
    // § 6bh.4's requirement is a floor. The floor itself is a real one — a
    // guard that eats the tile is refused, and at the first rung eight cells
    // already does.
    for (const g of GUARDS) expect(g).toBeGreaterThanOrEqual(4);
    expect(() => quartet(1, { guardCells: 8 })).toThrow(/eats the whole 128-pixel tile/);
  });
});

describe("§ 6bu.3 — so both of § 6bs.7's failed verdicts move with the guard, at a fixed anchor", () => {
  it("six cells at 3.7415 mm puts the cost back below 1 — and neither reading is the true one", () => {
    // Down the branch's path the cost is above 1; § 6bo.2's reversal is that
    // the matched column falls below it. At this anchor the verdict depends on
    // the guard and not on the anchor: four cells says no crossing, six says
    // crossing, and both are mosaics that could be built.
    expect(costI(branchQuartet())).toBeCloseTo(1.0416580962373136, 12);
    expect(costI(quartet(8, { guardCells: 4 }))).toBeGreaterThan(1);
    expect(costI(quartet(8, { guardCells: 6 }))).toBeCloseTo(0.992703686090584, 12);
    expect(costI(quartet(8, { guardCells: 6 }))).toBeLessThan(1);
  });

  it("and puts the anisotropy's growth back above 1, from 0.64070 to 1.00908", () => {
    expect(anisoGrowth(quartet(8, { guardCells: 4 }))).toBeCloseTo(0.640695891266414, 12);
    expect(anisoGrowth(quartet(8, { guardCells: 6 }))).toBeCloseTo(1.0090846107688471, 12);
    expect(anisoGrowth(quartet(8, { guardCells: 4 }))).toBeLessThan(1);
    expect(anisoGrowth(quartet(8, { guardCells: 6 }))).toBeGreaterThan(1);
  });

  it("the converse, at the branch's OWN anchor — geometry only, not a renderable mosaic", () => {
    // Half a resolution cell of guard is below § 6bh.4's floor and would not
    // contain a PSF wrap. `mosaicSeamShiftMm` renders nothing, so the reading
    // exists; it is quoted as the extension it is, and § 6bu.2 and § 6bu.3 do
    // not rest on it. What it adds: both verdicts fail at 0.4677 mm too, 8x
    // below the anchor § 6bs.7 attributed them to.
    const q = quartet(1, { guardCells: 0.5 });
    expect(keptShare("s20", 1, { guardCells: 0.5 })).toBeCloseTo(0.921875, 12);
    expect(costI(q)).toBeCloseTo(1.0160990060983277, 12);
    expect(costI(q)).toBeGreaterThan(1);
    expect(anisoGrowth(q)).toBeCloseTo(0.3650510121452169, 12);
    expect(anisoGrowth(q)).toBeLessThan(1);
  });
});

describe("§ 6bu.4 — two verdicts, two thresholds: they do not flip together", () => {
  it("at 1.8708 mm a guard of three has inverted the anisotropy and NOT the cost", () => {
    expect(anchorOf(4)).toBeCloseTo(1.8707731504760141, 12);
    const q = quartet(4, { guardCells: 3 });
    // Still crossing, so § 6bo.2's reversal still stands here...
    expect(costI(q)).toBeCloseTo(0.9976792616666094, 12);
    expect(costI(q)).toBeLessThan(1);
    // ...while the understatement has already become its opposite.
    expect(anisoGrowth(q)).toBeCloseTo(0.8984323273066489, 12);
    expect(anisoGrowth(q)).toBeLessThan(1);
  });

  it("one cell further out both hold, so the two thresholds bracket the same narrow band", () => {
    const q = quartet(4, { guardCells: 4 });
    expect(costI(q)).toBeCloseTo(0.9863246838710185, 12);
    expect(anisoGrowth(q)).toBeCloseTo(1.279006277961586, 12);
    expect(costI(q)).toBeLessThan(1);
    expect(anisoGrowth(q)).toBeGreaterThan(1);

    // Which is the whole reason the two failed at one rung and needs no shared
    // mechanism: both interactions converge toward 1 in this variable, and both
    // verdicts test position relative to 1, so any parameter that walks them
    // there trips both nearby. The share at the two guards differs by 3.1%.
    expect(keptShare("s20", 4, { guardCells: 3 })).toBeCloseTo(0.90234375, 12);
    expect(keptShare("s20", 4, { guardCells: 4 })).toBeCloseTo(0.87109375, 12);
  });
});

describe("§ 6bu.5 — hold the share instead, and the anchor is worth 3.64% over 8x", () => {
  /** `guardCells` scaled with the rung holds the share where the ladder sweeps
   *  it — the guard is then a constant FRACTION of the tile instead of a
   *  constant pixel count. Neither is more correct; they differ in what they
   *  hold, and § 6bu.2 shows the difference is not small. */
  const heldShare = (k: number): Record<Cell, Cost> => quartet(k, { guardCells: 4 * k });

  it("the share really is held — 0.4844 to 0.4980 across the four rungs", () => {
    const shares = KS.map((k) => keptShare("s20", k, { guardCells: 4 * k }));
    expect(shares).toEqual([0.484375, 0.4921875, 0.49609375, 0.498046875]);
    // Against 0.4844 → 0.9355 when the pixel count is what is held.
    expect(shares.at(-1)! / shares[0]!).toBeCloseTo(1.02822581, 8);
  });

  it("and then the cost moves 3.64% over the same 8x of anchor — away from 1, not toward it", () => {
    const costs = KS.map((k) => costI(heldShare(k)));
    expect(costs[0]!).toBeCloseTo(0.7948724057562382, 12);
    expect(costs[1]!).toBeCloseTo(0.7901972721232622, 12);
    expect(costs[2]!).toBeCloseTo(0.781839732167451, 12);
    expect(costs[3]!).toBeCloseTo(0.7659438942044383, 12);
    for (let i = 1; i < KS.length; i++) expect(costs[i]!).toBeLessThan(costs[i - 1]!);
    expect(1 - costs.at(-1)! / costs[0]!).toBeCloseTo(0.03639391, 8);

    // § 6bs.7's published ladder moves 26.4% over those same four rungs, and
    // the other way. The first rung is common to both: it is the one rung where
    // holding the count and holding the share are the same thing.
    expect(1.0048044909202725 / 0.7948724057562382 - 1).toBeCloseTo(0.26410790, 8);
    expect(costs[0]!).toBeCloseTo(0.7948724057562382, 12);
  });

  it("and the anisotropy 2.98%, with no inversion anywhere on the ladder", () => {
    const anisos = KS.map((k) => anisoI(heldShare(k)));
    expect(anisos[0]!).toBeCloseTo(0.7862300730210287, 12);
    expect(anisos[1]!).toBeCloseTo(0.7922972976936977, 12);
    expect(anisos[2]!).toBeCloseTo(0.8017441206775986, 12);
    expect(anisos[3]!).toBeCloseTo(0.8096168829705173, 12);
    expect(anisos.at(-1)! / anisos[0]! - 1).toBeCloseTo(0.02974550, 8);
    for (const k of KS) expect(anisoGrowth(heldShare(k))).toBeGreaterThan(1);

    // Neither failure survives holding the share, which is the same statement
    // as § 6bu.3's from the other side.
    for (const k of KS) expect(costI(heldShare(k))).toBeLessThan(1);
  });

  it("matched shares at different anchors land on nearly the same reading", () => {
    // 0.7344 at 0.4677 mm against 0.7422 at 0.9354 mm: two anchors a factor of
    // two apart, agreeing to 0.59% where the ladder between those same two
    // rungs reports 18.3%.
    const near = costI(quartet(1, { guardCells: 2 }));
    const far = costI(quartet(2, { guardCells: 4 }));
    expect(keptShare("s20", 1, { guardCells: 2 })).toBeCloseTo(0.734375, 12);
    expect(keptShare("s20", 2, { guardCells: 4 })).toBeCloseTo(0.7421875, 12);
    expect(near).toBeCloseTo(0.9459949368242533, 12);
    expect(far).toBeCloseTo(0.9404251685564944, 12);
    expect(Math.abs(near / far - 1)).toBeCloseTo(0.00592261, 8);
    expect(0.9404251685564944 / 0.7948724057562382 - 1).toBeCloseTo(0.18311463, 8);
  });
});

describe("§ 6bu.6 — the axis crossing lands at the same rung, and is refused as the cause", () => {
  it("the footprint first contains the axis at 3.7415 mm, on all four cells at once", () => {
    // At the rung below, every cell's leading tile is clear of the axis...
    expect(footprintMinX("s10", 4)).toBeCloseTo(0.07313591215615434, 12);
    expect(footprintMinX("f10", 4)).toBeCloseTo(0.043561095814932616, 12);
    expect(footprintMinX("s20", 4)).toBeCloseTo(0.24433090777889088, 12);
    expect(footprintMinX("f20", 4)).toBeCloseTo(0.13310967116781058, 12);
    for (const c of CELLS) expect(footprintMinX(c, 4)).toBeGreaterThan(0);

    // ...and at the top rung not only the edge but the tile's own CENTRE has
    // crossed to the far side of it.
    expect(footprintMinX("s10", 8)).toBeCloseTo(-4.03562651218182, 12);
    expect(footprintMinX("f10", 8)).toBeCloseTo(-4.002437677040103, 12);
    expect(footprintMinX("s20", 8)).toBeCloseTo(-3.864435278582664, 12);
    expect(footprintMinX("f20", 8)).toBeCloseTo(-3.912900918127995, 12);
    for (const c of CELLS) {
      expect(footprintMinX(c, 8)).toBeLessThan(0);
      expect(geometryOf(c, 8).centresMm[0]!.x).toBeLessThan(0);
    }
    expect(geometryOf("s20", 8).centresMm[0]!.x).toBeCloseTo(-1.1252578210082937, 12);
    expect(geometryOf("f10", 8).centresMm[0]!.x).toBeCloseTo(-1.3051051618034126, 12);
  });

  it("but it is not SUFFICIENT: the held-share ladder crosses just as hard and reads 0.76594", () => {
    for (const c of CELLS) expect(footprintMinX(c, 8, { guardCells: 32 })).toBeLessThan(0);
    expect(footprintMinX("s20", 8, { guardCells: 32 })).toBeCloseTo(-1.4676550032050906, 12);
    expect(footprintMinX("f10", 8, { guardCells: 32 })).toBeCloseTo(-3.412396189332077, 12);
    expect(costI(quartet(8, { guardCells: 32 }))).toBeCloseTo(0.7659438942044383, 12);
    expect(costI(quartet(8, { guardCells: 32 }))).toBeLessThan(1);
  });

  it("and not NECESSARY: at a centre of 9 mm nothing crosses and both verdicts still fail", () => {
    for (const c of CELLS) expect(footprintMinX(c, 8, { centreX: 9 })).toBeGreaterThan(0.9);
    expect(footprintMinX("s10", 8, { centreX: 9 })).toBeCloseTo(0.952858, 5);
    expect(footprintMinX("s20", 8, { centreX: 9 })).toBeCloseTo(1.124253, 5);
    const q = quartet(8, { centreX: 9 });
    expect(costI(q)).toBeCloseTo(1.0097565736250889, 12);
    expect(costI(q)).toBeGreaterThan(1);
    expect(anisoGrowth(q)).toBeCloseTo(0.5868041161174857, 12);
    expect(anisoGrowth(q)).toBeLessThan(1);
  });

  it("nine and not eight: at 8 mm two of the four cells are still across the axis", () => {
    // The rung above uses 9 mm because 8 mm does not actually qualify — and the
    // near miss is worth pinning, since 8 is the number a reader would reach
    // for and the reading there (1.00902) tells the same story anyway.
    expect(footprintMinX("s10", 8, { centreX: 8 })).toBeCloseTo(-0.044136, 5);
    expect(footprintMinX("f10", 8, { centreX: 8 })).toBeCloseTo(-0.010735, 5);
    expect(footprintMinX("s20", 8, { centreX: 8 })).toBeCloseTo(0.12720726512900438, 12);
    expect(footprintMinX("f20", 8, { centreX: 8 })).toBeCloseTo(0.078821, 5);
    expect(costI(quartet(8, { centreX: 8 }))).toBeCloseTo(1.0090232409736555, 12);
  });
});

describe("§ 6bu.7 — 3.7415 mm is the last rung that EXISTS, not the last one chosen", () => {
  it("a fifth rung is refused by the chief ray, at an image radius of 18.286 mm", () => {
    expect(() => quartet(16)).toThrow(/no object height reaches image radius 18\.28636/);
    expect(() => quartet(16)).toThrow(/chief ray failed \(vignetted\)/);
  });

  it("and so is § 6bu.6's centre sweep past 9 mm", () => {
    // Which is why that rung is measured at 9 and not further out: the same
    // field limit, reached from the other direction. Nine is therefore the only
    // centre available that clears the axis on all four cells.
    expect(() => quartet(8, { centreX: 10 })).toThrow(
      /no object height reaches image radius 17\.88946/,
    );
    expect(() => quartet(8, { centreX: 12 })).toThrow(
      /no object height reaches image radius 19\.15388/,
    );
  });
});
