import { describe, it, expect } from "vitest";
import { mosaicSeamShiftMm, type FluorescenceMosaicOptions } from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6bx — the cost falls where the anisotropy humps.
 *
 * § 6bw located the ANISOTROPY threshold on a frame-free lattice and found its
 * drift to be a single smooth hump: the guard's share of the tile rises 8.6% to
 * a maximum near k = 4.375 and falls back level. It left the COST threshold
 * alone, with a reason: § 6bw.4 had measured the probe grid moving the cost by
 * 3.8e-4, so "the same treatment would locate a threshold of the 17-probe
 * reading rather than of the seam".
 *
 * **The conclusion was right and the reason was wrong.** That 3.8e-4 was
 * measured at `size` 128, where one pixel is a 128th of the frame and the
 * rounding in `along(p) = round((composed - 1)*p/(probes - 1))` is coarse. At
 * 2^26 the rounding is one part in 2^26, and what is left is genuine finite
 * sampling of the seam — which does NOT vanish. It does not have to. The probe
 * counts sample nested SUPERSETS of seam positions, so every refinement moves
 * the threshold DOWN and never up; the worst 17 -> 257 movement is 2.6e-3 of the
 * located value against a SMALLEST adjacent step of 4.7 times that (§ 6bx.4).
 * And the fall is not inferred from that bound in any case — it is measured
 * whole at 17, at 65 and at 257 probes, and each table falls on its own.
 *
 * ## The cost is the ratio of two interacts, and only one of them moves
 *
 * `costI` is `interact` over four cells of `stage.mm / field.mm`, and `interact`
 * is multiplicative, so it factorises exactly into the stage interact over the
 * field interact (§ 6bx.1, to 2.2e-16 — an identity, not a coincidence).
 * § 6bw.4 proved the stage factor EXACT: its worst sits at the corner
 * `{x: 0, y: pitch}`, which `along(0) = 0` puts on every probe grid there is.
 * So every bit of the cost's probe dependence lives in the field factor alone.
 *
 * ## Why bisecting it is legal
 *
 * The cost's denominator is a MAX over a discrete probe set, so it is only
 * piecewise-smooth in the guard: a kink is possible wherever the argmax jumps
 * from one probe to another, and a bisection across a kink returns A crossing
 * rather than THE threshold. Walked over consecutive lattice steps the value
 * never kinks — zero breaks in strict decrease (§ 6bx.2). The worst's pixel
 * coordinate slides from step to step, so the argmax SETS are all distinct, but
 * that is equally true in a window where nothing is unusual, so it is the kink
 * count that carries the licence and not the set count.
 *
 * ## The law, and it is not the anisotropy's
 *
 * At 4 mm off axis the cost threshold falls MONOTONICALLY across every anchor
 * the design can reach (§ 6bx.3) — no hump, no peak, no turn. End to end it
 * loses 18.7% where the anisotropy's entire hump is 8.6% and returns to within
 * 1% of its start, and k = 4.375, the anisotropy's own peak, is unremarkable on
 * it. So § 6bw's hump is not a property of "the threshold": it belongs to the
 * anisotropy alone.
 *
 * The two readouts are non-monotone in different ORDERS. The anisotropy turns
 * in its VALUE; the cost turns in its SLOPE, decelerating to a minimum and then
 * re-accelerating (§ 6bx.5). That turn is bracketed to a rung and not located:
 * probes 65 and 257 agree on WHICH step is the least, which is the pin, because
 * the probe residual drifts by ~300 across the range — far more than the 27 that
 * separates the two candidate steps — but drifts smoothly enough to cancel in
 * the differences.
 *
 * ## And the monotone fall is a window, not a law
 *
 * Every "never turns" above is 4 mm off axis. Read in § 6bw.7's own variable —
 * the tile half extent as a fraction of the field offset — the threshold JUMPS
 * UP at 2 mm and at 3 mm, at onsets that bracket the same ratio near 1.8, and at
 * a ratio of 1.871 the two offsets locate values 0.8% apart (§ 6bx.8). 4 mm tops
 * out at 1.550 and 5 mm at 1.03, both stopped by § 6bu.7's chief-ray limit. So
 * the design runs out of field before the feature arrives, and that — not a
 * property of the cost — is why nothing turns at 4 mm. The § 6bx.2 licence was
 * re-run at 2 mm across the jump and holds, so this is the threshold moving and
 * not the readout breaking. No mechanism is offered.
 *
 * ## And they cross
 *
 * § 6bv reported the two thresholds "one quarter cell or less apart at 0.4677
 * mm, where this ladder cannot separate them at all". That is k = 1, and they
 * are inseparable there because they CROSS just below it (§ 6bx.6) — a genuine
 * intersection and not a resolution limit. Which disposes of the separation
 * § 6bv left with "a direction and no mechanism": it starts at 1 because the
 * curves cross, grows because one rises while the other falls, and turns over
 * near k = 7 because by then the anisotropy is past its own maximum and falling
 * faster. Every feature it has is inherited from one of the two laws.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6bw used it: no render, so no focus stage. */
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

// ---------------------------------------------------------------------------
// § 6bw's frame-free rig, unchanged, with `costI` in place of `anisoI`.
// ---------------------------------------------------------------------------

/** The frame at which the real one-pixel crop's own share of the tile is 3e-8
 *  and the threshold has converged in the FRAME (§ 6bx.4). */
const BIG = 2 ** 26;
/** `pupilSamples` at anchor `j/16`: § 6bo's shape scaled by the anchor alone. */
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
/** The guard lattice at anchor `j/16` — `j/2^24` of a cell keeps every cell whole. */
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;

/**
 * The guard's share of the tile at lattice point `i`, which by § 6bx.3 is
 * `2*guardAt(j, i)/j = i/2^23` — INDEPENDENT of the anchor, so the whole law is
 * carried by the located `i` alone and the two are the same statement.
 */
const shareOfI = (i: number): number => i / 2 ** 23;

const scans = (
  c: Cell,
  j: number,
  i: number,
  probes: number,
  x: number,
): readonly [number, number] => {
  const o = (over: Partial<FluorescenceMosaicOptions>): FluorescenceMosaicOptions =>
    mosaicOptions(BIG, PS_AT(c, j), {
      guardCells: guardAt(j, i),
      centreMm: { x, y: 0 },
      ...over,
    });
  const field = mosaicSeamShiftMm(LENS[c], o({}), probes);
  const stage = mosaicSeamShiftMm(LENS[c], o({ scan: "stage" }), probes);
  return [stage.mm, field.mm];
};

const costI = (j: number, i: number, probes = 17, x = 4): number => {
  const v = CELLS.map((c) => {
    const [s, f] = scans(c, j, i, probes, x);
    return s / f;
  });
  return interact(v[0]!, v[1]!, v[2]!, v[3]!);
};

/** § 6bx.4's frame check needs the frame as a parameter rather than as `BIG`. */
const costAtFrame = (size: number, j: number, i: number, probes: number): number => {
  const v = CELLS.map((c) => {
    const o = (over: Partial<FluorescenceMosaicOptions>): FluorescenceMosaicOptions =>
      mosaicOptions(size, PS_AT(c, j), { guardCells: guardAt(j, i), ...over });
    const field = mosaicSeamShiftMm(LENS[c], o({}), probes);
    const stage = mosaicSeamShiftMm(LENS[c], o({ scan: "stage" }), probes);
    return stage.mm / field.mm;
  });
  return interact(v[0]!, v[1]!, v[2]!, v[3]!);
};

const anisoI = (j: number, i: number, probes = 17, x = 4): number => {
  const v = CELLS.map((c) => {
    const scan = mosaicSeamShiftMm(
      LENS[c],
      mosaicOptions(BIG, PS_AT(c, j), {
        guardCells: guardAt(j, i),
        scan: "stage",
        centreMm: { x, y: 0 },
      }),
      probes,
    );
    return scan.betweenRowsMm / scan.betweenColumnsMm;
  });
  return interact(v[0]!, v[1]!, v[2]!, v[3]!);
};

// ---------------------------------------------------------------------------
// The located thresholds. `i` is the last guard whose cost is still above 1 and
// `i + 1` the first below it; that PAIR is what every test below re-verifies, so
// nothing here is a remembered number standing on its own. Every value is a
// step-1 bisection on the 2^-24 lattice at 4 mm off axis unless said otherwise.
// ---------------------------------------------------------------------------

const COST_17: Record<number, number> = {
  14: 742986,
  16: 740034,
  32: 717493,
  48: 696493,
  64: 676579,
  70: 669315,
  80: 657394,
  96: 638664,
  112: 620178,
  128: 601771,
};
/** The same at 65 probes, which is where the slope's own turn is pinned. */
const COST_65: Record<number, number> = {
  112: 619006,
  128: 600554,
  144: 582070,
  160: 563441,
  192: 525374,
};
/** And at 257 — the ends of § 6bx.3's table, and the whole of § 6bx.4's bound. */
const COST_257: Record<number, number> = {
  16: 739837,
  32: 716981,
  48: 695680,
  64: 675518,
  70: 668177,
  80: 656144,
  96: 637278,
  112: 618700,
  128: 600237,
};
/** § 6bw.7's own anisotropy thresholds, as VALIDATION.md carries them. */
const ANISO_6BW: Record<number, number> = {
  16: 745108,
  32: 777926,
  64: 808622,
  96: 797046,
  112: 778213,
  128: 752587,
};

const ANCHORS = [16, 32, 48, 64, 70, 80, 96, 112, 128] as const;

/** `i` is the threshold: at it the cost still exceeds 1, at `i + step` it does
 *  not. `step` is the lattice the value was located on. */
const located = (j: number, i: number, probes = 17, x = 4, step = 1): void => {
  expect(costI(j, i, probes, x)).toBeGreaterThan(1);
  expect(costI(j, i + step, probes, x)).toBeLessThan(1);
};

describe("§ 6bx.1 — the cost is two interacts, and only one of them can move", () => {
  it("factorises into the stage interact over the field interact, exactly", () => {
    const v = CELLS.map((c) => scans(c, 64, 675739, 17, 4));
    const stageI = interact(v[0]![0], v[1]![0], v[2]![0], v[3]![0]);
    const fieldI = interact(v[0]![1], v[1]![1], v[2]![1], v[3]![1]);
    const cost = interact(
      v[0]![0] / v[0]![1],
      v[1]![0] / v[1]![1],
      v[2]![0] / v[2]![1],
      v[3]![0] / v[3]![1],
    );
    // `interact` is multiplicative and the per-cell quantity is a ratio, so this
    // is an identity. It is worth pinning because it is WHY the probe grid can
    // reach the cost through only one of the two factors.
    expect(Math.abs(cost / (stageI / fieldI) - 1)).toBeLessThan(1e-15);
  });

  it("and the stage factor does not move with the probe count, at 257 either", () => {
    // § 6bw.4 checked 17…129. The corner {0, pitch} is on every grid, so this
    // ought to hold at any count — and it is the linchpin under § 6bx.6, which
    // reads a sign change that only the COST is allowed to move.
    for (const c of CELLS) {
      const at = (probes: number): number =>
        mosaicSeamShiftMm(
          LENS[c],
          mosaicOptions(BIG, PS_AT(c, 64), { guardCells: guardAt(64, 700000), scan: "stage" }),
          probes,
        ).betweenRowsMm;
      expect(at(257)).toBe(at(17));
      expect(at(513)).toBe(at(17));
    }
  });
});

describe("§ 6bx.2 — the bisection is licensed: the cost does not kink", () => {
  it("is strictly decreasing across consecutive lattice steps at the threshold", () => {
    // The denominator is a max over a discrete probe set, so a kink is possible
    // wherever the argmax jumps. If one sat here, the bisected crossing would be
    // an artifact of the walk rather than a threshold.
    let previous = Infinity;
    for (let i = COST_17[16]! - 5; i <= COST_17[16]! + 5; i++) {
      const v = costI(16, i);
      expect(v).toBeLessThan(previous);
      previous = v;
    }
  });
});

describe("§ 6bx.3 — at 4 mm the cost falls, and it never turns", () => {
  it("is strictly decreasing at all nine anchors, and every threshold is located", () => {
    let previous = Infinity;
    for (const j of ANCHORS) {
      located(j, COST_17[j]!);
      expect(shareOfI(COST_17[j]!)).toBeLessThan(previous);
      previous = shareOfI(COST_17[j]!);
    }
    expect(shareOfI(COST_17[16]!)).toBeCloseTo(0.08821892738342285, 12);
    expect(shareOfI(COST_17[128]!)).toBeCloseTo(0.07173669338226318, 12);
    // 18.7% end to end, where § 6bw's whole hump is 8.6% and its ends are level
    // to 1% — so this is not the anisotropy's law seen from another angle.
    expect(COST_17[128]! / COST_17[16]!).toBeCloseTo(0.813167, 6);
    // And k = 4.375, the anisotropy's own peak, is unremarkable here: it sits
    // between its neighbours like every other rung.
    expect(COST_17[70]!).toBeLessThan(COST_17[64]!);
    expect(COST_17[70]!).toBeGreaterThan(COST_17[80]!);
  });

  it("and the SAME fall is there at 257 probes, not just at 17", () => {
    // The claim § 6bw declined to make. It is not rescued by a residual bound:
    // the table is re-measured at a probe count 15x finer and falls on its own.
    for (const j of [16, 128] as const) located(j, COST_257[j]!, 257);
    expect(COST_257[128]! / COST_257[16]!).toBeCloseTo(0.81131, 5);
  });
});

describe("§ 6bx.4 — the frame has converged; the probe grid has not, and need not", () => {
  it("gives the same integer at 2^22 and at 2^26", () => {
    // On the step-16 lattice, so the guard lands whole at the smaller frame.
    for (const size of [2 ** 22, BIG]) {
      expect(costAtFrame(size, 128, 600544, 65)).toBeGreaterThan(1);
      expect(costAtFrame(size, 128, 600560, 65)).toBeLessThan(1);
    }
  });

  it("bounds what the probe grid is still worth, and the bound does not bind", () => {
    // Refining can only find a worse field maximum, so every anchor moves DOWN
    // and never up. That is a proof about the sign and it is all it is: 65 and
    // 129 agree at these nine anchors and are NOT converged, since 257 moves
    // them, and 65 and 129 already disagree at k = 13 and at 2 mm off axis.
    const shift = (j: number): number => COST_17[j]! - COST_257[j]!;
    expect(ANCHORS.every((j) => shift(j) > 0)).toBe(true);
    const worst = Math.max(...ANCHORS.map(shift));
    expect(worst).toBe(1534);
    expect(worst / COST_257[128]!).toBeLessThan(2.6e-3);
    // The comparison that binds is step-by-step and not end-to-end, because what
    // is being claimed is the SIGN of each step. The smallest step in the table
    // is the 4 -> 4.375 one — three eighths of a rung — and it is still 4.7x the
    // worst movement any refinement produces.
    const steps = ANCHORS.slice(1).map((j, n) => COST_17[ANCHORS[n]!]! - COST_17[j]!);
    expect(Math.min(...steps)).toBe(7264);
    expect(Math.min(...steps) / worst).toBeGreaterThan(4.7);
  });
});

describe("§ 6bx.5 — the cost turns in its SLOPE where the anisotropy turns in its value", () => {
  it("decelerates to a least step at 7 -> 8, then re-accelerates", () => {
    for (const j of [112, 128, 144, 160, 192] as const) located(j, COST_65[j]!, 65);
    const per = (a: number, b: number): number => (COST_65[b]! - COST_65[a]!) / ((b - a) / 16);
    const d78 = per(112, 128);
    const d89 = per(128, 144);
    const d910 = per(144, 160);
    const d1012 = per(160, 192);
    expect(d78).toBeCloseTo(-18452, 0);
    // The turn: 7 -> 8 is the least step in magnitude, and the fall then grows
    // again, monotonically, over three further rungs.
    expect(Math.abs(d78)).toBeLessThan(Math.abs(d89));
    expect(Math.abs(d89)).toBeLessThan(Math.abs(d910));
    expect(Math.abs(d910)).toBeLessThan(Math.abs(d1012));
    // Bracketed to a rung and NOT located. VALIDATION.md records that probes 257
    // pick the same least step (-18463 against -18490), which is what makes this
    // a turn rather than the probe residual; re-deriving it here would cost 16 s
    // of suite time to repeat a number the step's own probes already measured.
  });
});

describe("§ 6bx.6 — the two thresholds cross, at § 6bv's own first rung", () => {
  it("the cost is above the anisotropy at k = 0.875 and below it at k = 1", () => {
    for (const j of [14, 16] as const) located(j, COST_17[j]!);
    // Read the ANISOTROPY at the cost's own threshold. It falls with `i`, so if
    // it is already below the branch value there, its own threshold is the lower
    // of the two and the cost is above it — and the other way at k = 1.
    expect(anisoI(14, COST_17[14]!)).toBeLessThan(BRANCH_ANISO);
    expect(anisoI(16, COST_17[16]!)).toBeGreaterThan(BRANCH_ANISO);
    // § 6bv.5's "one quarter cell or less apart at 0.4677 mm, where this ladder
    // cannot separate them at all" is k = 1. They are inseparable there because
    // they CROSS within a tenth of a rung of it.
    expect(COST_17[16]!).toBeLessThan(ANISO_6BW[16]!);
  });
});

describe("§ 6bx.7 — the separation is the difference of two laws and nothing else", () => {
  it("starts at 1 because they cross, grows, and turns when the hump does", () => {
    const ratio = (j: number): number => ANISO_6BW[j]! / COST_17[j]!;
    // It starts at 1 because the two curves CROSS just below k = 1 (§ 6bx.6).
    expect(ratio(16)).toBeCloseTo(1.00685, 4);
    // It grows while one rises and the other falls.
    expect(ratio(32)).toBeGreaterThan(ratio(16));
    expect(ratio(64)).toBeGreaterThan(ratio(32));
    expect(ratio(96)).toBeGreaterThan(ratio(64));
    expect(ratio(112)).toBeGreaterThan(ratio(96));
    // And it turns over between k = 7 and k = 8 — not at the hump's own peak
    // (k = 4.375) but where the hump has fallen far enough to be losing ground
    // faster than the cost is. Nothing in the separation is its own phenomenon.
    expect(ratio(128)).toBeLessThan(ratio(112));
    expect(ratio(112)).toBeCloseTo(1.25482, 5);
  });
});

describe("§ 6bx.8 — the fall is monotone inside a window, and 4 mm cannot see its edge", () => {
  const ratioOfHalf = (j: number, x: number): number =>
    objectFieldTile(LENS.s20, {
      size: BIG,
      pupilSamples: PS_AT("s20", j),
      wavelengthNm: DESIGN,
      centreMm: { x, y: 0 },
    }).halfExtentMm / x;

  it("the threshold JUMPS UP at 2 mm and at 3 mm, at the tile-to-offset ratio they share", () => {
    // 2 mm: still falling at a ratio of 1.754, jumped by a ratio of 1.871.
    located(120, 485678, 65, 2);
    located(128, 716088, 65, 2);
    expect(716088).toBeGreaterThan(485678);
    // 3 mm: the same, and it locates within 0.8% of the 2 mm value at the ratio
    // the two share — which is what makes this the geometry and not one offset.
    located(184, 494231, 65, 3);
    located(192, 710144, 65, 3);
    expect(710144).toBeGreaterThan(494231);
    expect(ratioOfHalf(128, 2)).toBeCloseTo(1.871, 3);
    expect(ratioOfHalf(192, 3)).toBeCloseTo(1.871, 3);
    expect(Math.abs(716088 / 710144 - 1)).toBeLessThan(0.01);
  });

  it("and 4 mm stops short of it, at a ratio of 1.550", () => {
    // § 6bu.7's chief-ray limit, which is why § 6bx.3 sees a monotone fall: the
    // design runs out of field before the feature arrives.
    expect(ratioOfHalf(212, 4)).toBeCloseTo(1.55, 2);
    expect(() => costI(216, 500000, 17, 4)).toThrow(/objectHeightForImageRadius/);
    // 5 mm cannot even reach 1.04 before the same refusal.
    expect(ratioOfHalf(176, 5)).toBeLessThan(1.04);
  });
});
