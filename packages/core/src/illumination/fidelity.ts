import { OpdSampling, phaseStepPerSample } from "../wave/fidelity";
import { geometricWeight } from "../wave/geometric";

/**
 * Does an honest brightfield image exist for this system at all?
 *
 * Every PSF the engine forms has two branches and a cross-fade between them
 * (`wave/geometric`): the FFT while the wavefront is resolved on the pupil
 * grid, a ray histogram once it is not, and a smoothstep blend across the
 * criterion. That works because both branches compute the *same* quantity —
 * the intensity image of an incoherent point — by two methods, each correct
 * where the other fails.
 *
 * **Brightfield has no second branch, and cannot have one.** `abbe.ts` forms
 * an image by summing |F⁻¹{T·P_s}|² over illumination directions, and every
 * term in that sum is a coherent field. A ray histogram has no field: it has
 * no phase, so it cannot interfere, so it cannot represent the one thing the
 * Abbe sum exists to represent. Falling back to it does not degrade partial
 * coherence gracefully — it silently replaces it with incoherent imaging, and
 * an incoherent image of a brightfield specimen is not a worse answer to the
 * question, it is an answer to a different question. (A pure phase object is
 * the sharp case: brightfield's headline null, § 6f, says it is invisible;
 * a ray histogram would agree, but for the unrelated reason that |t| = 1 and
 * rays carry only |t|².)
 *
 * So the honest thing to build here is not a fallback but a **verdict**. When
 * the system's own aberration is bad enough that `adaptivePsf` would give the
 * ray branch any share at all, this reports that no brightfield image is
 * available rather than handing back a partially coherent sum computed on a
 * pupil grid that cannot carry it. That is the same shape of response § 5d
 * made for the seeing screen, which likewise lives only in the FFT branch: the
 * missing capability stays missing and named, and what lands is the detection
 * that stops it being missed silently.
 *
 * ## Absent sampling is `unknown`, never `valid`
 *
 * The criterion is measured on the RAW traced samples (`wave/fidelity` is
 * specific about why: a Zernike fit is band-limited by construction and would
 * report "gentle" exactly when the fallback is needed). Only the `psf()` path
 * has those samples, so `Psf.sampling` is optional — and `adaptivePsf` treats
 * its absence as a phase step of zero, which is the right default *there*
 * because it is only ever reached with a freshly traced system.
 *
 * Copying that default here would be the bug this file exists to prevent.
 * `abbeImage` is handed a bare `PupilFunction` and cannot know what produced
 * it, so "no sampling" is precisely the case where the deferral bites — a
 * traced pupil from an arbitrarily bad system looks, from inside `abbe.ts`,
 * exactly like an ideal disc. Absent sampling therefore returns `unknown`,
 * which is not a verdict a caller can round down to "fine".
 *
 * ## What this does NOT check
 *
 * Whether the Abbe sum's own DFT lattice resolves the pupil it was handed —
 * that is a different question with a different answer, measured on the actual
 * sampled phases and reported as `AbbeImage.maxGridPhaseStepWaves`. The two
 * are independent the way `Psf.sampling` and `Psf.maxGridPhaseStepWaves` are:
 * this one asks whether the *physics* has left the regime the coherent sum
 * describes, that one asks whether the *grid* carried the pupil it was given.
 * A caller that wants to trust a brightfield image wants both.
 *
 * ## No caller yet
 *
 * The bridge from `abbeImage` into `imaging/render`'s field decomposition is
 * unbuilt (§ 6f, "Not yet pinned"), so nothing in the engine currently routes
 * a traced system into a brightfield image and therefore nothing currently
 * consults this. It is the readout that bridge will have to consult, pinned
 * now so it cannot be forgotten when the bridge lands — not a guard already
 * wired into a path that exists.
 */

export type BrightfieldVerdict =
  /** The coherent sum is the whole answer: the FFT branch owns this wavefront. */
  | "valid"
  /** The ray branch would have a share, and there is no coherent counterpart. */
  | "no-honest-image"
  /** No traced sampling was supplied, so the question cannot be asked. */
  | "unknown";

export interface BrightfieldFidelity {
  readonly verdict: BrightfieldVerdict;
  /**
   * |∇OPD|·Δ_pupil in waves — the criterion `adaptivePsf` switches on. `null`
   * exactly when the verdict is `unknown`.
   */
  readonly phaseStepWaves: number | null;
  /**
   * The share `adaptivePsf` would give the ray histogram, 0…1. `null` exactly
   * when the verdict is `unknown`. Anything above 0 is a `no-honest-image`
   * verdict: unlike the PSF, this share cannot be blended into.
   */
  readonly geometricShare: number | null;
  /** Why, in one sentence a UI can show. */
  readonly reason: string;
}

/**
 * Rule on a brightfield image before forming one.
 *
 * `sampling` is `Psf.sampling` — the traced-sample quality from the same
 * system and field point the pupil came from. Pass `undefined` when there is
 * none; the answer is `unknown`, deliberately.
 *
 * `pupilSamples` is the Abbe sum's own, because the criterion is phase per
 * pupil SAMPLE: a denser grid genuinely extends the coherent sum's validity,
 * and a verdict phrased in total waves would deny that (`wave/fidelity`).
 */
export function brightfieldFidelity(
  sampling: OpdSampling | undefined,
  pupilSamples: number,
): BrightfieldFidelity {
  if (!(pupilSamples > 0)) {
    throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  }
  if (sampling === undefined) {
    return {
      verdict: "unknown",
      phaseStepWaves: null,
      geometricShare: null,
      reason:
        "no traced sampling supplied: a pupil function alone cannot say whether the " +
        "wavefront that produced it is resolved, so this is not a clean bill of health",
    };
  }
  const phaseStepWaves = phaseStepPerSample(sampling, pupilSamples);
  const geometricShare = geometricWeight(phaseStepWaves);
  if (geometricShare === 0) {
    return {
      verdict: "valid",
      phaseStepWaves,
      geometricShare,
      reason: `wavefront resolved at ${phaseStepWaves.toFixed(3)} waves per pupil sample: the coherent sum holds`,
    };
  }
  return {
    verdict: "no-honest-image",
    phaseStepWaves,
    geometricShare,
    reason:
      `${phaseStepWaves.toFixed(3)} waves per pupil sample puts ${(geometricShare * 100).toFixed(0)}% of ` +
      `the PSF on the ray branch, which has no notion of coherence — raise pupilSamples, or accept ` +
      `that this system has no brightfield image in this engine`,
  };
}
