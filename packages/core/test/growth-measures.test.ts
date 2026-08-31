import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6bt — the two growth measures, converted.
 *
 * § 6bs.6 found that the six interactions of § 6bn were reported in two
 * different measures of "how much did the matched-field correction move this
 * quotient", and that the two rank the four understated readouts in opposite
 * orders. It published both columns and picked neither, because picking one
 * would have restated four earlier steps' headline numbers in a measure those
 * steps did not choose. That left the table with two columns and no stated
 * relation between them, which is a worse defect than the one it documented: a
 * reader holding § 6br's 2.0034 cannot get § 6bo's 6.674 out of it, and the two
 * sentences read as though they were about the same quantity.
 *
 * They are not, and the relation is exact. Write `b` and `m` for a readout's
 * branch and matched-field quotients and fold each to its departure from 1 the
 * way every step here does, β = departure(b) and µ = departure(m), both ≥ 1.
 * The two published measures are
 *
 *     R = µ / β                  § 6br's — the ratio of the departures
 *     D = (µ − 1) / (β − 1)      § 6bo's and § 6bp's — the growth of the
 *                                  distance from 1
 *
 * and substituting µ = Rβ into D gives, in one line,
 *
 *     D − 1 = (R − 1) · β / (β − 1).
 *
 * So the columns differ by one factor, `f = β / (β − 1)`, which depends on the
 * BRANCH value alone. That is the whole of § 6bt: the measures do not have to be
 * chosen between, because either converts into the other from § 6bn.3's own
 * published list, with no re-measurement of anything.
 *
 * ## What the identity settles, and what it does not
 *
 * β > 1 strictly whenever a quotient is not exactly 1, so f > 0 and the identity
 * carries the SIGN across unchanged: D > 1 exactly when R > 1. § 6bs.2's tally
 * is therefore measure-independent as a matter of algebra rather than of luck —
 * § 6bt.2 recomputes it with the classifier reading R and gets the same one
 * reversed, four understated, one unchanged.
 *
 * What does not carry across is how comfortable that classification looks.
 * § 6bs.2 backed its cut with a measured gap, "0.94× against a minimum of
 * 6.19×, nothing between". Under § 6br's measure the same cut is 0.9912 against
 * 1.0405 — still a gap, still with nothing in it, and a margin of 4.98% where
 * the other measure showed a factor of 6.6. The row on the far side of the cut
 * is not even the same one: § 6bo's measure puts the registration cost nearest
 * the plateau and § 6br's puts the axis split there. The classification is
 * measure-independent; the confidence § 6bs.2 attached to it is not, and
 * § 6bt.3 pins both readings so the claim cannot be quoted in one measure alone.
 *
 * ## Why the orderings differ, stated only as far as it is measured
 *
 * Across the four understated rows in § 6bn.3's own order the two factors of the
 * product run OPPOSITE ways: f falls 158.768 → 117.310 → 43.975 → 5.655 while
 * R − 1 rises 0.040529 → 0.130486 → 0.242969 → 1.003404. Their spreads are
 * 28.076× and 24.758×, within 13% of each other, so the product is not forced
 * into either factor's order and lands as 6.435, 15.307, 10.685, 5.674 — no
 * order at all. That is an observation about this table and not a mechanism:
 * the anti-monotonicity of f and R across these particular four rows is measured
 * here, and nothing here derives it.
 *
 * The converse is derivable, and § 6bt.6 checks it. Where the branch value is
 * HELD, f is one number and the two measures are a positive affine map of each
 * other, so they must order identically. § 6bs.7's anisotropy anchor family is
 * exactly that case — one branch quotient, four anchors — and its verdict
 * survives the change of measure: R runs 1.242969, 1.052460, 1.006344, 0.991830
 * and crosses 1 between the same two anchors where D falls through 1.
 *
 * ## The precision the conversion factor earns
 *
 * f = β/(β − 1) is 1/(1 − b) below 1 and b/(b − 1) above it, and both forms
 * divide by a difference that cancels most of the input's significance. § 6bp.3
 * pinned the two rendered splits to 8 decimals, so their branch values carry an
 * uncertainty of 5e-9 against a 1 − b of 6.3e-3 and 8.5e-3 — a relative 7.9e-7
 * and 5.9e-7, which puts f's uncertainty at 1.3e-4 and 6.9e-5. Three decimals
 * are earned and four are not, and § 6bt.4 pins that by perturbation rather
 * than by assertion. The other four rows are rebuilt here or carry full double
 * precision, and are pinned harder.
 *
 * None of this touches the identity itself, which is algebra and holds at
 * machine precision on whatever numbers it is handed — § 6bt.1 asserts it as a
 * relative residual below 1e-12 on all six rows, and below 1e-14 on the two
 * that are rebuilt from source here.
 *
 * ## The blind spot both measures share
 *
 * Both fold through `departure()`, which sends x and 1/x to the same value. So
 * neither growth measure can see a crossing of 1: the registration cost reads
 * D = 6.195 and R = 1.208 — "understated" on both — and is classified REVERSED
 * only because § 6bs.2's classifier asks about the crossing first, before either
 * growth measure is consulted. § 6bt.7 pins that the crossing test does that
 * work alone.
 */

const DESIGN = 587.5618;
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

function mosaicOptions(size: number, ps: number): FluorescenceMosaicOptions {
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
  };
}

interface Cost {
  readonly ratio: number;
  readonly aniso: number;
}

/** § 6bj's registration cost and its anisotropy — geometry only, no render. */
function cost(system: OpticalSystem, size: number, ps: number): Cost {
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps));
  const scan = mosaicSeamShiftMm(system, { ...mosaicOptions(size, ps), scan: "stage" });
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
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
const MATCHED: Record<Cell, readonly [number, number]> = {
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

const matchedQuartet = (): Record<Cell, Cost> => ({
  s10: cell("s10", MATCHED.s10[0], MATCHED.s10[1]),
  f10: cell("f10", MATCHED.f10[0], MATCHED.f10[1]),
  s20: cell("s20", MATCHED.s20[0], MATCHED.s20[1]),
  f20: cell("f20", MATCHED.f20[0], MATCHED.f20[1]),
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
/** The fold both growth measures share, and § 6bt.7's blind spot. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

const costI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.ratio, q.f10.ratio, q.s20.ratio, q.f20.ratio);
const anisoI = (q: Record<Cell, Cost>): number =>
  interact(q.s10.aniso, q.f10.aniso, q.s20.aniso, q.f20.aniso);

/* ------------------------------------------------------------------ *
 * The four rows this step CITES, each at the digits its own step pinned:
 * rebuilding them means sweeps and volume renders. The two render-free
 * rows above are geometry and are rebuilt.
 * ------------------------------------------------------------------ */

/** § 6bp.3's `rendOverFree` on the axis and at the edge — pinned there to 8
 *  decimals, which is what § 6bt.4's perturbation is against. */
const SPLIT_TOL = 5e-9;
const SPLIT_AXIS_BRANCH = 0.993701489;
const SPLIT_AXIS_MATCHED = 0.954996037;
const SPLIT_EDGE_BRANCH = 0.991475571;
const SPLIT_EDGE_MATCHED = 0.877035074;
/** § 6bo.2's plateau pair. */
const PLATEAU_BRANCH = 0.8614283392781017;
const PLATEAU_MATCHED = 0.8691011729509641;
/** § 6br.1 and § 6br.3, the escape at its own anchor. */
const ESCAPE_BRANCH = 0.8231652575877593;
const ESCAPE_MATCHED = 0.41088335048448804;

/** § 6bs.7's anisotropy anchor family at the digits it pinned: ONE branch
 *  quotient and four matched ones, over anchors 0.4677 / 0.9354 / 1.8708 /
 *  3.7415 mm. The held branch is what makes § 6bt.6 a controlled case. */
const ANISO_ANCHOR_FAMILY = [0.78623, 0.928548, 0.971099, 0.98531] as const;

interface Row {
  readonly name: string;
  readonly branch: number;
  readonly matched: number;
  /** Whether the pair is rebuilt from source here, or cited from its own step. */
  readonly rebuilt: boolean;
}

const rows = (): readonly Row[] => {
  const b = branchQuartet();
  const m = matchedQuartet();
  return [
    { name: "split, axis", branch: SPLIT_AXIS_BRANCH, matched: SPLIT_AXIS_MATCHED, rebuilt: false },
    { name: "split, edge", branch: SPLIT_EDGE_BRANCH, matched: SPLIT_EDGE_MATCHED, rebuilt: false },
    { name: "anisotropy", branch: anisoI(b), matched: anisoI(m), rebuilt: true },
    { name: "registration cost", branch: costI(b), matched: costI(m), rebuilt: true },
    { name: "plateau", branch: PLATEAU_BRANCH, matched: PLATEAU_MATCHED, rebuilt: false },
    { name: "escape", branch: ESCAPE_BRANCH, matched: ESCAPE_MATCHED, rebuilt: false },
  ];
};

/** § 6bo's and § 6bp's measure: how far the DISTANCE from 1 grew. */
const distanceGrowth = (r: Row): number => (departure(r.matched) - 1) / (departure(r.branch) - 1);
/** § 6br's measure: the ratio of the departures themselves. */
const departureRatio = (r: Row): number => departure(r.matched) / departure(r.branch);
/** The one factor between them, a function of the BRANCH value alone. */
const conversion = (branch: number): number => {
  const beta = departure(branch);
  return beta / (beta - 1);
};

type Verdict = "reversed" | "understated" | "unchanged";

/** § 6bs.2's classifier, with the growth measure made a parameter — which is
 *  the question § 6bt.2 asks of it. The crossing is still decided first. */
const verdictBy =
  (growth: (r: Row) => number) =>
  (r: Row): Verdict => {
    if (r.branch > 1 !== r.matched > 1) return "reversed";
    return growth(r) > 1 ? "understated" : "unchanged";
  };

/** § 6bs.2's own verdict, on § 6bo's measure — the one the table is written in. */
const verdictOf = verdictBy(distanceGrowth);

const tally = (rs: readonly Row[], growth: (r: Row) => number): Record<Verdict, number> => {
  const t: Record<Verdict, number> = { reversed: 0, understated: 0, unchanged: 0 };
  const v = verdictBy(growth);
  for (const r of rs) t[v(r)] += 1;
  return t;
};

describe("§ 6bt.1 — the two measures differ by ONE factor, and it is the branch column's", () => {
  it("D - 1 = (R - 1) * beta / (beta - 1), on all six rows", () => {
    const six = rows();
    expect(six).toHaveLength(6);
    for (const r of six) {
      const lhs = distanceGrowth(r) - 1;
      const rhs = (departureRatio(r) - 1) * conversion(r.branch);
      // Relative, because the six span 6e-2 to 1.5e1 on this quantity.
      expect(Math.abs(lhs - rhs) / Math.abs(lhs)).toBeLessThan(1e-12);
    }
  });

  it("and to machine precision on the two rebuilt here, so it is not a rounding artifact", () => {
    const rebuilt = rows().filter((r) => r.rebuilt);
    expect(rebuilt.map((r) => r.name)).toEqual(["anisotropy", "registration cost"]);
    for (const r of rebuilt) {
      const lhs = distanceGrowth(r) - 1;
      const rhs = (departureRatio(r) - 1) * conversion(r.branch);
      expect(Math.abs(lhs - rhs) / Math.abs(lhs)).toBeLessThan(1e-14);
    }
  });

  it("the factor needs the branch value ALONE — the matched column does not enter it", () => {
    for (const r of rows()) {
      const beta = departure(r.branch);
      // 1/(1 - b) below 1, b/(b - 1) above it: the same f, written without the fold.
      const direct = r.branch < 1 ? 1 / (1 - r.branch) : r.branch / (r.branch - 1);
      expect(conversion(r.branch)).toBeCloseTo(direct, 9);
      expect(conversion(r.branch)).toBeCloseTo(beta / (beta - 1), 12);
    }
  });
});

describe("§ 6bt.2 — so the two measures can never disagree about the VERDICT", () => {
  it("beta > 1 strictly, so the factor is positive and the sign carries across", () => {
    for (const r of rows()) {
      expect(departure(r.branch)).toBeGreaterThan(1);
      expect(conversion(r.branch)).toBeGreaterThan(1);
      expect(Math.sign(distanceGrowth(r) - 1)).toBe(Math.sign(departureRatio(r) - 1));
    }
  });

  it("and it is algebra, not this table: a grid of pairs agrees on the sign everywhere", () => {
    const grid = [0.4, 0.7, 0.9, 0.97, 0.999, 1.001, 1.05, 1.3, 2.5];
    let seenUp = 0;
    let seenDown = 0;
    for (const b of grid)
      for (const m of grid) {
        const r: Row = { name: "grid", branch: b, matched: m, rebuilt: false };
        const d = distanceGrowth(r) - 1;
        const q = departureRatio(r) - 1;
        expect(Math.sign(d)).toBe(Math.sign(q));
        if (d > 0) seenUp += 1;
        if (d < 0) seenDown += 1;
      }
    // Both signs are actually exercised, so the assertion is not vacuous: the
    // 81 pairs split 35 / 35, with 11 ties where the two departures coincide.
    expect(seenUp).toBe(35);
    expect(seenDown).toBe(35);
    expect(81 - seenUp - seenDown).toBe(11);
  });

  it("§ 6bs.2's tally is therefore the same under either measure", () => {
    const six = rows();
    const byDistance = tally(six, distanceGrowth);
    const byRatio = tally(six, departureRatio);
    expect(byDistance).toEqual({ reversed: 1, understated: 4, unchanged: 1 });
    expect(byRatio).toEqual(byDistance);
    // And row by row, not only in the multiset.
    expect(six.map(verdictBy(departureRatio))).toEqual(six.map(verdictOf));
  });
});

describe("§ 6bt.3 — but the COMFORT of § 6bs.2's cut is not measure-independent", () => {
  it("the cut survives with nothing between it under § 6br's measure too", () => {
    const six = rows();
    const unchanged = six.filter((r) => verdictOf(r) === "unchanged");
    expect(unchanged.map((r) => r.name)).toEqual(["plateau"]);
    const others = six.filter((r) => verdictOf(r) !== "unchanged").map(departureRatio);
    expect(Math.max(...unchanged.map(departureRatio))).toBeLessThan(Math.min(...others));
  });

  it("but a DIFFERENT readout sits nearest it under each measure, at a different margin", () => {
    const six = rows();
    const plateau = six.find((r) => r.name === "plateau")!;
    const others = six.filter((r) => r.name !== "plateau");
    const nearestBy = (g: (r: Row) => number): Row => others.reduce((a, b) => (g(a) < g(b) ? a : b));

    // § 6bs.2 read the cut on § 6bo's measure, where the plateau's nearest
    // neighbour is the REGISTRATION COST at 6.19 and the gap is a factor of 6.6.
    const nd = nearestBy(distanceGrowth);
    expect(nd.name).toBe("registration cost");
    expect(distanceGrowth(plateau)).toBeCloseTo(0.936289, 5);
    expect(distanceGrowth(nd)).toBeCloseTo(6.194799, 5);
    expect(distanceGrowth(nd) / distanceGrowth(plateau)).toBeCloseTo(6.6163, 3);

    // On § 6br's measure the neighbour is the AXIS SPLIT instead, and the gap
    // is 4.98% — a different row, two orders of magnitude closer.
    const nr = nearestBy(departureRatio);
    expect(nr.name).toBe("split, axis");
    expect(departureRatio(plateau)).toBeCloseTo(0.991172, 5);
    expect(departureRatio(nr)).toBeCloseTo(1.040529, 5);
    const margin = departureRatio(nr) / departureRatio(plateau);
    expect(margin).toBeCloseTo(1.049797, 5);
    expect((margin - 1) * 100).toBeCloseTo(4.98, 2);

    // The claim § 6bs.2 may no longer be quoted unqualified: the SIZE of the gap
    // moves by more than two orders of magnitude between the two measures.
    expect((distanceGrowth(nd) / distanceGrowth(plateau) - 1) / (margin - 1)).toBeGreaterThan(100);
  });
});

describe("§ 6bt.4 — the conversion factor, at the precision each branch value earns", () => {
  it("the six factors, the two rendered splits to three decimals and the rest harder", () => {
    const f = new Map(rows().map((r) => [r.name, conversion(r.branch)]));
    expect(f.get("split, axis")!).toBeCloseTo(158.768, 3);
    expect(f.get("split, edge")!).toBeCloseTo(117.31, 3);
    expect(f.get("anisotropy")!).toBeCloseTo(43.9750943, 6);
    expect(f.get("registration cost")!).toBeCloseTo(25.0049376, 6);
    expect(f.get("plateau")!).toBeCloseTo(7.2164828, 6);
    expect(f.get("escape")!).toBeCloseTo(5.6549974, 6);
  });

  it("and three decimals is what the 8-decimal pins support — measured by perturbation", () => {
    for (const b of [SPLIT_AXIS_BRANCH, SPLIT_EDGE_BRANCH]) {
      const moved = Math.abs(conversion(b + SPLIT_TOL) - conversion(b - SPLIT_TOL));
      // Inside a three-decimal pin's tolerance and outside a four-decimal one's,
      // so the digit count is measured rather than chosen.
      expect(moved).toBeLessThan(5e-4);
      expect(moved).toBeGreaterThan(5e-5);
    }
    // A row whose branch is not near 1 loses nothing to the cancellation: the
    // same perturbation moves the escape's factor three orders less.
    const b = rows().find((r) => r.name === "escape")!.branch;
    expect(Math.abs(conversion(b + SPLIT_TOL) - conversion(b - SPLIT_TOL))).toBeLessThan(5e-7);
  });
});

describe("§ 6bt.5 — the factor and the effect run OPPOSITE ways across the four understated", () => {
  it("f falls where R - 1 rises, in § 6bn.3's own order", () => {
    const four = rows().filter((r) => verdictOf(r) === "understated");
    expect(four.map((r) => r.name)).toEqual(["split, axis", "split, edge", "anisotropy", "escape"]);
    const f = four.map((r) => conversion(r.branch));
    const e = four.map((r) => departureRatio(r) - 1);
    for (let i = 1; i < four.length; i++) {
      expect(f[i]!).toBeLessThan(f[i - 1]!);
      expect(e[i]!).toBeGreaterThan(e[i - 1]!);
    }
  });

  it("their spreads are within 13%, so the product is not forced into either order", () => {
    const four = rows().filter((r) => verdictOf(r) === "understated");
    const f = four.map((r) => conversion(r.branch));
    const e = four.map((r) => departureRatio(r) - 1);
    const fSpread = Math.max(...f) / Math.min(...f);
    const eSpread = Math.max(...e) / Math.min(...e);
    expect(fSpread).toBeCloseTo(28.0756, 3);
    expect(eSpread).toBeCloseTo(24.7577, 3);
    expect(fSpread / eSpread).toBeCloseTo(1.13402, 4);

    // And the products land in no order at all — § 6bs.6's disagreement, now as
    // the two factors that produce it rather than as two published columns.
    const products = four.map((r) => distanceGrowth(r) - 1);
    expect(products[0]!).toBeCloseTo(6.434765, 5);
    expect(products[1]!).toBeCloseTo(15.307261, 5);
    expect(products[2]!).toBeCloseTo(10.684599, 5);
    expect(products[3]!).toBeCloseTo(5.674246, 5);
    // Neither monotone: it rises, then falls, then falls again.
    expect(products[1]!).toBeGreaterThan(products[0]!);
    expect(products[2]!).toBeLessThan(products[1]!);
    expect(products[3]!).toBeLessThan(products[2]!);
  });
});

describe("§ 6bt.6 — where the branch value is HELD, the two measures must agree on order", () => {
  const family = (): readonly Row[] => {
    const branch = anisoI(branchQuartet());
    return ANISO_ANCHOR_FAMILY.map((m) => ({
      name: "anisotropy",
      branch,
      matched: m,
      rebuilt: false,
    }));
  };

  it("§ 6bs.7's anisotropy family is ONE branch quotient over four anchors", () => {
    const four = family();
    const f = conversion(four[0]!.branch);
    for (const r of four) {
      expect(conversion(r.branch)).toBe(f);
      expect(distanceGrowth(r) - 1).toBeCloseTo((departureRatio(r) - 1) * f, 9);
    }
    const byD = [...four].sort((a, b) => distanceGrowth(a) - distanceGrowth(b));
    const byR = [...four].sort((a, b) => departureRatio(a) - departureRatio(b));
    expect(byD.map((r) => r.matched)).toEqual(byR.map((r) => r.matched));
  });

  it("so § 6bs.7's inversion at the widest anchor survives the change of measure", () => {
    const four = family();
    const d = four.map(distanceGrowth);
    const q = four.map(departureRatio);

    // § 6bs.7's published column.
    expect(d[0]!).toBeCloseTo(11.6846, 3);
    expect(d[1]!).toBeCloseTo(3.3069, 3);
    expect(d[2]!).toBeCloseTo(1.279, 3);
    expect(d[3]!).toBeCloseTo(0.6407, 3);
    // And § 6br's measure of the same four.
    expect(q[0]!).toBeCloseTo(1.242969, 5);
    expect(q[1]!).toBeCloseTo(1.05246, 5);
    expect(q[2]!).toBeCloseTo(1.006344, 5);
    expect(q[3]!).toBeCloseTo(0.99183, 5);

    // The understatement stops at the SAME anchor on both, which § 6bt.2's sign
    // result requires and this measures at the address that matters.
    expect(d[2]!).toBeGreaterThan(1);
    expect(d[3]!).toBeLessThan(1);
    expect(q[2]!).toBeGreaterThan(1);
    expect(q[3]!).toBeLessThan(1);
  });
});

describe("§ 6bt.7 — both measures are blind to a crossing of 1, so the classifier asks first", () => {
  it("departure() folds x and 1/x together, which is the blind spot", () => {
    for (const x of [0.7948724057562382, 0.41088335048448804, 0.8614283392781017])
      expect(departure(x)).toBeCloseTo(departure(1 / x), 12);
  });

  it("the registration cost reads UNDERSTATED on both measures and is REVERSED", () => {
    const costRow = rows().find((r) => r.name === "registration cost")!;
    expect(distanceGrowth(costRow)).toBeCloseTo(6.194799, 5);
    expect(departureRatio(costRow)).toBeCloseTo(1.207751, 5);
    expect(distanceGrowth(costRow)).toBeGreaterThan(1);
    expect(departureRatio(costRow)).toBeGreaterThan(1);
    expect(verdictOf(costRow)).toBe("reversed");
    expect(verdictBy(departureRatio)(costRow)).toBe("reversed");
    // The crossing is the only thing that distinguishes it, and it is real.
    expect(costRow.branch).toBeGreaterThan(1);
    expect(costRow.matched).toBeLessThan(1);
  });

  it("and it is the ONLY row of the six that crosses", () => {
    const crossing = rows().filter((r) => r.branch > 1 !== r.matched > 1);
    expect(crossing.map((r) => r.name)).toEqual(["registration cost"]);
  });
});
