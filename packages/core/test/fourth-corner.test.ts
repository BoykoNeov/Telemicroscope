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
import { surfaceStage, type TileStageMm } from "../src/imaging/focus-tiles";
import {
  focusSurface,
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
 * § 6bm — the fourth corner, and the levers do not separate.
 *
 * § 6bk pulled two levers off a 4×/0.10 control — magnification to 10× and
 * aperture to 0.20 — and read every result off three points, which is an L and
 * not a square. It then wrote that the corner "is not measured and cannot be,
 * this solver's ceiling being 0.20 at every magnification". § 6bl corrected that
 * sentence — a ceiling of 0.20 is a lens *at* 0.20, and § 6bk.8's own rung pins
 * that 0.20 builds at both magnifications — and left the corner unbuilt, so
 * **whether the two levers interact stayed open by omission**. This step builds
 * it and closes that question: they interact, on every readout, and by sizes
 * that span a factor of fifty between readouts.
 *
 * ## What a 2×2 buys that an L cannot
 *
 * With three points a lever's effect is one number and there is nothing to
 * compare it with. With four, the aperture lever can be pulled at 4× and again
 * at 10× and the two answers divided, and that quotient is the whole question:
 * **1 exactly if the levers separate, and its distance from 1 is the size of the
 * interaction.** It is the same number computed the other way round — the
 * magnification lever at NA 0.10 over the same lever at NA 0.20 — which is an
 * arithmetic identity and is pinned as one (§ 6bm.2), because a quotient of
 * quotients across two test files is exactly the shape a transcription error
 * hides in.
 *
 * Six readouts are carried through the square. Their interaction sizes, written
 * as a departure from 1 in whichever direction they depart:
 *
 * | Readout | Rendered? | Interaction |
 * | --- | --- | --- |
 * | seam anisotropy | no | **1.0166×** |
 * | seam registration cost | no | **1.1061×** |
 * | flat-field split, on the axis | yes | **1.1343×** |
 * | guard-band escape | yes | **1.6826×** |
 * | axial plateau width | yes | **1.8326×** |
 * | flat-field split, at the edge | yes | **53.65×** |
 *
 * The two readouts computed with **no render at all** — both off
 * `mosaicSeamShiftMm`, which is a model of the composition and not of the
 * optics — sit at the bottom of that ordering. That is worth stating and it is
 * **not** a mechanism this step isolates: 1.106 against 1.134 is not a gap, and
 * six readouts across one square give one interaction number each and no
 * functional form. So no rung here says "geometry separates and light does
 * not", and none of them fits, extrapolates, or calls anything multiplicative.
 * § 6bm.4 states the ordering as measured and declines the rest.
 *
 * ## The headline: § 6bk's sharpest sentence is a NA-0.10 sentence
 *
 * § 6bk.5 found the rendered-versus-free flat-field split to be "the APERTURE's"
 * and pinned that magnification barely touches it — 1.136× across the 2.5×. At
 * the **edge** of the field that holds only at NA 0.10. At NA 0.20 the same
 * magnification lever moves the same readout **55.38×** (64.696246 against
 * 1.1681684), which is the largest interaction in the square by a factor of
 * thirty. On the **axis** § 6bk.5's reading survives — the aperture collapses
 * the split to 0.99933 at 4× and 0.99949 at 10×, and those two agree to 1.6e-4.
 * So the sentence is right where it was measured and wrong one field position
 * out, and only the fourth corner could show that.
 *
 * ## The corner has no focus surface
 *
 * The 10×/0.20 builds, images and composes, and its focus sweep **refuses**: a
 * plateau 1.4413 depths of focus wide against the 1 asked for. So this is a
 * second refusing lens, and the plateau square is the readout that closes
 * cleanly — 0.869607 and 1.804658 cited from § 6bk.8, 0.378981 and 1.441295 new
 * here. § 6bk.2 pinned that the *unit* separates perfectly: λ/NA² carries no M
 * and moves 0.074% across the magnification lever. The response measured in that
 * unit does not, by 1.833×. **The separability of the unit does not descend to
 * the quantity expressed in it**, which is the sharpest form the interaction
 * takes and the reason § 6bk.2 could not have predicted it.
 *
 * § 6bm.3 spends four extra sweeps ruling the obvious artefacts out, because a
 * plateau is exactly the shape a sampling floor makes: halving the probe's own
 * axial thickness moves it 0.025%, halving the sweep step moves it 0.041%, and
 * doubling the rendered frame moves it by **6.4e-15 — bitwise, to the last
 * digit**. None of the three is the mechanism, so the plateau is the lens's.
 *
 * ## Two gifts to earlier rungs, and one bill
 *
 * - **§ 6bl.4's mixed-convention 1/M fit is licensed retroactively.** It quoted
 *   a 4× measured at an axial stage beside a 10× and 20× measured at corrected
 *   stages, which the memory of this branch flags as the trap that "will bite
 *   again". It does not bite here: § 6bm.1 pins that the registration cost is
 *   **bitwise identical** at three different stages, the readout being geometry
 *   with no render in it. The convention could not have mattered.
 * - **§ 6bl's unlocated crossing is bracketed.** The free field's axial gain is
 *   1.01788 on the control and 0.972202 at 20×, so it passes through 1 somewhere;
 *   the 10× reading was never taken. It is 0.9725363, so **the crossing is
 *   between 4× and 10×** (§ 6bm.6). Where in that interval stays unlocated, and
 *   the step does NOT claim the series then flattens — see the rung.
 * - The bill: § 6bl.4's registration cost "goes as 95.7 over M, plus about a
 *   tenth" is the **slow lens's** tenth. The same 4×→10× step falls 8.36% short
 *   of exact 1/M at NA 0.10 and 17.14% short at NA 0.20 (§ 6bm.5).
 *
 * External numbers, all CITED and none recomputed except where a reproduction is
 * itself the license: § 6bk.8's 0.869607 / 1.804658 plateau depths, its
 * 3.7587141e-2 / 1.9460897e-2 millimetres and its 0.39920498 matched height;
 * § 6bk.2's 1.00074 unit separation; § 6bk.3's 2.173425 ratio; § 6bk.4's 0.054000
 * and 0.644789 escapes; § 6bk.5's 1195.2705 / 0.99932895 / 1.1721421 / 64.696246
 * splits and its 1.136239 magnification reading; § 6bk.1's 1.01788 corrected-stage
 * free-field gain; § 6bk.6's 95.712993 / 41.775694 / 132.89790 registration costs,
 * its 40.754313 / 16.868779 / 81.766377 anisotropies and its 1.2090451 ceiling;
 * § 6bl.1's 1.240811e-2 / 1.892194e-3 surface terms and its 20.01× height span;
 * § 6bl.6's 0.972202 gain at 20×.
 *
 * **On recomputing `SURF10`.** § 6bl's precedent is not to spend 26 s re-deriving
 * a number another file pins. This file spends it once, because the
 * corrected-stage axial `freeGain` § 6bm.6 needs is obtainable no other way — a
 * corrected stage IS a focus surface — and it is a reading § 6bk computed the
 * fixture for and never asserted. Reproducing § 6bk.3's 2.173425 off it is the
 * **license** for the citations, not the purpose of the sweep.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bk's control. */
const FOUR = build(4, 0.1);
/** § 6bk's aperture lever. */
const FAST = build(4, 0.2);
/** § 6bk's magnification lever. */
const TEN = build(10, 0.1);
/** The corner § 6bk said could not be built and § 6bl said could. */
const CORNER = build(10, 0.2);

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
/** Half the axial extent of `BALL`, for § 6bm.3's artefact elimination only. */
const SLIM: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.002, peak: 1, centreMm });

/** § 6bk's and § 6bl's sweep, unchanged — the lens is the only variable. */
const SWEEP: FocusSweepOptions = {
  ...EXIT,
  peak: "band-limited",
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
 * The sweep with its threshold opened wide enough to be no threshold at all.
 *
 * § 6bk.8 pins that `focusMm` is invariant to this — the same number whether the
 * plateau is admitted narrowly or the check is removed — which is what makes an
 * axial stage obtainable from a lens whose surface refuses. § 6bm.7 re-pins it on
 * the corner rather than inheriting it, the corner being a different refusal.
 */
const OPEN: FocusSweepOptions = { ...SWEEP, maxPlateauDepths: 1e9 };

const magOf = (system: OpticalSystem): number =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: DESIGN,
    centreMm: { x: 0, y: 0 },
    layout: "exit",
  }).magnification;

/** § 6bk's matched ruler, seeded for § 6bk.8's reason. */
const matched = (system: OpticalSystem, radiusMm: number): number =>
  objectHeightForImageRadius(system, radiusMm, DESIGN, { magnification: magOf(system) });

const ANCHOR = 4;
const AXIS = { x: 0, y: 0 };
const EDGE = { x: ANCHOR, y: 0 };

const H4 = matched(FOUR, ANCHOR);
const HF = matched(FAST, ANCHOR);
const H10 = matched(TEN, ANCHOR);
const HC = matched(CORNER, ANCHOR);

/**
 * Builds on FIRST READ and remembers the answer.
 *
 * Every fixture below is a render or a sweep, and as plain `const`s they were
 * all computed when the module was evaluated — the whole square, paid in full
 * by a run that then executes ONE rung. Nothing about the physics wants that:
 * the sweeps are independent and a rung reads three or four of them. Wrapped
 * this way each is built the first time a rung asks for it and never again,
 * which is the same value in every case: every fixture below is a pure function
 * of the lens and the options, and `once` evaluates its argument at most once.
 *
 * Measured on this file alone, eager then lazy: **collect 36.4 s → 0.5 s**, the
 * file's total 77.1 s → 75.2 s. Only the collect figure is claimed. A back-to-
 * back A/B of the same pair read 90.6 s against 75.2 s and a third eager run
 * read 79.3 s, so run-to-run spread on this machine is wider than the totals
 * differ: the total is stated as **not slower**, not as a saving. Collect is
 * the figure that repeats and the one that matters — it is what a `-t` rerun
 * pays before the rung it asked for starts, and it was previously paid whole.
 *
 * The same change is in `aperture-and-field`, `second-objective`,
 * `third-magnification` and `second-interval`, each carrying its own measured
 * pair. Summing the five SOLO measurements — not a five-file run, which would
 * be a different number — collect falls from 181.8 s to 2.3 s, and no file's
 * total moves outside its own spread.
 *
 * The cost of saying so is a `()` at every read. That is the whole diff: no
 * number, no tolerance and no assertion changes, and `tsc` names every site
 * that was missed rather than leaving one silently eager.
 */
const once = <T>(make: () => T): (() => T) => {
  let held: { readonly v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};

/**
 * The axial response at 430 nm on the axis, for all four corners.
 *
 * Its `focusMm` is the `AXIAL` stage convention — § 6bk's `AXIAL_20 =
 * 0.2618676018`, obtained the way § 6bk obtained it, and also its `AXIAL_4 =
 * SURF4.colourMm[0]`, the surface's colour row at height 0 being this same
 * sweep. § 6bm.1 pins that both reproduce, so every square below is in ONE
 * convention.
 */
const plateau = (system: OpticalSystem) => renderedBestFocus(system, 430, 0, OPEN);
const P4 = once(() => plateau(FOUR));
const PF = once(() => plateau(FAST));
const P10 = once(() => plateau(TEN));
const PC = once(() => plateau(CORNER));
const AX4 = once(() => P4().focusMm);
const AXF = once(() => PF().focusMm);
const AX10 = once(() => P10().focusMm);
const AXC = once(() => PC().focusMm);

const stage = (mm: number): TileStageMm => () => mm;
const plateauMm = (p: { plateauDepths: number; depthOfFocusMm: number }): number =>
  p.plateauDepths * p.depthOfFocusMm;

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
    ...EXIT,
    ...over,
  };
}

interface Flats {
  readonly rendOverFree: number;
  readonly freeGain: number;
  readonly scannerVsRaw: number;
}

/** § 6bk's and § 6bl's `flatsOf`, unchanged. */
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
    ...EXIT,
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
  const field = mosaicSeamShiftMm(system, mosaicOptions(stageMm, { ...SEAM, centreMm: EDGE }));
  const scan = mosaicSeamShiftMm(
    system,
    mosaicOptions(stageMm, { ...SEAM, centreMm: EDGE, scan: "stage" }),
  );
  return { ratio: scan.mm / field.mm, aniso: scan.betweenRowsMm / scan.betweenColumnsMm };
}

const C4 = once(() => cost(FOUR, stage(AX4())));
const CF = once(() => cost(FAST, stage(AXF())));
const C10 = once(() => cost(TEN, stage(AX10())));
const CC = once(() => cost(CORNER, stage(AXC())));

const E4 = once(() => escaped(FOUR, 430, H4, EDGE, AX4()));
const EF = once(() => escaped(FAST, 430, HF, EDGE, AXF()));
const E10 = once(() => escaped(TEN, 430, H10, EDGE, AX10()));
const EC = once(() => escaped(CORNER, 430, HC, EDGE, AXC()));

const F10_AXIS = once(() => flatsOf(TEN, stage(AX10()), AXIS));
const F10_EDGE = once(() => flatsOf(TEN, stage(AX10()), EDGE));
const FC_AXIS = once(() => flatsOf(CORNER, stage(AXC()), AXIS));
const FC_EDGE = once(() => flatsOf(CORNER, stage(AXC()), EDGE));

/**
 * § 6bk's own 10× focus surface, recomputed — see the header for why this one
 * sweep is not cited. Same grid, same `OUTER = 1.25`, same threshold.
 */
const SURF10 = once(() =>
  focusSurface(TEN, {
    ...SWEEP,
    wavelengthsNm: [430, DESIGN, RED],
    objectHeightsMm: [0, H10 / 2, H10, 1.25 * H10],
  }),
);
const CORRECTED_10 = once((): TileStageMm => surfaceStage(SURF10()));
const F10_CORR_AXIS = once(() => flatsOf(TEN, CORRECTED_10(), AXIS));

const spanOf = (xs: readonly number[]): number => Math.max(...xs) - Math.min(...xs);

/** § 6bk's readings, cited. */
const PLATEAU_4 = 0.839354;
const PLATEAU_F = 2.656363;
const PLATEAU_MM_4 = 3.6279502e-2;
const PLATEAU_MM_F = 2.8645437e-2;
const COST_4 = 95.712993;
const COST_F = 132.8979;
const COST_10 = 41.775694;
const ANISO_4 = 40.754313;
const ANISO_F = 81.766377;
const ANISO_10 = 16.868779;
const ESC_4 = 0.0644316;
const ESC_F = 0.614210;
const ROF_AXIS_4 = 1220.0858;
const ROF_AXIS_F = 1.8565748;
const ROF_EDGE_4 = 1.1675136;
const ROF_EDGE_F = 1.9596655;
/**
 * § 6bk.1's CORRECTED-stage free-field axial gain on the control — deliberately
 * NOT § 6bk.5's axial 1.0177396, which is the same readout on the same lens in
 * the other convention. § 6bm.6 is what makes the choice safe.
 */
const FREE_AXIS_4 = 1.00807;
/** § 6bl.6's, corrected stage, same readout, at 20×. */
const FREE_AXIS_20 = 1.028246;

/**
 * The interaction: one lever's effect at the far end of the other lever, over
 * its effect at the near end. 1 exactly if the levers separate.
 */
const interact = (slow4: number, fast4: number, slow10: number, fast10: number): number =>
  fast10 / slow10 / (fast4 / slow4);
/** The same, written as a departure from 1 in whichever direction it departs. */
const departure = (x: number): number => (x < 1 ? 1 / x : x);

describe("§ 6bm.1 — the corner builds, the ruler barely moves, and every borrowed number reproduces", () => {
  it("a 10×/0.20 builds and holds its magnification, and the aperture moves the matched ruler 0.05%", () => {
    // § 6bl.1's confound was that a matched IMAGE radius forces object height to
    // scale as 1/M, so magnification and field position were perfectly tied and
    // no rung could name magnification as a mechanism. The APERTURE lever has no
    // such tie: at a matched image radius, doubling NA moves the object height by
    // 0.059% at 4× and 0.052% at 10× — against § 6bl.1's 20.01× span. So this
    // step owes no confound paragraph, and the two aperture shifts agreeing to
    // 7.5e-5 makes that an M-independent statement rather than a coincidence.
    expect(() => build(10, 0.2)).not.toThrow();
    expect(magOf(CORNER)).toBeCloseTo(-10.0000002, 6);

    expect(HF / H4).toBeCloseTo(1.00059197, 7);
    expect(HC / H10).toBeCloseTo(1.00051706, 7);
    expect(HF / H4 / (HC / H10)).toBeCloseTo(1.0000749, 6);
    expect(Math.abs(HC / H10 - 1)).toBeLessThan(1e-3);

    // And the ruler itself is § 6bk.8's, to the digit that rung pins.
    expect(H10).toBeCloseTo(0.39920498, 7);
    expect(HC).toBeCloseTo(0.39941139, 7);
  });

  it("the three cells § 6bk already measured come back unchanged, which is what licenses the fourth", () => {
    // Every interaction below is a quotient of quotients spanning two test files.
    // Without this rung none of them are licensed: a fixture that had drifted
    // would produce an interaction that is really a fixture difference. This is
    // § 6bk.1's "the lens is the only variable" applied to a whole square.
    expect(P4().plateauDepths).toBeCloseTo(PLATEAU_4, 5);
    expect(PF().plateauDepths).toBeCloseTo(PLATEAU_F, 5);
    expect(plateauMm(P4())).toBeCloseTo(PLATEAU_MM_4, 8);
    expect(plateauMm(PF())).toBeCloseTo(PLATEAU_MM_F, 8);

    // The escape pair does double duty: it confirms this file's stage convention
    // is § 6bk's own, § 6bk.4 having measured the control at `SURF4.colourMm[0]`
    // and the fast lens at a `renderedBestFocus` vertex.
    expect(AXF()).toBeCloseTo(0.1208236004, 9);
    expect(E4()).toBeCloseTo(ESC_4, 6);
    expect(EF()).toBeCloseTo(ESC_F, 6);

    expect(C4().ratio).toBeCloseTo(COST_4, 4);
    expect(CF().ratio).toBeCloseTo(COST_F, 4);
    expect(C4().aniso).toBeCloseTo(ANISO_4, 4);
    expect(CF().aniso).toBeCloseTo(ANISO_F, 4);

    expect(F10_CORR_AXIS().rendOverFree).toBeCloseTo(1549.3119, 3);
    expect(spanOf(SURF10().colourMm) / Math.abs(SURF10().fieldDropMm[0]![2]!)).toBeCloseTo(2.118607, 5);
  });

  it("and the registration cost cannot see the stage at all, which licenses § 6bl.4 retroactively", () => {
    // § 6bl.4 fitted 95.713, 41.776, 21.046 to 1/M with the first taken at an
    // AXIAL stage and the other two at CORRECTED stages. The memory of this
    // branch flags mixing stage conventions as the trap that bites; § 6bk pins
    // the free-field axial gain at 1.0177396 axial AND 1.01788 corrected, which
    // are different numbers off the same lens. Here it could not have mattered,
    // and the reason is structural rather than small: `mosaicSeamShiftMm` does no
    // render. A tile's geometry is a frame and an offset, and the focus stage
    // enters neither. Three stages a millimetre apart, bit for bit identical.
    const atAxial = cost(TEN, stage(AX10()));
    const atZero = cost(TEN, stage(0));
    const atElsewhere = cost(TEN, stage(0.05));
    expect(atZero.ratio).toBe(atAxial.ratio);
    expect(atElsewhere.ratio).toBe(atAxial.ratio);
    expect(atZero.aniso).toBe(atAxial.aniso);
    expect(atElsewhere.aniso).toBe(atAxial.aniso);
    // And it is § 6bk.6's number, which § 6bk took at the corrected stage.
    expect(atAxial.ratio).toBeCloseTo(COST_10, 4);
    expect(atAxial.aniso).toBeCloseTo(ANISO_10, 4);
  });
});

describe("§ 6bm.2 — the corner refuses, and the plateau square says the levers interact", () => {
  it("the fourth corner's sweep refuses as a plateau 1.4286 depths wide", () => {
    // A second refusing lens, and this one refuses at a magnification whose own
    // NA 0.10 sibling is the most comfortable lens on the ladder — 0.379 depths,
    // the narrowest of the four. So the refusal is the aperture's here, where
    // § 6bl.5's was magnification's at a fixed aperture.
    expect(() => renderedBestFocus(CORNER, 430, 0, SWEEP)).toThrow(/plateau/);
    expect(PC().plateauDepths).toBeCloseTo(1.4286062660796581, 6);
    expect(P10().plateauDepths).toBeCloseTo(0.37615334937848366, 6);
    expect(PC().plateauDepths).toBeGreaterThan(1);
    expect(P10().plateauDepths).toBeLessThan(1);
  });

  it("aperture costs 2.075 depths at 4× and 3.803 at 10× — an interaction of 1.2001", () => {
    // The square's headline. If the levers separated, doubling the aperture would
    // cost the same factor at both magnifications.
    const apertureAt4 = PF().plateauDepths / P4().plateauDepths;
    const apertureAt10 = PC().plateauDepths / P10().plateauDepths;
    expect(apertureAt4).toBeCloseTo(3.1647719564086656, 5);
    expect(apertureAt10).toBeCloseTo(3.7979357845414303, 6);
    expect(
      interact(P4().plateauDepths, PF().plateauDepths, P10().plateauDepths, PC().plateauDepths),
    ).toBeCloseTo(1.2000661775489407, 6);

    // The same quotient read down the other lever, which is an arithmetic
    // identity — and the point of pinning it is that a mistranscribed cell would
    // break the identity rather than quietly shift the interaction.
    const magAtSlow = P10().plateauDepths / P4().plateauDepths;
    const magAtFast = PC().plateauDepths / PF().plateauDepths;
    expect(magAtSlow).toBeCloseTo(0.44814637673622815, 6);
    expect(magAtFast).toBeCloseTo(0.5378053093122529, 6);
    expect(magAtFast / magAtSlow).toBeCloseTo(1.2000661775489407, 6);
    expect(magAtFast / magAtSlow).toBeCloseTo(apertureAt10 / apertureAt4, 12);
  });

  it("and the UNIT separates where the quantity measured in it does not", () => {
    // § 6bk.2 pinned λ/NA² as carrying no M: 1.00074× across the magnification
    // lever against 4.00819× across the aperture lever. That is a clean
    // separation, and this rung is why it does not descend to the response. The
    // depth of focus is the same number at both magnifications to 1e-3 at each
    // aperture; the plateau measured in it is 1.83× apart.
    expect(P10().depthOfFocusMm / P4().depthOfFocusMm).toBeCloseTo(0.99926, 5);
    expect(PC().depthOfFocusMm / PF().depthOfFocusMm).toBeCloseTo(0.9991633, 6);
    expect(
      interact(P4().depthOfFocusMm, PF().depthOfFocusMm, P10().depthOfFocusMm, PC().depthOfFocusMm),
    ).toBeCloseTo(1.0, 3);

    // In millimetres the interaction reads as a near-collapse: at 4× the aperture
    // nearly halves the physical plateau, and at 10× it buys 5%.
    expect(plateauMm(P10())).toBeCloseTo(0.016246495819687012, 8);
    expect(plateauMm(PC())).toBeCloseTo(0.015392778567479426, 8);
    expect(plateauMm(P4()) / plateauMm(PF())).toBeCloseTo(1.2665019324195521, 5);
    expect(plateauMm(P10()) / plateauMm(PC())).toBeCloseTo(1.0554621927720866, 6);
  });
});

describe("§ 6bm.3 — the plateau is the lens's, and three artefacts are ruled out", () => {
  it("halving the probe's own axial thickness moves it 0.025%", () => {
    // A plateau in an axial response is exactly the shape a source of finite
    // depth would make: a ball 16 µm thick cannot report a peak sharper than
    // itself, and the corner's plateau is 15.5 µm. That reading would make the
    // refusal an artefact of the fixture rather than a property of the lens, so
    // it is tested rather than argued. Half the axial waist and half the slab
    // span, and the plateau does not move.
    const slim = renderedBestFocus(CORNER, 430, 0, {
      ...OPEN,
      probe: SLIM,
      slabs: uniformSlabs(-0.004, 0.004, 3),
    });
    expect(slim.plateauDepths).toBeCloseTo(1.4273025689547785, 6);
    expect(Math.abs(slim.plateauDepths / PC().plateauDepths - 1)).toBeLessThan(1e-3);

    // And on the lens that does NOT refuse, so the insensitivity is not something
    // about sitting at the threshold.
    const slim10 = renderedBestFocus(TEN, 430, 0, {
      ...OPEN,
      probe: SLIM,
      slabs: uniformSlabs(-0.004, 0.004, 3),
    });
    expect(slim10.plateauDepths).toBeCloseTo(0.37606218547465564, 5);
    expect(Math.abs(slim10.plateauDepths / P10().plateauDepths - 1)).toBeLessThan(1e-3);
  });

  it("halving the sweep step moves it 0.25% (0.041% on the aim layout), so it is not the estimator's resolution", () => {
    // The other obvious floor: the plateau is about three sweep steps wide, so a
    // step-limited estimate would be the natural suspicion.
    const fine = renderedBestFocus(CORNER, 430, 0, { ...OPEN, stepMm: 0.0025 });
    expect(fine.plateauDepths).toBeCloseTo(1.4250020392033869, 6);
    expect(Math.abs(fine.plateauDepths / PC().plateauDepths - 1)).toBeCloseTo(0.002522897289371384, 9);
    expect(Math.abs(fine.plateauDepths / PC().plateauDepths - 1)).toBeLessThan(3e-3);
  });

  it("and doubling the rendered frame moves it nothing past rounding, at both apertures (bitwise on the aim layout)", () => {
    // The third candidate was this step's own first guess and it was wrong, which
    // is why it is pinned: defocused light leaving a fixed-pixel-count frame would
    // narrow the axial response, and a frame covers less of the slide the higher
    // the magnification, so "the plateau is the frame's" predicted exactly the
    // sign observed. It is not: four times the pixels reproduces the plateau to
    // the last digit, the readout being a peak and not a sum over the frame.
    const wide = renderedBestFocus(CORNER, 430, 0, { ...OPEN, size: 256 });
    const wide10 = renderedBestFocus(TEN, 430, 0, { ...OPEN, size: 256 });
    expect(Math.abs(wide.plateauDepths / PC().plateauDepths - 1)).toBeLessThan(1e-12);
    expect(Math.abs(wide10.plateauDepths / P10().plateauDepths - 1)).toBeLessThan(1e-12);
    // § 2r.2: the vertex is the same to 1e-14 rather than bitwise — 4.8e-16 mm
    // on the 10× — the exit layout's frame entering the arithmetic's rounding.
    expect(Math.abs(wide.focusMm / PC().focusMm - 1)).toBeLessThan(1e-13);
    expect(Math.abs(wide10.focusMm / P10().focusMm - 1)).toBeLessThan(1e-13);
  });
});

describe("§ 6bm.4 — six readouts, six interactions, and an ordering that spans two (fifty on the aim layout)", () => {
  it("no readout separates, and the two with no render in them are the two smallest", () => {
    // What the square is for. Every one of these would be 1 if the levers acted
    // independently, and none of them is. The ordering is stated as measured: the
    // two render-free readouts sit at the bottom, and the largest — the escape —
    // is 1.25× the next. § 2r.2: on the aim layout the flat field at the edge
    // was 53.6, thirty times the next largest; on the exit layout it is 1.49. That the two smallest are the two
    // computed off `mosaicSeamShiftMm` is CONSISTENT with the split being about
    // the traced map rather than the defocused light — it is NOT isolated by this
    // data, 1.106 against 1.134 being no gap at all, and six readouts across one
    // square give one number each and no functional form. No fit is made.
    const anisoI = interact(C4().aniso, CF().aniso, C10().aniso, CC().aniso);
    const costI = interact(C4().ratio, CF().ratio, C10().ratio, CC().ratio);
    const flatAxisI = interact(ROF_AXIS_4, ROF_AXIS_F, F10_AXIS().rendOverFree, FC_AXIS().rendOverFree);
    const escI = interact(E4(), EF(), E10(), EC());
    const plateauI = interact(
      P4().plateauDepths,
      PF().plateauDepths,
      P10().plateauDepths,
      PC().plateauDepths,
    );
    const flatEdgeI = interact(ROF_EDGE_4, ROF_EDGE_F, F10_EDGE().rendOverFree, FC_EDGE().rendOverFree);

    expect(departure(anisoI)).toBeCloseTo(1.0166451, 6);
    expect(departure(costI)).toBeCloseTo(1.1060587, 6);
    expect(departure(flatAxisI)).toBeCloseTo(1.6114490887542507, 6);
    expect(departure(escI)).toBeCloseTo(2.0073722492219583, 5);
    expect(departure(plateauI)).toBeCloseTo(1.2000661775489407, 6);
    expect(departure(flatEdgeI)).toBeCloseTo(1.4890385797106567, 5);

    // Not one of the six separates.
    for (const i of [anisoI, costI, flatAxisI, escI, plateauI, flatEdgeI]) {
      expect(departure(i)).toBeGreaterThan(1.01);
    }
    // The two render-free readouts are the two smallest of the six.
    const ordered = [anisoI, costI, flatAxisI, escI, plateauI, flatEdgeI]
      .map(departure)
      .sort((a, b) => a - b);
    expect(ordered[0]!).toBe(departure(anisoI));
    expect(ordered[1]!).toBe(departure(costI));
    expect(ordered[5]! / ordered[4]!).toBeCloseTo(1.245674469991672, 4);
  });

  it("the guard band's interaction: 11.94× of aperture at 4× becomes 20.09× at 10×", () => {
    // § 6bk.4 found the guard band to be the APERTURE's and the prediction
    // backwards — twice the aperture leaks MORE past a tile's own frame, where
    // λ/NA had predicted less. The finding survives at 10× and its SIZE does not:
    // the same doubling costs 68% more at the higher magnification.
    expect(E10()).toBeCloseTo(0.02486537942352507, 7);
    expect(EC()).toBeCloseTo(0.47581829689643174, 6);
    expect(EF() / E4()).toBeCloseTo(9.532748419625632, 4);
    expect(EC() / E10()).toBeCloseTo(19.135774636370975, 4);
    expect(EC() / E10()).toBeGreaterThan(EF() / E4());
    // And the sign of § 6bk.4's finding is the same on both — more, not less.
    expect(EF()).toBeGreaterThan(E4());
    expect(EC()).toBeGreaterThan(E10());
  });

  it("and § 6bk.5's sharpest sentence was a NA-0.10 sentence on the aim layout: 1.03× on the lever, 55.4× off it — 1.01× and 1.51× on the exit", () => {
    // § 6bk.5 pinned that magnification barely touches the rendered-versus-free
    // split — 1.136× across the 2.5×, against the aperture's thousandfold — and
    // concluded the split is a property of the aperture. On the aim layout the
    // fourth corner agreed on the AXIS — the aperture collapsed the split at
    // both magnifications, to 0.99933 and 0.99949 — and at the EDGE it did not:
    // magnification moved the edge split 1.032× at NA 0.10 and 55.38× at NA
    // 0.20, the largest reading in the square.
    //
    // § 2r.2 REVERSED. On the exit layout the aperture collapses the axial split
    // less at 10× than at 4× — to 3.80 against 1.86, 2.05× apart — and at the
    // edge magnification moves the split 1.011× at NA 0.10 and 1.505× at NA
    // 0.20: larger at the fast aperture still, by 1.49×, not by fifty.
    expect(F10_AXIS().rendOverFree).toBeCloseTo(1549.090016100403, 3);
    expect(FC_AXIS().rendOverFree).toBeCloseTo(3.7985279192641737, 7);
    expect(FC_AXIS().rendOverFree / ROF_AXIS_F).toBeCloseTo(2.045987007506605, 7);

    expect(F10_EDGE().rendOverFree).toBeCloseTo(1.1551247460749423, 7);
    expect(FC_EDGE().rendOverFree).toBeCloseTo(1.30209380712845, 7);
    expect(ROF_EDGE_4 / F10_EDGE().rendOverFree).toBeCloseTo(1.0107266651026825, 4);
    expect(ROF_EDGE_F / FC_EDGE().rendOverFree).toBeCloseTo(1.5050109978801869, 4);
    expect(ROF_EDGE_F / FC_EDGE().rendOverFree).toBeGreaterThan(
      1.4 * (ROF_EDGE_4 / F10_EDGE().rendOverFree),
    );
    expect(ROF_EDGE_F / FC_EDGE().rendOverFree).toBeLessThan(2);
  });
});

describe("§ 6bm.5 — § 6bl.4's residual is the aperture's, and the anisotropy is the cleanest cell", () => {
  it("the corner's registration cost is 64.16×, and 1/M falls short twice as far at NA 0.20", () => {
    // § 6bl.4 read 95.713, 41.776, 21.046 along the magnification lever at NA 0.10
    // and found them on 1/M "to within 10%", with an unexplained excess of about
    // 9% in the same direction at both steps. The aperture lever moves that
    // residual: on the SAME 4×→10× step the departure from exact 1/M is 8.36% at
    // NA 0.10 and 17.14% at NA 0.20. So § 6bl.4's budget — 95.7 over M, plus about
    // a tenth — is the slow lens's tenth, and a caller sizing a guard band on a
    // faster lens under-budgets it. This is ONE interval at each aperture and no
    // law at NA 0.20 is claimed: § 6bl fitted three points and this fits none.
    expect(CC().ratio).toBeCloseTo(64.157741, 4);
    const stepSlow = C4().ratio / C10().ratio;
    const stepFast = CF().ratio / CC().ratio;
    expect(stepSlow).toBeCloseTo(2.2911168, 6);
    expect(stepFast).toBeCloseTo(2.0714242, 6);
    expect(1 - stepSlow / 2.5).toBeCloseTo(0.08355329, 7);
    expect(1 - stepFast / 2.5).toBeCloseTo(0.17143031, 7);
    // Both fall short of 1/M in the same direction, as § 6bl.4 found on its lever.
    expect(stepSlow).toBeLessThan(2.5);
    expect(stepFast).toBeLessThan(2.5);
  });

  it("and § 6bj's structural finding still holds in all four cells — more across than along", () => {
    // The explanation § 6bj gave is about a square lattice meeting a radial map
    // and is not about the glass, so it should hold on any lens. A fourth lens
    // says it does.
    expect(CC().aniso).toBeCloseTo(33.290128, 5);
    for (const c of [C4(), CF(), C10(), CC()]) {
      expect(c.ratio).toBeGreaterThan(1);
      expect(c.aniso).toBeGreaterThan(1);
    }
    // The anisotropy is the cell that comes nearest to separating: the aperture
    // doubles it at both magnifications, 2.0063 and 1.9735, agreeing to 1.66%.
    // It is still not 1, which is why § 6bm.4 says none of the six separates.
    expect(CF().aniso / C4().aniso).toBeCloseTo(2.0063245, 6);
    expect(CC().aniso / C10().aniso).toBeCloseTo(1.9734758, 6);
  });
});

describe("§ 6bm.6 — the free field's axial crossing was between 4× and 10× on the aim layout; on the exit there is none", () => {
  it("the 10×'s corrected-stage gain is 1.0269 (0.97253 on the aim layout), so there is no crossing on the lever", () => {
    // § 6bl.6's open item. On the aim layout the free flat field's axial gain was
    // 1.01788 on the control and 0.972202 at 20× — one side of 1 and the other —
    // and the 10× read 0.97253, putting the crossing on the FIRST step. Below 1
    // means a calibration that makes the seam worse than leaving it alone.
    //
    // § 2r.2 REVERSED. On the exit layout the three read 1.00807, 1.02690 and
    // 1.02825: all above 1, rising with magnification. There is no crossing.
    expect(F10_CORR_AXIS().freeGain).toBeCloseTo(1.0269037176332898, 6);
    expect(FREE_AXIS_4).toBeGreaterThan(1);
    expect(F10_CORR_AXIS().freeGain).toBeGreaterThan(FREE_AXIS_4);
    expect(FREE_AXIS_20).toBeGreaterThan(F10_CORR_AXIS().freeGain);
    expect(FREE_AXIS_4 / F10_CORR_AXIS().freeGain).toBeCloseTo(0.9816597044982017, 6);
  });

  it("and the convention this comparison could have died on is worth 0.046%, measured on this lens", () => {
    // The trap. § 6bk pins the same readout on the same lens at 1.0080440 (axial
    // stage) and 1.0080720 (corrected) — different numbers — so a step quoted
    // across the two conventions would be a convention difference wearing a
    // physics result's clothes. Here both are measured on the 10× itself, and the
    // convention is worth 4.6e-4 against the 4×-to-10× step's 1.9e-2: 40×
    // smaller. (2.6e-4 against the aim layout's crossing of 4.7e-2.)
    expect(F10_AXIS().freeGain).toBeCloseTo(1.0264290835530367, 6);
    expect(F10_CORR_AXIS().freeGain / F10_AXIS().freeGain).toBeCloseTo(1.0004624581947248, 7);
    expect(F10_CORR_AXIS().freeGain / F10_AXIS().freeGain - 1).toBeLessThan(
      0.03 * (F10_CORR_AXIS().freeGain / FREE_AXIS_4 - 1),
    );
    // Above 1 in BOTH conventions, so the absence of a crossing does not depend
    // on the choice.
    expect(F10_AXIS().freeGain).toBeGreaterThan(1);
  });

  it("what is NOT claimed: that the series then flattens", () => {
    // 1.00807, 1.02690, 1.02825 invites "it steps up once and settles". The
    // 10×-to-20× gap is 1.3e-3, and this file's own measurement of the stage
    // convention on the 10× is 4.6e-4, while § 6bl's 20× surface was swept to
    // OUTER = 1.30 against the 1.25 used here — an unquantified third difference.
    // On the aim layout the gap sat inside twice the convention; on the exit it
    // is 2.8 times it, and still a two-point trend beside an unquantified
    // difference — so the agreement is pinned as a reading and nothing is
    // inferred from it.
    expect(F10_CORR_AXIS().freeGain / FREE_AXIS_20).toBeCloseTo(0.998694590237443, 7);
    expect(
      Math.abs(F10_CORR_AXIS().freeGain / FREE_AXIS_20 - 1) /
        Math.abs(F10_CORR_AXIS().freeGain / F10_AXIS().freeGain - 1),
    ).toBeCloseTo(2.8230390567997667, 3);
  });

  it("the aperture's role-swap was the CONTROL's on the aim layout, and does not appear at 10×", () => {
    // § 6bk.5's most quotable consequence, on the aim layout: on the control a
    // free flat field was worth nothing on the axis and 189× at the edge, and at
    // twice the aperture that was exactly backwards — each lens useless where the
    // other is best, over 100× in both directions. At 10× there was no such
    // crossing: the fast lens helped everywhere, 281× on the axis and 18.5× at
    // the edge. § 2r.2: on the exit layout the swap is gone at 4× too (§ 6bk.5),
    // and the fast 10× helps 1.9× on the axis and 7.8× at the edge — everywhere
    // still, and only its margin varies.
    expect(FC_AXIS().freeGain).toBeCloseTo(1.9032168307228594, 4);
    expect(FC_EDGE().freeGain).toBeCloseTo(7.770089025349636, 5);
    expect(F10_EDGE().freeGain).toBeCloseTo(167.5246883388385, 4);
    expect(FC_AXIS().freeGain / FC_EDGE().freeGain).toBeCloseTo(0.24494144462356648, 5);
    expect(FC_AXIS().freeGain / FC_EDGE().freeGain).toBeLessThan(100);
    // Where the slow 10×'s own ratio, § 6bk.5's shape, clears 100.
    expect(F10_EDGE().freeGain / F10_AXIS().freeGain).toBeGreaterThan(100);
  });

  it("and a scanner's own flat field is never once better, on a fourth lens either", () => {
    // § 6bi's finding and § 6bj's reason for it — a repeating per-tile frame is
    // right for a stage scan and wrong for a field scan — is about the geometry
    // and not the glass. § 6bk had eight measurements over three lenses and § 6bl
    // added two; these five make fifteen, and none is below 1 or above § 6bk.6's
    // 1.2090451 ceiling.
    for (const f of [F10_AXIS(), F10_EDGE(), FC_AXIS(), FC_EDGE(), F10_CORR_AXIS()]) {
      expect(f.scannerVsRaw).toBeGreaterThanOrEqual(1);
      expect(f.scannerVsRaw).toBeLessThanOrEqual(1.17607893);
    }
    expect(F10_AXIS().scannerVsRaw).toBeCloseTo(1.1730417537636648, 6);
    expect(FC_AXIS().scannerVsRaw).toBeCloseTo(1.0026410635249727, 6);
    expect(FC_EDGE().scannerVsRaw).toBeCloseTo(1.118208923602248, 6);
  });
});

describe("§ 6bm.7 — the refusal, and the signature that justified it did not travel", () => {
  it("§ 6bk.8's aperture ceiling still binds, and the corner is under it", () => {
    expect(() => build(10, 0.25)).toThrow(/APERTURE and not the glass pair/);
    expect(() => build(10, 0.2)).not.toThrow();
  });

  it("the corner's vertex is threshold-invariant, which is what makes an axial stage available", () => {
    // § 6bk.8 pins this for the fast 4×; it is re-pinned here rather than
    // inherited, because every stage in this file's squares is obtained this way
    // and the corner is a different lens and a different refusal.
    expect(AXC()).toBeCloseTo(0.06585077511240124, 7);
    expect(renderedBestFocus(CORNER, 430, 0, { ...OPEN, maxPlateauDepths: 2 }).focusMm).toBe(AXC());
  });

  it("forced through, the corner shows no sign flip — so the refusal rests on its own evidence", () => {
    // The uncomfortable half, and it belongs in the file. § 6bk.8 justified NOT
    // simply raising the threshold for the fast 4× by showing what came through
    // it: a field drop that changed SIGN between two measured heights, which is
    // not a field curve. The corner does not do that — its drops are monotone and
    // negative at every height. What it does instead is put § 6be's interaction
    // term, which is meant to be the estimator's noise, at 1.008× the field drop
    // it is supposed to be noise on, where § 6bl.1's 20× reads 0.152×. So the
    // refusal is well founded on BOTH lenses and by DIFFERENT signatures, and no
    // number is read off this surface — it exists to characterise the refusal,
    // not to measure the lens.
    const forced = focusSurface(CORNER, {
      ...SWEEP,
      maxPlateauDepths: 2,
      wavelengthsNm: [430, DESIGN, RED],
      objectHeightsMm: [0, HC / 2, HC, 1.3 * HC],
    });
    const drops = forced.fieldDropMm[0]!;
    expect(drops[0]).toBe(0);
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i]!).toBeLessThan(0);
      expect(drops[i]!).toBeLessThan(drops[i - 1]!);
    }
    const fieldTerm = Math.abs(drops[2]!);
    // § 2r.2: on the aim layout this was 1.008× and § 6bl.1's 20× read 0.152×;
    // on the exit layout 0.213× against the 20×'s 0.0386×, 5.5 times it. And
    // the fast 4×'s forced surface no longer flips sign either (§ 6bk.8): it
    // reads 0.248×, this corner's signature — so on this layout the two lenses
    // refuse with the SAME signature, not different ones.
    expect(forced.interactionMm / fieldTerm).toBeCloseTo(0.21285770072799923, 6);
    expect(forced.interactionMm / fieldTerm).toBeGreaterThan(5 * (4.919968e-4 / 1.273534e-2));
  });
});
