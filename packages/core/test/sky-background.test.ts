import { describe, it, expect } from "vitest";
import { refractorPair } from "../src/designs/refractor";
import { newtonian } from "../src/designs/newtonian";
import { OpticalSystem } from "../src/trace/system";
import { blackbodySpectrum } from "../src/photometry/blackbody";
import {
  VISIBLE_MAX_NM,
  VISIBLE_MIN_NM,
  spectralSamples,
  spectralXyz,
} from "../src/photometry/spectrum";
import { bestFocus, withFocus } from "../src/analysis/focus";
import {
  PassBand,
  abReferenceSpectrum,
  photonFluxAB,
  photonSamples,
  surfaceBrightnessPhotonFlux,
} from "../src/photometry/magnitude";
import { ARCSEC_PER_RAD, plateScale } from "../src/imaging/camera";
import {
  extendedSourceIlluminance,
  imageSpaceMarginalSin,
  pointSourceCollection,
} from "../src/imaging/exposure";
import {
  SkyBackground,
  expectedPhotons,
  limitingMagnitude,
  shotNoise,
  signalToNoise,
  skyPerPixelTotal,
  skyPhotonsPerPixel,
  skyPhotonsPerPixelFromCone,
  withSkyBackground,
} from "../src/imaging/noise";
import { mulberry32 } from "../src/math/random";
import { clearApertureEnergy } from "../src/wave/psf";
import { SpectralStack, spectralStack } from "../src/wave/polychromatic";
import { PSF_OPTIONS, SOURCE_TEMPERATURE_K, heroPair, renderHero } from "./support/heroScene";

/**
 * § 8b — the sky, and the magnitude it hides.
 *
 * § 8a made a star an absolute photon count. The one thing missing before a
 * frame is an observation is what the star is seen AGAINST: a background is not
 * a nuisance term, it is the quantity that decides how faint an instrument can
 * go, and every exposure-time question a camera panel could not answer was
 * waiting on it.
 *
 * ## What is new physics here and what is not
 *
 * The rate is not new: a surface brightness is a magnitude per unit solid angle,
 * so § 8a's closed form (f_ν/h)·ln(λ₂/λ₁) applies to it with no change at all
 * and comes back per arcsec². What is new is the **étendue** — the product
 * Ω_pixel·A_pupil that turns that rate into photons on a pixel — and the étendue
 * is exactly where a claim can be checked, because it can be written two ways
 * out of two independently validated readings:
 *
 *     N_sky = B · Ω_pixel · A_pupil · τ · t      (§ 5r's plate scale, § 5s's grasp)
 *           = B · A_pixel · π·sin²u′ · τ · t     (§ 5s's extended-source law)
 *
 * with τ the pupil's own throughput at that wavelength (`plane.energy` over
 * `clearApertureEnergy`) — § 8a.7's factor, which the background pays exactly as
 * the star does and which § 8b.2 pins at 1 − ε² on a Newtonian's secondary. The
 * rungs BELOW that one run at a unit throughput on purpose: τ is common to both
 * spellings and to every ratio in them, so leaving it at 1 isolates the étendue
 * rather than hiding it.
 *
 * The second carries the traced marginal ray and the first does not, so the two
 * differ by the sine condition and by nothing else. On a **paraboloid** that
 * difference is a closed form — the sine of the marginal ray off a parabola is
 * a/(1 + a²/4) with a = 1/(2F) exactly, so the two spellings differ by
 * (1 + 1/(16F²))² — and § 8b.3 pins the trace against it to thirteen digits.
 *
 * ## The headline
 *
 * Ω ∝ (p/f)² and A ∝ D², so the sky on a pixel goes as p²·D²/f² = p²/F² and
 * **does not depend on the aperture at all**, while a star's photons go as D².
 * A 400 mm mirror at f/5 collects exactly four times the star of a 200 mm at
 * f/5 and exactly the same sky per pixel — measured here as 4.000000000000 and
 * 1.000000000000, bit-identical, because a conic scales exactly. That is the
 * whole of why aperture buys faint stars and focal ratio buys nebulae, and it
 * is the reason the limiting magnitude below improves with D even though the
 * background it is fighting never moves.
 *
 * ## What is deliberately not modelled
 *
 * A real sky is airglow lines, scattered moonlight and zodiacal light — data,
 * and a table the hard rule keeps out of the engine. The shape here is the AB
 * reference's own (flat in f_ν), which is the choice with nothing measured in
 * it, and the surface brightness is the caller's number. Read noise, dark
 * current and the variance of a background ESTIMATE are detector terms and are
 * absent, so every signal-to-noise below is the photon-limited one — an upper
 * bound on any real sensor's, and honest as such.
 */

const BAND: PassBand = { fromNm: VISIBLE_MIN_NM, toNm: VISIBLE_MAX_NM };
const V_LIKE: PassBand = { fromNm: 500, toNm: 600 };
const FOCUS_NM = 550;

/**
 * A dark-site V surface brightness, and it is an INPUT rather than a pin.
 *
 * 21.8 mag·arcsec⁻² is the number every observing handbook quotes for a good
 * dark site, but it is a measurement of the Earth's atmosphere and not of an
 * optical system, so nothing below is pinned to it: it is the setting the
 * étendue is exercised at, chosen because it puts the readings in a range a
 * reader recognises. Every rung here is a ratio, a closed form or an identity,
 * and each is stated so that changing this constant cannot move it.
 */
const SKY_MAG = 21.8;
const PITCH_MM = 0.005;

function focusedSystem(prescription: OpticalSystem["prescription"], epdMm: number): OpticalSystem {
  const base: OpticalSystem = {
    prescription,
    aperture: { kind: "EPD", value: epdMm },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), { count: 5 }),
    conjugate: { kind: "infinite" },
  };
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return withFocus(base, focus.offsetFromLastVertex);
}

const achromat = (focalMm: number, epdMm: number) =>
  focusedSystem(refractorPair(focalMm, epdMm * 1.5, focalMm).achromat, epdMm);

const mirror = (apertureMm: number, focalRatio: number) =>
  focusedSystem(newtonian({ apertureMm, focalRatio }).prescription, apertureMm);

/** The sky's weights: the AB reference's own shape at a surface brightness. */
const skyWeights = (magnitude = SKY_MAG, count = 5) =>
  photonSamples(abReferenceSpectrum, magnitude, BAND, { count });

/**
 * One system's sky-per-pixel, in both spellings of the same étendue.
 *
 * Deliberately one function returning both: the whole of § 8b.3 is that they
 * are computed from disjoint readings — a paraxial focal length and a traced
 * pupil radius on one side, a traced marginal ray on the other — and agree by
 * a closed form rather than by construction.
 */
function bothRoutes(
  system: OpticalSystem,
  pitchMm = PITCH_MM,
  weights = skyWeights(),
  seconds = 1,
  throughput = weights.map(() => 1),
): {
  plate: SkyBackground;
  cone: SkyBackground;
  plateTotal: number;
  coneTotal: number;
  arcsecPerPixel: number;
  collectingAreaMm2: number;
  tracedSin: number;
} {
  const scale = plateScale(system, { pixelPitchMm: pitchMm, cols: 1, rows: 1 }, FOCUS_NM);
  const collectingAreaMm2 = pointSourceCollection(system, FOCUS_NM);
  const plate = skyPhotonsPerPixel(weights, {
    arcsecPerPixel: scale.arcsecPerPixel,
    pixelPitchMm: pitchMm,
    collectingAreaMm2,
    throughput,
    seconds,
  });
  const cone = skyPhotonsPerPixelFromCone(weights, {
    pixelPitchMm: pitchMm,
    illuminance: extendedSourceIlluminance(system, FOCUS_NM),
    throughput,
    seconds,
  });
  return {
    plate,
    cone,
    plateTotal: skyPerPixelTotal(plate),
    coneTotal: skyPerPixelTotal(cone),
    arcsecPerPixel: scale.arcsecPerPixel,
    collectingAreaMm2,
    tracedSin: imageSpaceMarginalSin(system, FOCUS_NM),
  };
}

/**
 * The app's Newtonian preset, rendered with and without its secondary —
 * `photon-zero-point.test.ts`'s own fixture, because § 8b.2's throughput rung is
 * § 8a.7's rung asked about the background instead of the star.
 */
const NEWTONIAN_MM = 200;
const NEWTONIAN_F = 5;
const NEWTONIAN_PUPIL_SAMPLES = 64;

function newtonianStack(withObstruction: boolean): SpectralStack {
  const scope = newtonian({ apertureMm: NEWTONIAN_MM, focalRatio: NEWTONIAN_F });
  return spectralStack(mirror(NEWTONIAN_MM, NEWTONIAN_F), 0, {
    pupilSamples: NEWTONIAN_PUPIL_SAMPLES,
    padFactor: 4,
    ...(withObstruction ? { obstruction: scope.obstruction } : {}),
  });
}

describe("§ 8b.1 — a surface brightness is a magnitude per solid angle, and the closed form is unchanged", () => {
  it("the same (f_ν/h)·ln(λ₂/λ₁), read per arcsec²: 58.43 over 400–700 nm at 21.8 mag·arcsec⁻²", () => {
    // Not a new derivation and the rung says so: the AB magnitude is defined on
    // a flux density, and dividing both sides by a solid angle leaves the
    // logarithm alone. The check is that the two functions ARE the same number,
    // so a future edit that "improves" one of them has to move both.
    expect(surfaceBrightnessPhotonFlux(SKY_MAG, BAND)).toBe(photonFluxAB(SKY_MAG, BAND));
    expect(surfaceBrightnessPhotonFlux(SKY_MAG, BAND)).toBeCloseTo(58.4333, 3);
    expect(surfaceBrightnessPhotonFlux(SKY_MAG, V_LIKE)).toBeCloseTo(19.0374, 3);
  });

  it("five magnitudes per square arcsecond is a hundredfold, as it is for a star", () => {
    expect(surfaceBrightnessPhotonFlux(17, BAND) / surfaceBrightnessPhotonFlux(22, BAND)).toBeCloseTo(100, 10);
  });

  it("per square DEGREE is 17.7815 magnitudes brighter — the conversion astronomers quote", () => {
    // The standard change of unit, and the one place a solid angle can be got
    // wrong by a factor of 3600 rather than 3600². A brightness of μ per
    // arcsec² is μ − 2.5·log₁₀(3600²) per deg², so the SAME sky counted over a
    // square degree of pixels must give the same photons either way.
    const offset = 2.5 * Math.log10(3600 * 3600);
    expect(offset).toBeCloseTo(17.7815, 4);
    const perArcsec2 = surfaceBrightnessPhotonFlux(SKY_MAG, BAND);
    const perDeg2 = surfaceBrightnessPhotonFlux(SKY_MAG - offset, BAND);
    expect(Math.abs(perDeg2 / (perArcsec2 * 3600 * 3600) - 1)).toBeLessThan(1e-12);
  });

  it("the sky's shape is the AB reference's own, so its bins are exactly ln(λ_{i+1}/λ_i)", () => {
    // § 8a.3's identity, now carrying a load: this is WHY the flat-f_ν shape is
    // the sky's default. It is the shape with no table in it, and it splits the
    // band by the same dλ/λ measure the closed form runs on, so nothing about
    // the background's colour is a fitted choice.
    const s = skyWeights(SKY_MAG, 4);
    const edges = [400, 475, 550, 625, 700];
    const total = surfaceBrightnessPhotonFlux(SKY_MAG, BAND);
    for (let i = 0; i < 4; i++) {
      const share = Math.log(edges[i + 1]! / edges[i]!) / Math.log(700 / 400);
      expect(Math.abs(s[i]!.weight / (total * share) - 1)).toBeLessThan(1e-5);
    }
    expect(Math.abs(s.reduce((a, x) => a + x.weight, 0) / total - 1)).toBeLessThan(1e-12);
  });

  it("refuses a wavelength that is not one", () => {
    expect(() => abReferenceSpectrum(0)).toThrow();
    expect(() => abReferenceSpectrum(-500)).toThrow();
  });
});

describe("§ 8b.2 — the sky on a pixel is an étendue times a throughput: B·Ω·A·τ·t", () => {
  const hero = achromat(100, 10);

  it("a 5 µm pixel on a 10 mm f/10 refractor sees 0.4911 photons a second of a 21.8 sky", () => {
    // Every factor is checkable by hand: 58.4333 photons·s⁻¹·m⁻²·arcsec⁻² times
    // (10.3443″)² of pixel times 78.5398 mm² of traced pupil in m² times 1 s.
    // The plate scale is § 5r's — pitch over the PARAXIAL EFL, which is 99.699
    // mm for this achromat and not the nominal 100, and that 0.3% is already in
    // the 10.3443″.
    const r = bothRoutes(hero);
    expect(r.arcsecPerPixel).toBeCloseTo(10.344348, 5);
    expect(r.collectingAreaMm2).toBeCloseTo(Math.PI * 25, 6);
    const byHand =
      surfaceBrightnessPhotonFlux(SKY_MAG, BAND) *
      r.arcsecPerPixel * r.arcsecPerPixel *
      r.collectingAreaMm2 * 1e-6;
    expect(Math.abs(r.plateTotal / byHand - 1)).toBeLessThan(1e-12);
    expect(r.plateTotal).toBeCloseTo(0.4910846, 6);
  });

  it("linear in the time, quadratic in the pitch, and 100× per five magnitudes", () => {
    const base = bothRoutes(hero).plateTotal;
    expect(
      Math.abs(skyPerPixelTotal(bothRoutes(hero, PITCH_MM, skyWeights(), 30).plate) / (30 * base) - 1),
    ).toBeLessThan(1e-12);
    // Ω ∝ p², so a doubled pitch is four times the sky in one pixel — and four
    // times fewer pixels, which is why a coarse sensor is not a darker one.
    expect(Math.abs(skyPerPixelTotal(bothRoutes(hero, 2 * PITCH_MM).plate) / (4 * base) - 1)).toBeLessThan(1e-12);
    expect(
      Math.abs(skyPerPixelTotal(bothRoutes(hero, PITCH_MM, skyWeights(SKY_MAG - 5)).plate) / (100 * base) - 1),
    ).toBeLessThan(1e-12);
  });

  it("HEADLINE: the sky pays the pupil's losses, and a secondary costs it exactly 1 − ε²", () => {
    // § 8a.7's rung, on the background. That step exists to say the photon
    // denominator is the CLEAR aperture, so an obstruction stays a loss; a sky
    // that skipped the throughput would mean a Newtonian's secondary blocked
    // 2.26% of the star and NONE of the background, which is § 8b contradicting
    // § 8a.7 in the same engine. The throughput is not a declared multiplier
    // like extinction — it is traced, and it lives in `plane.energy`.
    const scope = newtonian({ apertureMm: NEWTONIAN_MM, focalRatio: NEWTONIAN_F });
    const epsilon = scope.obstruction;
    const obstructed = newtonianStack(true);
    const clear = newtonianStack(false);
    const clearEnergy = clearApertureEnergy(NEWTONIAN_PUPIL_SAMPLES, clear.size);
    const throughputOf = (stack: SpectralStack) => stack.planes.map((p) => p.energy / clearEnergy);

    const system = mirror(NEWTONIAN_MM, NEWTONIAN_F);
    const weights = skyWeights(SKY_MAG, clear.planes.length);
    const withSecondary = bothRoutes(system, PITCH_MM, weights, 1, throughputOf(obstructed));
    const without = bothRoutes(system, PITCH_MM, weights, 1, throughputOf(clear));
    expect(
      Math.abs(withSecondary.plateTotal / without.plateTotal / (1 - epsilon * epsilon) - 1),
    ).toBeLessThan(1e-4);
    // Both spellings, because the throughput is common to them and must not
    // change § 8b.3's ratio.
    expect(
      Math.abs(withSecondary.coneTotal / without.coneTotal / (1 - epsilon * epsilon) - 1),
    ).toBeLessThan(1e-4);
    expect(withSecondary.plateTotal / withSecondary.coneTotal).toBeCloseTo(
      without.plateTotal / without.coneTotal,
      12,
    );
  });

  it("an uncoated achromat's four surfaces cost the background a tenth of it, chromatically", () => {
    // Fresnel is chromatic because the index is, so the throughput is a vector
    // and the background is TINTED by the glass rather than only dimmed — which
    // is why it enters per plane and not as one scalar.
    const hero = renderHero(heroPair().achromat);
    const clearEnergy = clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size);
    const throughput = hero.stack.planes.map((p) => p.energy / clearEnergy);
    const weights = skyWeights(SKY_MAG, hero.stack.planes.length);
    const admitted = bothRoutes(hero.system, PITCH_MM, weights);
    const landed = bothRoutes(hero.system, PITCH_MM, weights, 1, throughput);
    const loss = landed.plateTotal / admitted.plateTotal;
    expect(loss).toBeGreaterThan(0.85);
    expect(loss).toBeLessThan(0.95);
    // Chromatic: the reddest plane keeps more of its light than the bluest, so
    // the per-plane throughputs are not one number.
    expect(Math.max(...throughput) - Math.min(...throughput)).toBeGreaterThan(1e-3);
    for (let i = 0; i < weights.length; i++) {
      expect.soft(landed.plate.perPlane[i]! / admitted.plate.perPlane[i]!).toBeCloseTo(throughput[i]!, 12);
    }
  });

  it("a zero exposure collects no sky, and the count carries the pitch it was counted at", () => {
    expect(skyPerPixelTotal(bothRoutes(hero, PITCH_MM, skyWeights(), 0).plate)).toBe(0);
    expect(bothRoutes(hero).plate.pixelPitchMm).toBe(PITCH_MM);
    expect(bothRoutes(hero).cone.pixelPitchMm).toBe(PITCH_MM);
  });
});

describe("§ 8b.3 — HEADLINE: the two spellings of the étendue differ by the sine condition, and on a paraboloid that is 1/(16F²)", () => {
  /**
   * The closed form, and it is worth writing out because it is what makes this
   * a rung rather than an identity.
   *
   * A marginal ray at height h on a paraboloid of focal length f strikes the
   * mirror at sag h²/(4f) and travels to the focus. With a = h/f = 1/(2F),
   *
   *     sin u′ = a / √(a² + (1 − a²/4)²) = a / (1 + a²/4)
   *
   * because the radicand is (1 + a²/4)² exactly. The plate-scale spelling uses
   * the PARAXIAL a and the cone spelling uses the traced sin u′, and each route
   * carries it squared, so
   *
   *     N_plate / N_cone = (1 + 1/(16F²))²
   *
   * with no free parameter. A mirror is the right instrument for it for the
   * same reason § 3b's contest uses one: a conic has no refractive index, so
   * nothing about glass, dispersion or thickness is in the number.
   */
  const sineGap = (focalRatio: number) => (1 + 1 / (16 * focalRatio * focalRatio)) ** 2;

  for (const focalRatio of [5, 10]) {
    it(`a 200 mm f/${focalRatio} paraboloid: the two routes differ by ${sineGap(focalRatio).toFixed(8)}`, () => {
      const r = bothRoutes(mirror(200, focalRatio));
      expect(Math.abs(r.plateTotal / r.coneTotal / sineGap(focalRatio) - 1)).toBeLessThan(1e-12);
      // And the traced marginal sine is the closed form it was derived from —
      // the same statement one level down, so a failure says which half moved.
      const a = 1 / (2 * focalRatio);
      expect(Math.abs(r.tracedSin / (a / (1 + (a * a) / 4)) - 1)).toBeLessThan(1e-12);
    });
  }

  it("on an achromat the gap is a reading and not a closed form — and it goes the other way", () => {
    // Glass has no such formula: the departure is the lens's own sine-condition
    // offence, which § 5s measures and which changes sign against the mirror's.
    // 0.9966 at f/10 and 0.9859 at f/5 — the faster stop's larger offence,
    // § 5s's own finding arriving on the background.
    const slow = bothRoutes(achromat(100, 10));
    const fast = bothRoutes(achromat(50, 10));
    expect(slow.plateTotal / slow.coneTotal).toBeCloseTo(0.99659, 4);
    expect(fast.plateTotal / fast.coneTotal).toBeCloseTo(0.98593, 4);
    // Both below 1, where the mirror's are above it: the gap is the system's,
    // not the arithmetic's.
    expect(slow.plateTotal / slow.coneTotal).toBeLessThan(1);
    expect(bothRoutes(mirror(200, 10)).plateTotal / bothRoutes(mirror(200, 10)).coneTotal).toBeGreaterThan(1);
  });

  it("the gap is the paraxial sine over the traced one, squared, on every system", () => {
    // The general statement the two above are instances of. The plate scale is
    // pitch/EFL, so the paraxial image-space sine it implies is
    // r_pupil/EFL = r_pupil·(arcsec/rad)/(pitch/arcsecPerPixel) — read back out
    // of the two quantities the route actually used, so nothing is assumed.
    for (const system of [mirror(200, 5), achromat(100, 10), achromat(50, 10), achromat(100, 20)]) {
      const r = bothRoutes(system);
      const eflMm = PITCH_MM / (r.arcsecPerPixel / ARCSEC_PER_RAD);
      const paraxialSin = Math.sqrt(r.collectingAreaMm2 / Math.PI) / eflMm;
      expect.soft(Math.abs(r.plateTotal / r.coneTotal / (paraxialSin / r.tracedSin) ** 2 - 1)).toBeLessThan(1e-12);
    }
  });
});

describe("§ 8b.4 — HEADLINE: aperture buys stars and buys no sky at all", () => {
  it("twice the mirror at the same focal ratio is 4× the star and 1.000000000000× the sky", () => {
    // The statement the whole step exists for, and a conic is what makes it
    // exact: a paraboloid at 400 mm f/5 is a pure scaling of one at 200 mm f/5,
    // so the pupil area is exactly four times and the plate scale exactly half
    // — Ω falls by four as A rises by four, and the étendue on a pixel is
    // bit-identical. Both spellings agree, which they must, since neither
    // contains the aperture except through those two factors.
    const small = bothRoutes(mirror(200, 5));
    const large = bothRoutes(mirror(400, 5));
    expect(large.collectingAreaMm2 / small.collectingAreaMm2).toBeCloseTo(4, 10);
    expect(large.plateTotal / small.plateTotal).toBeCloseTo(1, 12);
    expect(large.coneTotal / small.coneTotal).toBeCloseTo(1, 12);
    expect(large.arcsecPerPixel / small.arcsecPerPixel).toBeCloseTo(0.5, 12);
  });

  it("and on glass it holds to 0.6%, the residue being the lens not scaling exactly", () => {
    // The control that says the mirror's exactness is the conic's and not the
    // arithmetic's. Two nominally f/5 achromats of different size are not quite
    // similar figures — the thicknesses do not scale with the curvatures — so
    // the sky per pixel moves by 0.6% where the mirror's did not move at all.
    const small = bothRoutes(achromat(50, 10));
    const large = bothRoutes(achromat(100, 20));
    expect(large.collectingAreaMm2 / small.collectingAreaMm2).toBeCloseTo(4, 8);
    expect(Math.abs(large.plateTotal / small.plateTotal - 1)).toBeLessThan(0.01);
    expect(Math.abs(large.plateTotal / small.plateTotal - 1)).toBeGreaterThan(1e-4);
  });

  it("half the focal ratio is four times the sky on a pixel — the 1/F² law, on the background", () => {
    // § 5s's extended-source law, now DRAWN rather than printed: the sky is the
    // extended source that panel never had. On the plate-scale route it is
    // exactly 4 for a mirror, whose EFL is its focal length by definition; on
    // the cone route it is 3.98505, which is § 8b.3's sine gap at the two focal
    // ratios and not a discrepancy.
    const slow = bothRoutes(mirror(200, 10));
    const fast = bothRoutes(mirror(200, 5));
    expect(fast.plateTotal / slow.plateTotal).toBeCloseTo(4, 10);
    expect(fast.coneTotal / slow.coneTotal).toBeCloseTo(3.985051, 5);
    const gap = (f: number) => (1 + 1 / (16 * f * f)) ** 2;
    expect(Math.abs((fast.coneTotal / slow.coneTotal) / (4 * (gap(10) / gap(5))) - 1)).toBeLessThan(1e-12);
  });
});

describe("§ 8b.5 — the limiting magnitude, and the two slopes it runs between", () => {
  /** An m = 0 source through a 10 mm pupil over `t` seconds, no losses. */
  const zeroPoint = (t: number) => photonFluxAB(0, BAND) * Math.PI * 25 * 1e-6 * t;

  /** The limit at `t` seconds when the sky delivers `perSecond` per pixel per second. */
  const limitAt = (t: number, perSecond: number, pixels = 9, snr = 5) =>
    limitingMagnitude({
      snr,
      skyPhotonsPerPixelTotal: perSecond * t,
      pixels,
      zeroMagnitudePhotons: zeroPoint(t),
    });

  it("the root satisfies the equation it was inverted from, at every background", () => {
    // The one internal identity, and it is the cheapest possible guard on the
    // quadratic: whatever N comes back, feeding it to `signalToNoise` has to
    // return the SNR that was asked for.
    for (const b of [0, 1e-6, 0.5, 40, 1e6]) {
      const lim = limitAt(10, b);
      expect.soft(Math.abs(signalToNoise(lim.sourcePhotons, b * 10, 9) / 5 - 1)).toBeLessThan(1e-12);
    }
  });

  it("with no sky, four times the exposure buys exactly 2.5·log₁₀4 = 1.5051 magnitudes", () => {
    // Source-limited: N = SNR² is a constant, so the limit is set entirely by
    // how many photons the exposure collects and deepens as t. Exact, not
    // approximate — there is nothing else in the expression.
    const gain = limitAt(4, 0).magnitudeAB - limitAt(1, 0).magnitudeAB;
    expect(gain).toBeCloseTo(2.5 * Math.log10(4), 12);
    expect(gain).toBeCloseTo(1.5051500, 6);
    expect(limitAt(1, 0).backgroundDominance).toBe(0);
  });

  it("swamped by sky it approaches 2.5·log₁₀2 = 0.7526 — half the depth for the same four times", () => {
    // Background-limited: N → SNR·√(nB) grows as √t while the zero point grows
    // as t, so the limit deepens as √t. The rung is the APPROACH, since the
    // asymptote is only reached at infinite background: the gain falls
    // monotonically towards 0.75258 as the sky rises, and is never below it.
    const gains = [1e2, 1e4, 1e6, 1e8, 1e10].map(
      (b) => limitAt(4, b).magnitudeAB - limitAt(1, b).magnitudeAB,
    );
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeLessThan(gains[i - 1]!);
    for (const g of gains) expect(g).toBeGreaterThan(2.5 * Math.log10(2));
    expect(gains[gains.length - 1]!).toBeCloseTo(2.5 * Math.log10(2), 4);
    expect(2.5 * Math.log10(2)).toBeCloseTo(0.7525750, 6);
  });

  it("every real exposure sits strictly between the two slopes", () => {
    // The bracket is what makes the pair a statement rather than two special
    // cases: no sky, no aperture and no threshold puts an exposure outside it.
    for (const b of [1e-3, 1, 1e3]) {
      for (const pixels of [1, 9, 400]) {
        for (const snr of [3, 5, 10]) {
          const gain = limitAt(4, b, pixels, snr).magnitudeAB - limitAt(1, b, pixels, snr).magnitudeAB;
          expect.soft(gain, `B=${b} n=${pixels} snr=${snr}`).toBeGreaterThan(2.5 * Math.log10(2));
          expect.soft(gain, `B=${b} n=${pixels} snr=${snr}`).toBeLessThanOrEqual(2.5 * Math.log10(4));
        }
      }
    }
  });

  it("more sky, more pixels or a stricter threshold each cost magnitudes, and a bigger pupil buys them", () => {
    expect(limitAt(1, 10).magnitudeAB).toBeLessThan(limitAt(1, 1).magnitudeAB);
    expect(limitAt(1, 10, 100).magnitudeAB).toBeLessThan(limitAt(1, 10, 9).magnitudeAB);
    expect(limitAt(1, 10, 9, 10).magnitudeAB).toBeLessThan(limitAt(1, 10, 9, 5).magnitudeAB);
    // Four times the pupil at the same sky per pixel — § 8b.4's whole point,
    // spelled as a depth: the background is unmoved and the zero point is not.
    const small = limitingMagnitude({ snr: 5, skyPhotonsPerPixelTotal: 10, pixels: 9, zeroMagnitudePhotons: zeroPoint(1) });
    const large = limitingMagnitude({ snr: 5, skyPhotonsPerPixelTotal: 10, pixels: 9, zeroMagnitudePhotons: 4 * zeroPoint(1) });
    expect(large.magnitudeAB - small.magnitudeAB).toBeCloseTo(2.5 * Math.log10(4), 12);
  });

  it("refuses a threshold, an aperture or a zero point that has no answer", () => {
    const ok = { snr: 5, skyPhotonsPerPixelTotal: 1, pixels: 9, zeroMagnitudePhotons: 1e6 };
    expect(() => limitingMagnitude({ ...ok, snr: 0 })).toThrow(/must be positive/);
    expect(() => limitingMagnitude({ ...ok, pixels: 0 })).toThrow(/positive number of pixels/);
    expect(() => limitingMagnitude({ ...ok, zeroMagnitudePhotons: 0 })).toThrow(/no magnitude scale/);
    expect(() => limitingMagnitude({ ...ok, skyPhotonsPerPixelTotal: -1 })).toThrow(/non-negative/);
    expect(() => signalToNoise(-1, 1, 9)).toThrow();
    expect(() => signalToNoise(1, 1, 0)).toThrow();
  });
});

describe("§ 8b.6 — the pedestal's colour is the sky's own, and it is not obvious that it should be", () => {
  /**
   * The trap, and why it does not close.
   *
   * `intensityFromPhotons` divides plane p by the SOURCE's photon scale, so a
   * background built from the sky's own spectrum is divided by the STAR's
   * weights and then collapsed against the star's ENERGY weights. Both
   * weightings are of one spectrum and they differ by exactly a factor λ — a
   * photon carries hc/λ — so the star's shape cancels and what reaches the
   * observer is the sky's energy per bin. That is precisely the hc/λ conversion
   * `intensityFromPhotons`' own docstring declines to apply explicitly, arriving
   * for free because the two weightings were built from one spectrum.
   *
   * It is exact only for narrow bins, since each weighting picks its own mean
   * wavelength inside a bin. The residual is a chromaticity distance of 8.4e-5
   * at nine wavelengths — invisible — and falls as the square of the bin count,
   * which is the midpoint rule and identifies what the residual IS.
   */
  const chroma = (c: { x: number; y: number; z: number }): [number, number] => {
    const s = c.x + c.y + c.z;
    return [c.x / s, c.y / s];
  };

  /** How far the displayed pedestal's chromaticity is from the sky's own. */
  function hueResidual(count: number): number {
    const starPhotons = photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), 10, BAND, { count });
    const starEnergy = spectralSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), { count });
    const sky = skyWeights(SKY_MAG, count);
    // The pedestal in the render's own intensity units, up to the constants
    // (area, time, clear energy) that are common to every plane and cancel from
    // a chromaticity.
    const pedestal = sky.map((s, i) => s.weight / starPhotons[i]!.weight);
    const shown = chroma(spectralXyz(starEnergy, pedestal));
    const truth = chroma(spectralXyz(spectralSamples(abReferenceSpectrum, { count }), pedestal.map(() => 1)));
    return Math.hypot(shown[0] - truth[0], shown[1] - truth[1]);
  }

  it("the sky's displayed chromaticity is the sky's, to 8.4e-5 at the engine's nine wavelengths", () => {
    // A just-noticeable difference in CIE 1931 xy is of order 1e-3 at best, so
    // this is two orders inside anything a viewer could see — and it is stated
    // as a measurement rather than as "close enough".
    expect(hueResidual(9)).toBeLessThan(1e-4);
  });

  it("and the residual is second order in the bin count — it is the bins, not the route", () => {
    // 7.4e-4 / 2.7e-4 / 8.4e-5 / 3.0e-5 / 7.1e-6 / 1.8e-6 at 3 / 5 / 9 / 15 /
    // 31 / 61 wavelengths. Each step falls by (count ratio)², to within 2%: the
    // midpoint rule's own order, which is what says the gap is the two
    // weightings picking different mean wavelengths inside a bin and not a
    // missing factor. A missing factor would not converge at all.
    const counts = [3, 5, 9, 15, 31, 61];
    const residuals = counts.map(hueResidual);
    for (let i = 1; i < counts.length; i++) {
      const expected = (counts[i]! / counts[i - 1]!) ** 2;
      const measured = residuals[i - 1]! / residuals[i]!;
      expect.soft(Math.abs(measured / expected - 1), `${counts[i - 1]} → ${counts[i]}`).toBeLessThan(0.05);
    }
  });
});

describe("§ 8b.7 — the frame: a background is added flat, and the noise it brings is the CCD equation's", () => {
  const hero = renderHero(heroPair().achromat);
  const NATIVE_PITCH = hero.stack.pixelScaleMm;
  const source = expectedPhotons({
    planes: hero.stack.planes,
    samples: hero.stack.samples,
    photons: photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), 10, BAND, {
      count: hero.stack.planes.length,
    }),
    clearEnergy: clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size),
    collectingAreaMm2: pointSourceCollection(hero.system, FOCUS_NM),
    seconds: 1,
  });
  const sky = skyPhotonsPerPixel(skyWeights(SKY_MAG, hero.stack.planes.length), {
    arcsecPerPixel: plateScale(hero.system, { pixelPitchMm: NATIVE_PITCH, cols: 1, rows: 1 }, FOCUS_NM)
      .arcsecPerPixel,
    pixelPitchMm: NATIVE_PITCH,
    collectingAreaMm2: pointSourceCollection(hero.system, FOCUS_NM),
    throughput: hero.stack.planes.map(
      (p) => p.energy / clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size),
    ),
    seconds: 1,
  });
  const framed = withSkyBackground(source, sky, NATIVE_PITCH);

  it("every pixel of every plane gains the same count, and the source's own readings do not move", () => {
    // The separation the whole interface exists for. `deliveredFraction` is a
    // reading of what the PUPIL did to the star's light; sky photons are light
    // from a direction the star is not in, so folding them in would push that
    // past 1 and make it climb with the sky brightness.
    expect(framed.admitted).toEqual(source.admitted);
    expect(framed.delivered).toEqual(source.delivered);
    expect(framed.deliveredFraction).toBe(source.deliveredFraction);
    expect(framed.totalPhotons).toBe(source.totalPhotons);
    expect(source.skyPhotons).toBe(0);
    expect(source.skyPerPixel.every((v) => v === 0)).toBe(true);

    const pixels = hero.stack.size * hero.stack.size;
    expect(Math.abs(framed.skyPhotons / (skyPerPixelTotal(sky) * pixels) - 1)).toBeLessThan(1e-12);
    for (let p = 0; p < framed.planes.length; p++) {
      const before = source.planes[p]!;
      const after = framed.planes[p]!;
      const added = sky.perPlane[p]!;
      // Flat: the difference is the same number at a corner and at the core.
      expect.soft(after[0]! - before[0]!).toBeCloseTo(added, 12);
      const centre = (hero.stack.size / 2) * hero.stack.size + hero.stack.size / 2;
      expect.soft(after[centre]! - before[centre]!).toBeCloseTo(added, 12);
    }
  });

  it("the drawn frame's scatter is N/√(N + nB), measured", () => {
    // The CCD equation as an experiment rather than as algebra: a source spread
    // over nine pixels on a background, drawn two thousand times, and the
    // aperture sum's own scatter compared to the closed form. Statistical, so
    // it is stated at five standard errors of the sample standard deviation
    // (σ/√(2K)) and any seed passes — § 8a.4's convention.
    const n = 9;
    const N = 400;
    const B = 120;
    const K = 2000;
    const rng = mulberry32(0x5c1);
    const field = new Float64Array(n).fill(N / n + B);
    let sum = 0;
    let sumSq = 0;
    for (let k = 0; k < K; k++) {
      let total = 0;
      for (const v of shotNoise(field, rng)) total += v;
      sum += total;
      sumSq += total * total;
    }
    const mean = sum / K;
    const variance = sumSq / K - mean * mean;
    expect(Math.abs(mean - (N + n * B))).toBeLessThan(5 * Math.sqrt((N + n * B) / K));
    // The variance of the aperture sum is the sum of the expectations — the
    // whole content of "the two terms under the root simply add".
    expect(Math.abs(variance / (N + n * B) - 1)).toBeLessThan(5 * Math.sqrt(2 / K));
    const measuredSnr = N / Math.sqrt(variance);
    expect(Math.abs(measuredSnr / signalToNoise(N, B, n) - 1)).toBeLessThan(5 * Math.sqrt(2 / K));
  });

  it("the sky is what makes a star harder to see: the same star, the same time, a brighter sky", () => {
    // The statement a reader can act on, and it needs no image: at a fixed
    // exposure the source's photons are unchanged and only the denominator
    // moves, so the signal-to-noise of a fixed star falls monotonically with
    // the background — towards zero, not towards a floor.
    const N = 500;
    const snrs = [0, 1, 10, 100, 1000].map((b) => signalToNoise(N, b, 9));
    for (let i = 1; i < snrs.length; i++) expect(snrs[i]!).toBeLessThan(snrs[i - 1]!);
    // A dark sky is the √N of § 8a.5, exactly — the background term is the only
    // thing separating this equation from that one.
    expect(snrs[0]!).toBeCloseTo(Math.sqrt(N), 10);
    // And once the sky dominates, N/√(nB) says a ten-times brighter sky costs a
    // factor √10 — approached from below as the source term stops mattering,
    // which is why the law is read at 10⁵ and 10⁶ rather than at 10² and 10³.
    expect(signalToNoise(N, 1e5, 9) / signalToNoise(N, 1e6, 9)).toBeCloseTo(Math.sqrt(10), 2);
    expect(signalToNoise(N, 1e2, 9) / signalToNoise(N, 1e3, 9)).toBeLessThan(Math.sqrt(10));
  });
});

describe("§ 8b.8 — what the background refuses", () => {
  const hero = renderHero(heroPair().achromat);
  const NATIVE_PITCH = hero.stack.pixelScaleMm;
  const source = expectedPhotons({
    planes: hero.stack.planes,
    samples: hero.stack.samples,
    photons: photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), 10, BAND, {
      count: hero.stack.planes.length,
    }),
    clearEnergy: clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size),
    collectingAreaMm2: pointSourceCollection(hero.system, FOCUS_NM),
    seconds: 1,
  });
  const weights = skyWeights(SKY_MAG, hero.stack.planes.length);
  const geometry = {
    arcsecPerPixel: 10,
    pixelPitchMm: NATIVE_PITCH,
    collectingAreaMm2: pointSourceCollection(hero.system, FOCUS_NM),
    throughput: weights.map(() => 0.9),
    seconds: 1,
  };

  it("a background counted on a different pixel from the frame's — the silent factor", () => {
    // The error this catches costs a factor of (5 µm / 0.4 µm)² ≈ 150 and
    // produces a perfectly plausible image either way, which is exactly the
    // shape of the band mismatch § 8a.10 refuses. A count per PIXEL is not a
    // number until the pixel is named.
    const sky = skyPhotonsPerPixel(weights, geometry);
    expect(() => withSkyBackground(source, sky, 0.005)).toThrow(/counted on a .* pixel/);
    expect(() => withSkyBackground(source, sky, NATIVE_PITCH)).not.toThrow();
  });

  it("a plane count that does not match the frame's, and a negative background", () => {
    const sky = skyPhotonsPerPixel(weights, geometry);
    expect(() =>
      withSkyBackground(source, { ...sky, perPlane: sky.perPlane.slice(1) }, NATIVE_PITCH),
    ).toThrow(/one count per plane/);
    expect(() =>
      withSkyBackground(source, { ...sky, perPlane: sky.perPlane.map(() => -1) }, NATIVE_PITCH),
    ).toThrow(/finite and non-negative/);
  });

  it("a pupil that is not an area collects no sky, exactly as it has no rate", () => {
    // § 5s.5 propagated a second time. The refusal is not re-implemented — it
    // is the same sentence, because it is the same fact about the pupil.
    expect(() => skyPhotonsPerPixel(weights, { ...geometry, collectingAreaMm2: Infinity })).toThrow(/§ 5s.5/);
    expect(() => skyPhotonsPerPixel(weights, { ...geometry, arcsecPerPixel: 0 })).toThrow(/positive angle/);
    expect(() => skyPhotonsPerPixel(weights, { ...geometry, pixelPitchMm: -1 })).toThrow(/positive pitch/);
    expect(() => skyPhotonsPerPixel(weights, { ...geometry, seconds: -1 })).toThrow(/non-negative/);
    expect(() => skyPhotonsPerPixel([], geometry)).toThrow(/at least one wavelength/);
    expect(() =>
      skyPhotonsPerPixelFromCone(weights, {
        pixelPitchMm: 0.005,
        illuminance: 0,
        throughput: weights.map(() => 1),
        seconds: 1,
      }),
    ).toThrow(/positive π·sin²u′/);
    // The throughput is per wavelength and it is required: a background that has
    // not paid the pupil's losses is not a number that can be added to a frame,
    // and a zero throughput is a pupil that passes nothing rather than a dark sky.
    expect(() => skyPhotonsPerPixel(weights, { ...geometry, throughput: [0.9] })).toThrow(
      /throughput is per wavelength/,
    );
    expect(() =>
      skyPhotonsPerPixel(weights, { ...geometry, throughput: weights.map(() => 0) }),
    ).toThrow(/positive and finite/);
  });
});
