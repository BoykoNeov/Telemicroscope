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
 * **The deferral this made explicit, closed by § 6as:** an extended
 * *fluorescent* specimen is an emitter **density**, and warping one without
 * multiplying by det J would move flux between pixels. § 6i's
 * `rasterizeEmitters` sidesteps it — a point emitter is placed through its own
 * traced chief ray, so there is no density to transform — and that is why beads
 * were the branch's first specimen. The Jacobian is not built *here*, and that
 * has not changed: it is `imaging/emitter-density`, which needs the derivative
 * of the map this module only evaluates. Unusually for this engine, **energy is
 * a real witness there**, which is worth saying given how often § 6g.2 and
 * § 6k.4 record that it is not — and § 6as.4 found that it has two rates, an
 * error function for a smooth density and the Gauss circle problem's open
 * exponent for a hard edge.
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

/**
 * ## Structure, as opposed to a ruling
 *
 * Everything the branch has imaged so far is a cosine grating or a flat stain:
 * one spatial frequency, or none. That is the right object for pinning a
 * transfer — it puts all of the object's energy in one bin, so the number that
 * comes back is the optics' and nothing else — but it is not a *picture*, and it
 * hides two whole classes of question. A cosine has no edges, so nothing ever
 * asked what happens to the harmonics an edge carries; and it is unbounded in
 * both directions, so nothing ever asked what happens at the end of a feature.
 *
 * The three factories below are the smallest set that asks both. They are
 * authored in **millimetres on the object plane**, in `Specimen`'s own
 * unsigned-magnification coordinates, and they are shipped rather than
 * test-local because `packages/app` will want the same targets: a bar element
 * and a star are what a microscopist actually puts on the stage to see whether
 * the instrument is working.
 *
 * They are binary amplitude targets — chrome on glass, not a phase object — and
 * that is what makes them exactly analysable. § 6ao.1 reads the Fourier
 * coefficient of the sampled bar in closed form, which is possible only because
 * the authored value is two-valued and the sampling is the whole of the
 * difference between it and a mathematical square wave.
 *
 * **Sub-pixel edges are the caller's problem, deliberately.** A bar edge that
 * lands exactly on a sample is a coin toss — `<=` says opaque, `<` says clear,
 * and neither is more right. The factories do not dither, do not area-average
 * and do not anti-alias, because any of those would put a resampling kernel
 * between the authored target and the image, and § 6n's header explains at
 * length why this module refuses to do that. A caller who wants an exactly
 * commensurate ruling offsets the target by half a pixel and gets an exact
 * answer; § 6ao.1 does precisely that.
 */

export interface BarTargetOptions {
  /** Line pairs per millimetre. One cycle is one bar plus one gap. */
  readonly cyclesPerMm: number;
  /** Centre of the element, in object mm. Defaults to the origin. */
  readonly centreMm?: { readonly x: number; readonly y: number };
  /**
   * How many bars. Omit for an **unbounded ruling** — no ends, no sides, the
   * square-wave counterpart of `cosineGratingObject`. The standard's own
   * element is 3.
   */
  readonly bars?: number;
  /**
   * Bar length in bar widths. MIL-STD-150A's aspect is 5; ignored when the
   * ruling is unbounded.
   */
  readonly lengthInWidths?: number;
  /** Which way the bars RUN. `"vertical"` bars modulate along x. Default. */
  readonly orientation?: "vertical" | "horizontal";
  /** Amplitude transmittance of a bar. Default 0 — opaque chrome. */
  readonly barTransmittance?: number;
  /** Amplitude transmittance of the surround. Default 1. */
  readonly clearTransmittance?: number;
}

/**
 * A bar target: `bars` opaque bars on a clear field, or an unbounded ruling.
 *
 * The element is symmetric about `centreMm` and **starts and ends on a bar**,
 * so its extent across the bars is `(2·bars − 1)` bar widths — 5 for the
 * standard's three — and an odd `bars` puts a bar centre on the centre while an
 * even one puts a gap there.
 */
export function barTarget(options: BarTargetOptions): Specimen {
  const { cyclesPerMm, bars, orientation = "vertical" } = options;
  if (!(cyclesPerMm > 0)) throw new Error(`cyclesPerMm must be positive, got ${cyclesPerMm}`);
  if (bars !== undefined && !(bars >= 1 && Number.isInteger(bars))) {
    throw new Error(`bars must be a positive integer, got ${bars}`);
  }
  const centre = options.centreMm ?? { x: 0, y: 0 };
  const opaque = options.barTransmittance ?? 0;
  const clear = options.clearTransmittance ?? 1;
  const widthMm = 1 / (2 * cyclesPerMm);
  const periodMm = 2 * widthMm;
  // An even bar count has no bar on the centre line, so the ruling's phase is
  // shifted by one bar to keep the element symmetric about it either way.
  const phaseOffsetMm = bars !== undefined && bars % 2 === 0 ? widthMm : 0;
  const acrossHalfMm = bars === undefined ? Infinity : ((2 * bars - 1) * widthMm) / 2;
  const alongHalfMm = bars === undefined ? Infinity : ((options.lengthInWidths ?? 5) * widthMm) / 2;

  return (xMm, yMm) => {
    const dx = xMm - centre.x;
    const dy = yMm - centre.y;
    // `across` is the direction the ruling modulates in; `along` runs up a bar.
    const across = orientation === "vertical" ? dx : dy;
    const along = orientation === "vertical" ? dy : dx;
    if (Math.abs(across) > acrossHalfMm || Math.abs(along) > alongHalfMm) {
      return { re: clear, im: 0 };
    }
    const u = across + phaseOffsetMm;
    const offsetFromNearestBar = u - periodMm * Math.round(u / periodMm);
    const inBar = Math.abs(offsetFromNearestBar) <= widthMm / 2;
    return { re: inBar ? opaque : clear, im: 0 };
  };
}

export interface SiemensStarOptions {
  /** Opaque spokes. The pattern's angular period is `2π/spokes`. */
  readonly spokes: number;
  /** Outside this radius the field is clear. */
  readonly radiusMm: number;
  readonly centreMm?: { readonly x: number; readonly y: number };
  /** An opaque hub, which hides the singular centre. Default 0. */
  readonly hubMm?: number;
  /** Amplitude transmittance of a spoke. Default 0. */
  readonly barTransmittance?: number;
  /** Amplitude transmittance of the surround. Default 1. */
  readonly clearTransmittance?: number;
}

/**
 * A Siemens star — the one target whose spatial frequency is a function of
 * position.
 *
 * At radius r the pattern is a ruling of `spokes / (2πr)` cycles per mm, so a
 * single exposure sweeps the whole frequency axis and the instrument draws its
 * own cutoff as the grey disc where the spokes stop being spokes. That local
 * frequency is an approximation and stops being a good one where the period
 * approaches the radius, which is exactly where the disc is — so the disc's
 * radius is a *bracket* on the cutoff and not a measurement of it (§ 6ao.8).
 */
export function siemensStar(options: SiemensStarOptions): Specimen {
  const { spokes, radiusMm } = options;
  if (!(spokes >= 1 && Number.isInteger(spokes))) {
    throw new Error(`spokes must be a positive integer, got ${spokes}`);
  }
  if (!(radiusMm > 0)) throw new Error(`radiusMm must be positive, got ${radiusMm}`);
  const centre = options.centreMm ?? { x: 0, y: 0 };
  const hubMm = options.hubMm ?? 0;
  const opaque = options.barTransmittance ?? 0;
  const clear = options.clearTransmittance ?? 1;

  return (xMm, yMm) => {
    const dx = xMm - centre.x;
    const dy = yMm - centre.y;
    const r = Math.hypot(dx, dy);
    if (r > radiusMm) return { re: clear, im: 0 };
    if (r <= hubMm) return { re: opaque, im: 0 };
    // Half of each angular period is opaque, which is the star's 50% duty.
    const turns = Math.atan2(dy, dx) / (2 * Math.PI);
    const phase = turns * spokes;
    return { re: phase - Math.floor(phase) < 0.5 ? opaque : clear, im: 0 };
  };
}

/**
 * The USAF 1951 chart's frequency ladder, from MIL-STD-150A:
 * `2^(group + (element − 1)/6)` line pairs per mm, six elements to a group.
 *
 * The external number this module can be pinned against, and the reason to have
 * it here rather than in a test: it is the *specification* of the target, so a
 * caller asking for "group 7, element 6" gets the frequency the physical chart
 * has and not one this engine invented. Bar width is half the period, `1/(2f)`,
 * and the standard's element is three bars five widths long — `barTarget`'s
 * defaults.
 *
 * Groups may be negative — that is the large end of a chart — and the standard
 * tabulates −2 through 7.
 */
export function usafFrequencyCyclesPerMm(group: number, element: number): number {
  if (!(element >= 1 && element <= 6 && Number.isInteger(element))) {
    throw new Error(`element must be an integer in 1…6, got ${element}`);
  }
  if (!Number.isInteger(group)) throw new Error(`group must be an integer, got ${group}`);
  return 2 ** (group + (element - 1) / 6);
}
