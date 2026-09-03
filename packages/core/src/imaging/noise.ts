import { Rng, poisson } from "../math/random";
import { WavelengthSample } from "../trace/system";

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
 * intensity divided by the PSF's `energy` (so a pixel value is a FRACTION of
 * the transmitted light), times that sample's photon weight (`photonSamples`),
 * times the light grasp (`collectedPhotonRate`'s area), times seconds.
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
 * not here either: this is the source's own photons, and a limiting magnitude
 * needs the background beside it (OPEN-PROBLEMS A3, still open — the next thing
 * to land, and not something this route forgot).
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
