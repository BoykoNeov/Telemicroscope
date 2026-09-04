import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile } from "../src/imaging/object-field";
import { renderedBestFocus } from "../src/imaging/focus-surface";
import {
  uniformSlabs,
  gaussianBallEmitter,
  type EmitterSlabs,
} from "../src/imaging/emitter-volume";
import { objectNumericalAperture } from "../src/pupil/microscope";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6cq — § 6bn's first interval, and the engine change that was not needed.
 *
 * § 6bo established that this branch's two levers each move two things — at a
 * fixed `pupilSamples` a tile's field of view goes as `M/NA` — re-measured the
 * render-free readouts at a matched field, and found both reversing sign. It
 * could not reach § 6bn's FIRST interval and said why, twice:
 *
 * > § 6bn's *first* interval, 4×→10×, cannot be re-measured this way at all —
 * > matching the 4× frame needs a non-integer `pupilSamples` at every
 * > power-of-two frame size … A frame size that is not a power of two, or a
 * > sampling that is not an integer, would be an engine change and is not
 * > attempted.
 *
 * **The hypothesis this step tests** is that the second sentence is false and
 * the first is therefore moot: a non-integer `pupilSamples` is not an engine
 * change, it is a frame this engine already forms, and § 6bn's first interval
 * can be re-measured at a matched field today. **What would refute it** is a
 * discontinuity — any readout that treats an integer sampling as special, or a
 * quantity that stops obeying its own closed form between two integers. There
 * is none, and the three checks below are chosen to be the ones that would have
 * found one.
 *
 * ## Why the refusal was never there
 *
 * `objectFieldFrame` requires `pupilSamples > 0` and nothing else. The
 * power-of-two requirement that does exist lives in `illumination/source` and
 * `imaging/condenser-field`, where a source LATTICE has to be commensurate with
 * the pupil's frequency grid — and no readout on this branch touches either.
 * What `pupilSamples` sets here is the frame's field of view through
 * `imagePixelScaleMm`, which is a scaling and has no integer in it: the object
 * half-extent stays exactly `pupilSamples·λ/(4·NA)` at every sampling tried,
 * integer and fractional alike, to the same relative offset in the twelfth digit
 * (§ 6cq.0).
 *
 * And a fractional sampling cannot smuggle in a rounded guard, because
 * `mosaicGuardPixels` **refuses** a guard that is not a whole number of pixels
 * rather than rounding it — its own comment gives the reason, which is that a
 * rounded guard "produces a perfectly plausible mosaic whose seam error is not
 * the one the caller asked for". So the class of artefact a fractional sampling
 * might have introduced is one the engine already declines to produce.
 *
 * ## And nothing distinguishes an integer
 *
 * Two readouts, chosen because they fail differently. The render-free seam is
 * smooth through `pupilSamples = 16`: its second differences vary by 7% across
 * a window straddling the integer and do not spike at it (§ 6cq.1). The
 * RENDERED plateau, on a PINNED sweep grid so the coarse pass cannot contribute,
 * scatters 0.98% across `pupilSamples` 44…52, and the nine integers in that
 * ladder are spread through the whole ranking — they hold the top place and
 * three of the bottom five, where a fraction holds the bottom — with the two
 * group means 0.11% apart against a 0.27% scatter inside each. That is § 6bf.5's
 * own readout roughness, which it measured at 0.34% over a 4× change of sweep
 * step, and not a property of the sampling.
 *
 * ## So § 6bn's first interval, twice
 *
 * Matched at the 4× frame — the member § 6bo named — needs `pupilSamples` of
 * 12.8 and 25.6, and lands the guard whole at § 6bo's own frame size and
 * `guardCells` (§ 6cq.2). Matched at the 10× frame instead needs no fractional
 * sampling at all, only a guard of five cells rather than four so that ps = 80
 * divides a power of two (§ 6cq.3) — which is worth saying plainly: **"at a
 * matched field" names a family (§ 6bp), and § 6bo's deferral had fixed on the
 * one member that is awkward.** § 6cl's own `STEP_4_10` is this quartet.
 *
 * Both members say the same thing. The branch's path reproduces § 6bn's
 * published 1.1061 and 1.0166; at a matched field the cost interaction
 * **crosses 1** — 0.9500 at the 10× frame, 0.6837 at the 4× frame — and the
 * anisotropy's departure from 1 grows, 0.8766 and 0.6299. The two members
 * differ from each other because the readout is not multiplicatively separable
 * in (field, lever), which is § 6bo.2's finding and not a discrepancy.
 *
 * ## Which withdraws § 6bn.5
 *
 * § 6bn.5's one surviving cross-interval statement was that the two readouts
 * "go opposite ways": the cost's interaction shrinks toward separation,
 * 1.1061 → 1.0417, while the anisotropy's grows away from it. Read at ONE field
 * they do not. Both sit below 1 on both intervals and both grow their departure
 * — cost 0.9500 → 0.7949, anisotropy 0.8766 → 0.7862 (§ 6cq.4). The opposition
 * was the frame, exactly as § 6bo found for the values it was built from.
 *
 * Two intervals is still not a law, and § 6bl.2's refusal to extrapolate a short
 * series governs here as everywhere on this branch. What is retired is a
 * specific published claim and a specific "cannot be measured".
 *
 * Source: measurement only — no engine change, and that is the finding rather
 * than the caveat. It is also the THIRD such step in a row on this chain
 * (§ 6co, § 6cp, § 6cq), so the stop rule in VALIDATION's *Rules* now applies:
 * what this step leaves goes to `docs/OPEN-PROBLEMS.md` as a problem and not
 * onto the ladder as a fourth.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };
/** § 6bk…§ 6bo's own anchor, frame size and guard. */
const ANCHOR = { x: 4, y: 0 };
const SIZE = 128;
const PS = 32;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

const F10 = build(4, 0.1);
const F20 = build(4, 0.2);
const T10 = build(10, 0.1);
const T20 = build(10, 0.2);
const W10 = build(20, 0.1);
const W20 = build(20, 0.2);

function mosaicOptions(
  size: number,
  ps: number,
  guardCells: number,
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
    guardCells,
    stageMm: () => 0,
    radialMapSeed: "magnification",
    centreMm: ANCHOR,
    ...over,
  } as FluorescenceMosaicOptions;
}

/** § 6bj's registration cost and its anisotropy — geometry only, no render.
 *  Carried rather than imported, on § 6cl's rule about shared harnesses. */
interface Cost {
  readonly ratio: number;
  readonly aniso: number;
  readonly fieldMm: number;
  readonly scanMm: number;
}
const cost = (sys: OpticalSystem, size: number, ps: number, guardCells = 4): Cost => {
  const field = mosaicSeamShiftMm(sys, mosaicOptions(size, ps, guardCells));
  const scan = mosaicSeamShiftMm(sys, mosaicOptions(size, ps, guardCells, { scan: "stage" }));
  return {
    ratio: scan.mm / field.mm,
    aniso: scan.betweenRowsMm / scan.betweenColumnsMm,
    fieldMm: field.mm,
    scanMm: scan.mm,
  };
};

const extent = (sys: OpticalSystem, size: number, ps: number): number =>
  objectFieldTile(sys, {
    size,
    pupilSamples: ps,
    wavelengthNm: DESIGN,
    centreMm: { x: 0, y: 0 },
  }).halfExtentMm;

/** § 6bm's and § 6bn's quotient, slow/lo, fast/lo, slow/hi, fast/hi. */
const interact = (v: readonly Cost[], of: (c: Cost) => number): number =>
  of(v[3]!) / of(v[2]!) / (of(v[1]!) / of(v[0]!));

const rel = (actual: number, recorded: number): number => Math.abs(actual / recorded - 1);

/** The three quartets, lazily, because each is four pairs of seam walks. */
const once = <T,>(f: () => T): (() => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};
/** § 6bm's and § 6bn's own path: sampling held, so the field grows with M. */
const BRANCH = once(() => [
  cost(F10, SIZE, PS),
  cost(F20, SIZE, PS),
  cost(T10, SIZE, PS),
  cost(T20, SIZE, PS),
]);
/** Matched at the 4× frame — § 6bo's named member, and the fractional one. */
const AT_4X = once(() => [
  cost(F10, SIZE, 32),
  cost(F20, SIZE, 64),
  cost(T10, SIZE, 12.8),
  cost(T20, SIZE, 25.6),
]);
/** Matched at the 10× frame — all integers, at a five-cell guard so that a
 *  sampling of 80 lands the guard whole on a power-of-two frame. */
const AT_10X = once(() => [
  cost(F10, SIZE, 80, 5),
  cost(F20, SIZE, 160, 5),
  cost(T10, SIZE, 32, 5),
  cost(T20, SIZE, 64, 5),
]);
/** § 6bo's SECOND interval, re-run here so the two are compared in one harness. */
const I2_BRANCH = once(() => [
  cost(T10, SIZE, PS),
  cost(T20, SIZE, PS),
  cost(W10, SIZE, PS),
  cost(W20, SIZE, PS),
]);
const I2_MATCHED = once(() => [
  cost(T10, SIZE, PS),
  cost(T20, 256, 64),
  cost(W10, SIZE, 16),
  cost(W20, SIZE, PS),
]);

describe("§ 6cq.0 — a non-integer pupilSamples is not an engine change", () => {
  it("keeps the object half extent exactly linear in the sampling", () => {
    // `pupilSamples` sets the field through a SCALING — § 6h.2's closed form —
    // and a scaling has no integer in it. The relative offset from the closed
    // form is § 6bo.1's traced-versus-design NA drift, and it is the same
    // number at every sampling rather than something that happens at integers.
    const na = objectNumericalAperture(T10, DESIGN);
    const offsets = [15.6, 15.8, 15.9, 16, 16.1, 16.2, 16.4, 32, 32.5].map((ps) => {
      const obj = objectFieldTile(T10, {
        size: SIZE,
        pupilSamples: ps,
        wavelengthNm: DESIGN,
        centreMm: { x: 0, y: 0 },
      }).objectHalfExtentMm;
      return obj / ((ps * DESIGN * 1e-6) / (4 * na)) - 1;
    });
    for (const o of offsets) expect(rel(o, offsets[0]!)).toBeLessThan(1e-12);
    expect(rel(offsets[0]!, -5.0126e-3)).toBeLessThan(1e-4);
  });

  it("and matches the 4× frame to the thirteenth digit, which is the point", () => {
    // This is the reading § 6bo said needed an engine change: the 10× cell at
    // 12.8 samples has the 4× cell's own frame at 32.
    // A part in 10¹², per VALIDATION's *Rules* — a half extent is the end of a
    // chain of traces, so this is what a well-conditioned reading of one is
    // worth, not what one sample happened to give.
    expect(rel(extent(T10, SIZE, 12.8), extent(F10, SIZE, PS))).toBeLessThan(1e-13);
    expect(rel(extent(T20, SIZE, 25.6), extent(F20, SIZE, 64))).toBeLessThan(1e-13);
    // With § 6bo.3's own 1.55% left between the two APERTURES, because the
    // traced aperture is not the design NA. Unchanged by the sampling being
    // fractional, which is what makes the quartet comparable to § 6bo's.
    expect(rel(extent(F10, SIZE, PS) / extent(F20, SIZE, 64) - 1, 1.5505e-2)).toBeLessThan(1e-3);
  });

  it("and a fractional sampling cannot smuggle in a rounded guard", () => {
    // `mosaicGuardPixels` refuses rather than rounds, so the artefact a
    // fractional sampling might have introduced is one nothing here can produce.
    // The quartets below are chosen so every guard lands whole.
    expect(() => cost(T10, SIZE, 12.8)).not.toThrow();
    expect(() => cost(F10, SIZE, 80, 5)).not.toThrow();
    expect(() => cost(F10, SIZE, 80, 4)).toThrow(/makes it whole rather than having it rounded/);
    expect(() => cost(T10, SIZE, 12.7)).toThrow(/makes it whole rather than having it rounded/);
  });
});

describe("§ 6cq.1 — and nothing distinguishes an integer sampling", () => {
  it("walks the render-free seam through 16 without a kink", () => {
    const seen = [15.6, 15.7, 15.8, 15.9, 16, 16.1, 16.2, 16.3, 16.4].map((ps) => ({
      ps,
      mm: mosaicSeamShiftMm(T10, mosaicOptions(2 ** 20, ps, 0), 65).betweenRowsMm,
    }));
    // Strictly rising, and the second difference — which is where a kink at an
    // integer would show — drifts smoothly by 7% across the window with its
    // largest and smallest values at the two ENDS, not at ps = 16.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.mm).toBeGreaterThan(seen[i - 1]!.mm);
    const d2: number[] = [];
    for (let i = 1; i + 1 < seen.length; i++) {
      d2.push((seen[i + 1]!.mm - 2 * seen[i]!.mm + seen[i - 1]!.mm) / seen[i]!.mm);
    }
    for (let i = 1; i < d2.length; i++) expect(d2[i]!).toBeLessThan(d2[i - 1]!);
    expect(rel(d2[0]!, 9.077e-5)).toBeLessThan(1e-3);
    expect(rel(d2[d2.length - 1]!, 8.453e-5)).toBeLessThan(1e-3);
  }, 600000);

  it("and puts the rendered plateau's nine integers all through the ranking", () => {
    // The plateau is the readout that could plausibly care — it is a three-point
    // second difference of a rendered peak, which § 6bf.5 already measures
    // moving 0.34% over a 4× change of sweep step. It scatters about a percent
    // here, and the scatter has no integer structure in it.
    //
    // Run twice, because the sweep GRID is the obvious confound: pinned, so the
    // coarse pass cannot land differently at different samplings, and free, so
    // the pinned centre's own off-centring cannot be what produces the scatter.
    // The vertex moves 7.0e-4 mm across the ladder — 0.14 of a sweep step — so
    // this control is not a formality.
    const ALL: number[] = [];
    for (let ps = 44; ps <= 52.0001; ps += 0.5) ALL.push(ps);
    /** The free grid pays a coarse pass per point, so its control runs on a
     *  nine-point subset of mixed parity rather than the whole ladder. */
    const SUBSET = [44, 44.5, 46, 46.5, 48, 48.5, 50, 50.5, 52];
    const ladder = (aboutMm: number | undefined, list: readonly number[] = ALL) => {
      const seen: { ps: number; d: number; focus: number; interior: boolean }[] = [];
      for (const ps of list) {
        const r = renderedBestFocus(T10, 430, 0, {
          size: SIZE,
          pupilSamples: ps,
          slabs: uniformSlabs(-0.008, 0.008, 3),
          probe: (centreMm) =>
            gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm }),
          stepMm: 0.005,
          halfMm: 0.03,
          ...(aboutMm === undefined ? {} : { aboutMm }),
          maxPlateauDepths: 1e9,
          radialMapSeed: "magnification",
        });
        seen.push({ ps, d: r.plateauDepths, focus: r.focusMm, interior: r.interior });
      }
      return seen;
    };
    const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    const sd = (v: readonly number[]): number => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));

    // The centre is this lens's own unpinned vertex rounded to four figures.
    const pinned = ladder(0.0637);
    const free = ladder(undefined, SUBSET);
    for (const p of [...pinned, ...free]) expect(p.interior).toBe(true);
    const drift = Math.max(...pinned.map((p) => p.focus)) - Math.min(...pinned.map((p) => p.focus));
    expect(rel(drift, 7.021e-4)).toBeLessThan(0.05);
    for (const p of pinned) expect(Math.abs(p.focus - 0.0637)).toBeLessThan(0.03 / 2);

    for (const [name, seen] of [["pinned", pinned]] as const) {
      const ints = seen.filter((p) => Number.isInteger(p.ps)).map((p) => p.d);
      const fracs = seen.filter((p) => !Number.isInteger(p.ps)).map((p) => p.d);
      expect(ints.length, name).toBe(9);
      expect(fracs.length, name).toBe(8);
      // The whole ladder spans about a percent, and the two groups' means sit
      // well inside the scatter of either — a tenth of a percent apart against
      // near three tenths within, so the separation to be found is smaller than
      // the noise either group already carries.
      const spread = Math.max(...seen.map((p) => p.d)) / Math.min(...seen.map((p) => p.d)) - 1;
      expect(spread, name).toBeGreaterThan(9e-3);
      expect(spread, name).toBeLessThan(1.1e-2);
      expect(Math.abs(mean(ints) / mean(fracs) - 1), name).toBeLessThan(sd(ints) / mean(ints) / 2);
      expect(sd(ints) / mean(ints), name).toBeGreaterThan(2.4e-3);
      expect(sd(fracs) / mean(fracs), name).toBeGreaterThan(2.4e-3);
      // And they interleave: an integer holds the top place and a fraction the
      // bottom, which is what a scatter with no integer structure looks like.
      const order = [...seen].sort((a, b) => a.d - b.d);
      expect(Number.isInteger(order[order.length - 1]!.ps), name).toBe(true);
      expect(Number.isInteger(order[0]!.ps), name).toBe(false);
      expect(order.slice(0, 8).filter((p) => Number.isInteger(p.ps)).length, name)
        .toBeGreaterThanOrEqual(3);
    }
    // And the two grids rank the ladder identically, which is the control: the
    // ordering is a property of the sampling and not of where the sweep sat.
    // Checked on the nine the free grid was run at, integers and fractions both.
    const orderOf = (seen: readonly { ps: number; d: number }[]): number[] =>
      [...seen].sort((a, b) => a.d - b.d).map((p) => p.ps);
    expect(free.length).toBe(SUBSET.length);
    expect(SUBSET.filter((p) => Number.isInteger(p)).length).toBe(5);
    expect(orderOf(pinned.filter((p) => SUBSET.includes(p.ps)))).toEqual(orderOf(free));
  }, 900000);
});

describe("§ 6cq.2 — so § 6bn's first interval, at the 4× frame § 6bo named", () => {
  it("reproduces § 6bn's published pair down the branch's own path first", () => {
    // Nothing below is comparable unless this is, which is § 6bo.2's own
    // discipline: § 6bn's table gives 1.1061 for the cost and quotes the
    // anisotropy as its departure from 1, 1.0166.
    const b = BRANCH();
    expect(rel(interact(b, (c) => c.ratio), 1.1060587)).toBeLessThan(1e-6);
    expect(rel(interact(b, (c) => c.aniso), 0.9836274)).toBeLessThan(1e-6);
    expect(rel(1 / interact(b, (c) => c.aniso), 1.0166)).toBeLessThan(1e-4);
    // Down that path the four fields are four different fields, in the exact
    // proportion M/NA — which is the confound § 6bo named.
    expect(rel(extent(T10, SIZE, PS) / extent(F10, SIZE, PS), 2.5)).toBeLessThan(1e-12);
  }, 600000);

  it("and crosses 1 at the 4× frame, on two fractional samplings", () => {
    const m = AT_4X();
    expect(rel(interact(m, (c) => c.ratio), 0.6836976)).toBeLessThan(1e-6);
    expect(rel(interact(m, (c) => c.aniso), 0.6299086)).toBeLessThan(1e-6);
    expect(interact(m, (c) => c.ratio)).toBeLessThan(1);
    expect(interact(BRANCH(), (c) => c.ratio)).toBeGreaterThan(1);
    // § 6bo.3's decomposition, on this lever: the reversal is the FIELD-scanned
    // term's, which goes from 0.9924 down the branch's path to 2.6250 here.
    expect(rel(interact(BRANCH(), (c) => c.fieldMm), 0.9924256)).toBeLessThan(1e-6);
    expect(rel(interact(m, (c) => c.fieldMm), 2.6250406)).toBeLessThan(1e-6);
  }, 600000);
});

describe("§ 6cq.3 — and the 4× frame was never the only member", () => {
  it("matches at the 10× frame with no fractional sampling at all", () => {
    // "At a matched field" names a FAMILY (§ 6bp), and § 6bo's deferral had
    // fixed on its one awkward member. Matching at the 10× frame wants
    // pupilSamples 80, 160, 32, 64 — all integers — and a five-cell guard so
    // that 80 divides a power-of-two frame. § 6cl's STEP_4_10 is this quartet.
    const m = AT_10X();
    expect(rel(interact(m, (c) => c.ratio), 0.9499626)).toBeLessThan(1e-6);
    expect(rel(interact(m, (c) => c.aniso), 0.8765701)).toBeLessThan(1e-6);
    expect(interact(m, (c) => c.ratio)).toBeLessThan(1);
    expect(rel(extent(F10, SIZE, 80), extent(T10, SIZE, PS))).toBeLessThan(1e-13);
    // The two members disagree, and that is § 6bo.2's non-separability rather
    // than a discrepancy: one field is 2.5× the other and the readout is
    // nowhere near a power law in it.
    expect(interact(AT_4X(), (c) => c.ratio)).toBeLessThan(interact(m, (c) => c.ratio));
  }, 600000);
});

describe("§ 6cq.4 — which withdraws § 6bn.5's 'they go opposite ways'", () => {
  it("puts both interactions on one side of 1 on both intervals", () => {
    // § 6bn.5: "the registration cost's interaction shrinks 1.1061 → 1.0417,
    // toward separation; the anisotropy's grows 1.0166 → 1.0233, away from it."
    // Read at ONE field they do not go opposite ways — both are below 1 and
    // both grow their departure from it.
    const i2b = I2_BRANCH();
    const i2m = I2_MATCHED();
    // § 6bo's own second-interval numbers, in this harness.
    expect(rel(interact(i2b, (c) => c.ratio), 1.0416581)).toBeLessThan(1e-6);
    expect(rel(interact(i2m, (c) => c.ratio), 0.7948724)).toBeLessThan(1e-6);
    expect(rel(interact(i2m, (c) => c.aniso), 0.7862301)).toBeLessThan(1e-6);

    const costs = [interact(AT_10X(), (c) => c.ratio), interact(i2m, (c) => c.ratio)];
    const anisos = [interact(AT_10X(), (c) => c.aniso), interact(i2m, (c) => c.aniso)];
    for (const v of [...costs, ...anisos]) expect(v).toBeLessThan(1);
    expect(costs[1]!).toBeLessThan(costs[0]!);
    expect(anisos[1]!).toBeLessThan(anisos[0]!);
    // Down the branch's path the cost's departure SHRANK where the anisotropy's
    // grew, which is the sentence being withdrawn.
    const bc = [interact(BRANCH(), (c) => c.ratio), interact(i2b, (c) => c.ratio)];
    const ba = [interact(BRANCH(), (c) => c.aniso), interact(i2b, (c) => c.aniso)];
    expect(bc[0]!).toBeGreaterThan(1);
    expect(bc[1]!).toBeGreaterThan(1);
    expect(bc[1]!).toBeLessThan(bc[0]!); // toward 1
    expect(ba[1]!).toBeLessThan(ba[0]!); // away from 1, on the other side
    expect(1 / ba[1]!).toBeGreaterThan(1 / ba[0]!);
  }, 900000);
});
