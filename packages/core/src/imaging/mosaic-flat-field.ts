import type { OpticalSystem } from "../trace/system";
import {
  fluorescenceMosaicGeometry,
  renderFluorescenceMosaic,
  composeTileScalars,
  type FluorescenceMosaic,
  type FluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "./fluorescence-mosaic";
import type { FluorescenceSpectralStack } from "./emitter-spectrum";
import type { SpectralVolumeEmitterDensity } from "./spectral-volume";

/**
 * § 6bi — the flat field, and what a seam is really made of.
 *
 * § 6bh composed the tiles and measured the one seam artifact it knew about:
 * the two sides of a seam are corrected to two stage positions, so a seam
 * carries a **focus** step, 0.159 of a depth of focus at 1 mm of field. It
 * closed with "nothing corrects the throughput's own field profile, which is
 * what a real slide scanner's flat-field does". This is that, and the profile
 * turns out to be the larger of the two — and the only one of them that shows
 * on a featureless specimen at all.
 *
 * ## The seam's biggest artifact is a brightness STAIRCASE
 *
 * Every tile of this mosaic sits at its own field height, so every tile is
 * formed through its own pupil, and what that pupil transmits is a function of
 * field radius. Nothing in the render normalizes it away — `field-volume` forms
 * every patch in `transmitted` units on purpose (§ 6bc) — so a mosaic of a
 * perfectly uniform specimen is not uniform. It is a staircase, one step per
 * seam, **0.53% across a seam at 1 mm of field** against 1.9e-6 on the axis
 * (§ 6bi.2), a ratio of 2783. Beside § 6bh.5's focus step that is the artifact
 * a viewer sees, and § 6bi.2 pins the discriminator: abandoning the focus
 * correction altogether moves § 6bh.4's escape by 5.264× and moves this by
 * **4.06%**, because a uniform object is uniform under any kernel and defocus
 * is not a loss. The 4% that does move is the map's share below, blurred by a
 * different kernel; the pupil's share cannot move at all.
 *
 * It vanishes on the axis for the third time on this ladder and for § 6be's
 * reason: throughput is **even** in field radius, so its gradient is zero there
 * (§ 6bd.3). What survives on the axis is a different term, and the two swap
 * ranks — see below.
 *
 * ## Two flat fields, and the difference between them is the MAP
 *
 * A flat field is whatever multiplies the picture, and there are two candidates
 * for what that is here.
 *
 * `throughputFlatField` is the cheap one: a scalar per tile, read straight off
 * `patchThroughput`, which every render has carried since § 6i. It costs
 * nothing and it is **exact for the pupil**, because with one patch per tile the
 * whole tile really is one pupil's transmission times one convolution.
 *
 * `renderedFlatField` is the honest one: the same mosaic re-rendered through a
 * featureless specimen, which is literally what a blank-slide calibration is.
 * It costs a second acquisition and it catches everything multiplicative.
 *
 * **The ratio between them is the rasterizer's Jacobian** — a uniform density in
 * the *object* is not a uniform density on the *image* grid, because the radial
 * map's local scale changes across the field (§ 6az). At 1 mm of field the two
 * fields span 1.387e-2 and 1.183e-2, so the pupil is **85%** of what a
 * calibration removes and the map the remaining 15%. On the axis they swap
 * outright: 7.785e-5 against 6.523e-8, **1193×**, so an axial flat field is the
 * rasterizer and none of it is the glass (§ 6bi.3). The reason is § 6bd.3's —
 * throughput is even in field radius, so on the axis it has no gradient to
 * contribute and only the map is left.
 *
 * A third fact makes the cheap field usable: the throughput ratio between two
 * tiles is the **same at every wavelength** to 3e-8 — § 6be.6's achromatic null,
 * measured there between patches of one frame and here between tiles of one
 * mosaic. So one calibration serves every channel, which is why a real scanner
 * gets away with one blank slide.
 *
 * ## Division is exact for the amplitude and blind to the phase
 *
 * `flatFieldCorrect` divides, and division is the whole of it — which is both
 * why it works and where it stops. The brightness profile multiplies the formed
 * image, so dividing removes it; the focus step is a **convolution**, so
 * dividing cannot touch it (§ 6bi.4). That is § 6bd.6's amplitude/phase split
 * arriving one layer up: the flat field is the amplitude half of a seam and
 * § 6bh.5 is the phase half, and no amount of either fixes the other.
 *
 * The division is not exact even on the amplitude side, and the reason is worth
 * keeping: the pupil's transmission is constant across a tile and factors out of
 * the convolution exactly, but the map's Jacobian **varies within** a tile, and
 * the render has already blurred it with that tile's own PSF. Dividing by the
 * unblurred profile would be the error; dividing by the *rendered* calibration
 * is right precisely because the calibration was blurred by the same kernel.
 * § 6bi.4 measures what each of the two fields leaves behind.
 *
 * ## This is not a slide scanner, and that is why the field is one profile
 *
 * A real scanner holds the optics still and translates the **stage**, so every
 * tile is imaged through the same part of the objective's field and the
 * vignetting pattern repeats identically in every tile — which is why a scanner
 * calibrates once, per pixel, and divides every tile by the same frame. This
 * mosaic moves `centresMm` in the **image plane**, so each tile samples a
 * different part of the field and the profile is one global even function of
 * absolute field radius that does *not* repeat per tile. Hence a single
 * mosaic-wide field here rather than a per-tile one.
 *
 * It qualifies § 6bg's prose rather than retracting it: "a stage racked between
 * tiles" is exactly a scanner's focus map, same corrector, one scalar stage per
 * tile. What differs is what drives it — field curvature here, specimen
 * topography and stage flatness there. A stage-scanning mosaic is a different
 * geometry and is left open.
 */

/** How a flat field was obtained — the two have different exactness (§ 6bi.4). */
export type FlatFieldKind =
  /** A second acquisition of a featureless specimen. Catches everything. */
  | "rendered"
  /** One scalar per tile off `patchThroughput`. Free, and the pupil only. */
  | "throughput";

export interface MosaicFlatField {
  readonly kind: FlatFieldKind;
  /** Side of the field, in pixels — the composed picture's own. */
  readonly size: number;
  /** The wavelength of each plane, in `samples` order. */
  readonly nm: readonly number[];
  /**
   * One `size × size` field per plane, each **normalised to unit mean**.
   *
   * Unit mean and not unit-at-the-centre: a corrected picture then keeps the
   * average level it was acquired at, which is what makes the correction a
   * redistribution rather than a gain. The level itself is on `meanValue`, so
   * nothing is lost by normalising.
   */
  readonly planes: readonly Float64Array[];
  /** What each plane's field averaged before it was normalised. */
  readonly meanValue: readonly number[];
  /**
   * Max over planes of `(max − min) / mean` — how far from flat the picture is.
   *
   * The single number that says whether a correction is worth making, and the
   * quantity § 6bi.2 reads across the field.
   */
  readonly span: number;
}

function normalise(planes: Float64Array[], nm: readonly number[], kind: FlatFieldKind): MosaicFlatField {
  const meanValue: number[] = [];
  let span = 0;
  for (const plane of planes) {
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of plane) {
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const mean = sum / plane.length;
    if (!(mean > 0)) {
      throw new Error(
        `flat field: a plane averaged ${mean} — a flat field is a divisor and must be positive ` +
          `everywhere, so a calibration that came back dark cannot be used`,
      );
    }
    if (!(lo > 0)) {
      throw new Error(
        `flat field: a plane reaches ${lo} — a flat field is a divisor and must be positive ` +
          `everywhere; a calibration specimen that does not cover the whole picture is not one`,
      );
    }
    for (let i = 0; i < plane.length; i++) plane[i] = plane[i]! / mean;
    meanValue.push(mean);
    span = Math.max(span, (hi - lo) / mean);
  }
  return { kind, size: Math.round(Math.sqrt(planes[0]?.length ?? 0)), nm, planes, meanValue, span };
}

/**
 * The blank-slide calibration: the same mosaic, re-rendered on a featureless
 * specimen.
 *
 * `blank` is required and has no default, for `TileStageMm`'s reason: a default
 * would be this module choosing the calibration. What a caller passes is the
 * uniform-density specimen a real flat-field slide stands for, and the
 * *spectrum* it is given barely matters — § 6be.6's null says the profile is
 * achromatic to 5.3e-7 — but the geometry must be the picture's, so the options
 * are the picture's options and this refuses to invent them.
 *
 * It costs a whole second mosaic. That is the honest price and it is the price a
 * real calibration costs too; `throughputFlatField` is the free approximation
 * and § 6bi.4 measures what it leaves behind.
 */
export function renderedFlatField(
  system: OpticalSystem,
  blank: SpectralVolumeEmitterDensity,
  options: FluorescenceMosaicOptions,
): MosaicFlatField {
  const mosaic = renderFluorescenceMosaic(system, blank, options);
  return normalise(
    mosaic.composed.planes.map((p) => Float64Array.from(p.intensity)),
    mosaic.composed.planes.map((p) => p.nm),
    "rendered",
  );
}

/**
 * The free calibration: one scalar per tile, laid out through the picture's ramp.
 *
 * `patchThroughput` is what that tile's pupil transmitted, so with one patch per
 * tile this **is** the pupil's whole contribution to the picture's brightness,
 * exactly. Above one patch it is the mean over the tile's patches and the
 * within-tile structure is left to `renderedFlatField`, which is the difference
 * § 6bi.4 charges it for.
 *
 * Composed through `composeTileScalars`, so under an overlap the staircase is
 * ramped by the same weights the picture was — a correction that stepped where
 * the picture ramps would put a seam back where the blend had removed one.
 */
export function throughputFlatField(mosaic: FluorescenceMosaic): MosaicFlatField {
  const { geometry, tiles } = mosaic;
  const n = geometry.tilesPerAxis;
  const planes = mosaic.composed.planes.map((_, p) =>
    composeTileScalars(geometry, (col, row) => {
      const tile = tiles[row * n + col]!;
      const throughput = tile.volume.planes[p]!.patchThroughput;
      let sum = 0;
      for (const v of throughput) sum += v;
      return sum / throughput.length;
    }),
  );
  return normalise(planes, mosaic.composed.planes.map((p) => p.nm), "throughput");
}

/**
 * Divide a composed picture by a flat field.
 *
 * Returns a stack, not a mosaic: what comes out is a picture and no longer
 * carries the tiles it was made of, and `colorImageFromStack` takes it
 * unchanged. Everything describing the ruler is copied through — a flat field
 * changes brightness and never geometry.
 *
 * `maxGridPhaseStepWaves` is carried through untouched on purpose. It is a
 * statement about the kernels the picture was formed with, and dividing the
 * result by a calibration does not un-form them; § 6bg.5 is the standing warning
 * about a readout quoted where its reference has moved.
 */
export function flatFieldCorrect(
  stack: FluorescenceSpectralStack,
  flat: MosaicFlatField,
): FluorescenceSpectralStack {
  if (flat.planes.length !== stack.planes.length) {
    throw new Error(
      `flatFieldCorrect: the field has ${flat.planes.length} planes and the picture ` +
        `${stack.planes.length} — a flat field is per channel and the two must be the same series`,
    );
  }
  if (flat.size !== stack.size) {
    throw new Error(
      `flatFieldCorrect: the field is ${flat.size} px and the picture ${stack.size} — a flat ` +
        `field belongs to the mosaic geometry it was calibrated on`,
    );
  }
  const planes = stack.planes.map((plane, i) => {
    const field = flat.planes[i]!;
    if (flat.nm[i] !== plane.nm) {
      throw new Error(
        `flatFieldCorrect: plane ${i} is ${plane.nm} nm and the field's is ${flat.nm[i]} nm — ` +
          `dividing one channel by another's calibration is a colour error, not a correction`,
      );
    }
    const intensity = new Float64Array(plane.intensity.length);
    for (let k = 0; k < intensity.length; k++) intensity[k] = plane.intensity[k]! / field[k]!;
    return { ...plane, intensity };
  });
  return { ...stack, planes };
}

/**
 * What one seam does to the brightness, read two ways.
 *
 * Row and column **means** are taken first, so structure that runs across a seam
 * averages down and what is left is the seam. It is still a readout for a
 * featureless or a statistically uniform picture: on a picture with a bright
 * object sitting on a seam, the means carry the object too, and this cannot tell
 * them apart.
 *
 * The two numbers separate what a blend changes from what it does not:
 *
 * - `acrossSeam` is the total relative change from just outside one side of the
 *   shared band to just outside the other — what the seam *carries*. It is the
 *   quantity § 6bi.2 reads across the field.
 * - `maxAdjacent` is the largest relative change between two neighbouring
 *   pixels anywhere in the band — what the seam *looks like*. A ramp divides it
 *   by the overlap, which is § 6bi.5's closed form.
 *
 * With no overlap the band is one pixel wide and the two are the same number.
 * **With one they are not comparable across overlaps**, and the reason is that
 * the bracket widens with the band: it spans `overlap + 1` pixels of specimen, so
 * it carries the picture's own field gradient over that distance on top of the
 * seam. What is invariant is their RATIO, which is why § 6bi.5 pins that and not
 * either number alone.
 */
export function mosaicSeamStep(
  stack: FluorescenceSpectralStack,
  geometry: FluorescenceMosaicGeometry,
): { readonly acrossSeam: number; readonly maxAdjacent: number } {
  const { size, pitchPixels, overlapPixels, tilesPerAxis } = geometry;
  if (stack.size !== size) {
    throw new Error(
      `mosaicSeamStep: the picture is ${stack.size} px and the geometry ${size} — a seam is at a ` +
        `pixel this geometry names, so the two must be the same mosaic`,
    );
  }
  let acrossSeam = 0;
  let maxAdjacent = 0;
  const rel = (a: number, b: number): number => (a + b > 0 ? Math.abs(2 * (b - a)) / (a + b) : 0);

  for (const plane of stack.planes) {
    const cols = new Float64Array(size);
    const rows = new Float64Array(size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = plane.intensity[r * size + c]!;
        cols[c] = cols[c]! + v;
        rows[r] = rows[r]! + v;
      }
    }
    for (const means of [cols, rows]) {
      for (let k = 1; k < tilesPerAxis; k++) {
        // Tile k−1 keeps pixels up to k·pitch + overlap and tile k starts at
        // k·pitch, so the shared band is [k·pitch, k·pitch + overlap) and the
        // two pixels bracketing it are one before and one after.
        const lo = k * pitchPixels - 1;
        const hi = k * pitchPixels + overlapPixels;
        if (lo < 0 || hi >= size) continue;
        acrossSeam = Math.max(acrossSeam, rel(means[lo]!, means[hi]!));
        for (let i = lo; i < hi; i++) {
          maxAdjacent = Math.max(maxAdjacent, rel(means[i]!, means[i + 1]!));
        }
      }
    }
  }
  return { acrossSeam, maxAdjacent };
}
