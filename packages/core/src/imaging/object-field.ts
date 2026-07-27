import { fitZernike, type ZernikeFit } from "../wave/zernike";
import { opdSampling, type OpdSampling } from "../wave/fidelity";
import {
  imagePixelScaleMm,
  pupilFunctionFromOpd,
  type PupilFunction,
  type PupilScale,
  type SpiderSpec,
} from "../wave/psf";
import { opdMap, vignetteMask } from "../pupil/opd";
import { pupilGrid, type AimOptions } from "../pupil/aiming";
import { isPowerOfTwo } from "../math/fft";
import { primaryWavelength, type OpticalSystem } from "../trace/system";
import { lateralMagnification } from "../pupil/microscope";
import { imagePointOf } from "./scene";
import type { PatchPupil } from "./brightfield";

/**
 * Object-space field mapping for a finite conjugate — the seam § 6g.3 left.
 *
 * `renderBrightfield` asks for a pupil by normalized frame position and has no
 * idea what a system is. This is the module that knows: it turns an
 * `OpticalSystem` at a finite conjugate plus a grid into the callback, by
 * tracing the pupil at the object point each frame position actually looks at.
 *
 * ## The chain, and which end the grid lives on
 *
 *     (u, v) ∈ [0,1]²  →  image-plane mm  →  OBJECT height (mm)  →  traced pupil
 *
 * `illumination/abbe` supplies the object as its *geometric image* — the
 * specimen scaled by the magnification, the reduced-coordinate convention — so
 * the grid the patches are blended on is the **image** plane, and the field
 * mapping runs backwards along the chief ray to reach the specimen. That is the
 * finite-conjugate twin of `imaging/scene`'s `fieldAngleFor`, and it is inverted
 * numerically for the same reason: the forward map is a traced chief ray, so it
 * carries distortion, and a division by the paraxial magnification would not.
 * The departure between the two IS the distortion, and § 6h.1 pins that it grows
 * as the cube of the field.
 *
 * ## The frame's size is set by `pupilSamples`, and NOT by the grid
 *
 * The half-extent works out to λ·R·pupilSamples / (4·n′·r_exit), in which the
 * grid size has cancelled: `imagePixelScaleMm` is ∝ 1/size and the extent is
 * size × that. So **raising `size` buys sampling, not field** — it is DFT
 * reciprocity, the same statement as "pupilSamples frequency bins across the
 * pupil ⟺ pupilSamples resolution cells across the image". Referred to the
 * specimen through the sine condition (NA = |M|·NA′) it reads
 *
 *     object half-extent = pupilSamples · λ / (4 · NA)
 *
 * — a closed form in the objective's own traced NA, pinned at § 6h.2.
 *
 * The consequence is a cost statement, not a detail. A brightfield frame spans
 * `pupilSamples` resolution cells whatever else is done to it, so covering a
 * 4×'s real 5 mm field at its 2.75 µm resolution wants pupilSamples ≈ 1800 and a
 * grid to match. At the tractable sampling the rungs use, the frame is *smaller
 * than the objective's isoplanatic patch* and the decomposition is very nearly
 * the identity (§ 6h.5 measures how nearly). That is step 4's framing lesson
 * arriving in the brightfield branch, where it bites harder: `renderField` could
 * resample a PSF onto a coarser scene grid, and this cannot — the Abbe sum's
 * grid IS its frequency lattice.
 *
 * ## One `PupilScale` for the whole frame, read on axis
 *
 * `renderBrightfield` hands one `scale` to every patch, because the patches are
 * blended pixel for pixel and a common ruler is what makes that legal. Each
 * patch's own `opdMap` reports its own `referenceRadius` and `exitRadius`; those
 * are used to *build that patch's pupil* and then deliberately discarded.
 * Threading them into the scale would blend images on different rulers — the
 * same silent rescaling `wave/polychromatic` exists to prevent, and just as
 * invisible to an energy check. What the common ruler costs is the drift of
 * those two numbers across the field, which `fieldPupilAt` reports and § 6h.5
 * measures rather than assumes.
 *
 * ## The rotation is EXACT here, and that is an asymmetry worth naming
 *
 * The engine's field spec is one scalar because the systems are axially
 * symmetric, so every traced pupil belongs to a field point on +x. A frame
 * position has an azimuth, and the pupil must be turned to it or every patch's
 * coma would point the same way — `imaging/render`'s `rotateKernel` argument,
 * one layer earlier in the pipeline.
 *
 * One layer earlier is the whole difference. `rotateKernel` turns a sampled
 * array, so it interpolates and has to renormalize the energy it loses.
 * `rotatePupil` turns a **callback**: the coordinates are rotated before the
 * pupil is ever sampled, so there is no resampling, no lost energy and nothing
 * to renormalize. § 6h.3 pins the two against each other at the angles where
 * `rotateKernel` is itself exact, which is what keeps the conventions from
 * drifting apart the way § 3c's did.
 *
 * ## Cost, and one cliff
 *
 * Per frame position: one `opdMap` (a pupil grid of rays), one Zernike fit. That
 * is the cheap half — `renderBrightfield` then pays patches² × source points ×
 * one N² transform on top.
 *
 * The cliff is vignetting. `pupilFunctionFromOpd`'s vignette predicate re-traces
 * a ray on **every** amplitude query, and where `wave/psf` pays that once per
 * FFT cell, `illumination/abbe` pays it once per lattice point *per source
 * point* — so a vignetting field point multiplies the trace count by the
 * condenser's sampling. Following `psf()`, the mask is built only when the trace
 * already shows loss (`map.lost > 0`), and `FieldPupil.lost` is reported so a
 * caller can see the corner it is about to pay for.
 *
 * ## Two deferrals, named rather than papered over
 *
 * **The grid itself is not warped.** Distortion is carried in the *pupil
 * assignment* — each patch gets the pupil of the object point its own image
 * position really comes from — but each patch's `abbeImage` is still formed on
 * the undistorted grid, so a specimen authored by uniform scaling is placed by
 * the paraxial map. `objectPointAt` exposes the object-plane coordinate of a
 * frame position so a distortion-carrying rasterizer has its seam; that
 * rasterizer is not built here.
 *
 * **Telecentricity is assumed.** Every patch is handed the same `CondenserSource`
 * with its points centred on the pupil, which says the illumination cone stays
 * centred at every field point. § 6a lists object-space ray aiming as an open
 * blocker and this inherits it: a non-telecentric condenser would shift each
 * patch's source points along with its chief ray, and `shiftPupil` is already
 * the operator that would do it.
 */

/** Where a frame position looks, and what it looks through. */
export interface FieldPupil extends PatchPupil {
  /** Object height (mm from the axis) this frame position sees. */
  readonly objectHeightMm: number;
  /** Azimuth the traced +x pupil was turned by (radians). */
  readonly azimuthRad: number;
  /** Image-plane radius (mm) of the frame position, before inversion. */
  readonly imageRadiusMm: number;
  /** This field point's own reference-sphere radius (mm) — NOT used for scale. */
  readonly referenceRadius: number;
  /** This field point's own exit-pupil semi-diameter (mm) — likewise. */
  readonly exitRadius: number;
  /** Rays lost to vignetting in this field point's trace. */
  readonly lost: number;
  /** RMS OPD in waves about its own mean, from the trace. */
  readonly rmsWaves: number;
  /** The Zernike fit the pupil's phase is sampled from, before rotation. */
  readonly fit: ZernikeFit;
}

/**
 * The common grid every patch of a brightfield frame is formed on.
 *
 * Built from ONE on-axis trace, which is what fixes the ruler; see the header
 * for why a per-patch ruler is not an option.
 */
export interface ObjectFieldFrame {
  readonly size: number;
  readonly pupilSamples: number;
  readonly wavelengthNm: number;
  /** The scale `renderBrightfield` must be handed, read on axis. */
  readonly scale: PupilScale;
  /** Image-plane mm per pixel. */
  readonly pixelScaleMm: number;
  /** Half the frame's image-plane extent (mm). */
  readonly halfExtentMm: number;
  /**
   * Lateral magnification (signed, negative for a real inverted image), traced
   * at `probeHeightMm`.
   *
   * Small enough that distortion has not yet bitten, so this is the **linear
   * reference** the inverse map's departure is measured against — not a claim
   * that the map is linear. The map itself never uses it except as a bracket.
   */
  readonly magnification: number;
  /** Object-plane mm per pixel — what a specimen is authored in. */
  readonly objectPixelScaleMm: number;
  /** Half the frame's extent on the specimen (mm). */
  readonly objectHalfExtentMm: number;
  readonly probeHeightMm: number;
}

/** What tracing one field point needs — `psf()`'s options, minus the transform. */
export interface FieldPupilOptions {
  /** Pupil grid resolution for the TRACE, as in `psf()`. Default 21. */
  readonly traceSamples?: number;
  /** Zernike terms fitted to the traced OPD, as in `psf()`. Default 28. */
  readonly zernikeTerms?: number;
  readonly aim?: AimOptions;
  /** Central obstruction, passed through to the pupil. Default 0. */
  readonly obstruction?: number;
  /** Spider vanes, passed through to the pupil. */
  readonly spider?: SpiderSpec;
}

export interface ObjectFieldOptions extends FieldPupilOptions {
  /** Grid size, a power of two — the same `size` the `ObjectField` has. */
  readonly size: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Defaults to the system's highest-weighted wavelength. */
  readonly wavelengthNm?: number;
  /**
   * Object height the linear reference magnification is read at (mm). Defaults
   * to 1e-4 of the conjugate distance, which is deep inside the paraxial regime
   * for every objective in the ladder and still far above f64 noise.
   */
  readonly probeHeightMm?: number;
}

function requireFinite(system: OpticalSystem, who: string): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error(
      `${who}: needs a finite conjugate — at infinity the field is an angle and ` +
        `imaging/scene's fieldAngleFor is the map`,
    );
  }
  return system.conjugate.distance;
}

/**
 * Rotate a pupil about its centre by `angleRad`, exactly.
 *
 * The picture-space convention is `imaging/render`'s `rotateKernel`: the image
 * this pupil forms is the unrotated one turned counter-clockwise by `angleRad`.
 * Both are written as the same inverse coordinate map, which is why they agree —
 * and § 6h.3 pins that they do rather than trusting the derivation.
 *
 * No interpolation and no renormalization: a `PupilFunction` is a callback, so
 * the rotation happens in the argument and the amplitude and phase that come
 * back are the ones the trace actually produced.
 */
export function rotatePupil(pupil: PupilFunction, angleRad: number): PupilFunction {
  if (angleRad === 0) return pupil;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  // Inverse rotation: which pupil point does this query correspond to?
  return {
    amplitude: (px, py) => pupil.amplitude(px * c + py * s, -px * s + py * c),
    phaseWaves: (px, py) => pupil.phaseWaves(px * c + py * s, -px * s + py * c),
  };
}

/**
 * Image-plane radius (mm) the chief ray from an object height reaches.
 *
 * The forward map. `imaging/scene`'s `imagePointOf` is already
 * conjugate-agnostic — it hands its field value straight to `chiefRay`, which
 * reads it as an object height for a finite conjugate — so this is a naming
 * wrapper rather than a second implementation, and the two cannot drift.
 */
export function imageRadiusForObjectHeight(
  system: OpticalSystem,
  objectHeightMm: number,
  wavelengthNm: number,
  options: AimOptions = {},
): number {
  requireFinite(system, "imageRadiusForObjectHeight");
  if (objectHeightMm === 0) return 0;
  const p = imagePointOf(system, objectHeightMm, 0, wavelengthNm, options);
  return Math.hypot(p.x, p.y);
}

/**
 * The inverse: which object height's chief ray lands `radiusMm` from the axis?
 *
 * Bisected on the traced forward map, never divided by a magnification, for the
 * reason `fieldAngleFor` gives: the forward map carries distortion, so an
 * inverse that did not would drift away from the field points it is supposed to
 * serve on exactly the systems where it matters. The paraxial estimate is used
 * only to open the bracket.
 *
 * Throws — with the radius in the message — rather than clamping when no object
 * height reaches it. A corner chief ray dying on a real objective is a plausible
 * outcome and a caller needs to see it, not receive the nearest height that
 * happened to work.
 */
export function objectHeightForImageRadius(
  system: OpticalSystem,
  radiusMm: number,
  wavelengthNm: number,
  options: { readonly magnification?: number; readonly aim?: AimOptions } = {},
): number {
  requireFinite(system, "objectHeightForImageRadius");
  if (!(radiusMm > 0)) return 0;
  const aim = options.aim ?? {};
  // A chief ray that misses is reported against the radius that was ASKED for,
  // not against the probe height the bracket happened to be at — a caller
  // debugging a dead frame corner needs the frame coordinate, and the height is
  // an implementation detail of the search.
  const radiusAt = (h: number): number => {
    try {
      return imageRadiusForObjectHeight(system, h, wavelengthNm, aim);
    } catch (cause) {
      throw new Error(
        `objectHeightForImageRadius: no object height reaches image radius ${radiusMm} mm — ` +
          `the chief ray fails by object height ${h} mm (${(cause as Error).message})`,
      );
    }
  };

  const m = Math.abs(options.magnification ?? 0);
  let hi = m > 0 ? radiusMm / m : radiusMm;
  if (!(hi > 0) || !Number.isFinite(hi)) hi = radiusMm;
  let grown = 0;
  while (radiusAt(hi) < radiusMm && grown < 60) {
    hi *= 2;
    grown++;
  }
  if (radiusAt(hi) < radiusMm) {
    throw new Error(
      `objectHeightForImageRadius: no object height reaches image radius ${radiusMm} mm ` +
        `(the traced chief ray tops out at ${radiusAt(hi)} mm by object height ${hi} mm)`,
    );
  }

  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (radiusAt(mid) < radiusMm) lo = mid;
    else hi = mid;
  }
  const h = (lo + hi) / 2;
  // The bisection assumes the forward map is increasing. It is, for every system
  // whose field this engine can express — but a bracket that closed on the wrong
  // branch would return a plausible height for the wrong field point, so the
  // residual is checked rather than trusted.
  const residual = Math.abs(radiusAt(h) - radiusMm);
  if (residual > 1e-9 * Math.max(radiusMm, 1e-6)) {
    throw new Error(
      `objectHeightForImageRadius: the traced chief-ray map is not invertible at ` +
        `${radiusMm} mm (closed on object height ${h} mm, which lands at ` +
        `${radiusAt(h)} mm)`,
    );
  }
  return h;
}

/**
 * Build the common grid a brightfield frame is formed on.
 *
 * One on-axis trace: it fixes the ruler (`scale`), and with the probe chief ray
 * it fixes the linear reference magnification. Everything field-dependent is
 * deferred to `fieldPupilAt`.
 */
export function objectFieldFrame(
  system: OpticalSystem,
  options: ObjectFieldOptions,
): ObjectFieldFrame {
  const distance = requireFinite(system, "objectFieldFrame");
  const { size, pupilSamples } = options;
  if (!isPowerOfTwo(size)) throw new Error(`frame size must be a power of two, got ${size}`);
  if (!(pupilSamples > 0)) throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  const wavelengthNm = options.wavelengthNm ?? primaryWavelength(system);
  const aim = options.aim ?? {};

  const map = opdMap(system, 0, wavelengthNm, pupilGrid(options.traceSamples ?? 21), aim);
  const scale: PupilScale = {
    referenceRadius: map.referenceRadius,
    exitRadius: map.pupil.exit.radius,
    wavelengthNm,
    nImage: map.pupil.exit.n,
  };
  const pixelScaleMm = imagePixelScaleMm(scale, size, pupilSamples);
  const halfExtentMm = (size / 2) * pixelScaleMm;

  const probeHeightMm = options.probeHeightMm ?? distance * 1e-4;
  const magnification = lateralMagnification(system, probeHeightMm, wavelengthNm);
  const absM = Math.abs(magnification);
  if (!(absM > 0)) {
    throw new Error("objectFieldFrame: the traced magnification is zero — no object field exists");
  }

  return {
    size,
    pupilSamples,
    wavelengthNm,
    scale,
    pixelScaleMm,
    halfExtentMm,
    magnification,
    objectPixelScaleMm: pixelScaleMm / absM,
    objectHalfExtentMm: halfExtentMm / absM,
    probeHeightMm,
  };
}

/** Image-plane coordinates (mm) of a normalized frame position. */
export function imagePointAt(
  frame: ObjectFieldFrame,
  u: number,
  v: number,
): { x: number; y: number } {
  return {
    x: (u - 0.5) * 2 * frame.halfExtentMm,
    y: (v - 0.5) * 2 * frame.halfExtentMm,
  };
}

/**
 * Object-plane coordinates (mm) of a normalized frame position, on the traced
 * map — so this one carries distortion where `imagePointAt / M` would not.
 *
 * The seam a distortion-carrying rasterizer would attach to. Nothing in the
 * imaging path warps the grid yet (see the header), so this is a readout.
 */
export function objectPointAt(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  u: number,
  v: number,
  options: FieldPupilOptions = {},
): { x: number; y: number; radiusMm: number; azimuthRad: number } {
  const { x, y } = imagePointAt(frame, u, v);
  const imageRadius = Math.hypot(x, y);
  const azimuthRad = imageRadius > 0 ? Math.atan2(y, x) : 0;
  const radiusMm = objectHeightForImageRadius(system, imageRadius, frame.wavelengthNm, {
    magnification: frame.magnification,
    ...(options.aim === undefined ? {} : { aim: options.aim }),
  });
  return {
    x: radiusMm * Math.cos(azimuthRad),
    y: radiusMm * Math.sin(azimuthRad),
    radiusMm,
    azimuthRad,
  };
}

/** One field point's traced pupil, before anything is done with it. */
export interface TracedPupil extends PatchPupil {
  /**
   * Required here, where `PatchPupil` leaves it optional: this one came from a
   * trace by construction, so the thing `illumination/fidelity` needs in order
   * to rule anything but `unknown` is always present.
   */
  readonly sampling: OpdSampling;
  /** The ruler THIS trace produced — its own reference sphere and exit pupil. */
  readonly scale: PupilScale;
  readonly referenceRadius: number;
  readonly exitRadius: number;
  readonly lost: number;
  readonly rmsWaves: number;
  readonly fit: ZernikeFit;
}

/**
 * Trace one field point's pupil — `psf()`'s pipeline, stopped one step early.
 *
 * Trace the OPD, fit it, build the pupil function. What `psf()` does next is
 * transform it; what `abbeImage` does next is sum it over the condenser; what
 * `imaging/emission` does next is stack it over a band.
 *
 * **Conjugate-agnostic**, unlike everything else in this module: `fieldValue` is
 * whatever the system's own field spec means — degrees at infinity, object
 * millimetres at a finite conjugate — because `opdMap` already reads it that
 * way. `fieldPupilAt` is the finite-conjugate wrapper that works out WHICH field
 * value a frame position corresponds to; this is the part that does not care.
 */
export function tracedPupil(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  options: FieldPupilOptions = {},
): TracedPupil {
  const aim = options.aim ?? {};
  const map = opdMap(system, fieldValue, wavelengthNm, pupilGrid(options.traceSamples ?? 21), aim);
  const fit = fitZernike(map.samples, options.zernikeTerms ?? 28);
  // Only when the trace already shows loss — see the header's cost cliff.
  const vignette =
    map.lost > 0 ? vignetteMask(system, map.pupil, fieldValue, wavelengthNm, aim) : undefined;
  const pupil = pupilFunctionFromOpd(map, fit, {
    ...(options.obstruction === undefined ? {} : { obstruction: options.obstruction }),
    ...(options.spider === undefined ? {} : { spider: options.spider }),
    ...(vignette === undefined ? {} : { vignette }),
  });
  return {
    pupil,
    sampling: opdSampling(map, fit),
    scale: {
      referenceRadius: map.referenceRadius,
      exitRadius: map.pupil.exit.radius,
      wavelengthNm,
      nImage: map.pupil.exit.n,
    },
    referenceRadius: map.referenceRadius,
    exitRadius: map.pupil.exit.radius,
    lost: map.lost,
    rmsWaves: map.rmsWaves,
    fit,
  };
}

/**
 * Trace the pupil a normalized frame position looks through.
 *
 * `tracedPupil` at the object height this frame position sees, turned to the
 * position's own azimuth. The field mapping is the part that needs a finite
 * conjugate; the tracing underneath does not.
 */
export function fieldPupilAt(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  u: number,
  v: number,
  options: FieldPupilOptions = {},
): FieldPupil {
  requireFinite(system, "fieldPupilAt");
  const aim = options.aim ?? {};
  const { x, y } = imagePointAt(frame, u, v);
  const imageRadiusMm = Math.hypot(x, y);
  const azimuthRad = imageRadiusMm > 0 ? Math.atan2(y, x) : 0;
  const objectHeightMm = objectHeightForImageRadius(system, imageRadiusMm, frame.wavelengthNm, {
    magnification: frame.magnification,
    aim,
  });

  const traced = tracedPupil(system, objectHeightMm, frame.wavelengthNm, options);

  return {
    pupil: rotatePupil(traced.pupil, azimuthRad),
    sampling: traced.sampling,
    objectHeightMm,
    azimuthRad,
    imageRadiusMm,
    referenceRadius: traced.referenceRadius,
    exitRadius: traced.exitRadius,
    lost: traced.lost,
    rmsWaves: traced.rmsWaves,
    fit: traced.fit,
  };
}

/**
 * The callback `renderBrightfield` asks for, closed over a system and a frame.
 *
 * This is the whole point of the module: with it, a brightfield render runs on a
 * *traced* objective, and `illumination/fidelity`'s verdict stops reading
 * `unknown` — a `PatchPupil` from here carries the sampling of the trace that
 * produced it, which is the one thing a bare `PupilFunction` can never know.
 */
export function tracedFieldPupils(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  options: FieldPupilOptions = {},
): (u: number, v: number) => PatchPupil {
  return (u, v) => fieldPupilAt(system, frame, u, v, options);
}

/** How far the per-field ruler drifts from the on-axis one across a frame. */
export interface ScaleDrift {
  /** max |R_field/R_axis − 1| over the sampled positions. */
  readonly referenceRadius: number;
  /** max |r_exit,field/r_exit,axis − 1|. */
  readonly exitRadius: number;
  /** The implied max relative error in `pixelScaleMm` — what one ruler costs. */
  readonly pixelScale: number;
}

/**
 * Measure what the common ruler costs, by sampling the corners and edges.
 *
 * `renderBrightfield` blends every patch on one grid, so the exit pupil moving
 * with the field is an error the blend cannot see. Reported as a number rather
 * than assumed negligible — § 6h.5 pins it on the DIN 4×.
 */
export function scaleDrift(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  options: FieldPupilOptions = {},
  positions: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.5, 0],
    [0, 0.5],
  ],
): ScaleDrift {
  let referenceRadius = 0;
  let exitRadius = 0;
  let pixelScale = 0;
  for (const [u, v] of positions) {
    const p = fieldPupilAt(system, frame, u, v, options);
    const dR = Math.abs(p.referenceRadius / frame.scale.referenceRadius - 1);
    const dr = Math.abs(p.exitRadius / frame.scale.exitRadius - 1);
    referenceRadius = Math.max(referenceRadius, dR);
    exitRadius = Math.max(exitRadius, dr);
    // pixelScale ∝ R / r_exit, so the two drifts enter as a ratio.
    const scaled = Math.abs(
      (p.referenceRadius / p.exitRadius) /
        (frame.scale.referenceRadius / frame.scale.exitRadius) -
        1,
    );
    pixelScale = Math.max(pixelScale, scaled);
  }
  return { referenceRadius, exitRadius, pixelScale };
}
