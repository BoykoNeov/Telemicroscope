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
 * **Off axis** — ✅ **since closed at § 6y**, and the sentence that stood here
 * named a blocker that had already gone. It read "the object-space ray aiming
 * that would express it is § 6a's standing blocker"; § 6u closed that blocker,
 * and this comment went on asserting it because no structural check can see a
 * sentence that quietly stopped matching the engine (APP.md's Part F, arriving in
 * `core`). What was true underneath it is narrower and is a fact about *this*
 * module rather than about aiming: every form here takes the invariant as a bare
 * radius, and a radius cannot express coma. The vector spelling is
 * `mountWavefrontWavesVector` and `withMountAberration`'s `chief` argument below.
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
 * The chief ray's own transverse invariant, resolved onto the pupil's axes —
 * `chiefRayInvariant` (`pupil/microscope`) turned to a field point's azimuth,
 * exactly as `FieldPupil.illuminationOffset` turns § 6x's radial offset.
 *
 * Zero is the axial case AND the telecentric one, and in both it is a bitwise
 * zero rather than a small number, which is what the vector path checks for
 * before deciding it has nothing to do.
 */
export interface ChiefInvariant {
  readonly qx: number;
  readonly qy: number;
}

const AXIAL: ChiefInvariant = { qx: 0, qy: 0 };
const isAxial = (c: ChiefInvariant): boolean => c.qx === 0 && c.qy === 0;

/**
 * The wavefront a focal depth costs at a **pupil point**, in waves — the vector
 * form, and the one an off-axis field point needs (§ 6y).
 *
 * The stack is symmetric about its own normal rather than about the beam, so the
 * aberration is still `W(|q|)` and still radial — in the plane of the invariant,
 * which is not the plane of the pupil once the chief ray is tilted:
 *
 *     q = (chief.qx + NA·px,  chief.qy + NA·py)
 *
 * With an axial or telecentric chief ray this **delegates** to
 * `mountWavefrontWaves` at ρ = |(px, py)| rather than reaching the same answer by
 * a parallel route. That is deliberate: `hypot(NA·px, NA·py)` and
 * `NA·hypot(px, py)` are the same number in algebra and not always the same f64,
 * so a vector path that recomputed it would leave every on-axis claim in the
 * repo agreeing to a tolerance where it used to agree bitwise. § 6y.2 pins the
 * reduction; this is what makes it structural rather than lucky.
 *
 * Returns 0 where the invariant reaches an index in the stack, for
 * `mountWavefrontWaves`' reason: past there the ray does not exist and
 * `withMountAberration` is what turns that into an amplitude. Off axis that
 * region is a **crescent** rather than an annulus, since it is the displaced disc
 * that leaves the ceiling, not a centred one.
 */
export function mountWavefrontWavesVector(
  spec: MountSpec,
  depthMm: number,
  px: number,
  py: number,
  chief: ChiefInvariant = AXIAL,
): number {
  if (isAxial(chief)) return mountWavefrontWaves(spec, depthMm, Math.hypot(px, py));
  checkSpec(spec);
  if (depthMm === 0 || spec.mountIndex === spec.immersionIndex) return 0;
  const qx = chief.qx + spec.numericalAperture * px;
  const qy = chief.qy + spec.numericalAperture * py;
  const q = Math.hypot(qx, qy);
  if (!(q < spec.mountIndex) || !(q < spec.immersionIndex)) return 0;
  const layers: readonly PlaneLayer[] = [{ thicknessMm: depthMm, n: spec.mountIndex }];
  return stackWavefrontErrorMm(layers, spec.immersionIndex, q) / (spec.wavelengthNm * 1e-6);
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
 *
 * ## `chief` — the field point's own tilt, and what it does to BOTH halves
 *
 * Passing the chief ray's invariant (`chiefRayInvariant`, turned to this point's
 * azimuth) is what makes this an off-axis pupil (§ 6y). Both halves change, and
 * they change differently:
 *
 *  - the **phase** picks up coma, astigmatism and a tilt, because a quartic in
 *    |q| evaluated on a disc that no longer surrounds the origin is not a quartic
 *    in ρ. The sizes are `stackObliqueSeidelMm`'s;
 *  - the **amplitude** stops being an annulus. The ceiling is a circle in the
 *    invariant plane and the pupil is a disc displaced inside it, so what is lost
 *    is a **crescent** on the field's own side — asymmetric, and therefore an
 *    apodization rather than a smaller aperture.
 *
 * With `chief` omitted or bitwise zero — the axial case, and every field point of
 * a telecentric objective (§ 6v.4) — this is the identical function it always
 * was, by delegation rather than by agreement.
 */
export function withMountAberration(
  pupil: PupilFunction,
  spec: MountSpec,
  depthMm: number,
  chief: ChiefInvariant = AXIAL,
): PupilFunction {
  checkSpec(spec);
  const na = spec.numericalAperture;
  if (!isAxial(chief)) {
    // The ceiling is a statement about the INVARIANT, so off axis it has to be
    // tested there: `mountAperture`'s min(NA, n_s) is that same statement
    // collapsed onto a pupil radius, which is only available while the disc is
    // centred on the stack's normal.
    const matchedOff = depthMm === 0 || spec.mountIndex === spec.immersionIndex;
    const rim = Math.min(spec.mountIndex, spec.immersionIndex);
    const rim2 = rim * rim;
    return {
      amplitude: (px, py) => {
        const qx = chief.qx + na * px;
        const qy = chief.qy + na * py;
        return qx * qx + qy * qy >= rim2 ? 0 : pupil.amplitude(px, py);
      },
      phaseWaves: (px, py) =>
        pupil.phaseWaves(px, py) +
        (matchedOff ? 0 : mountWavefrontWavesVector(spec, depthMm, px, py, chief)),
    };
  }
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
