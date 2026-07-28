import type { AimOptions } from "../pupil/aiming";
import type { OpticalSystem } from "../trace/system";
import type { ObjectField } from "../illumination/abbe";
import { imagePointAt, objectPointAt, type ObjectFieldFrame } from "./object-field";
import { requireRadialMapMatches, type RadialMap } from "./radial-map";

/**
 * The warped-grid rasterizer — § 6h's named deferral, closed.
 *
 * `imaging/object-field` carries distortion in the **pupil assignment**: each
 * patch is handed the pupil of the object point its own image position really
 * comes from. What it does *not* do is place the specimen there. A specimen
 * authored by uniform scaling — `centreObjectMm` plus a pixel offset times
 * `objectPixelScaleMm` — is laid down on the paraxial map, so the optics of a
 * frame position and the object at that position disagree by exactly the
 * distortion, and `objectPointAt` has been sitting there since § 6h as the seam
 * this module attaches to.
 *
 * On one on-axis frame that disagreement is invisible: § 6h.2's half-extent is
 * ~44 µm on a 4×/0.10, over which the cubic is parts per billion. § 6m is what
 * makes it matter — a tile sits at millimetres of field, two tiles abut, and a
 * straight specimen crossing the seam arrives at each side on a different linear
 * approximation to a map that is not linear. That is a **visible seam
 * misregistration**, and it is § 6o's problem unless it is removed here.
 *
 * ## The specimen is a callback, and that is the whole reason it is exact
 *
 * `rotatePupil`'s argument, one layer further out. A `Specimen` is evaluated at
 * the object point a pixel really looks at, so the warp happens in the
 * **argument** and the amplitude that comes back is the specimen's own value
 * there — no resampling, no interpolation kernel, nothing to renormalize. Handed
 * a sampled array instead, the same map would have to interpolate, and the
 * rasterizer would carry `rotateKernel`'s bilinear error on top of the optics it
 * exists to represent.
 *
 * The direction is backwards on purpose: image pixel → object point, never
 * object point → image pixel. A forward scatter leaves holes wherever the map
 * expands and doubles up wherever it contracts, and § 6m.4 measured that it does
 * both at once — an off-axis tile is anisotropic in the ratio 3, so no single
 * resampling of a forward splat could be right in both directions.
 *
 * ## Amplitude is a point property. A density is not.
 *
 * An `ObjectField` is a complex amplitude **transmittance**: what fraction of
 * the incident field a point of the specimen passes. That is a property *of the
 * point*, so warping it is pure coordinate substitution and there is no
 * Jacobian. Total transmitted energy is not conserved under the warp and must
 * not be — a region the map magnifies really does present more of the specimen
 * to more of the image, and § 6m.4's ratio-3 anisotropy is exactly det J
 * departing from 1.
 *
 * **The deferral this makes explicit:** an extended *fluorescent* specimen is an
 * emitter **density**, and warping one without multiplying by det J would move
 * flux between pixels. § 6i's `rasterizeEmitters` sidesteps it — a point emitter
 * is placed through its own traced chief ray, so there is no density to
 * transform — and that is why beads were the branch's first specimen. An
 * extended emitter field needs the Jacobian, and it is not built here. Unusually
 * for this engine, **energy is a real witness there**, which is worth saying
 * given how often § 6g.2 and § 6k.4 record that it is not.
 *
 * ## Cost, measured
 *
 * One `objectPointAt` per pixel, and each of those bisects a traced chief ray to
 * mantissa exhaustion: 0.12 ms per pixel on the DIN 4×, so 0.5 s at 64² and
 * ~2 s at 128². That is the same order as the sum it feeds — a `patches` = 2,
 * five-point-source `renderBrightfield` on the same frame is 0.33 s — so the
 * warp is **not** free relative to the imaging, it is merely affordable. A
 * mosaic of tens of tiles is where that stops being true.
 *
 * **That cache is now built, in `imaging/radial-map` (§ 6s), and it is opt-in
 * here for the reason this note used to give for deferring it:** § 6n's rungs
 * pin the *map*, and an interpolant underneath them would mean they pinned the
 * interpolant instead. So the default is unchanged — every pixel bisects — and
 * a caller who passes a `RadialMap` gets `nodes + 1` inversions for the whole
 * table instead of one per pixel, with the interpolation error a measured
 * number (§ 6s.2) rather than a hope. The prediction in the paragraph above was
 * also wrong about which step would build it: § 6p spent itself on the pupil.
 */

/** A complex amplitude transmittance value. */
export interface SpecimenValue {
  readonly re: number;
  readonly im: number;
}

/**
 * A specimen, as a function of position on the **object plane** in millimetres.
 *
 * Coordinates are the ones `ObjectFieldFrame.centreObjectMm` and
 * `PointEmitter` use — unsigned-magnification convention, so a caller placing
 * structure against a known image position multiplies by |M| and never by the
 * signed `magnification`. § 6m recorded what the signed one costs: a mosaic
 * mirrored about the axis, with every rung still green.
 */
export type Specimen = (xMm: number, yMm: number) => SpecimenValue;

/**
 * A specimen whose transmittance depends on **wavelength** — a stain (§ 6r).
 *
 * The whole of "what makes a stained section look stained" is that this callback
 * reads its third argument. A specimen that ignores `nm` is neutral by
 * definition, which is how § 6r states its first rung: neutral in, neutral out,
 * through a path in which every wavelength was imaged on its own ruler.
 *
 * Not a superset of `Specimen` in the type system on purpose. `rasterizeSpecimen`
 * takes the two-argument form and is called once per wavelength with `nm` already
 * bound (`atWavelength`), so nothing below the authoring layer learns that a
 * spectrum exists — the same seam `rasterizeSpecimen` keeps for the warp.
 */
export type SpectralSpecimen = (xMm: number, yMm: number, nm: number) => SpecimenValue;

/** One wavelength's slice of a spectral specimen, as a plain `Specimen`. */
export function atWavelength(specimen: SpectralSpecimen, nm: number): Specimen {
  return (xMm, yMm) => specimen(xMm, yMm, nm);
}

/** A wavelength-independent specimen, seen as a spectral one. */
export function neutralSpecimen(specimen: Specimen): SpectralSpecimen {
  return (xMm, yMm) => specimen(xMm, yMm);
}

/** Which map a pixel's object point is read on. */
export type SpecimenMap =
  /** The traced chief ray, inverted — carries distortion. This is § 6n. */
  | "traced"
  /**
   * `centreObjectMm` plus the pixel offset times `objectPixelScaleMm` — what a
   * specimen authored by uniform scaling really is, and the negative control.
   *
   * It is the paraxial map restricted to this frame: linear, with the frame's
   * own traced centre as its fixed point, so it is *exact at the centre* and
   * wrong by the distortion everywhere else. On the axial frame it is
   * `imagePointAt / |M|` identically, which is why § 6h could not see it.
   */
  | "uniform";

export interface RasterizeSpecimenOptions {
  /** Default `"traced"`. */
  readonly map?: SpecimenMap;
  readonly aim?: AimOptions;
  /**
   * A tabulated inverse chief-ray map (§ 6s), in place of a bisection per pixel.
   *
   * Opt-in, and the exact path stays the default — see the header's cost note.
   * Ignored by `"uniform"`, which does not invert anything. Refused if its
   * wavelength or its launch plane is not the frame's.
   */
  readonly radialMap?: RadialMap;
  /** Called once per row, for progress against the cost above. */
  readonly onRow?: (done: number, total: number) => void;
}

/**
 * Where a pixel of the frame looks on the specimen, in object millimetres.
 *
 * The rasterizer's own map, exposed so a caller can go back the other way — the
 * round trip a seam has to survive — without re-deriving the pixel convention.
 * That convention is `rasterizeEmitters`': index `i` sits at offset
 * `i − size/2` in pixels from the frame's centre, so the frame's centre falls
 * **on** pixel `size/2` rather than between pixels. Half of one pixel is a
 * seam misregistration of half a pixel, which is the class of bug this module
 * exists to remove, so the two rasterizers are pinned against each other rather
 * than each being trusted (§ 6n.2).
 */
export function specimenPointAt(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  ix: number,
  iy: number,
  options: RasterizeSpecimenOptions = {},
): { x: number; y: number } {
  const { size } = frame;
  if (options.map === "uniform") {
    return {
      x: frame.centreObjectMm.x + (ix - size / 2) * frame.objectPixelScaleMm,
      y: frame.centreObjectMm.y + (iy - size / 2) * frame.objectPixelScaleMm,
    };
  }
  const { radialMap } = options;
  if (radialMap !== undefined) {
    // `objectPointAt`'s own tail, with the one line that costs 60 chief rays
    // replaced by a table lookup and nothing else moved — the azimuth, the
    // absolute image point and the polar reassembly are the same arithmetic, so
    // the two paths differ by the interpolation and by nothing structural.
    requireRadialMapMatches(radialMap, frame, options.aim, "specimenPointAt");
    const { x, y } = imagePointAt(frame, ix / size, iy / size);
    const imageRadius = Math.hypot(x, y);
    const azimuthRad = imageRadius > 0 ? Math.atan2(y, x) : 0;
    const radiusMm = radialMap.heightAt(imageRadius);
    return { x: radiusMm * Math.cos(azimuthRad), y: radiusMm * Math.sin(azimuthRad) };
  }
  const p = objectPointAt(
    system,
    frame,
    ix / size,
    iy / size,
    options.aim === undefined ? {} : { aim: options.aim },
  );
  return { x: p.x, y: p.y };
}

/**
 * Rasterize a specimen onto the frame's grid through the traced map.
 *
 * Produces the `ObjectField` `abbeImage` and `renderBrightfield` already
 * consume, unchanged — this is the **authoring** path and nothing downstream
 * learns that the grid was warped.
 *
 * Throws where `objectPointAt` throws: a corner whose chief ray reaches no
 * object height is a real outcome on a real objective, and a rasterizer that
 * quietly clamped it would put the wrong piece of specimen in the corner of
 * every image formed from it.
 */
export function rasterizeSpecimen(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  specimen: Specimen,
  options: RasterizeSpecimenOptions = {},
): ObjectField {
  const { size } = frame;
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);

  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const p = specimenPointAt(system, frame, ix, iy, options);
      const t = specimen(p.x, p.y);
      re[iy * size + ix] = t.re;
      im[iy * size + ix] = t.im;
    }
    options.onRow?.(iy + 1, size);
  }

  return { size, re, im };
}
