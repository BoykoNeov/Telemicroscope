import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import {
  renderedBestFocus,
  type FocusProbe,
  type FocusSweepOptions,
} from "../src/imaging/focus-surface";
import {
  fluorescenceSpectralVolume,
  labelledVolumeEmitters,
} from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bo — both levers were two levers.
 *
 * § 6bk, § 6bl, § 6bm and § 6bn all pull the same two levers: build the same
 * objective at another magnification or another aperture, read something off
 * both, and quote the ratio as what the lever did. § 6bn went furthest, giving
 * six of those ratios a second interval and finding that not one is a slope.
 *
 * **None of those four steps noticed that each lever moves two things.** A
 * frame's object half-extent is `pupilSamples · λ / (4 · NA_image)` — the
 * closed form is in `object-field.ts` and § 6h.2 pinned it — and the image-side
 * aperture is the object-side one over the magnification, so at a fixed
 * `pupilSamples` the tile's FIELD OF VIEW is proportional to **M / NA**.
 * Opening the aperture shrinks the frame the readout is taken over; raising the
 * magnification grows it, in exact proportion. § 6be.8 and § 6bh.2 both pinned
 * `halfExtentMm ∝ λ` to the last bit and § 6bj.7 pinned that nine tiles share
 * one `halfExtentMm`, so the quantity is not unexamined — but its dependence on
 * the two levers this branch actually pulls is measured here for the first time.
 *
 * The consequence is not uniform, and the whole value of this step is that it
 * separates the cases rather than issuing one blanket retraction. Every readout
 * is measured twice: once down the branch's own path (`pupilSamples` held, so
 * the field moves with the lever), and once at a MATCHED field (`pupilSamples`
 * moved with the lever, so the field is held — to 1.55% on the aperture lever,
 * to thirteen digits on the magnification one). The outcomes:
 *
 * | Readout | branch's path | matched field | verdict |
 * | --- | --- | --- | --- |
 * | registration cost, aperture ×2 | rises 1.5997× | **falls 1.5384×** | SIGN REVERSES |
 * | registration cost, M ×2 | falls 1.9850× | **rises 1.2404×** | SIGN REVERSES |
 * | seam anisotropy, aperture ×2 | rises 1.9286× | **falls 1.1455×** | SIGN REVERSES |
 * | guard-band escape | rises 17.729× | rises 13.826× | sign holds, 1.282× inflated |
 * | axial plateau width | rises 3.2761× | rises 3.1918× | untouched, 2.6% spread |
 *
 * So the render-free geometric readouts were measuring the field of view and
 * not the lever — on BOTH levers, their dependence has the opposite sign once
 * the field is held. The rendered guard-band escape keeps its direction and
 * loses about a quarter of its size. The axial plateau is field-free to a few
 * percent, which is what makes § 6bn.2's and § 6bo.5's refusal boundary real
 * optics rather than a sampling choice.
 *
 * **The most consequential casualty is a caller-facing number.** § 6bl.4 fitted
 * three magnifications and offered a budget — the registration cost "goes as
 * 95.7 over M, plus about a tenth" — and § 6bm.5 and § 6bn.5 both re-read that
 * bill. At a field matched to thirteen digits the cost RISES with magnification,
 * 1.2404× from 10× to 20×, where the fitted law has it fall 1.9850×. The 1/M was
 * the field growing as M. § 6bo.4 measures it; the fit is not re-offered here.
 *
 * **The interaction quotients do not escape either, and § 6bo.2 measures which.**
 * § 6bm's and § 6bn's headline numbers are QUOTIENTS — the aperture ratio at a
 * high magnification over the same ratio at a low one — and each lever's field
 * factor turns out to be PURE (the shrink per aperture doubling is
 * `2.031009601158958` at 4×, 10× and 20× alike; the growth per magnification
 * step is exactly `M_hi / M_lo` at both apertures), so the confound enters the
 * numerator and the denominator as the same factor. It is tempting to conclude
 * that it cancels. **It cancels only if the readout is multiplicatively separable
 * in (field, lever), and measurement says it is not.** Re-computing § 6bn's own
 * quotient from four cells at one field:
 *
 * | § 6bn's interaction, 10×→20× | branch's way | matched field | |
 * | --- | --- | --- | --- |
 * | registration cost | 1.0416581 | **0.7948724** | CROSSES 1 |
 * | seam anisotropy | 0.9772599 | **0.7862301** | distance from 1 ×11.68 |
 * | axial plateau | 0.8614283 | 0.8691012 | survives, 0.89% |
 *
 * The branch's-way column reproduces § 6bn's pinned `costI`, `anisoI` and
 * `plateauI` to seven digits, which is what makes the other column comparable.
 * So two of § 6bn's six interactions are field artefacts — one of them changing
 * which side of 1 it falls on — and one is not. **The separation is not
 * arbitrary: the survivor is the readout § 6bo.5 measures to be field-free.**
 * Purity of the field factor is necessary and not sufficient; what decides an
 * interaction's fate is whether the READOUT is field-sensitive. § 6bn's other
 * three interactions are rendered flat-field quantities and are NOT re-measured
 * here, so their status is unknown rather than confirmed.
 *
 * ## Where the reversal actually lives
 *
 * The registration cost is `scan.mm / field.mm` — a stage-scanned seam shift
 * over a field-scanned one. § 6bo.3 does not stop at the ratio, because a ratio
 * can reverse on one term alone. Decomposed, the two paths differ in the
 * DENOMINATOR and agree in nothing:
 *
 *   - branch's path: `field.mm` falls 4.5611×, `scan.mm` falls 2.8511× → up
 *   - matched field: `field.mm` **rises** 1.3650×, `scan.mm` falls 1.1327× → down
 *
 * `field.mm` reverses direction between the two paths at all three field sizes
 * tried (rises 1.3650×, 2.4137×, 1.1270×); `scan.mm` has no consistent
 * direction at a matched field at all. So the ratio's reversal is carried by
 * the field-scanned seam shift, and that is what is claimed.
 *
 * § 6bn's first interval (4×→10×) cannot be re-measured this way at all —
 * matching the 4× frame needs a non-integer `pupilSamples` at every power-of-two
 * frame size — so § 6bn's "not one of the six is a slope" is neither confirmed
 * nor refuted here. What is measured is that two of the numbers it compared were
 * not the quantities it took them for.
 *
 * The magnification lever's matched pairs are the cleaner experiment of the
 * two: `halfExtent ∝ M / NA` with NA held means the sampling can be moved to
 * cancel the magnification exactly, and the two fields agree to thirteen digits
 * — where the aperture pairs carry a 1.55% residual because the TRACED aperture
 * drifts from the design NA (§ 6bo.1 pins that drift at 2.76% over the ladder).
 *
 * ## The ladder is a diagnostic path, not a finding
 *
 * Seven apertures are built at 20× — 0.10, 0.12, 0.15, 0.18, 0.20, 0.22, 0.25
 * — of which five are new to this branch and one is the 20×/0.25 that § 6bk.8's
 * over-general ceiling sentence had three steps calling unbuildable until
 * § 6bn.1 probed it. The ladder earns its place by bracketing the sweep's
 * refusal boundary for the first time (0.15 passes at 0.5985 depths, 0.18
 * refuses at 1.0739, against a threshold of 1) and by showing the turnover in
 * § 6bo.7. Everything else it says is a mixed-path quantity: along it the
 * aperture opens AND the field shrinks together, so its shape is not
 * attributable to either lever, and this file does not attribute it.
 *
 * **What this file deliberately does not run.** No focus surface and no flat
 * field. § 6bm.7's precedent is that a forced surface characterises a refusal
 * and yields no number, and five of the seven lenses refuse. The rendered
 * flat-field readouts § 6bk.5 and § 6bn.6 carry have NOT been re-measured at a
 * matched field, and until they are, their aperture dependence is in exactly
 * the state the registration cost's was before this step. That is the largest
 * single item this step leaves open, and it is named as such.
 */

const DESIGN = 587.5618;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** The seven apertures at 20×. Five are new to this branch; 0.25 is § 6bn.1's. */
const LADDER = [0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25] as const;

const SIZE = 128;
const PS = 32;
const ANCHOR = 4;
const AXIS = { x: 0, y: 0 };
const EDGE = { x: ANCHOR, y: 0 };
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/**
 * § 6bk's, § 6bl's, § 6bm's and § 6bn's sweep, with the threshold opened to no
 * threshold at all (§ 6bk.8's device) so a refusing lens still yields an axial
 * stage — and with `size`/`pupilSamples` exposed, which is the whole point here.
 */
const sweep = (size: number, ps: number, maxPlateauDepths = 1e9): FocusSweepOptions => ({
  size,
  pupilSamples: ps,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths,
  radialMapSeed: "magnification",
});

/** The sweep's own sampling, unchanged from § 6bk through § 6bn. */
const SWEEP_PS = 48;

const extentOf = (system: OpticalSystem, size = SIZE, ps = PS): number =>
  objectFieldTile(system, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS })
    .halfExtentMm;

const magOf = (system: OpticalSystem): number =>
  objectFieldTile(system, { size: SIZE, pupilSamples: PS, wavelengthNm: DESIGN, centreMm: AXIS })
    .magnification;

const stage = (mm: number): TileStageMm => () => mm;

/** § 6bn.1's device: the render-free grid is taken at a stage of ZERO, because
 *  `mosaicSeamShiftMm` does no render and the focus stage cannot enter it. */
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
  /** § 6bj's registration cost: a stage-scanned seam shift over a field-scanned one. */
  readonly ratio: number;
  readonly aniso: number;
  /** The two terms separately — a ratio can reverse on one of them alone. */
  readonly fieldMm: number;
  readonly scanMm: number;
}

/** § 6bj's registration cost and its anisotropy — geometry only, no render. */
function cost(system: OpticalSystem, size = SIZE, ps = PS): Cost {
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps));
  const scan = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { scan: "stage" }));
  return {
    ratio: scan.mm / field.mm,
    aniso: scan.betweenRowsMm / scan.betweenColumnsMm,
    fieldMm: field.mm,
    scanMm: scan.mm,
  };
}

/** § 6bk.4's escape readout — § 6bd.8's double-extent method, with the frame's
 *  sampling exposed so it can be taken at a matched field. */
function escaped(
  system: OpticalSystem,
  objectHeightMm: number,
  focusMm: number,
  ps = PS,
  sizeOverride?: number,
): number {
  // `ps` sets the FIELD and `size` the pixels — § 6bo.6 separates the two.
  const size = sizeOverride ?? (ps / PS) * SIZE;
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

// ---------------------------------------------------------------------------
// Fixtures. The ladder at the branch's own sampling, then the matched pairs.
// ---------------------------------------------------------------------------

/**
 * Builds on FIRST READ and remembers the answer.
 *
 * Every fixture below is a sweep, a render or a render-free grid, and as plain
 * `const`s the whole set was computed when the module was evaluated — which a
 * run that then executes ONE rung paid in full. `once` evaluates its argument
 * at most once, and every fixture below is a pure function of the lens and the
 * options, so each rung reads exactly what it read before.
 *
 * Measured on this file alone, eager then lazy: **collect 41.1 s → 0.5 s**, the
 * file's total 44.9 s → 45.6 s, which is inside this machine's run-to-run
 * spread. Collect is the figure that repeats and the one that matters — it is
 * what a `-t` rerun pays before the rung it asked for starts, and this file was
 * 92% collect. Same change, same reasoning and the same `()`-at-every-read cost
 * as `fourth-corner`, whose header carries the five-file total; `tsc` names any
 * site missed.
 */
const once = <T>(make: () => T): (() => T) => {
  let held: { readonly v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};

const LENS = new Map<number, OpticalSystem>(LADDER.map((na) => [na, build(20, na)]));
const at = (na: number): OpticalSystem => LENS.get(na)!;

/** The render-free ladder at the branch's own sampling, and at twice the pixels. */
const LADDER_COST = once(() => LADDER.map((na) => cost(at(na))));
const LADDER_COST_256 = once(() => LADDER.map((na) => cost(at(na), 256, PS)));

/**
 * The matched-field pairs. `halfExtent ∝ pupilSamples / NA`, so doubling the
 * aperture and the sampling together holds the field — to 1.55%, the residual
 * being that the TRACED aperture drifts from the design NA (§ 6bo.1 pins the
 * drift at 2.76% across the whole ladder).
 */
const PAIR_MID = once(() => [cost(at(0.1), 128, 32), cost(at(0.2), 256, 64)] as const);
const PAIR_SMALL = once(() => [cost(at(0.1), 64, 16), cost(at(0.2), 128, 32)] as const);
const PAIR_BIG = once(() => [cost(at(0.1), 256, 64), cost(at(0.2), 512, 128)] as const);

/** The branch's own path: sampling held, so the field halves as the NA doubles. */
const CONVENTION = once(() => [cost(at(0.1), 128, 32), cost(at(0.2), 128, 32)] as const);

/**
 * The MAGNIFICATION lever, the same way. `halfExtent ∝ M / NA` with NA held
 * means the sampling cancels the magnification exactly, so these two fields
 * agree to thirteen digits rather than to 1.55%.
 */
const TEN = build(10, 0.1);
const FOUR = build(4, 0.1);
/** Matched at 0.9353865752 mm — 10× needs four times the sampling area of 20×. */
const MPAIR_BIG = once(() => [cost(TEN, 256, 64), cost(at(0.1), 128, 32)] as const);
/** Matched at 0.4676932876 mm, the 10× frame's own field at the branch's sampling. */
const MPAIR_SMALL = once(() => [cost(TEN, 128, 32), cost(at(0.1), 128, 16)] as const);
/** § 6bl.4's own path: sampling held, so the field grows in proportion to M. */
const MCONVENTION = once(() => [cost(FOUR, 128, 32), cost(TEN, 128, 32), cost(at(0.1), 128, 32)] as const);

/**
 * § 6bn's interaction quotient, re-measured at a MATCHED field.
 *
 * The four cells (10×, 20×) × (0.10, 0.20) can all be put at one field because
 * `halfExtent ∝ M / NA` needs only `pupilSamples ∝ M / NA` to cancel: with the
 * 10×/0.10 cell at 32, the others want 64, 16 and 32. Within each aperture the
 * two fields then agree to twelve digits; across apertures the 1.55% traced
 * residual remains.
 */
const TEN_FAST = build(10, 0.2);
const CELLS_BRANCH = once(
  () =>
    ({
      slowLo: cost(TEN, 128, 32),
      fastLo: cost(TEN_FAST, 128, 32),
      slowHi: cost(at(0.1), 128, 32),
      fastHi: cost(at(0.2), 128, 32),
    }) as const,
);
const CELLS_MATCHED = once(
  () =>
    ({
      slowLo: cost(TEN, 128, 32),
      fastLo: cost(TEN_FAST, 256, 64),
      slowHi: cost(at(0.1), 128, 16),
      fastHi: cost(at(0.2), 128, 32),
    }) as const,
);

/** § 6bm's and § 6bn's quotient, and its distance from 1 in either direction. */
const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
const departure = (x: number): number => (x < 1 ? 1 / x : x);

/** The plateau's four cells, the same two ways. Sweep sampling is 48, not 32. */
const D_LO_SLOW = once(() => renderedBestFocus(TEN, 430, 0, sweep(128, 48)).plateauDepths);
const D_LO_FAST = once(() => renderedBestFocus(TEN_FAST, 430, 0, sweep(128, 48)).plateauDepths);
const D_LO_FAST_M = once(() => renderedBestFocus(TEN_FAST, 430, 0, sweep(256, 96)).plateauDepths);
const D_HI_SLOW_M = once(() => renderedBestFocus(at(0.1), 430, 0, sweep(64, 24)).plateauDepths);

/** The plateau ladder at the sweep's own sampling, then at matched fields. */
const DEPTHS = once(() =>
  LADDER.map(
    (na) => renderedBestFocus(at(na), 430, 0, sweep(SIZE, SWEEP_PS)).plateauDepths,
  )
);
const P10_BIGFIELD = once(() => renderedBestFocus(at(0.1), 430, 0, sweep(SIZE, SWEEP_PS)));
const P20_BIGFIELD = once(() => renderedBestFocus(at(0.2), 430, 0, sweep(256, 96)));
const P10_SMALLFIELD = once(() => renderedBestFocus(at(0.1), 430, 0, sweep(64, 24)));
/** Field alone, aperture held: 1.5× the field at NA 0.15 and nothing else moved. */
const P15_WIDER = once(() => renderedBestFocus(at(0.15), 430, 0, sweep(256, 72)));

/** § 6bn's two axial stages, re-derived here so the escape has a common stage. */
const STAGE_A = once(() => P10_BIGFIELD().focusMm);
const STAGE_B = once(() => renderedBestFocus(at(0.2), 430, 0, sweep(SIZE, SWEEP_PS)).focusMm);

const H10 = objectHeightForImageRadius(at(0.1), ANCHOR, DESIGN, { magnification: magOf(at(0.1)) });
const H20 = objectHeightForImageRadius(at(0.2), ANCHOR, DESIGN, { magnification: magOf(at(0.2)) });

const E10_A = once(() => escaped(at(0.1), H10, STAGE_A()));
const E10_B = once(() => escaped(at(0.1), H10, STAGE_B()));
const E20_A = once(() => escaped(at(0.2), H20, STAGE_A()));
const E20_B = once(() => escaped(at(0.2), H20, STAGE_B()));
/** The same lens at a MATCHED field: twice the sampling, so the field is held. */
const E20M_A = once(() => escaped(at(0.2), H20, STAGE_A(), 64));
const E20M_B = once(() => escaped(at(0.2), H20, STAGE_B(), 64));
/** The branch's FIELD at the matched pair's pixel count, isolating the latter. */
const E20_A_FINE = once(() => escaped(at(0.2), H20, STAGE_A(), 32, 256));
const E10_A_FINE = once(() => escaped(at(0.1), H10, STAGE_A(), 32, 256));

describe("§ 6bo.1 — the frame's half-extent goes as M / NA, and no step has said so", () => {
  it("the tile's field of view shrinks 2.569× across a 2.5× aperture range", () => {
    const extents = LADDER.map((na) => extentOf(at(na)));

    expect(extents[0]).toBeCloseTo(0.9353865752380071, 12);
    expect(extents[1]).toBeCloseTo(0.7777546863840972, 12);
    expect(extents[2]).toBeCloseTo(0.619641732090495, 12);
    expect(extents[3]).toBeCloseTo(0.5137465991842989, 12);
    expect(extents[4]).toBeCloseTo(0.4605525127523965, 12);
    expect(extents[5]).toBeCloseTo(0.41684833498921176, 12);
    expect(extents[6]).toBeCloseTo(0.3640987306028178, 12);

    // Strictly falling: the aperture lever is a field lever throughout.
    for (let i = 1; i < extents.length; i++) expect(extents[i]!).toBeLessThan(extents[i - 1]!);

    expect(extents[0]! / extents[6]!).toBeCloseTo(2.5690465157330817, 10);
  });

  it("it is 1/NA to 2.76%, the residual being the traced aperture, not the design one", () => {
    // halfExtent · NA would be exactly constant if the traced aperture were the
    // design NA. It is not: the product drifts DOWN across the ladder.
    const products = LADDER.map((na) => extentOf(at(na)) * na);
    expect(products[0]).toBeCloseTo(0.09353865752380071, 12);
    expect(products[6]).toBeCloseTo(0.09102468265070444, 12);
    expect(products[0]! / products[6]!).toBeCloseTo(1.0276186062932329, 10);

    // Monotone, so it is a drift and not noise.
    for (let i = 1; i < products.length; i++) expect(products[i]!).toBeLessThan(products[i - 1]!);
  });

  it("so every aperture doubling on this branch halved the tile's field", () => {
    expect(extentOf(build(4, 0.1)) / extentOf(build(4, 0.2))).toBeGreaterThan(2);
    expect(extentOf(build(10, 0.1)) / extentOf(build(10, 0.2))).toBeGreaterThan(2);
    expect(extentOf(at(0.1)) / extentOf(at(0.2))).toBeGreaterThan(2);
  });

  it("and every magnification step GREW it, in exact proportion", () => {
    // The other half of `halfExtent ∝ M / NA`, and the reason § 6bl.4's 1/M law
    // is measuring something other than magnification.
    expect(extentOf(FOUR)).toBeCloseTo(0.18707731504759492, 12);
    expect(extentOf(TEN)).toBeCloseTo(0.46769328761898915, 12);
    expect(extentOf(at(0.1))).toBeCloseTo(0.9353865752380071, 12);

    expect(extentOf(TEN) / extentOf(FOUR)).toBeCloseTo(2.5, 12);
    expect(extentOf(at(0.1)) / extentOf(TEN)).toBeCloseTo(2, 12);
  });
});

describe("§ 6bo.2 — each lever's field factor is pure, and that is NOT enough", () => {
  it("the field shrink per aperture doubling is magnification-free to 13 digits", () => {
    const r4 = extentOf(build(4, 0.1)) / extentOf(build(4, 0.2));
    const r10 = extentOf(build(10, 0.1)) / extentOf(build(10, 0.2));
    const r20 = extentOf(at(0.1)) / extentOf(at(0.2));

    expect(r4).toBeCloseTo(2.031009601158958, 12);
    expect(r10).toBeCloseTo(2.031009601158958, 12);
    expect(r20).toBeCloseTo(2.031009601158958, 12);

    const spread = Math.max(r4, r10, r20) / Math.min(r4, r10, r20);
    expect(spread).toBeLessThan(1 + 1e-12);
  });

  it("and the field growth per magnification step is aperture-free, likewise", () => {
    const slow = extentOf(at(0.1)) / extentOf(build(10, 0.1));
    const fast = extentOf(at(0.2)) / extentOf(build(10, 0.2));
    expect(slow).toBeCloseTo(2, 12);
    expect(fast).toBeCloseTo(2, 12);
    expect(Math.abs(slow / fast - 1)).toBeLessThan(1e-12);
  });

  it("so a quotient's confound is a COMMON factor — which would cancel if the readout separated", () => {
    // The tempting inference, stated so that the next rung can refute it: the
    // field ratio is identical in the numerator and the denominator of § 6bm's
    // and § 6bn's interaction quotient, so it looks like it must cancel.
    // It cancels only if the readout is multiplicatively separable in
    // (field, lever), and this one is not: three fields at ONE aperture span a
    // factor of eight, nowhere near a power law.
    expect(CELLS_MATCHED().slowHi.ratio).toBeCloseTo(66.49910292400627, 8);
    expect(PAIR_MID()[0].ratio).toBeCloseTo(21.04598275534914, 8);
    expect(PAIR_BIG()[0].ratio).toBeCloseTo(8.201702356019862, 8);
    expect(CELLS_MATCHED().slowHi.ratio / PAIR_BIG()[0].ratio).toBeGreaterThan(8);
  });

  it("and it does NOT cancel: § 6bn's cost interaction CROSSES 1 at a matched field", () => {
    // The branch's own four cells first, reproducing § 6bn's pinned costI to
    // seven digits — which is what makes the matched-field number comparable.
    const branch = interact(
      CELLS_BRANCH().slowLo.ratio,
      CELLS_BRANCH().fastLo.ratio,
      CELLS_BRANCH().slowHi.ratio,
      CELLS_BRANCH().fastHi.ratio,
    );
    expect(branch).toBeCloseTo(1.0416580962373136, 9);
    expect(branch).toBeCloseTo(1.0416581, 7); // § 6bn's costI

    const matched = interact(
      CELLS_MATCHED().slowLo.ratio,
      CELLS_MATCHED().fastLo.ratio,
      CELLS_MATCHED().slowHi.ratio,
      CELLS_MATCHED().fastHi.ratio,
    );
    expect(matched).toBeCloseTo(0.7948724057562382, 9);

    // Above 1 the branch's way, below it at a matched field.
    expect(branch).toBeGreaterThan(1);
    expect(matched).toBeLessThan(1);
    expect(departure(matched)).toBeCloseTo(1.2580635492668844, 9);
  });

  it("and § 6bn's anisotropy interaction grows its distance from 1 by 11.7×", () => {
    const branch = interact(
      CELLS_BRANCH().slowLo.aniso,
      CELLS_BRANCH().fastLo.aniso,
      CELLS_BRANCH().slowHi.aniso,
      CELLS_BRANCH().fastHi.aniso,
    );
    const matched = interact(
      CELLS_MATCHED().slowLo.aniso,
      CELLS_MATCHED().fastLo.aniso,
      CELLS_MATCHED().slowHi.aniso,
      CELLS_MATCHED().fastHi.aniso,
    );
    expect(branch).toBeCloseTo(0.9772598554401308, 9);
    expect(departure(branch)).toBeCloseTo(1.0232693, 6); // § 6bn's anisoI
    expect(matched).toBeCloseTo(0.7862300730210287, 9);

    // No crossing here, but the interaction is not the same quantity either.
    expect((departure(matched) - 1) / (departure(branch) - 1)).toBeCloseTo(11.684598548101404, 7);
    expect((departure(matched) - 1) / (departure(branch) - 1)).toBeGreaterThan(11.6);
  });

  it("while the PLATEAU's interaction survives, to 0.89% — and § 6bo.5 says why", () => {
    const branch = interact(D_LO_SLOW(), D_LO_FAST(), DEPTHS()[0]!, DEPTHS()[4]!);
    const matched = interact(D_LO_SLOW(), D_LO_FAST_M(), D_HI_SLOW_M(), DEPTHS()[4]!);

    expect(branch).toBeCloseTo(0.8614283392781017, 9);
    expect(branch).toBeCloseTo(0.8614284, 6); // § 6bn's plateauI
    expect(matched).toBeCloseTo(0.8691011729509641, 9);
    expect(matched / branch).toBeCloseTo(1.0089071061665935, 8);

    // The separation is not arbitrary: the plateau is the readout § 6bo.5
    // measures to be field-independent to under 3%, and it is the one whose
    // interaction survives. Purity of the field FACTOR is necessary; what
    // decides the outcome is whether the READOUT is field-sensitive.
    expect(Math.abs(matched / branch - 1)).toBeLessThan(0.01);
    expect(matched).toBeLessThan(1);
    expect(branch).toBeLessThan(1);
  });
});

describe("§ 6bo.3 — at a matched field the registration cost's aperture dependence REVERSES", () => {
  it("the field is held to within 1.55% by doubling the sampling with the aperture", () => {
    const mismatch = extentOf(at(0.1), 128, 32) / extentOf(at(0.2), 256, 64);
    expect(mismatch).toBeCloseTo(1.0155048005794858, 10);
    // The residual is § 6bo.1's traced-aperture drift and nothing else: the same
    // mismatch appears at all three field sizes, to the last digits.
    expect(extentOf(at(0.1), 64, 16) / extentOf(at(0.2), 128, 32)).toBeCloseTo(mismatch, 12);
    expect(extentOf(at(0.1), 256, 64) / extentOf(at(0.2), 512, 128)).toBeCloseTo(mismatch, 12);
  });

  it("the branch's own path has the cost RISE 1.5997× as the aperture doubles", () => {
    expect(CONVENTION()[0].ratio).toBeCloseTo(21.04598275534914, 8);
    expect(CONVENTION()[1].ratio).toBeCloseTo(33.66819236863687, 8);
    expect(CONVENTION()[1].ratio / CONVENTION()[0].ratio).toBeCloseTo(1.5997443673700444, 10);
  });

  it("at a matched field it FALLS, at every one of three field sizes", () => {
    expect(PAIR_MID()[0].ratio).toBeCloseTo(21.04598275534914, 8);
    expect(PAIR_MID()[1].ratio).toBeCloseTo(13.680138591706793, 8);
    expect(PAIR_MID()[1].ratio / PAIR_MID()[0].ratio).toBeCloseTo(0.6500118692832145, 10);

    expect(PAIR_SMALL()[0].ratio).toBeCloseTo(68.7598964701302, 8);
    expect(PAIR_SMALL()[1].ratio).toBeCloseTo(33.66819236863687, 8);
    expect(PAIR_SMALL()[1].ratio / PAIR_SMALL()[0].ratio).toBeCloseTo(0.48964867745638013, 10);

    expect(PAIR_BIG()[0].ratio).toBeCloseTo(8.201702356019862, 8);
    expect(PAIR_BIG()[1].ratio).toBeCloseTo(5.85271602665838, 8);
    expect(PAIR_BIG()[1].ratio / PAIR_BIG()[0].ratio).toBeCloseTo(0.7135977108901813, 10);

    // The sign of the aperture dependence, which is the finding.
    expect(CONVENTION()[1].ratio / CONVENTION()[0].ratio).toBeGreaterThan(1);
    for (const [slow, fast] of [PAIR_MID(), PAIR_SMALL(), PAIR_BIG()]) {
      expect(fast.ratio / slow.ratio).toBeLessThan(1);
    }
  });

  it("the anisotropy reverses with it", () => {
    expect(CONVENTION()[1].aniso / CONVENTION()[0].aniso).toBeCloseTo(1.9285987179870367, 10);
    expect(PAIR_MID()[1].aniso / PAIR_MID()[0].aniso).toBeCloseTo(0.8730019926409518, 10);
    expect(PAIR_SMALL()[1].aniso / PAIR_SMALL()[0].aniso).toBeCloseTo(0.6609140341298092, 10);
    expect(PAIR_BIG()[1].aniso / PAIR_BIG()[0].aniso).toBeCloseTo(0.9513059295508095, 10);

    expect(CONVENTION()[1].aniso / CONVENTION()[0].aniso).toBeGreaterThan(1);
    for (const [slow, fast] of [PAIR_MID(), PAIR_SMALL(), PAIR_BIG()]) {
      expect(fast.aniso / slow.aniso).toBeLessThan(1);
    }
  });

  it("and the reversal is carried by the DENOMINATOR, not by the ratio being a ratio", () => {
    // A ratio can reverse on one term alone, so both are decomposed. On the
    // branch's path both terms fall and the denominator falls faster; at a
    // matched field the denominator RISES instead.
    expect(CONVENTION()[0].fieldMm / CONVENTION()[1].fieldMm).toBeCloseTo(4.5610871847799785, 8);
    expect(CONVENTION()[0].scanMm / CONVENTION()[1].scanMm).toBeCloseTo(2.85113501745178, 8);

    expect(PAIR_MID()[1].fieldMm / PAIR_MID()[0].fieldMm).toBeCloseTo(1.3649834994688737, 10);
    expect(PAIR_SMALL()[1].fieldMm / PAIR_SMALL()[0].fieldMm).toBeCloseTo(2.4136942676554254, 10);
    expect(PAIR_BIG()[1].fieldMm / PAIR_BIG()[0].fieldMm).toBeCloseTo(1.126990181627213, 10);

    // The field-scanned seam shift reverses direction between the two paths at
    // all three field sizes; the stage-scanned one does not have a consistent
    // direction at a matched field, so it is not what carries the finding.
    expect(CONVENTION()[1].fieldMm).toBeLessThan(CONVENTION()[0].fieldMm);
    for (const [slow, fast] of [PAIR_MID(), PAIR_SMALL(), PAIR_BIG()]) {
      expect(fast.fieldMm).toBeGreaterThan(slow.fieldMm);
    }
    expect(PAIR_MID()[1].scanMm).toBeLessThan(PAIR_MID()[0].scanMm);
    expect(PAIR_SMALL()[1].scanMm).toBeGreaterThan(PAIR_SMALL()[0].scanMm);
  });
});

describe("§ 6bo.4 — the cost's MAGNIFICATION dependence reverses too, so § 6bl.4's budget has the wrong sign", () => {
  it("the magnification pairs hold the field to thirteen digits, not to 1.55%", () => {
    // NA is held, so `halfExtent ∝ M / NA` lets the sampling cancel M exactly.
    // This is the cleaner of the two experiments in this file.
    expect(extentOf(TEN, 256, 64) / extentOf(at(0.1), 128, 32)).toBeCloseTo(1, 12);
    expect(extentOf(TEN, 128, 32) / extentOf(at(0.1), 128, 16)).toBeCloseTo(1, 12);
  });

  it("§ 6bl.4's own path reproduces its 1/M law, and § 6bj's control number with it", () => {
    // § 6bm's COST_4 = 95.712993 and § 6bl's COST_10 = 41.775694, reproduced at
    // a stage of zero — which is what licenses reading them against the matched
    // pairs below, per § 6bn.1.
    expect(MCONVENTION()[0].ratio).toBeCloseTo(95.71299253925305, 8);
    expect(MCONVENTION()[1].ratio).toBeCloseTo(41.77569353925508, 8);
    expect(MCONVENTION()[2].ratio).toBeCloseTo(21.04598275534914, 8);

    // Falling, and close enough to 1/M that § 6bl.4 fitted one.
    expect(MCONVENTION()[0].ratio / MCONVENTION()[1].ratio).toBeCloseTo(2.2911167818031575, 9);
    expect(MCONVENTION()[1].ratio / MCONVENTION()[2].ratio).toBeCloseTo(1.9849723353326034, 9);
  });

  it("at a matched field the cost RISES with magnification instead", () => {
    expect(MPAIR_BIG()[0].ratio).toBeCloseTo(16.967575811476543, 8);
    expect(MPAIR_BIG()[1].ratio).toBeCloseTo(21.04598275534914, 8);
    expect(MPAIR_BIG()[1].ratio / MPAIR_BIG()[0].ratio).toBeCloseTo(1.2403647397357753, 9);

    expect(MPAIR_SMALL()[0].ratio).toBeCloseTo(41.77569353925508, 8);
    expect(MPAIR_SMALL()[1].ratio).toBeCloseTo(66.49910292400627, 8);
    expect(MPAIR_SMALL()[1].ratio / MPAIR_SMALL()[0].ratio).toBeCloseTo(1.5918132600604107, 9);

    // The finding: the sign of the magnification dependence, at two fields.
    expect(MCONVENTION()[2].ratio / MCONVENTION()[1].ratio).toBeLessThan(1);
    expect(MPAIR_BIG()[1].ratio / MPAIR_BIG()[0].ratio).toBeGreaterThan(1);
    expect(MPAIR_SMALL()[1].ratio / MPAIR_SMALL()[0].ratio).toBeGreaterThan(1);
  });

  it("because the field alone more than accounts for the whole 1/M fall", () => {
    // Doubling the field at a HELD magnification cuts the cost by 2.5-3.2×,
    // which is more than the 1.985× the branch's path shows across 10×→20×.
    // Magnification itself pushes the other way and partly cancels it.
    expect(MPAIR_SMALL()[1].ratio / MPAIR_BIG()[1].ratio).toBeCloseTo(3.159705284235518, 9);
    expect(MPAIR_SMALL()[0].ratio / MPAIR_BIG()[0].ratio).toBeCloseTo(2.4620896940975388, 9);

    for (const fieldOnly of [
      MPAIR_SMALL()[1].ratio / MPAIR_BIG()[1].ratio,
      MPAIR_SMALL()[0].ratio / MPAIR_BIG()[0].ratio,
    ]) {
      expect(fieldOnly).toBeGreaterThan(MCONVENTION()[1].ratio / MCONVENTION()[2].ratio);
    }
  });

  it("and the anisotropy reverses on this lever too", () => {
    expect(MCONVENTION()[2].aniso / MCONVENTION()[1].aniso).toBeCloseTo(0.5261098614857492, 9);
    expect(MPAIR_BIG()[1].aniso / MPAIR_BIG()[0].aniso).toBeCloseTo(1.1613079070260086, 9);
    expect(MPAIR_SMALL()[1].aniso / MPAIR_SMALL()[0].aniso).toBeCloseTo(1.4875212847709802, 9);

    expect(MCONVENTION()[2].aniso / MCONVENTION()[1].aniso).toBeLessThan(1);
    expect(MPAIR_BIG()[1].aniso / MPAIR_BIG()[0].aniso).toBeGreaterThan(1);
    expect(MPAIR_SMALL()[1].aniso / MPAIR_SMALL()[0].aniso).toBeGreaterThan(1);
  });
});

describe("§ 6bo.5 — the plateau is field-free, so the refusal boundary is real optics", () => {
  it("the seven-point ladder is monotone in aperture and brackets the threshold", () => {
    expect(DEPTHS()[0]).toBeCloseTo(0.37549919008843585, 9);
    expect(DEPTHS()[1]).toBeCloseTo(0.428382059451484, 9);
    expect(DEPTHS()[2]).toBeCloseTo(0.598546429418493, 9);
    expect(DEPTHS()[3]).toBeCloseTo(1.0738808825086936, 9);
    expect(DEPTHS()[4]).toBeCloseTo(1.2301646622060687, 9);
    expect(DEPTHS()[5]).toBeCloseTo(1.4396321362837097, 9);
    expect(DEPTHS()[6]).toBeCloseTo(1.5922927982930855, 9);

    for (let i = 1; i < DEPTHS().length; i++) expect(DEPTHS()[i]!).toBeGreaterThan(DEPTHS()[i - 1]!);

    // The threshold is 1 depth of focus. § 6bn knew only "all NA 0.10 pass, all
    // NA 0.20 refuse" — a whole factor of two. The crossing is between 0.15 and
    // 0.18, and this is the first bracket on it.
    expect(DEPTHS()[2]).toBeLessThan(1);
    expect(DEPTHS()[3]).toBeGreaterThan(1);
  });

  it("and the narrow threshold really is what reports it", () => {
    expect(() => renderedBestFocus(at(0.15), 430, 0, sweep(SIZE, SWEEP_PS, 1))).not.toThrow();

    let refusal = "";
    try {
      renderedBestFocus(at(0.18), 430, 0, sweep(SIZE, SWEEP_PS, 1));
    } catch (e) {
      refusal = (e as Error).message;
    }
    expect(refusal).toMatch(/plateau/);
    expect(refusal).toMatch(/1\.0738/);
    expect(refusal).toMatch(/depths of focus/);
  });

  it("doubling the FIELD alone moves the plateau by under 3%", () => {
    // Aperture held, field changed — the control the cost never had.
    expect(P15_WIDER().plateauDepths / DEPTHS()[2]!).toBeCloseTo(1.0032087294584346, 9);
    expect(DEPTHS()[0]! / P10_SMALLFIELD().plateauDepths).toBeCloseTo(0.9890281687802007, 9);
    expect(DEPTHS()[4]! / P20_BIGFIELD().plateauDepths).toBeCloseTo(1.0264180489929309, 9);

    for (const r of [
      P15_WIDER().plateauDepths / DEPTHS()[2]!,
      DEPTHS()[0]! / P10_SMALLFIELD().plateauDepths,
      DEPTHS()[4]! / P20_BIGFIELD().plateauDepths,
    ]) {
      expect(Math.abs(r - 1)).toBeLessThan(0.03);
    }
  });

  it("so the aperture's 3.2× rise survives however the field is handled", () => {
    const convention = DEPTHS()[4]! / DEPTHS()[0]!;
    const matchedBig = P20_BIGFIELD().plateauDepths / P10_BIGFIELD().plateauDepths;
    const matchedSmall = DEPTHS()[4]! / P10_SMALLFIELD().plateauDepths;

    expect(convention).toBeCloseTo(3.2760780706779844, 9);
    expect(matchedBig).toBeCloseTo(3.191758050135912, 9);
    expect(matchedSmall).toBeCloseTo(3.24013349502362, 9);

    // The three span 2.64%, and the two matched-field ones span 1.52% — against
    // a readout whose SIGN flipped in § 6bo.3 under the same treatment.
    const all = [convention, matchedBig, matchedSmall];
    expect(Math.max(...all) / Math.min(...all)).toBeCloseTo(1.026418048992931, 9);
    expect(matchedSmall / matchedBig).toBeCloseTo(1.0151563633984249, 9);
    expect(Math.max(...all) / Math.min(...all)).toBeLessThan(1.03);
    for (const r of all) expect(r).toBeGreaterThan(3);
  });
});

describe("§ 6bo.6 — the escape keeps its sign and loses a quarter of its size", () => {
  it("the branch's path overstates the aperture's effect by 1.28×", () => {
    expect(E20_A() / E10_A()).toBeCloseTo(17.728595484364245, 8);
    expect(E20M_A() / E10_A()).toBeCloseTo(13.825737559547433, 8);
    expect(E20_A() / E20M_A()).toBeCloseTo(1.2822893106430822, 9);

    expect(E20_B() / E10_B()).toBeCloseTo(16.472179594752625, 8);
    expect(E20M_B() / E10_B()).toBeCloseTo(12.875925007744309, 8);
    expect(E20_B() / E20M_B()).toBeCloseTo(1.2793006781916891, 9);
  });

  it("and that 1.28× carries a pixel-count term, which is 0.6% and not 28%", () => {
    // `escaped` derives its frame size from `pupilSamples`, so the matched-field
    // render has four times the pixels as well as the held field. Isolated —
    // same field, four times the pixels — the term is under 0.8%, so it is named
    // rather than left implied, and the inflation is 1.2902× once it is removed.
    expect(E20_A_FINE() / E20_A()).toBeCloseTo(1.00614051868777, 9);
    expect(E10_A_FINE() / E10_A()).toBeCloseTo(1.0077336276723095, 9);
    expect(E20_A_FINE() / E20M_A()).toBeCloseTo(1.2901632321182137, 9);
    for (const t of [E20_A_FINE() / E20_A(), E10_A_FINE() / E10_A()]) expect(Math.abs(t - 1)).toBeLessThan(0.008);
  });

  it("but the sign holds — unlike the two render-free readouts", () => {
    for (const r of [E20_A() / E10_A(), E20M_A() / E10_A(), E20_B() / E10_B(), E20M_B() / E10_B()]) {
      expect(r).toBeGreaterThan(10);
    }
    // Which is the whole point of measuring three families rather than one:
    // the same confound retracts a sign here and only a size there.
    expect(PAIR_MID()[1].ratio / PAIR_MID()[0].ratio).toBeLessThan(1);
  });

  it("and the readout's own stage sensitivity is smaller than either, but not nil", () => {
    // § 6bk.4, § 6bm and § 6bn all quote the escape with each lens at its OWN
    // axial stage. Two stages a sweep step apart move one lens by 0.41% and the
    // other by 6.7% — small against 13.8×, and the first bound anyone has put
    // on that convention.
    expect(Math.abs(E10_B() / E10_A() - 1)).toBeLessThan(0.01);
    expect(Math.abs(E20_B() / E20_A() - 1)).toBeLessThan(0.08);
    expect(E10_A()).toBeCloseTo(0.021959074296852288, 9);
    expect(E20_A()).toBeCloseTo(0.38930354541999446, 9);
  });
});

describe("§ 6bo.7 — two opposing dependences must produce a turn, and they do", () => {
  it("the cost turns over at NA 0.22 along the branch's own path", () => {
    const ratios = LADDER_COST().map((c) => c.ratio);
    expect(ratios[0]).toBeCloseTo(21.04598275534914, 8);
    expect(ratios[5]).toBeCloseTo(34.19944386048143, 8);
    expect(ratios[6]).toBeCloseTo(33.23082266581804, 8);

    // Rising to 0.22, then falling.
    for (let i = 1; i <= 5; i++) expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!);
    expect(ratios[6]!).toBeLessThan(ratios[5]!);
  });

  it("the turn is not the sampling — it survives twice the pixels at the same field", () => {
    const ratios = LADDER_COST_256().map((c) => c.ratio);
    expect(ratios[0]).toBeCloseTo(20.811488144623066, 8);
    expect(ratios[5]).toBeCloseTo(33.829763897794614, 8);
    expect(ratios[6]).toBeCloseTo(32.87275841530211, 8);

    for (let i = 1; i <= 5; i++) expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!);
    expect(ratios[6]!).toBeLessThan(ratios[5]!);

    // The fall at the turn is the same fraction at both pixel samplings, which
    // is what "the same field, sampled finer" ought to give.
    expect(LADDER_COST()[5]!.ratio / LADDER_COST()[6]!.ratio).toBeCloseTo(1.0291482761171524, 8);
    expect(ratios[5]! / ratios[6]!).toBeCloseTo(1.029112417960247, 8);
  });

  it("and the anisotropy does NOT turn, though the branch has carried them as a pair", () => {
    const aniso = LADDER_COST().map((c) => c.aniso);
    expect(aniso[0]).toBeCloseTo(8.874831016801972, 8);
    expect(aniso[6]).toBeCloseTo(21.40386197517023, 8);
    for (let i = 1; i < aniso.length; i++) expect(aniso[i]!).toBeGreaterThan(aniso[i - 1]!);

    const aniso256 = LADDER_COST_256().map((c) => c.aniso);
    for (let i = 1; i < aniso256.length; i++) expect(aniso256[i]!).toBeGreaterThan(aniso256[i - 1]!);
  });

  it("which § 6bo.3 explains: the two dependences pull opposite ways", () => {
    // Along this path the aperture opens AND the field shrinks. § 6bo.3 measured
    // that the cost FALLS with aperture at a held field and § 6bo.2 that it rises
    // steeply as the field shrinks. A sum of one rising and one falling term has
    // to turn over somewhere, and 0.22 is where. This is the closest thing to a
    // mechanism this branch has produced, and it is why the turn is not quoted
    // as a property of the aperture.
    expect(PAIR_MID()[1].ratio / PAIR_MID()[0].ratio).toBeLessThan(1);
    expect(PAIR_SMALL()[0].ratio).toBeGreaterThan(PAIR_MID()[0].ratio);
    expect(PAIR_MID()[0].ratio).toBeGreaterThan(PAIR_BIG()[0].ratio);
  });
});
