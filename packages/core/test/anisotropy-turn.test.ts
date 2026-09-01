import { describe, it, expect } from "vitest";
import { mosaicSeamShiftMm, type FluorescenceMosaicOptions } from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6cb — the hump's turn, and why 0.5115 was never going to have a closed form.
 *
 * § 6bw.7 found the anisotropy threshold turning over at a tile half extent of
 * 0.5115 of the field offset and left two bullets standing through § 6bx, § 6by
 * and § 6bz: "**The hump has a shape and no mechanism.** Why the guard's share
 * of the tile should have a maximum at all — why more anchor helps up to a point
 * and then stops helping — is unmeasured", and "**No closed form for 0.5115.**
 * It is not one half and it is not the kept share."
 *
 * ## The turn of the threshold is the turn of the readout
 *
 * The threshold `i*(r)` solves `I(i*, r) = B` for the branch value `B`, so
 *
 *     d(i*)/dr = −(∂I/∂r) / (∂I/∂i)
 *
 * and `∂I/∂i < 0` throughout this window (§ 6bw.5). **The threshold turns
 * exactly where the readout's own ratio-derivative vanishes** — where the
 * interact, read at a FIXED guard, is largest in the ratio. That is not a model
 * of the hump, it is what the hump is, and it closes on itself numerically: at
 * a guard of 809443 the interact's largest anchor is k = 4.375, and the located
 * threshold at k = 4.375 is 809443 (§ 6cb.0).
 *
 * ## Which is why no closed form fell out
 *
 * The locus `∂I/∂r = 0` is not a fixed ratio. It runs from 0.292 at a guard of
 * 10⁴ to 0.629 at 2 × 10⁶ — a factor of 2.15 — and 0.5115 is where the threshold
 * curve MEETS it (§ 6cb.1). So the number is a fixed point of two curves and not
 * a proportion of the tile: no expression in the tile's own lengths was ever
 * going to produce it, which is why "not one half, not the kept share" kept
 * coming back with nothing to replace it.
 *
 * **It is still a constant of the design, and now it is measured as one.** On
 * one ratio grid both offsets peak at the same anchor, and refined they sit
 * 0.43% apart — 0.5145 at 4 mm against 0.5123 at 2 mm (§ 6cb.2), inside
 * § 6bw.7's own 0.511–0.515 and located rather than bracketed.
 *
 * ## And the turn enters one level below the interact
 *
 * Not in a cell: every cell's anisotropy falls monotonically with the ratio —
 * by half over the sweep — with no turn anywhere. It enters in the APERTURE LEVER —
 * fast over slow at one magnification — which turns at 0.4532 at 10× and 0.4971
 * at 20×, and the interact is their quotient and turns at 0.5117, past both
 * (§ 6cb.3). Two humps whose peaks are 10% apart in ratio, which is § 6by.2's
 * out-of-step shape a third time.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6ca used it: no render, so no focus stage. */
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

/** § 6bo's own denominator: the threshold is where the interact crosses THIS. */
const BRANCH_ANISO = 0.9772598554705617;

const BIG = 2 ** 26;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;

const aniso = (c: Cell, j: number, i: number, x: number): number => {
  const s = mosaicSeamShiftMm(
    LENS[c],
    mosaicOptions(BIG, PS_AT(c, j), {
      guardCells: guardAt(j, i),
      centreMm: { x, y: 0 },
      scan: "stage",
    }),
    65,
  );
  return s.betweenRowsMm / s.betweenColumnsMm;
};
const anisoI = (j: number, i: number, x: number): number =>
  inter4(CELLS.map((c) => aniso(c, j, i, x)));

/** § 6bw.7's variable: the tile half extent over the mosaic's field offset. */
const ratioOfHalf = (j: number, x: number): number =>
  objectFieldTile(LENS.s20, {
    size: BIG,
    pupilSamples: PS_AT("s20", j),
    wavelengthNm: DESIGN,
    centreMm: { x, y: 0 },
  }).halfExtentMm / x;

const located = (j: number, i: number, x: number): void => {
  expect(anisoI(j, i, x)).toBeGreaterThan(BRANCH_ANISO);
  expect(anisoI(j, i + 1, x)).toBeLessThan(BRANCH_ANISO);
};

/** The located thresholds through the peak, on one ratio grid: `AT2[j]` and
 *  `AT4[2j]` are the same ratio (§ 6bz.2). */
const AT4: Record<number, number> = {
  62: 808017,
  66: 809060,
  68: 809333,
  70: 809443,
  72: 809392,
  74: 809182,
  78: 808294,
};
const AT2: Record<number, number> = {
  31: 807607,
  33: 808604,
  35: 808941,
  37: 808636,
  39: 807705,
};

/** The vertex of the parabola through three equally spaced points. */
const vertex = (r: readonly number[], y: readonly number[]): number =>
  r[1]! + ((r[2]! - r[0]!) / 4) * ((y[0]! - y[2]!) / (y[0]! - 2 * y[1]! + y[2]!));

describe("§ 6cb.0 — the threshold turns where the readout's ratio-derivative does", () => {
  it("closes the fixed point: the peak's guard has the peak's anchor as its best", () => {
    // `I(i*, r) = B` differentiates to `di*/dr = -(dI/dr)/(dI/di)`, and `dI/di`
    // is negative throughout this window (§ 6bw.5), so the threshold turns
    // exactly where the interact stops rising with the ratio at a HELD guard.
    // Both halves of that are measured here and they are the same anchor.
    located(70, AT4[70]!, 4);
    for (const j of [66, 68, 72, 74] as const) {
      located(j, AT4[j]!, 4);
      expect(AT4[j]!).toBeLessThan(AT4[70]!);
    }
    // At the threshold's own guard, the interact over the anchor peaks there too.
    const at = (j: number): number => anisoI(j, AT4[70]!, 4);
    expect(at(70)).toBeGreaterThan(at(68));
    expect(at(70)).toBeGreaterThan(at(72));
    // A turn in the threshold and a turn in the readout are not two facts.
    expect(at(70)).toBeCloseTo(0.977259867, 9);
    expect(Math.abs(at(70) / BRANCH_ANISO - 1)).toBeLessThan(2e-8);
  });
});

describe("§ 6cb.1 — the locus is not a fixed ratio, which is why nothing closed", () => {
  it("moves the interact's best anchor by 2.15× across the guard range", () => {
    // Where the interact peaks in the ratio depends on the guard it is read at,
    // over the whole legal range. 0.5115 is where the THRESHOLD curve crosses
    // this locus, so it is a fixed point of two curves and not a proportion of
    // the tile — no expression in the tile's own lengths could have produced it.
    for (const [i, j] of [
      [10000, 40],
      [100000, 60],
      [400000, 66],
      [2000000, 86],
    ] as const) {
      const at = (n: number): number => anisoI(n, i, 4);
      expect(at(j)).toBeGreaterThan(at(j - 2));
      expect(at(j)).toBeGreaterThan(at(j + 2));
    }
    expect(ratioOfHalf(40, 4)).toBeCloseTo(0.2924, 4);
    expect(ratioOfHalf(86, 4)).toBeCloseTo(0.6287, 4);
    expect(ratioOfHalf(86, 4) / ratioOfHalf(40, 4)).toBeCloseTo(2.15, 2);
  });
});

describe("§ 6cb.2 — but the crossing IS a constant of the design", () => {
  it("puts the peak at the same ratio at 2 mm and at 4 mm", () => {
    // Same ratio grid, two offsets, and the peak is the same anchor on both:
    // `AT2[j]` and `AT4[2j]` are one ratio (§ 6bz.2). No fitting is needed to
    // see it, which is what § 6bw.7's coarser grid could not manage.
    for (const j of [31, 33, 35, 37, 39] as const) located(j, AT2[j]!, 2);
    for (const j of [62, 66, 70, 74, 78] as const) located(j, AT4[j]!, 4);
    for (const j of [33, 37] as const) expect(AT2[j]!).toBeLessThan(AT2[35]!);
    for (const j of [66, 74] as const) expect(AT4[j]!).toBeLessThan(AT4[70]!);
    expect(Math.abs(ratioOfHalf(35, 2) / ratioOfHalf(70, 4) - 1)).toBeLessThan(3e-4);
    // Refined by a parabola through the peak and its two neighbours the two
    // offsets sit 0.43% apart, both inside § 6bw.7's own 0.511-0.515.
    const v2 = vertex(
      [33, 35, 37].map((j) => ratioOfHalf(j, 2)),
      [33, 35, 37].map((j) => AT2[j]!),
    );
    const v4 = vertex(
      [66, 70, 74].map((j) => ratioOfHalf(j, 4)),
      [66, 70, 74].map((j) => AT4[j]!),
    );
    expect(v2).toBeCloseTo(0.5123, 4);
    expect(v4).toBeCloseTo(0.5145, 4);
    expect(Math.abs(v4 / v2 - 1)).toBeLessThan(0.005);
    for (const v of [v2, v4]) {
      expect(v).toBeGreaterThan(0.511);
      expect(v).toBeLessThan(0.515);
    }
  });
});

describe("§ 6cb.3 — the turn enters at the aperture lever, not at a cell", () => {
  it("keeps every cell monotone and turns both levers before the interact", () => {
    const I = AT4[70]!;
    const JS = [62, 66, 70, 74, 78] as const;
    const a = JS.map((j) => Object.fromEntries(CELLS.map((c) => [c, aniso(c, j, I, 4)])) as Record<Cell, number>);
    // No cell turns: each falls monotonically, by a fifth across these five
    // anchors and by half over the wider sweep either side of them.
    for (const c of CELLS) {
      for (let n = 1; n < a.length; n++) expect(a[n]![c]).toBeLessThan(a[n - 1]![c]);
    }
    expect(a[0]!.s10 / a[4]!.s10).toBeCloseTo(1.2160, 4);
    expect(aniso("s10", 44, I, 4) / aniso("s10", 100, I, 4)).toBeGreaterThan(2);
    // The 10x aperture lever turns first, at a ratio of 0.4532...
    const l10 = a.map((v) => v.f10 / v.s10);
    const l20 = a.map((v) => v.f20 / v.s20);
    expect(l10[0]!).toBeGreaterThan(l10[1]!);
    expect(l10[1]!).toBeGreaterThan(l10[2]!);
    // ...the 20x at 0.4971, one grid step later...
    expect(l20[1]!).toBeGreaterThan(l20[0]!);
    expect(l20[1]!).toBeGreaterThan(l20[2]!);
    // ...and the interact, their quotient, at 0.5117 — past both of them.
    const ii = a.map((v) => (v.f20 / v.s20) / (v.f10 / v.s10));
    expect(ii[2]!).toBeGreaterThan(ii[1]!);
    expect(ii[2]!).toBeGreaterThan(ii[3]!);
    // Located on the step-2 grid rather than bracketed by the five above: the
    // 10x lever's own best anchor is k = 3.875 and the 20x's is k = 4.25.
    const l10At = (j: number): number => aniso("f10", j, I, 4) / aniso("s10", j, I, 4);
    const l20At = (j: number): number => aniso("f20", j, I, 4) / aniso("s20", j, I, 4);
    expect(l10At(62)).toBeGreaterThan(l10At(60));
    expect(l10At(62)).toBeGreaterThan(l10At(64));
    expect(l20At(68)).toBeGreaterThan(l20At(66));
    expect(l20At(68)).toBeGreaterThan(l20At(70));
    expect(ratioOfHalf(62, 4)).toBeCloseTo(0.4532, 4);
    expect(ratioOfHalf(68, 4)).toBeCloseTo(0.4971, 4);
    // The two levers' peaks are 10% apart in ratio, which is what leaves the
    // quotient with a turn of its own rather than cancelling one.
    expect(ratioOfHalf(68, 4) / ratioOfHalf(62, 4) - 1).toBeCloseTo(0.0968, 4);
  });
});
