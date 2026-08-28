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
  fluorescenceSpectralVolume,
  labelledVolumeEmitters,
  type SpectralVolumeEmitterDensity,
} from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bn — the second interval, and not one interaction is a slope.
 *
 * § 6bm closed the 2×2 § 6bk had left as an L and found that the two levers —
 * magnification and aperture — interact on every readout carried through it, by
 * sizes spanning a factor of fifty. Its own first "still open" said what that
 * could not buy: **one cell per readout is one interaction number, and one
 * number is not a shape.** Whether any of the six is a smooth function of either
 * lever needed a third setting of one of them, and it named the lens — "a
 * 20×/0.20, which is buildable and was not built here".
 *
 * This is that lens. It builds, the grid becomes 3 magnifications × 2 apertures,
 * and every one of § 6bm's six interactions gets a **second interval** to sit
 * beside its first. The answer is uniformly negative and interestingly so: **not
 * one of the six is a slope.** Two of them reverse direction, one all but
 * vanishes, and the two that continue in the same direction go opposite ways
 * relative to separation.
 *
 * | Readout | 4×→10× (§ 6bm) | 10×→20× (here) | what it did |
 * | --- | --- | --- | --- |
 * | flat-field split, axis | 1.1343× | **1.0063×** | collapsed |
 * | flat-field split, edge | 53.650× | **1.0086×** | vanished |
 * | seam anisotropy | 1.0166× | **1.0233×** | grew |
 * | seam registration cost | 1.1061× | **1.0417×** | shrank |
 * | axial plateau width | 1.8326× | **1.1609×** | REVERSED |
 * | guard-band escape | 1.6826× | **1.2148×** | REVERSED |
 *
 * The last column is the point. Both reversals cross 1 — the raw quotients are
 * 0.86143 and 0.82317 where § 6bm's were 1.83258 and 1.68264 — so the lever that
 * amplified the other on the first interval damps it on the second. A quantity
 * that does that has no monotone interaction in M, and § 6bm's numbers were
 * never slopes to extend.
 *
 * ## What this falsifies, and what it does not
 *
 * § 6bm.4 did not merely observe an ordering, it **asserted** one: the two
 * readouts with no render in them sat at the bottom of the six, and its test
 * pins that with `toBe`. Re-run on the second interval, that assertion is
 * **false** — both flat-field splits (1.0063, 1.0086) come in below both
 * render-free readouts (1.0233, 1.0417), which is the reverse grouping.
 *
 * § 6bm was right to hedge it. Its own words were that the grouping is
 * "CONSISTENT with the split being about the traced map rather than the
 * defocused light — it is NOT isolated by this data, 1.106 against 1.134 being
 * no gap at all". § 6bn.3 applies that standard to itself: 1.0063 against 1.0086
 * is no gap either, so what is claimed here is the **group** flipping sides, not
 * a fine-grained order. And the whole second interval spans 1.006 to 1.215 where
 * the first spanned 1.017 to 53.65, so an ordering read off it carries almost
 * nothing. The transferable sentence is the one § 6bm already wrote and this
 * step confirms the need for: an interaction quoted without its interval is
 * quoted without its condition.
 *
 * ## The one thing that constrains § 6bm's unnamed mechanism
 *
 * § 6bm eliminated three artefacts for its plateau — probe depth, sweep step and
 * frame size — and put nothing in their place. The third magnification does not
 * name a mechanism either, but it does constrain one. At NA 0.10 the plateau
 * falls **2.2946×** from 4× to 10× and then **1.0093×** — flat, to within a
 * percent. At NA 0.20 it falls 1.2521× and then 1.1716× — still falling. So
 * whatever sets the plateau **saturates with magnification at the slow aperture
 * and has not saturated by 20× at the fast one**, which is the first statement on
 * this branch that a candidate mechanism has to satisfy.
 *
 * And it is not one readout's quirk. The guard-band escape — a double-extent
 * volume render, sharing no code path with the axial peak search — does the same
 * thing on the same interval at the same aperture: 2.4119× then **1.0196×** at
 * NA 0.10, against 1.4334× then 1.2386× at NA 0.20. Two independent rendered
 * readouts, one shape, so the saturation belongs to the slow lens family rather
 * than to either estimator.
 *
 * ## The aperture lever is continuous, and its ceiling is a 4× number
 *
 * This step was about to write that its interactions are aperture DOUBLINGS
 * because the lever has only two settings. It has many: 0.12, 0.15 and 0.18 all
 * build at 4×, 10× and 20×, and the doubling was a choice nobody had probed.
 *
 * Probing it turned up something larger. § 6bk.8 measured NA 0.25 refusing at 4×
 * and at 10× and wrote **"this solver's ceiling being 0.20 at every
 * magnification"**; § 6bl, § 6bm and this file's own first draft all inherited
 * that sentence, and three steps in a row carried "still nothing on a high-NA
 * objective" as though it were a limit of the engine. **The ceiling rises with
 * magnification**: the highest aperture that builds is 0.15 at 2×, 0.20 at 4×,
 * 0.22 at 10× and 0.25 at 20× and 40× (§ 6bn.1). A 20×/0.25 builds and images at
 * magnification −20.0000003.
 *
 * § 6bk.8's own two readings are correct; it is the generalisation across
 * magnification that was never measured — which is the third time on this branch
 * that a "cannot be built" has had to be withdrawn, after § 6bk's fourth corner
 * and § 6bl's correction of it. **This step does not measure the new lenses**; it
 * pins what exists so the next one starts from a measurement.
 *
 * ## A gift to § 6bm.6, for no runtime
 *
 * § 6bm.6 wanted to compare the free flat field's axial gain across the
 * magnification lever and could not: its 10× reading (0.9725286) was corrected
 * stage and § 6bl.6's 20× (0.972202) was corrected stage with a different sweep
 * extent, and the two differed by less than the convention gap between them. The
 * axial-stage readings **are** comparable — § 6bm pinned 0.9722786 at 10× and
 * this file measures 0.9720138 at 20×, same convention, agreeing to 2.7e-4
 * (§ 6bn.6). What it still does not do is call two points a trend: there is no
 * handle on this readout's own reproducibility, which is exactly why § 6bm
 * declined and why § 6bn declines with better numbers.
 *
 * ## Scope, and what this file deliberately does not run
 *
 * **No focus surface.** The 20×/0.20 refuses its sweep, so a corrected stage for
 * it exists only through a forced surface, and § 6bm.7's precedent is that no
 * number may be read off one — a forced surface characterises a refusal and
 * nothing else. The 20×/0.10's corrected-stage readings already exist in § 6bl.6
 * and are cited. Every stage here is therefore the AXIAL one, obtained the way
 * § 6bk and § 6bm obtained theirs, and § 6bn.6 says which convention each cited
 * number is in before comparing it.
 *
 * That is also why this file is cheap — about 15 s against `fourth-corner`'s
 * 103 s, of which 49 s is its focus surface and its four-cell fixture block.
 *
 * External numbers, all CITED: § 6bm's six interactions (1.0166451, 1.1060587,
 * 1.1342887, 1.6826431, 1.8325811, 53.6497518) and its 4× and 10× cells —
 * plateau depths 0.869607 / 1.804658 / 0.3789813 / 1.4412949, escapes 0.02238865
 * / 0.4498281, axial splits 1355.9999 / 0.99948971, edge splits 1.13546654 /
 * 1.16816836, registration costs 64.157741 and anisotropy 33.290128, the axial
 * free-field gain 0.9722786, the 1/M shortfalls 0.08355329 and 0.17143031, and
 * the ruler shifts 1.00059197 / 1.00051706; § 6bk.6's 95.712993 / 41.775694
 * costs, 40.754313 / 16.868779 anisotropies and its 1.2090451 scanner ceiling;
 * § 6bl.4's 21.045983 cost and 8.874831 anisotropy at 20×; § 6bl.1's 20.01×
 * height span.
 *
 * **On the axial split's convention.** § 6bm's own interaction uses
 * `F10_AXIS.rendOverFree = 1355.9999`, the AXIAL-stage 10× reading — not
 * § 6bk.5's 1355.9474, which is the same readout on the same lens at a CORRECTED
 * stage. The 20× readings here are axial, so 1355.9999 is the one that chains,
 * and taking the more familiar constant would move the interaction by about 1%
 * of its distance from 1. This is the third time this branch has had to name a
 * stage convention before quoting a number.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** The two new cells: the third magnification at both apertures. */
const TWENTY = build(20, 0.1);
const TWENTY_FAST = build(20, 0.2);

const SIZE = 128;
const PS = 32;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };
const SAMPLES = [
  { nm: 430, weight: 1 },
  { nm: DESIGN, weight: 1 },
  { nm: RED, weight: 1 },
];

/** § 6bi's blank calibration slide. */
const BLANK: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
  { density: () => 1, band: boxcarBand(400, 700) },
]);

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/** § 6bk's, § 6bl's and § 6bm's sweep, unchanged — the lens is the only variable. */
const SWEEP: FocusSweepOptions = {
  size: 128,
  pupilSamples: 48,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1,
  radialMapSeed: "magnification",
};

/**
 * The sweep with its threshold opened wide enough to be no threshold at all —
 * § 6bk.8's device, re-used because a refusing lens still has an axial stage.
 * § 6bm.7 pinned `focusMm` invariant to it at cap 2 and at 1e9; § 6bn.2 re-pins
 * that the refusal itself is what the narrow threshold reports.
 */
const OPEN: FocusSweepOptions = { ...SWEEP, maxPlateauDepths: 1e9 };

const magOf = (system: OpticalSystem): number =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: DESIGN,
    centreMm: { x: 0, y: 0 },
  }).magnification;

/** § 6bk's matched ruler, seeded for § 6bk.8's reason. */
const matched = (system: OpticalSystem, radiusMm: number): number =>
  objectHeightForImageRadius(system, radiusMm, DESIGN, { magnification: magOf(system) });

const ANCHOR = 4;
const AXIS = { x: 0, y: 0 };
const EDGE = { x: ANCHOR, y: 0 };

const H20 = matched(TWENTY, ANCHOR);
const H20F = matched(TWENTY_FAST, ANCHOR);

const P20 = renderedBestFocus(TWENTY, 430, 0, OPEN);
const P20F = renderedBestFocus(TWENTY_FAST, 430, 0, OPEN);
const AX20 = P20.focusMm;
const AX20F = P20F.focusMm;

const stage = (mm: number): TileStageMm => () => mm;

function mosaicOptions(
  stageMm: TileStageMm,
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions {
  return {
    size: SIZE,
    pupilSamples: PS,
    slabs: THIN,
    samples: SAMPLES,
    tiles: 3,
    guardCells: 4,
    stageMm,
    radialMapSeed: "magnification",
    ...over,
  };
}

interface Flats {
  readonly rendOverFree: number;
  readonly freeGain: number;
  readonly scannerVsRaw: number;
}

/** § 6bk's, § 6bl's and § 6bm's `flatsOf`, unchanged. */
function flatsOf(
  system: OpticalSystem,
  stageMm: TileStageMm,
  centreMm: { x: number; y: number },
): Flats {
  const options = mosaicOptions(stageMm, { centreMm });
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

/** § 6bk.4's escape readout, unchanged — § 6bd.8's double-extent method. */
function escaped(
  system: OpticalSystem,
  nm: number,
  objectHeightMm: number,
  centreMm: { x: number; y: number },
  focusMm: number,
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
    size: SIZE * 2,
    pupilSamples: PS,
    slabs: THIN,
    samples: [{ nm, weight: 1 }],
    centreMm,
    radialMapSeed: "magnification",
    focusMm,
  });
  const v = wide.planes[0]!.intensity;
  const n = wide.size;
  const o = Math.round((n - SIZE) / 2);
  let inner = 0;
  let all = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = v[r * n + c]!;
      all += x;
      if (r >= o && r < o + SIZE && c >= o && c < o + SIZE) inner += x;
    }
  }
  return 1 - inner / all;
}

/** § 6bj's registration cost and its anisotropy — geometry only, no render. */
function cost(
  system: OpticalSystem,
  stageMm: TileStageMm,
): { readonly ratio: number; readonly aniso: number } {
  const field = mosaicSeamShiftMm(system, mosaicOptions(stageMm, { centreMm: EDGE }));
  const scan = mosaicSeamShiftMm(
    system,
    mosaicOptions(stageMm, { centreMm: EDGE, scan: "stage" }),
  );
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
}

/**
 * The whole render-free grid, computed at a single stage of ZERO.
 *
 * § 6bm.1 pinned that `mosaicSeamShiftMm` is bitwise indifferent to the focus
 * stage — a tile's geometry is a frame and an offset, and no render enters — on
 * one lens at three stages. Taking every cell at one arbitrary stage turns that
 * into the strongest available form: six cells reproduce numbers that were
 * originally measured at three DIFFERENT stage conventions (§ 6bk's and § 6bm's
 * axial, § 6bl's corrected), so the mixed-convention citations below are licensed
 * by construction rather than by argument. § 6bn.1 pins the reproduction.
 */
const FREE_STAGE = stage(0);
const G4 = cost(build(4, 0.1), FREE_STAGE);
const G4F = cost(build(4, 0.2), FREE_STAGE);
const G10 = cost(build(10, 0.1), FREE_STAGE);
const G10F = cost(build(10, 0.2), FREE_STAGE);
const G20 = cost(TWENTY, FREE_STAGE);
const G20F = cost(TWENTY_FAST, FREE_STAGE);

const F20_AXIS = flatsOf(TWENTY, stage(AX20), AXIS);
const F20_EDGE = flatsOf(TWENTY, stage(AX20), EDGE);
const F20F_AXIS = flatsOf(TWENTY_FAST, stage(AX20F), AXIS);
const F20F_EDGE = flatsOf(TWENTY_FAST, stage(AX20F), EDGE);

const E20 = escaped(TWENTY, 430, H20, EDGE, AX20);
const E20F = escaped(TWENTY_FAST, 430, H20F, EDGE, AX20F);

/** § 6bk's and § 6bm's 4× and 10× cells, cited. */
const PLATEAU_4 = 0.869607;
const PLATEAU_4F = 1.804658;
const PLATEAU_10 = 0.3789813;
const PLATEAU_10F = 1.4412949;
const COST_4 = 95.712993;
const COST_4F = 132.8979;
const COST_10 = 41.775694;
const COST_10F = 64.157741;
const ANISO_4 = 40.754313;
const ANISO_4F = 81.766377;
const ANISO_10 = 16.868779;
const ANISO_10F = 33.290128;
const ESC_4 = 0.054;
const ESC_4F = 0.644789;
const ESC_10 = 0.02238865;
const ESC_10F = 0.4498281;
/** AXIAL stage, § 6bm's `F10_AXIS` — deliberately NOT § 6bk.5's corrected 1355.9474. */
const ROF_AXIS_10 = 1355.9999;
const ROF_AXIS_10F = 0.99948971;
const ROF_EDGE_10 = 1.13546654;
const ROF_EDGE_10F = 1.16816836;
/** AXIAL stage, § 6bm's `F10_AXIS.freeGain` — not its corrected 0.9725286. */
const FREE_AXIS_10 = 0.9722786;
/** § 6bl.4's 20× cell, measured at a CORRECTED stage. */
const COST_20 = 21.045983;
const ANISO_20 = 8.874831;
/** § 6bk.6's ceiling: a scanner's own calibration is never once better. */
const SCANNER_CEILING = 1.2090451;

/** § 6bm's interaction: the aperture lever at the high M over the same at the low M. */
const interact = (slowLo: number, fastLo: number, slowHi: number, fastHi: number): number =>
  fastHi / slowHi / (fastLo / slowLo);
/** The same, written as a departure from 1 in whichever direction it departs. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

/** § 6bm's six, cited. */
const I1_ANISO = 1.0166451;
const I1_COST = 1.1060587;
const I1_AXIS = 1.1342887;
const I1_ESC = 1.6826431;
const I1_PLATEAU = 1.8325811;
const I1_EDGE = 53.6497518;

const anisoI = interact(ANISO_10, ANISO_10F, G20.aniso, G20F.aniso);
const costI = interact(COST_10, COST_10F, G20.ratio, G20F.ratio);
const flatAxisI = interact(
  ROF_AXIS_10,
  ROF_AXIS_10F,
  F20_AXIS.rendOverFree,
  F20F_AXIS.rendOverFree,
);
const escI = interact(ESC_10, ESC_10F, E20, E20F);
const plateauI = interact(PLATEAU_10, PLATEAU_10F, P20.plateauDepths, P20F.plateauDepths);
const flatEdgeI = interact(
  ROF_EDGE_10,
  ROF_EDGE_10F,
  F20_EDGE.rendOverFree,
  F20F_EDGE.rendOverFree,
);

describe("§ 6bn.1 — the fifth and sixth cells build, and the render-free grid is stage-free", () => {
  it("a 20×/0.20 builds, and the aperture moves the matched ruler less at every magnification", () => {
    // § 6bl.1's confound is that a matched IMAGE radius forces object height to
    // scale as 1/M, so magnification and field position are perfectly tied. The
    // APERTURE lever has no such tie, and now has three measurements of how
    // little it moves the ruler: 0.059% at 4×, 0.052% at 10× (§ 6bm.1) and
    // 0.049% here. Monotone down, and all three about four orders below § 6bl.1's
    // 20.01× span of field position, so no rung below owes a confound paragraph.
    expect(() => build(20, 0.2)).not.toThrow();
    expect(magOf(TWENTY_FAST)).toBeCloseTo(-20.0000004, 6);
    expect(magOf(TWENTY)).toBeCloseTo(-20.0000006, 6);
    expect(H20).toBeCloseTo(0.19958776, 7);
    expect(H20F).toBeCloseTo(0.19968613, 7);

    const ruler20 = H20F / H20;
    expect(ruler20).toBeCloseTo(1.00049285, 7);
    // Smaller than both of § 6bm.1's, and in order.
    expect(ruler20 - 1).toBeLessThan(1.00051706 - 1);
    expect(1.00051706 - 1).toBeLessThan(1.00059197 - 1);
  });

  it("the aperture lever is CONTINUOUS, and the ceiling everyone inherited is a 4× number", () => {
    // § 6bk wrote that a lens "cannot be" built and was wrong; § 6bl caught it
    // and § 6bm built the lens. This step was about to repeat the species: that
    // its interactions are aperture DOUBLINGS because the lever has only two
    // settings. It has many — 0.12, 0.15 and 0.18 all build at every
    // magnification on the ladder — and the doubling was a choice nobody probed.
    for (const NA of [0.12, 0.15, 0.18]) {
      for (const M of [4, 10, 20]) {
        expect(() => build(M, NA)).not.toThrow();
      }
    }

    // And the inherited ceiling is worse than unprobed, it is wrong. § 6bk.8
    // measured NA 0.25 refusing at 4× and 10× and wrote "this solver's ceiling
    // being 0.20 at every magnification"; § 6bl, § 6bm and this file's own first
    // draft all inherited it. The ceiling RISES with magnification, and the
    // refusal is the same one throughout — the achromat's steepest surface going
    // past hemispherical.
    const CEILING: readonly (readonly [number, number, number])[] = [
      [2, 0.15, 0.18],
      [4, 0.2, 0.22],
      [10, 0.22, 0.25],
      [20, 0.25, 0.28],
      [40, 0.25, 0.28],
    ];
    for (const [M, highest, refused] of CEILING) {
      expect(() => build(M, highest)).not.toThrow();
      expect(() => build(M, refused)).toThrow(/APERTURE and not the glass pair/);
    }
    // Monotone non-decreasing in M, and flat by 20×.
    const ceilings = CEILING.map(([, highest]) => highest);
    for (let i = 1; i < ceilings.length; i++) {
      expect(ceilings[i]!).toBeGreaterThanOrEqual(ceilings[i - 1]!);
    }
    expect(ceilings[3]!).toBe(ceilings[4]!);
    // § 6bk.8's own two readings are the ones that hold: 0.25 refuses at 4× and
    // 10×. It is the generalisation to "every magnification" that fails.
    expect(() => build(4, 0.25)).toThrow(/APERTURE and not the glass pair/);
    expect(() => build(10, 0.25)).toThrow(/APERTURE and not the glass pair/);
    expect(() => build(20, 0.25)).not.toThrow();
    // And the lens past the inherited ceiling images, at its stated magnification.
    expect(magOf(build(20, 0.25))).toBeCloseTo(-20.0000003, 6);
  });

  it("six cells at ONE stage reproduce numbers taken at three different stage conventions", () => {
    // The mixed-convention trap this branch has caught twice, disarmed by
    // construction rather than by argument. Every cost and anisotropy below is
    // computed at a stage of zero — a stage no earlier step used — and reproduces
    // § 6bk's and § 6bm's axial-stage readings AND § 6bl's corrected-stage ones.
    // `mosaicSeamShiftMm` does no render, so the stage cannot enter; that is what
    // licenses every citation in this file that mixes the two.
    expect(G4.ratio).toBeCloseTo(COST_4, 4);
    expect(G4F.ratio).toBeCloseTo(COST_4F, 4);
    expect(G10.ratio).toBeCloseTo(COST_10, 4);
    expect(G10F.ratio).toBeCloseTo(COST_10F, 4);
    expect(G20.ratio).toBeCloseTo(COST_20, 4); // § 6bl's, corrected stage
    expect(G4.aniso).toBeCloseTo(ANISO_4, 4);
    expect(G4F.aniso).toBeCloseTo(ANISO_4F, 4);
    expect(G10.aniso).toBeCloseTo(ANISO_10, 4);
    expect(G10F.aniso).toBeCloseTo(ANISO_10F, 4);
    expect(G20.aniso).toBeCloseTo(ANISO_20, 4); // § 6bl's, corrected stage

    // The two new cells, and § 6bm.1's bitwise claim re-pinned on the sixth lens
    // at three stages a millimetre apart.
    expect(G20F.ratio).toBeCloseTo(33.668192, 4);
    expect(G20F.aniso).toBeCloseTo(17.115988, 4);
    const atAxial = cost(TWENTY_FAST, stage(AX20F));
    const aMillimetreOff = cost(TWENTY_FAST, stage(AX20F + 1));
    expect(atAxial.ratio).toBe(G20F.ratio);
    expect(aMillimetreOff.ratio).toBe(G20F.ratio);
    expect(atAxial.aniso).toBe(G20F.aniso);
    expect(aMillimetreOff.aniso).toBe(G20F.aniso);
  });
});

describe("§ 6bn.2 — the third aperture pair refuses too, and the width falls with shrinking steps", () => {
  it("three of three NA 0.20 lenses refuse, and every NA 0.10 lens above 2× passes", () => {
    // § 6bm could say "both NA 0.20 lenses on this ladder refuse" off two. Three
    // of three is the aperture's, and it is not the magnification's: the same
    // magnification at half the aperture certifies at the same threshold, here as
    // at 4× and 10×. (§ 6bl.5's 2×/0.10 refusal is the other route to the
    // estimator's floor and is untouched by this.)
    expect(P20F.plateauDepths).toBeCloseTo(1.2301647, 6);
    expect(P20F.plateauDepths).toBeGreaterThan(1);
    expect(P20.plateauDepths).toBeCloseTo(0.37549919, 7);
    expect(P20.plateauDepths).toBeLessThan(1);
    // Caught once rather than through three `toThrow` calls: each one re-runs the
    // sweep, and this is the only rung in the file that spends a second on a
    // reading it already has.
    let refusal = "";
    try {
      renderedBestFocus(TWENTY_FAST, 430, 0, SWEEP);
    } catch (e) {
      refusal = (e as Error).message;
    }
    expect(refusal).toMatch(/plateau/);
    expect(refusal).toMatch(/1\.2301/);
    expect(refusal).toMatch(/depths of focus/);
    expect(() => renderedBestFocus(TWENTY, 430, 0, SWEEP)).not.toThrow();
  });

  it("the refusal narrows monotonically — 1.8047, 1.4413, 1.2302 — and is NOT extrapolated", () => {
    // Three points on the fast lever, monotone down, with the step shrinking:
    // 1.2521× then 1.1716×. § 6bl.2's precedent governs what may be read off
    // that, and it is: nothing. A series that flattens is exactly the series an
    // extrapolation to a crossing gets wrong, so where — or whether — this one
    // reaches 1 is unmeasured, and no magnification is named at which a fast lens
    // would certify.
    const step1 = PLATEAU_4F / PLATEAU_10F;
    const step2 = PLATEAU_10F / P20F.plateauDepths;
    expect(step1).toBeCloseTo(1.2521088, 6);
    expect(step2).toBeCloseTo(1.1716276, 6);
    expect(step2).toBeLessThan(step1);
    expect(P20F.plateauDepths).toBeLessThan(PLATEAU_10F);
    expect(PLATEAU_10F).toBeLessThan(PLATEAU_4F);
  });

  it("the slow aperture SATURATES, the fast one has not — the first constraint on the mechanism", () => {
    // § 6bm eliminated three artefacts for this plateau (probe depth, sweep step,
    // frame size) and put nothing in their place. This does not name a mechanism
    // either. It constrains one: at NA 0.10 the width falls 2.29× on the first
    // interval and 1.009× on the second — flat to within a percent — while at
    // NA 0.20 it is still falling. Whatever sets the plateau saturates in M at
    // the slow aperture and has not saturated by 20× at the fast one.
    const slowStep1 = PLATEAU_4 / PLATEAU_10;
    const slowStep2 = PLATEAU_10 / P20.plateauDepths;
    expect(slowStep1).toBeCloseTo(2.2945908, 6);
    expect(slowStep2).toBeCloseTo(1.0092733, 6);
    expect(Math.abs(slowStep2 - 1)).toBeLessThan(0.01);
    // The fast lens's second step is an order of magnitude further from flat.
    expect(Math.abs(1.1716276 - 1)).toBeGreaterThan(15 * Math.abs(slowStep2 - 1));
    // And the aperture's own cost at 20× — 2.0753× at 4×, 3.8031× at 10× (§ 6bm.2).
    expect(P20F.plateauDepths / P20.plateauDepths).toBeCloseTo(3.2760781, 6);
  });

  it("and the guard-band escape saturates in exactly the same pattern — two readouts, not one", () => {
    // The constraint above would be one rendered readout doing one thing, which
    // is weak. A SECOND rendered readout, sharing no code path with the sweep —
    // the escape is a double-extent volume render and the plateau is an axial
    // peak search — does the same thing on the same interval at the same
    // aperture: at NA 0.10 both fall hard and then go flat within 2%, and at
    // NA 0.20 both are still falling at 20×. So the saturation is a property of
    // the slow lens family and not of either estimator.
    const escSlowStep1 = ESC_4 / ESC_10;
    const escSlowStep2 = ESC_10 / E20;
    const escFastStep1 = ESC_4F / ESC_10F;
    const escFastStep2 = ESC_10F / E20F;
    expect(escSlowStep1).toBeCloseTo(2.4119364, 6);
    expect(escSlowStep2).toBeCloseTo(1.0195626, 6);
    expect(escFastStep1).toBeCloseTo(1.4334120, 6);
    expect(escFastStep2).toBeCloseTo(1.2385882, 6);
    // Flat on the slow lens, still falling on the fast one — the plateau's shape.
    expect(Math.abs(escSlowStep2 - 1)).toBeLessThan(0.02);
    expect(Math.abs(escFastStep2 - 1)).toBeGreaterThan(10 * Math.abs(escSlowStep2 - 1));
    // Both readouts collapse their step by more than an order of magnitude at
    // NA 0.10 and by less than a factor of two at NA 0.20.
    expect((escSlowStep1 - 1) / (escSlowStep2 - 1)).toBeGreaterThan(50);
    expect((escFastStep1 - 1) / (escFastStep2 - 1)).toBeLessThan(2);
  });
});

describe("§ 6bn.3 — six interactions get a second interval, and § 6bm.4's ordering does not survive it", () => {
  it("all six second-interval interactions, and not one of them separates either", () => {
    // The same six readouts, the same `interact`, one lever-step further along.
    // Every one would be 1 if the levers acted independently on THIS interval,
    // and none of them is — but the whole set now spans 1.006 to 1.215 where the
    // first interval spanned 1.017 to 53.65.
    expect(departure(flatAxisI)).toBeCloseTo(1.0063384, 6);
    expect(departure(flatEdgeI)).toBeCloseTo(1.0085977, 6);
    expect(departure(anisoI)).toBeCloseTo(1.0232693, 6);
    expect(departure(costI)).toBeCloseTo(1.0416581, 6);
    expect(departure(plateauI)).toBeCloseTo(1.1608626, 6);
    expect(departure(escI)).toBeCloseTo(1.2148231, 5);

    for (const i of [anisoI, costI, flatAxisI, escI, plateauI, flatEdgeI]) {
      expect(departure(i)).toBeGreaterThan(1.005);
    }
    const ordered = [anisoI, costI, flatAxisI, escI, plateauI, flatEdgeI]
      .map(departure)
      .sort((a, b) => a - b);
    expect(ordered[5]! / ordered[0]!).toBeCloseTo(1.2072, 3);
    // § 6bm's six spanned fifty times that.
    expect(I1_EDGE / I1_ANISO).toBeGreaterThan(40 * (ordered[5]! / ordered[0]!));
  });

  it("§ 6bm.4's ordering assertion is FALSE on the very next interval", () => {
    // § 6bm.4 pinned with `toBe` that the two readouts computed with no render at
    // all sat at the bottom of the six. On the second interval both flat-field
    // splits come in BELOW both render-free readouts — the reverse grouping — so
    // that assertion does not survive its own next interval.
    //
    // § 6bm hedged it correctly and the hedge is what carries: it called the
    // grouping "CONSISTENT with ... NOT isolated by this data, 1.106 against
    // 1.134 being no gap at all". The same standard applies here, so what is
    // claimed is the GROUP changing sides and not the fine order — 1.0063 against
    // 1.0086 is no gap either, and neither is 1.0233 against 1.0417.
    expect(departure(flatAxisI)).toBeLessThan(departure(anisoI));
    expect(departure(flatEdgeI)).toBeLessThan(departure(anisoI));
    expect(departure(flatAxisI)).toBeLessThan(departure(costI));
    expect(departure(flatEdgeI)).toBeLessThan(departure(costI));
    // On § 6bm's interval the grouping was the other way round, both ways.
    expect(I1_ANISO).toBeLessThan(I1_AXIS);
    expect(I1_COST).toBeLessThan(I1_AXIS);
    expect(I1_COST).toBeLessThan(I1_EDGE);
    // And the gaps this step declines to read anything into.
    expect(departure(flatEdgeI) / departure(flatAxisI)).toBeCloseTo(1.00224, 4);
    expect(departure(costI) / departure(anisoI)).toBeCloseTo(1.01798, 4);
  });
});

describe("§ 6bn.4 — two interactions reverse, and the largest one vanishes", () => {
  it("the plateau and the escape both cross 1 — the amplifying lever becomes a damping one", () => {
    // The step's headline. § 6bm measured 1.8326× and 1.6826×, both above 1, and
    // called them the interaction of the two levers. One interval further along
    // the same two quotients are 0.8614 and 0.8232 — BELOW 1. A quantity whose
    // interaction changes sign in the exponent has no monotone dependence on
    // magnification at all, so neither of § 6bm's numbers was a slope and neither
    // may be carried to a lens outside the pair it was measured on.
    expect(plateauI).toBeCloseTo(0.8614284, 6);
    expect(escI).toBeCloseTo(0.8231651, 6);
    expect(plateauI).toBeLessThan(1);
    expect(escI).toBeLessThan(1);
    expect(I1_PLATEAU).toBeGreaterThan(1);
    expect(I1_ESC).toBeGreaterThan(1);

    // The guard band's own reading, for the record: § 6bk.4 found twice the
    // aperture leaks MORE past a tile's frame — 11.94× at 4×, 20.09× at 10× — and
    // at 20× it is 16.54×. The finding survives on a third pair; its growth does
    // not.
    expect(E20).toBeCloseTo(0.02195907, 7);
    expect(E20F).toBeCloseTo(0.36317810, 7);
    expect(E20F / E20).toBeCloseTo(16.538862, 5);
    expect(E20F / E20).toBeLessThan(20.091788);
    expect(E20F / E20).toBeGreaterThan(11.940612);
  });

  it("the largest interaction in § 6bm's square is a 4× number: 53.65× becomes 1.0086×", () => {
    // § 6bm's headline was that magnification moves the flat-field split at the
    // EDGE by 55.38× once the aperture is doubled, against 1.03× at NA 0.10 — an
    // interaction of 53.65, thirty times the next largest and the reason the
    // square was said to span fifty. On the next interval the same construction
    // gives 1.0086. The 53.65 belongs to the 4×→10× step and to nothing else.
    expect(F20_EDGE.rendOverFree).toBeCloseTo(1.13666851, 7);
    expect(F20F_EDGE.rendOverFree).toBeCloseTo(1.15943644, 7);
    expect(ROF_EDGE_10F / F20F_EDGE.rendOverFree).toBeCloseTo(1.00752, 4);
    expect(ROF_EDGE_10 / F20_EDGE.rendOverFree).toBeCloseTo(0.99894, 4);
    // Its distance from 1 falls by more than three orders of magnitude.
    expect((I1_EDGE - 1) / (departure(flatEdgeI) - 1)).toBeGreaterThan(5000);

    // The axis reading collapses the same way, from 1.1343× to 1.0063×.
    expect(F20_AXIS.rendOverFree).toBeCloseTo(1414.4784, 3);
    expect(F20F_AXIS.rendOverFree).toBeCloseTo(1.03602668, 7);
    expect((I1_AXIS - 1) / (departure(flatAxisI) - 1)).toBeGreaterThan(20);
  });

  it("and the identity holds on the second interval too — the same number down the other lever", () => {
    // § 6bm.2's guard against a transcription error, re-run: an interaction is
    // the aperture lever at 20× over the aperture lever at 10×, and equally the
    // magnification lever at NA 0.20 over the same at NA 0.10. It is one
    // arithmetic identity and it is pinned as one, this file's quotients spanning
    // two other files' constants.
    const downMagnification =
      P20F.plateauDepths / PLATEAU_10F / (P20.plateauDepths / PLATEAU_10);
    expect(downMagnification).toBeCloseTo(plateauI, 12);
    const costDownMagnification = G20F.ratio / COST_10F / (G20.ratio / COST_10);
    expect(costDownMagnification).toBeCloseTo(costI, 12);
  });
});

describe("§ 6bn.5 — the two readouts that continue, and they go opposite ways", () => {
  it("the registration cost moves TOWARD separation and the anisotropy AWAY from it", () => {
    // The two render-free readouts are the only two of the six that keep both
    // their direction and their order of magnitude across the two intervals — and
    // they disagree about which way the family is heading. The cost's interaction
    // shrinks from 1.1061 to 1.0417 (toward the 1 that would mean the levers
    // separate); the anisotropy's grows from 1.0166 to 1.0233. So even restricted
    // to the two best-behaved readouts there is no single trend to name.
    expect(costI).toBeLessThan(I1_COST);
    expect(departure(anisoI)).toBeGreaterThan(I1_ANISO);
    expect(costI / I1_COST).toBeCloseTo(0.94177, 4);
    expect(departure(anisoI) / I1_ANISO).toBeCloseTo(1.00651, 4);
    // Both stay on the same side of 1 as they were, unlike § 6bn.4's two.
    expect(costI).toBeGreaterThan(1);
    expect(anisoI).toBeLessThan(1);
  });

  it("§ 6bl.4's 'plus about a tenth' is a low-M tenth — both apertures converge on exact 1/M", () => {
    // § 6bl.4 fitted three NA 0.10 points to 1/M "to within 10%" and § 6bm.5
    // billed a faster lens for more: 8.36% short of exact 1/M at NA 0.10 and
    // 17.14% at NA 0.20, across 4×→10×. The second interval is much closer to
    // exact at both apertures — 0.75% and 4.72% — so the excess is not a constant
    // of the lens family, and a caller sizing a guard band from § 6bl.4's number
    // over-budgets at high M as much as § 6bm.5 showed it under-budgets on a fast
    // lens. What survives both intervals: the fast lens is always the further
    // from 1/M.
    const stepSlow = COST_10 / G20.ratio;
    const stepFast = COST_10F / G20F.ratio;
    expect(stepSlow).toBeCloseTo(1.9849724, 6);
    expect(stepFast).toBeCloseTo(1.9055891, 6);
    expect(1 - stepSlow / 2).toBeCloseTo(0.00751382, 8);
    expect(1 - stepFast / 2).toBeCloseTo(0.04720544, 8);
    expect(1 - stepSlow / 2).toBeLessThan(0.08355329);
    expect(1 - stepFast / 2).toBeLessThan(0.17143031);
    // The fast lens is short by more at both intervals, by about 6× and 6×.
    expect(1 - stepFast / 2).toBeGreaterThan(1 - stepSlow / 2);
    expect(0.17143031).toBeGreaterThan(0.08355329);
  });
});

describe("§ 6bn.6 — the free field on a fifth and sixth lens, in ONE convention", () => {
  it("the axial free-field gain agrees to 2.7e-4 across the lever, in ONE convention", () => {
    // § 6bm.6 could not compare its 10× against § 6bl.6's 20×: one was a
    // corrected stage swept to OUTER = 1.25 and the other to 1.30, and the two
    // readings differed by less than the convention gap between them, so it
    // pinned the agreement and read nothing from it. The AXIAL readings are
    // directly comparable — § 6bm pinned 0.9722786 at 10×, this is 0.9720138 at
    // 20×, the same convention on the same readout — and they agree to 2.7e-4.
    //
    // What this still does NOT do is call two points a trend. There is no handle
    // on this readout's own reproducibility, which is why § 6bm declined; the
    // improvement is that the DECLINE is now about reproducibility alone and not
    // about a convention nobody had measured.
    expect(F20_AXIS.freeGain).toBeCloseTo(0.97201382, 7);
    expect(F20_AXIS.freeGain / FREE_AXIS_10).toBeCloseTo(0.99972767, 7);
    expect(F20_AXIS.freeGain).toBeLessThan(1);
    expect(FREE_AXIS_10).toBeLessThan(1);
    // § 6bl.6's corrected-stage 0.972202 on the same lens, for the size of the gap.
    expect(Math.abs(F20_AXIS.freeGain / 0.972202 - 1)).toBeLessThan(2e-4);
  });

  it("a scanner's own calibration is never once better, on a fifth and sixth lens either", () => {
    // § 6bk.6's ceiling, extended. Every one of the four new readings makes the
    // seam worse than raw and none exceeds 1.2090451 — now nineteen readings
    // across six lenses without a single exception.
    for (const f of [F20_AXIS, F20_EDGE, F20F_AXIS, F20F_EDGE]) {
      expect(f.scannerVsRaw).toBeGreaterThan(1);
      expect(f.scannerVsRaw).toBeLessThan(SCANNER_CEILING);
    }
    expect(F20_AXIS.scannerVsRaw).toBeCloseTo(1.2026527, 6);
    expect(F20_EDGE.scannerVsRaw).toBeCloseTo(1.0916232, 6);
    expect(F20F_AXIS.scannerVsRaw).toBeCloseTo(1.0001726, 6);
    expect(F20F_EDGE.scannerVsRaw).toBeCloseTo(1.0607808, 6);
  });

  it("§ 6bk.5's aperture role-swap is still the control's, and by a wider margin", () => {
    // § 6bk.5 read the fast lens as better on the axis and worse at the edge, and
    // § 6bm.6 showed the swap does not happen at 10×: the fast lens is 281.6×
    // better on the axis AND 18.5× better at the edge, a ratio of 15.2 where a
    // swap needs 100. At 20× the same ratio is 3.22 — further from a swap, not
    // nearer.
    expect(F20F_AXIS.freeGain).toBeCloseTo(66.117438, 5);
    expect(F20F_EDGE.freeGain).toBeCloseTo(20.519043, 5);
    expect(F20F_AXIS.freeGain / F20F_EDGE.freeGain).toBeCloseTo(3.2222477, 6);
    expect(F20F_AXIS.freeGain / F20F_EDGE.freeGain).toBeLessThan(15.215778);
    // The slow lens still splits the two field positions by more than a hundred.
    expect(F20_EDGE.freeGain / F20_AXIS.freeGain).toBeGreaterThan(100);
  });
});
