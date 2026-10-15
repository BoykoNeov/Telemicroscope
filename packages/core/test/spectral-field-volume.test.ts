import { describe, it, expect } from "vitest";
import {
  formVolumePlane,
  fluorescenceSpectralVolume,
  neutralVolumeEmitterDensity,
  type FluorescenceVolumeOptions,
} from "../src/imaging/spectral-volume";
import {
  depthRescale,
  gaussianBallEmitter,
  rasterizeEmitterVolume,
  slabEmitter,
  uniformSlabs,
} from "../src/imaging/emitter-volume";
import { gaussianEmitter } from "../src/imaging/emitter-density";
import { pupilThroughput } from "../src/imaging/fluorescence";
import { radialMapCovering } from "../src/imaging/radial-map";
import { defocusing, renderVolume } from "../src/imaging/volume";
import {
  renderedBestFocus,
  type FocusProbe,
  type FocusSweepOptions,
} from "../src/imaging/focus-surface";
import { fieldDefocusing, renderFieldVolume } from "../src/imaging/field-volume";
import { idealPupil } from "../src/illumination/transfer";
import {
  fieldPupilAt,
  imageRadiusForObjectHeight,
  objectHeightForImageRadius,
  objectFieldTile,
} from "../src/imaging/object-field";
import { getMedium } from "../src/materials/catalog";
import { objectNumericalAperture } from "../src/pupil/microscope";
import { quadratureSamples } from "../src/photometry/spectrum";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import { bandLimitedPeak } from "../src/math/band-limited-peak";

/**
 * § 6be — the third axis: a field and a depth and a wavelength at once.
 *
 * § 6bb runs a spectrum through a depth stack, § 6bd runs a field through one,
 * and each closed naming the other's axis as the piece it did not have. This is
 * the join, and the wiring is the smallest part of it: `renderFieldVolume`
 * already images a volume through a field-varying pupil, so the spectral driver
 * simply runs on it, and § 6be.1 pins that at one patch the swap is **bitwise**
 * — so every § 6bb pin above stands untouched and the third axis costs nothing
 * until it is asked for.
 *
 * What the third axis is *for* is not what the deferral expected, and the
 * headline is a near **separation** rather than a coupling.
 *
 * **The best-focus surface nearly separates into a colour curve plus a field
 * curve.** A stack is rendered at one stage position, so where a channel is sharp
 * depends on its wavelength (§ 6bb.6) and, it turns out, about half as much again
 * on where in the field it is looking. The two together add little: the
 * interaction between them is 0.002 of a depth of focus at h = 0.4 and 0.11 to
 * 0.14 at h = 0.8 and 1.1 — 2.4% of the total spread at most. § 6be.2 places that
 * remainder: a second aperture starts cutting the outward side of the pupil
 * between image radius 2.00 and 2.25 mm, and the one height inside that radius is
 * the one with no interaction. (How a cut couples colour to field is not yet
 * separated; the likely route is that a cut pupil drops zones whose aberration
 * differs most in the blue, which § 6bb.6 already reads as the farthest from
 * focus.) The consequence is a
 * design one: a focus correction wants two one-dimensional curves first, with the
 * clip's coupling a correction on top rather than a reason for a 2-D map.
 * (Restated at § 2q.3: point-sampled, the interaction read a flat 0.0012 mm that
 * changed sign, and § 6be called it the estimator's floor. That floor was the rim
 * staircase's; resolved, it is ~1e-4 mm.)
 *
 * **The field term is even, which is why § 6bb.6 could not have seen it.** It
 * goes as h², so its gradient vanishes on the axis exactly and § 6bb.6 measured
 * the focus at the one field position at which the field term is flat. § 6be.4
 * pins the evenness the way it has to be pinned — the drop divided by h² is
 * constant to 6% across a range over which the drop divided by h moves 1.29× to
 * 1.44× — and that is the **third** time the ladder has read an even quantity at
 * its own symmetry point, after § 6bc's throughput profile and § 6bd's repair of
 * it.
 *
 * **The estimator has a zero off the axis**, and § 6be.5 is the rung that makes
 * the field term the objective's: `rasterizeEmitterVolume` runs on a radial map
 * and a depth rescale which are *both* field-dependent, so a best focus that
 * moved with height could have belonged to either. An aberration-free pupil
 * returns −2.8e-7 mm at every height alike, to 3.9e-9 mm.
 *
 * **And the amplitude half follows the clip.** § 6be.6 measures the field profile
 * of what the pupil transmits, normalized to each frame's own centre: inside the
 * clip it is the same at every wavelength to 1.7e-7 on every lattice; past it the
 * clip's rim sits at a slightly different pupil radius in each colour, and the
 * profile is 0.16% to 0.23% chromatic — again on every lattice, so it is the
 * optics' and not a sampling floor. (Point-sampled, the rim's colour shift was
 * far below one lattice step and read as nothing; § 6be called the amplitude
 * half a null.)
 *
 * The external numbers are § 6bb.6's own rendered focus sweep, reproduced here
 * to within 1.8e-4 mm before being taken off axis (§ 6be.3), and § 6h.2's closed form
 * for the frame extent, which is ∝ λ exactly and is why patch `p` is a different
 * field point in every channel (§ 6be.8).
 */

/** § 6bb's own probe, unchanged: the DIN 4×/0.10. */
const OBJECTIVE = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({ objective: OBJECTIVE }).system;

const DESIGN = 587.5618;
const RED = 656.2725;

const SIZE = 64;
const PS = 32;

/** § 6bb.6's sweep grid: the configuration whose numbers this step extends. */
const FOCUS_SIZE = 128;
const FOCUS_PS = 48;
/** § 2q.3's resolved rim, on every render here. */
const EDGE = 8;

/**
 * A slab whose lateral Gaussian sits at the tile's OWN object centre.
 *
 * Centred on the axis it would fall entirely outside an off-axis tile, and the
 * bitwise rungs below would then be comparing two grids of zeros — which they
 * did, until the sibling rung that asserts patching changes the picture
 * reported no change and said so.
 */
const hazeAt = (centreMm: { x: number; y: number }) => {
  const height = objectHeightForImageRadius(SYSTEM, Math.hypot(centreMm.x, centreMm.y), DESIGN);
  return slabEmitter({
    lateral: gaussianEmitter({ waistMm: 0.012, peak: 1, centreMm: { x: height, y: 0 } }),
    fromMm: -0.02,
    toMm: 0.02,
  });
};
const HAZE = hazeAt({ x: 0, y: 0 });

const SAMPLES = quadratureSamples({ fromNm: 430, toNm: 680, count: 5 });

const nAt = (nm: number) => getMedium(SYSTEM.prescription.objectMedium ?? "AIR").n(nm);

const driverOptions = (centreMm: { x: number; y: number }): FluorescenceVolumeOptions => ({
  size: SIZE,
  pupilSamples: PS,
  edgeSamples: EDGE,
  samples: SAMPLES,
  slabs: uniformSlabs(-0.02, 0.02, 3),
  centreMm,
});

// ---------------------------------------------------------------------------
// § 6bb.6's estimator, taken off the axis.
//
// The specimen, the slab count, the sweep and the parabola are § 6bb.6's; the
// only thing added is that the tile — and the ball inside it — may sit at an
// object height other than zero. The ball is placed at the tile's own
// `centreObjectMm`, so every wavelength looks at the SAME specimen point even
// though lateral colour puts that point at a different image radius in each.
// ---------------------------------------------------------------------------

function tileAtHeight(nm: number, objectHeightMm: number) {
  return objectFieldTile(SYSTEM, {
    size: FOCUS_SIZE,
    pupilSamples: FOCUS_PS,
    wavelengthNm: nm,
    centreMm: { x: imageRadiusForObjectHeight(SYSTEM, objectHeightMm, nm), y: 0 },
  });
}

/**
 * The ABERRATION-FREE control's peak — § 6be.5's estimator zero, and the only
 * sweep this file still writes out.
 *
 * The traced sweep beside it moved into `imaging/focus-surface` at § 6bf and is
 * called through `renderedBestFocus` below, so every figure in this file is
 * now the shipped readout's output rather than a second construction that
 * resembles it. § 6bf.1 pins the two identical, bitwise, before the swap.
 */
function idealPeakAt(nm: number, objectHeightMm: number, focusMm: number): number {
  const frame = tileAtHeight(nm, objectHeightMm);
  const ball = gaussianBallEmitter({
    waistMm: 0.005,
    axialWaistMm: 0.004,
    peak: 1,
    centreMm: { x: frame.centreObjectMm.x, y: frame.centreObjectMm.y, z: 0 },
  });
  const volume = rasterizeEmitterVolume(frame, ball, {
    radialMap: radialMapCovering(SYSTEM, [frame], { nodes: 128 }),
    rescale: depthRescale(SYSTEM, nm),
    slabs: uniformSlabs(-0.008, 0.008, 3),
    focusMm,
  });
  const { intensity } = renderVolume(volume, defocusing(idealPupil()), {
    pupilSamples: FOCUS_PS,
    edgeSamples: EDGE,
    numericalAperture: objectNumericalAperture(SYSTEM, nm),
    wavelengthNm: nm,
    refractiveIndex: 1,
    scale: frame.scale,
  });
  return bandLimitedPeak(intensity, FOCUS_SIZE).value;
}

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/**
 * The sweep § 6bf moved into source, configured as this file always ran it.
 *
 * `maxPlateauDepths` is set loose deliberately: this file pins focus POSITIONS,
 * and where the refusal bites is § 6bf.5's quantity, measured there against the
 * 2× whose axial response actually flattens. The 4×'s worst sample here reads
 * 0.90 of a depth of focus.
 */
const SWEEP: Omit<FocusSweepOptions, "stepMm" | "halfMm"> = {
  size: FOCUS_SIZE,
  pupilSamples: FOCUS_PS,
  edgeSamples: EDGE,
  peak: "band-limited",
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  maxPlateauDepths: 2,
};

/**
 * The stage position that maximizes the peak, § 6bb.6's parabola.
 *
 * `about` opens the bracket and does not choose the answer: `interior` reports
 * whether the maximum was found strictly inside the swept window, and every
 * rung below asserts it. A bracket that had contained no peak would fail there
 * rather than return its own edge.
 *
 * Since § 6bf the traced branch is `renderedBestFocus` — the same arithmetic,
 * pinned bitwise by § 6bf.1, so every number below is unmoved by the move. The
 * aberration-free branch stays written out because the readout renders through
 * `formVolumePlane` and § 6be.5's control deliberately does not.
 */
function bestFocus(
  nm: number,
  objectHeightMm: number,
  about: number,
  step: number,
  half: number,
  ideal = false,
): { mm: number; interior: boolean } {
  if (!ideal) {
    const point = renderedBestFocus(SYSTEM, nm, objectHeightMm, {
      ...SWEEP,
      stepMm: step,
      halfMm: half,
      aboutMm: about,
    });
    return { mm: point.focusMm, interior: point.interior };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const n = Math.round(half / step);
  for (let i = -n; i <= n; i++) {
    const focusMm = about + i * step;
    xs.push(focusMm);
    ys.push(idealPeakAt(nm, objectHeightMm, focusMm));
  }
  let best = 1;
  for (let i = 1; i < ys.length - 1; i++) if (ys[i]! > ys[best]!) best = i;
  const y0 = ys[best - 1]!;
  const y1 = ys[best]!;
  const y2 = ys[best + 1]!;
  return {
    mm: xs[best]! + ((0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2)) * step,
    interior: best > 1 && best < ys.length - 2,
  };
}

const HEIGHTS = [0, 0.4, 0.8, 1.1] as const;
const FOCUS_LAMBDAS = [430, DESIGN, RED] as const;

/** The brackets, from a coarse pass — see `bestFocus` on why these are inputs. */
const BRACKET: Record<string, number> = {
  "430|0": 0.2136,
  "430|0.4": 0.2017,
  "430|0.8": 0.1698,
  "430|1.1": 0.132,
  [DESIGN + "|0"]: 0.0469,
  [DESIGN + "|0.4"]: 0.0361,
  [DESIGN + "|0.8"]: 0.0016,
  [DESIGN + "|1.1"]: -0.0367,
  [RED + "|0"]: 0.0672,
  [RED + "|0.4"]: 0.056,
  [RED + "|0.8"]: 0.0214,
  [RED + "|1.1"]: -0.0144,
};

/** Computed once: the whole (wavelength × field) best-focus surface. */
const SURFACE: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const nm of FOCUS_LAMBDAS) {
    for (const h of HEIGHTS) {
      const key = nm + "|" + h;
      const r = bestFocus(nm, h, BRACKET[key]!, 0.005, 0.03);
      expect(r.interior).toBe(true);
      out[key] = r.mm;
    }
  }
  return out;
})();

const at = (nm: number, h: number): number => SURFACE[nm + "|" + h]!;
/** How far this wavelength's best focus has moved by object height `h`. */
const drop = (nm: number, h: number): number => at(nm, h) - at(nm, 0);

const NA430 = objectNumericalAperture(SYSTEM, 430);
/** § 6k's depth of focus is half a wave across the FULL range — twice the half. */
const DOF430 = (430 * 1e-6) / (NA430 * NA430);

describe("§ 6be — the third axis", () => {
  describe("§ 6be.1 — the spectral driver on the field renderer is the old one, bitwise", () => {
    it("at every wavelength and at two field radii, in pixels and in every readout", () => {
      for (const centre of [
        { x: 0, y: 0 },
        { x: 4.5, y: 0 },
      ]) {
        const options = driverOptions(centre);
        for (const sample of SAMPLES) {
          // The driver, which since § 6be runs on `renderFieldVolume`.
          const plane = formVolumePlane(
            SYSTEM,
            neutralVolumeEmitterDensity(hazeAt(centre)),
            options,
            sample,
            centre,
          );
          // § 6bb's expression, written out: ONE pupil, `renderVolume`.
          const control = renderVolume(
            plane.volume,
            defocusing(fieldPupilAt(SYSTEM, plane.frame, 0.5, 0.5, options).pupil),
            {
              pupilSamples: PS,
              edgeSamples: EDGE,
              numericalAperture: plane.numericalAperture,
              wavelengthNm: sample.nm,
              refractiveIndex: nAt(sample.nm),
              scale: plane.frame.scale,
            },
          );

          let diff = 0;
          for (let i = 0; i < control.intensity.length; i++) {
            expect(Object.is(plane.image.intensity[i], control.intensity[i])).toBe(true);
            diff = Math.max(diff, Math.abs(plane.image.intensity[i]! - control.intensity[i]!));
          }
          expect(diff).toBe(0);

          // Not just the pixels: the flux bookkeeping and the grid guard too,
          // since those are what § 6bb.11 and § 6bb.12 read.
          expect(plane.image.sliceFlux.length).toBe(control.sliceFlux.length);
          for (let s = 0; s < control.sliceFlux.length; s++) {
            expect(Object.is(plane.image.sliceFlux[s], control.sliceFlux[s])).toBe(true);
          }
          expect(Object.is(plane.image.inFocusFraction, control.inFocusFraction)).toBe(true);
          expect(
            Object.is(plane.image.maxGridPhaseStepWaves, control.maxGridPhaseStepWaves),
          ).toBe(true);
          expect(plane.image.patches).toBe(1);
          expect(plane.image.patchThroughput).toHaveLength(1);
        }
      }
    });

    it("and asking for patches actually changes the picture", () => {
      const centre = { x: 4.5, y: 0 };
      const one = formVolumePlane(
        SYSTEM,
        neutralVolumeEmitterDensity(hazeAt(centre)),
        driverOptions(centre),
        SAMPLES[0]!,
        centre,
      );
      const many = formVolumePlane(
        SYSTEM,
        neutralVolumeEmitterDensity(hazeAt(centre)),
        { ...driverOptions(centre), patches: 3 },
        SAMPLES[0]!,
        centre,
      );
      expect(many.image.patches).toBe(3);
      expect(many.image.patchThroughput).toHaveLength(9);
      let diff = 0;
      for (let i = 0; i < one.image.intensity.length; i++) {
        diff = Math.max(diff, Math.abs(one.image.intensity[i]! - many.image.intensity[i]!));
      }
      expect(diff).toBeGreaterThan(0);
    });

    it("the whole driver carries the patch count and the profile onto every plane", () => {
      const volume = fluorescenceSpectralVolume(
        SYSTEM,
        neutralVolumeEmitterDensity(hazeAt({ x: 4.5, y: 0 })),
        { ...driverOptions({ x: 4.5, y: 0 }), patches: 2 },
      );
      expect(volume.planes).toHaveLength(SAMPLES.length);
      for (const plane of volume.planes) {
        expect(plane.patches).toBe(2);
        expect(plane.patchThroughput).toHaveLength(4);
        for (const t of plane.patchThroughput) expect(t).toBeGreaterThan(0);
      }
    });

    it("refuses a patch count that is not a positive integer", () => {
      const centre = { x: 0, y: 0 };
      expect(() =>
        formVolumePlane(
          SYSTEM,
          neutralVolumeEmitterDensity(hazeAt(centre)),
          { ...driverOptions(centre), patches: 0 },
          SAMPLES[0]!,
          centre,
        ),
      ).toThrow(/positive integer/);
      expect(() =>
        formVolumePlane(
          SYSTEM,
          neutralVolumeEmitterDensity(hazeAt(centre)),
          { ...driverOptions(centre), patches: 2.5 },
          SAMPLES[0]!,
          centre,
        ),
      ).toThrow(/positive integer/);
    });
  });

  describe("§ 6be.2 — the best-focus surface NEARLY separates: the coupling is a clip's", () => {
    it("0.002 of a depth of focus inside the clip, 0.11 to 0.14 past it", () => {
      // The interaction on the widest colour interval in the set, at each height.
      const interaction = (h: number) => drop(430, h) - drop(DESIGN, h);
      // Resolved (§ 2q.3). Point-sampled these read -1.231174e-3, 1.136270e-3
      // and 7.506299e-4 — a flat 0.0012 mm that changed sign, which § 6be read
      // as the estimator's floor. That floor was the rim staircase's: resolved,
      // h = 0.4 reads 8.7e-5 here and -3.0e-5 at 56 samples, so the floor is
      // ~1e-4, and the two outer heights stand fifty times above it.
      expect(interaction(0.4)).toBeCloseTo(8.747570e-5, 7);
      expect(interaction(0.8)).toBeCloseTo(5.929590e-3, 7);
      expect(interaction(1.1)).toBeCloseTo(4.731926e-3, 7);

      expect(Math.abs(interaction(0.4))).toBeLessThan(1e-4);
      expect(Math.abs(interaction(0.4)) / DOF430).toBeLessThan(0.003);
      for (const h of [0.8, 1.1]) {
        expect(interaction(h)).toBeGreaterThan(4e-3);
        expect(interaction(h) / DOF430).toBeGreaterThan(0.1);
        expect(interaction(h) / DOF430).toBeLessThan(0.14);
      }
      // Still small against what it couples: 2.4% of § 6be.3's spread and 7.2%
      // of the field term, so two curves remain the right first description —
      // but the remainder is a coupling now, and no longer a floor.
      const largest = Math.max(interaction(0.8), interaction(1.1));
      expect(largest / Math.abs(drop(DESIGN, 1.1))).toBeLessThan(0.075);
    });

    it("the clip begins between image radius 2.00 and 2.25 mm — h = 0.4 inside, 0.8 and 1.1 past", () => {
      // Where the three heights land in the image.
      expect(imageRadiusForObjectHeight(SYSTEM, 0.4, DESIGN)).toBeCloseTo(1.6004631, 6);
      expect(imageRadiusForObjectHeight(SYSTEM, 0.8, DESIGN)).toBeCloseTo(3.2037075, 6);
      expect(imageRadiusForObjectHeight(SYSTEM, 1.1, DESIGN)).toBeCloseTo(4.4096462, 6);

      // The pupil's outward rim, just inside the stop: whole at 2.00 mm, cut at
      // 2.25 mm, at every wavelength. The inward and sideways rims stay whole,
      // so it is a second aperture vignetting one side, not the stop shrinking.
      const pupilAtRadius = (nm: number, r: number) =>
        fieldPupilAt(
          SYSTEM,
          objectFieldTile(SYSTEM, {
            size: 128,
            pupilSamples: FOCUS_PS,
            wavelengthNm: nm,
            centreMm: { x: r, y: 0 },
          }),
          0.5,
          0.5,
        ).pupil;
      for (const nm of [430, 480, 530, DESIGN, RED]) {
        const inside = pupilAtRadius(nm, 2.0);
        const past = pupilAtRadius(nm, 2.25);
        expect(inside.amplitude(0.995, 0)).toBeGreaterThan(0.9);
        expect(past.amplitude(0.995, 0)).toBe(0);
        expect(past.amplitude(-0.995, 0)).toBeGreaterThan(0.9);
        expect(past.amplitude(0, 0.995)).toBeGreaterThan(0.9);
      }
      // The one height inside it is the one with no interaction; § 6be.6 reads
      // the same onset in what the pupil transmits.
    });
  });

  describe("§ 6be.3 — and the field adds half as much again to § 6bb.6's spread", () => {
    it("0.244113 mm over the square — 5.648 depths of focus at 430 against 3.7709 on axis", () => {
      // § 6bb.6's own measurement, reproduced by this file's estimator before it
      // is taken anywhere new: within 1.8e-4 mm of its 0.209851, 0.047701 and
      // 0.067900 on the axis. Resolved (§ 2q.3); point-sampled these read
      // 0.21400556, 0.04709541 and 0.06736525, up to 3.8e-4 from § 6bb.6's.
      expect(at(430, 0)).toBeCloseTo(0.20977356, 7);
      expect(at(DESIGN, 0)).toBeCloseTo(0.04787834, 7);
      expect(at(RED, 0)).toBeCloseTo(0.06802565, 7);

      // Point-sampled 0.25022903 and 5.78924; 5.65380 resolved at 56 samples.
      const values = FOCUS_LAMBDAS.flatMap((nm) => HEIGHTS.map((h) => at(nm, h)));
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread).toBeCloseTo(0.24411313, 7);
      expect(DOF430).toBeCloseTo(4.322314e-2, 7);
      expect(spread / DOF430).toBeCloseTo(5.647742, 4);

      // The extremes are the blue ON AXIS and the design wavelength at the EDGE
      // — one corner from each axis, which is what a separable surface does.
      expect(Math.max(...values)).toBe(at(430, 0));
      expect(Math.min(...values)).toBe(at(DESIGN, 1.1));

      // Decomposed: § 6bb.6's colour term is the larger, and the field term is
      // half as much again on top of it rather than a correction to it.
      const colour = at(430, 0) - at(DESIGN, 0);
      const field = Math.abs(drop(DESIGN, 1.1));
      // Point-sampled 0.16691015, 0.08331889 and 0.499184.
      expect(colour).toBeCloseTo(0.16189522, 7);
      expect(field).toBeCloseTo(0.08221791, 7);
      expect(colour + field).toBeCloseTo(spread, 12);
      expect(field / colour).toBeCloseTo(0.507846, 5);
      // § 6bb.6 reads 3.7709 of them on the axis (3.8775 point-sampled); the
      // square holds 5.648.
      expect(spread / DOF430 / 3.7709).toBeCloseTo(1.497717, 4);
    });
  });

  describe("§ 6be.4 — the field term is EVEN in field height, so the axis is its flat spot", () => {
    it("the drop over h² is constant where the drop over h moves 1.29× to 1.44×", () => {
      // Direction-independent, so the answer does not depend on which of the two
      // heights is written on top.
      const departure = (a: number, b: number) =>
        Math.max(Math.abs(a), Math.abs(b)) / Math.min(Math.abs(a), Math.abs(b)) - 1;

      for (const nm of FOCUS_LAMBDAS) {
        const quad = (h: number) => drop(nm, h) / (h * h);
        const lin = (h: number) => drop(nm, h) / h;
        // Read at the two largest heights, where the shift is largest against
        // the ~1e-4 mm floor (§ 6be.2). Both sit past § 6be.2's clip, so the
        // shape read here carries its coupling too — which is why the quadratic
        // reading departs from constant by up to 6% and not by the floor's
        // fraction of a percent.
        const asQuadratic = departure(quad(0.8), quad(1.1));
        const asLinear = departure(lin(0.8), lin(1.1));
        expect(asQuadratic).toBeLessThan(0.07);
        expect(asLinear).toBeGreaterThan(0.29);
        // The quadratic reading is at least four times the more constant — 9.26×
        // at 430 nm, 9.09× at the design wavelength and 4.76× at 656 (34.6×,
        // 12.5× and 4.63× point-sampled).
        expect(asLinear / asQuadratic).toBeGreaterThan(4);
      }

      // One curve for every wavelength: the h² coefficient at the field edge.
      // Resolved (§ 2q.3); point-sampled -0.06823823, -0.06885859, -0.06728941.
      expect(drop(430, 1.1) / 1.21).toBeCloseTo(-0.06403801, 7);
      expect(drop(DESIGN, 1.1) / 1.21).toBeCloseTo(-0.06794869, 7);
      expect(drop(RED, 1.1) / 1.21).toBeCloseTo(-0.06649446, 7);
      const coeffs = FOCUS_LAMBDAS.map((nm) => Math.abs(drop(nm, 1.1) / 1.21));
      // One curve for all three to 6.1% (5.7% at 56 samples) — and that is
      // § 6be.2's coupling, the blue's field term running 6% short of the
      // design wavelength's. Point-sampled it read 2.3%, which § 6be called the
      // floor; it was the staircase's.
      expect(Math.max(...coeffs) / Math.min(...coeffs) - 1).toBeCloseTo(0.061068, 5);
    });
  });

  describe("§ 6be.5 — the estimator's own zero, OFF the axis", () => {
    it("an aberration-free pupil focuses at 0 at every object height alike", () => {
      // The rasterizer's radial map and depth rescale are BOTH field-dependent,
      // so without this rung the field term above could have belonged to either
      // of them rather than to the objective. With no aberration anywhere the
      // answer must not move with height, and it does not.
      // 0, 0.8 and 1.1 — h = 0.4 is dropped for cost and not for trouble: the
      // control is flat in height by construction, so three points spanning the
      // range say what four would and the sweep is the expensive part.
      const ideal = HEIGHTS.filter((h) => h !== 0.4).map(
        (h) => bestFocus(430, h, 0, 0.02, 0.06, true).mm,
      );
      for (const v of ideal) expect(Math.abs(v)).toBeLessThan(1e-6);
      // Resolved (§ 2q.3); point-sampled -2.78226e-7 and -2.80341e-7.
      expect(ideal[0]!).toBeCloseTo(-2.75470e-7, 11);
      expect(ideal[2]!).toBeCloseTo(-2.79347e-7, 11);
      // 1.41% across the heights, against 0.76% point-sampled and a bound of 1%
      // set on that. Restated, not loosened: it reads 0.0140760 here and
      // 0.0140763 at 56 samples, so it is the band-limited readout's own
      // systematic and not noise — and as a distance it is 3.9e-9 mm, against
      // the 0.13 mm the traced pupil moves the same focus by.
      const spread = Math.max(...ideal.map(Math.abs)) / Math.min(...ideal.map(Math.abs)) - 1;
      expect(spread).toBeCloseTo(0.014076, 5);
      expect(Math.max(...ideal) - Math.min(...ideal)).toBeLessThan(4e-9);
      // Against the 0.13–0.21 mm the traced pupil puts there.
      expect(Math.abs(at(430, 1.1))).toBeGreaterThan(0.13);
    });
  });

  describe("§ 6be.6 — the amplitude half: achromatic inside the clip, 0.2% chromatic past it", () => {
    it("1.7e-7 across the band out to 2 mm, 0.16–0.23% past 2.25 mm, on every lattice", () => {
      const lambdas = [430, 480, 530, DESIGN, RED];
      const shadingAt = (ps: number, rs: readonly number[]) => {
        const profiles = lambdas.map((nm) => {
          const axis = throughput(nm, 0, ps);
          return rs.map((r) => throughput(nm, r, ps) / axis);
        });
        return rs.map((_, i) => {
          const col = profiles.map((p) => p[i]!);
          return Math.max(...col) / Math.min(...col) - 1;
        });
      };

      // Resolved (§ 2q.3). Point-sampled, every radius out to 4 mm read under
      // 5.3e-7 and 4.5 mm read 4.8e-3 → 1.2e-3, falling 4.05× as the lattice
      // doubled, which § 6be took for quantization. The resolved rim says the
      // opposite on both counts: a clip's rim moves with colour by far less
      // than one lattice step, so point sampling cut every colour at the same
      // sample and read no difference at 3 and 4 mm; and 4.5 mm does not fall.
      const radii = [0, 1, 2, 2.25, 3, 4, 4.5];
      const lattices = [24, 32, 48];
      const table = lattices.map((ps) => shadingAt(ps, radii));
      const read = (row: readonly number[], r: number) => row[radii.indexOf(r)]!;

      for (const row of table) {
        // Inside the clip: achromatic to 1.7e-7, the same on every lattice.
        for (const r of [0, 1, 2]) expect(read(row, r)).toBeLessThan(1.7e-7);
        // The onset § 6be.2 reads in the pupil's rim, read here in what it
        // transmits: under 1e-6 at 2.00 mm, over 5e-4 at 2.25 mm.
        expect(read(row, 2)).toBeLessThan(1e-6);
        expect(read(row, 2.25)).toBeGreaterThan(5e-4);
        // Past it: 0.16% to 0.23% at every lattice — the clip's rim sits at a
        // different pupil radius in every colour (0.9905 at 430 nm against
        // 0.9874 at 530, at 2.25 mm), so this is the optics' and not a floor.
        for (const r of [3, 4, 4.5]) {
          expect(read(row, r)).toBeGreaterThan(1.6e-3);
          expect(read(row, r)).toBeLessThan(2.3e-3);
        }
      }
      expect(read(table[0]!, 2)).toBeCloseTo(1.68784e-7, 11);
      expect(read(table[2]!, 2)).toBeCloseTo(1.68891e-7, 11);

      // And it does NOT fall as the lattice refines.
      const edge = table.map((row) => read(row, 4.5));
      expect(edge[0]!).toBeCloseTo(1.98979e-3, 8);
      expect(edge[1]!).toBeCloseTo(2.28113e-3, 8);
      expect(edge[2]!).toBeCloseTo(2.15649e-3, 8);
      expect(edge[0]! / edge[2]!).toBeCloseTo(0.922698, 5);
    });
  });

  describe("§ 6be.7 — patches reach the focus tilt INSIDE a frame, and nothing beyond it", () => {
    it("0.392 of a depth of focus across one frame at the field edge", () => {
      const frame = tileAtHeight(430, 1.1);
      const half = frame.objectHalfExtentMm;
      expect(half).toBeCloseTo(0.0514975942, 10);

      // The three field points a 3-patch render's columns look through.
      const inner = bestFocus(430, 1.1 - half, 0.1314, 0.005, 0.03);
      const middle = bestFocus(430, 1.1, 0.1314, 0.005, 0.03);
      const outer = bestFocus(430, 1.1 + half, 0.1314, 0.005, 0.03);
      for (const r of [inner, middle, outer]) expect(r.interior).toBe(true);
      // Resolved (§ 2q.3); point-sampled 0.14096351, 0.13149414, 0.12327933.
      expect(inner.mm).toBeCloseTo(0.14052332, 7);
      expect(middle.mm).toBeCloseTo(0.13228812, 7);
      expect(outer.mm).toBeCloseTo(0.12356480, 7);

      // Point-sampled 0.01768418 and 0.409136.
      const tilt = inner.mm - outer.mm;
      expect(tilt).toBeCloseTo(0.01695852, 7);
      expect(tilt / DOF430).toBeCloseTo(0.392348, 5);
      // A frame's width is its lattice's (§ 6h.2), so the tilt across it is
      // too: 0.458 of a depth of focus at 56 samples. Per frame width it is
      // settled — 0.164654 here, 0.164571 at 56.
      expect(tilt / (2 * half)).toBeCloseTo(0.164654, 5);

      // So a patched frame is not isoplanatic in FOCUS either — and that part a
      // patched render carries, because each patch is imaged through its own
      // traced pupil. What it cannot carry is the rest: one frame is this wide
      // and the field is 2.2 mm across, so § 6be.3's spread is a MOSAIC
      // quantity and no patch count within one frame reaches it.
      expect(2 * half).toBeCloseTo(0.10300, 4);
      expect(tilt).toBeLessThan(0.25 * 0.244113);
    });
  });

  describe("§ 6be.8 — patch p is a DIFFERENT field point in every channel", () => {
    it("a frame's extent is ∝ λ exactly, so the red frame is 1.526× the blue one", () => {
      const half = (nm: number) =>
        objectFieldTile(SYSTEM, {
          size: FOCUS_SIZE,
          pupilSamples: FOCUS_PS,
          wavelengthNm: nm,
          centreMm: { x: 0, y: 0 },
        }).halfExtentMm;

      expect(half(430)).toBeCloseTo(0.205365407019, 10);
      expect(half(RED)).toBeCloseTo(0.313431788553, 10);
      // § 6h.2's closed form: not merely correlated with λ, proportional to it.
      for (const nm of [480, 530, DESIGN, RED]) {
        expect(half(nm) / half(430) / (nm / 430)).toBeCloseTo(1, 12);
      }
      // Exactly the wavelength ratio, which is the whole of § 6h.2 here.
      expect(half(RED) / half(430)).toBeCloseTo(RED / 430, 12);
      expect(RED / 430).toBeCloseTo(1.526215, 6);

      // The consequence a caller reading `patchThroughput` across channels has
      // to know: at three patches, the outer column of the red frame sits a
      // third further out in the field than the blue one's, so an elementwise
      // comparison of the two arrays compares two field positions and calls the
      // difference a colour. § 6be.6 normalizes each to its own centre first,
      // which is what makes its reading a statement about the optics.
      const centre = { x: 4.5, y: 0 };
      const outerRadius = (nm: number) => {
        const frame = objectFieldTile(SYSTEM, {
          size: FOCUS_SIZE,
          pupilSamples: FOCUS_PS,
          wavelengthNm: nm,
          centreMm: centre,
        });
        return fieldPupilAt(SYSTEM, frame, 5 / 6, 0.5).imageRadiusMm;
      };
      expect(outerRadius(RED) - outerRadius(430)).toBeGreaterThan(0.03);
    });
  });
});

/** What one field radius's pupil transmits, on a given lattice. */
function throughput(nm: number, radiusMm: number, ps: number): number {
  const frame = objectFieldTile(SYSTEM, {
    size: 128,
    pupilSamples: ps,
    wavelengthNm: nm,
    centreMm: { x: radiusMm, y: 0 },
  });
  return pupilThroughput(fieldPupilAt(SYSTEM, frame, 0.5, 0.5).pupil, {
    pupilSamples: ps,
    edgeSamples: EDGE,
    size: 128,
  });
}

/** Kept honest: the patched path and the field renderer are the same call. */
describe("§ 6be — the driver and the renderer agree by construction", () => {
  it("formVolumePlane at N patches IS renderFieldVolume at N patches", () => {
    const centre = { x: 4.5, y: 0 };
    const options = { ...driverOptions(centre), patches: 2 };
    const sample = SAMPLES[2]!;
    const plane = formVolumePlane(
      SYSTEM,
      neutralVolumeEmitterDensity(hazeAt(centre)),
      options,
      sample,
      centre,
    );
    const control = renderFieldVolume(
      plane.volume,
      fieldDefocusing((u, v) => fieldPupilAt(SYSTEM, plane.frame, u, v, options)),
      {
        patches: 2,
        pupilSamples: PS,
        edgeSamples: EDGE,
        numericalAperture: plane.numericalAperture,
        wavelengthNm: sample.nm,
        refractiveIndex: nAt(sample.nm),
        scale: plane.frame.scale,
      },
    );
    for (let i = 0; i < control.intensity.length; i++) {
      expect(Object.is(plane.image.intensity[i], control.intensity[i])).toBe(true);
    }
    for (let p = 0; p < 4; p++) {
      expect(Object.is(plane.image.patchThroughput[p], control.patchThroughput[p])).toBe(true);
    }
  });
});
