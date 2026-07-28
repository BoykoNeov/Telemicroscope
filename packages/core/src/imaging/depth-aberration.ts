import {
  deliveredNaIntoMount,
  stackWavefrontErrorMm,
  type PlaneLayer,
} from "../designs/coverslip";
import type { PupilFunction } from "../wave/psf";
import { defocusWaves, withDefocus, type DepthPupils, type VolumeImageOptions } from "./volume";

/**
 * Depth-dependent spherical aberration — § 6k's named deferral, and the last
 * numbered gap in the microscope branch (§ 6l).
 *
 * § 6k images a volume through a pupil that varies with depth **only by
 * defocus**, and says so: `DepthPupils` is a callback precisely so that this step
 * could fill it. What it deferred is the thing that actually limits deep
 * imaging — a specimen is mounted in a medium whose index is not the immersion's,
 * so focusing d below the coverslip drags the cone through d of the wrong glass
 * and adds spherical aberration **that grows with d**.
 *
 * ## No new physics — a depth is one more layer
 *
 * § 6c solves a plate to all orders and § 6e.1 generalises it to an N-layer
 * stack. A focal depth is a layer of thickness d and index n_s, so the wavefront
 * is `stackWavefrontErrorMm` with that layer and nothing else changed. Every
 * property of the stack transfers:
 *
 *  - **exactly linear in depth** — d is a bare factor, at every aperture and to
 *    all orders, so the aberration of focusing twice as deep is twice as large
 *    and no expansion was truncated to say so;
 *  - **identically zero for a matched mount** — the layer carries (n_s²−n_i²) as
 *    an explicit factor, so a water objective in water returns a hard zero rather
 *    than a small residual, at every depth and every aperture. That is why water
 *    and glycerol objectives exist, and it is § 6e.1's identity arriving where a
 *    microscopist meets it;
 *  - **leading term q⁴** — third-order spherical and nothing lower, so the
 *    budget runs as 1/NA⁴ exactly as the coverslip's does.
 *
 * The one thing that does *not* transfer is that a slip error is a fixed one-off
 * and **depth is unbounded**. Every mismatched mount has a depth past which no
 * objective is diffraction-limited, and `mountDepthTolerance` reports it.
 *
 * ## Two questions, and the API refuses to blur them
 *
 * `DepthPupils` is keyed on defocus, and there are two physically different
 * things a caller can mean by "a pupil that varies with depth":
 *
 *  - **The SA tracks the slice.** Each plane of a thick specimen sits at its own
 *    depth, so it looks through its own thickness of mount. This is the volume
 *    case and it is what `mountPupils` builds — it inverts `defocusWaves` back to
 *    an absolute depth, which is exact because that map is affine.
 *  - **The SA is fixed and the focus sweeps.** One emitter at a known depth, the
 *    objective walked through it: the aberration is set once by that depth and
 *    only the defocus moves. This is the axial-PSF case, and it needs no new
 *    API — it is `defocusing(withMountAberration(pupil, spec, depthMm))`.
 *
 * They give different curves and § 6l.6 and § 6l.7 measure different things on
 * them, so neither is a default. A boolean would have hidden the question.
 *
 * ## The coupling that cannot be a convention
 *
 * `renderVolume` turns a slice's millimetres into waves with
 * W = ½·δ·NA²/n, and **n there is the medium the geometry is in** — the mount,
 * not the immersion. `mountPupils` has to invert that same map to recover the
 * depth a slice sits at, so if the two disagree every slice is aberrated for the
 * wrong depth, silently, by the ratio n_i/n_s (14% for oil and water). Nothing
 * about the resulting image looks wrong.
 *
 * So the four coupled numbers — NA, λ, the index and the focus — are not passed
 * to `renderVolume` by the caller at all. `mountVolumeOptions` emits them from
 * the same `MountSpec` the pupils were built from, and the type refuses the
 * overrides. This is § 6s's discipline with the radial map's identity, applied to
 * a coupling that has no readout to catch it.
 *
 * ## What this step does NOT add
 *
 * **Off axis.** § 6c's plate and § 6e.1's stack are on-axis S_I stories; a plate
 * in a non-telecentric beam also adds coma and astigmatism, and the object-space
 * ray aiming that would express it is § 6a's standing blocker.
 *
 * **The chromatic half.** Every index here is resolved at one wavelength, so a
 * mount that is dispersive relative to the immersion is one λ at a time — the
 * same deferral § 6e names.
 *
 * **The correction collar.** § 6e.5 measured its real job to be index and NA
 * drift; against a mount depth it would be a second free parameter re-solving the
 * objective, which is § 6c's `targetS1Mm` route and not a readout.
 */

export interface MountSpec {
  /** Index of the medium the specimen is mounted in, at the wavelength in use. */
  readonly mountIndex: number;
  /**
   * Index of the immersion the objective's cone runs in — what it was corrected
   * for. Equal to `mountIndex` is the matched case and aberrates a hard zero.
   */
  readonly immersionIndex: number;
  /**
   * Object-side NA at the pupil rim, sine-convention: the pupil coordinate is
   * ρ = q/NA, so q = NA·ρ. Refused above the mount's own ceiling — see
   * `deliveredNaIntoMount` — because a budget quoted for rays that do not exist
   * is a number about nothing.
   */
  readonly numericalAperture: number;
  readonly wavelengthNm: number;
  /**
   * Depth below the coverslip the objective is focused at (object mm, +z into
   * the specimen). The volume's z origin is the slip's underside, so a slice's
   * `zMm` IS its depth in the mount.
   */
  readonly focusDepthMm: number;
}

const checkSpec = (spec: MountSpec): void => {
  if (!(spec.mountIndex > 0)) throw new Error("MountSpec: the mount index must be positive");
  if (!(spec.immersionIndex > 0)) {
    throw new Error("MountSpec: the immersion index must be positive");
  }
  if (!(spec.numericalAperture > 0)) throw new Error("MountSpec: NA must be positive");
  if (!(spec.wavelengthNm > 0)) throw new Error("MountSpec: the wavelength must be positive");
  if (!Number.isFinite(spec.focusDepthMm)) {
    throw new Error("MountSpec: the focus depth must be finite");
  }
};

/**
 * The aperture the mount actually delivers into this objective: min(NA, n_s).
 *
 * A ray inside the specimen carries q = n_s·sinθ_s < n_s, so an objective
 * engraved 1.40 collects nothing beyond **1.333** from a water mount however
 * deep or shallow the focus. See `deliveredNaIntoMount` and § 6l.3.
 */
export const mountAperture = (spec: MountSpec): number =>
  deliveredNaIntoMount(spec.numericalAperture, spec.mountIndex);

/**
 * The wavefront a focal depth costs, in **waves**, at normalized pupil radius ρ.
 *
 * `stackWavefrontErrorMm` with one layer, converted by the wavelength — referenced
 * to the buried source's paraxial image, so the defocus a depth introduces is
 * already out of it and what is left is aberration. The paraxial part it removed
 * is `depthFocusShiftMm`, and § 6l.1 pins that the two together reproduce the
 * literature's `depthOpdMm` to f64.
 *
 * Returns 0 outside the delivered aperture rather than throwing: beyond it the
 * pupil is dark, and `withMountAberration` is what makes that an amplitude.
 */
export function mountWavefrontWaves(spec: MountSpec, depthMm: number, rho: number): number {
  checkSpec(spec);
  if (depthMm === 0 || spec.mountIndex === spec.immersionIndex) return 0;
  const q = spec.numericalAperture * Math.abs(rho);
  if (!(q < spec.mountIndex) || !(q < spec.immersionIndex)) return 0;
  const layers: readonly PlaneLayer[] = [{ thicknessMm: depthMm, n: spec.mountIndex }];
  return (
    stackWavefrontErrorMm(layers, spec.immersionIndex, q) / (spec.wavelengthNm * 1e-6)
  );
}

/**
 * Add a focal depth's aberration to a pupil — `withDefocus`'s shape, one layer
 * of physics further in.
 *
 * Two things happen, and only one of them is a phase.
 *
 * **The phase** is `mountWavefrontWaves`, added to whatever the pupil already
 * carried, so this composes onto a *traced* pupil as readily as onto an ideal
 * one — and onto `withDefocus`, in either order.
 *
 * **The amplitude** is truncated at the delivered aperture. Rays of invariant
 * above n_s do not exist inside the specimen, so the outer annulus of a pupil
 * wider than the mount receives no light: an oil 1.40 on a water mount images
 * through an effectively 1.333 pupil, which is a real loss of resolution with no
 * aberration in it at all. The truncation does **not** vary with depth, which is
 * why § 6k.1's flux invariance survives this step (§ 6l.6) — a depth-varying
 * amplitude is exactly what § 6k.5's negative control needed to fill the missing
 * cone, and this is not one.
 */
export function withMountAberration(
  pupil: PupilFunction,
  spec: MountSpec,
  depthMm: number,
): PupilFunction {
  checkSpec(spec);
  const na = spec.numericalAperture;
  const ceiling = mountAperture(spec);
  const truncates = ceiling < na;
  // ρ at which q reaches the ceiling. Squared, so the test costs no sqrt.
  const rhoMax2 = (ceiling / na) ** 2;
  const matched = depthMm === 0 || spec.mountIndex === spec.immersionIndex;
  if (matched && !truncates) return pupil;
  return {
    amplitude: (px, py) =>
      truncates && px * px + py * py >= rhoMax2 ? 0 : pupil.amplitude(px, py),
    phaseWaves: (px, py) =>
      pupil.phaseWaves(px, py) + (matched ? 0 : mountWavefrontWaves(spec, depthMm, Math.hypot(px, py))),
  };
}

/**
 * The volume case: a `DepthPupils` whose aberration tracks each slice's own depth.
 *
 * `renderVolume` hands the callback a defocus in waves. That map is affine —
 * waves = δ·NA²/(2·n_s·λ) — so the absolute depth is recovered exactly:
 *
 *     depth = focusDepthMm + waves·2·n_s·λ / NA²
 *
 * and the slice is imaged through the pupil at *that* depth, defocused by the
 * waves it was given. The recovery is only correct if `renderVolume` was given
 * this spec's own index, NA and wavelength, which is what `mountVolumeOptions`
 * exists to guarantee.
 *
 * For the other question — one emitter at a fixed depth, the focus swept through
 * it — compose the two primitives instead:
 * `defocusing(withMountAberration(pupil, spec, depthMm))`.
 */
export function mountPupils(pupil: PupilFunction, spec: MountSpec): DepthPupils {
  checkSpec(spec);
  const perWave =
    (2 * spec.mountIndex * spec.wavelengthNm * 1e-6) /
    (spec.numericalAperture * spec.numericalAperture);
  return (waves) => {
    const depthMm = spec.focusDepthMm + waves * perWave;
    return withDefocus(withMountAberration(pupil, spec, depthMm), waves);
  };
}

/**
 * The `renderVolume` options a mount forces, emitted from the same spec the
 * pupils were built from.
 *
 * The four coupled numbers are not the caller's to supply — see the header. The
 * type removes them and the runtime refuses them anyway, because a plain object
 * literal reaching this through `any` would otherwise reintroduce exactly the
 * silent error the type was there to stop.
 */
export type MountVolumeOptions = Omit<
  VolumeImageOptions,
  "numericalAperture" | "wavelengthNm" | "refractiveIndex" | "focusMm"
>;

export function mountVolumeOptions(
  spec: MountSpec,
  rest: MountVolumeOptions,
): VolumeImageOptions {
  checkSpec(spec);
  for (const key of ["numericalAperture", "wavelengthNm", "refractiveIndex", "focusMm"]) {
    // An explicit `undefined` is let through rather than refused: three of the
    // four are optional on `VolumeImageOptions`, so an options object that was
    // destructured and respread legitimately carries the key unset — and the
    // spec's own values are written AFTER the spread, so it could not have won
    // anyway. What is refused is a real override.
    if (
      Object.prototype.hasOwnProperty.call(rest, key) &&
      (rest as Record<string, unknown>)[key] !== undefined
    ) {
      throw new Error(
        `mountVolumeOptions: ${key} comes from the MountSpec, not from the caller — a volume rendered with an index the pupils were not built for aberrates every slice for the wrong depth, silently`,
      );
    }
  }
  return {
    ...rest,
    numericalAperture: spec.numericalAperture,
    wavelengthNm: spec.wavelengthNm,
    // The geometry is in the MOUNT: W = ½·δ·NA²/n, and δ is measured there.
    refractiveIndex: spec.mountIndex,
    focusMm: spec.focusDepthMm,
  };
}

/**
 * The defocus, in waves, that `renderVolume` will hand `mountPupils` for a slice
 * at this depth — the forward half of the map `mountPupils` inverts.
 *
 * Exposed so a caller can author a stack in depths and read back what the engine
 * will call it, and so § 6l.9 can pin the round trip rather than assume it.
 */
export const mountDefocusWaves = (spec: MountSpec, depthMm: number): number =>
  defocusWaves(
    depthMm - spec.focusDepthMm,
    spec.numericalAperture,
    spec.wavelengthNm,
    spec.mountIndex,
  );
