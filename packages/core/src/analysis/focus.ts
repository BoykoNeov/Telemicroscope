import { asCompiled } from "../trace/compile";
import { PlaneRay, paraxialRefract, paraxialTransfer } from "../trace/paraxial";
import { OpticalSystem, primaryWavelength } from "../trace/system";
import { pupils, imagePlaneZ, assertUnfolded } from "../pupil/pupils";
import { AimOptions, PupilPoint, pupilGrid } from "../pupil/aiming";
import { opdMap } from "../pupil/opd";
import { exitBundle, bestSpotZ, spotAt } from "./spot";

/**
 * Focus solve — "where is best focus?", which is the most common question a
 * user asks in either branch, and which has no single answer.
 *
 * Three criteria, and they genuinely disagree. For a system dominated by
 * primary spherical aberration, write the wavefront as W(ρ) = a·ρ⁴ + b·ρ²
 * where b is the defocus the image plane contributes. Each criterion picks a
 * different b:
 *
 *   Var(W)          = 4a²/45 + ab/6 + b²/12      → minimised at b = −a
 *   ⟨(dW/dρ)²⟩      = 4a²    + 16ab/3 + 2b²      → minimised at b = −4a/3
 *   paraxial focus                                →              b = 0
 *   marginal focus                                →              b = −2a
 *
 * So the geometric best focus sits 4/3 as far from paraxial focus as the
 * wavefront best focus does — a ratio that survives the b ↔ δz conversion and
 * is therefore independent of NA. That is the rung `focus.test.ts` pins.
 *
 * A focus solve returns an `offsetFromLastVertex`, the same quantity
 * `ImageSurfaceSpec` carries: solving does not mutate a system, it hands you a
 * number to build one with (`withFocus`).
 *
 * SCOPE. Two capabilities the signature admits but the validation ladder does
 * not yet pin, so treat their answers as unvalidated:
 *  - **Off axis.** `fieldValue` runs and the maths does not care about field,
 *    but every rung in focus.test.ts is on axis. A field point splits into
 *    tangential and sagittal foci, and picking between them is field-curvature
 *    work that has not happened yet.
 *  - **Polychromatic.** Focus is solved at ONE wavelength. A weighted-over-
 *    spectrum best focus is a different (and for the achromat story, more
 *    interesting) quantity; it waits for the wave layer's polychromatic stack.
 */

export type FocusCriterion =
  /** First-order image plane: where the paraxial marginal ray crosses the axis. */
  | "paraxial"
  /** Minimum RMS geometric spot radius. Closed form — see `bestSpotZ`. */
  | "minRmsSpot"
  /**
   * Minimum RMS wavefront error at the exit pupil. This IS the max-Strehl
   * criterion: by the extended Maréchal approximation Strehl ≈ exp(−(2πσ)²)
   * is monotonically decreasing in σ, so maximising one minimises the other.
   * Named for what it computes rather than for the PSF it does not build.
   */
  | "minRmsWavefront";

export interface FocusOptions {
  /** Field to focus on (angle in degrees, or object height in mm). Default 0. */
  readonly fieldValue?: number;
  /** Default: the system's highest-weighted wavelength. */
  readonly wavelengthNm?: number;
  /** Pupil grid resolution across the full diameter. Default 17. */
  readonly pupilSamples?: number;
  readonly aim?: AimOptions;
  /** Bracket width to stop the wavefront search at (mm). Default 1e-7. */
  readonly tolerance?: number;
}

export interface FocusResult {
  readonly criterion: FocusCriterion;
  /** What to put in `ImageSurfaceSpec.offsetFromLastVertex` (mm, signed). */
  readonly offsetFromLastVertex: number;
  /** World z of the focused image plane (mm). */
  readonly z: number;
  /** Displacement from the paraxial image plane (mm, signed). */
  readonly shiftFromParaxial: number;
  /**
   * The criterion's own merit at that plane: RMS spot radius in mm for
   * `minRmsSpot`, RMS wavefront error in waves for `minRmsWavefront`, and the
   * RMS spot radius for `paraxial` (which optimises nothing).
   */
  readonly merit: number;
}

/** A copy of `system` with its image plane moved. Does not mutate. */
export function withFocus(system: OpticalSystem, offsetFromLastVertex: number): OpticalSystem {
  return {
    ...system,
    imageSurface: { ...system.imageSurface, offsetFromLastVertex },
  };
}

/**
 * The paraxial image plane, as an offset from the last vertex.
 *
 * Computed as an axis crossing rather than from `systemProperties.bfd`: the
 * crossing form is conjugate-general, so the finite-conjugate microscope
 * branch gets the same code path. For an infinite conjugate the probe ray is
 * parallel to the axis; for a finite one it leaves the axial object point, and
 * any non-zero slope picks out that point's conjugate.
 */
export function paraxialImageOffset(system: OpticalSystem, wavelengthNm: number): number {
  const c = asCompiled(system.prescription);
  // Walks compiled thicknesses along the axis, so it is the one door into
  // unfolded-z that does NOT go through pupils(). Guarded in its own right, or
  // a folded system would reach `bestFocus` and get a plausible wrong number.
  assertUnfolded(c, "paraxialImageOffset()");
  const n0 = c.indices(wavelengthNm)[0]!;

  let st: PlaneRay =
    system.conjugate.kind === "infinite"
      ? { y: 1, u: 0, n: n0 }
      : { y: system.conjugate.distance, u: 1, n: n0 };

  for (let i = 0; i < c.surfaces.length; i++) {
    st = paraxialRefract(c, i, wavelengthNm, st);
    if (i < c.surfaces.length - 1) st = paraxialTransfer(st, c.surfaces[i]!.thickness);
  }

  if (Math.abs(st.u) < 1e-15) {
    throw new Error("afocal in image space: there is no paraxial image plane");
  }
  return -st.y / st.u;
}

/**
 * Pin the aperture to the stop radius it currently resolves to.
 *
 * The `imageNA` spelling is defined against the image plane, so a naive search
 * would resize the pupil at every candidate offset and optimise a moving
 * target. The physical stop does not change when you refocus, so freeze it.
 */
function freezeAperture(system: OpticalSystem, wavelengthNm: number): OpticalSystem {
  if (system.aperture.kind === "stopRadius") return system;
  const radius = pupils(system, wavelengthNm).stopRadius;
  return { ...system, aperture: { kind: "stopRadius", value: radius } };
}

/**
 * Half-width to search over when the spot and paraxial planes coincide — the
 * defocus that would cost about one wave at the rim, from W = ½·δ·NA²·ρ².
 */
function oneWaveDefocus(system: OpticalSystem, wavelengthNm: number): number {
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const arm = imagePlaneZ(c, system) - pupil.exit.z;
  if (!Number.isFinite(arm) || !Number.isFinite(pupil.exit.radius)) {
    // Telecentric in image space: no exit-pupil arm to form an NA from.
    throw new Error("cannot size a focus search bracket: exit pupil is at infinity");
  }
  const na = Math.abs(pupil.exit.radius) / Math.hypot(arm, pupil.exit.radius);
  if (na < 1e-12) throw new Error("cannot size a focus search bracket: zero NA");
  return (2 * wavelengthNm * 1e-6) / (na * na);
}

/** Golden-section minimisation of a unimodal f over [lo, hi]. */
function goldenMin(
  f: (x: number) => number,
  lo: number,
  hi: number,
  tolerance: number,
): { x: number; fx: number } {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);

  while (b - a > tolerance) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  const x = (a + b) / 2;
  return { x, fx: f(x) };
}

export function bestFocus(
  system: OpticalSystem,
  criterion: FocusCriterion,
  options: FocusOptions = {},
): FocusResult {
  const wavelengthNm = options.wavelengthNm ?? primaryWavelength(system);
  const fieldValue = options.fieldValue ?? 0;
  const aim = options.aim ?? {};
  const points: readonly PupilPoint[] = pupilGrid(options.pupilSamples ?? 17);

  const frozen = freezeAperture(system, wavelengthNm);
  const c = asCompiled(frozen.prescription);
  const lastVertexZ = c.surfaces[c.surfaces.length - 1]!.vertexZ;
  const paraxialOffset = paraxialImageOffset(frozen, wavelengthNm);

  const finish = (offset: number, merit: number): FocusResult => ({
    criterion,
    offsetFromLastVertex: offset,
    z: lastVertexZ + offset,
    shiftFromParaxial: offset - paraxialOffset,
    merit,
  });

  // One trace serves the paraxial and geometric criteria both: exit rays are
  // straight lines, so any plane is a re-evaluation rather than a re-trace.
  if (criterion !== "minRmsWavefront") {
    const bundle = exitBundle(frozen, fieldValue, wavelengthNm, points, aim);
    const offset =
      criterion === "paraxial" ? paraxialOffset : bestSpotZ(bundle) - lastVertexZ;
    return finish(offset, spotAt(bundle, lastVertexZ + offset).rmsRadius);
  }

  // Wavefront criterion: the reference sphere is recentred on the chief ray's
  // image point at every candidate plane, which is exactly what injects the
  // defocus term, so this one has to re-evaluate the OPD map per offset.
  const rms = (offset: number): number =>
    opdMap(withFocus(frozen, offset), fieldValue, wavelengthNm, points, aim).rmsWaves;

  const spotOffset = bestSpotZ(exitBundle(frozen, fieldValue, wavelengthNm, points, aim)) - lastVertexZ;
  const gap = Math.abs(spotOffset - paraxialOffset);
  const fallback = oneWaveDefocus(frozen, wavelengthNm);
  // Third-order theory puts this minimum at 3/4 of the geometric one, so twice
  // the geometric gap brackets it comfortably from either side — and the sign
  // is not assumed, because a mirror focuses toward −z.
  const span = gap > fallback * 1e-3 ? 2 * gap : fallback;

  const { x, fx } = goldenMin(
    rms,
    paraxialOffset - span,
    paraxialOffset + span,
    options.tolerance ?? 1e-7,
  );
  return finish(x, fx);
}
