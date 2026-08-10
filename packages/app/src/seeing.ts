import { achromaticObjective, newtonian } from "@telemicroscope/core/designs";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import {
  friedAtmosphericMtf,
  longExposurePsf,
  systemPupil,
  type LongExposure,
} from "@telemicroscope/core/wave";
import { refusalOf, type Refusal as SharedRefusal } from "./refusal";

/**
 * Long-exposure seeing — APP.md's C6, and the last item in Part C.
 *
 * The one surface in this doc whose engine step had to land first, and the gap
 * was an unusual shape: § 5d's physics has been pinned since roadmap step 5
 * (Fried's OTF, the seeing-limited FWHM) while the *averaging* lived in a helper
 * inside `seeing.test.ts` with no export, so the app's existing seeing dial
 * could only ever show **one screen** — a speckle pattern — and said so. § 5d.1
 * promoted it; this calls `longExposurePsf`.
 *
 * ## Compute-once, and the panel is built around that rather than hiding it
 *
 * The low-order wander converges as 1/√N, so a converged ensemble is 120 screens
 * and ~8 s in node. That is not a slider. The screen count is therefore an
 * explicit choice whose options carry their own cost, and the panel's **default
 * is one screen** — which is exactly the app's existing dial, a short exposure,
 * so the surface opens on the thing it is about to correct.
 *
 * ## Both frames, every time
 *
 * The result always carries the single draw beside the mean, because the whole
 * physics is the difference between them and a picture of one is not an
 * argument. It costs one extra screen (~80 ms): the draw is `screens: 1` at the
 * same seed, which § 5d.1 pins to be bit-identical to the manual compose.
 *
 * ## The Newtonian comes back here
 *
 * C5 could not offer one — a folded chain cannot be spliced on-axis (§ 5l.1) —
 * and this path never splices: it asks `systemPupil` for the objective's own
 * pupil and hands it to the ensemble. So the reflector an observer is most
 * likely to own is available on exactly the surface where the atmosphere, not
 * the instrument, is the subject.
 */

export const SEEING_OPTICS = ["achromat", "newtonian"] as const;
export type SeeingOptic = (typeof SEEING_OPTICS)[number];

export const OPTIC_LABELS: Record<SeeingOptic, string> = {
  achromat: "achromat (§ 5j)",
  newtonian: "Newtonian (§ 4b)",
};

/**
 * The screen counts offered, with what each is worth.
 *
 * 1 is the app's existing dial — one draw. 120 is what § 5d's rungs run and the
 * only converged one. 30 is here because it is *visibly* better than 1 and still
 * biased: § 5d.1 measures two 30-screen means at 12.5 and 13.5 px where 120
 * gives 15.5, so a cheap ensemble is narrow rather than merely noisy, and having
 * it on the panel is what lets a reader see that for themselves.
 */
export const SCREEN_COUNTS = [1, 10, 30, 120] as const;

export const LAMBDA_NM = 500;
/** § 5d's own screen geometry, so the app's numbers and the ladder's are comparable. */
export const SCREEN_SAMPLES = 256;
export const SCREEN_OVERSIZE = 4;
export const SCREEN_SUBHARMONICS = 6;
/** Past this the FFT grid cannot resolve the screen and the mean is aliasing averaged. */
export const PHASE_STEP_LIMIT_WAVES = 0.5;

export type RefusalStage = "objective" | "focus" | "ensemble";
export type Refusal = SharedRefusal<RefusalStage>;

export interface SeeingRequest {
  readonly optic: SeeingOptic;
  readonly apertureMm: number;
  readonly focalRatio: number;
  /** Fried parameter at 500 nm, mm — the one number seeing quality is. */
  readonly friedParamMm: number;
  readonly screens: number;
  readonly pupilSamples: number;
  readonly seed: number;
  /**
   * Display gain: white is this multiple of the **mean's** peak, and all three
   * frames share it. See `toGrey` for why that reference and not another.
   */
  readonly whiteOverMeanPeak: number;
}

/** One point on the transfer-function plot. */
export interface TransferPoint {
  /** Normalized frequency ν = f/f_cutoff — bin/pupilSamples, exactly. */
  readonly nu: number;
  /** Measured long-exposure MTF / diffraction MTF. */
  readonly measured: number;
  /** exp(−3.44·(ν·D/r₀)^(5/3)) — Fried, evaluated and not fitted. */
  readonly fried: number;
  /** r₀_eff/r₀ recovered from `measured`; `null` where the inversion has no answer. */
  readonly effectiveFriedRatio: number | null;
}

export interface SeeingResult {
  /** The ensemble mean — the seeing disc. */
  readonly meanRgba: Uint8ClampedArray;
  /** One screen at the same seed — a speckle pattern. */
  readonly drawRgba: Uint8ClampedArray;
  /** The same instrument with no atmosphere at all. */
  readonly cleanRgba: Uint8ClampedArray;
  readonly size: number;
  readonly pixelScaleMm: number;

  readonly screens: number;
  readonly dOverR0: number;
  /** FWHM of the mean, the draw and the atmosphere-free instrument (px). */
  readonly meanFwhmPx: number;
  readonly drawFwhmPx: number;
  readonly cleanFwhmPx: number;
  /** The mean's FWHM as an angle on the sky (arcsec) — what an observer quotes. */
  readonly meanFwhmArcsec: number;
  /** 0.98·λ/r₀ in arcsec: the headline closed form, drawn beside the measurement. */
  readonly friedFwhmArcsec: number;
  /** 1.22·λ/D in arcsec — what the aperture alone would give. */
  readonly diffractionFwhmArcsec: number;
  /**
   * Aperture at which the seeing disc equals the Airy disc, mm: 1.22λ/D =
   * 0.98λ/r₀ ⇒ D = (1.22/0.98)·r₀. λ cancels, which is the point — the crossover
   * is a property of r₀ and the telescope, not of colour.
   */
  readonly seeingLimitedAboveMm: number;
  /** Whether this aperture is past that crossover — i.e. whether 0.98·λ/r₀ applies. */
  readonly seeingLimited: boolean;
  /**
   * Where the measured transfer function leaves Fried's, as ν — the first bin
   * exceeding it by half.
   *
   * A property of the ENSEMBLE and not of the sky: a mean over N screens has a
   * noise floor that does not fall with frequency, so past the point where
   * Fried's exponential has plunged under it the ratio runs away. It moves
   * outward as N grows, which is what identifies it. `null` if the measurement
   * never departs inside the drawn band.
   */
  readonly transferDepartsAtNu: number | null;

  /**
   * Peak of the draw and of the mean, each as a fraction of the atmosphere-free
   * peak. The draw's speckle core is several times brighter than the disc that
   * averaging produces, which is the difference the two pictures show.
   */
  readonly drawPeakRatio: number;
  readonly meanPeakRatio: number;

  readonly transfer: readonly TransferPoint[];
  /** Worst wavefront step the screens put between adjacent grid samples (waves). */
  readonly maxGridPhaseStepWaves: number;
  /** Strehl of the atmosphere-free instrument — is the optic itself any good here? */
  readonly cleanStrehl: number;
  readonly elapsedMs: number;
}

/** The band the transfer plot is drawn over — above the DC bin, below the noise floor. */
const TRANSFER_MIN_BIN = 1;
const TRANSFER_MAX_NU = 0.5;
/** How far above Fried the measurement must sit to count as having left it. */
const TRANSFER_DEPARTURE = 1.5;

const RAD_TO_ARCSEC = (180 / Math.PI) * 3600;

/**
 * Build the objective and take its pupil — one trace for the whole ensemble.
 *
 * Both optics are focused by `bestFocus` first, at the same criterion and the
 * same wavelength, because a long exposure compared against an unfocused
 * instrument would be measuring the focus. The Newtonian needs it as much as the
 * achromat does: its paraboloid is perfect on axis but its image plane still has
 * to be found rather than assumed.
 */
function opticPupil(request: SeeingRequest) {
  const prescription =
    request.optic === "newtonian"
      ? newtonian({ apertureMm: request.apertureMm, focalRatio: request.focalRatio }).prescription
      : achromaticObjective({ apertureMm: request.apertureMm, focalRatio: request.focalRatio })
          .prescription;
  const obstruction =
    request.optic === "newtonian"
      ? newtonian({ apertureMm: request.apertureMm, focalRatio: request.focalRatio }).obstruction
      : 0;
  const base: OpticalSystem = {
    prescription,
    aperture: { kind: "EPD", value: request.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAMBDA_NM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: LAMBDA_NM });
  return {
    ...systemPupil(withFocus(base, focus.offsetFromLastVertex), 0, LAMBDA_NM, {
      pupilSamples: request.pupilSamples,
      padFactor: PAD_FACTOR,
      ...(obstruction > 0 ? { obstruction } : {}),
    }),
    obstruction,
  };
}

const PAD_FACTOR = 4;

/**
 * The whole surface — one trace, then `screens + 1` transforms.
 *
 * Measured in node at pupilSamples 32: ~40 ms for the trace and focus solve, then
 * ~19 ms per screen, so 1 / 10 / 30 / 120 screens are ~80 ms / 250 ms / 640 ms /
 * 2.4 s. At 64 it is ~4× that, and 120 screens is the ~8 s § 5d's rungs take.
 */
export function renderSeeing(request: SeeingRequest): SeeingResult | Refusal {
  const started = performance.now();

  let optic: ReturnType<typeof opticPupil>;
  try {
    optic = opticPupil(request);
  } catch (cause) {
    return refusalOf(cause, "objective");
  }

  try {
    const seeing = {
      friedParamMm: request.friedParamMm,
      apertureDiameterMm: request.apertureMm,
      refWavelengthNm: LAMBDA_NM,
      screenSamples: SCREEN_SAMPLES,
      oversize: SCREEN_OVERSIZE,
      subharmonics: SCREEN_SUBHARMONICS,
      seed: request.seed,
    };
    const common = {
      pupil: optic.pupil,
      scale: optic.scale,
      seeing,
      wavelengthNm: LAMBDA_NM,
      psfOptions: { pupilSamples: request.pupilSamples, padFactor: PAD_FACTOR },
    };
    const mean = longExposurePsf({ ...common, screens: request.screens });
    // The draw is screen 0 of that same ensemble, recomputed rather than kept:
    // one screen is ~19 ms and threading a "keep the first" flag through the
    // engine to save it would be an API shaped by this panel's convenience.
    const draw = request.screens === 1 ? mean : longExposurePsf({ ...common, screens: 1 });

    const dOverR0 = request.apertureMm / request.friedParamMm;
    const lambdaMm = LAMBDA_NM * 1e-6;
    // Pixels → radians on the sky: λ/D spans padFactor pixels by construction
    // (n/pupilSamples), so one pixel is (λ/D)/padFactor of angle.
    const radPerPx = lambdaMm / request.apertureMm / PAD_FACTOR;

    const transfer: TransferPoint[] = [];
    for (let b = TRANSFER_MIN_BIN; b < mean.atmosphericModulation.length; b++) {
      const nu = b / request.pupilSamples;
      if (nu > TRANSFER_MAX_NU) break;
      const ratio = mean.effectiveFriedRatio[b]!;
      transfer.push({
        nu,
        measured: mean.atmosphericModulation[b]!,
        fried: friedAtmosphericMtf(dOverR0, nu),
        effectiveFriedRatio: Number.isFinite(ratio) ? ratio : null,
      });
    }

    const cleanPeak = peakOf(mean.clean.intensity);
    // ONE white for all three frames, referred to the mean's own peak — see
    // `toGrey`. The draw and the atmosphere-free frame then clip by exactly the
    // ratios printed beside them, which is the honest way round.
    const white = peakOf(mean.psf.intensity) * request.whiteOverMeanPeak;
    return {
      meanRgba: toGrey(mean.psf.intensity, mean.psf.size, white),
      drawRgba: toGrey(draw.psf.intensity, draw.psf.size, white),
      cleanRgba: toGrey(mean.clean.intensity, mean.clean.size, white),
      size: mean.psf.size,
      pixelScaleMm: mean.psf.pixelScaleMm,

      screens: mean.screens,
      dOverR0,
      meanFwhmPx: mean.fwhmPixels,
      drawFwhmPx: draw.fwhmPixels,
      cleanFwhmPx: mean.cleanFwhmPixels,
      meanFwhmArcsec: mean.fwhmPixels * radPerPx * RAD_TO_ARCSEC,
      friedFwhmArcsec: ((0.98 * lambdaMm) / request.friedParamMm) * RAD_TO_ARCSEC,
      diffractionFwhmArcsec: ((1.22 * lambdaMm) / request.apertureMm) * RAD_TO_ARCSEC,
      seeingLimitedAboveMm: (1.22 / 0.98) * request.friedParamMm,
      seeingLimited: request.apertureMm > (1.22 / 0.98) * request.friedParamMm,
      transferDepartsAtNu:
        transfer.find((p) => p.measured > TRANSFER_DEPARTURE * p.fried)?.nu ?? null,

      drawPeakRatio: peakOf(draw.psf.intensity) / cleanPeak,
      meanPeakRatio: peakOf(mean.psf.intensity) / cleanPeak,

      transfer,
      maxGridPhaseStepWaves: mean.maxGridPhaseStepWaves,
      cleanStrehl: mean.clean.strehl,
      elapsedMs: performance.now() - started,
    };
  } catch (cause) {
    return refusalOf(cause, "ensemble");
  }
}

function peakOf(values: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < values.length; i++) if (values[i]! > peak) peak = values[i]!;
  return peak;
}

/**
 * Greyscale against ONE white for all three frames, referred to the **mean's**
 * peak — and the reference is a real choice, made after two wrong ones.
 *
 * Per-frame normalization is out immediately: it would rescale away exactly the
 * difference the three pictures exist to show. Referring to the frames' shared
 * *energy* (C5's encoder, and the star panel's) was the first attempt and it
 * blows all three out, because a PSF's peak is orders above its mean and a white
 * that shows the Airy rings puts every core far past 255. Referring to the
 * atmosphere-free *peak* fails the other way: the mean sits at 6–8% of it under
 * ordinary seeing and would be a smudge.
 *
 * So the exposure is set by the frame the panel is about, and the other two are
 * allowed to clip — by exactly the ratios printed beside them. That is A10's
 * rule applied rather than worked around: **a factor is precisely what a picture
 * cannot show the size of**, so the peak ratios are numbers on the page and the
 * shade only has to make the *shape* legible. Which it does, and the shapes are
 * the argument: speckle, disc, rings.
 */
function toGrey(intensity: Float64Array, size: number, white: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round((255 * intensity[i]!) / white);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export interface SeeingJob {
  readonly seq: number;
  readonly request: SeeingRequest;
}
export interface SeeingDone {
  readonly seq: number;
  readonly result: SeeingResult | Refusal;
}
