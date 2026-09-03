import { WavelengthSample } from "../trace/system";

/**
 * Star magnitudes → photon flux: the zero point § 3a deliberately left out.
 *
 * Everything the imaging layer has produced so far is relative — a blackbody
 * normalized to peak at 1, an exposure that is a ratio of cones (§ 5s). That
 * was the right refusal while there was no pinned number to hang an absolute
 * on: a photon count in front of the user that nobody could check is worse
 * than none, and shot noise, which is a draw from that count, had to wait
 * with it. This module is the pin.
 *
 * ## The system is AB, and the zero point is a definition
 *
 * The AB magnitude (Oke & Gunn 1983) is defined on the spectral flux density
 * per unit FREQUENCY:
 *
 *     m_AB = −2.5·log₁₀( f_ν / 3631 Jy ),        1 Jy = 10⁻²⁶ W·m⁻²·Hz⁻¹
 *
 * so a source of m_AB = 0 has f_ν = 3631 Jy at every frequency, by definition
 * and not by measurement. The Vega system's V-band zero point is a measured
 * spectrum of one star, and the two agree in V to about 0.02 mag — which is
 * why the textbook "a V = 0 star delivers ~1000 photons·s⁻¹·cm⁻²·Å⁻¹ at
 * 550 nm" comes out of this module at 996 (VALIDATION § 8a.2). AB is the one
 * the engine carries because it is the one with no table in it.
 *
 * ## The photon count through a band is the AB magnitude alone
 *
 * This is the result that makes the module small. A photon of wavelength λ
 * carries hc/λ, and f_λ = f_ν·c/λ², so the photon rate per unit wavelength is
 *
 *     ṅ(λ) = f_λ / (hc/λ) = f_ν / (h·λ)
 *
 * and the count through a top-hat band [λ₁, λ₂] is
 *
 *     N = (1/h) ∫ f_ν(λ) dλ/λ.
 *
 * Now the broadband AB magnitude of a NON-flat spectrum through a
 * photon-counting bandpass S is defined (Fukugita et al. 1996) with exactly
 * that weighting — ⟨f_ν⟩ = ∫ f_ν S dν/ν / ∫ S dν/ν, and dν/ν = −dλ/λ — so for
 * S = 1 on the band the SAME integral appears in the magnitude and in the
 * photon count. Eliminating it:
 *
 *     N = (3631 Jy / h) · 10^(−0.4·m_AB) · ln(λ₂/λ₁)        photons·s⁻¹·m⁻²
 *
 * for ANY spectral shape. The shape decides how the photons are distributed
 * across the band (`photonSamples` below) and nothing about how many there
 * are. That is the closed form § 8a pins, and it is why no quadrature over a
 * blackbody is needed to say how bright a star is.
 *
 * ## What is not here
 *
 * Atmospheric extinction, a filter curve that is not a top hat, and the
 * detector's quantum efficiency are all multipliers a caller applies; the
 * Vega-system colour terms are a table and stay out (see the module note on
 * `blackbody.ts`, whose refusal this module honours by being AB rather than
 * Vega). The photon count is at the ENTRANCE PUPIL: what the optics transmit
 * is the wave layer's, already carried as the PSF's `energy` (§ 2b's Parseval
 * rung), so nothing here double-counts a Fresnel loss.
 */

/** Oke & Gunn (1983): f_ν of an AB = 0 source, in janskys. A definition. */
export const AB_ZERO_POINT_JY = 3631;
/** 1 Jy = 10⁻²⁶ W·m⁻²·Hz⁻¹. */
export const JANSKY_W_PER_M2_HZ = 1e-26;
/** CODATA 2018, exact by the 2019 SI. */
const PLANCK_H_J_S = 6.62607015e-34;
const SPEED_OF_LIGHT_M_S = 2.99792458e8;

/** A top-hat passband in nanometres. */
export interface PassBand {
  readonly fromNm: number;
  readonly toNm: number;
}

function checkBand(band: PassBand): void {
  if (!(band.fromNm > 0) || !(band.toNm > band.fromNm)) {
    throw new Error(`passband must satisfy 0 < fromNm < toNm, got ${band.fromNm}…${band.toNm} nm`);
  }
}

function checkMagnitude(magnitudeAB: number): void {
  if (!Number.isFinite(magnitudeAB)) throw new Error(`magnitude must be finite, got ${magnitudeAB}`);
}

/** Spectral flux density per unit frequency of an AB source, W·m⁻²·Hz⁻¹. */
export function fluxDensityAB(magnitudeAB: number): number {
  checkMagnitude(magnitudeAB);
  return AB_ZERO_POINT_JY * JANSKY_W_PER_M2_HZ * Math.pow(10, -0.4 * magnitudeAB);
}

/**
 * Spectral flux density per unit WAVELENGTH of an AB source at `nm`,
 * W·m⁻²·nm⁻¹ — f_λ = f_ν·c/λ².
 *
 * This is the quantity the Vega-system zero points are tabulated in —
 * erg·s⁻¹·cm⁻²·Å⁻¹, and one of those is 10⁻² W·m⁻²·nm⁻¹ (10⁻⁷ W per erg/s,
 * 10⁴ cm² per m², 10 Å per nm) — and it is what § 8a.2 compares.
 */
export function spectralFluxDensityAB(magnitudeAB: number, nm: number): number {
  if (!(nm > 0)) throw new Error(`wavelength must be positive, got ${nm}`);
  const lambdaM = nm * 1e-9;
  // W·m⁻²·m⁻¹, then per nanometre.
  return ((fluxDensityAB(magnitudeAB) * SPEED_OF_LIGHT_M_S) / (lambdaM * lambdaM)) * 1e-9;
}

/**
 * Photon rate per unit wavelength of an AB source at `nm`,
 * photons·s⁻¹·m⁻²·nm⁻¹ — ṅ(λ) = f_ν/(h·λ).
 */
export function photonSpectralFluxAB(magnitudeAB: number, nm: number): number {
  if (!(nm > 0)) throw new Error(`wavelength must be positive, got ${nm}`);
  const lambdaM = nm * 1e-9;
  return (fluxDensityAB(magnitudeAB) / (PLANCK_H_J_S * lambdaM)) * 1e-9;
}

/**
 * Photons·s⁻¹·m⁻² through a top-hat band from an AB source of any spectral
 * shape — the closed form in the module note:
 *
 *     N = (f_ν(m_AB) / h) · ln(λ₂/λ₁)
 *
 * No quadrature: the band-averaged AB magnitude is defined with the same
 * dλ/λ weighting the photon count carries, so the shape cancels exactly.
 */
export function photonFluxAB(magnitudeAB: number, band: PassBand): number {
  checkBand(band);
  return (fluxDensityAB(magnitudeAB) / PLANCK_H_J_S) * Math.log(band.toNm / band.fromNm);
}

/**
 * The AB reference's OWN spectral shape, per unit wavelength: f_λ ∝ 1/λ².
 *
 * Flat in f_ν is what m_AB = 0 means at every frequency, so this is the shape
 * with no table in it — the same status the zero point has. It is the default
 * shape for a **sky background**, and the reason is that the alternative is
 * worse rather than that this one is right: a real night sky is airglow lines
 * plus scattered moonlight plus zodiacal light, which is data, and borrowing
 * the *star's* blackbody would make the background's colour a function of the
 * star's temperature slider — wrong, and invisible in the picture.
 *
 * Handed to `photonSamples` it gives each bin exactly `ln(λ_{i+1}/λ_i)` of the
 * band's photons, which is the dλ/λ measure the whole module runs on; § 8a.3
 * pins that to 1e-6, so this shape arrives with its own consistency check.
 */
export function abReferenceSpectrum(nm: number): number {
  if (!(nm > 0)) throw new Error(`wavelength must be positive, got ${nm}`);
  return 1 / (nm * nm);
}

/**
 * Photons·s⁻¹·m⁻²·**arcsec⁻²** from a surface brightness in mag·arcsec⁻² —
 * the sky, in the same closed form a star gets.
 *
 * There is no new arithmetic here and that IS the content: a surface brightness
 * is a magnitude per unit solid angle, so `photonFluxAB`'s
 * (f_ν/h)·ln(λ₂/λ₁) applies to it unchanged and comes back per unit solid
 * angle too. What the separate name buys is that the units of the ANSWER are
 * different, and a rate per arcsec² handed to something expecting a total is a
 * silent error of ~10¹⁰ on a pixel — so the two are not interchangeable at a
 * call site even though they are the same multiplication.
 *
 * Turning it into photons on a pixel is `imaging/noise`'s `skyPhotonsPerPixel`:
 * this rate times the pixel's solid angle times the collecting area times the
 * time. That product is an étendue, and § 8b measures it two ways.
 */
export function surfaceBrightnessPhotonFlux(surfaceBrightnessAB: number, band: PassBand): number {
  return photonFluxAB(surfaceBrightnessAB, band);
}

export interface PhotonSamplingOptions {
  /** Number of wavelengths. Default 9 (ARCHITECTURE's 7–15 band). */
  readonly count?: number;
  /** Trapezoid steps used to photon-weight the shape across each bin. Default 32. */
  readonly binSteps?: number;
}

/**
 * The engine's wavelength samples for a source of known AB magnitude and
 * spectral SHAPE, with `weight` in **photons·s⁻¹·m⁻² per sample**.
 *
 * `spectralShape` is an energy SED up to scale — `blackbodySpectrum(T)` is
 * the intended argument — and is never asked for its absolute level: the
 * level is the magnitude's (`photonFluxAB`), and the shape decides only the
 * split. Photon weighting is shape(λ)·λ, because the same energy buys more red
 * photons than blue; each bin's share is that integral over the bin, and the
 * shares are normalized to sum to the closed-form total exactly. So a shape
 * flat per unit wavelength gives weights ∝ λ·Δλ, and the AB reference itself
 * — flat in f_ν, which is 1/λ² per unit wavelength — gives ∝ ln(λ_{i+1}/λ_i),
 * the dλ/λ measure the whole module runs on.
 *
 * The sample positions are `spectralSamples`' midpoint grid, so a caller can
 * hand these straight to `spectralXyzBasis` and to a `SpectralStack`; what
 * changes is only what a weight means.
 */
export function photonSamples(
  spectralShape: (nm: number) => number,
  magnitudeAB: number,
  band: PassBand,
  options: PhotonSamplingOptions = {},
): WavelengthSample[] {
  checkBand(band);
  const count = options.count ?? 9;
  const binSteps = options.binSteps ?? 32;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${count}`);
  }
  const step = (band.toNm - band.fromNm) / count;
  const shares = new Array<number>(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const a = band.fromNm + i * step;
    const b = a + step;
    let acc = 0;
    for (let j = 0; j <= binSteps; j++) {
      const nm = a + (j * (b - a)) / binSteps;
      const photonWeighted = spectralShape(nm) * nm;
      if (!(photonWeighted >= 0)) {
        throw new Error(`spectral shape must be non-negative and finite, got ${spectralShape(nm)} at ${nm} nm`);
      }
      acc += (j === 0 || j === binSteps ? 0.5 : 1) * photonWeighted;
    }
    shares[i] = acc / binSteps;
    total += shares[i]!;
  }
  if (!(total > 0)) throw new Error("spectral shape is zero across the whole band");
  const photons = photonFluxAB(magnitudeAB, band);
  const out: WavelengthSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ nm: band.fromNm + (i + 0.5) * step, weight: (photons * shares[i]!) / total });
  }
  return out;
}
