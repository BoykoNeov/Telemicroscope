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
import {
  SPLIT_AXIS_BRANCH,
  SPLIT_AXIS_MATCHED,
  SPLIT_EDGE_BRANCH,
  SPLIT_EDGE_MATCHED,
  ROF_EDGE_10,
  ROF_EDGE_10F,
} from "./support/cited";

/**
 * § 2r.2: the exit layout, on the located rim (§ 2q.4). Every reading below is
 * on it; where the aim layout's reading is kept beside it, it says so. The
 * step's own header below quotes it as first published, on the aim layout;
 * VALIDATION § 2r.2 lists what moved, and what reversed.
 */
const EXIT = { layout: "exit", edgeSamples: 8, edgeRule: "crossing" } as const;

/**
 * § 2r.3: the registration cost is a stage scan's seam over a FIELD scan's, and
 * on the exit layout a field scan's seam is exactly 0 — every tile reads the
 * anchor's ruler (§ 2i) — so the cost was the aim layout's per-tile ruler drift.
 * It is kept as that layout's readout, on that layout: every seam shift here
 * asks for it.
 */
const SEAM = { layout: "aim" } as const;

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
 * convention, and found **0.9722866 against 0.9720138 — agreeing to 2.7e-4**.
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
 * | scanner, axis | 0.991687 | 0.214456 – 0.851601 | **REFUSED** — spans 3.97× |
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
 * 1355.9886 and 0.9722866; § 6bn.6's 1414.4666, 1.03602668, 1.13666851,
 * 1.15943368 and 0.97202182; § 6bn.3's 1.13546786 and 1.16817043 and its
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
  ...EXIT,
  peak: "band-limited",
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
    ...EXIT,
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
  const field = mosaicSeamShiftMm(system, mosaicOptions(size, ps, { ...SEAM, centreMm: EDGE }));
  const scan = mosaicSeamShiftMm(
    system,
    mosaicOptions(size, ps, { ...SEAM, centreMm: EDGE, scan: "stage" }),
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
  objectFieldTile(system, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS, layout: "exit" })
    .halfExtentMm;

// --- § 6bm's and § 6bn's published readings, cited -------------------------
/** § 6bm.6's axial-stage split and free-field gain on the 10×/0.10. */
const ROF_AXIS_10 = 1508.6972;
const FREE_AXIS_10 = 1.026839;
/** § 6bn.6's four readings on the two 20× lenses. */
const ROF_AXIS_20 = 1519.9759;
const ROF_AXIS_20F = 2.51228600;
const ROF_EDGE_20 = 1.15338689;
const ROF_EDGE_20F = 1.26250497;
const FREE_AXIS_20 = 1.0289192;
/** § 6bm.7's axial vertex on the fast 10×. */
const AXC_10F = 0.06585078;
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

  it("the four cells sit at ONE field, to 1.4e-5 and 1.0% within an aperture (12 digits on the aim layout)", () => {
    // § 6bo.1's law: halfExtent ∝ pupilSamples · M / NA. On the aim layout,
    // with NA held, the sampling cancelled the magnification exactly, and across
    // apertures § 6bo.1's traced-aperture drift left a 1.55% residual. § 2r.2
    // WEAKENED: on the exit layout each lens's ruler is its own traced aperture
    // (§ 6bo.1, § 6br.2), so within an aperture the slow pair agrees to 1.4e-5
    // and the fast pair to 1.0%, and across apertures the residual is 3.6% at
    // 10× and 2.55% at 20×.
    const slow = [
      extentOf(LENS["10/0.10"], 128, PS["10/0.10"]),
      extentOf(LENS["20/0.10"], 128, PS["20/0.10"]),
    ];
    const fast = [
      extentOf(LENS["10/0.20"], 128, PS["10/0.20"]),
      extentOf(LENS["20/0.20"], 128, PS["20/0.20"]),
    ];
    expect(Math.abs(slow[0]! / slow[1]! - 1)).toBeLessThan(2e-5);
    expect(fast[0]! / fast[1]!).toBeCloseTo(0.9898666281680588, 6);
    // The residual between the apertures is § 6bo.1's and not a fifth quartet.
    expect(slow[0]! / fast[0]!).toBeCloseTo(1.035975224851247, 4);
    expect(Math.abs(slow[0]! / fast[0]! - 1)).toBeLessThan(0.037);

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
    expect(extentOf(LENS["10/0.20"], 128, BRANCH.ps) / control).toBeCloseTo(0.48263702452130913, 6);
    expect(extentOf(LENS["20/0.10"], 128, BRANCH.ps) / control).toBeCloseTo(2.0000283989745613, 12);
    expect(extentOf(LENS["20/0.20"], 128, BRANCH.ps) / control).toBeCloseTo(0.9751556639797485, 6);
  });
});

describe("§ 6bp.3 — the split does not reverse; on the aim layout its interaction was understated tenfold", () => {
  it("the axial interaction goes 1.4263 to 1.3945 — OVERstated — and the family spans 4.3%", () => {
    const branch = branchInteraction("rendOverFree", "axis");
    const family = across("rendOverFree", "axis");
    // Against `support/cited.ts`, which § 6bs and § 6bt build their tables on
    // (§ 2w: copied there as literals until then, they went stale at § 2t).
    expect(branch).toBeCloseTo(SPLIT_AXIS_BRANCH, 8);
    // § 6bn.3 published this as a departure of 1.0063.
    expect(departure(branch)).toBeCloseTo(1.4263127705056597, 5);
    expect(family[0]!).toBeCloseTo(0.7157065557451607, 8);
    expect(family[1]!).toBeCloseTo(0.7467864059801967, 8);
    expect(family[2]!).toBeCloseTo(SPLIT_AXIS_MATCHED, 8);
    expect(family[3]!).toBeCloseTo(0.7256448910568353, 8);
    // No reversal: both columns below 1. What changes is the size.
    expect(branch).toBeLessThan(1);
    for (const f of family) expect(f).toBeLessThan(1);
    expect(departure(family[2]!)).toBeCloseTo(1.3945280968540645, 5);
    // § 2r.2 REVERSED. On the aim layout the matched field moved the axial
    // interaction from 1.0063 to 1.0477 — its distance from 1 grew 7.6×, with
    // the family agreeing to 0.53%. On the exit layout the distance SHRINKS, to
    // 0.925 of the branch's: the branch path overstated it. And the family is
    // 4.3% wide against a 2.2% move, so the size is the sampling's more than the
    // field's; what is determined is the direction — every member sits nearer 1
    // than the branch, the nearest 2.1% from it. (1.4441 to 1.4109, 6.5% wide and
    // 0.98% until § 2v's outline; 1.5888 to 1.4622, 0.785, an 8.7% move and 7.3%
    // until § 2u fitted the density's every node.)
    expect((departure(family[2]!) - 1) / (departure(branch) - 1)).toBeCloseTo(0.9254428301223662, 6);
    for (const f of family) expect(departure(f)).toBeLessThan(departure(branch));
    expect(spanOf(family)).toBeCloseTo(1.0434254094580384, 6);
    expect(Math.min(...family) / branch).toBeCloseTo(1.0208214003939435, 6);
  });

  it("the edge interaction goes 1.0298 to 1.0355, and separates by 6.6× (1.1377 and 21× on the aim layout)", () => {
    const branch = branchInteraction("rendOverFree", "edge");
    const family = across("rendOverFree", "edge");
    expect(branch).toBeCloseTo(SPLIT_EDGE_BRANCH, 8);
    expect(departure(branch)).toBeCloseTo(1.029785394029103, 5);
    expect(family[0]!).toBeCloseTo(0.9659877329627434, 8);
    expect(family[1]!).toBeCloseTo(0.9659150853611674, 8);
    expect(family[2]!).toBeCloseTo(SPLIT_EDGE_MATCHED, 8);
    expect(family[3]!).toBeCloseTo(0.966494231087974, 8);
    for (const f of family) expect(f).toBeLessThan(1);
    expect(departure(family[2]!)).toBeCloseTo(1.0355269962080866, 5);
    // § 2r.2 WEAKENED. On the aim layout: fifteen times the branch's distance
    // from 1, the family spanning 0.60% against an 11.5% move — the cleanest
    // separation in the step. On the exit layout the distance grows 1.19×, and
    // the family spans 0.083% against a 0.55% move: still separated, 6.6×.
    expect((departure(family[2]!) - 1) / (departure(branch) - 1)).toBeCloseTo(1.1926299463753631, 6);
    expect(departure(family[2]!)).toBeGreaterThan(departure(branch));
    expect(spanOf(family)).toBeLessThan(1.0009);
    expect(Math.abs(family[2]! / branch - 1)).toBeGreaterThan(6 * (spanOf(family) - 1));
  });

  it("and the cells behind it, which move in the same direction at both positions", () => {
    // The two moving cells, so the quotient is not the only evidence.
    expect(branchCell("10/0.20", "axis").rendOverFree).toBeCloseTo(3.556716386880626, 7);
    expect(matchedCell(Q128, "10/0.20", "axis").rendOverFree).toBeCloseTo(3.7419804086485167, 7);
    expect(branchCell("20/0.10", "axis").rendOverFree).toBeCloseTo(1519.97588437407, 4);
    expect(matchedCell(Q128, "20/0.10", "axis").rendOverFree).toBeCloseTo(1415.2548701818132, 4);
    expect(branchCell("10/0.20", "edge").rendOverFree).toBeCloseTo(1.3020956407130126, 7);
    expect(matchedCell(Q128, "10/0.20", "edge").rendOverFree).toBeCloseTo(1.3151785839063188, 7);
    expect(branchCell("20/0.10", "edge").rendOverFree).toBeCloseTo(1.1533868894857178, 7);
    expect(matchedCell(Q128, "20/0.10", "edge").rendOverFree).toBeCloseTo(1.1479286253245586, 7);
  });
});

describe("§ 6bp.4 — § 6bn.6's agreement was the two frames' sizes", () => {
  it("held at one field the two axial gains disagree by 0.81–1.04%, against 2.0e-3 published", () => {
    // On the aim layout § 6bm.6 read 0.9722866 at 10× and § 6bn.6 read
    // 0.9720138 at 20×, same convention, and published the agreement, 2.7e-4.
    // The 20× frame is half the 10× one at that sampling, so the two were read
    // over fields differing 2:1; held at one field they disagreed by 3.7% and
    // 14.3% — 137× and 510× the agreement.
    //
    // § 2r.2 WEAKENED. On the exit layout the published pair is 1.0268393 and
    // 1.0289192, 2.03e-3 apart, and held at one field they disagree by 0.81%
    // and 1.04%: 4.0× and 5.1× the published gap. The frames' sizes still
    // decide the agreement; by single figures, not by hundreds. (1.25e-3,
    // 0.65% and 1.05%, 5.2× and 8.4×, until § 2v's outline.)
    const ten = branchCell("10/0.10", "axis").freeGain;
    const twentyBranch = branchCell("20/0.10", "axis").freeGain;
    expect(ten).toBeCloseTo(FREE_AXIS_10, 6);
    expect(twentyBranch).toBeCloseTo(FREE_AXIS_20, 7);
    expect(Math.abs(twentyBranch / ten - 1)).toBeCloseTo(0.002025505095377911, 9);

    // The 10× cell IS the branch's sampling, so it does not move; the 20× does.
    expect(matchedCell(Q128, "10/0.10", "axis").freeGain).toBe(ten);
    const twenty128 = matchedCell(Q128, "20/0.10", "axis").freeGain;
    const twenty4px = matchedCell(Q4PX, "20/0.10", "axis").freeGain;
    expect(twenty128).toBeCloseTo(1.0185421923947298, 7);
    expect(twenty4px).toBeCloseTo(1.016153344205395, 7);

    const gap128 = Math.abs(twenty128 / ten - 1);
    const gap4px = Math.abs(twenty4px / ten - 1);
    expect(gap128).toBeCloseTo(0.008080228294250702, 6);
    expect(gap4px).toBeCloseTo(0.010406637321090928, 6);
    const published = Math.abs(twentyBranch / ten - 1);
    expect(gap128 / published).toBeGreaterThan(3.9);
    expect(gap4px / published).toBeGreaterThan(5);
  });

  it("and the conclusion drawn from it REVERSES: the free field helps on the axis at 20×", () => {
    // Both steps used the reading to say the free flat field has stopped helping
    // on the axis by 20×, and on the aim layout a matched field put it further
    // below 1 in every member of the family. § 2r.2 REVERSED: on the exit layout
    // every member is ABOVE 1 — 1.016 to 1.020 — and below the branch's 1.0277,
    // so the sentence goes and the number it was quoted with shrinks.
    for (const [, q] of FAMILY) {
      expect(matchedCell(q, "20/0.10", "axis").freeGain).toBeGreaterThan(1.015);
      expect(matchedCell(q, "20/0.10", "axis").freeGain).toBeLessThan(
        branchCell("20/0.10", "axis").freeGain,
      );
    }
  });
});

describe("§ 6bp.5 — the free-field gain's axial interaction crossed 1 on the aim layout; on the exit it does not", () => {
  it("0.2349 became between 6.98 and 8.08 on the aim layout; on the exit 1.550 becomes 1.540 to 1.548", () => {
    // § 2r.2 REVERSED. On the aim layout the branch read 0.2349 and every member
    // of the family read above 6 — a unanimous crossing, the family 15.7% wide.
    // On the exit layout the branch is already above 1, the family agrees to
    // 0.44% and sits 0.16–0.59% under it: no crossing, and a move whose direction
    // is unanimous and whose size is the family's own width. (1.546, 0.65% and
    // 0.22–0.87% until § 2v's outline; 1.648 and
    // 1.606–1.617, "2.3% under it… a small, determined move", until § 2u.)
    const branch = branchInteraction("freeGain", "axis");
    const family = across("freeGain", "axis");
    expect(branch).toBeCloseTo(1.5502259558428966, 8);
    expect(branch).toBeGreaterThan(1);
    expect(family[0]!).toBeCloseTo(1.5434189816751795, 7);
    expect(family[1]!).toBeCloseTo(1.5402404348879737, 7);
    expect(family[2]!).toBeCloseTo(1.5441127067566112, 7);
    expect(family[3]!).toBeCloseTo(1.5477427207350118, 7);
    for (const f of family) expect(f).toBeGreaterThan(1);
    for (const f of family) expect(f).toBeLessThan(branch);
    expect(spanOf(family)).toBeCloseTo(1.004870853716799, 6);
    expect(Math.max(...family) / branch).toBeCloseTo(0.9983981463485854, 6);
  });

  it("and the cell that carries it rises 3.2% (it fell 29.6× on the aim layout)", () => {
    // On the aim layout the largest single matched-field move measured anywhere
    // on this branch — § 6bo's biggest was the escape's 1.282× inflation. § 2r.2
    // WEAKENED: on the exit layout the fast 10×'s axial gain moves 1.9032 to
    // 1.9632.
    const b = branchCell("10/0.20", "axis").freeGain;
    const m = matchedCell(Q128, "10/0.20", "axis").freeGain;
    expect(b).toBeCloseTo(1.9693864097940217, 5);
    expect(m).toBeCloseTo(1.9982247444460786, 7);
    expect(b / m).toBeCloseTo(0.9855680224498216, 6);
    // Still above 1 in both: on the axis a free flat field helps this lens
    // either way.
    expect(m).toBeGreaterThan(1);
  });
});

describe("§ 6bp.6 — two readouts were REFUSED on the aim layout; on the exit both read a sign", () => {
  it("the free-field gain at the EDGE straddled 1 across the family — on the exit it is 2.0–2.5 in all four", () => {
    const family = across("freeGain", "edge");
    expect(family[0]!).toBeCloseTo(2.109119264025427, 8);
    expect(family[1]!).toBeCloseTo(2.0438125774127927, 8);
    expect(family[2]!).toBeCloseTo(2.1181652407402325, 8);
    expect(family[3]!).toBeCloseTo(2.50036632062202, 8);
    // On the aim layout which side of 1 it fell on was the pixel sampling's, so
    // that step stated no verdict on it — the reason measured and the band
    // published, more than 3× wide. § 2r.2 REVERSED: on the exit layout no
    // member is near 1; the band is 22% wide and the verdict, above 1, is the
    // family's.
    expect(straddlesOne(family)).toBe(false);
    for (const f of family) expect(f).toBeGreaterThan(2);
    expect(spanOf(family)).toBeCloseTo(1.2233833709875523, 6);
  });

  it("the scanner comparison has a sign at both positions; its axial size is the family's", () => {
    const axis = across("scannerVsRaw", "axis");
    const edge = across("scannerVsRaw", "edge");
    expect(axis[0]!).toBeCloseTo(0.9852742227729, 8);
    expect(axis[1]!).toBeCloseTo(0.9877552698984964, 8);
    expect(axis[2]!).toBeCloseTo(0.9865162996290733, 8);
    expect(axis[3]!).toBeCloseTo(0.8900268375878443, 8);
    expect(edge[0]!).toBeCloseTo(1.0111806847997957, 8);
    expect(edge[1]!).toBeCloseTo(1.0113561460776597, 8);
    expect(edge[2]!).toBeCloseTo(1.0109270481642456, 8);
    expect(edge[3]!).toBeCloseTo(1.012470125150479, 8);
    // On the aim layout the axial family spanned 3.97× — larger than the move
    // it would be used to claim — and at the edge it straddled 1. § 2r.2
    // REVERSED in part: on the exit layout every axial member is below 1 and
    // every edge member above it, the edge family 0.15% wide; the axial family
    // spans 11%, so there the size is still the sampling's.
    expect(spanOf(axis)).toBeCloseTo(1.109763878921583, 3);
    expect(straddlesOne(axis)).toBe(false);
    expect(straddlesOne(edge)).toBe(false);
    expect(spanOf(edge)).toBeLessThan(1.0016);
  });

  it("and the instrument's contrast: the split is separable at the edge only", () => {
    // On the aim layout the same instrument applied to the split said the
    // opposite of the refusals: its families were tighter than its moves by more
    // than an order of magnitude. § 2r.2: on the exit layout that holds at the
    // edge (0.083% against 0.55%) and not on the axis (4.3% against 2.2%,
    // § 6bp.3) — so the axial split's size, like the scanner's, is the
    // family's, while its direction is determined.
    expect(spanOf(across("rendOverFree", "axis"))).toBeCloseTo(1.0434254094580384, 6);
    expect(spanOf(across("rendOverFree", "edge"))).toBeLessThan(1.0009);
    expect(straddlesOne(across("rendOverFree", "axis"))).toBe(false);
    expect(straddlesOne(across("rendOverFree", "edge"))).toBe(false);
    expect(straddlesOne(across("freeGain", "axis"))).toBe(false);
  });
});

describe("§ 6bp.7 — the scanner is still never once better, and its MARGIN was sampling on the aim layout", () => {
  it("every cell, both positions, all four conventions and the branch: above 1", () => {
    // § 6bi's warning, re-found by § 6bk.6, § 6bm.6 and § 6bn.6 on new lenses,
    // now at a matched field as well. Forty readings, no exception.
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

  it("and the margin is 1.0924, 1.0900 and 1.0908 on ONE lens at ONE field — not 1.0018", () => {
    // § 6bk.6 quoted the span as 1.000× to 1.209× and treated it as the lens's.
    // On the aim layout the same lens at the same field and three pixel counts
    // ran the margin from 9.2% to 4e-5, so "never better" travelled and "by how
    // much" did not. § 2r.2 REVERSED: on the exit layout the three agree to
    // 2.7% of the margin — 9.24%, 9.00%, 9.08% — so here the size travels too.
    const branch = branchCell("20/0.10", "edge").scannerVsRaw;
    const q128 = matchedCell(Q128, "20/0.10", "edge").scannerVsRaw;
    const q256 = matchedCell(Q256, "20/0.10", "edge").scannerVsRaw;
    expect(branch).toBeCloseTo(1.0924242445386485, 7);
    expect(q128).toBeCloseTo(1.090036029213764, 7);
    expect(q256).toBeCloseTo(1.0907977445345411, 7);
    const margins = [branch - 1, q128 - 1, q256 - 1];
    expect(Math.max(...margins) / Math.min(...margins)).toBeLessThan(1.03);
  });
});

describe("§ 6bp.8 — what this step does not close", () => {
  it("the escape's quartet wants THREE frame sizes, where the branch's wants one", () => {
    // § 6bo's "Still open" says the three unre-measured interactions are "exactly
    // the rendered flat-field ones". Two are — the split on the axis and at the
    // edge, both closed above. The third is the guard-band escape, a
    // double-extent volume render and not a flat field at all, and § 6bo built
    // matched escapes only at 20×, so the 10× half of its quotient does not
    // exist. What that would cost is arithmetic rather than an opinion, so it is
    // measured here rather than asserted in prose: § 6bo's `escaped` derives its
    // own frame from the sampling — `size = (ps / 32) · 128`, rendered at double
    // extent — so a matched-field escape quartet is not one frame size but
    // three, and § 6bo.6's ~1% size sensitivity would then need its own control
    // ACROSS those three before any quotient off them meant anything.
    const wide = (cell: Cell): number => 2 * ((PS[cell] / BRANCH.ps) * 128);
    expect(wide("10/0.10")).toBe(256);
    expect(wide("10/0.20")).toBe(512);
    expect(wide("20/0.10")).toBe(128);
    expect(wide("20/0.20")).toBe(256);
    expect(new Set(CELLS.map(wide)).size).toBe(3);
    // The branch's own path needs exactly one, which is why the escape has had a
    // single control everywhere it has been read.
    expect(new Set(CELLS.map(() => 2 * BRANCH.size)).size).toBe(1);
    // And the three flat-field readouts carried here are none of them an escape:
    // every one comes off `mosaic-flat-field`, which does not render a volume.
    const keys: Key[] = ["rendOverFree", "freeGain", "scannerVsRaw"];
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
