import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6bs — § 6bn's six interactions in one table, and what they say together.
 *
 * § 6bn gave six readouts a second magnification interval and published six
 * quotients. § 6bo found that a tile's field of view goes as M / NA, so all six
 * had moved the field as well as the lever they named, and re-measurement at a
 * matched field followed across three steps: § 6bo took the registration cost,
 * the anisotropy and the plateau, § 6bp the two splits, § 6br the guard-band
 * escape. Nothing has put the six side by side, and a caller asking "which of
 * these readings can I trust?" has had to read five steps to find out.
 *
 * This step is that table. It rebuilds the two render-free interactions from
 * source — § 6bo.2's `CELLS_MATCHED` is geometry, not a render, and costs under
 * a second — and cites the four that are renders or sweeps, each at the exact
 * digits its own step pinned.
 *
 * ## The tally, and the sentence that got it wrong
 *
 * § 6br's own "Still open" note summarised the six as "two reversed, two
 * understated and two refused, and this one is understated". Measured, it is
 * ONE reversed, FOUR understated, ONE unchanged and NONE refused. That sentence
 * is wrong twice: the anisotropy is not a reversal — § 6bo.2 says "without
 * crossing" in the same breath — and the two refusals it imports are § 6bp's
 * free-field gain at the edge and its scanner comparison, which are not among
 * § 6bn's six at all. A prose tally is what drifted, so § 6bs.2 computes the
 * tally from the six pairs rather than restating it.
 *
 * ## The one thing the six say together
 *
 * At a matched field every one of the six is BELOW 1. Down the branch's path
 * five were and the registration cost was not, so the correction is what makes
 * the set unanimous — which no single step was in a position to see.
 *
 * The statement is kept formal: the aperture ratio at 20x is smaller than the
 * aperture ratio at 10x, on all six readouts. It is NOT glossed as "the aperture
 * lever is weaker at 20x", because the levers do not share a side of 1. The
 * escape's are 12.93 and 31.46, both above it; the registration cost's at the
 * same matched field are 0.506 and 0.637, both below it — where a smaller ratio
 * is a LARGER effect in the other direction. § 6bs.5 pins both, so the unanimity
 * is published as the sign fact it is and not as a mechanism.
 *
 * ## Three anchors, not one
 *
 * "At a matched field" fixes the four cells' field RATIOS and leaves the common
 * field free, and the three steps each chose differently:
 *
 * | anchor half-extent | whose
 * | --- | --- |
 * | 0.46769329 mm | the cost, the anisotropy and both splits (§ 6bo.2, § 6bp)
 * | 0.70153993 mm | the plateau — its sweep samples at 48 where the rest use 32
 * | 0.93538658 mm | the escape (§ 6br)
 *
 * A ratio of 1 : 1.5 : 2. § 6br.6 then measured what that choice is worth on one
 * readout and found the escape's quotient turns over on it, so the six are being
 * compared across a parameter known to move at least one of them.
 *
 * Five of the six go onto one anchor today: § 6br.6 already published the escape
 * at 0.46769329 mm, where it reads 0.3596838 instead of 0.4108834. The tally
 * does not change (§ 6bs.4). Only the plateau cannot be moved without new
 * sweeps.
 *
 * ## Two growth measures, two orderings
 *
 * § 6bo and § 6bp reported how far a correction moved a quotient as
 * `(dep(matched) - 1) / (dep(branch) - 1)`, the growth of its distance from 1.
 * § 6br reported `dep(matched) / dep(branch)`. Both are internally consistent,
 * they are not the same number, and the four understated readouts rank in
 * OPPOSITE orders under them: the escape is the largest correction on § 6br's
 * measure and the smallest on § 6bo's, trading ends with the edge split.
 * § 6bs.6 publishes both columns. This is a comparability defect between steps,
 * not an arithmetic error inside either of them.
 *
 * ## The anchor sensitivity is not the escape's alone
 *
 * § 6br measured its anchor family for the escape and deliberately declined to
 * generalise. Generalised here for the two readouts that cost nothing: over the
 * same anchor ladder the registration cost runs 0.79487, 0.94043, 0.98632,
 * 1.00480 and the anisotropy 0.78623, 0.92855, 0.97110, 0.98531 — both monotone
 * and rising, where the escape's was single-humped. Three readouts, three
 * shapes.
 *
 * Two verdicts fail at the top of that ladder. At 3.74 mm the cost no longer
 * crosses 1, so § 6bo.2's headline reversal is gone; and the anisotropy's
 * distance from 1 has fallen BELOW the branch's, so "understated" becomes its
 * opposite. Both hold at 0.4677, 0.9354 and 1.8708 — through 4x the anchor the
 * six are quoted at and 2x past the widest of them — and both fail at 3.7415,
 * which is also where § 6br.6 found the escape falling for a reason it could not
 * name. Three readouts misbehaving at one anchor, and none of the three
 * explained.
 *
 * ## The survivor is the least secure row, not the most
 *
 * § 6bo.2 let the plateau's interaction survive at 0.89% and gave a reason: it
 * is "the one readout § 6bo.5 measures to be field-free". § 6bq.7 withdrew that
 * — a uniform 2x frame change moves the plateau 0.66% to 15.55% across seven
 * apertures, and NA 0.20, one of the interaction's own two, moves 4.756%, which
 * is 5.3x the margin the interaction survived by. The verdict stands as a direct
 * measurement of two columns. Its stated reason does not, and whether it
 * survives a clean anchor change is unmeasured — § 6bq.7 doubles each lens's own
 * frame, so its two cells land on different common fields and it cannot be read
 * as an anchor derivative of the quotient (§ 6bs.8).
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

const stage = (mm: number): TileStageMm => () => mm;

/** § 6bn.1's device: the render-free grid is read at a stage of ZERO, because
 *  `mosaicSeamShiftMm` does no render and a focus stage cannot enter it. */
const FREE_STAGE = stage(0);

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

interface Cost {
  readonly ratio: number;
  readonly aniso: number;
}

/** § 6bj's registration cost and its anisotropy — geometry only, no render. */
function cost(system: OpticalSystem, size: number, ps: number): Cost {
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps));
  const scan = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { scan: "stage" }));
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
}

const extentOf = (system: OpticalSystem, size: number, ps: number): number =>
  objectFieldTile(system, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS })
    .halfExtentMm;

type Cell = "s10" | "f10" | "s20" | "f20";

const LENS: Record<Cell, OpticalSystem> = {
  s10: build(10, 0.1),
  f10: build(10, 0.2),
  s20: build(20, 0.1),
  f20: build(20, 0.2),
};

/** § 6bo.2's `CELLS_MATCHED`, which is § 6bp's Q6BO: `pupilSamples` as NA / M
 *  puts all four at one field, and `size` fixes the pixel pitch beside it. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};

/** The branch's single sampling, unchanged from § 6bk through § 6bn. */
const BRANCH_SHAPE: readonly [number, number] = [128, 32];

const held = new Map<string, Cost>();
function cell(c: Cell, size: number, ps: number): Cost {
  const key = c + "|" + size + "|" + ps;
  let v = held.get(key);
  if (v === undefined) {
    v = cost(LENS[c], size, ps);
    held.set(key, v);
  }
  return v;
}

/** The anchor family: Q6BO's shape scaled by `k` in BOTH size and
 *  `pupilSamples`, which moves the common field and holds the pixel pitch —
 *  § 6br.6's own construction, applied to this readout. */
const quartet = (k: number): Record<Cell, Cost> => ({
  s10: cell("s10", Q6BO.s10[0] * k, Q6BO.s10[1] * k),
  f10: cell("f10", Q6BO.f10[0] * k, Q6BO.f10[1] * k),
  s20: cell("s20", Q6BO.s20[0] * k, Q6BO.s20[1] * k),
  f20: cell("f20", Q6BO.f20[0] * k, Q6BO.f20[1] * k),
});

const branchQuartet = (): Record<Cell, Cost> => ({
  s10: cell("s10", BRANCH_SHAPE[0], BRANCH_SHAPE[1]),
  f10: cell("f10", BRANCH_SHAPE[0], BRANCH_SHAPE[1]),
  s20: cell("s20", BRANCH_SHAPE[0], BRANCH_SHAPE[1]),
  f20: cell("f20", BRANCH_SHAPE[0], BRANCH_SHAPE[1]),
});

/** § 6bm's interaction: the aperture lever at the high M over the same at the low. */
const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
/** The same, as a departure from 1 in whichever direction it departs. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

const costI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.ratio, q.f10.ratio, q.s20.ratio, q.f20.ratio);
const anisoI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.aniso, q.f10.aniso, q.s20.aniso, q.f20.aniso);

const anchorOf = (k: number): number => extentOf(LENS.s20, Q6BO.s20[0] * k, Q6BO.s20[1] * k);

/** The plateau's quartet samples at 48 where the others sample at 32, so its
 *  common field is 1.5x theirs — the same `ps * M / NA`, a different anchor. */
const plateauAnchor = (): number => extentOf(LENS.s20, 64, 24);

/** The four anchors this readout reaches. `k` = 1/2 is refused by the guard
 *  band rather than declined — § 6bs.7's last rung. */
const KS = [1, 2, 4, 8] as const;

/* ------------------------------------------------------------------ *
 * The four interactions this step CITES, each at the digits its own step
 * pinned. Rebuilding them means sweeps and volume renders; the two above
 * are geometry and are rebuilt.
 * ------------------------------------------------------------------ */

/** § 6bp.3, `rendOverFree` on the axis and at the edge, branch and Q6BO. */
const SPLIT_AXIS_BRANCH = 0.993701489;
const SPLIT_AXIS_MATCHED = 0.954996037;
const SPLIT_EDGE_BRANCH = 0.991475571;
const SPLIT_EDGE_MATCHED = 0.877035074;
/** § 6bo.2's plateau pair. */
const PLATEAU_BRANCH = 0.8614283392781017;
const PLATEAU_MATCHED = 0.8691011729509641;
/** § 6br.1 and § 6br.3, the escape at its own anchor... */
const ESCAPE_BRANCH = 0.8231652575877593;
const ESCAPE_MATCHED = 0.41088335048448804;
/** ...and § 6br.6's second anchor, which is the one the other five sit at. */
const ESCAPE_AT_COMMON_ANCHOR = 0.3596838;

/** § 6bq.7's seven, at the two apertures this interaction is built from. */
const PLATEAU_FIELD_MOVE_010 = 0.9890281687802007;
const PLATEAU_FIELD_MOVE_020 = 1.0475612231045512;

/** § 6bn.3's six, as published — the departures, in the order it printed them. */
const SIX_PUBLISHED = [1.0063, 1.0086, 1.0233, 1.0417, 1.1609, 1.2148] as const;

interface Row {
  readonly name: string;
  readonly branch: number;
  readonly matched: number;
  /** The common field the matched column was taken over, in object mm. */
  readonly anchorMm: number;
}

const rows = (): readonly Row[] => {
  const b = branchQuartet();
  const m = quartet(1);
  return [
    {
      name: "split, axis",
      branch: SPLIT_AXIS_BRANCH,
      matched: SPLIT_AXIS_MATCHED,
      anchorMm: anchorOf(1),
    },
    {
      name: "split, edge",
      branch: SPLIT_EDGE_BRANCH,
      matched: SPLIT_EDGE_MATCHED,
      anchorMm: anchorOf(1),
    },
    { name: "anisotropy", branch: anisoI(b), matched: anisoI(m), anchorMm: anchorOf(1) },
    { name: "registration cost", branch: costI(b), matched: costI(m), anchorMm: anchorOf(1) },
    { name: "plateau", branch: PLATEAU_BRANCH, matched: PLATEAU_MATCHED, anchorMm: plateauAnchor() },
    { name: "escape", branch: ESCAPE_BRANCH, matched: ESCAPE_MATCHED, anchorMm: anchorOf(2) },
  ];
};

type Verdict = "reversed" | "understated" | "unchanged";

/** § 6bo's and § 6bp's measure: how far the DISTANCE from 1 grew. */
const distanceGrowth = (r: Row): number =>
  (departure(r.matched) - 1) / (departure(r.branch) - 1);
/** § 6br's measure: the ratio of the departures themselves. */
const departureRatio = (r: Row): number => departure(r.matched) / departure(r.branch);

/** The classifier § 6bs.2 asserts the multiset of. A crossing of 1 is decided
 *  first because it changes what the quotient SAYS; everything else is decided
 *  by how far the correction moved it, on § 6bo's and § 6bp's measure. */
const verdictOf = (r: Row): Verdict => {
  if (r.branch > 1 !== r.matched > 1) return "reversed";
  return distanceGrowth(r) > 1 ? "understated" : "unchanged";
};

const tally = (rs: readonly Row[]): Record<Verdict, number> => {
  const t: Record<Verdict, number> = { reversed: 0, understated: 0, unchanged: 0 };
  for (const r of rs) t[verdictOf(r)] += 1;
  return t;
};

describe("§ 6bs.1 — the six assemble, and the branch column is § 6bn.3's own list", () => {
  it("the two render-free interactions rebuild to § 6bo.2's digits, both columns", () => {
    const b = branchQuartet();
    const m = quartet(1);
    // § 6bn's `costI` and `anisoI`, and § 6bo.2's matched pair.
    expect(costI(b)).toBeCloseTo(1.0416580962373136, 9);
    expect(anisoI(b)).toBeCloseTo(0.9772598554705617, 9);
    expect(costI(m)).toBeCloseTo(0.7948724057562382, 9);
    expect(anisoI(m)).toBeCloseTo(0.7862300730210287, 9);
    // To the last digit § 6bo.2 published, which is what makes the row citable.
    expect(costI(m)).toBeCloseTo(0.7948724, 7);
    expect(anisoI(m)).toBeCloseTo(0.7862301, 7);
  });

  it("and all six branch values are § 6bn.3's six published departures", () => {
    const got = rows()
      .map((r) => departure(r.branch))
      .sort((x, y) => x - y);
    expect(got).toHaveLength(SIX_PUBLISHED.length);
    for (let i = 0; i < got.length; i++) expect(got[i]!).toBeCloseTo(SIX_PUBLISHED[i]!, 4);
  });
});

describe("§ 6bs.2 — the tally, computed: ONE reversed, FOUR understated, ONE unchanged", () => {
  it("the six classify 1 / 4 / 1, and nothing among them is refused", () => {
    expect(tally(rows())).toEqual({ reversed: 1, understated: 4, unchanged: 1 });

    const byName = new Map(rows().map((r) => [r.name, verdictOf(r)]));
    expect(byName.get("registration cost")).toBe("reversed");
    expect(byName.get("plateau")).toBe("unchanged");
    for (const n of ["split, axis", "split, edge", "anisotropy", "escape"])
      expect(byName.get(n)).toBe("understated");
  });

  it("the anisotropy is NOT a reversal — § 6bo.2 said so, and § 6br's tally forgot", () => {
    const aniso = rows().find((r) => r.name === "anisotropy")!;
    // Both columns below 1: the distance from 1 grows 11.68x without crossing.
    expect(aniso.branch).toBeLessThan(1);
    expect(aniso.matched).toBeLessThan(1);
    expect(distanceGrowth(aniso)).toBeCloseTo(11.684598548101404, 6);

    // Exactly one of the six changes sides, and it is the registration cost.
    const crossed = rows().filter((r) => r.branch > 1 !== r.matched > 1);
    expect(crossed.map((r) => r.name)).toEqual(["registration cost"]);
  });

  it("and the classification is a measured gap, not a chosen threshold", () => {
    // Everything that moved, moved by at least 6.19x; the one that did not,
    // moved 0.94x. Nothing sits between, so the cut is not a judgement call.
    const growth = rows().map(distanceGrowth);
    const moved = growth.filter((g) => g > 1);
    const still = growth.filter((g) => g <= 1);
    expect(still).toHaveLength(1);
    expect(Math.max(...still)).toBeCloseTo(0.9362893, 6);
    expect(Math.min(...moved)).toBeGreaterThan(6.19);
    expect(Math.min(...moved) / Math.max(...still)).toBeGreaterThan(6.6);
  });
});

describe("§ 6bs.3 — the six sit at THREE anchors, in the ratio 1 : 1.5 : 2", () => {
  it("§ 6bo and § 6bp anchor at 0.4677 mm, the plateau at 0.7015, § 6br at 0.9354", () => {
    expect(anchorOf(1)).toBeCloseTo(0.46769328761900353, 12);
    expect(plateauAnchor()).toBeCloseTo(0.7015399314285053, 12);
    expect(anchorOf(2)).toBeCloseTo(0.9353865752380071, 12);

    expect(plateauAnchor() / anchorOf(1)).toBeCloseTo(1.5, 9);
    expect(anchorOf(2) / anchorOf(1)).toBeCloseTo(2, 9);
  });

  it("the plateau's is 1.5x because its SWEEP samples at 48 where the rest use 32", () => {
    // `halfExtent` goes as `pupilSamples * M / NA`, so the sweep's own sampling
    // is the whole of the difference: 48/32 = 1.5, on every cell of its quartet.
    expect(extentOf(LENS.s10, 128, 48)).toBeCloseTo(plateauAnchor(), 12);
    expect(plateauAnchor() / anchorOf(1)).toBeCloseTo(48 / 32, 9);

    // Its two NA 0.20 cells agree with each other and sit 1.55% from the NA
    // 0.10 pair — § 6bo.1's traced-aperture residual, which § 6br.2 pinned on
    // the escape's quartet and which this one carries identically.
    expect(extentOf(LENS.f10, 256, 96)).toBeCloseTo(extentOf(LENS.f20, 128, 48), 12);
    expect(plateauAnchor() / extentOf(LENS.f20, 128, 48)).toBeCloseTo(1.0155048005794858, 12);
  });

  it("and the six's own anchors take three distinct values, not one", () => {
    const anchors = [...new Set(rows().map((r) => r.anchorMm.toPrecision(10)))];
    expect(anchors).toHaveLength(3);
  });
});

describe("§ 6bs.4 — five of the six go onto ONE anchor, and the tally does not move", () => {
  it("§ 6br.6's second anchor IS the other five's, and the escape reads 0.3596838 there", () => {
    // § 6br's family walks the same extent ladder this file does: its second
    // rung sits exactly where § 6bo and § 6bp took their quartets.
    expect(anchorOf(1)).toBeCloseTo(0.46769328761900353, 12);

    const common: Row = {
      name: "escape",
      branch: ESCAPE_BRANCH,
      matched: ESCAPE_AT_COMMON_ANCHOR,
      anchorMm: anchorOf(1),
    };
    expect(verdictOf(common)).toBe("understated");
    expect(common.matched).toBeLessThan(1);
    expect(common.matched).toBeLessThan(common.branch);
  });

  it("so the five-row table at one anchor gives the same 1 reversed / 4 understated", () => {
    const five = rows()
      .filter((r) => r.name !== "plateau")
      .map((r) =>
        r.name === "escape" ? { ...r, matched: ESCAPE_AT_COMMON_ANCHOR, anchorMm: anchorOf(1) } : r,
      );
    expect(new Set(five.map((r) => r.anchorMm))).toEqual(new Set([anchorOf(1)]));
    expect(tally(five)).toEqual({ reversed: 1, understated: 4, unchanged: 0 });
  });

  it("but the escape's SIZE moves 14% between the two anchors, so the table is not one number", () => {
    expect(ESCAPE_MATCHED / ESCAPE_AT_COMMON_ANCHOR).toBeCloseTo(1.1423, 4);
    // On § 6br's own measure the understatement goes 2.0034x to 2.2886x.
    expect(departure(ESCAPE_MATCHED) / departure(ESCAPE_BRANCH)).toBeCloseTo(2.003404, 5);
    expect(departure(ESCAPE_AT_COMMON_ANCHOR) / departure(ESCAPE_BRANCH)).toBeCloseTo(2.28858, 5);
  });
});

describe("§ 6bs.5 — at a matched field all six are below 1, and the branch's path was not", () => {
  it("six of six matched, five of six down the branch — the correction makes it unanimous", () => {
    for (const r of rows()) expect(r.matched).toBeLessThan(1);
    expect(rows().filter((r) => r.branch < 1)).toHaveLength(5);
    expect(rows().filter((r) => r.branch > 1).map((r) => r.name)).toEqual(["registration cost"]);
  });

  it("and the physical gloss is REFUSED: the levers do not share a side of 1", () => {
    // Both of the escape's aperture levers are above 1 (§ 6bo.6, § 6br.4), so a
    // smaller quotient at 20x is a weaker effect there. Both of the registration
    // cost's, at the same matched field, are BELOW 1 — where a smaller quotient
    // is a larger effect the other way. The unanimity is a statement about the
    // RATIO and cannot be carried into one about the lever.
    const m = quartet(1);
    const lever10 = m.f10.ratio / m.s10.ratio;
    const lever20 = m.f20.ratio / m.s20.ratio;
    expect(lever10).toBeCloseTo(0.6369518343291319, 9);
    expect(lever20).toBeCloseTo(0.506295436904046, 9);
    expect(lever10).toBeLessThan(1);
    expect(lever20).toBeLessThan(1);

    // Down the branch's path the same two levers are ABOVE 1, which is § 6bo.3's
    // reversal and is why this cannot be settled once and then reused.
    const b = branchQuartet();
    expect(b.f10.ratio / b.s10.ratio).toBeCloseTo(1.5357672283723947, 9);
    expect(b.f20.ratio / b.s20.ratio).toBeCloseTo(1.5997443673700444, 9);
  });
});

describe("§ 6bs.6 — the six were reported in TWO growth measures, and they disagree", () => {
  it("both columns, on the four understated rows", () => {
    const four = rows().filter((r) => verdictOf(r) === "understated");
    expect(four.map((r) => r.name)).toEqual([
      "split, axis",
      "split, edge",
      "anisotropy",
      "escape",
    ]);

    // § 6br's measure.
    expect(departureRatio(four[0]!)).toBeCloseTo(1.040529, 5);
    expect(departureRatio(four[1]!)).toBeCloseTo(1.130486, 5);
    expect(departureRatio(four[2]!)).toBeCloseTo(1.242969, 5);
    expect(departureRatio(four[3]!)).toBeCloseTo(2.003404, 5);

    // § 6bo's and § 6bp's — which published 7.4, 16.3 and 11.68. § 6br's 2.0034
    // is the OTHER measure; on this one the same readout is 6.67.
    expect(distanceGrowth(four[0]!)).toBeCloseTo(7.434765, 5);
    expect(distanceGrowth(four[1]!)).toBeCloseTo(16.307261, 5);
    expect(distanceGrowth(four[2]!)).toBeCloseTo(11.684598, 5);
    expect(distanceGrowth(four[3]!)).toBeCloseTo(6.674246, 5);
  });

  it("and the two orderings are opposite at BOTH ends", () => {
    const four = rows().filter((r) => verdictOf(r) === "understated");
    const byDepRatio = [...four].sort((a, b) => departureRatio(a) - departureRatio(b));
    const byDistance = [...four].sort((a, b) => distanceGrowth(a) - distanceGrowth(b));

    expect(byDepRatio.map((r) => r.name)).toEqual([
      "split, axis",
      "split, edge",
      "anisotropy",
      "escape",
    ]);
    expect(byDistance.map((r) => r.name)).toEqual([
      "escape",
      "split, axis",
      "anisotropy",
      "split, edge",
    ]);

    // The escape is the largest correction on one measure and the smallest on
    // the other, and the edge split trades ends with it.
    expect(byDepRatio.at(-1)!.name).toBe("escape");
    expect(byDistance[0]!.name).toBe("escape");
    expect(byDepRatio[1]!.name).toBe("split, edge");
    expect(byDistance.at(-1)!.name).toBe("split, edge");
  });
});

describe("§ 6bs.7 — the anchor sensitivity is not the escape's, and two verdicts fail at the top", () => {
  it("both render-free interactions run monotone over four anchors", () => {
    const anchors = KS.map(anchorOf);
    expect(anchors[0]!).toBeCloseTo(0.46769328761900353, 12);
    expect(anchors[3]!).toBeCloseTo(3.7415463009520282, 12);

    const costs = KS.map((k) => costI(quartet(k)));
    const anisos = KS.map((k) => anisoI(quartet(k)));
    expect(costs[0]!).toBeCloseTo(0.7948724057562382, 9);
    expect(costs[1]!).toBeCloseTo(0.9404251685564944, 9);
    expect(costs[2]!).toBeCloseTo(0.9863246838710185, 9);
    expect(costs[3]!).toBeCloseTo(1.0048044909202725, 9);
    expect(anisos[0]!).toBeCloseTo(0.7862300730210287, 9);
    expect(anisos[1]!).toBeCloseTo(0.9285478115301892, 9);
    expect(anisos[2]!).toBeCloseTo(0.9710985815696986, 9);
    expect(anisos[3]!).toBeCloseTo(0.9853104600763398, 9);

    // Monotone, where § 6br.6's escape was single-humped over the same ladder.
    for (let i = 1; i < KS.length; i++) {
      expect(costs[i]!).toBeGreaterThan(costs[i - 1]!);
      expect(anisos[i]!).toBeGreaterThan(anisos[i - 1]!);
    }
  });

  it("the cost's REVERSAL is gone at 3.74 mm, and holds at the other three", () => {
    expect(costI(branchQuartet())).toBeGreaterThan(1);
    for (const k of [1, 2, 4]) expect(costI(quartet(k))).toBeLessThan(1);
    // The same side of 1 as the branch's: no crossing, so no reversal.
    expect(costI(quartet(8))).toBeGreaterThan(1);
  });

  it("and the anisotropy's UNDERSTATEMENT inverts there, to 0.64x", () => {
    const branch = anisoI(branchQuartet());
    const growth = (k: number): number =>
      (departure(anisoI(quartet(k))) - 1) / (departure(branch) - 1);
    expect(growth(1)).toBeCloseTo(11.684598548101404, 6);
    expect(growth(2)).toBeCloseTo(3.3069536097738963, 9);
    expect(growth(4)).toBeCloseTo(1.2790062779623216, 9);
    // Below 1: the matched quotient is CLOSER to 1 than the branch's, so at this
    // anchor the correction shrinks the interaction instead of growing it.
    expect(growth(8)).toBeCloseTo(0.6406958912662639, 9);
    expect(growth(8)).toBeLessThan(1);
  });

  it("the smallest anchor is refused by the guard band, not declined", () => {
    // `guardCells` is 4 resolution cells, i.e. `4 * size / pupilSamples` pixels
    // per edge, so below `pupilSamples` 9 the guard eats the whole tile however
    // `size` is chosen. This readout cannot reach § 6br.6's 0.2338 mm rung.
    for (const size of [64, 128, 256, 512])
      expect(() => cost(LENS.s20, size, 8)).toThrow(/eats the whole/);
    expect(() => cost(LENS.s20, 128, 16)).not.toThrow();
  });
});

describe("§ 6bs.8 — the survivor's REASON is withdrawn, and its margin is the table's smallest", () => {
  it("the plateau survives by 0.89%, which is the smallest move among the six", () => {
    const plateau = rows().find((r) => r.name === "plateau")!;
    expect(plateau.matched / plateau.branch).toBeCloseTo(1.0089071061665935, 8);
    expect(Math.abs(plateau.matched / plateau.branch - 1)).toBeLessThan(0.01);

    // Every other row moves at least 3.90% — the axial split, the nearest of
    // the five — so the survivor stands alone by 4.37x before any question
    // about its reason is asked.
    const moves = rows()
      .filter((r) => r.name !== "plateau")
      .map((r) => Math.abs(r.matched / r.branch - 1));
    expect(Math.min(...moves)).toBeCloseTo(0.03895078394111173, 12);
    expect(Math.min(...moves) / Math.abs(plateau.matched / plateau.branch - 1)).toBeCloseTo(
      4.373001,
      5,
    );
  });

  it("but § 6bq.7 moves one of its own two apertures by 4.756%, five times that", () => {
    // § 6bo.2's reason for the survival was that § 6bo.5 measured this readout
    // field-free. § 6bq.7 withdrew that: at a uniform 2x frame change NA 0.20 —
    // one of the interaction's own two apertures — moves 4.756%.
    const moved020 = Math.abs(PLATEAU_FIELD_MOVE_020 - 1);
    const moved010 = Math.abs(PLATEAU_FIELD_MOVE_010 - 1);
    expect(moved020).toBeCloseTo(0.0475612231045512, 12);
    expect(moved010).toBeCloseTo(0.0109718312197993, 12);

    const plateau = rows().find((r) => r.name === "plateau")!;
    const margin = Math.abs(plateau.matched / plateau.branch - 1);
    expect(moved020 / margin).toBeGreaterThan(5.3);
  });

  it("and § 6bq.7 is NOT an anchor derivative of the quotient — its cells separate", () => {
    // It doubles each lens's OWN frame, so the two apertures land on different
    // common fields and their quotient mixes an anchor change with an aperture
    // change. Quoting it as a sensitivity OF THE INTERACTION would be the same
    // cancellation argument § 6bo.2 and § 6br.4 each had to retract.
    const na010 = extentOf(LENS.s20, 128, 48);
    const na020 = extentOf(LENS.f20, 128, 48);
    // A factor of two, carrying § 6bo.1's 1.55% traced-aperture residual on top.
    expect(na010 / na020).toBeCloseTo(2.0310096011589716, 12);
    expect(na010 / na020 / 2).toBeCloseTo(1.0155048005794858, 12);
    expect(na010).not.toBeCloseTo(na020, 3);
  });
});
