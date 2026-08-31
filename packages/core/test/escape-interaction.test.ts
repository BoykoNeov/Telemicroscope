import { describe, it, expect } from "vitest";
import { fluorescenceSpectralVolume, labelledVolumeEmitters } from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { renderedBestFocus, type FocusProbe, type FocusSweepOptions } from "../src/imaging/focus-surface";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6br — the guard-band escape's interaction, the last of § 6bn's six.
 *
 * § 6bo found that a tile's field of view goes as M / NA, so every "aperture"
 * and "magnification" reading from § 6bk through § 6bn also moved the frame it
 * was taken over. Six interactions were left needing re-measurement at a MATCHED
 * field. § 6bo closed two, § 6bp closed two more and corrected the count, and it
 * named the one this file closes: the guard-band escape, a double-extent volume
 * render that is not a flat field at all.
 *
 * Nothing had built the 10x half. § 6bo.6 re-measured the escape on the aperture
 * lever at 20x only, and an interaction is a quotient of two aperture levers, so
 * it could not be formed. § 6bn's own 0.8231651 used 10x cells CITED from § 6bk
 * and § 6bm at the branch's sampling.
 *
 * ## The quartet, and why it wants three frame sizes
 *
 * `halfExtent` goes as `pupilSamples * M / NA`, so putting four cells at one
 * field wants `pupilSamples` proportional to `NA / M` — ratios 1 : 2 : 2 : 4
 * over (20x/0.10, 20x/0.20, 10x/0.10, 10x/0.20). `escaped` derives its frame
 * size from `pupilSamples`, so those are three distinct frame sizes where the
 * branch's path uses one. § 6bp.8 named that as the precondition, and § 6br.7
 * measures it: at a HELD field a doubling of pixels moves every cell under 0.8%.
 *
 * ## What it says
 *
 * The interaction does not reverse. It is UNDERSTATED, § 6bp's third outcome:
 * 0.8231653 down the branch's path against 0.4108834 at the branch's own field,
 * both below 1, the departure from 1 growing 2.0034x.
 *
 * The halving is not one lever giving way. The two magnifications move in
 * OPPOSITE directions under the correction — at 20x the aperture effect shrinks
 * 16.5389x to 12.9280x, at 10x it GROWS 20.0918x to 31.4640x — which is why no
 * "the confound is a common factor and cancels" argument could have reached it.
 * § 6bo.2 already had to retract that argument once; this is the second readout
 * where the measurement and the argument part company.
 *
 * ## The anchor field is a free parameter, and it turns the quotient over
 *
 * "At a matched field" does not name one experiment. It names a family indexed
 * by WHICH common field is matched at, and no step before this one varied it.
 * Over a 16x range of anchor extent the interaction is single-humped —
 * 0.2462866, 0.3596838, 0.4108834, 0.3100469, 0.1249815 — peaking at the
 * branch's own field and falling to a third of that at either end.
 *
 * Two readings survive it and one does not. The VERDICT survives: every anchor
 * is below 1 and below the branch's 0.8231653, so "understated, sign held" is
 * unanimous. The SIZE does not: the understatement runs 2.0034x to 6.5863x, so
 * no single number is quotable and the step publishes the curve.
 *
 * Scoped deliberately: this is measured for the ESCAPE. Whether other readouts
 * share an anchor sensitivity is not measured here, and § 6bo.3 did vary the
 * field size for the registration cost. This branch has twice had a narrow
 * measurement stated as a general one — § 6bk.8's ceiling and § 6bo.5's field
 * control — and § 6bq spent a commit correcting the second.
 *
 * The low end has a mechanism and the high end does not. The escape is a
 * FRACTION, bounded above by 1, so as the frame shrinks every cell saturates
 * toward 1 and every ratio is compressed toward it: at the smallest anchor the
 * 20x column reads 0.2886 and 0.5232 and its lever has collapsed to 1.8129x.
 * Why the quotient also falls at the largest anchor, where all four escapes are
 * small and nothing is saturating, is measured and not explained.
 */

const DESIGN = 587.5618;
const SIZE = 128;
const PS = 32;
const ANCHOR = 4;
const AXIS = { x: 0, y: 0 };
const EDGE = { x: ANCHOR, y: 0 };
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bk's sweep with § 6bk.8's threshold device, used only for an axial stage. */
const OPEN: FocusSweepOptions = {
  size: 128,
  pupilSamples: 48,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1e9,
  radialMapSeed: "magnification",
};

const magOf = (s: OpticalSystem): number =>
  objectFieldTile(s, { size: SIZE, pupilSamples: PS, wavelengthNm: DESIGN, centreMm: AXIS })
    .magnification;

const extentOf = (s: OpticalSystem, size: number, ps: number): number =>
  objectFieldTile(s, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS })
    .halfExtentMm;

/** § 6bk.4's escape readout — § 6bd.8's double-extent method, field and pixels
 *  both exposed, as § 6bo.6 needed them separated. */
function escaped(
  system: OpticalSystem,
  objectHeightMm: number,
  focusMm: number,
  ps: number,
  size: number,
): number {
  const source = labelledVolumeEmitters([
    {
      density: gaussianBallEmitter({
        waistMm: 0.005,
        axialWaistMm: 0.004,
        peak: 1,
        centreMm: { x: objectHeightMm, y: 0, z: 0 },
      }),
      band: boxcarBand(400, 700),
    },
  ]);
  const wide = fluorescenceSpectralVolume(system, source, {
    size: size * 2,
    pupilSamples: ps,
    slabs: THIN,
    samples: [{ nm: 430, weight: 1 }],
    centreMm: EDGE,
    radialMapSeed: "magnification",
    focusMm,
  });
  const v = wide.planes[0]!.intensity;
  const n = wide.size;
  const o = Math.round((n - size) / 2);
  let inner = 0;
  let all = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = v[r * n + c]!;
      all += x;
      if (r >= o && r < o + size && c >= o && c < o + size) inner += x;
    }
  }
  return 1 - inner / all;
}

/**
 * Builds on FIRST READ and remembers the answer — § 6bo's and § 6bq's `once`.
 * As plain `const`s these renders are paid at COLLECT by every `-t` rerun.
 */
const once = <T>(make: () => T): (() => T) => {
  let held: { v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};

type Cell = "s20" | "f20" | "s10" | "f10";

const LENS: Record<Cell, OpticalSystem> = {
  s20: build(20, 0.1),
  f20: build(20, 0.2),
  s10: build(10, 0.1),
  f10: build(10, 0.2),
};

/** § 6bk's matched object height: every cell's ball at the same IMAGE radius. */
const HEIGHT: Record<Cell, number> = {
  s20: objectHeightForImageRadius(LENS.s20, ANCHOR, DESIGN, { magnification: magOf(LENS.s20) }),
  f20: objectHeightForImageRadius(LENS.f20, ANCHOR, DESIGN, { magnification: magOf(LENS.f20) }),
  s10: objectHeightForImageRadius(LENS.s10, ANCHOR, DESIGN, { magnification: magOf(LENS.s10) }),
  f10: objectHeightForImageRadius(LENS.f10, ANCHOR, DESIGN, { magnification: magOf(LENS.f10) }),
};

/** The branch's convention since § 6bk.4: each lens at its OWN axial stage. */
const STAGE: Record<Cell, () => number> = {
  s20: once(() => renderedBestFocus(LENS.s20, 430, 0, OPEN).focusMm),
  f20: once(() => renderedBestFocus(LENS.f20, 430, 0, OPEN).focusMm),
  s10: once(() => renderedBestFocus(LENS.s10, 430, 0, OPEN).focusMm),
  f10: once(() => renderedBestFocus(LENS.f10, 430, 0, OPEN).focusMm),
};

const MEMO = new Map<string, number>();
/** One escape, memoised on (cell, pupilSamples, size) — lazily, per the header. */
function E(cell: Cell, ps: number, size: number): number {
  const key = `${cell}|${ps}|${size}`;
  let v = MEMO.get(key);
  if (v === undefined) {
    v = escaped(LENS[cell], HEIGHT[cell], STAGE[cell](), ps, size);
    MEMO.set(key, v);
  }
  return v;
}

/** § 6bm's interaction: the aperture lever at the high M over the same at the low M. */
const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
/** The same, written as a departure from 1 in whichever direction it departs. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

/**
 * The matched quartet at an anchor scale `k`. `pupilSamples` proportional to
 * `NA / M` puts all four at one field; `k` chooses WHICH field, and § 6br.6 is
 * what that choice costs.
 */
const QUARTET = (k: number): Record<Cell, number> => ({
  s20: E("s20", 32 * k, 128 * k),
  f20: E("f20", 64 * k, 256 * k),
  s10: E("s10", 64 * k, 256 * k),
  f10: E("f10", 128 * k, 512 * k),
});

const interactionAt = (k: number): number => {
  const q = QUARTET(k);
  return interact(q.s10, q.f10, q.s20, q.f20);
};

/** The branch's own column: every cell at the branch's single sampling. */
const BRANCH = once(
  (): Record<Cell, number> => ({
    s20: E("s20", PS, SIZE),
    f20: E("f20", PS, SIZE),
    s10: E("s10", PS, SIZE),
    f10: E("f10", PS, SIZE),
  }),
);

const branchInteraction = (): number => {
  const b = BRANCH();
  return interact(b.s10, b.f10, b.s20, b.f20);
};

/** § 6bn's published cells and interaction, cited for cross-check only. */
const ESC_10_PUBLISHED = 0.02238865;
const ESC_10F_PUBLISHED = 0.4498281;
const ESC_I_PUBLISHED = 0.8231651;

describe("§ 6br.1 — the branch column reproduces, and § 6bn's number was built from rounded cells", () => {
  it("§ 6bk's and § 6bm's two 10x escapes come back at the branch's own sampling", () => {
    const b = BRANCH();
    expect(b.s10).toBeCloseTo(0.022388654298862054, 12);
    expect(b.f10).toBeCloseTo(0.4498281027627471, 12);
    // Which is what § 6bn cited, to every digit it published.
    expect(b.s10).toBeCloseTo(ESC_10_PUBLISHED, 8);
    expect(b.f10).toBeCloseTo(ESC_10F_PUBLISHED, 7);
  });

  it("and the 20x pair gives § 6bn's interaction — measured exactly, it is 0.8231653", () => {
    const b = BRANCH();
    expect(b.s20).toBeCloseTo(0.021959074296852288, 12);
    expect(b.f20).toBeCloseTo(0.36317810166622566, 12);

    const exact = branchInteraction();
    expect(exact).toBeCloseTo(0.8231652575877593, 12);

    // § 6bn formed it from the ROUNDED cells above and published 0.8231651. The
    // two agree to six digits and differ in the seventh, which is the rounding
    // and not a disagreement — so both are pinned, at the precision each earns.
    expect(exact).toBeCloseTo(ESC_I_PUBLISHED, 6);
    expect(exact).not.toBeCloseTo(ESC_I_PUBLISHED, 7);
  });
});

describe("§ 6br.2 — the quartet sits at one field, exactly on M and to 1.55% on NA", () => {
  it("the magnification lever cancels to twelve digits", () => {
    // `halfExtent` goes as `ps * M / NA`, so doubling `ps` with M halved holds
    // it exactly.
    expect(extentOf(LENS.s10, 256, 64)).toBeCloseTo(extentOf(LENS.s20, 128, 32), 12);
    expect(extentOf(LENS.f10, 512, 128)).toBeCloseTo(extentOf(LENS.f20, 256, 64), 12);
  });

  it("while the aperture lever keeps § 6bo.1's traced-NA residual, at both magnifications", () => {
    const slow = extentOf(LENS.s20, 128, 32);
    const fast = extentOf(LENS.f20, 256, 64);
    expect(slow).toBeCloseTo(0.9353865752380071, 12);
    expect(fast).toBeCloseTo(0.921105025504793, 12);

    // 1.55%, and it is the SAME residual on both rows — which is exactly why
    // § 6br.6 measures whether it cancels instead of arguing that it does.
    const residual = slow / fast;
    expect(residual).toBeCloseTo(1.0155048005794858, 12);
    expect(extentOf(LENS.s10, 256, 64) / extentOf(LENS.f10, 512, 128)).toBeCloseTo(residual, 12);
  });
});

describe("§ 6br.3 — matched, the interaction is UNDERSTATED, and the last of § 6bn's six closes", () => {
  it("0.8231653 down the branch's path becomes 0.4108834 at the branch's own field", () => {
    expect(branchInteraction()).toBeCloseTo(0.8231652575877593, 12);
    expect(interactionAt(1)).toBeCloseTo(0.41088335048448804, 12);
  });

  it("the sign holds — both below 1 — so this is § 6bp's third outcome, not a reversal", () => {
    const branch = branchInteraction();
    const matched = interactionAt(1);

    expect(branch).toBeLessThan(1);
    expect(matched).toBeLessThan(1);
    // Understated: same side, further out. The departure grows almost exactly 2x.
    expect(departure(matched) / departure(branch)).toBeCloseTo(2.0034037802143456, 10);
  });
});

describe("§ 6br.4 — the halving is two levers moving in OPPOSITE directions", () => {
  it("the aperture effect shrinks at 20x and grows at 10x under the same correction", () => {
    const b = BRANCH();
    const q = QUARTET(1);

    const branchAt20 = b.f20 / b.s20;
    const branchAt10 = b.f10 / b.s10;
    const matchedAt20 = q.f20 / q.s20;
    const matchedAt10 = q.f10 / q.s10;

    expect(branchAt20).toBeCloseTo(16.538862101226428, 9);
    expect(matchedAt20).toBeCloseTo(12.928049193723838, 9);
    expect(branchAt10).toBeCloseTo(20.091788311975968, 9);
    expect(matchedAt10).toBeCloseTo(31.464037611842603, 9);

    // Down at 20x, up at 10x — opposite signs, which is the whole finding.
    expect(matchedAt20 / branchAt20).toBeLessThan(1);
    expect(matchedAt10 / branchAt10).toBeGreaterThan(1);
    expect(matchedAt20 / branchAt20).toBeCloseTo(0.7816770654835539, 10);
    expect(matchedAt10 / branchAt10).toBeCloseTo(1.5660147878966084, 10);
  });

  it("so no common-factor argument could have reached it — § 6bo.2's retraction, twice over", () => {
    // A confound that were a pure common factor would move both rows the same
    // way. These move opposite ways, so the readout is not separable in the
    // field, and the quotient does not inherit a cancellation.
    const b = BRANCH();
    const q = QUARTET(1);
    const at20 = q.f20 / q.s20 / (b.f20 / b.s20);
    const at10 = q.f10 / q.s10 / (b.f10 / b.s10);
    expect((at20 - 1) * (at10 - 1)).toBeLessThan(0);
  });
});

describe("§ 6br.5 — the pixel-sampling band is 0.75%, so this readout is NOT refused", () => {
  it("the whole quartet moved one power of two in pixels barely moves the quotient", () => {
    const base = interactionAt(1);
    const finer = interact(E("s10", 64, 512), E("f10", 128, 1024), E("s20", 32, 256), E("f20", 64, 512));
    const coarser = interact(E("s10", 64, 128), E("f10", 128, 256), E("s20", 32, 64), E("f20", 64, 128));

    expect(base).toBeCloseTo(0.41088335048448804, 12);
    expect(finer).toBeCloseTo(0.4098415668937781, 12);
    expect(coarser).toBeCloseTo(0.41293524982178154, 12);

    // § 6bp refused two readouts because their sampling band was as large as the
    // effect and straddled 1. This band is 0.75% against an effect of 2.0034x,
    // and every member is far below 1. It is therefore stated, not refused.
    const band = Math.max(base, finer, coarser) / Math.min(base, finer, coarser);
    expect(band).toBeLessThan(1.008);
    for (const v of [base, finer, coarser]) expect(v).toBeLessThan(0.5);
  });
});

describe("§ 6br.6 — the ANCHOR field is a free parameter, and the quotient turns over on it", () => {
  it("five anchors over a 16x range of extent give a single-humped curve", () => {
    const got = [0.25, 0.5, 1, 2, 4].map(interactionAt);

    expect(got[0]).toBeCloseTo(0.24628656334098914, 12);
    expect(got[1]).toBeCloseTo(0.35968380820639057, 12);
    expect(got[2]).toBeCloseTo(0.41088335048448804, 12);
    expect(got[3]).toBeCloseTo(0.3100469195620605, 12);
    expect(got[4]).toBeCloseTo(0.1249815045049993, 12);

    // Rises to the branch's own field, then falls: a turn, not a band and not a
    // slope. Three anchors would have shown a rise and one outlier.
    expect(got[1]!).toBeGreaterThan(got[0]!);
    expect(got[2]!).toBeGreaterThan(got[1]!);
    expect(got[3]!).toBeLessThan(got[2]!);
    expect(got[4]!).toBeLessThan(got[3]!);
    expect(extentOf(LENS.s20, 512, 128) / extentOf(LENS.s20, 32, 8)).toBeCloseTo(16, 12);
  });

  it("the VERDICT survives every anchor and the SIZE survives none", () => {
    const got = [0.25, 0.5, 1, 2, 4].map(interactionAt);
    const branch = branchInteraction();

    // Unanimous: understated at every anchor, sign held at every anchor.
    for (const v of got) {
      expect(v).toBeLessThan(1);
      expect(v).toBeLessThan(branch);
    }
    // But the understatement runs 2.0035x to 6.5876x, a spread of 3.2876x, so the
    // step publishes the curve and no single matched number is quotable.
    const factors = got.map((v) => departure(v) / departure(branch));
    expect(Math.min(...factors)).toBeCloseTo(2.0034037802143456, 10);
    expect(Math.max(...factors)).toBeCloseTo(6.586296595228076, 10);
    expect(Math.max(...factors) / Math.min(...factors)).toBeCloseTo(3.2875532432725083, 10);
  });

  it("and the small-anchor end has a mechanism: the escape is a fraction, so it saturates", () => {
    const q = QUARTET(0.25);
    // At the smallest anchor the 20x column is a third and a half escaped, and
    // its lever has been compressed toward 1 by the bound at 1.
    expect(q.s20).toBeCloseTo(0.2886089589475007, 12);
    expect(q.f20).toBeCloseTo(0.5232218728583964, 12);
    expect(q.f20 / q.s20).toBeCloseTo(1.812909324667128, 10);
    expect(q.f20 / q.s20).toBeLessThan(QUARTET(1).f20 / QUARTET(1).s20);

    // The large-anchor fall has no such account: there every cell is small and
    // nothing is near the bound, and the quotient falls anyway.
    const big = QUARTET(4);
    for (const v of [big.s20, big.f20, big.s10, big.f10]) expect(v).toBeLessThan(0.1);
  });
});

describe("§ 6br.7 — § 6bp.8's precondition, measured across all three frame sizes", () => {
  it("at a HELD field, doubling the pixels moves every cell by under 0.8%", () => {
    const cells: readonly (readonly [Cell, number, number])[] = [
      ["s20", 32, 128],
      ["f20", 64, 256],
      ["s10", 64, 256],
      ["f10", 128, 512],
    ];
    const ups = cells.map(([c, ps, size]) => E(c, ps, size * 2) / E(c, ps, size));
    const downs = cells.map(([c, ps, size]) => E(c, ps, size / 2) / E(c, ps, size));

    expect(ups[0]).toBeCloseTo(1.0077336276723095, 12);
    expect(ups[1]).toBeCloseTo(1.002863866220616, 12);
    expect(ups[2]).toBeCloseTo(1.003853082268556, 12);
    expect(ups[3]).toBeCloseTo(1.0015414543163983, 12);
    expect(downs[0]).toBeCloseTo(0.9847797637720663, 12);
    expect(downs[1]).toBeCloseTo(0.9942719316101586, 12);
    expect(downs[2]).toBeCloseTo(0.9923297184686127, 12);
    expect(downs[3]).toBeCloseTo(0.9969161863776619, 12);

    for (const t of [...ups, ...downs]) expect(Math.abs(t - 1)).toBeLessThan(0.016);
    for (const t of ups) expect(Math.abs(t - 1)).toBeLessThan(0.008);

    // § 6bo.6 bounded this on ONE cell at 20x; the quartet needs it on three
    // frame sizes, which is what § 6bp.8 said had to exist before a quotient
    // built across them meant anything.
    expect(new Set(cells.map(([, , size]) => size)).size).toBe(3);
  });
});

describe("§ 6br.8 — the stage convention is bounded at 10x for the first time", () => {
  it("a sweep step off the axial stage moves the 10x cells under 0.9%", () => {
    const step = 0.005;
    const s10 = escaped(LENS.s10, HEIGHT.s10, STAGE.s10() + step, 64, 256) / E("s10", 64, 256);
    const f10 = escaped(LENS.f10, HEIGHT.f10, STAGE.f10() + step, 128, 512) / E("f10", 128, 512);

    expect(s10).toBeCloseTo(0.999046932273258, 12);
    expect(f10).toBeCloseTo(0.991497758421579, 12);

    // § 6bo.6 bounded the same convention at 20x — 0.41% and 6.7%. With these
    // two it is bounded at both magnifications, on a convention § 6bk.4, § 6bm,
    // § 6bn and § 6bo all use without one.
    for (const t of [s10, f10]) expect(Math.abs(t - 1)).toBeLessThan(0.009);
  });
});
