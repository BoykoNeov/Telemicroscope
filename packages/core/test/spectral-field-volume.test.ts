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
 * headline is a **separation** rather than a coupling.
 *
 * **The best-focus surface separates into a colour curve plus a field curve.**
 * A stack is rendered at one stage position, so where a channel is sharp depends
 * on its wavelength (§ 6bb.6) and, it turns out, about half as much again on
 * where in the field it is looking. But not on the two together: the
 * interaction between them is under 0.0013 mm, 0.5% of the total spread and 0.03
 * of a depth of focus. § 6be.2 does not merely bound it, it shows it is the
 * estimator's own floor — the residual **changes sign** and its ordering over
 * three wavelengths **scrambles** between object heights while its absolute size
 * stays near 0.0012 mm, which a physical coupling would not do. The consequence
 * is a design one: a focus correction wants two one-dimensional curves and not a
 * two-dimensional map.
 *
 * **The field term is even, which is why § 6bb.6 could not have seen it.** It
 * goes as h², so its gradient vanishes on the axis exactly and § 6bb.6 measured
 * the focus at the one field position at which the field term is flat. § 6be.4
 * pins the evenness the way it has to be pinned — the drop divided by h² is
 * constant across a range over which the drop divided by h moves 1.29× to 1.36×
 * — and that is the **third** time the ladder has read an even quantity at its
 * own symmetry point, after § 6bc's throughput profile and § 6bd's repair of it.
 *
 * **The estimator has a zero off the axis**, and § 6be.5 is the rung that makes
 * the field term the objective's: `rasterizeEmitterVolume` runs on a radial map
 * and a depth rescale which are *both* field-dependent, so a best focus that
 * moved with height could have belonged to either. An aberration-free pupil
 * returns −2.8e-7 mm at every height alike.
 *
 * **And the amplitude half is a null.** § 6be.6 measures the field profile of
 * what the pupil transmits, normalized to each frame's own centre, and finds it
 * the same at every wavelength to 5.3e-7 — a figure that does *not* fall as the
 * pupil lattice refines, so it is a floor and not a staircase. The one radius
 * that reads 4.8e-3 does fall, by 4.05× as the lattice doubles, which is what
 * says it is quantization. So every chromatic thing about a patched frame lives
 * in the **phase**: § 6bd.6's amplitude/phase split, one axis up.
 *
 * The external numbers are § 6bb.6's own rendered focus sweep, reproduced here
 * to six digits before being taken off axis (§ 6be.3), and § 6h.2's closed form
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
    numericalAperture: objectNumericalAperture(SYSTEM, nm),
    wavelengthNm: nm,
    refractiveIndex: 1,
    scale: frame.scale,
  });
  let peak = 0;
  for (const v of intensity) if (v > peak) peak = v;
  return peak;
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

  describe("§ 6be.2 — the best-focus surface SEPARATES into a colour term and a field term", () => {
    it("the interaction is under 0.0013 mm — 0.5% of the spread, 0.03 of a depth of focus", () => {
      // The interaction on the widest colour interval in the set, at each height.
      const interaction = (h: number) => drop(430, h) - drop(DESIGN, h);
      expect(interaction(0.4)).toBeCloseTo(-1.231174e-3, 7);
      expect(interaction(0.8)).toBeCloseTo(1.136270e-3, 7);
      expect(interaction(1.1)).toBeCloseTo(7.506299e-4, 7);

      for (const h of [0.4, 0.8, 1.1]) {
        expect(Math.abs(interaction(h))).toBeLessThan(1.3e-3);
        expect(Math.abs(interaction(h)) / DOF430).toBeLessThan(0.031);
      }
    });

    it("and that residual is the ESTIMATOR'S FLOOR, not a coupling: it changes sign", () => {
      const interaction = (h: number) => drop(430, h) - drop(DESIGN, h);
      // A physical coupling does not reverse as the field grows. This one does,
      // between the first two heights.
      expect(interaction(0.4) * interaction(0.8)).toBeLessThan(0);

      // And the ordering of the three wavelengths' field shifts scrambles, which
      // no monotone coupling could produce. Rank by |shift| at each height.
      const order = (h: number) =>
        [430, DESIGN, RED]
          .map((nm) => [nm, Math.abs(drop(nm, h))] as const)
          .sort((a, b) => a[1] - b[1])
          .map(([nm]) => nm)
          .join("<");
      const orders = new Set([order(0.4), order(0.8), order(1.1)]);
      expect(orders.size).toBe(3);

      // The signature that decides it: the residual's ABSOLUTE size is flat near
      // 0.0012 mm while its RELATIVE size falls as the field shift it is being
      // compared against grows. That is a fixed floor, divided by a rising
      // signal — § 6bb.9's discipline, applied to a null instead of a
      // cancellation.
      const spread = (h: number) => {
        const abs = [430, DESIGN, RED].map((nm) => Math.abs(drop(nm, h)));
        return Math.max(...abs) / Math.min(...abs) - 1;
      };
      expect(spread(0.4)).toBeCloseTo(1.124261e-1, 5);
      expect(spread(0.8)).toBeCloseTo(3.766764e-2, 5);
      expect(spread(1.1)).toBeCloseTo(2.331975e-2, 5);
      expect(spread(0.4)).toBeGreaterThan(spread(0.8));
      expect(spread(0.8)).toBeGreaterThan(spread(1.1));
    });
  });

  describe("§ 6be.3 — and the field adds half as much again to § 6bb.6's spread", () => {
    it("0.250229 mm over the square — 5.789 depths of focus at 430 against 3.8775 on axis", () => {
      // § 6bb.6's own numbers, reproduced by this file's estimator before it is
      // taken anywhere new. Six digits, on the axis.
      expect(at(430, 0)).toBeCloseTo(0.21400556, 7);
      expect(at(DESIGN, 0)).toBeCloseTo(0.04709541, 7);
      expect(at(RED, 0)).toBeCloseTo(0.06736525, 7);

      const values = FOCUS_LAMBDAS.flatMap((nm) => HEIGHTS.map((h) => at(nm, h)));
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread).toBeCloseTo(0.25022903, 7);
      expect(DOF430).toBeCloseTo(4.322314e-2, 7);
      expect(spread / DOF430).toBeCloseTo(5.78924, 4);

      // The extremes are the blue ON AXIS and the design wavelength at the EDGE
      // — one corner from each axis, which is what a separable surface does.
      expect(Math.max(...values)).toBe(at(430, 0));
      expect(Math.min(...values)).toBe(at(DESIGN, 1.1));

      // Decomposed: § 6bb.6's colour term is the larger, and the field term is
      // half as much again on top of it rather than a correction to it.
      const colour = at(430, 0) - at(DESIGN, 0);
      const field = Math.abs(drop(DESIGN, 1.1));
      expect(colour).toBeCloseTo(0.16691015, 7);
      expect(field).toBeCloseTo(0.08331889, 7);
      expect(colour + field).toBeCloseTo(spread, 12);
      expect(field / colour).toBeCloseTo(0.499184, 5);
      // § 6bb.6 read 3.8775 of them on the axis; the square holds 5.789.
      expect(spread / DOF430 / 3.8775).toBeCloseTo(1.49303, 4);
    });
  });

  describe("§ 6be.4 — the field term is EVEN in field height, so the axis is its flat spot", () => {
    it("the drop over h² is constant where the drop over h moves 1.29× to 1.36×", () => {
      // Direction-independent, so the answer does not depend on which of the two
      // heights is written on top.
      const departure = (a: number, b: number) =>
        Math.max(Math.abs(a), Math.abs(b)) / Math.min(Math.abs(a), Math.abs(b)) - 1;

      for (const nm of FOCUS_LAMBDAS) {
        const quad = (h: number) => drop(nm, h) / (h * h);
        const lin = (h: number) => drop(nm, h) / h;
        // Read at the two largest heights, where the shift is far above the
        // 0.0012 mm floor § 6be.2 measured — at h = 0.4 the floor is a tenth of
        // the signal and no shape can be read through it.
        const asQuadratic = departure(quad(0.8), quad(1.1));
        const asLinear = departure(lin(0.8), lin(1.1));
        expect(asQuadratic).toBeLessThan(0.07);
        expect(asLinear).toBeGreaterThan(0.29);
        // The quadratic reading is at least four times the more constant — 34.6×
        // at 430 nm, 12.5× at the design wavelength and 4.63× at 656.
        expect(asLinear / asQuadratic).toBeGreaterThan(4);
      }

      // One curve for every wavelength: the h² coefficient at the field edge.
      expect(drop(430, 1.1) / 1.21).toBeCloseTo(-0.06823823, 7);
      expect(drop(DESIGN, 1.1) / 1.21).toBeCloseTo(-0.06885859, 7);
      expect(drop(RED, 1.1) / 1.21).toBeCloseTo(-0.06728941, 7);
      const coeffs = FOCUS_LAMBDAS.map((nm) => Math.abs(drop(nm, 1.1) / 1.21));
      // One curve for all three, to 2.4% — which is the floor, not a colour.
      expect(Math.max(...coeffs) / Math.min(...coeffs) - 1).toBeCloseTo(0.023320, 5);
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
      expect(ideal[0]!).toBeCloseTo(-2.78226e-7, 11);
      expect(ideal[2]!).toBeCloseTo(-2.80341e-7, 11);
      const spread = Math.max(...ideal.map(Math.abs)) / Math.min(...ideal.map(Math.abs)) - 1;
      expect(spread).toBeLessThan(0.01);
      // Against the 0.13–0.21 mm the traced pupil puts there.
      expect(Math.abs(at(430, 1.1))).toBeGreaterThan(0.13);
    });
  });

  describe("§ 6be.6 — the amplitude half is a NULL: the field profile is achromatic", () => {
    it("5.3e-7 across the band inside the catalogued field, and it is not a staircase", () => {
      const lambdas = [430, 480, 530, DESIGN, RED];
      const radii = [0, 1, 2, 3, 4];
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

      for (const ps of [24, 32, 48]) {
        for (const s of shadingAt(ps, radii)) expect(s).toBeLessThan(5.3e-7);
      }
      // It does NOT fall as the lattice refines — a floor, not quantization.
      const worst = [24, 32, 48].map((ps) => Math.max(...shadingAt(ps, radii)));
      expect(worst[0]!).toBeCloseTo(5.2556e-7, 10);
      expect(worst[2]!).toBeCloseTo(4.953e-7, 10);
      expect(worst[2]! / worst[0]!).toBeGreaterThan(0.9);

      // And the one radius that reads a thousand times larger IS quantization:
      // it falls 4.05× when the lattice doubles. § 6bc's "441 → 394 samples"
      // hard clip, caught in the act.
      const edge = [24, 32, 48].map((ps) => shadingAt(ps, [4.5])[0]!);
      expect(edge[0]!).toBeCloseTo(4.8187e-3, 6);
      expect(edge[1]!).toBeCloseTo(2.6735e-3, 6);
      expect(edge[2]!).toBeCloseTo(1.191e-3, 6);
      expect(edge[0]! / edge[2]!).toBeCloseTo(4.0459, 3);
    });
  });

  describe("§ 6be.7 — patches reach the focus tilt INSIDE a frame, and nothing beyond it", () => {
    it("0.409 of a depth of focus across one frame at the field edge", () => {
      const frame = tileAtHeight(430, 1.1);
      const half = frame.objectHalfExtentMm;
      expect(half).toBeCloseTo(0.0514975942, 10);

      // The three field points a 3-patch render's columns look through.
      const inner = bestFocus(430, 1.1 - half, 0.1314, 0.005, 0.03);
      const middle = bestFocus(430, 1.1, 0.1314, 0.005, 0.03);
      const outer = bestFocus(430, 1.1 + half, 0.1314, 0.005, 0.03);
      for (const r of [inner, middle, outer]) expect(r.interior).toBe(true);
      expect(inner.mm).toBeCloseTo(0.14096351, 7);
      expect(middle.mm).toBeCloseTo(0.13149414, 7);
      expect(outer.mm).toBeCloseTo(0.12327933, 7);

      const tilt = inner.mm - outer.mm;
      expect(tilt).toBeCloseTo(0.01768418, 7);
      expect(tilt / DOF430).toBeCloseTo(0.409136, 5);

      // So a patched frame is not isoplanatic in FOCUS either — and that part a
      // patched render carries, because each patch is imaged through its own
      // traced pupil. What it cannot carry is the rest: one frame is this wide
      // and the field is 2.2 mm across, so § 6be.3's spread is a MOSAIC
      // quantity and no patch count within one frame reaches it.
      expect(2 * half).toBeCloseTo(0.10300, 4);
      expect(tilt).toBeLessThan(0.25 * 0.250229);
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
      // which is what makes that null a statement about the optics.
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
