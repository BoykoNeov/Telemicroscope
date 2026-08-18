import { abbeImage, type ObjectField } from "../illumination/abbe";
import {
  brightfieldFidelity,
  type BrightfieldFidelity,
  type BrightfieldVerdict,
} from "../illumination/fidelity";
import { translateSource, type CondenserSource } from "../illumination/source";
import type { OpdSampling } from "../wave/fidelity";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../wave/psf";
import { patchWeight } from "./render";

/**
 * The spatially-variant brightfield image — `abbeImage` across a field whose
 * pupil is not constant.
 *
 * `abbeImage` forms ONE isoplanatic patch: one pupil, one grid, the whole object
 * seen through it. A real frame is not isoplanatic, and `imaging/render` already
 * solved that for self-luminous scenes — cut the field into patches, blend with
 * a partition of unity. This is the same decomposition, and it is applied to the
 * **other side**.
 *
 * ## Why the window moves to the output, which is the opposite of `render.ts`
 *
 * `render.ts` windows the *scene* and says why: windowing the input splits the
 * light, so every photon meets the kernel nearest where it came from. That
 * argument is correct, and it is correct because incoherent imaging is linear in
 * the object's intensity. Abbe imaging is not (`illumination/abbe`), and the
 * scheme does not degrade here — it breaks.
 *
 * Splitting an object *amplitude* between patches (as √w_p, since the
 * intensities are what must partition) returns the self terms whole and
 * multiplies the interference between two object points by
 * C = Σ_p √(w_p(x₁)·w_p(x₂)) ≤ 1, which is **zero** where a seam separates
 * them: the interference is deleted, not attenuated, and interference between
 * neighbouring object points is the entire content of partial coherence.
 * `illumination/coherence` derives that factor and § 6g.2 pins it pointwise.
 * Two modules windowing opposite sides is two different operators, not one of
 * them being wrong.
 *
 * ## Output windowing is FORCED, not free
 *
 * It carries exactly the cost `render.ts` objects to. Where the pupil genuinely
 * varies, this blends images each of which was formed with the wrong pupil over
 * most of its support — the isoplanatic approximation running from the
 * destination point instead of the source point. Where the pupil is constant the
 * blend is the identity (Σ_p w_p ≡ 1) and costs nothing; where it is not, the
 * error has no closed form here and is measured only as convergence in the patch
 * count. That is a real gap and § 6g records it as one. The input side is not an
 * alternative with a different trade-off; it is unavailable.
 *
 * ## Cost
 *
 * **patches² × source points × one N² transform.** There is no locality saving
 * to be had: every patch images the whole object, because the object's spectrum
 * is global. So this is quadratic in the patch count where `render.ts` is
 * quadratic in it too, but with the condenser's sampling multiplying instead of
 * the wavelength count — and § 6f.2 pins that sampling's convergence, so it is a
 * knob with a floor rather than a free parameter.
 *
 * Progressive refinement, which `render.ts` has, is not built here. The shape is
 * identical (each patch level is a complete image) and it is a UI concern; the
 * rungs would be the same rungs.
 *
 * ## The pupil arrives by NORMALIZED POSITION, not by patch index
 *
 * `pupilAt(u, v)` with u, v ∈ [0, 1] across the frame. Keying on the patch index
 * instead would make "patch 2 of 4" and "patch 2 of 8" different field points,
 * so raising the patch count would change the physics rather than refine the
 * discretization — and the convergence this module's error is measured by would
 * mean nothing.
 *
 * Mapping an `OpticalSystem` and an object-plane position onto that callback is
 * a separate capability, and deliberately not in here — it is
 * `imaging/object-field` (§ 6h), which inverts the traced chief ray to find the
 * object point each frame position looks at, traces its pupil, and turns it to
 * that position's own azimuth. This module never learns any of that: the
 * callback is the whole seam.
 *
 * What that wiring bought, measured rather than assumed (§ 6h.5): a traced
 * `PatchPupil` carries the sampling of the trace behind it, so the verdict below
 * stops reading `unknown`; and on a real DIN 4×/0.10 the frame is **not**
 * isoplanatic even at diffraction sampling, so the patch decomposition earns its
 * keep — converging at ratio ½ per doubling where § 6g.3's labelled fixture gave
 * just under 0.4.
 */

/** What a field point's optics look like, as far as a brightfield image cares. */
export interface PatchPupil {
  readonly pupil: PupilFunction;
  /**
   * The traced sampling this pupil came from, if any — `Psf.sampling`.
   *
   * Optional, and its absence is not neutral: `illumination/fidelity` returns
   * `unknown` rather than `valid`, because a pupil function carries no memory of
   * what produced it and a traced pupil from an arbitrarily bad system looks,
   * from inside the transform, exactly like an ideal disc.
   */
  readonly sampling?: OpdSampling;
  /**
   * Where this field point's illumination cone sits in this pupil, in the same
   * normalized coordinates the source's points use (§ 6x).
   *
   * Absent or zero means centred, which is what an object-space **telecentric**
   * objective delivers and what every caller before § 6x assumed unconditionally.
   * A rim-stopped objective displaces the whole cone by `h/R_ep` at object height
   * h — 0.217 of a pupil radius per millimetre on the shipped DIN 4×/0.10 — and
   * `imaging/object-field` measures it off the trace.
   *
   * It rides on the pupil rather than on the source because it is a property of
   * the field POINT, and one `renderBrightfield` call has one source and many
   * field points. `renderFluorescence` reads the same interface and ignores this
   * field, correctly: § 6i's expression has no condenser in it at all.
   */
  readonly illuminationOffset?: { readonly sx: number; readonly sy: number };
  /**
   * The cone this field point is lit by, **traced** — `imaging/condenser-field`
   * (§ 6ag), which is the second half of what `illuminationOffset` is the first
   * half of.
   *
   * Supplied, it *replaces* the source `renderBrightfield` was called with at
   * this field point rather than modifying it: a traced cone's points are
   * absolute pupil coordinates with the field displacement already in them,
   * because the trace put them where they actually are. It rides on the pupil
   * for `illuminationOffset`'s reason — it is a property of the field POINT, and
   * one call has one source and many field points.
   *
   * **Never both.** Supplying this and `illuminationOffset` together would
   * translate an already-displaced cone and double-count § 6x, which does not
   * fail — it forms a perfectly plausible image at the wrong illumination — so
   * `renderBrightfield` refuses the pair rather than picking one by reading
   * order. `imaging/object-field` never sets both.
   */
  readonly source?: CondenserSource;
}

export interface BrightfieldFieldOptions {
  /** Patches across the field, per axis. 1 is plain isoplanatic imaging. */
  readonly patches?: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
  /**
   * Throw unless every patch rules `valid`.
   *
   * Off by default, and that is not laxity: absent traced sampling reads
   * `unknown`, so a default throw would make this unusable for every caller that
   * has a pupil but not the trace behind it. The verdict is always returned, and
   * it is not a field a caller can round down to "fine".
   */
  readonly requireHonest?: boolean;
  /** Called once per patch imaged, for progress and cost accounting. */
  readonly onPatch?: (done: number, total: number) => void;
}

export interface BrightfieldFieldResult {
  readonly size: number;
  readonly patches: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /**
   * The WORST verdict across the patches, and the one that produced it.
   *
   * `brightfieldFidelity`'s first caller. Worst rather than typical, because a
   * frame is not honest in the places where it happens to be: one corner whose
   * wavefront has left the regime the coherent sum describes is a corner this
   * engine cannot image, and averaging it against good neighbours would be
   * exactly the silent replacement of partial coherence by incoherence that
   * `illumination/fidelity` exists to prevent.
   */
  readonly fidelity: BrightfieldFidelity;
  /** Max over patches — the grid's ability to carry the worst pupil it saw. */
  readonly maxGridPhaseStepWaves: number;
  /** Min over patches: the patch whose source was worst represented. */
  readonly contributingPoints: number;
  readonly pixelScaleMm?: number;
}

/** `no-honest-image` ≻ `unknown` ≻ `valid`. */
const VERDICT_RANK: Record<BrightfieldVerdict, number> = {
  valid: 0,
  unknown: 1,
  "no-honest-image": 2,
};

/**
 * Form the brightfield image of `object` across a field whose pupil varies.
 *
 * The blend is applied to each patch's finished intensity. See the header for
 * why that is the only side available, and what it costs.
 */
export function renderBrightfield(
  object: ObjectField,
  pupilAt: (u: number, v: number) => PatchPupil,
  source: CondenserSource,
  options: BrightfieldFieldOptions,
): BrightfieldFieldResult {
  const patches = options.patches ?? 1;
  if (!Number.isInteger(patches) || patches < 1) {
    throw new Error(`patches must be a positive integer, got ${patches}`);
  }
  const n = object.size;
  const intensity = new Float64Array(n * n);
  let worst: BrightfieldFidelity | null = null;
  let maxGridPhaseStepWaves = 0;
  let contributingPoints = Infinity;
  let done = 0;

  for (let py = 0; py < patches; py++) {
    for (let px = 0; px < patches; px++) {
      const patch = pupilAt((px + 0.5) / patches, (py + 0.5) / patches);
      const verdict = brightfieldFidelity(patch.sampling, options.pupilSamples);
      if (worst === null || VERDICT_RANK[verdict.verdict] > VERDICT_RANK[worst.verdict]) {
        worst = verdict;
      }

      // The cone this field point is actually lit from. `translateSource`
      // returns its input unchanged at a zero offset, so a telecentric system —
      // and every ideal-pupil caller, which has no system to be non-telecentric —
      // reaches `abbeImage` with the identical object it did before § 6x.
      //
      // A traced cone (§ 6ag) arrives with the displacement already in its
      // coordinates, so it replaces the source rather than being translated. The
      // pair is refused because translating it would double-count § 6x and the
      // result would be an image, not an error — see `PatchPupil.source`.
      if (patch.source !== undefined && patch.illuminationOffset !== undefined) {
        throw new Error(
          `renderBrightfield: the patch at (${px}, ${py}) carries both a traced \`source\` and an ` +
            "`illuminationOffset`. A traced cone's points are absolute pupil coordinates with the " +
            "field displacement already in them, so translating it again would double-count § 6x " +
            "and form a plausible image at the wrong illumination — supply one or the other",
        );
      }
      const lit =
        patch.source !== undefined
          ? patch.source
          : patch.illuminationOffset === undefined
            ? source
            : translateSource(source, patch.illuminationOffset.sx, patch.illuminationOffset.sy);

      const formed = abbeImage(object, patch.pupil, lit, {
        pupilSamples: options.pupilSamples,
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      });
      maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, formed.maxGridPhaseStepWaves);
      contributingPoints = Math.min(contributingPoints, formed.contributingPoints);

      for (let y = 0; y < n; y++) {
        const wy = patchWeight((y + 0.5) / n, py, patches);
        if (wy === 0) continue;
        for (let x = 0; x < n; x++) {
          const wx = patchWeight((x + 0.5) / n, px, patches);
          if (wx === 0) continue;
          const i = y * n + x;
          intensity[i] = intensity[i]! + wx * wy * formed.intensity[i]!;
        }
      }
      options.onPatch?.(++done, patches * patches);
    }
  }

  const fidelity = worst!;
  if (options.requireHonest === true && fidelity.verdict !== "valid") {
    throw new Error(
      `renderBrightfield: the worst patch rules "${fidelity.verdict}" — ${fidelity.reason}`,
    );
  }

  return {
    size: n,
    patches,
    pupilSamples: options.pupilSamples,
    intensity,
    fidelity,
    maxGridPhaseStepWaves,
    contributingPoints,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, options.pupilSamples) }),
  };
}
