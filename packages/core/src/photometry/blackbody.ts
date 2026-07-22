/**
 * Sources — for now, thermal ones.
 *
 * A star is a blackbody to a very good first approximation, and that is
 * exactly what the step-4 hero scene needs: a spectrum to weight wavelengths
 * by, with a single physically meaningful knob (temperature) rather than an
 * invented curve. Vega is ~9600 K, the Sun ~5772 K, Betelgeuse ~3600 K, and
 * the difference between those is visible in the rendered image.
 *
 * SCOPE. This file is spectral *shape* and absolute spectral radiance. Star
 * magnitudes → photon flux through an aperture is a different calculation
 * (zero points, band passes, aperture area, exposure) and is deliberately not
 * here: it is on the validation ladder as a later rung, and inventing it
 * unpinned would put a plausible number in front of the user.
 */

/** CODATA 2018. */
const PLANCK_H = 6.62607015e-34; // J·s
const SPEED_OF_LIGHT = 2.99792458e8; // m/s
const BOLTZMANN_K = 1.380649e-23; // J/K

/** Wien displacement constant b, in m·K (CODATA 2018). */
export const WIEN_DISPLACEMENT = 2.897771955e-3;

/**
 * Planck's law as spectral radiance per unit *wavelength*,
 * W·sr⁻¹·m⁻³, for a wavelength in nanometres.
 *
 * Per-wavelength, not per-frequency: the two forms peak at different places
 * (Wien's constant differs by a factor of ~1.76), and every wavelength-domain
 * calculation downstream — the CMF integral above all — is in this one.
 */
export function planckSpectralRadiance(nm: number, temperatureK: number): number {
  if (!(nm > 0)) throw new Error(`wavelength must be positive, got ${nm}`);
  if (!(temperatureK > 0)) throw new Error(`temperature must be positive, got ${temperatureK}`);
  const lambda = nm * 1e-9;
  const numerator = 2 * PLANCK_H * SPEED_OF_LIGHT * SPEED_OF_LIGHT;
  const exponent = (PLANCK_H * SPEED_OF_LIGHT) / (lambda * BOLTZMANN_K * temperatureK);
  // exp() overflows to Infinity in the far UV of a cool source; that limit is
  // zero radiance, which is what 1/Infinity gives, so no special case is needed.
  return numerator / (lambda ** 5 * (Math.exp(exponent) - 1));
}

/** Wavelength (nm) of peak spectral radiance — Wien's displacement law. */
export function wienPeakNm(temperatureK: number): number {
  if (!(temperatureK > 0)) throw new Error(`temperature must be positive, got ${temperatureK}`);
  return (WIEN_DISPLACEMENT / temperatureK) * 1e9;
}

/**
 * A blackbody spectrum scaled to peak at 1.
 *
 * Relative shape is all the imaging layer can honestly use until photometric
 * zero points land, and unscaled Planck radiance is ~10¹³ in SI, which is a
 * poor thing to hand to a renderer as "brightness".
 */
export function blackbodySpectrum(temperatureK: number): (nm: number) => number {
  const peak = planckSpectralRadiance(wienPeakNm(temperatureK), temperatureK);
  return (nm: number) => planckSpectralRadiance(nm, temperatureK) / peak;
}
