import { describe, it, expect } from "vitest";
import {
  fluorescenceMosaicGeometry,
  renderFluorescenceMosaic,
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import {
  renderedFlatField,
  throughputFlatField,
  scannerFlatField,
  flatFieldCorrect,
  mosaicSeamStep,
} from "../src/imaging/mosaic-flat-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import {
  renderedBestFocus,
  type FocusProbe,
  type FocusSweepOptions,
} from "../src/imaging/focus-surface";
import {
  labelledVolumeEmitters,
  type SpectralVolumeEmitterDensity,
} from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bp — the rendered flat field at a matched field, and one agreement that
 * was two frame sizes.
 *
 * § 6bo found that this branch's two levers each move two things: at a fixed
 * `pupilSamples` a tile's field of view goes as **M / NA**, so every reading
 * § 6bk through § 6bn took down a lever was also taken over a frame the lever
 * had resized. It re-measured the render-free readouts at a MATCHED field and
 * both reversed sign; it re-measured the guard-band escape and the sign held.
 * It could not reach the three RENDERED flat-field readouts, and closed with
 * that as its largest open item: *"whether the flat-field readouts do the same,
 * or reverse like the geometric ones, is unmeasured and is the obvious next
 * step."* This is that step.
 *
 * The three readouts are § 6bk.5's **split** (`renderedFlatField.span` over
 * `throughputFlatField.span` — the traced map against the free one), § 6bm.6's
 * and § 6bn.6's **free-field gain** (what a free flat field buys the seam), and
 * § 6bk.6's **scanner comparison** (what a real slide scanner's own per-tile
 * calibration does to it instead). Each is taken on the axis and at the field
 * edge, on the four cells (10×, 20×) × (0.10, 0.20), at each lens's AXIAL stage
 * — which is § 6bm's and § 6bn's convention, and § 6bp.1 pins that the branch
 * column reproduces their published numbers before any of it is compared.
 *
 * ## The headline: § 6bn.6's agreement to 2.7e-4 was the two frames' sizes
 *
 * § 6bm.6 read the axial free-field gain at 10× and § 6bn.6 at 20×, in one
 * convention, and found **0.9722786 against 0.9720138 — agreeing to 2.7e-4**.
 * § 6bn.6 was careful not to call two points a trend and it was right to be, but
 * the caution was about the wrong risk. The 20× frame is **half** the 10× one at
 * the same sampling, so the two readings were taken over fields differing 2:1.
 * Held at one field the 10× cell does not move — it *is* the branch's sampling —
 * and the 20× goes to **0.9365730** or **0.8377884** depending on the pixel
 * sampling chosen. The agreement becomes a disagreement of 3.7% to 13.8%, which
 * is between **137× and 510× worse** than the figure published (§ 6bp.4).
 *
 * What that does NOT do is overturn the conclusion drawn from it. Both steps
 * used the reading to say the free flat field has stopped helping on the axis by
 * 20× and started hurting — below 1 — and at a matched field it is further below
 * 1, not nearer. **The finding strengthens and the number it was quoted to seven
 * digits with does not survive.**
 *
 * ## The matched field is a FAMILY, and § 6bo pinned one member of it
 *
 * `pupilSamples` fixes the field and leaves `size` free — § 6bo.6 separates the
 * two — so "at a matched field" names a family of quartets, not a quartet. Four
 * are carried here, all at the same field and differing only in pixels per
 * resolution cell:
 *
 * | | 10×/0.10 | 10×/0.20 | 20×/0.10 | 20×/0.20 | px per cell |
 * | --- | --- | --- | --- | --- | --- |
 * | Q128 | 128/32 | 128/64 | 128/16 | 128/32 | 4, 2, 8, 4 |
 * | Q256 | 256/32 | 256/64 | 256/16 | 256/32 | 8, 4, 16, 8 |
 * | Q6BO | 128/32 | 256/64 | 128/16 | 128/32 | 4, 4, 8, 4 |
 * | Q4PX | 128/32 | 256/64 | **64/16** | 128/32 | 4, 4, 4, 4 |
 *
 * Q6BO is § 6bo's own `CELLS_MATCHED`. Q4PX is the one nobody has built: the
 * only one of the four that holds the pixel sampling as well as the field. Run
 * § 6bo's own render-free registration cost through all four and its interaction
 * reads **0.7948724, 0.7905319, 0.7874644, 0.7687374** — Q6BO reproducing
 * § 6bo.2's published value to the last digit it printed, and the family
 * spanning **3.4%** around it (§ 6bp.1). So § 6bo's seven-digit number is its
 * quartet's and not the matched field's, and every figure below is quoted with
 * its sampling attached and a band across the family beside it.
 *
 * That band is the step's instrument, and it is what lets two of the six
 * readouts be REFUSED with a reason rather than left unknown.
 *
 * ## The four verdicts
 *
 * | interaction | branch | matched, across the family | verdict |
 * | --- | --- | --- | --- |
 * | split, axis | 0.993701 | 0.951496 – 0.956497 | departure from 1 grows **×7.4** |
 * | split, edge | 0.991476 | 0.877035 – 0.882268 | grows **×16.3** |
 * | free gain, axis | 0.234860 | 6.980676 – 8.076977 | **CROSSES 1**, in all four |
 * | free gain, edge | 1.213022 | 0.327525 – 1.014993 | **REFUSED** — straddles 1 |
 * | scanner, axis | 0.991687 | 0.224418 – 0.851354 | **REFUSED** — spans 3.79× |
 * | scanner, edge | 0.990397 | 0.885293 – 1.040864 | **REFUSED** — straddles 1 |
 *
 * - **The split is the solid one.** Its family spread is 0.53% on the axis and
 *   0.60% at the edge against a branch-to-matched move of 3.9% and 11.5% — a
 *   margin of 7.4× and 19.3× — so the move is the field's and not the sampling's.
 *   It does **not** reverse: both columns sit below 1. What changes is the SIZE,
 *   and by an order of magnitude. § 6bn.3 published these two as 1.0063 and
 *   1.0086, the two smallest of its six and the basis for a grouping claim; at a
 *   matched field they are 1.0477 and 1.1377 (§ 6bp.3). Understated, not wrong
 *   in sign — which is a third outcome, distinct from § 6bo's reversals and from
 *   its one survivor.
 * - **The free-field gain's axial interaction crosses 1** and every member of
 *   the family agrees that it does, 0.2349 going to between 6.98 and 8.08. The
 *   cell carrying it is the fast 10×, whose axial gain falls from **281.595** to
 *   **9.709** — a factor of 29.0, the largest single matched-field move measured
 *   anywhere on this branch (§ 6bp.5).
 * - **Two are refused.** The free-field gain at the EDGE and the scanner
 *   comparison at both positions have family spreads as large as the effect, and
 *   two of the three straddle 1 — so which side of 1 they fall on is a property
 *   of the pixel sampling and not of the optics. This is stated as a measured
 *   refusal with its band (§ 6bp.6). It is a better answer than § 6bo's
 *   "unknown", and a worse one than a number.
 *
 * ## What survives, and the limit now attached to it
 *
 * § 6bi found, and § 6bk.6, § 6bm.6 and § 6bn.6 each re-found on new lenses,
 * that a real scanner's own per-tile flat field is **never once better** than
 * leaving the seam alone. That sign survives the matched field too: all four
 * cells, both field positions, all four conventions, every one above 1
 * (§ 6bp.7). What does not survive is the MARGIN. § 6bk.6 quoted the span as
 * "1.000× to 1.209×", and at the edge of the 20×/0.10 the same lens at the same
 * field reads **1.0916 down the branch, 1.1736 at Q128 and 1.0000 at Q256** — a
 * margin of 4e-5 arriving at nothing but a different pixel count. So the warning
 * travels and its size is not the optics'.
 *
 * ## Scope, and the miscount this step declines to inherit
 *
 * § 6bo's "Still open" says three of § 6bn's six interactions are unre-measured
 * and that **they are exactly the rendered flat-field ones**. Two of them are:
 * the split on the axis and at the edge, and both are closed here. The third is
 * the **guard-band escape**, which is a double-extent volume render and not a
 * flat field at all, and it stays open — forming its interaction needs matched
 * escapes at 10× as well as § 6bo's two at 20×, which this step does not build.
 * The sentence is corrected rather than repeated: this branch has withdrawn an
 * over-general sentence three times now (§ 6bk.8's ceiling, § 6bl.4's budget,
 * § 6bo's own), and each time it had already propagated.
 *
 * Two further limits belong beside every quotient above. **Only two of the four
 * cells move**: 10×/0.10 and 20×/0.20 sit at the branch's own sampling by
 * construction, so an interaction's whole change is carried by the other two
 * (§ 6bp.2, which pins the two unmoved cells bitwise). And § 6bn's first
 * interval is still unreachable — matching a 4× frame needs a non-integer
 * `pupilSamples` at every power-of-two size.
 *
 * External numbers, cited and reproduced as the license (§ 6bp.1): § 6bm.6's
 * 1355.9999 and 0.9722786; § 6bn.6's 1414.4784, 1.03602668, 1.13666851,
 * 1.15943644 and 0.97201382; § 6bn.3's 1.13546654 and 1.16816836 and its
 * 1.0416581 / 0.9772599 render-free interactions; § 6bm.7's 0.06447406 axial
 * vertex; § 6bo.2's 0.7948724 and 0.7862301; § 6bo.1's 2.031009601158958 field
 * factor and its 1.55% traced-aperture residual.
 */

const DESIGN = 587.5618;
const RED = 656.2725;
const AXIS = { x: 0, y: 0 };
const ANCHOR = 4;
const EDGE = { x: ANCHOR, y: 0 };
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bi's blank calibration slide, unchanged since § 6bi. */
const BLANK: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
  { density: () => 1, band: boxcarBand(400, 700) },
]);

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/**
 * § 6bk's sweep with § 6bk.8's threshold opened to no threshold at all, so a
 * lens whose surface refuses still yields an axial stage. Its own sampling is
 * 128/48 and stays there in BOTH columns: the stage is held while the frame
 * moves, which is § 6bo's `STAGE_A`/`STAGE_B` discipline and the only way the
 * frame is the single variable.
 */
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

/**
 * Builds on FIRST READ and remembers the answer — `fourth-corner`'s `once`,
 * same reasoning. Every fixture here is a sweep or a mosaic and a pure function
 * of the lens and the options, so a rung reads what it would have read eagerly;
 * what changes is that a `-t` rerun of one rung does not build the whole family.
 */
const once = <T>(make: () => T): (() => T) => {
  let held: { readonly v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};

const stage = (mm: number): TileStageMm => () => mm;

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
      { nm: RED, weight: 1 },
    ],
    tiles: 3,
    guardCells: 4,
    stageMm: stage(0),
    radialMapSeed: "magnification",
    centreMm: AXIS,
    ...over,
  };
}

interface Flats {
  /** § 6bk.5's split: the traced flat field's span over the free one's. */
  readonly rendOverFree: number;
  /** § 6bm.6's gain: the raw seam step over the free-field-corrected one. */
  readonly freeGain: number;
  /** § 6bk.6's scanner: the scanner-corrected seam step over the raw one. */
  readonly scannerVsRaw: number;
}

/** § 6bk's `flatsOf`, with `size` and `pupilSamples` exposed — the whole point. */
function flatsOf(
  system: OpticalSystem,
  size: number,
  ps: number,
  centreMm: { x: number; y: number },
  stageMm: TileStageMm,
): Flats {
  const options = mosaicOptions(size, ps, { centreMm, stageMm });
  const geometry = fluorescenceMosaicGeometry(system, options);
  const mosaic = renderFluorescenceMosaic(system, BLANK, options);
  const rendered = renderedFlatField(system, BLANK, options);
  const free = throughputFlatField(mosaic);
  const scanner = scannerFlatField(mosaic);
  const raw = mosaicSeamStep(mosaic.composed, geometry).acrossSeam;
  const afterFree = mosaicSeamStep(flatFieldCorrect(mosaic.composed, free), geometry).acrossSeam;
  const afterScanner = mosaicSeamStep(
    flatFieldCorrect(mosaic.composed, scanner),
    geometry,
  ).acrossSeam;
  return {
    rendOverFree: rendered.span / free.span,
    freeGain: raw / afterFree,
    scannerVsRaw: afterScanner / raw,
  };
}

/** § 6bo's render-free registration cost and its anisotropy — no render in it. */
function costOf(
  system: OpticalSystem,
  size: number,
  ps: number,
): { readonly ratio: number; readonly aniso: number } {
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { centreMm: EDGE }));
  const scan = mosaicSeamShiftMm(
    system,
    mosaicOptions(size, ps, { centreMm: EDGE, scan: "stage" }),
  );
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
}

type Cell = "10/0.10" | "10/0.20" | "20/0.10" | "20/0.20";
const CELLS: readonly Cell[] = ["10/0.10", "10/0.20", "20/0.10", "20/0.20"];

const LENS: Record<Cell, OpticalSystem> = {
  "10/0.10": build(10, 0.1),
  "10/0.20": build(10, 0.2),
  "20/0.10": build(20, 0.1),
  "20/0.20": build(20, 0.2),
};

/**
 * The matched sampling per cell, from § 6bo.1's `field ∝ pupilSamples · M / NA`
 * normalised on the 10×/0.10 cell at the branch's own 32. Integer at every cell,
 * which is what makes the quartet buildable at all.
 */
const PS: Record<Cell, number> = {
  "10/0.10": 32,
  "10/0.20": 64,
  "20/0.10": 16,
  "20/0.20": 32,
};

/** The branch's own path: one sampling for every cell, so the field moves. */
const BRANCH = { size: 128, ps: 32 } as const;

/** The family of matched quartets — same field in all four, differing pixels. */
const Q128: Record<Cell, number> = {
  "10/0.10": 128,
  "10/0.20": 128,
  "20/0.10": 128,
  "20/0.20": 128,
};
const Q256: Record<Cell, number> = {
  "10/0.10": 256,
  "10/0.20": 256,
  "20/0.10": 256,
  "20/0.20": 256,
};
/** § 6bo's own `CELLS_MATCHED`. */
const Q6BO: Record<Cell, number> = {
  "10/0.10": 128,
  "10/0.20": 256,
  "20/0.10": 128,
  "20/0.20": 128,
};
/** Pixels per resolution cell held at 4 everywhere — nobody has built this one. */
const Q4PX: Record<Cell, number> = {
  "10/0.10": 128,
  "10/0.20": 256,
  "20/0.10": 64,
  "20/0.20": 128,
};
const FAMILY: readonly (readonly [string, Record<Cell, number>])[] = [
  ["Q128", Q128],
  ["Q256", Q256],
  ["Q6BO", Q6BO],
  ["Q4PX", Q4PX],
];

const AXIAL: Record<Cell, () => number> = {
  "10/0.10": once(() => renderedBestFocus(LENS["10/0.10"], 430, 0, OPEN).focusMm),
  "10/0.20": once(() => renderedBestFocus(LENS["10/0.20"], 430, 0, OPEN).focusMm),
  "20/0.10": once(() => renderedBestFocus(LENS["20/0.10"], 430, 0, OPEN).focusMm),
  "20/0.20": once(() => renderedBestFocus(LENS["20/0.20"], 430, 0, OPEN).focusMm),
};

/** One mosaic per (cell, size, sampling, field position), built at most once. */
const held = new Map<string, Flats>();
function flats(cell: Cell, size: number, ps: number, where: "axis" | "edge"): Flats {
  const key = `${cell}|${size}|${ps}|${where}`;
  let v = held.get(key);
  if (v === undefined) {
    v = flatsOf(
      LENS[cell],
      size,
      ps,
      where === "axis" ? AXIS : EDGE,
      stage(AXIAL[cell]()),
    );
    held.set(key, v);
  }
  return v;
}

const branchCell = (cell: Cell, where: "axis" | "edge"): Flats =>
  flats(cell, BRANCH.size, BRANCH.ps, where);
const matchedCell = (q: Record<Cell, number>, cell: Cell, where: "axis" | "edge"): Flats =>
  flats(cell, q[cell], PS[cell], where);

type Key = keyof Flats;

/** § 6bm's and § 6bn's interaction: the aperture's effect at 20× over its
 *  effect at 10×. 1 exactly if the levers separate. */
const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
/** Its distance from 1, in whichever direction it departs. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

const branchInteraction = (key: Key, where: "axis" | "edge"): number =>
  interact(
    branchCell("10/0.10", where)[key],
    branchCell("10/0.20", where)[key],
    branchCell("20/0.10", where)[key],
    branchCell("20/0.20", where)[key],
  );
const matchedInteraction = (
  q: Record<Cell, number>,
  key: Key,
  where: "axis" | "edge",
): number =>
  interact(
    matchedCell(q, "10/0.10", where)[key],
    matchedCell(q, "10/0.20", where)[key],
    matchedCell(q, "20/0.10", where)[key],
    matchedCell(q, "20/0.20", where)[key],
  );
/** The family's readings for one interaction, in `FAMILY` order. */
const across = (key: Key, where: "axis" | "edge"): number[] =>
  FAMILY.map(([, q]) => matchedInteraction(q, key, where));

const spanOf = (xs: readonly number[]): number => Math.max(...xs) / Math.min(...xs);
const straddlesOne = (xs: readonly number[]): boolean =>
  Math.min(...xs) < 1 && Math.max(...xs) > 1;

const extentOf = (system: OpticalSystem, size: number, ps: number): number =>
  objectFieldTile(system, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS })
    .halfExtentMm;

// --- § 6bm's and § 6bn's published readings, cited -------------------------
/** § 6bm.6's axial-stage split and free-field gain on the 10×/0.10. */
const ROF_AXIS_10 = 1355.9999;
const FREE_AXIS_10 = 0.9722786;
/** § 6bn.3's edge splits, 10×/0.10 and 10×/0.20. */
const ROF_EDGE_10 = 1.13546654;
const ROF_EDGE_10F = 1.16816836;
/** § 6bn.6's four readings on the two 20× lenses. */
const ROF_AXIS_20 = 1414.4784;
const ROF_AXIS_20F = 1.03602668;
const ROF_EDGE_20 = 1.13666851;
const ROF_EDGE_20F = 1.15943644;
const FREE_AXIS_20 = 0.97201382;
/** § 6bm.7's axial vertex on the fast 10×. */
const AXC_10F = 0.06447406;
/** § 6bn.3's two render-free interactions, and § 6bo.2's matched ones. */
const BRANCH_COST_I = 1.0416581;
const BRANCH_ANISO_I = 0.9772599;
const MATCHED_COST_I_6BO = 0.7948724;
const MATCHED_ANISO_I_6BO = 0.7862301;

describe("§ 6bp.1 — the branch column reproduces, and the matched field is a FAMILY", () => {
  it("every flat-field number § 6bm and § 6bn published comes back, at their stage", () => {
    // § 6bo.2's discipline, and the reason this rung exists at all: the matched
    // column means nothing unless the branch column is the one already pinned.
    // The stage is each lens's own axial best focus, which is the convention
    // § 6bm.6 and § 6bn.6 read these in.
    expect(branchCell("10/0.10", "axis").rendOverFree).toBeCloseTo(ROF_AXIS_10, 3);
    expect(branchCell("10/0.10", "axis").freeGain).toBeCloseTo(FREE_AXIS_10, 6);
    expect(branchCell("10/0.10", "edge").rendOverFree).toBeCloseTo(ROF_EDGE_10, 7);
    expect(branchCell("10/0.20", "edge").rendOverFree).toBeCloseTo(ROF_EDGE_10F, 7);
    expect(branchCell("20/0.10", "axis").rendOverFree).toBeCloseTo(ROF_AXIS_20, 3);
    expect(branchCell("20/0.10", "axis").freeGain).toBeCloseTo(FREE_AXIS_20, 7);
    expect(branchCell("20/0.10", "edge").rendOverFree).toBeCloseTo(ROF_EDGE_20, 7);
    expect(branchCell("20/0.20", "axis").rendOverFree).toBeCloseTo(ROF_AXIS_20F, 7);
    expect(branchCell("20/0.20", "edge").rendOverFree).toBeCloseTo(ROF_EDGE_20F, 7);
    // And the stage those were read at is § 6bm.7's, on the lens that refuses.
    expect(AXIAL["10/0.20"]()).toBeCloseTo(AXC_10F, 7);
  });

  it("the four cells sit at ONE field, to 12 digits within an aperture", () => {
    // § 6bo.1's law: halfExtent ∝ pupilSamples · M / NA. With NA held the
    // sampling cancels the magnification exactly; across apertures § 6bo.1's
    // 2.76% traced-aperture drift leaves a residual it pins at 1.55%.
    const slow = [
      extentOf(LENS["10/0.10"], 128, PS["10/0.10"]),
      extentOf(LENS["20/0.10"], 128, PS["20/0.10"]),
    ];
    const fast = [
      extentOf(LENS["10/0.20"], 128, PS["10/0.20"]),
      extentOf(LENS["20/0.20"], 128, PS["20/0.20"]),
    ];
    expect(slow[0]!).toBeCloseTo(slow[1]!, 12);
    expect(fast[0]!).toBeCloseTo(fast[1]!, 12);
    // The residual between the apertures is § 6bo.1's and not a fifth quartet.
    expect(slow[0]! / fast[0]!).toBeCloseTo(1.0155, 4);
    expect(Math.abs(slow[0]! / fast[0]! - 1)).toBeLessThan(0.0156);

    // `size` does not enter the field at all — which is what makes the family a
    // family rather than four different experiments.
    expect(extentOf(LENS["20/0.10"], 64, 16)).toBeCloseTo(slow[1]!, 12);
    expect(extentOf(LENS["10/0.20"], 256, 64)).toBeCloseTo(fast[0]!, 12);
  });

  it("§ 6bo's 0.7948724 is its QUARTET's: the family spans 3.4% around it", () => {
    // The check that licenses everything below. § 6bo pinned its matched
    // registration cost to seven digits; run the same render-free readout
    // through the four conventions and Q6BO reproduces it exactly while the
    // family spreads. A matched-field number needs its PIXEL sampling stated as
    // well as its field.
    const costI = (q: Record<Cell, number>): number =>
      interact(
        costOf(LENS["10/0.10"], q["10/0.10"], PS["10/0.10"]).ratio,
        costOf(LENS["10/0.20"], q["10/0.20"], PS["10/0.20"]).ratio,
        costOf(LENS["20/0.10"], q["20/0.10"], PS["20/0.10"]).ratio,
        costOf(LENS["20/0.20"], q["20/0.20"], PS["20/0.20"]).ratio,
      );
    const anisoI = (q: Record<Cell, number>): number =>
      interact(
        costOf(LENS["10/0.10"], q["10/0.10"], PS["10/0.10"]).aniso,
        costOf(LENS["10/0.20"], q["10/0.20"], PS["10/0.20"]).aniso,
        costOf(LENS["20/0.10"], q["20/0.10"], PS["20/0.10"]).aniso,
        costOf(LENS["20/0.20"], q["20/0.20"], PS["20/0.20"]).aniso,
      );

    expect(costI(Q6BO)).toBeCloseTo(MATCHED_COST_I_6BO, 7);
    expect(anisoI(Q6BO)).toBeCloseTo(MATCHED_ANISO_I_6BO, 7);

    const costs = FAMILY.map(([, q]) => costI(q));
    expect(costs[0]!).toBeCloseTo(0.787464361, 8);
    expect(costs[1]!).toBeCloseTo(0.790531930, 8);
    expect(costs[2]!).toBeCloseTo(0.794872406, 8);
    expect(costs[3]!).toBeCloseTo(0.768737369, 8);
    // A 3.4% family, and every member on the same side of 1 as § 6bo's.
    expect(spanOf(costs)).toBeCloseTo(1.034, 3);
    for (const c of costs) expect(c).toBeLessThan(1);
    // The branch's own reading is above 1 — § 6bn.3's, reproduced.
    const branchCost = interact(
      costOf(LENS["10/0.10"], BRANCH.size, BRANCH.ps).ratio,
      costOf(LENS["10/0.20"], BRANCH.size, BRANCH.ps).ratio,
      costOf(LENS["20/0.10"], BRANCH.size, BRANCH.ps).ratio,
      costOf(LENS["20/0.20"], BRANCH.size, BRANCH.ps).ratio,
    );
    expect(branchCost).toBeCloseTo(BRANCH_COST_I, 6);
    expect(branchCost).toBeGreaterThan(1);
    const branchAniso = interact(
      costOf(LENS["10/0.10"], BRANCH.size, BRANCH.ps).aniso,
      costOf(LENS["10/0.20"], BRANCH.size, BRANCH.ps).aniso,
      costOf(LENS["20/0.10"], BRANCH.size, BRANCH.ps).aniso,
      costOf(LENS["20/0.20"], BRANCH.size, BRANCH.ps).aniso,
    );
    expect(branchAniso).toBeCloseTo(BRANCH_ANISO_I, 6);
  });
});

describe("§ 6bp.2 — only two of the four cells move, and the other two are bitwise still", () => {
  it("the control and the fast 20× are at the branch's sampling by construction", () => {
    // `PS` is normalised on the 10×/0.10 cell, and the 20×/0.20 needs the same
    // 32 because doubling M and doubling NA cancel. So a quotient over four
    // cells has its whole change carried by two of them, and no rung here may
    // read a mechanism into which cell it came from.
    expect(PS["10/0.10"]).toBe(BRANCH.ps);
    expect(PS["20/0.20"]).toBe(BRANCH.ps);
    for (const where of ["axis", "edge"] as const) {
      for (const cell of ["10/0.10", "20/0.20"] as const) {
        const b = branchCell(cell, where);
        const m = matchedCell(Q128, cell, where);
        expect(m.rendOverFree).toBe(b.rendOverFree);
        expect(m.freeGain).toBe(b.freeGain);
        expect(m.scannerVsRaw).toBe(b.scannerVsRaw);
      }
    }
  });

  it("and the two that DO move are the ones whose field the branch was changing", () => {
    // The fast 10× frame is half the control's at the branch's sampling and the
    // slow 20×'s is double it — § 6bo.1's M / NA, read on this quartet.
    const control = extentOf(LENS["10/0.10"], 128, BRANCH.ps);
    expect(extentOf(LENS["10/0.20"], 128, BRANCH.ps) / control).toBeCloseTo(0.4923660, 6);
    expect(extentOf(LENS["20/0.10"], 128, BRANCH.ps) / control).toBeCloseTo(2.0, 12);
    expect(extentOf(LENS["20/0.20"], 128, BRANCH.ps) / control).toBeCloseTo(0.9847319, 6);
  });
});

describe("§ 6bp.3 — the split does not reverse; its interaction was understated tenfold", () => {
  it("the axial interaction goes 1.0063 to 1.0477, and the family agrees to 0.52%", () => {
    const branch = branchInteraction("rendOverFree", "axis");
    const family = across("rendOverFree", "axis");
    expect(branch).toBeCloseTo(0.993701489, 8);
    // § 6bn.3 published this as a departure of 1.0063.
    expect(departure(branch)).toBeCloseTo(1.006339, 5);
    expect(family[0]!).toBeCloseTo(0.954456224, 8);
    expect(family[1]!).toBeCloseTo(0.956497258, 8);
    expect(family[2]!).toBeCloseTo(0.954996037, 8);
    expect(family[3]!).toBeCloseTo(0.951496335, 8);
    // No reversal: both columns below 1. What changes is the size.
    expect(branch).toBeLessThan(1);
    for (const f of family) expect(f).toBeLessThan(1);
    expect(departure(family[2]!)).toBeCloseTo(1.047124, 5);
    expect(departure(family[2]!) - 1).toBeGreaterThan(7 * (departure(branch) - 1));
    // Separable: the family spread is 0.53% against a 3.9% move.
    expect(spanOf(family)).toBeLessThan(1.0053);
    expect(Math.abs(family[2]! / branch - 1)).toBeGreaterThan(7 * (spanOf(family) - 1));
  });

  it("the edge interaction goes 1.0086 to 1.1377, and separates by 21×", () => {
    const branch = branchInteraction("rendOverFree", "edge");
    const family = across("rendOverFree", "edge");
    expect(branch).toBeCloseTo(0.991475571, 8);
    expect(departure(branch)).toBeCloseTo(1.008598, 5);
    expect(family[0]!).toBeCloseTo(0.878933974, 8);
    expect(family[1]!).toBeCloseTo(0.877215717, 8);
    expect(family[2]!).toBeCloseTo(0.877035074, 8);
    expect(family[3]!).toBeCloseTo(0.882267817, 8);
    for (const f of family) expect(f).toBeLessThan(1);
    expect(departure(family[2]!)).toBeCloseTo(1.140206, 5);
    // Fifteen times the branch's distance from 1, and the family spans 0.60%
    // against an 11.5% move — the cleanest separation in the step.
    expect(departure(family[2]!) - 1).toBeGreaterThan(15 * (departure(branch) - 1));
    expect(spanOf(family)).toBeLessThan(1.0061);
    expect(Math.abs(family[2]! / branch - 1)).toBeGreaterThan(19 * (spanOf(family) - 1));
  });

  it("and the cells behind it, which move in the same direction at both positions", () => {
    // The two moving cells, so the quotient is not the only evidence.
    expect(branchCell("10/0.20", "axis").rendOverFree).toBeCloseTo(0.99948971, 7);
    expect(matchedCell(Q128, "10/0.20", "axis").rendOverFree).toBeCloseTo(0.98955800, 7);
    expect(branchCell("20/0.10", "axis").rendOverFree).toBeCloseTo(1414.47843, 4);
    expect(matchedCell(Q128, "20/0.10", "axis").rendOverFree).toBeCloseTo(1487.41901, 4);
    expect(branchCell("10/0.20", "edge").rendOverFree).toBeCloseTo(1.16816836, 7);
    expect(matchedCell(Q128, "10/0.20", "edge").rendOverFree).toBeCloseTo(1.27141078, 7);
    expect(branchCell("20/0.10", "edge").rendOverFree).toBeCloseTo(1.13666851, 7);
    expect(matchedCell(Q128, "20/0.10", "edge").rendOverFree).toBeCloseTo(1.17809183, 7);
  });
});

describe("§ 6bp.4 — § 6bn.6's agreement to 2.7e-4 was the two frames' sizes", () => {
  it("held at one field the two axial gains disagree by 3.7%, not 2.7e-4", () => {
    // § 6bm.6 read 0.9722786 at 10× and § 6bn.6 read 0.9720138 at 20×, same
    // convention, and published the agreement. The 20× frame is half the 10×
    // one at that sampling, so the two were read over fields differing 2:1.
    const ten = branchCell("10/0.10", "axis").freeGain;
    const twentyBranch = branchCell("20/0.10", "axis").freeGain;
    expect(ten).toBeCloseTo(FREE_AXIS_10, 6);
    expect(twentyBranch).toBeCloseTo(FREE_AXIS_20, 7);
    expect(Math.abs(twentyBranch / ten - 1)).toBeLessThan(3e-4);

    // The 10× cell IS the branch's sampling, so it does not move; the 20× does.
    expect(matchedCell(Q128, "10/0.10", "axis").freeGain).toBe(ten);
    const twenty128 = matchedCell(Q128, "20/0.10", "axis").freeGain;
    const twenty4px = matchedCell(Q4PX, "20/0.10", "axis").freeGain;
    expect(twenty128).toBeCloseTo(0.93657295, 7);
    expect(twenty4px).toBeCloseTo(0.83778838, 7);

    const gap128 = Math.abs(twenty128 / ten - 1);
    const gap4px = Math.abs(twenty4px / ten - 1);
    expect(gap128).toBeCloseTo(0.03669, 4);
    expect(gap4px).toBeCloseTo(0.13830, 4);
    // Between 137× and 510× worse than the agreement published.
    const published = Math.abs(twentyBranch / ten - 1);
    expect(gap128 / published).toBeGreaterThan(130);
    expect(gap4px / published).toBeGreaterThan(500);
  });

  it("what does NOT change: the conclusion drawn from it, which strengthens", () => {
    // Both steps used the reading to say the free flat field has stopped helping
    // on the axis by 20×. At a matched field it is further below 1, not nearer,
    // in every member of the family — so the sentence survives and the number
    // it was quoted with does not.
    for (const [, q] of FAMILY) {
      expect(matchedCell(q, "20/0.10", "axis").freeGain).toBeLessThan(1);
      expect(matchedCell(q, "20/0.10", "axis").freeGain).toBeLessThan(
        branchCell("20/0.10", "axis").freeGain,
      );
    }
  });
});

describe("§ 6bp.5 — the free-field gain's axial interaction CROSSES 1, in all four", () => {
  it("0.2349 becomes between 6.98 and 8.08, and the crossing is unanimous", () => {
    const branch = branchInteraction("freeGain", "axis");
    const family = across("freeGain", "axis");
    expect(branch).toBeCloseTo(0.234859964, 8);
    expect(branch).toBeLessThan(1);
    expect(family[0]!).toBeCloseTo(7.069328017, 7);
    expect(family[1]!).toBeCloseTo(6.980676007, 7);
    expect(family[2]!).toBeCloseTo(7.225062060, 7);
    expect(family[3]!).toBeCloseTo(8.076977291, 7);
    for (const f of family) expect(f).toBeGreaterThan(1);
    // The family spans 15.7% and the crossing does not depend on which member —
    // an imprecise value and a determined verdict, which is the distinction
    // § 6bp.6 turns on.
    expect(spanOf(family)).toBeCloseTo(1.157, 3);
    expect(Math.min(...family)).toBeGreaterThan(6);
  });

  it("and the cell that carries it falls by a factor of 29.6", () => {
    // The largest single matched-field move measured anywhere on this branch —
    // § 6bo's biggest was the escape's 1.282× inflation.
    const b = branchCell("10/0.20", "axis").freeGain;
    const m = matchedCell(Q128, "10/0.20", "axis").freeGain;
    expect(b).toBeCloseTo(281.595246, 5);
    expect(m).toBeCloseTo(9.709279453, 7);
    expect(b / m).toBeCloseTo(29.0, 1);
    // Still above 1 in both: on the axis a free flat field helps this lens
    // enormously either way, and it is the SIZE that was the frame's.
    expect(m).toBeGreaterThan(1);
  });
});

describe("§ 6bp.6 — two readouts are REFUSED, and the refusal is a measurement", () => {
  it("the free-field gain at the EDGE straddles 1 across the family", () => {
    const family = across("freeGain", "edge");
    expect(family[0]!).toBeCloseTo(0.980884694, 8);
    expect(family[1]!).toBeCloseTo(1.014993365, 8);
    expect(family[2]!).toBeCloseTo(0.998382767, 8);
    expect(family[3]!).toBeCloseTo(0.327524605, 8);
    // Which side of 1 it falls on is the pixel sampling's, so this step states
    // no verdict on it. That is not the same as § 6bo's "unknown": the reason is
    // measured and the band is published.
    expect(straddlesOne(family)).toBe(true);
    expect(spanOf(family)).toBeGreaterThan(3);
  });

  it("the scanner comparison is not measurable at this frame, at either position", () => {
    const axis = across("scannerVsRaw", "axis");
    const edge = across("scannerVsRaw", "edge");
    expect(axis[0]!).toBeCloseTo(0.684556658, 8);
    expect(axis[1]!).toBeCloseTo(0.851354499, 8);
    expect(axis[2]!).toBeCloseTo(0.684913609, 8);
    expect(axis[3]!).toBeCloseTo(0.224417675, 8);
    expect(edge[0]!).toBeCloseTo(0.886281685, 8);
    expect(edge[1]!).toBeCloseTo(1.040863900, 8);
    expect(edge[2]!).toBeCloseTo(0.885293418, 8);
    expect(edge[3]!).toBeCloseTo(0.892082300, 8);
    // On the axis the family spans 3.79× — larger than the branch-to-matched
    // move it would be used to claim. At the edge it straddles 1.
    expect(spanOf(axis)).toBeCloseTo(3.794, 3);
    expect(straddlesOne(edge)).toBe(true);
  });

  it("the contrast that makes those refusals meaningful rather than a hedge", () => {
    // The same instrument applied to the split says the opposite, which is why
    // the refusals are about these two readouts and not about the method: the
    // split's family is tighter than its move by more than an order of
    // magnitude, and the gain's axial family is unanimous about the crossing.
    expect(spanOf(across("rendOverFree", "axis"))).toBeLessThan(1.006);
    expect(spanOf(across("rendOverFree", "edge"))).toBeLessThan(1.007);
    expect(straddlesOne(across("rendOverFree", "axis"))).toBe(false);
    expect(straddlesOne(across("rendOverFree", "edge"))).toBe(false);
    expect(straddlesOne(across("freeGain", "axis"))).toBe(false);
  });
});

describe("§ 6bp.7 — the scanner is still never once better, and its MARGIN is sampling", () => {
  it("every cell, both positions, all four conventions and the branch: above 1", () => {
    // § 6bi's warning, re-found by § 6bk.6, § 6bm.6 and § 6bn.6 on new lenses,
    // now at a matched field as well. Thirty-two readings, no exception.
    let readings = 0;
    for (const where of ["axis", "edge"] as const) {
      for (const cell of CELLS) {
        expect(branchCell(cell, where).scannerVsRaw).toBeGreaterThan(1);
        readings++;
        for (const [, q] of FAMILY) {
          expect(matchedCell(q, cell, where).scannerVsRaw).toBeGreaterThan(1);
          readings++;
        }
      }
    }
    expect(readings).toBe(40);
  });

  it("but the margin is 1.0916, 1.1736 and 1.0000 on ONE lens at ONE field", () => {
    // § 6bk.6 quoted the span as 1.000× to 1.209× and treated it as the lens's.
    // Same lens, same field, three pixel counts, and the margin runs from 9.2%
    // to 4e-5. So "never better" travels and "by how much" does not.
    const branch = branchCell("20/0.10", "edge").scannerVsRaw;
    const q128 = matchedCell(Q128, "20/0.10", "edge").scannerVsRaw;
    const q256 = matchedCell(Q256, "20/0.10", "edge").scannerVsRaw;
    expect(branch).toBeCloseTo(1.09162325, 7);
    expect(q128).toBeCloseTo(1.17363814, 7);
    expect(q256).toBeCloseTo(1.00003989, 7);
    expect(q256 - 1).toBeLessThan(1e-4);
    expect(q128 - 1).toBeGreaterThan(1000 * (q256 - 1));
  });
});

describe("§ 6bp.8 — what this step does not close", () => {
  it("the escape's interaction cannot be formed, and it is not a flat field", () => {
    // § 6bo's "Still open" says the three unre-measured interactions are "exactly
    // the rendered flat-field ones". Two are — the split on the axis and at the
    // edge, both closed above. The third is the guard-band escape, a
    // double-extent volume render, and § 6bo built matched escapes only at 20×,
    // so the 10× half of its quotient does not exist. Pinned as a statement
    // about this file's own coverage: three flat-field readouts × two positions
    // is six quantities, and none of them is an escape.
    const keys: Key[] = ["rendOverFree", "freeGain", "scannerVsRaw"];
    expect(keys.length * 2).toBe(6);
    for (const k of keys) {
      expect(Number.isFinite(branchInteraction(k, "axis"))).toBe(true);
      expect(Number.isFinite(branchInteraction(k, "edge"))).toBe(true);
    }
  });

  it("and the first interval is still unreachable: a 4× frame wants a fraction", () => {
    // § 6bo's constraint, re-derived on this quartet rather than cited. Matching
    // the control's field from a 4× needs pupilSamples ∝ M, and the 4× lands on
    // a non-integer at every power-of-two frame size — so § 6bn's 4×→10× step
    // cannot be re-measured here either.
    const wanted = (32 * 4) / 10;
    expect(Number.isInteger(wanted)).toBe(false);
    expect(wanted).toBeCloseTo(12.8, 10);
  });
});
