import { Rng, poisson } from "../math/random";

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
