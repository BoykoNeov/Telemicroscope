import { Rng, poisson } from "../math/random";
import { WavelengthSample } from "../trace/system";
import { ARCSEC_PER_RAD } from "./camera";

/**
 * Shot noise — the draw ROADMAP kept deferring until there was a photon
 * count to draw from.
 *
 * Photon arrivals at a detector are a Poisson process, so a pixel that
 * expects μ photons over the exposure records Poisson(μ) of them. That is the
 * whole of shot noise: no parameter, no model, one draw per pixel from the
 * expectation the optics and the zero point (§ 8a) have already produced. Its
 * signature is that the variance equals the mean, so the signal-to-noise of a
 * flat field is √N — the law every exposure calculator rests on, and the one
 * § 8a.5 pins.
 *
 * The expectation is in PHOTONS, not in the renderer's relative units: a
 * caller who hands a normalized image here gets a draw whose noise is wrong by
 * exactly the scale that was left out, and nothing downstream can tell. The
 * route from a rendered stack to an expectation is: per-wavelength image
 * intensity divided by the CLEAR-aperture energy on the same grid
 * (`clearApertureEnergy`), times that sample's photon weight
 * (`photonSamples`), times the light grasp (`collectedPhotonRate`'s area),
 * times seconds.
 *
 * That denominator is the CLEAR aperture and not the plane's own `energy`,
 * which is what this note said until § 8a.7 measured it: a plane's energy has
 * the obstruction and the Fresnel loss already subtracted, so dividing by it
 * normalizes them away and a 200 mm Newtonian records what a clear 200 mm
 * would. The same factor is why a sky background carries a `throughput`
 * (§ 8b).
 *
 * Read noise, dark current and quantization are detector properties and are
 * not here; each is a separate draw a sensor model would add on top, with its
 * own published characterization. Not modelling them is not an approximation
 * of them.
 */

/**
 * Draw an image of photon counts from an image of expectations.
 *
 * Row-major, any size; the output has the same layout. Deterministic under a
 * seeded `Rng`, which is what makes a rung out of a random image. A negative
 * or non-finite expectation is refused rather than clamped: it is a sign the
 * caller's units are wrong, and a clamped zero would hide that under a
 * plausible dark pixel.
 */
export function shotNoise(expectedPhotons: Float64Array, rng: Rng): Float64Array {
  const out = new Float64Array(expectedPhotons.length);
  for (let i = 0; i < expectedPhotons.length; i++) {
    const mean = expectedPhotons[i]!;
    if (!(mean >= 0) || !Number.isFinite(mean)) {
      throw new Error(`expected photon count at pixel ${i} must be finite and non-negative, got ${mean}`);
    }
    out[i] = poisson(mean, rng);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * From a rendered stack to a photon count — the route the header names
 * ------------------------------------------------------------------ */

/**
 * A stack's per-wavelength images, and the two weightings they are read under.
 *
 * `samples` is the stack's OWN weighting — an energy SED × Δλ, normalized,
 * which is what the colour observer must be integrated against
 * (`photometry/spectrum`). `photons` is `photonSamples`' weighting of the same
 * spectrum: shape × λ × Δλ, scaled to the closed-form photon total of the
 * source's magnitude. They sit on one grid of wavelengths and mean different
 * things, and the whole of this route is keeping them apart — the draw is
 * photon statistics and must use the second, the colour is a power integral and
 * must use the first.
 *
 * So the check below is on the wavelengths and never on the weights: two
 * weightings of one grid is the intended state, and two different grids is the
 * error. A magnitude quoted over 500–600 nm against a frame rendered over
 * 400–700 would otherwise deliver one band's photons into another band's image
 * and look entirely plausible doing it.
 */
export interface PhotonFrameRequest {
  /** One per wavelength, on a common physical grid, NOT weight-premultiplied. */
  readonly planes: readonly { readonly intensity: Float64Array }[];
  /** The planes' own colour weighting — checked against `photons`, not used. */
  readonly samples: readonly WavelengthSample[];
  /** `photonSamples()`: weight in photons·s⁻¹·m⁻² for that sample. */
  readonly photons: readonly WavelengthSample[];
  /**
   * `wave/psf`'s `clearApertureEnergy` for the grid these planes were formed
   * on — the unobstructed disc, so the obstruction stays a loss. Dividing by a
   * plane's own `energy` instead normalizes the secondary mirror away; the
   * reasoning and the measured numbers are in that function.
   */
  readonly clearEnergy: number;
  /** `imaging/exposure`'s `pointSourceCollection` — the traced entrance-pupil area. */
  readonly collectingAreaMm2: number;
  readonly seconds: number;
}

export interface PhotonExpectation {
  /** Expected photons per pixel, one array per plane, same layout as the input. */
  readonly planes: readonly Float64Array[];
  /**
   * Photons per unit of that plane's own intensity — what each plane was
   * multiplied by. Kept so the draw can be divided back into the render's units
   * without the caller reassembling the product.
   */
  readonly scale: readonly number[];
  /** Photons the entrance pupil admits in each plane over the exposure. */
  readonly admitted: readonly number[];
  /** Photons that plane actually puts on the grid. */
  readonly delivered: readonly number[];
  readonly totalPhotons: number;
  /**
   * Σ delivered / Σ admitted — the pupil's throughput times whatever stayed on
   * the grid, as one number.
   *
   * **It is a reading and not a target, and it is not 1 even for a clear
   * aperture.** Three things are in it and only the first is optics: the pupil's
   * real losses (obstruction, spider, Fresnel — 0.977 for a Newtonian, ~0.90 for
   * an uncoated achromat), light that fell off the grid
   * (`SpectralStack.truncatedFraction` upstream), and the stack's own resampling
   * error, which on the § 8a fixture runs +0.3% to +3.0% per plane and which
   * nothing upstream reports (§ 8a.9). Reported rather than divided out, per
   * `truncatedFraction`'s own rule: a renormalized frame would hide all three
   * under a plausible number.
   */
  readonly deliveredFraction: number;
  /**
   * Sky photons added to **every pixel** of each plane, one entry per plane.
   *
   * Zero from `expectedPhotons`, which counts the source alone; set by
   * `withSkyBackground` (§ 8b). Kept apart from `delivered` on purpose: the sky
   * is light the pupil admits from a direction the source is not in, so folding
   * it into `deliveredFraction` would push that reading past 1 and make it climb
   * with the sky brightness, when what it reports is the PUPIL's throughput.
   */
  readonly skyPerPixel: readonly number[];
  /** Σ over planes and pixels of the background — what the frame holds of the sky. */
  readonly skyPhotons: number;
}

function checkPhotonGrid(request: PhotonFrameRequest): void {
  const { planes, samples, photons } = request;
  if (samples.length !== planes.length || photons.length !== planes.length) {
    throw new Error(
      `a photon frame needs one sample and one photon weight per plane: ${planes.length} planes, ` +
        `${samples.length} samples, ${photons.length} photon weights`,
    );
  }
  for (let i = 0; i < planes.length; i++) {
    const rendered = samples[i]!.nm;
    const counted = photons[i]!.nm;
    if (!(Math.abs(rendered - counted) <= 1e-9 * Math.max(rendered, counted))) {
      throw new Error(
        `the photon weights are on a different wavelength grid from the image: sample ${i} is ` +
          `${rendered} nm in the render and ${counted} nm in the photon count. The magnitude's ` +
          `band and the render's band have to be the same band, sampled the same way — otherwise ` +
          `one band's photons are delivered into another band's image`,
      );
    }
    const weight = photons[i]!.weight;
    if (!(weight >= 0) || !Number.isFinite(weight)) {
      throw new Error(`photon weight at ${counted} nm must be finite and non-negative, got ${weight}`);
    }
  }
  if (!(request.clearEnergy > 0) || !Number.isFinite(request.clearEnergy)) {
    throw new Error(`clearEnergy must be a positive pupil energy, got ${request.clearEnergy}`);
  }
  if (!(request.collectingAreaMm2 > 0) || !Number.isFinite(request.collectingAreaMm2)) {
    throw new Error(
      `collectingAreaMm2 must be a positive entrance-pupil area, got ${request.collectingAreaMm2}` +
        " — a pupil that is not an area has no photon rate (imaging/exposure, § 5s.5)",
    );
  }
  if (!(request.seconds >= 0) || !Number.isFinite(request.seconds)) {
    throw new Error(`exposure must be finite and non-negative, got ${request.seconds} s`);
  }
}

/**
 * The expected photon count per pixel, per wavelength — the route § 8a wrote on
 * this module and left for the app to walk.
 *
 *     N(pixel, λ) = intensity(pixel, λ) / clearEnergy · weight(λ) · area · seconds
 *
 * Left to right: the pixel's share of the photons the entrance pupil admitted at
 * that wavelength (the plane over the CLEAR aperture, so the obstruction and the
 * Fresnel loss survive as losses rather than being normalized away); the
 * source's photon rate in that wavelength's bin per unit area, from its
 * magnitude alone (§ 8a's closed form); the traced entrance-pupil area, in m²
 * because the zero point is; and the integration time.
 *
 * **What is deliberately not in it.** Atmospheric extinction, a filter curve
 * that is not the band, and the detector's quantum efficiency are declared
 * multipliers a caller applies to `weight` or to the result — § 8a's position,
 * unchanged, and each of them is data rather than physics. The sky background is
 * still not in THIS function: it is not the source's light and it does not come
 * through the source's PSF, so it is added afterwards, flat, by
 * `withSkyBackground` (§ 8b).
 */
export function expectedPhotons(request: PhotonFrameRequest): PhotonExpectation {
  checkPhotonGrid(request);
  const { planes, photons, clearEnergy, seconds } = request;
  const areaM2 = request.collectingAreaMm2 * 1e-6;
  const out: Float64Array[] = [];
  const scale: number[] = [];
  const admitted: number[] = [];
  const delivered: number[] = [];
  let total = 0;
  let admittedTotal = 0;
  for (let p = 0; p < planes.length; p++) {
    const src = planes[p]!.intensity;
    const bandPhotons = photons[p]!.weight * areaM2 * seconds;
    const k = bandPhotons / clearEnergy;
    const dst = new Float64Array(src.length);
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i]! * k;
      if (!(v >= 0) || !Number.isFinite(v)) {
        throw new Error(
          `plane ${p} (${photons[p]!.nm} nm) has intensity ${src[i]} at pixel ${i}: an image a ` +
            "photon count is taken off has to be non-negative and finite everywhere",
        );
      }
      dst[i] = v;
      sum += v;
    }
    out.push(dst);
    scale.push(k);
    admitted.push(bandPhotons);
    delivered.push(sum);
    total += sum;
    admittedTotal += bandPhotons;
  }
  return {
    planes: out,
    scale,
    admitted,
    delivered,
    totalPhotons: total,
    deliveredFraction: admittedTotal > 0 ? total / admittedTotal : 0,
    skyPerPixel: planes.map(() => 0),
    skyPhotons: 0,
  };
}

/* ------------------------------------------------------------------ *
 * § 8b — the sky, and the magnitude it hides
 * ------------------------------------------------------------------ */

/**
 * The background, and why it is the one thing on a frame that is NOT an image.
 *
 * A star is a point, so its photons land where the PSF puts them and every
 * factor in `expectedPhotons` is per-pixel. The sky is not a point and not a
 * scene: it is the same surface brightness in every direction the sensor looks,
 * so every pixel receives the same expectation and the background is a
 * CONSTANT — one number per wavelength plane, added after the imaging, not
 * convolved through it. That is why it cannot ride the route above and why it
 * is a separate arrival here.
 *
 * The product is an **étendue**, and the whole physical content of this step is
 * which two factors it is written as:
 *
 *     N_sky = B(λ) · Ω_pixel · A_pupil · τ(λ) · t
 *
 * B is the surface brightness as a rate (`surfaceBrightnessPhotonFlux`,
 * photons·s⁻¹·m⁻²·arcsec⁻²), Ω is what one pixel subtends on the sky (§ 5r's
 * plate scale, squared, since pixels are square), A is the traced entrance
 * pupil (§ 5s), τ the pupil's own throughput at that wavelength, t the
 * exposure. Ω·A is the étendue, and it is invariant: it can equally be written
 * A_pixel · π·sin²u′, the pixel's own area times the traced
 * image-space cone, which is § 5s's `extendedSourceIlluminance` and the
 * *validated* form. `skyPhotonsPerPixelFromCone` computes it that way, and
 * § 8b.3 pins the two against each other — they differ by exactly the sine
 * condition, squared, which is what makes this a reading rather than an
 * identity.
 *
 * **The consequence worth stating**: Ω ∝ (p/f)² and A ∝ D², so the product goes
 * as p²·D²/f² = p²/F² — the sky per pixel depends on the pixel and the focal
 * RATIO and not on the aperture at all, while a star's photons go as D². That
 * is why aperture buys stars and speed buys nebulae, and why the limiting
 * magnitude below improves with D even though the background does not move.
 *
 * ## The sky pays the pupil's losses, exactly as the star does
 *
 * τ is not optional and it is not a "declared multiplier" like extinction or
 * quantum efficiency. Those are data; this is traced, and § 8a.7 is the rung
 * that exists to insist on it. Leaving it out would mean a Newtonian's secondary
 * blocked 2.26% of the star and **none** of the sky, and an uncoated achromat's
 * four surfaces cost the star a tenth of its light and the background nothing —
 * § 8b contradicting § 8a.7 in the same engine. So the callers hand it in, one
 * per plane, as `plane.energy / clearApertureEnergy(...)`: the same ratio § 8a.7
 * pins at 1 − ε², chromatic because Fresnel is, which also tints the background
 * through the glass rather than only dimming it.
 *
 * It is the PUPIL's throughput and not `deliveredFraction`. That reading also
 * carries light that fell off the grid, and for a uniform background nothing
 * does: a pixel loses to its neighbours exactly what it gains from them, so a
 * flat field convolved with a normalized PSF is the same flat field. Only the
 * star's image has an edge to fall off.
 */

/**
 * The pupil's throughput, one per wavelength plane: `plane.energy` over
 * `clearApertureEnergy` on the same grid.
 *
 * Required, and required in both spellings, because it is the factor § 8a.7
 * exists to keep — see the section note. A caller with a lossless pupil passes
 * ones and says so; a caller who does not have the number yet does not have a
 * background either.
 */
export type PupilThroughput = readonly number[];

/** The two lengths a sky count needs, in the plate-scale spelling. */
export interface SkyGeometry {
  /** `plateScale().arcsecPerPixel`, READ AT `pixelPitchMm`. Ω is this squared. */
  readonly arcsecPerPixel: number;
  /** The pitch that angle belongs to (mm) — carried so the frame can check it. */
  readonly pixelPitchMm: number;
  /** `pointSourceCollection()` — the traced entrance-pupil area, mm². */
  readonly collectingAreaMm2: number;
  readonly throughput: PupilThroughput;
  readonly seconds: number;
}

/** The same, in the cone spelling — § 5s's own quantities. */
export interface SkyConeGeometry {
  /** The sensor's pixel pitch (mm). Its area is what the cone lights. */
  readonly pixelPitchMm: number;
  /** `extendedSourceIlluminance()` — π·sin²u′ off the TRACED marginal ray. */
  readonly illuminance: number;
  readonly throughput: PupilThroughput;
  readonly seconds: number;
}

/**
 * A background, and the pixel it is a background ON.
 *
 * The pitch travels with the counts because the count is per PIXEL and a pixel
 * is a length: the same sky on a 5 µm sensor pixel and on a 0.4 µm diffraction
 * grid cell differ by 150×, both are plausible numbers, and neither array can be
 * told from the other. `withSkyBackground` makes the caller name the pitch of
 * the frame it is adding to and refuses the mismatch — the same guard, and for
 * the same reason, as `expectedPhotons`' check that the magnitude's band is the
 * render's band.
 */
export interface SkyBackground {
  /** Expected sky photons in one pixel over the exposure, per wavelength plane. */
  readonly perPlane: readonly number[];
  /** The pixel pitch these counts are for (mm). */
  readonly pixelPitchMm: number;
}

/** Σ over the planes — the background one pixel records in total. */
export function skyPerPixelTotal(sky: SkyBackground): number {
  return sky.perPlane.reduce((a, b) => a + b, 0);
}

function checkSkyWeights(
  photons: readonly WavelengthSample[],
  throughput: PupilThroughput,
  seconds: number,
): void {
  if (photons.length === 0) throw new Error("a sky background needs at least one wavelength weight");
  for (const sample of photons) {
    if (!(sample.weight >= 0) || !Number.isFinite(sample.weight)) {
      throw new Error(
        `sky photon weight at ${sample.nm} nm must be finite and non-negative, got ${sample.weight}` +
          " — it is a rate per arcsec² (photometry/magnitude's surfaceBrightnessPhotonFlux)",
      );
    }
  }
  if (throughput.length !== photons.length) {
    throw new Error(
      `the pupil's throughput is per wavelength: ${photons.length} sky weights, ` +
        `${throughput.length} throughputs. It is plane.energy / clearApertureEnergy, and it is ` +
        "chromatic because Fresnel is (§ 8a.7)",
    );
  }
  for (let i = 0; i < throughput.length; i++) {
    const t = throughput[i]!;
    // Not bounded above by 1: `spectralStack`'s resampling can hand back a plane
    // up to 3% heavy (§ 8a.11), and clamping that would hide the open problem
    // rather than report it.
    if (!(t > 0) || !Number.isFinite(t)) {
      throw new Error(
        `the pupil's throughput at ${photons[i]!.nm} nm must be positive and finite, got ${t} — a ` +
          "pupil that passes nothing has no background either, and zero is not a throughput",
      );
    }
  }
  if (!(seconds >= 0) || !Number.isFinite(seconds)) {
    throw new Error(`exposure must be finite and non-negative, got ${seconds} s`);
  }
}

/**
 * Sky photons one pixel expects, per wavelength plane — B·Ω·A·τ·t.
 *
 * `photons` is `photonSamples(abReferenceSpectrum, μ, band)` for a surface
 * brightness μ in mag·arcsec⁻²: the same weights a star gets, read per unit
 * solid angle. The grid is not checked against a render here, because a flat
 * background has no image to be on the wrong grid of — the check belongs at
 * `withSkyBackground`, where the two meet.
 */
export function skyPhotonsPerPixel(
  photons: readonly WavelengthSample[],
  geometry: SkyGeometry,
): SkyBackground {
  checkSkyWeights(photons, geometry.throughput, geometry.seconds);
  const { arcsecPerPixel, pixelPitchMm, collectingAreaMm2, throughput, seconds } = geometry;
  if (!(arcsecPerPixel > 0) || !Number.isFinite(arcsecPerPixel)) {
    throw new Error(`arcsecPerPixel must be a positive angle, got ${arcsecPerPixel}`);
  }
  if (!(pixelPitchMm > 0) || !Number.isFinite(pixelPitchMm)) {
    throw new Error(`pixelPitchMm must be a positive pitch, got ${pixelPitchMm}`);
  }
  if (!(collectingAreaMm2 > 0) || !Number.isFinite(collectingAreaMm2)) {
    throw new Error(
      `collectingAreaMm2 must be a positive entrance-pupil area, got ${collectingAreaMm2}` +
        " — a pupil that is not an area collects no sky either (imaging/exposure, § 5s.5)",
    );
  }
  const solidAngleArcsec2 = arcsecPerPixel * arcsecPerPixel;
  const areaM2 = collectingAreaMm2 * 1e-6;
  return {
    perPlane: photons.map(
      (sample, i) => sample.weight * solidAngleArcsec2 * areaM2 * throughput[i]! * seconds,
    ),
    pixelPitchMm,
  };
}

/**
 * The same count off the **traced image-space cone** — A_pixel·π·sin²u′·L·t.
 *
 * The identical étendue, factored the other way. A surface brightness per
 * arcsec² is a radiance once it is per steradian, which is the 206265²
 * conversion and the only constant in here; the rest is § 5s's validated
 * extended-source law, which carries the sine condition because it is read off
 * a traced ray rather than computed from 1/(2F).
 *
 * This exists to be *compared*, not chosen between: the plate-scale route above
 * is what the frame uses, because it is divided by the same traced pupil area
 * the star's count is and so the two are commensurate; this one is the
 * independent reading that says the first is physics. § 8b.3 measures the gap.
 */
export function skyPhotonsPerPixelFromCone(
  photons: readonly WavelengthSample[],
  geometry: SkyConeGeometry,
): SkyBackground {
  checkSkyWeights(photons, geometry.throughput, geometry.seconds);
  const { pixelPitchMm, illuminance, throughput, seconds } = geometry;
  if (!(pixelPitchMm > 0) || !Number.isFinite(pixelPitchMm)) {
    throw new Error(`pixelPitchMm must be a positive pitch, got ${pixelPitchMm}`);
  }
  if (!(illuminance > 0) || !Number.isFinite(illuminance)) {
    throw new Error(`illuminance must be a positive π·sin²u′, got ${illuminance}`);
  }
  const pixelAreaM2 = pixelPitchMm * pixelPitchMm * 1e-6;
  // per arcsec² → per steradian.
  const perSteradian = ARCSEC_PER_RAD * ARCSEC_PER_RAD;
  return {
    perPlane: photons.map(
      (sample, i) =>
        sample.weight * perSteradian * illuminance * pixelAreaM2 * throughput[i]! * seconds,
    ),
    pixelPitchMm,
  };
}

/**
 * Add a flat background to a source's expectation — the frame a real exposure
 * records.
 *
 * Every pixel of plane p gains `skyPerPixel[p]`, and `admitted` / `delivered` /
 * `deliveredFraction` are left exactly as they were: those are readings of what
 * the pupil did to the SOURCE's light, and the sky is not the source. What
 * changes is `planes` — which is what the draw and the picture see — plus the
 * two new fields that say how much of the frame is background.
 *
 * **The pedestal's colour comes out right, and it is not obvious that it
 * should.** `intensityFromPhotons` divides plane p by the SOURCE's photon
 * scale, so a background built from the sky's own shape is divided by the
 * star's weights — and then collapsed against the star's ENERGY weights by
 * `colorImageFromStack`. Those two weightings of one spectrum differ by exactly
 * a factor λ (a photon carries hc/λ), so the star's spectrum cancels and what
 * survives is the sky's own energy per bin — which is precisely the hc/λ that
 * `intensityFromPhotons`' docstring declines to apply explicitly. The
 * cancellation is exact in the limit of narrow bins and approximate on a real
 * one, because each weighting picks its own mean wavelength inside a bin;
 * § 8b.6 measures the residual and its convergence.
 */
export function withSkyBackground(
  expectation: PhotonExpectation,
  sky: SkyBackground,
  framePixelPitchMm: number,
): PhotonExpectation {
  const skyPerPixel = sky.perPlane;
  if (skyPerPixel.length !== expectation.planes.length) {
    throw new Error(
      `a sky background needs one count per plane: ${expectation.planes.length} planes, ` +
        `${skyPerPixel.length} background counts`,
    );
  }
  if (!(Math.abs(sky.pixelPitchMm - framePixelPitchMm) <= 1e-12 * Math.max(sky.pixelPitchMm, framePixelPitchMm))) {
    throw new Error(
      `the sky was counted on a ${sky.pixelPitchMm} mm pixel and the frame's pixels are ` +
        `${framePixelPitchMm} mm. A background is a count PER PIXEL, so it scales as the pitch ` +
        "squared — adding one frame's background to another's is a factor nothing downstream " +
        "can detect, since both arrays are plausible images",
    );
  }
  const planes: Float64Array[] = [];
  let skyPhotons = 0;
  for (let p = 0; p < expectation.planes.length; p++) {
    const background = skyPerPixel[p]!;
    if (!(background >= 0) || !Number.isFinite(background)) {
      throw new Error(`sky background on plane ${p} must be finite and non-negative, got ${background}`);
    }
    const src = expectation.planes[p]!;
    const dst = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) dst[i] = src[i]! + background;
    planes.push(dst);
    skyPhotons += background * src.length;
  }
  return {
    ...expectation,
    planes,
    skyPerPixel: skyPerPixel.slice(),
    skyPhotons,
  };
}

/**
 * Signal-to-noise of a source measured against a background, both in photons —
 * the CCD equation (Howell, *Handbook of CCD Astronomy*) with every detector
 * term set to zero.
 *
 *     SNR = N / √(N + n·B)
 *
 * N is the source's photons inside the measuring aperture, B the background per
 * pixel, n the pixels the aperture covers. Both terms under the root are
 * Poisson variances and they simply add, which is the whole of it. Read noise,
 * dark current and the variance of the background *estimate* are the terms this
 * leaves out; each is a detector characterization rather than physics, and
 * `shotNoise`'s own note refuses them on the same grounds. So this is the
 * **photon-limited** signal-to-noise, an upper bound on any real sensor's.
 */
export function signalToNoise(sourcePhotons: number, skyPhotonsPerPixelTotal: number, pixels: number): number {
  if (!(sourcePhotons >= 0) || !Number.isFinite(sourcePhotons)) {
    throw new Error(`source photons must be finite and non-negative, got ${sourcePhotons}`);
  }
  if (!(skyPhotonsPerPixelTotal >= 0) || !Number.isFinite(skyPhotonsPerPixelTotal)) {
    throw new Error(`sky photons per pixel must be finite and non-negative, got ${skyPhotonsPerPixelTotal}`);
  }
  if (!(pixels > 0) || !Number.isFinite(pixels)) {
    throw new Error(`the measuring aperture must cover a positive number of pixels, got ${pixels}`);
  }
  const variance = sourcePhotons + pixels * skyPhotonsPerPixelTotal;
  return variance > 0 ? sourcePhotons / Math.sqrt(variance) : 0;
}

export interface LimitingMagnitudeRequest {
  /** The signal-to-noise a detection is declared at. 5 is the convention, not a law. */
  readonly snr: number;
  /** Background in ONE pixel over the exposure, summed over the planes. */
  readonly skyPhotonsPerPixelTotal: number;
  /** Pixels the measuring aperture covers — measured off the frame, not chosen. */
  readonly pixels: number;
  /**
   * Photons an m_AB = 0 source of the same spectrum would deliver INTO that same
   * aperture over the same exposure — throughput and enclosed fraction already
   * in it. The magnitude scale is logarithmic, so every multiplicative factor a
   * caller folds in here moves the answer by a constant number of magnitudes and
   * nothing else.
   */
  readonly zeroMagnitudePhotons: number;
}

export interface LimitingMagnitude {
  /** The faintest AB magnitude that reaches `snr`. */
  readonly magnitudeAB: number;
  /** Photons it has to deliver — the positive root of N² − S²N − S²nB = 0. */
  readonly sourcePhotons: number;
  /** n·B, the background in the aperture. The other term under the root. */
  readonly backgroundPhotons: number;
  /**
   * n·B / N — which term dominates the noise. Below 1 the exposure is
   * source-limited and the limit deepens as t; above 1 it is background-limited
   * and it deepens as √t. § 8b.5 pins both slopes.
   */
  readonly backgroundDominance: number;
}

/**
 * The faintest source a given exposure detects — the sky's whole point.
 *
 * Inverting the CCD equation for N at fixed SNR is a quadratic,
 * N² − S²·N − S²·n·B = 0, whose positive root is
 *
 *     N = ½·( S² + √(S⁴ + 4·S²·n·B) )
 *
 * and the magnitude follows from the zero point: m = −2.5·log₁₀(N / N₀).
 *
 * The two limits are the reason to have it, and they are textbook:
 *
 *  - **B = 0** (no sky): N = S², a constant, so N/N₀ ∝ 1/t and four times the
 *    exposure buys 2.5·log₁₀ 4 = **1.5051 mag**.
 *  - **B ≫ N** (sky-swamped): N → S·√(n·B) ∝ √t, so N/N₀ ∝ 1/√t and the same
 *    four times buys 2.5·log₁₀ 2 = **0.7526 mag** — half as much, for the same
 *    four times the time.
 *
 * Both slopes are independent of n, of B and of the zero point, which is what
 * makes them a pin rather than a fit: they are properties of the equation, and
 * § 8b.5 measures them at several apertures and sky brightnesses.
 */
export function limitingMagnitude(request: LimitingMagnitudeRequest): LimitingMagnitude {
  const { snr, skyPhotonsPerPixelTotal, pixels, zeroMagnitudePhotons } = request;
  if (!(snr > 0) || !Number.isFinite(snr)) {
    throw new Error(`the detection signal-to-noise must be positive, got ${snr}`);
  }
  if (!(skyPhotonsPerPixelTotal >= 0) || !Number.isFinite(skyPhotonsPerPixelTotal)) {
    throw new Error(`sky photons per pixel must be finite and non-negative, got ${skyPhotonsPerPixelTotal}`);
  }
  if (!(pixels > 0) || !Number.isFinite(pixels)) {
    throw new Error(`the measuring aperture must cover a positive number of pixels, got ${pixels}`);
  }
  if (!(zeroMagnitudePhotons > 0) || !Number.isFinite(zeroMagnitudePhotons)) {
    throw new Error(
      `the zero-magnitude count must be positive, got ${zeroMagnitudePhotons} — with no photons from` +
        " an m = 0 source there is no magnitude scale to place a limit on",
    );
  }
  const background = pixels * skyPhotonsPerPixelTotal;
  const s2 = snr * snr;
  const sourcePhotons = 0.5 * (s2 + Math.sqrt(s2 * s2 + 4 * s2 * background));
  return {
    magnitudeAB: -2.5 * Math.log10(sourcePhotons / zeroMagnitudePhotons),
    sourcePhotons,
    backgroundPhotons: background,
    backgroundDominance: background / sourcePhotons,
  };
}

/**
 * Draw one frame: `shotNoise` on every plane, in order, off one generator.
 *
 * Per PLANE rather than on the summed image, because a wavelength bin is where
 * the count is known — and it costs nothing statistically, since a sum of
 * independent Poissons is Poisson of the sum, so a pixel's TOTAL is drawn from
 * the right law either way. What the per-plane draw adds is colour noise, and
 * that is a model rather than a measurement of any real sensor: it is what a
 * detector that counted each bin separately would record. A Bayer mosaic, three
 * broad channels and a monochrome well each redistribute the same photons
 * differently, and none of them is modelled here.
 *
 * One generator threaded through all the planes, so a frame is reproducible from
 * its seed and a plane is not reproducible on its own — which is the right
 * granularity, because the frame is the observation.
 */
export function drawPhotonFrame(expectation: PhotonExpectation, rng: Rng): Float64Array[] {
  return expectation.planes.map((plane) => shotNoise(plane, rng));
}

/**
 * Drawn counts back into the render's own intensity units, so the existing
 * colour collapse can be used unchanged.
 *
 * `colorImageFromStack` integrates the observer against the stack's ENERGY
 * weights, and those are already right — dividing each plane by the scale that
 * made it a count restores exactly the plane the noiseless render had, up to the
 * draw. So the noisy frame and the clean frame are the same image plus Poisson
 * noise, and no second colour basis exists to disagree with the first.
 *
 * The alternative — handing absolute photon planes to the observer — needs an
 * hc/λ per bin first, because the colour-matching functions act on radiant power
 * and not on counts. That conversion is correct, and it is also a second place
 * for the spectrum to enter the colour, so it is not done here.
 *
 * A plane whose scale is zero (a band with no photons in it, or a zero exposure)
 * had nothing to draw and comes back zero rather than dividing by it.
 */
export function intensityFromPhotons(
  counts: readonly Float64Array[],
  expectation: PhotonExpectation,
): Float64Array[] {
  if (counts.length !== expectation.scale.length) {
    throw new Error(
      `drew ${counts.length} planes against an expectation of ${expectation.scale.length}`,
    );
  }
  return counts.map((plane, p) => {
    const k = expectation.scale[p]!;
    if (!(k > 0)) return new Float64Array(plane.length);
    const out = new Float64Array(plane.length);
    for (let i = 0; i < plane.length; i++) out[i] = plane[i]! / k;
    return out;
  });
}
